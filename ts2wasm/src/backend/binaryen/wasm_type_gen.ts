/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import {
    FunctionKind,
    getMethodPrefix,
    TSArray,
    TSClass,
    TSFunction,
    TSInterface,
    Type,
    TypeKind,
} from '../../type.js';
import {
    arrayToPtr,
    emptyStructType,
    initArrayType,
    initStructType,
    createSignatureTypeRefAndHeapTypeRef,
    Pakced,
    generateArrayStructTypeInfo,
} from './glue/transform.js';
import { assert } from 'console';
import { infcTypeInfo, stringTypeInfo } from './glue/packType.js';
import { WASMGen } from './index.js';
import { Logger } from '../../log.js';
import { typeInfo } from './glue/utils.js';
import { getFuncName } from './utils.js';
import { BuiltinNames } from '../../../lib/builtin/builtin_name.js';

export class WASMTypeGen {
    tsType2WASMTypeMap: Map<Type, binaryenCAPI.TypeRef> = new Map();
    private tsType2WASMHeapTypeMap: Map<Type, binaryenCAPI.HeapTypeRef> =
        new Map();
    // the format is : {context: struct{}, funcref: ref $func}
    private tsFuncType2WASMStructType: Map<Type, binaryenCAPI.TypeRef> =
        new Map();
    private tsArrayType2WASMTypeInfo: Map<Type, typeInfo> = new Map();
    private tsFuncType2WASMStructHeapType: Map<Type, binaryenCAPI.HeapTypeRef> =
        new Map();
    private tsFuncParamType: Map<Type, binaryenCAPI.TypeRef> = new Map();
    private tsFuncReturnType: Map<Type, binaryenCAPI.TypeRef> = new Map();
    private tsClassVtableType: Map<Type, binaryenCAPI.TypeRef> = new Map();
    private tsClassVtableHeapType: Map<Type, binaryenCAPI.TypeRef> = new Map();

    /* not contain context struct:
      (i: number) ==> (f64) (result none) rather than (ref{}, f64)(result none)
    */
    private tsFuncOriginalParamType: Map<Type, binaryenCAPI.TypeRef> =
        new Map();
    private classVtables: Map<Type, binaryenCAPI.ExpressionRef> = new Map();
    private classStaticFieldsType: Map<Type, binaryenCAPI.TypeRef> = new Map();
    private classStaticFieldsHeapType: Map<Type, binaryenCAPI.HeapTypeRef> =
        new Map();
    private structHeapTypeCnt = 0;
    private arrayHeapTypeCnt = 0;
    private funcHeapTypeCnt = 0;

    constructor(private WASMCompiler: WASMGen) {}

    createWASMType(type: Type, typeArg: Type | null = null): void {
        if (typeArg === null && this.tsType2WASMTypeMap.has(type)) {
            return;
        }
        switch (type.typeKind) {
            case TypeKind.WASM_ANYREF:
                this.tsType2WASMTypeMap.set(type, binaryen.anyref);
                break;
            case TypeKind.WASM_I32:
                this.tsType2WASMTypeMap.set(type, binaryen.i32);
                break;
            case TypeKind.WASM_I64:
                this.tsType2WASMTypeMap.set(type, binaryen.i64);
                break;
            case TypeKind.WASM_F32:
                this.tsType2WASMTypeMap.set(type, binaryen.f32);
                break;
            case TypeKind.WASM_F64:
                this.tsType2WASMTypeMap.set(type, binaryen.f64);
                break;
            case TypeKind.VOID:
                this.tsType2WASMTypeMap.set(type, binaryen.none);
                break;
            case TypeKind.BOOLEAN:
                this.tsType2WASMTypeMap.set(type, binaryen.i32);
                break;
            case TypeKind.NUMBER:
                this.tsType2WASMTypeMap.set(type, binaryen.f64);
                break;
            case TypeKind.STRING: {
                this.tsType2WASMTypeMap.set(type, stringTypeInfo.typeRef);
                this.tsType2WASMHeapTypeMap.set(
                    type,
                    stringTypeInfo.heapTypeRef,
                );
                this.createCustomTypeName(
                    'string_type',
                    stringTypeInfo.heapTypeRef,
                );
                break;
            }
            /** regard unknown as any currently */
            /** if type is null, then the value can only be null.
             * We treat it as anyref here since it's nullable */
            case TypeKind.UNKNOWN:
            case TypeKind.NULL:
            case TypeKind.ANY: {
                this.tsType2WASMTypeMap.set(type, binaryen.anyref);
                break;
            }
            case TypeKind.ARRAY: {
                const arrayType = <TSArray>type;
                const elemType = arrayType.elementType;
                let elemTypeRef = this.getWASMType(elemType, false, typeArg);
                if (elemType.kind === TypeKind.FUNCTION) {
                    elemTypeRef = this.getWASMFuncStructType(elemType);
                } else if (elemType.kind === TypeKind.ARRAY) {
                    elemTypeRef = this.getWasmArrayStructType(elemType);
                }
                const arrayTypeInfo = initArrayType(
                    elemTypeRef,
                    Pakced.Not,
                    true,
                    true,
                );
                this.createCustomTypeName(
                    `array${this.arrayHeapTypeCnt++}`,
                    arrayTypeInfo.heapTypeRef,
                );
                this.tsType2WASMTypeMap.set(type, arrayTypeInfo.typeRef);
                this.tsType2WASMHeapTypeMap.set(
                    type,
                    arrayTypeInfo.heapTypeRef,
                );
                break;
            }
            case TypeKind.FUNCTION: {
                const funcType = <TSFunction>type;
                const paramTypes = funcType.getParamTypes();
                const paramWASMTypes = new Array<binaryenCAPI.TypeRef>();

                if (!funcType.isDeclare) {
                    /* First parameter is closure context */
                    paramWASMTypes.push(emptyStructType.typeRef);
                }

                if (
                    funcType.funcKind !== FunctionKind.DEFAULT &&
                    funcType.funcKind !== FunctionKind.STATIC
                ) {
                    /* For class method, second parameter is "this" pointer */
                    paramWASMTypes.push(emptyStructType.typeRef);
                }

                for (let i = 0; i < paramTypes.length; ++i) {
                    if (paramTypes[i].typeKind === TypeKind.FUNCTION) {
                        paramWASMTypes.push(
                            this.getWASMFuncStructType(paramTypes[i]),
                        );
                    } else if (paramTypes[i].typeKind === TypeKind.ARRAY) {
                        paramWASMTypes.push(
                            this.getWasmArrayStructType(paramTypes[i]),
                        );
                    } else {
                        paramWASMTypes.push(this.getWASMType(paramTypes[i]));
                    }
                }
                this.tsFuncParamType.set(
                    type,
                    binaryen.createType(paramWASMTypes),
                );
                if (!funcType.isDeclare) {
                    this.tsFuncOriginalParamType.set(
                        type,
                        binaryen.createType(paramWASMTypes.slice(1)),
                    );
                } else {
                    this.tsFuncOriginalParamType.set(
                        type,
                        binaryen.createType(paramWASMTypes),
                    );
                }
                let resultWASMType = this.getWASMType(funcType.returnType);
                if (funcType.returnType.typeKind === TypeKind.FUNCTION) {
                    resultWASMType = this.getWASMFuncStructType(
                        funcType.returnType,
                    );
                } else if (funcType.returnType.typeKind === TypeKind.ARRAY) {
                    resultWASMType = this.getWasmArrayStructType(
                        funcType.returnType,
                    );
                }
                this.tsFuncReturnType.set(type, resultWASMType);
                const signature = createSignatureTypeRefAndHeapTypeRef(
                    paramWASMTypes,
                    resultWASMType,
                );
                this.createCustomTypeName(
                    `function${this.funcHeapTypeCnt++}`,
                    signature.heapTypeRef,
                );
                this.tsType2WASMTypeMap.set(type, signature.typeRef);
                this.tsType2WASMHeapTypeMap.set(type, signature.heapTypeRef);
                if (!funcType.isDeclare) {
                    const funcStructType = initStructType(
                        [emptyStructType.typeRef, signature.typeRef],
                        [Pakced.Not, Pakced.Not],
                        [true, false],
                        2,
                        true,
                    );
                    this.tsFuncType2WASMStructType.set(
                        type,
                        funcStructType.typeRef,
                    );
                    this.tsFuncType2WASMStructHeapType.set(
                        type,
                        funcStructType.heapTypeRef,
                    );
                } else {
                    this.tsFuncType2WASMStructType.set(type, signature.typeRef);
                    this.tsFuncType2WASMStructHeapType.set(
                        type,
                        signature.heapTypeRef,
                    );
                }
                break;
            }
            case TypeKind.CLASS:
            case TypeKind.INTERFACE: {
                const tsClassType = <TSClass>type;
                // 1. add vtable
                /* currently vtable stores all member functions(without constructor) */
                const wasmFuncTypes = new Array<binaryenCAPI.TypeRef>();
                for (const method of tsClassType.memberFuncs) {
                    const methodMangledName = getFuncName(
                        tsClassType.mangledName,
                        method.name,
                    );
                    if (
                        BuiltinNames.genericBuiltinMethods.includes(
                            methodMangledName,
                        )
                    ) {
                        continue;
                    }
                    wasmFuncTypes.push(this.getWASMType(method.type));
                }
                let packed = new Array<binaryenCAPI.PackedType>(
                    wasmFuncTypes.length,
                ).fill(Pakced.Not);
                let muts = new Array<boolean>(wasmFuncTypes.length).fill(false);
                const baseType = tsClassType.getBase();
                /* in order to avoid duplicate function in binaryen */
                let isMethodSameShape = false;
                if (
                    baseType &&
                    baseType.memberFuncs.length === wasmFuncTypes.length
                ) {
                    isMethodSameShape = true;
                }
                const vtableType = initStructType(
                    wasmFuncTypes,
                    packed,
                    muts,
                    wasmFuncTypes.length,
                    true,
                    baseType == null || isMethodSameShape
                        ? undefined
                        : this.getWASMClassVtableHeapType(baseType),
                );
                this.tsClassVtableType.set(type, vtableType.typeRef);
                this.tsClassVtableHeapType.set(type, vtableType.heapTypeRef);
                // 2. add vtable and fields
                const wasmFieldTypes = new Array<binaryenCAPI.TypeRef>();
                /* vtable + fields */
                muts = new Array<boolean>(tsClassType.fields.length + 1);
                muts[0] = false;
                packed = new Array<binaryenCAPI.PackedType>(
                    tsClassType.fields.length + 1,
                ).fill(Pakced.Not);
                wasmFieldTypes[0] = vtableType.typeRef;
                for (let i = 0; i !== tsClassType.fields.length; ++i) {
                    const field = tsClassType.fields[i];
                    wasmFieldTypes.push(this.getWASMType(field.type));
                    if (field.modifier === 'readonly') {
                        muts[i + 1] = false;
                    } else {
                        muts[i + 1] = true;
                    }
                }
                // 3. generate class wasm type
                const wasmClassType = initStructType(
                    wasmFieldTypes,
                    packed,
                    muts,
                    wasmFieldTypes.length,
                    true,
                    baseType == null ||
                        (isMethodSameShape &&
                            wasmFieldTypes.length - 1 ===
                                baseType.fields.length)
                        ? undefined
                        : this.getWASMHeapType(baseType),
                );
                this.createCustomTypeName(
                    `struct${this.structHeapTypeCnt++}`,
                    wasmClassType.heapTypeRef,
                );
                this.tsType2WASMTypeMap.set(type, wasmClassType.typeRef);
                this.tsType2WASMHeapTypeMap.set(
                    type,
                    wasmClassType.heapTypeRef,
                );
                // add static fields type to type map
                if (tsClassType.staticFields.length > 0) {
                    packed = new Array<binaryenCAPI.PackedType>(
                        tsClassType.staticFields.length,
                    ).fill(Pakced.Not);
                    muts = new Array<boolean>(
                        tsClassType.staticFields.length,
                    ).fill(true);
                    const typeArray = new Array<binaryenCAPI.TypeRef>();
                    for (
                        let i = 0;
                        i !== tsClassType.staticFields.length;
                        ++i
                    ) {
                        const field = tsClassType.staticFields[i];
                        typeArray.push(this.getWASMType(field.type));
                    }
                    const staticFieldType = initStructType(
                        typeArray,
                        packed,
                        muts,
                        typeArray.length,
                        true,
                    );
                    this.classStaticFieldsType.set(
                        type,
                        staticFieldType.typeRef,
                    );
                    this.classStaticFieldsHeapType.set(
                        type,
                        staticFieldType.heapTypeRef,
                    );
                }
                if (type.typeKind === TypeKind.INTERFACE) {
                    break;
                }
                const vtableFuncs = new Array<binaryen.ExpressionRef>();
                let index = 0;
                for (const method of tsClassType.memberFuncs) {
                    const methodMangledName = getFuncName(
                        tsClassType.mangledName,
                        method.name,
                    );
                    if (
                        BuiltinNames.genericBuiltinMethods.includes(
                            methodMangledName,
                        )
                    ) {
                        continue;
                    }
                    const nameWithPrefix =
                        getMethodPrefix(method.type.funcKind) + method.name;
                    if (tsClassType.overrideOrOwnMethods.has(nameWithPrefix)) {
                        vtableFuncs.push(
                            this.WASMCompiler.module.ref.func(
                                tsClassType.mangledName + '|' + nameWithPrefix,
                                wasmFuncTypes[index],
                            ),
                        );
                    } else if (tsClassType.getBase()) {
                        /* base class must exist in this condition */
                        let baseClassType = tsClassType.getBase();
                        while (baseClassType) {
                            // found qualified baseClassType
                            if (
                                baseClassType.overrideOrOwnMethods.has(
                                    nameWithPrefix,
                                )
                            ) {
                                vtableFuncs.push(
                                    this.WASMCompiler.module.ref.func(
                                        baseClassType.mangledName +
                                            '|' +
                                            nameWithPrefix,
                                        wasmFuncTypes[index],
                                    ),
                                );
                                break;
                            }
                            baseClassType = baseClassType.getBase();
                        }
                        if (!baseClassType) {
                            const msg = `Failed to resolve method for derived class ${tsClassType.mangledName}`;
                            Logger.error(msg);
                            throw new Error(msg);
                        }
                    }

                    index++;
                }
                const vtableInstance = binaryenCAPI._BinaryenStructNew(
                    this.WASMCompiler.module.ptr,
                    arrayToPtr(vtableFuncs).ptr,
                    vtableFuncs.length,
                    vtableType.heapTypeRef,
                );
                this.classVtables.set(type, vtableInstance);
                break;
            }
            case TypeKind.GENERIC:
                /* We treat generic as any for most cases, but for some builtin
                    methods (e.g. Array.push), we want the generic type to be
                    specialized for better performance */
                if (typeArg) {
                    let result: binaryenCAPI.TypeRef;
                    if (typeArg.typeKind === TypeKind.FUNCTION) {
                        result = this.getWASMFuncStructType(typeArg);
                    } else if (typeArg.typeKind === TypeKind.ARRAY) {
                        result = this.getWasmArrayStructType(typeArg);
                    } else {
                        result = this.getWASMType(typeArg);
                    }
                    this.tsType2WASMTypeMap.set(type, result);
                } else {
                    this.tsType2WASMTypeMap.set(type, binaryen.anyref);
                }
                break;
            default:
                break;
        }
    }

    hasHeapType(type: Type): boolean {
        if (
            type.kind === TypeKind.VOID ||
            type.kind === TypeKind.BOOLEAN ||
            type.kind === TypeKind.NUMBER ||
            type.kind === TypeKind.ANY ||
            type.kind === TypeKind.NULL
        ) {
            return false;
        }
        return true;
    }

    getWASMType(
        type: Type,
        infcType = false,
        typeArg: Type | null = null,
    ): binaryenCAPI.TypeRef {
        if (type instanceof TSInterface && !infcType) {
            return this.getInfcTypeRef();
        }
        if (typeArg || !this.tsType2WASMTypeMap.has(type)) {
            this.createWASMType(type, typeArg);
        }
        return this.tsType2WASMTypeMap.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMHeapType(
        type: Type,
        infcType = false,
        typeArg: Type | null = null,
    ): binaryenCAPI.HeapTypeRef {
        assert(this.hasHeapType(type));
        if (type instanceof TSInterface && !infcType) {
            return this.getInfcHeapTypeRef();
        }
        if (typeArg || !this.tsType2WASMHeapTypeMap.has(type)) {
            this.createWASMType(type, typeArg);
        }
        return this.tsType2WASMHeapTypeMap.get(
            type,
        ) as binaryenCAPI.HeapTypeRef;
    }

    getWASMFuncStructType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!this.tsFuncType2WASMStructType.has(type)) {
            this.createWASMType(type);
        }
        return this.tsFuncType2WASMStructType.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMFuncStructHeapType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!this.tsFuncType2WASMStructType.has(type)) {
            this.createWASMType(type);
        }
        return this.tsFuncType2WASMStructHeapType.get(
            type,
        ) as binaryenCAPI.HeapTypeRef;
    }

    private _getWasmArrayStructTypeInfo(type: Type): typeInfo {
        assert(type.typeKind === TypeKind.ARRAY);

        if (this.tsArrayType2WASMTypeInfo.has(type)) {
            return this.tsArrayType2WASMTypeInfo.get(type)!;
        }

        const wasmType = this.getWASMType(type);
        const wasmHeapType = this.getWASMHeapType(type);
        const arrayStructTypeInfo = generateArrayStructTypeInfo({
            typeRef: wasmType,
            heapTypeRef: wasmHeapType,
        });

        this.tsArrayType2WASMTypeInfo.set(type, arrayStructTypeInfo);

        return arrayStructTypeInfo;
    }

    getWasmArrayStructType(type: Type): binaryenCAPI.TypeRef {
        return this._getWasmArrayStructTypeInfo(type).typeRef;
    }

    getWasmArrayStructHeapType(type: Type): binaryenCAPI.TypeRef {
        return this._getWasmArrayStructTypeInfo(type).heapTypeRef;
    }

    getWASMFuncParamType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!this.tsType2WASMTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return this.tsFuncParamType.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMFuncOrignalParamType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!this.tsType2WASMTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return this.tsFuncOriginalParamType.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMFuncReturnType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!this.tsType2WASMTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return this.tsFuncReturnType.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMClassVtableType(type: Type): binaryenCAPI.TypeRef {
        assert(type instanceof TSClass);
        if (!this.tsClassVtableType.has(type)) {
            this.createWASMType(type);
        }
        return this.tsClassVtableType.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMClassVtableHeapType(type: Type): binaryenCAPI.HeapTypeRef {
        assert(type instanceof TSClass);
        if (!this.tsClassVtableHeapType.has(type)) {
            this.createWASMType(type);
        }
        return this.tsClassVtableHeapType.get(type) as binaryenCAPI.HeapTypeRef;
    }

    getWASMClassVtable(type: Type): binaryen.ExpressionRef {
        assert(type.typeKind === TypeKind.CLASS);
        if (!this.classVtables.has(type)) {
            this.createWASMType(type);
        }
        return this.classVtables.get(type) as binaryen.ExpressionRef;
    }

    getWASMClassStaticFieldsType(type: Type): binaryenCAPI.TypeRef {
        if (type.kind !== TypeKind.CLASS) {
            throw new Error(
                `type ${type} is not a class, when calling 'getWASMClassStaticFieldsType'`,
            );
        }
        if (!this.classStaticFieldsType.has(type)) {
            this.createWASMType(type);
        }
        return this.classStaticFieldsType.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMClassStaticFieldsHeapType(type: Type): binaryenCAPI.HeapTypeRef {
        this.getWASMClassStaticFieldsType(type);
        return this.classStaticFieldsHeapType.get(
            type,
        ) as binaryenCAPI.HeapTypeRef;
    }

    getInfcTypeRef(): binaryenCAPI.TypeRef {
        return infcTypeInfo.typeRef;
    }

    getInfcHeapTypeRef(): binaryenCAPI.HeapTypeRef {
        return infcTypeInfo.heapTypeRef;
    }

    private createCustomTypeName(
        name: string,
        heapTypeRef: binaryenCAPI.HeapTypeRef,
    ) {
        binaryenCAPI._BinaryenModuleSetTypeName(
            this.WASMCompiler.module.ptr,
            heapTypeRef,
            this.WASMCompiler.getCString(name),
        );
    }

    private createCustomFieldName(
        name: string,
        heapTypeRef: binaryenCAPI.HeapTypeRef,
        index: number,
    ) {
        binaryenCAPI._BinaryenModuleSetFieldName(
            this.WASMCompiler.module.ptr,
            heapTypeRef,
            index,
            this.WASMCompiler.getCString(name),
        );
    }
}

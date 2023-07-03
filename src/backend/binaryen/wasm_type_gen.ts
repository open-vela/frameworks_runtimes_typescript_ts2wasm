/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
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
import {
    ArrayType,
    ClosureContextType,
    EmptyType,
    FunctionType,
    ObjectType,
    TypeParameterType,
    ValueType,
    ValueTypeKind,
} from '../../semantics/value_types.js';
import { UnimplementError } from '../../error.js';
import {
    MemberModifier,
    MemberType,
    ObjectDescription,
} from '../../semantics/runtime.js';
import { FunctionalFuncs, UtilFuncs, getCString } from './utils.js';
import { BuiltinNames } from '../../../lib/builtin/builtin_name.js';
import { MemberDescription } from '../../semantics/runtime.js';
import { VarValue } from '../../semantics/value.js';

export class WASMTypeGen {
    typeMap: Map<ValueType, binaryenCAPI.TypeRef> = new Map();
    private heapTypeMap: Map<ValueType, binaryenCAPI.HeapTypeRef> = new Map();
    /* For array, we store array's struct type in type map, store array type in oriArrayTypeMap */
    private oriArrayTypeMap: Map<ValueType, binaryenCAPI.TypeRef> = new Map();
    private oriArrayHeapTypeMap: Map<ValueType, binaryenCAPI.HeapTypeRef> =
        new Map();
    /* closure format is : {context: struct{}, funcref: ref $func} */
    private closureStructTypeMap: Map<ValueType, binaryenCAPI.TypeRef> =
        new Map();
    private closureStructHeapTypeMap: Map<ValueType, binaryenCAPI.HeapTypeRef> =
        new Map();
    private funcParamTypesMap: Map<ValueType, binaryenCAPI.TypeRef[]> =
        new Map();
    private funcOriParamTypesMap: Map<ValueType, binaryenCAPI.TypeRef[]> =
        new Map();
    private vtableTypeMap: Map<ValueType, binaryenCAPI.TypeRef> = new Map();
    private vtableHeapTypeMap: Map<ValueType, binaryenCAPI.TypeRef> = new Map();
    private vtableInstMap: Map<ValueType, binaryenCAPI.ExpressionRef> =
        new Map();
    private thisInstMap: Map<ValueType, binaryen.ExpressionRef> = new Map();
    private staticFieldsTypeMap: Map<ValueType, binaryenCAPI.TypeRef> =
        new Map();
    private staticFieldsHeapTypeMap: Map<ValueType, binaryenCAPI.HeapTypeRef> =
        new Map();
    private staticFieldsUpdateMap: Map<ValueType, boolean> = new Map();
    private infcObjTypeMap: Map<ValueType, binaryenCAPI.TypeRef> = new Map();
    private infcObjHeapTypeMap: Map<ValueType, binaryenCAPI.HeapTypeRef> =
        new Map();
    private structHeapTypeCnt = 0;
    private arrayHeapTypeCnt = 0;
    private funcHeapTypeCnt = 0;
    private contextHeapTypeCnt = 0;

    constructor(private wasmComp: WASMGen) {}

    createWASMType(type: ValueType): void {
        if (this.typeMap.has(type)) {
            /* Workaround (array specialize issue): semantic tree may forget to specialize some
                method type, we specialize it in background to fix the
                type, but we may already cached the wasm type for the given
                ArrayType.
            So here we check if the type has type parameter, and ignore
                the cache if it does.
                let a : number[] = []; a.push(10);
            */

            if (!(type as ArrayType).specialTypeArguments?.length) {
                return;
            }
        }
        switch (type.kind) {
            case ValueTypeKind.VOID:
            case ValueTypeKind.BOOLEAN:
            case ValueTypeKind.NUMBER:
            case ValueTypeKind.STRING:
            case ValueTypeKind.RAW_STRING:
            case ValueTypeKind.NULL:
            case ValueTypeKind.UNDEFINED:
            case ValueTypeKind.UNION:
            case ValueTypeKind.ANY:
            case ValueTypeKind.INT:
            case ValueTypeKind.TYPE_PARAMETER:
                this.createWASMBaseType(type);
                break;
            case ValueTypeKind.EMPTY:
                this.createWASMEmptyType(type);
                break;
            case ValueTypeKind.CLOSURECONTEXT:
                this.createWASMContextType(<ClosureContextType>type);
                break;
            case ValueTypeKind.GENERIC:
                this.createWASMGenericType(type);
                break;
            case ValueTypeKind.ARRAY:
                this.createWASMArrayType(<ArrayType>type);
                break;
            case ValueTypeKind.FUNCTION:
                this.createWASMFuncType(<FunctionType>type);
                break;
            case ValueTypeKind.OBJECT:
                this.createWASMObjectType(<ObjectType>type);
                break;
            default:
                throw new UnimplementError(`createWASMType: ${type}`);
        }
    }

    createWASMBaseType(type: ValueType): void {
        if (this.typeMap.has(type)) {
            return;
        }

        switch (type.kind) {
            case ValueTypeKind.VOID:
                this.typeMap.set(type, binaryen.none);
                break;

            case ValueTypeKind.BOOLEAN:
                this.typeMap.set(type, binaryen.i32);
                break;

            case ValueTypeKind.NUMBER:
                this.typeMap.set(type, binaryen.f64);
                break;

            case ValueTypeKind.INT:
                this.typeMap.set(type, binaryen.i32);
                break;

            case ValueTypeKind.RAW_STRING:
            case ValueTypeKind.STRING: {
                this.typeMap.set(type, stringTypeInfo.typeRef);
                this.heapTypeMap.set(type, stringTypeInfo.heapTypeRef);
                this.createCustomTypeName(
                    'string_type',
                    stringTypeInfo.heapTypeRef,
                );
                break;
            }
            /** if type is null, then the value can only be null.
             * We treat it as anyref here since it's nullable */
            case ValueTypeKind.NULL:
            case ValueTypeKind.UNDEFINED:
            case ValueTypeKind.ANY:
            case ValueTypeKind.UNION:
            case ValueTypeKind.TYPE_PARAMETER:
                this.typeMap.set(type, binaryen.anyref);
                break;
            default:
                break;
        }
    }

    createWASMEmptyType(type: EmptyType) {
        this.typeMap.set(type, emptyStructType.typeRef);
        this.heapTypeMap.set(type, emptyStructType.heapTypeRef);
    }

    createWASMContextType(type: ClosureContextType) {
        let typeRef: binaryenCAPI.TypeRef;
        let heapTypeRef: binaryenCAPI.HeapTypeRef;

        const parentTypeRef = type.parentCtxType
            ? this.getWASMValueType(type.parentCtxType)
            : emptyStructType.typeRef;
        const parentHeapTypeRef = type.parentCtxType
            ? this.getWASMValueHeapType(type.parentCtxType)
            : emptyStructType.heapTypeRef;

        if (type.freeVarTypeList.length > 0) {
            const contextStructLength = type.freeVarTypeList.length + 1;
            const contextStructTypeRefArray: binaryenCAPI.TypeRef[] = new Array(
                contextStructLength,
            );
            contextStructTypeRefArray[0] = parentTypeRef;
            for (let i = 0; i < type.freeVarTypeList.length; i++) {
                const freeVarTypeRef = this.getWASMValueType(
                    type.freeVarTypeList[i],
                );
                contextStructTypeRefArray[i + 1] = freeVarTypeRef;
            }

            const fieldPackedTypesList: binaryenCAPI.PackedType[] = new Array(
                contextStructLength,
            ).fill(Pakced.Not);
            const fieldMutablesList: boolean[] = new Array(
                contextStructLength,
            ).fill(true);
            const contextStructTypeInfo = initStructType(
                contextStructTypeRefArray,
                fieldPackedTypesList,
                fieldMutablesList,
                contextStructLength,
                true,
            );
            typeRef = contextStructTypeInfo.typeRef;
            heapTypeRef = contextStructTypeInfo.heapTypeRef;
            this.createCustomTypeName(
                `context${this.contextHeapTypeCnt++}`,
                heapTypeRef,
            );
        } else {
            typeRef = parentTypeRef;
            heapTypeRef = parentHeapTypeRef;
        }

        this.typeMap.set(type, typeRef);
        this.heapTypeMap.set(type, heapTypeRef);
    }

    createWASMFuncType(funcType: FunctionType) {
        const resultWASMType = this.getWASMValueType(funcType.returnType);
        const paramTypes = funcType.argumentsType;
        const paramWASMTypes = new Array<binaryenCAPI.TypeRef>();
        const oriParamWASMTypes = new Array<binaryenCAPI.TypeRef>();
        /* add env params */
        for (let i = 0; i < funcType.envParamLen; i++) {
            paramWASMTypes.push(emptyStructType.typeRef);
        }
        for (let i = 0; i < paramTypes.length; ++i) {
            const paramTypeRef = this.getWASMValueType(paramTypes[i]);
            paramWASMTypes.push(paramTypeRef);
            oriParamWASMTypes.push(paramTypeRef);
        }
        /* record original param wasm type */
        this.funcParamTypesMap.set(funcType, paramWASMTypes);
        this.funcOriParamTypesMap.set(funcType, oriParamWASMTypes);

        const signature = createSignatureTypeRefAndHeapTypeRef(
            paramWASMTypes,
            resultWASMType,
        );
        this.createCustomTypeName(
            `function${this.funcHeapTypeCnt}`,
            signature.heapTypeRef,
        );
        this.typeMap.set(funcType, signature.typeRef);
        this.heapTypeMap.set(funcType, signature.heapTypeRef);
        /* create closure type */
        const closureStructType = initStructType(
            [emptyStructType.typeRef, signature.typeRef],
            [Pakced.Not, Pakced.Not],
            [true, false],
            2,
            true,
        );
        this.createCustomTypeName(
            `closure${this.funcHeapTypeCnt++}`,
            closureStructType.heapTypeRef,
        );
        this.closureStructTypeMap.set(funcType, closureStructType.typeRef);
        this.closureStructHeapTypeMap.set(
            funcType,
            closureStructType.heapTypeRef,
        );
    }

    createWASMArrayType(arrayType: ArrayType) {
        let elemType = arrayType.element;
        if (
            arrayType.typeId === -1 &&
            arrayType.specialTypeArguments &&
            arrayType.specialTypeArguments.length > 0 &&
            !(arrayType.specialTypeArguments[0] instanceof TypeParameterType)
        ) {
            /* get specialTypeArgument of generic type */
            elemType = arrayType.specialTypeArguments![0];
        }
        const elemTypeRef = this.getWASMValueType(elemType);
        const arrayTypeInfo = initArrayType(
            elemTypeRef,
            Pakced.Not,
            true,
            true,
        );
        this.oriArrayTypeMap.set(arrayType, arrayTypeInfo.typeRef);
        this.oriArrayHeapTypeMap.set(arrayType, arrayTypeInfo.heapTypeRef);
        const arrayStructTypeInfo = generateArrayStructTypeInfo(arrayTypeInfo);
        this.createCustomTypeName(
            `array-struct${this.arrayHeapTypeCnt++}`,
            arrayStructTypeInfo.heapTypeRef,
        );
        this.typeMap.set(arrayType, arrayStructTypeInfo.typeRef);
        this.heapTypeMap.set(arrayType, arrayStructTypeInfo.heapTypeRef);
    }

    createWASMObjectType(type: ObjectType) {
        const metaInfo = type.meta;
        if (metaInfo.isInterface) {
            this.createWASMInfcType(type);
        } else {
            this.createWASMClassType(type);
            if (
                this.staticFieldsUpdateMap.has(type) &&
                !this.staticFieldsUpdateMap.get(type)
            ) {
                this.updateStaticFields(type);
            }
        }
    }

    createWASMInfcType(type: ObjectType) {
        this.typeMap.set(type, infcTypeInfo.typeRef);
        this.heapTypeMap.set(type, infcTypeInfo.heapTypeRef);
    }

    getObjSpecialSuffix(type: ArrayType) {
        let specialType: ValueType | undefined = undefined;
        if (type.specialTypeArguments && type.specialTypeArguments.length > 0) {
            /* ArrayType only has one specialTypeArgument */
            specialType = type.specialTypeArguments[0];
        }
        let methodSuffix = '';
        if (specialType) {
            switch (specialType.kind) {
                case ValueTypeKind.NUMBER:
                    methodSuffix = '_f64';
                    break;
                case ValueTypeKind.INT:
                case ValueTypeKind.BOOLEAN:
                    methodSuffix = '_i32';
                    break;
                default:
                    methodSuffix = '_anyref';
            }
        }
        return methodSuffix;
    }

    createWASMClassType(type: ObjectType, isInfc = false) {
        const metaInfo = type.meta;
        /* 1. traverse members */
        /* currently vtable stores all member functions (without constructor) */
        const methodTypeRefs = new Array<binaryenCAPI.TypeRef>();
        const vtableFuncs = new Array<binaryen.ExpressionRef>();
        const fieldTypeRefs = new Array<binaryenCAPI.TypeRef>();
        const fieldMuts = new Array<boolean>();
        const staticFieldsTypeRefs = new Array<binaryenCAPI.TypeRef>();
        const classInitValues = new Array<binaryen.ExpressionRef>();
        for (const member of metaInfo.members) {
            if (member.type === MemberType.METHOD) {
                let methodMangledName = UtilFuncs.getFuncName(
                    metaInfo.name,
                    member.name,
                );
                if (!metaInfo.isLiteral) {
                    methodMangledName = this.wasmComp.getMethodMangledName(
                        member,
                        metaInfo,
                    );
                    if (
                        BuiltinNames.genericBuiltinMethods.includes(
                            methodMangledName,
                        )
                    ) {
                        continue;
                    }
                }
                const methodTypeRef = this.getWASMType(member.valueType);
                methodTypeRefs.push(methodTypeRef);
                vtableFuncs.push(
                    this.wasmComp.module.ref.func(
                        methodMangledName,
                        methodTypeRef,
                    ),
                );
            } else if (member.type === MemberType.ACCESSOR) {
                /* Put accessor to vtable, getter first */
                if (member.hasGetter) {
                    let methodMangledName = (member.getter as VarValue)
                        .index as string;
                    if (!metaInfo.isLiteral) {
                        methodMangledName = this.wasmComp.getMethodMangledName(
                            member,
                            metaInfo,
                            0,
                        );
                    }
                    const methodType = this.getWASMType(
                        (member.getter as VarValue).type,
                    );
                    methodTypeRefs.push(methodType);
                    vtableFuncs.push(
                        this.wasmComp.module.ref.func(
                            methodMangledName,
                            methodType,
                        ),
                    );
                }

                if (member.hasSetter) {
                    let methodMangledName = (member.setter as VarValue)
                        .index as string;
                    if (!metaInfo.isLiteral) {
                        methodMangledName = this.wasmComp.getMethodMangledName(
                            member,
                            metaInfo,
                            1,
                        );
                    }
                    const methodType = this.getWASMType(
                        (member.setter as VarValue).type,
                    );
                    methodTypeRefs.push(methodType);
                    vtableFuncs.push(
                        this.wasmComp.module.ref.func(
                            methodMangledName,
                            methodType,
                        ),
                    );
                }
            } else if (member.type === MemberType.FIELD) {
                const defaultValue = FunctionalFuncs.getVarDefaultValue(
                    this.wasmComp.module,
                    member.valueType.kind,
                );
                if (member.isStaic) {
                    staticFieldsTypeRefs.push(
                        this.getWASMType(member.valueType),
                    );
                    /* First, give a default value based on type, then update value */
                } else {
                    fieldTypeRefs.push(this.getWASMValueType(member.valueType));
                    if ((member.modifiers & MemberModifier.READONLY) !== 0) {
                        fieldMuts.push(false);
                    } else {
                        fieldMuts.push(true);
                    }
                    classInitValues.push(defaultValue);
                }
            }
        }
        const methodPacked = new Array<binaryenCAPI.PackedType>(
            methodTypeRefs.length,
        ).fill(Pakced.Not);
        const methodMuts = new Array<boolean>(methodTypeRefs.length).fill(
            false,
        );
        const staticPacked = new Array<binaryenCAPI.PackedType>(
            staticFieldsTypeRefs.length,
        ).fill(Pakced.Not);
        const staticMuts = new Array<boolean>(staticFieldsTypeRefs.length).fill(
            true,
        );

        /* 2. generate needed structs */
        /* vtable type */
        const vtableType = initStructType(
            methodTypeRefs,
            methodPacked,
            methodMuts,
            methodTypeRefs.length,
            true,
            type.super ? this.getWASMVtableHeapType(type.super) : undefined,
        );
        this.createCustomTypeName(
            `vt-struct${this.structHeapTypeCnt++}`,
            vtableType.heapTypeRef,
        );
        /* class type */
        fieldTypeRefs.unshift(vtableType.typeRef);
        fieldMuts.unshift(false);
        const fieldPacked = new Array<binaryenCAPI.PackedType>(
            fieldTypeRefs.length,
        ).fill(Pakced.Not);
        const wasmClassType = initStructType(
            fieldTypeRefs,
            fieldPacked,
            fieldMuts,
            fieldTypeRefs.length,
            true,
            type.super ? this.getWASMObjOriHeapType(type.super) : undefined,
        );
        if (wasmClassType.heapTypeRef === 0) {
            throw Error(`failed to create class type for ${type.meta.name}`);
        }

        this.createCustomTypeName(
            `cls-struct${this.structHeapTypeCnt++}`,
            wasmClassType.heapTypeRef,
        );
        /* staic fields struct type */
        if (staticFieldsTypeRefs.length > 0) {
            const staticStructType = initStructType(
                staticFieldsTypeRefs,
                staticPacked,
                staticMuts,
                staticFieldsTypeRefs.length,
                true,
            );
            this.createCustomTypeName(
                `static-struct${this.structHeapTypeCnt++}`,
                staticStructType.heapTypeRef,
            );
            const name = type.meta.name + '|static_fields';
            /** clazz meta */
            if (name.startsWith('@')) {
                binaryenCAPI._BinaryenAddGlobal(
                    this.wasmComp.module.ptr,
                    getCString(name),
                    staticStructType.typeRef,
                    true,
                    this.wasmComp.module.ref.null(
                        binaryenCAPI._BinaryenTypeStructref(),
                    ),
                );
            }
            this.staticFieldsTypeMap.set(type, staticStructType.typeRef);
            this.staticFieldsHeapTypeMap.set(
                type,
                staticStructType.heapTypeRef,
            );
            this.staticFieldsUpdateMap.set(type, false);
        }
        /* vtable instance */
        const vtableInstance = binaryenCAPI._BinaryenStructNew(
            this.wasmComp.module.ptr,
            arrayToPtr(vtableFuncs).ptr,
            vtableFuncs.length,
            vtableType.heapTypeRef,
        );
        /* this instance */
        classInitValues.unshift(vtableInstance);
        const thisArg = binaryenCAPI._BinaryenStructNew(
            this.wasmComp.module.ptr,
            arrayToPtr(classInitValues).ptr,
            classInitValues.length,
            wasmClassType.heapTypeRef,
        );
        /* put into map */
        if (isInfc) {
            this.infcObjTypeMap.set(type, wasmClassType.typeRef);
            this.infcObjHeapTypeMap.set(type, wasmClassType.heapTypeRef);
        } else {
            this.vtableTypeMap.set(type, vtableType.typeRef);
            this.vtableHeapTypeMap.set(type, vtableType.heapTypeRef);
            this.typeMap.set(type, wasmClassType.typeRef);
            this.heapTypeMap.set(type, wasmClassType.heapTypeRef);
            this.vtableInstMap.set(type, vtableInstance);
            this.thisInstMap.set(type, thisArg);
        }
    }

    createWASMGenericType(type: ValueType, typeArg: ValueType | null = null) {
        /* We treat generic as any for most cases, but for some builtin
        methods (e.g. Array.push), we want the generic type to be
        specialized for better performance */
        if (typeArg) {
            const result: binaryenCAPI.TypeRef = this.getWASMValueType(type);
            this.typeMap.set(type, result);
        } else {
            this.typeMap.set(type, binaryen.anyref);
        }
    }

    hasHeapType(type: ValueType): boolean {
        if (
            type.kind === ValueTypeKind.VOID ||
            type.kind === ValueTypeKind.BOOLEAN ||
            type.kind === ValueTypeKind.NUMBER ||
            type.kind === ValueTypeKind.ANY ||
            type.kind === ValueTypeKind.NULL
        ) {
            return false;
        }
        return true;
    }

    getWASMType(type: ValueType): binaryenCAPI.TypeRef {
        if (!this.typeMap.has(type)) {
            this.createWASMType(type);
        }
        return this.typeMap.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMHeapType(type: ValueType): binaryenCAPI.HeapTypeRef {
        assert(this.hasHeapType(type), `${type} doesn't have heap type`);
        if (!this.heapTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return this.heapTypeMap.get(type) as binaryenCAPI.HeapTypeRef;
    }

    getWASMValueType(type: ValueType): binaryenCAPI.TypeRef {
        if (!this.typeMap.has(type)) {
            this.createWASMType(type);
        }
        if (type instanceof FunctionType) {
            return this.closureStructTypeMap.get(type) as binaryenCAPI.TypeRef;
        } else {
            return this.typeMap.get(type) as binaryenCAPI.TypeRef;
        }
    }

    getWASMValueHeapType(type: ValueType): binaryenCAPI.HeapTypeRef {
        if (!this.typeMap.has(type)) {
            this.createWASMType(type);
        }
        if (type instanceof FunctionType) {
            return this.closureStructHeapTypeMap.get(
                type,
            ) as binaryenCAPI.HeapTypeRef;
        } else {
            return this.heapTypeMap.get(type) as binaryenCAPI.HeapTypeRef;
        }
    }

    getWASMFuncParamTypes(type: ValueType): binaryenCAPI.TypeRef[] {
        if (!this.funcParamTypesMap.has(type)) {
            this.createWASMType(type);
        }
        return this.funcParamTypesMap.get(type)!;
    }

    getWASMFuncOriParamTypes(type: ValueType): binaryenCAPI.TypeRef[] {
        if (!this.funcOriParamTypesMap.has(type)) {
            this.createWASMType(type);
        }
        return this.funcOriParamTypesMap.get(type)!;
    }

    getWASMArrayOriType(type: ValueType): binaryenCAPI.TypeRef {
        if (!this.oriArrayTypeMap.has(type)) {
            this.createWASMType(type);
        }
        /* Workaround (array specialize issue): semantic tree may forget to specialize some
            method type, we specialize it in background to fix the
            type, but we may already cached the wasm type for the given
            ArrayType.
           So here we check if the type has type parameter, and ignore
            the cache if it does.
            let a : number[] = []; a.push(10);
        */

        if ((type as ArrayType).specialTypeArguments?.length) {
            this.createWASMType(type);
        }

        return this.oriArrayTypeMap.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMArrayOriHeapType(type: ValueType): binaryenCAPI.HeapTypeRef {
        if (!this.oriArrayHeapTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return this.oriArrayHeapTypeMap.get(type) as binaryenCAPI.HeapTypeRef;
    }

    getWASMObjOriType(type: ValueType): binaryenCAPI.TypeRef {
        if (!this.infcObjTypeMap.has(type)) {
            this.createWASMClassType(type as ObjectType, true);
        }
        return this.infcObjTypeMap.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMObjOriHeapType(type: ValueType): binaryenCAPI.HeapTypeRef {
        if (!this.infcObjHeapTypeMap.has(type)) {
            this.createWASMClassType(type as ObjectType, true);
        }
        return this.infcObjHeapTypeMap.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMVtableType(type: ValueType): binaryenCAPI.TypeRef {
        if (!this.vtableTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return this.vtableTypeMap.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMVtableHeapType(type: ValueType): binaryenCAPI.HeapTypeRef {
        if (!this.vtableHeapTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return this.vtableHeapTypeMap.get(type) as binaryenCAPI.HeapTypeRef;
    }

    getWASMStaticFieldsType(type: ValueType): binaryenCAPI.TypeRef {
        if (!this.staticFieldsTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return this.staticFieldsTypeMap.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMStaticFieldsHeapType(type: ValueType): binaryenCAPI.HeapTypeRef {
        if (!this.staticFieldsHeapTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return this.staticFieldsHeapTypeMap.get(
            type,
        ) as binaryenCAPI.HeapTypeRef;
    }

    getWASMVtableInst(type: ValueType): binaryen.ExpressionRef {
        if (!this.vtableInstMap.has(type)) {
            this.createWASMObjectType(type as ObjectType);
        }
        return this.vtableInstMap.get(type) as binaryen.ExpressionRef;
    }

    getWASMThisInst(type: ValueType): binaryen.ExpressionRef {
        if (!this.thisInstMap.has(type)) {
            this.createWASMType(type);
        }
        return this.thisInstMap.get(type) as binaryen.ExpressionRef;
    }

    updateStaticFields(type: ObjectType) {
        const metaInfo = type.meta;
        const name = metaInfo.name + '|static_fields';
        if (!name.startsWith('@')) {
            return;
        }
        this.wasmComp.globalInitArray.push(
            binaryenCAPI._BinaryenGlobalSet(
                this.wasmComp.module.ptr,
                getCString(name),
                binaryenCAPI._BinaryenStructNew(
                    this.wasmComp.module.ptr,
                    arrayToPtr([]).ptr,
                    0,
                    this.getWASMStaticFieldsHeapType(type),
                ),
            ),
        );
        let staticFieldIdx = 0;
        const staticFields = binaryenCAPI._BinaryenGlobalGet(
            this.wasmComp.module.ptr,
            getCString(name),
            this.getWASMStaticFieldsType(type),
        );
        for (const member of metaInfo.members) {
            if (member.type === MemberType.FIELD && member.isStaic) {
                const initValue = member.staticFieldInitValue!;
                const memberType = member.valueType;
                const valueType = initValue.type;
                /** for Map/Set, it's any type */
                let isInitFallBackType = false;
                if (valueType instanceof ObjectType) {
                    const name = valueType.meta.name;
                    isInitFallBackType =
                        name == BuiltinNames.MAP || name == BuiltinNames.SET;
                }
                let isMemFallBackType = false;
                if (memberType instanceof ObjectType) {
                    const name = memberType.meta.name;
                    isMemFallBackType =
                        name == BuiltinNames.MAP || name == BuiltinNames.SET;
                }
                let wasmInitvalue =
                    this.wasmComp.wasmExprComp.wasmExprGen(initValue);
                if (
                    memberType.kind === ValueTypeKind.ANY &&
                    valueType.kind !== ValueTypeKind.ANY &&
                    !isInitFallBackType
                ) {
                    wasmInitvalue = FunctionalFuncs.boxToAny(
                        this.wasmComp.module,
                        wasmInitvalue,
                        valueType.kind,
                        initValue.kind,
                    );
                }
                if (
                    memberType.kind !== ValueTypeKind.ANY &&
                    valueType.kind === ValueTypeKind.ANY &&
                    !isMemFallBackType
                ) {
                    wasmInitvalue = FunctionalFuncs.unboxAny(
                        this.wasmComp.module,
                        wasmInitvalue,
                        valueType.kind,
                        this.getWASMType(valueType),
                    );
                }
                const res = binaryenCAPI._BinaryenStructSet(
                    this.wasmComp.module.ptr,
                    staticFieldIdx,
                    staticFields,
                    wasmInitvalue,
                );
                this.wasmComp.globalInitArray.push(res);
                staticFieldIdx++;
            }
        }
        this.staticFieldsUpdateMap.set(type, true);
    }

    private createCustomTypeName(
        name: string,
        heapTypeRef: binaryenCAPI.HeapTypeRef,
    ) {
        binaryenCAPI._BinaryenModuleSetTypeName(
            this.wasmComp.module.ptr,
            heapTypeRef,
            getCString(name),
        );
    }

    private createCustomFieldName(
        name: string,
        heapTypeRef: binaryenCAPI.HeapTypeRef,
        index: number,
    ) {
        binaryenCAPI._BinaryenModuleSetFieldName(
            this.wasmComp.module.ptr,
            heapTypeRef,
            index,
            getCString(name),
        );
    }
}

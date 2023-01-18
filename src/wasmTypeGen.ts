import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import { TSArray, TSClass, TSFunction, Type, TypeKind } from './type.js';
import {
    arrayToPtr,
    emptyStructType,
    initArrayType,
    initStructType,
    createSignatureTypeRefAndHeapTypeRef,
} from './glue/transform.js';
import { assert } from 'console';
import { stringTypeInfo } from './glue/packType.js';
import { WASMGen } from './wasmGen.js';

const typeNotPacked = binaryenCAPI._BinaryenPackedTypeNotPacked();
export class WASMTypeGen {
    private static tsType2WASMTypeMap: Map<Type, binaryenCAPI.TypeRef> =
        new Map();
    private static tsType2WASMHeapTypeMap: Map<Type, binaryenCAPI.HeapTypeRef> =
        new Map();
    // the format is : {context: struct{}, funcref: ref $func}
    private static tsFuncType2WASMStructType: Map<Type, binaryenCAPI.TypeRef> =
        new Map();
    private static tsFuncType2WASMStructHeapType: Map<
        Type,
        binaryenCAPI.HeapTypeRef
    > = new Map();
    private static tsFuncParamType: Map<Type, binaryenCAPI.TypeRef> = new Map();
    private static tsFuncReturnType: Map<Type, binaryenCAPI.TypeRef> =
        new Map();
    private static tsClassVtableType: Map<Type, binaryenCAPI.TypeRef> =
        new Map();
    private static tsClassVtableHeapType: Map<Type, binaryenCAPI.TypeRef> =
        new Map();

    /* not contain context struct:
      (i: number) ==> (f64) (result none) rather than (ref{}, f64)(result none)
    */
    private static tsFuncOriginalParamType: Map<Type, binaryenCAPI.TypeRef> =
        new Map();

    private static classVtables: Map<Type, binaryenCAPI.ExpressionRef> =
        new Map();

    constructor(private WASMCompiler: WASMGen) {}

    createWASMType(type: Type): void {
        if (WASMTypeGen.tsType2WASMTypeMap.has(type)) {
            return;
        }
        switch (type.typeKind) {
            case TypeKind.DYNCONTEXTTYPE:
                WASMTypeGen.tsType2WASMTypeMap.set(type, binaryen.i64);
                break;
            case TypeKind.VOID:
                WASMTypeGen.tsType2WASMTypeMap.set(type, binaryen.none);
                break;
            case TypeKind.BOOLEAN:
                WASMTypeGen.tsType2WASMTypeMap.set(type, binaryen.i32);
                break;
            case TypeKind.NUMBER:
                WASMTypeGen.tsType2WASMTypeMap.set(type, binaryen.f64);
                break;
            case TypeKind.STRING: {
                WASMTypeGen.tsType2WASMTypeMap.set(
                    type,
                    stringTypeInfo.typeRef,
                );
                WASMTypeGen.tsType2WASMHeapTypeMap.set(
                    type,
                    stringTypeInfo.heapTypeRef,
                );
                break;
            }
            case TypeKind.ANY: {
                WASMTypeGen.tsType2WASMTypeMap.set(type, binaryen.anyref);
                break;
            }
            case TypeKind.ARRAY: {
                const arrayType = <TSArray>type;
                const elemType = arrayType.elementType;
                let elemTypeRef = this.getWASMType(elemType);
                if (elemType.kind === TypeKind.FUNCTION) {
                    elemTypeRef = this.getWASMFuncStructType(elemType);
                }
                const arrayTypeInfo = initArrayType(
                    elemTypeRef,
                    binaryenCAPI._BinaryenPackedTypeNotPacked(),
                    true,
                    true,
                );
                WASMTypeGen.tsType2WASMTypeMap.set(type, arrayTypeInfo.typeRef);
                WASMTypeGen.tsType2WASMHeapTypeMap.set(
                    type,
                    arrayTypeInfo.heapTypeRef,
                );
                break;
            }
            case TypeKind.FUNCTION: {
                const funcType = <TSFunction>type;
                const paramTypes = funcType.getParamTypes();
                const paramWASMTypes = new Array<binaryenCAPI.TypeRef>(
                    paramTypes.length + 1,
                );
                paramWASMTypes[0] = emptyStructType.typeRef;
                for (let i = 0; i < paramTypes.length; ++i) {
                    if (paramTypes[i].typeKind === TypeKind.FUNCTION) {
                        paramWASMTypes[i + 1] = this.getWASMFuncStructType(
                            paramTypes[i],
                        );
                    } else {
                        paramWASMTypes[i + 1] = this.getWASMType(paramTypes[i]);
                    }
                }
                WASMTypeGen.tsFuncParamType.set(
                    type,
                    binaryen.createType(paramWASMTypes),
                );
                WASMTypeGen.tsFuncOriginalParamType.set(
                    type,
                    binaryen.createType(paramWASMTypes.slice(1)),
                );
                let resultWASMType = this.getWASMType(funcType.returnType);
                if (funcType.returnType.typeKind === TypeKind.FUNCTION) {
                    resultWASMType = this.getWASMFuncStructType(
                        funcType.returnType,
                    );
                }
                WASMTypeGen.tsFuncReturnType.set(type, resultWASMType);
                const signature = createSignatureTypeRefAndHeapTypeRef(
                    paramWASMTypes,
                    resultWASMType,
                );
                WASMTypeGen.tsType2WASMTypeMap.set(type, signature.typeRef);
                WASMTypeGen.tsType2WASMHeapTypeMap.set(
                    type,
                    signature.heapTypeRef,
                );
                const funcStructType = initStructType(
                    [emptyStructType.typeRef, signature.typeRef],
                    [typeNotPacked, typeNotPacked],
                    [0, 0],
                    2,
                    true,
                );
                WASMTypeGen.tsFuncType2WASMStructType.set(
                    type,
                    funcStructType.typeRef,
                );
                WASMTypeGen.tsFuncType2WASMStructHeapType.set(
                    type,
                    funcStructType.heapTypeRef,
                );
                break;
            }
            case TypeKind.CLASS: {
                const tsClassType = <TSClass>type;
                // 1. add vtable
                /* currently vtable stores all member functions(without constructor) */
                const wasmFuncTypes = new Array<binaryenCAPI.TypeRef>();
                const vtableFuncs = new Array<binaryen.ExpressionRef>();
                for (const method of tsClassType.memberFuncs) {
                    wasmFuncTypes.push(this.getWASMType(method.type));
                    const modifier = method.isSetter
                        ? '_set_'
                        : method.isGetter
                        ? '_get_'
                        : '_';
                    if (
                        tsClassType.overrideOrOwnMethods.has(
                            '_set_' + method.name,
                        ) ||
                        tsClassType.overrideOrOwnMethods.has(
                            '_get_' + method.name,
                        ) ||
                        tsClassType.overrideOrOwnMethods.has(method.name)
                    ) {
                        vtableFuncs.push(
                            this.WASMCompiler.module.ref.func(
                                tsClassType.className + modifier + method.name,
                                wasmFuncTypes[wasmFuncTypes.length - 1],
                            ),
                        );
                    } else {
                        /* base class must exist in this condition */
                        const baseClassType = <TSClass>tsClassType.getBase();
                        vtableFuncs.push(
                            this.WASMCompiler.module.ref.func(
                                baseClassType.className +
                                    modifier +
                                    method.name,
                                wasmFuncTypes[wasmFuncTypes.length - 1],
                            ),
                        );
                    }
                }
                let packed = new Array<binaryenCAPI.PackedType>(
                    wasmFuncTypes.length,
                ).fill(typeNotPacked);
                let muts = new Array<number>(wasmFuncTypes.length).fill(0);
                const vtableType = initStructType(
                    wasmFuncTypes,
                    packed,
                    muts,
                    wasmFuncTypes.length,
                    true,
                );
                const vtableInstance = binaryenCAPI._BinaryenStructNew(
                    this.WASMCompiler.module.ptr,
                    arrayToPtr(vtableFuncs).ptr,
                    vtableFuncs.length,
                    vtableType.heapTypeRef,
                );
                WASMTypeGen.tsClassVtableType.set(type, vtableType.typeRef);
                WASMTypeGen.tsClassVtableHeapType.set(
                    type,
                    vtableType.heapTypeRef,
                );
                WASMTypeGen.classVtables.set(type, vtableInstance);

                // 2. add vtable and fields
                const wasmFieldTypes = new Array<binaryenCAPI.TypeRef>();
                /* vtable + fields */
                muts = new Array<number>(tsClassType.fields.length + 1);
                muts[0] = 0;
                packed = new Array<binaryenCAPI.PackedType>(
                    tsClassType.fields.length + 1,
                ).fill(typeNotPacked);
                wasmFieldTypes[0] = vtableType.typeRef;
                for (let i = 0; i !== tsClassType.fields.length; ++i) {
                    const field = tsClassType.fields[i];
                    wasmFieldTypes.push(this.getWASMType(field.type));
                    if (field.modifier === 'readonly') {
                        muts[i + 1] = 0;
                    } else {
                        muts[i + 1] = 1;
                    }
                }

                // 3. generate class wasm type
                const wasmClassType = initStructType(
                    wasmFieldTypes,
                    packed,
                    muts,
                    wasmFieldTypes.length,
                    true,
                );
                WASMTypeGen.tsType2WASMTypeMap.set(type, wasmClassType.typeRef);
                WASMTypeGen.tsType2WASMHeapTypeMap.set(
                    type,
                    wasmClassType.heapTypeRef,
                );
                break;
            }
            default:
                break;
        }
    }

    hasHeapType(type: Type): boolean {
        if (
            type.kind === TypeKind.VOID ||
            type.kind === TypeKind.BOOLEAN ||
            type.kind === TypeKind.NUMBER
        ) {
            return false;
        }
        return true;
    }

    getWASMType(type: Type): binaryenCAPI.TypeRef {
        if (!WASMTypeGen.tsType2WASMTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsType2WASMTypeMap.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMHeapType(type: Type): binaryenCAPI.HeapTypeRef {
        assert(this.hasHeapType(type));
        if (!WASMTypeGen.tsType2WASMHeapTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsType2WASMHeapTypeMap.get(
            type,
        ) as binaryenCAPI.HeapTypeRef;
    }

    getWASMFuncStructType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!WASMTypeGen.tsFuncType2WASMStructType.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsFuncType2WASMStructType.get(
            type,
        ) as binaryenCAPI.TypeRef;
    }

    getWASMFuncStructHeapType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!WASMTypeGen.tsFuncType2WASMStructType.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsFuncType2WASMStructHeapType.get(
            type,
        ) as binaryenCAPI.HeapTypeRef;
    }

    getWASMFuncParamType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!WASMTypeGen.tsType2WASMTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsFuncParamType.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMFuncOrignalParamType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!WASMTypeGen.tsType2WASMTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsFuncOriginalParamType.get(
            type,
        ) as binaryenCAPI.TypeRef;
    }

    getWASMFuncReturnType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!WASMTypeGen.tsType2WASMTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsFuncReturnType.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMClassVtableType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.CLASS);
        if (!WASMTypeGen.tsFuncType2WASMStructType.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsClassVtableType.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMClassVtableHeapType(type: Type): binaryenCAPI.HeapTypeRef {
        assert(type.typeKind === TypeKind.CLASS);
        if (!WASMTypeGen.tsFuncType2WASMStructType.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsClassVtableHeapType.get(
            type,
        ) as binaryenCAPI.HeapTypeRef;
    }

    getWASMClassVtable(type: Type): binaryen.ExpressionRef {
        assert(type.typeKind === TypeKind.CLASS);
        return WASMTypeGen.classVtables.get(type) as binaryen.ExpressionRef;
    }
}

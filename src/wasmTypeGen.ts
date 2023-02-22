import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import {
    FunctionKind,
    getMethodPrefix,
    TSArray,
    TSClass,
    TSFunction,
    Type,
    TypeKind,
} from './type.js';
import {
    arrayToPtr,
    emptyStructType,
    initArrayType,
    initStructType,
    createSignatureTypeRefAndHeapTypeRef,
} from './glue/transform.js';
import { assert } from 'console';
import { infcTypeInfo, stringTypeInfo } from './glue/packType.js';
import { WASMGen } from './wasmGen.js';
import { dyntype } from '../lib/dyntype/utils.js';

const typeNotPacked = binaryenCAPI._BinaryenPackedTypeNotPacked();
export class WASMTypeGen {
    tsType2WASMTypeMap: Map<Type, binaryenCAPI.TypeRef> = new Map();
    private tsType2WASMHeapTypeMap: Map<Type, binaryenCAPI.HeapTypeRef> =
        new Map();
    // the format is : {context: struct{}, funcref: ref $func}
    private tsFuncType2WASMStructType: Map<Type, binaryenCAPI.TypeRef> =
        new Map();
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

    constructor(private WASMCompiler: WASMGen) {}

    createWASMType(type: Type): void {
        if (this.tsType2WASMTypeMap.has(type)) {
            return;
        }
        switch (type.typeKind) {
            case TypeKind.DYNCONTEXTTYPE:
                this.tsType2WASMTypeMap.set(type, dyntype.dyn_ctx_t);
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
                break;
            }
            case TypeKind.ANY: {
                this.tsType2WASMTypeMap.set(type, binaryen.anyref);
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

                /* First parameter is closure context */
                paramWASMTypes.push(emptyStructType.typeRef);

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
                    } else {
                        paramWASMTypes.push(this.getWASMType(paramTypes[i]));
                    }
                }
                this.tsFuncParamType.set(
                    type,
                    binaryen.createType(paramWASMTypes),
                );
                this.tsFuncOriginalParamType.set(
                    type,
                    binaryen.createType(paramWASMTypes.slice(1)),
                );
                let resultWASMType = this.getWASMType(funcType.returnType);
                if (funcType.returnType.typeKind === TypeKind.FUNCTION) {
                    resultWASMType = this.getWASMFuncStructType(
                        funcType.returnType,
                    );
                }
                this.tsFuncReturnType.set(type, resultWASMType);
                const signature = createSignatureTypeRefAndHeapTypeRef(
                    paramWASMTypes,
                    resultWASMType,
                );
                this.tsType2WASMTypeMap.set(type, signature.typeRef);
                this.tsType2WASMHeapTypeMap.set(type, signature.heapTypeRef);
                const funcStructType = initStructType(
                    [emptyStructType.typeRef, signature.typeRef],
                    [typeNotPacked, typeNotPacked],
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
                    const nameWithPrefix =
                        getMethodPrefix(method.type.funcKind) + method.name;
                    if (tsClassType.overrideOrOwnMethods.has(nameWithPrefix)) {
                        vtableFuncs.push(
                            this.WASMCompiler.module.ref.func(
                                tsClassType.mangledName + '|' + nameWithPrefix,
                                wasmFuncTypes[wasmFuncTypes.length - 1],
                            ),
                        );
                    } else {
                        /* base class must exist in this condition */
                        const baseClassType = <TSClass>tsClassType.getBase();
                        vtableFuncs.push(
                            this.WASMCompiler.module.ref.func(
                                baseClassType.mangledName +
                                    '|' +
                                    nameWithPrefix,
                                wasmFuncTypes[wasmFuncTypes.length - 1],
                            ),
                        );
                    }
                }
                let packed = new Array<binaryenCAPI.PackedType>(
                    wasmFuncTypes.length,
                ).fill(typeNotPacked);
                let muts = new Array<boolean>(wasmFuncTypes.length).fill(false);
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
                this.tsClassVtableType.set(type, vtableType.typeRef);
                this.tsClassVtableHeapType.set(type, vtableType.heapTypeRef);
                this.classVtables.set(type, vtableInstance);

                // 2. add vtable and fields
                const wasmFieldTypes = new Array<binaryenCAPI.TypeRef>();
                /* vtable + fields */
                muts = new Array<boolean>(tsClassType.fields.length + 1);
                muts[0] = false;
                packed = new Array<binaryenCAPI.PackedType>(
                    tsClassType.fields.length + 1,
                ).fill(typeNotPacked);
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
                );
                this.tsType2WASMTypeMap.set(type, wasmClassType.typeRef);
                this.tsType2WASMHeapTypeMap.set(
                    type,
                    wasmClassType.heapTypeRef,
                );
                break;
            }
            case TypeKind.INTERFACE: {
                this.tsType2WASMTypeMap.set(type, infcTypeInfo.typeRef);
                this.tsType2WASMHeapTypeMap.set(type, infcTypeInfo.heapTypeRef);
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
        if (!this.tsType2WASMTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return this.tsType2WASMTypeMap.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMHeapType(type: Type): binaryenCAPI.HeapTypeRef {
        assert(this.hasHeapType(type));
        if (!this.tsType2WASMHeapTypeMap.has(type)) {
            this.createWASMType(type);
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
        assert(type.typeKind === TypeKind.CLASS);
        if (!this.tsFuncType2WASMStructType.has(type)) {
            this.createWASMType(type);
        }
        return this.tsClassVtableType.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMClassVtableHeapType(type: Type): binaryenCAPI.HeapTypeRef {
        assert(type.typeKind === TypeKind.CLASS);
        if (!this.tsFuncType2WASMStructType.has(type)) {
            this.createWASMType(type);
        }
        return this.tsClassVtableHeapType.get(type) as binaryenCAPI.HeapTypeRef;
    }

    getWASMClassVtable(type: Type): binaryen.ExpressionRef {
        assert(type.typeKind === TypeKind.CLASS);
        return this.classVtables.get(type) as binaryen.ExpressionRef;
    }

    getInfcTypeRef(): binaryenCAPI.TypeRef {
        return infcTypeInfo.typeRef;
    }

    getInfcHeapTypeRef(): binaryenCAPI.HeapTypeRef {
        return infcTypeInfo.heapTypeRef;
    }
}

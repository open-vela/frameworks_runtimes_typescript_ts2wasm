import binaryen from 'binaryen';
import * as binaryenCAPI from './binaryen.js';
import { ptrInfo, typeInfo } from './utils.js';

export function arrayToPtr(array: number[]): ptrInfo {
    const ptrInfo: ptrInfo = {
        ptr: 0,
        len: 0,
    };
    if (!array) ptrInfo;
    const len = array.length;
    const ptrAddress = binaryenCAPI._malloc(len << 2);
    let idx = ptrAddress;
    for (let i = 0; i < len; ++i) {
        const val = array[i];
        binaryenCAPI.__i32_store(idx, <number>val);
        idx += 4;
    }
    ptrInfo.ptr = ptrAddress;
    ptrInfo.len = len;
    return ptrInfo;
}

export function ptrToArray(ptrInfo: ptrInfo): number[] {
    if (!ptrInfo) return [];
    const ptr = ptrInfo.ptr;
    const len = ptrInfo.len;
    const array = [];
    let idx = ptr;
    for (let i = 0; i < len; ++i) {
        const val = binaryenCAPI.__i32_load(idx);
        array.push(val);
        idx += 4;
    }
    return array;
}

export function initArrayType(
    elementType: binaryenCAPI.TypeRef,
    elementPackedTyype: binaryenCAPI.PackedType,
    elementMutable: binaryenCAPI.bool,
    nullable: binaryenCAPI.bool,
): typeInfo {
    const tb: binaryenCAPI.TypeBuilderRef = binaryenCAPI._TypeBuilderCreate(1);
    binaryenCAPI._TypeBuilderSetArrayType(
        tb,
        0,
        elementType,
        elementPackedTyype,
        elementMutable,
    );
    const builtHeapType: binaryenCAPI.HeapTypeRef[] = new Array(1);
    const builtHeapTypePtr = arrayToPtr(builtHeapType);
    binaryenCAPI._TypeBuilderBuildAndDispose(tb, builtHeapTypePtr.ptr, 0, 0);
    const arrayType = binaryenCAPI._BinaryenTypeFromHeapType(
        ptrToArray(builtHeapTypePtr)[0],
        nullable,
    );
    const arrayRef = binaryenCAPI._BinaryenTypeGetHeapType(arrayType);
    const arrayTypeInfo: typeInfo = {
        typeRef: arrayType,
        heapTypeRef: arrayRef,
    };
    return arrayTypeInfo;
}

export function initStructType(
    fieldTypesList: binaryenCAPI.ArrayRef<binaryenCAPI.TypeRef>[],
    fieldPackedTypesList: binaryenCAPI.ArrayRef<binaryenCAPI.PackedType>[],
    fieldMutablesList: binaryenCAPI.ArrayRef<binaryenCAPI.bool>[],
    numFields: binaryenCAPI.i32,
    nullable: binaryenCAPI.bool,
): typeInfo {
    const fieldTypes = arrayToPtr(fieldTypesList).ptr;
    const fieldPackedTypes = arrayToPtr(fieldPackedTypesList).ptr;
    const fieldMutables = arrayToPtr(fieldMutablesList).ptr;
    const tb: binaryenCAPI.TypeBuilderRef = binaryenCAPI._TypeBuilderCreate(1);
    binaryenCAPI._TypeBuilderSetStructType(
        tb,
        0,
        fieldTypes,
        fieldPackedTypes,
        fieldMutables,
        numFields,
    );
    const builtHeapType: binaryenCAPI.HeapTypeRef[] = new Array(1);
    const builtHeapTypePtr = arrayToPtr(builtHeapType);
    binaryenCAPI._TypeBuilderBuildAndDispose(tb, builtHeapTypePtr.ptr, 0, 0);
    const structType = binaryenCAPI._BinaryenTypeFromHeapType(
        ptrToArray(builtHeapTypePtr)[0],
        nullable,
    );
    const structRef = binaryenCAPI._BinaryenTypeGetHeapType(structType);
    const structTypeInfo: typeInfo = {
        typeRef: structType,
        heapTypeRef: structRef,
    };
    return structTypeInfo;
}

export const stringArrayTypeInfo = genarateStrArrayTypeInfo();
export const stringStructTypeInfo = generateStrStructTypeInfo();

// generate array type to store string context
function genarateStrArrayTypeInfo(): typeInfo {
    const strArrayTypeInfo = initArrayType(
        binaryenCAPI._BinaryenTypeInt32(),
        binaryenCAPI._BinaryenPackedTypeNotPacked(),
        true,
        true,
    );
    return strArrayTypeInfo;
}

// generate struct type to store string information
function generateStrStructTypeInfo(): typeInfo {
    const module = new binaryen.Module();
    const strArrayTypeInfo = stringArrayTypeInfo;
    const strStructTypeInfo = initStructType(
        [
            binaryenCAPI._BinaryenTypeInt32(),
            binaryenCAPI._BinaryenTypeFromHeapType(
                strArrayTypeInfo.heapTypeRef,
                true,
            ),
        ],
        [
            binaryenCAPI._BinaryenPackedTypeNotPacked(),
            binaryenCAPI._BinaryenPackedTypeNotPacked(),
        ],
        [module.i32.const(1), module.i32.const(1)],
        2,
        true,
    );
    return strStructTypeInfo;
}

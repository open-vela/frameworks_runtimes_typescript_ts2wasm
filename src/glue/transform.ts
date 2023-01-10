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
    binaryenCAPI._free(ptr);
    return array;
}

export function i32(
    module: binaryen.Module,
    alloc: binaryenCAPI.usize,
    value: binaryenCAPI.i32,
): binaryen.ExpressionRef {
    binaryenCAPI._BinaryenLiteralInt32(alloc, value);
    return binaryenCAPI._BinaryenConst(module.ptr, alloc);
}

export function initArrayType(
    elementType: binaryenCAPI.TypeRef,
    elementPackedType: binaryenCAPI.PackedType,
    elementMutable: binaryenCAPI.bool,
    nullable: binaryenCAPI.bool,
): typeInfo {
    const tb: binaryenCAPI.TypeBuilderRef = binaryenCAPI._TypeBuilderCreate(1);
    binaryenCAPI._TypeBuilderSetArrayType(
        tb,
        0,
        elementType,
        elementPackedType,
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

export const charArrayTypeInformation = genarateCharArrayTypeInfo();
export const stringTypeInformation = generateStringTypeInfo();
export const numberArrayTypeInformation = genarateNumberArrayTypeInfo();
export const stringArrayTypeInformation = genarateStringArrayTypeInfo();
export const boolArrayTypeInformation = genarateBoolArrayTypeInfo();
export const anyArrayTypeInformation = genarateAnyArrayTypeInfo();
export const objectStructTypeInformation = genarateObjectStructTypeInfo();

// generate array type to store character context
function genarateCharArrayTypeInfo(): typeInfo {
    const charArrayTypeInfo = initArrayType(
        binaryenCAPI._BinaryenTypeInt32(),
        binaryenCAPI._BinaryenPackedTypeNotPacked(),
        true,
        true,
    );
    return charArrayTypeInfo;
}

// generate struct type to store string information
function generateStringTypeInfo(): typeInfo {
    const module = new binaryen.Module();
    const charArrayTypeInfo = charArrayTypeInformation;
    const stringTypeInfo = initStructType(
        [
            binaryenCAPI._BinaryenTypeInt32(),
            binaryenCAPI._BinaryenTypeFromHeapType(
                charArrayTypeInfo.heapTypeRef,
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
    return stringTypeInfo;
}

// generate number array type
function genarateNumberArrayTypeInfo(): typeInfo {
    const numberArrayTypeInfo = initArrayType(
        binaryenCAPI._BinaryenTypeFloat64(),
        binaryenCAPI._BinaryenPackedTypeNotPacked(),
        true,
        true,
    );
    return numberArrayTypeInfo;
}

// generate string array type
function genarateStringArrayTypeInfo(): typeInfo {
    const stringTypeInfo = stringTypeInformation;
    const stringArrayTypeInfo = initArrayType(
        stringTypeInfo.typeRef,
        binaryenCAPI._BinaryenPackedTypeNotPacked(),
        true,
        true,
    );
    return stringArrayTypeInfo;
}

// generate bool array type
function genarateBoolArrayTypeInfo(): typeInfo {
    const boolArrayTypeInfo = initArrayType(
        binaryenCAPI._BinaryenTypeInt32(),
        binaryenCAPI._BinaryenPackedTypeNotPacked(),
        true,
        true,
    );
    return boolArrayTypeInfo;
}

// generate any array type
function genarateAnyArrayTypeInfo(): typeInfo {
    const anyArrayTypeInfo = initArrayType(
        binaryenCAPI._BinaryenTypeAnyref(),
        binaryenCAPI._BinaryenPackedTypeNotPacked(),
        true,
        true,
    );
    return anyArrayTypeInfo;
}

// generate object empty struct type
function genarateObjectStructTypeInfo(): typeInfo {
    const emptyStructTypeInfo = initStructType([], [], [], 0, true);
    return emptyStructTypeInfo;
}

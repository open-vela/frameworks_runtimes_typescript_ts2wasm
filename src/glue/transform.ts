import binaryen from 'binaryen';
import { assert } from 'console';
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

function allocU32Array(u32s: binaryenCAPI.u32[] | null): binaryenCAPI.usize {
    if (!u32s) return 0;
    const len = u32s.length;
    const ptr = binaryenCAPI._malloc(len << 2);
    let idx = ptr;
    for (let i = 0; i < len; ++i) {
        binaryenCAPI.__i32_store(idx, u32s[i]);
        idx += 4;
    }
    return ptr;
}

function allocU8Array(u8s: boolean[] | null): binaryenCAPI.usize {
    if (!u8s) return 0;
    const len = u8s.length;
    const ptr = binaryenCAPI._malloc(len);
    for (let i = 0; i < len; ++i) {
        const value = u8s[i] ? 1 : 0;
        binaryenCAPI.__i32_store8(ptr + i, value);
    }
    return ptr;
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
    fieldTypesList: Array<binaryenCAPI.TypeRef>,
    fieldPackedTypesList: Array<binaryenCAPI.PackedType>,
    fieldMutablesList: Array<boolean>,
    numFields: binaryenCAPI.i32,
    nullable: binaryenCAPI.bool,
): typeInfo {
    const fieldTypes = arrayToPtr(fieldTypesList).ptr;
    const fieldPackedTypes = allocU32Array(fieldPackedTypesList);
    const fieldMutables = allocU8Array(fieldMutablesList);
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
export const infcTypeInformation = generateInfcTypeInfo();

export const emptyStructType = initStructType([], [], [], 0, true);
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
        [true, true],
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

function generateInfcTypeInfo(): typeInfo {
    return initStructType(
        [binaryen.i32, binaryen.i32, binaryen.anyref],
        [
            binaryenCAPI._BinaryenPackedTypeNotPacked(),
            binaryenCAPI._BinaryenPackedTypeNotPacked(),
            binaryenCAPI._BinaryenPackedTypeNotPacked(),
        ],
        [false, false, true],
        3,
        true,
    );
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

export function createSignatureTypeRefAndHeapTypeRef(
    parameterTypes: Array<binaryenCAPI.TypeRef>,
    returnType: binaryenCAPI.TypeRef,
): typeInfo {
    const parameterLen = parameterTypes.length;
    const builder = binaryenCAPI._TypeBuilderCreate(1);
    const tempSignatureIndex = 0;
    let tempParamTypes = !parameterLen ? binaryen.none : parameterTypes[0];
    if (parameterLen > 1) {
        const tempPtr = arrayToPtr(parameterTypes).ptr;
        tempParamTypes = binaryenCAPI._TypeBuilderGetTempTupleType(
            builder,
            tempPtr,
            parameterLen,
        );
        binaryenCAPI._free(tempPtr);
    }
    binaryenCAPI._TypeBuilderSetSignatureType(
        builder,
        tempSignatureIndex,
        tempParamTypes,
        returnType,
    );
    const builtHeapType: binaryenCAPI.HeapTypeRef[] = new Array(1);
    const builtHeapTypePtr = arrayToPtr(builtHeapType);
    binaryenCAPI._TypeBuilderBuildAndDispose(
        builder,
        builtHeapTypePtr.ptr,
        0,
        0,
    );
    const signatureType = binaryenCAPI._BinaryenTypeFromHeapType(
        ptrToArray(builtHeapTypePtr)[0],
        true,
    );
    const signatureHeapType =
        binaryenCAPI._BinaryenTypeGetHeapType(signatureType);
    const signature: typeInfo = {
        typeRef: signatureType,
        heapTypeRef: signatureHeapType,
    };
    return signature;
}

export function createCondBlock(
    module: binaryen.Module,
    l: binaryen.ExpressionRef,
    r: binaryen.ExpressionRef,
    result: binaryen.ExpressionRef,
): binaryen.ExpressionRef {
    const cond = module.if(module.i32.eq(l, r), result, module.unreachable());
    const resType = binaryen.getExpressionType(result);
    const condBlock = module.block(null, [cond], resType);
    return condBlock;
}

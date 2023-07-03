/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import binaryen from 'binaryen';
import * as binaryenCAPI from './binaryen.js';
import { ptrInfo, typeInfo } from './utils.js';

/** type system */
export const isorecursive: binaryenCAPI.TypeSystem = 0;
export const nominal: binaryenCAPI.TypeSystem = 1;

/** value types */
export namespace BinaryenType {
    // value types
    // _BinaryenTypeInt32
    export const I32: binaryen.Type = 2;
    // _BinaryenTypeInt64
    export const I64: binaryen.Type = 3;
    // _BinaryenTypeFloat32
    export const F32: binaryen.Type = 4;
    // _BinaryenTypeFloat64
    export const F64: binaryen.Type = 5;
}

/** packed struct field types */
export namespace Pakced {
    // _BinaryenPackedTypeNotPacked
    export const Not: binaryenCAPI.PackedType = 0;
    // _BinaryenPackedTypeInt8
    export const I8: binaryenCAPI.PackedType = 1;
    // _BinaryenPackedTypeInt16
    export const I16: binaryenCAPI.PackedType = 2;
}

export function arrayToPtr(array: binaryen.ExpressionRef[]): ptrInfo {
    const arrLen = array.length;
    const ptrAddress = binaryenCAPI._malloc(arrLen << 2);
    let curElemAddress = ptrAddress;
    for (let i = 0; i < arrLen; i++) {
        const curArrayElem = array[i];
        binaryenCAPI.__i32_store(curElemAddress, curArrayElem);
        curElemAddress += 4;
    }
    const ptrInfo: ptrInfo = {
        ptr: ptrAddress,
        len: arrLen,
    };
    return ptrInfo;
}

export function ptrToArray(ptrInfo: ptrInfo): binaryen.ExpressionRef[] {
    const ptrAddress = ptrInfo.ptr;
    const arrLen = ptrInfo.len;
    const array: binaryen.ExpressionRef[] = [];
    let curElemAddress = ptrAddress;
    for (let i = 0; i < arrLen; i++) {
        const curArrayElem = binaryenCAPI.__i32_load(curElemAddress);
        array.push(curArrayElem);
        curElemAddress += 4;
    }
    binaryenCAPI._free(ptrAddress);
    return array;
}

function allocU32Array(u32Array: binaryenCAPI.u32[]): binaryenCAPI.usize {
    const arrLen = u32Array.length;
    const ptrAddress = binaryenCAPI._malloc(arrLen << 2);
    let curElemAddress = ptrAddress;
    for (let i = 0; i < arrLen; i++) {
        binaryenCAPI.__i32_store(curElemAddress, u32Array[i]);
        curElemAddress += 4;
    }
    return ptrAddress;
}

function allocU8Array(u8Array: boolean[]): binaryenCAPI.usize {
    const arrLen = u8Array.length;
    const ptrAddress = binaryenCAPI._malloc(arrLen);
    for (let i = 0; i < arrLen; i++) {
        const curArrayElem = u8Array[i] ? 1 : 0;
        binaryenCAPI.__i32_store8(ptrAddress + i, curArrayElem);
    }
    return ptrAddress;
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

/** Object */
export const emptyStructType = initStructType([], [], [], 0, true);
/** Function */
export const builtinFunctionType = initStructType(
    [emptyStructType.typeRef, binaryenCAPI._BinaryenTypeFuncref()],
    [Pakced.Not, Pakced.Not],
    [true, false],
    2,
    true,
);
export function initStructType(
    fieldTypesList: Array<binaryenCAPI.TypeRef>,
    fieldPackedTypesList: Array<binaryenCAPI.PackedType>,
    fieldMutablesList: Array<boolean>,
    numFields: binaryenCAPI.i32,
    nullable: binaryenCAPI.bool,
    baseType?: binaryenCAPI.HeapTypeRef,
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
    if (fieldTypesList.length > 0) {
        const subType = baseType ? baseType : emptyStructType.heapTypeRef;
        binaryenCAPI._TypeBuilderSetSubType(tb, 0, subType);
    }
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
export const stringArrayTypeInformation = genarateStringArrayTypeInfo(false);
export const stringArrayStructTypeInformation =
    genarateStringArrayTypeInfo(true);
export const boolArrayTypeInformation = genarateBoolArrayTypeInfo();
export const anyArrayTypeInformation = genarateAnyArrayTypeInfo();
export const objectStructTypeInformation = emptyStructType;
export const infcTypeInformation = generateInfcTypeInfo();

export function generateArrayStructTypeInfo(arrayTypeInfo: typeInfo): typeInfo {
    const arrayStructTypeInfo = initStructType(
        [
            binaryenCAPI._BinaryenTypeFromHeapType(
                arrayTypeInfo.heapTypeRef,
                true,
            ),
            BinaryenType.I32,
        ],
        [Pakced.Not, Pakced.Not],
        [true, true],
        2,
        true,
    );
    return arrayStructTypeInfo;
}

// generate array type to store character context
function genarateCharArrayTypeInfo(): typeInfo {
    const charArrayTypeInfo = initArrayType(
        BinaryenType.I32,
        Pakced.I8,
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
            BinaryenType.I32,
            binaryenCAPI._BinaryenTypeFromHeapType(
                charArrayTypeInfo.heapTypeRef,
                true,
            ),
        ],
        [Pakced.Not, Pakced.Not],
        [true, true],
        2,
        true,
    );
    return stringTypeInfo;
}

// generate number array type
function genarateNumberArrayTypeInfo(): typeInfo {
    const numberArrayTypeInfo = initArrayType(
        BinaryenType.F64,
        Pakced.Not,
        true,
        true,
    );
    return numberArrayTypeInfo;
}

// generate string array type
function genarateStringArrayTypeInfo(struct_wrap: boolean): typeInfo {
    const stringTypeInfo = stringTypeInformation;
    const stringArrayTypeInfo = initArrayType(
        stringTypeInfo.typeRef,
        Pakced.Not,
        true,
        true,
    );

    if (struct_wrap) {
        return generateArrayStructTypeInfo(stringArrayTypeInfo);
    }

    return stringArrayTypeInfo;
}

function generateInfcTypeInfo(): typeInfo {
    return initStructType(
        [binaryen.i32, binaryen.i32, binaryen.i32, binaryen.anyref],
        [Pakced.Not, Pakced.Not, Pakced.Not, Pakced.Not],
        [false, false, false, true],
        4,
        true,
    );
}

// generate bool array type
function genarateBoolArrayTypeInfo(): typeInfo {
    const boolArrayTypeInfo = initArrayType(
        BinaryenType.I32,
        Pakced.Not,
        true,
        true,
    );
    return boolArrayTypeInfo;
}

// generate any array type
function genarateAnyArrayTypeInfo(): typeInfo {
    const anyArrayTypeInfo = initArrayType(
        binaryenCAPI._BinaryenTypeAnyref(),
        Pakced.Not,
        true,
        true,
    );
    return anyArrayTypeInfo;
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
    infcTypeId: binaryen.ExpressionRef,
    objTypeId: binaryen.ExpressionRef,
    objImplId: binaryen.ExpressionRef,
    ifTrue: binaryen.ExpressionRef,
    ifFalse: binaryen.ExpressionRef,
): binaryen.ExpressionRef {
    const cond = module.if(
        module.i32.or(
            module.i32.eq(infcTypeId, objTypeId),
            module.i32.eq(infcTypeId, objImplId),
        ),
        ifTrue,
        ifFalse,
    );
    const resType = binaryen.getExpressionType(ifTrue);
    const condBlock = module.block(null, [cond], resType);
    return condBlock;
}

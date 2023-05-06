/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import binaryen from 'binaryen';
import ts from 'typescript';
import * as binaryenCAPI from '../glue/binaryen.js';
import { BuiltinNames } from '../../../../lib/builtin/builtin_name.js';
import { emptyStructType } from '../glue/transform.js';
import {
    flattenLoopStatement,
    FlattenLoop,
    isBaseType,
    unboxAnyTypeToBaseType,
    getFuncName,
} from '../utils.js';
import { dyntype } from './dyntype/utils.js';
import { arrayToPtr } from '../glue/transform.js';
import {
    charArrayTypeInfo,
    stringArrayTypeInfo,
    stringTypeInfo,
} from '../glue/packType.js';
import { TypeKind } from '../../../type.js';

function string_concat(module: binaryen.Module) {
    /** Args: context, this, string[] */
    const thisStrStructIdx = 1;
    const paramStrArrayIdx = 2;
    /** Locals: totalLen, for_i(i32), newStrArrayIdx(char_array), copyCurLenIdx(i32) */
    const totalLenIdx = 3;
    const for_i_Idx = 4;
    const newStrArrayIdx = 5;
    const copyCurLenIdx = 6;
    /** structure index information */
    const arrayIdxInStruct = 1;
    const thisStrStruct = module.local.get(
        thisStrStructIdx,
        stringTypeInfo.typeRef,
    );
    const paramStrArray = module.local.get(
        paramStrArrayIdx,
        stringArrayTypeInfo.typeRef,
    );
    const thisStrArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        arrayIdxInStruct,
        thisStrStruct,
        charArrayTypeInfo.typeRef,
        false,
    );
    const thisStrLen = binaryenCAPI._BinaryenArrayLen(module.ptr, thisStrArray);
    const paramStrArrayLen = binaryenCAPI._BinaryenArrayLen(
        module.ptr,
        paramStrArray,
    );

    const getStringArrayFromRestParams = (module: binaryen.Module) => {
        return binaryenCAPI._BinaryenStructGet(
            module.ptr,
            arrayIdxInStruct,
            binaryenCAPI._BinaryenArrayGet(
                module.ptr,
                module.local.get(paramStrArrayIdx, stringArrayTypeInfo.typeRef),
                module.local.get(for_i_Idx, binaryen.i32),
                stringTypeInfo.typeRef,
                false,
            ),
            charArrayTypeInfo.typeRef,
            false,
        );
    };

    const statementArray: binaryen.ExpressionRef[] = [];
    /** 1. get total str length */
    statementArray.push(module.local.set(totalLenIdx, thisStrLen));
    const for_label_1 = 'for_loop_1_block';
    const for_init_1 = module.local.set(for_i_Idx, module.i32.const(0));
    const for_condition_1 = module.i32.lt_u(
        module.local.get(for_i_Idx, binaryen.i32),
        paramStrArrayLen,
    );
    const for_incrementor_1 = module.local.set(
        for_i_Idx,
        module.i32.add(
            module.local.get(for_i_Idx, binaryen.i32),
            module.i32.const(1),
        ),
    );
    const for_body_1 = module.local.set(
        totalLenIdx,
        module.i32.add(
            module.local.get(totalLenIdx, binaryen.i32),
            binaryenCAPI._BinaryenArrayLen(
                module.ptr,
                getStringArrayFromRestParams(module),
            ),
        ),
    );

    const flattenLoop_1: FlattenLoop = {
        label: for_label_1,
        condition: for_condition_1,
        statements: for_body_1,
        incrementor: for_incrementor_1,
    };
    statementArray.push(for_init_1);
    statementArray.push(
        module.loop(
            for_label_1,
            flattenLoopStatement(
                flattenLoop_1,
                ts.SyntaxKind.ForStatement,
                module,
            ),
        ),
    );

    /** 2. generate new string */
    statementArray.push(
        module.local.set(
            newStrArrayIdx,
            binaryenCAPI._BinaryenArrayNew(
                module.ptr,
                charArrayTypeInfo.heapTypeRef,
                module.local.get(totalLenIdx, binaryen.i32),
                module.i32.const(0),
            ),
        ),
    );

    /** 3. traverse paramStrArray, do copy */
    statementArray.push(
        binaryenCAPI._BinaryenArrayCopy(
            module.ptr,
            module.local.get(newStrArrayIdx, charArrayTypeInfo.typeRef),
            module.i32.const(0),
            thisStrArray,
            module.i32.const(0),
            thisStrLen,
        ),
    );
    statementArray.push(module.local.set(copyCurLenIdx, thisStrLen));

    const for_label_2 = 'for_loop_2_block';
    const for_init_2 = module.local.set(for_i_Idx, module.i32.const(0));
    const for_condition_2 = module.i32.lt_u(
        module.local.get(for_i_Idx, binaryen.i32),
        paramStrArrayLen,
    );
    const for_incrementor_2 = module.local.set(
        for_i_Idx,
        module.i32.add(
            module.local.get(for_i_Idx, binaryen.i32),
            module.i32.const(1),
        ),
    );
    const for_body_2 = module.block(null, [
        binaryenCAPI._BinaryenArrayCopy(
            module.ptr,
            module.local.get(newStrArrayIdx, charArrayTypeInfo.typeRef),
            module.local.get(copyCurLenIdx, binaryen.i32),
            getStringArrayFromRestParams(module),
            module.i32.const(0),
            binaryenCAPI._BinaryenArrayLen(
                module.ptr,
                getStringArrayFromRestParams(module),
            ),
        ),
        module.local.set(
            copyCurLenIdx,
            module.i32.add(
                module.local.get(copyCurLenIdx, binaryen.i32),
                binaryenCAPI._BinaryenArrayLen(
                    module.ptr,
                    getStringArrayFromRestParams(module),
                ),
            ),
        ),
    ]);

    const flattenLoop_2: FlattenLoop = {
        label: for_label_2,
        condition: for_condition_2,
        statements: for_body_2,
        incrementor: for_incrementor_2,
    };
    statementArray.push(for_init_2);
    statementArray.push(
        module.loop(
            for_label_2,
            flattenLoopStatement(
                flattenLoop_2,
                ts.SyntaxKind.ForStatement,
                module,
            ),
        ),
    );

    /** 4. generate new string structure */
    statementArray.push(
        module.return(
            binaryenCAPI._BinaryenStructNew(
                module.ptr,
                arrayToPtr([
                    module.i32.const(0),
                    module.local.get(newStrArrayIdx, charArrayTypeInfo.typeRef),
                ]).ptr,
                2,
                stringTypeInfo.heapTypeRef,
            ),
        ),
    );

    /** 5. generate block, return block */
    const concatBlock = module.block('concat', statementArray);
    return concatBlock;
}

function string_eq(module: binaryen.Module) {
    const statementArray: binaryen.ExpressionRef[] = [];

    const leftstrIdx = 0;
    const rightstrIdx = 1;
    const for_i_Idx = 2;

    const leftstr = module.local.get(leftstrIdx, stringTypeInfo.typeRef);
    const rightstr = module.local.get(rightstrIdx, stringTypeInfo.typeRef);

    const leftstrArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        1,
        leftstr,
        charArrayTypeInfo.typeRef,
        false,
    );
    const leftstrLen = binaryenCAPI._BinaryenArrayLen(module.ptr, leftstrArray);
    const rightstrArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        1,
        rightstr,
        charArrayTypeInfo.typeRef,
        false,
    );
    const rightstrLen = binaryenCAPI._BinaryenArrayLen(
        module.ptr,
        rightstrArray,
    );

    const retfalseLenNoEq = module.if(
        module.i32.ne(leftstrLen, rightstrLen),
        module.return(module.i32.const(0)),
    );

    statementArray.push(retfalseLenNoEq);

    const for_label_1 = 'for_loop_1_block';
    const for_init_1 = module.local.set(for_i_Idx, module.i32.const(0));
    const for_condition_1 = module.i32.lt_u(
        module.local.get(for_i_Idx, binaryen.i32),
        leftstrLen,
    );
    const for_incrementor_1 = module.local.set(
        for_i_Idx,
        module.i32.add(
            module.local.get(for_i_Idx, binaryen.i32),
            module.i32.const(1),
        ),
    );

    const for_body_1 = module.if(
        module.i32.ne(
            binaryenCAPI._BinaryenArrayGet(
                module.ptr,
                leftstrArray,
                module.local.get(for_i_Idx, binaryen.i32),
                charArrayTypeInfo.typeRef,
                false,
            ),
            binaryenCAPI._BinaryenArrayGet(
                module.ptr,
                rightstrArray,
                module.local.get(for_i_Idx, binaryen.i32),
                charArrayTypeInfo.typeRef,
                false,
            ),
        ),
        module.return(module.i32.const(0)),
    );

    const flattenLoop_1: FlattenLoop = {
        label: for_label_1,
        condition: for_condition_1,
        statements: for_body_1,
        incrementor: for_incrementor_1,
    };
    statementArray.push(for_init_1);
    statementArray.push(
        module.loop(
            for_label_1,
            flattenLoopStatement(
                flattenLoop_1,
                ts.SyntaxKind.ForStatement,
                module,
            ),
        ),
    );

    statementArray.push(module.return(module.i32.const(1)));

    const stringeqBlock = module.block(null, statementArray);
    return stringeqBlock;
}

function string_slice(module: binaryen.Module) {
    /** Args: context, this, start, end */
    const thisStrStructIdx = 1;
    const startParamIdx = 2;
    const endParamIdx = 3;
    /** Locals: start_i32, end_i32 */
    const startI32Idx = 4;
    const endI32Idx = 5;
    const newStrArrayIndex = 6;
    /** structure index information */
    const arrayIdxInStruct = 1;
    /** invoke binaryen API */
    const thisStrStruct = module.local.get(
        thisStrStructIdx,
        stringTypeInfo.typeRef,
    );
    const startAnyRef = module.local.get(startParamIdx, binaryen.anyref);
    const endAnyRef = module.local.get(endParamIdx, binaryen.anyref);
    const statementArray: binaryen.ExpressionRef[] = [];
    const strArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        arrayIdxInStruct,
        thisStrStruct,
        charArrayTypeInfo.typeRef,
        false,
    );
    const strLen = binaryenCAPI._BinaryenArrayLen(module.ptr, strArray);

    /** 1. set start and end to i32 */
    const setAnyToI32 = (
        module: binaryen.Module,
        localIdx: number,
        anyRef: binaryen.ExpressionRef,
        defaultValue: binaryen.ExpressionRef,
    ) => {
        const isUndefined = isBaseType(
            module,
            anyRef,
            dyntype.dyntype_is_undefined,
        );
        const dynToNumberValue = unboxAnyTypeToBaseType(
            module,
            anyRef,
            TypeKind.NUMBER,
        );
        // get passed param value by string length
        const paramValue = module.if(
            module.f64.le(dynToNumberValue, module.f64.const(0)),
            module.if(
                module.i32.le_s(
                    module.i32.add(
                        module.i32.trunc_u_sat.f64(dynToNumberValue),
                        strLen,
                    ),
                    module.i32.const(0),
                ),
                module.i32.const(0),
                module.i32.add(
                    module.i32.trunc_u_sat.f64(dynToNumberValue),
                    strLen,
                ),
            ),
            module.if(
                module.i32.le_s(
                    module.i32.trunc_u_sat.f64(dynToNumberValue),
                    strLen,
                ),
                module.i32.trunc_u_sat.f64(dynToNumberValue),
                strLen,
            ),
        );

        return module.if(
            module.i32.ne(isUndefined, module.i32.const(0)),
            module.local.set(localIdx, defaultValue),
            module.local.set(localIdx, paramValue),
        );
    };

    const setStartAnyToI32Ref = setAnyToI32(
        module,
        startI32Idx,
        startAnyRef,
        module.i32.const(0),
    );
    const setEndAnyToI32Ref = setAnyToI32(module, endI32Idx, endAnyRef, strLen);
    statementArray.push(setStartAnyToI32Ref);
    statementArray.push(setEndAnyToI32Ref);

    /** 2. get new string length */
    const start = module.local.get(startI32Idx, binaryen.i32);
    const end = module.local.get(endI32Idx, binaryen.i32);
    const newStrLen = module.if(
        module.i32.le_s(start, end),
        module.i32.sub(end, start),
        module.i32.const(0),
    );

    /** 3. copy value to new string */
    const newStrArrayType = charArrayTypeInfo.typeRef;
    const newStrArrayStatement = module.local.set(
        newStrArrayIndex,
        binaryenCAPI._BinaryenArrayNew(
            module.ptr,
            charArrayTypeInfo.heapTypeRef,
            newStrLen,
            module.i32.const(0),
        ),
    );
    statementArray.push(newStrArrayStatement);
    const arrayCopyStatement = module.if(
        module.i32.ne(newStrLen, module.i32.const(0)),
        binaryenCAPI._BinaryenArrayCopy(
            module.ptr,
            module.local.get(newStrArrayIndex, newStrArrayType),
            module.i32.const(0),
            strArray,
            start,
            newStrLen,
        ),
    );
    statementArray.push(arrayCopyStatement);

    /** 4. generate new string structure */
    const newStrStruct = binaryenCAPI._BinaryenStructNew(
        module.ptr,
        arrayToPtr([
            module.i32.const(0),
            module.local.get(newStrArrayIndex, newStrArrayType),
        ]).ptr,
        2,
        stringTypeInfo.heapTypeRef,
    );
    statementArray.push(module.return(newStrStruct));

    /** 5. generate block, return block */
    const sliceBlock = module.block('slice', statementArray);
    return sliceBlock;
}

function string_replace(module: binaryen.Module) {
    /** Args: context, this, pattern, targetStr*/
    const thisStrStructIdx = 1;
    const patternStrIdx = 2;
    const targetStrIdx = 3;
    /** Locals: new char array, matched position, len of this str,
     *      len of pattern str, len of target str
     */
    const newCharArrayIdx = 4;
    const matchedPosIdx = 5;

    /* structure index informations*/
    const arrayIdxInStruct = 1;

    const statementArray: binaryen.ExpressionRef[] = [];
    /**1. get length of this str*/
    const thisStrStruct = module.local.get(
        thisStrStructIdx,
        stringTypeInfo.typeRef,
    );
    const thisStrArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        arrayIdxInStruct,
        thisStrStruct,
        charArrayTypeInfo.typeRef,
        false,
    );

    const thisStrLen = binaryenCAPI._BinaryenArrayLen(module.ptr, thisStrArray);
    /**2. get pattern str and len*/
    const patternStrStruct = module.local.get(
        patternStrIdx,
        stringTypeInfo.typeRef,
    );
    const patternStrArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        arrayIdxInStruct,
        patternStrStruct,
        charArrayTypeInfo.typeRef,
        false,
    );
    const patternStrLen = binaryenCAPI._BinaryenArrayLen(
        module.ptr,
        patternStrArray,
    );

    /**3. Boundary condition */
    // 3.1 return if length doesn't meet requirements
    statementArray.push(
        module.if(
            module.i32.lt_s(thisStrLen, patternStrLen),
            module.return(thisStrStruct),
        ),
    );
    // 3.2 return if don't match
    statementArray.push(
        module.local.set(
            matchedPosIdx,
            module.call(
                getFuncName(
                    BuiltinNames.builtinModuleName,
                    BuiltinNames.stringIndexOfInternalFuncName,
                ),
                [
                    module.local.get(0, emptyStructType.typeRef),
                    module.local.get(thisStrStructIdx, stringTypeInfo.typeRef),
                    module.local.get(patternStrIdx, stringTypeInfo.typeRef),
                    module.i32.const(0),
                ],
                binaryen.i32,
            ),
        ),
    );
    statementArray.push(
        module.if(
            module.i32.eq(
                module.local.get(matchedPosIdx, binaryen.i32),
                module.i32.const(-1),
            ),
            module.return(thisStrStruct),
        ),
    );
    /**4. get target str and len */
    const targetStrStruct = module.local.get(
        targetStrIdx,
        stringTypeInfo.typeRef,
    );
    const targetStrArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        arrayIdxInStruct,
        targetStrStruct,
        charArrayTypeInfo.typeRef,
        false,
    );
    const targetStrLen = binaryenCAPI._BinaryenArrayLen(
        module.ptr,
        targetStrArray,
    );
    /**5. create a new string */
    const totalLen = module.i32.sub(
        module.i32.add(thisStrLen, targetStrLen),
        patternStrLen,
    );
    statementArray.push(
        module.local.set(
            newCharArrayIdx,
            binaryenCAPI._BinaryenArrayNew(
                module.ptr,
                charArrayTypeInfo.heapTypeRef,
                totalLen,
                module.i32.const(0),
            ),
        ),
    );

    statementArray.push(
        binaryenCAPI._BinaryenArrayCopy(
            module.ptr,
            module.local.get(newCharArrayIdx, charArrayTypeInfo.typeRef),
            module.i32.const(0),
            thisStrArray,
            module.i32.const(0),
            module.local.get(matchedPosIdx, binaryen.i32),
        ),
    );
    statementArray.push(
        binaryenCAPI._BinaryenArrayCopy(
            module.ptr,
            module.local.get(newCharArrayIdx, charArrayTypeInfo.typeRef),
            module.local.get(matchedPosIdx, binaryen.i32),
            targetStrArray,
            module.i32.const(0),
            targetStrLen,
        ),
    );

    statementArray.push(
        binaryenCAPI._BinaryenArrayCopy(
            module.ptr,
            module.local.get(newCharArrayIdx, charArrayTypeInfo.typeRef),
            module.i32.add(
                module.local.get(matchedPosIdx, binaryen.i32),
                targetStrLen,
            ),
            thisStrArray,
            module.i32.add(
                module.local.get(matchedPosIdx, binaryen.i32),
                patternStrLen,
            ),
            module.i32.sub(
                thisStrLen,
                module.i32.add(
                    module.local.get(matchedPosIdx, binaryen.i32),
                    patternStrLen,
                ),
            ),
        ),
    );

    statementArray.push(
        module.return(
            binaryenCAPI._BinaryenStructNew(
                module.ptr,
                arrayToPtr([
                    module.i32.const(0),
                    module.local.get(
                        newCharArrayIdx,
                        charArrayTypeInfo.typeRef,
                    ),
                ]).ptr,
                2,
                stringTypeInfo.heapTypeRef,
            ),
        ),
    );

    const replaceBlock = module.block('replace', statementArray);
    return replaceBlock;
}

function string_split(module: binaryen.Module) {
    /** Args: context, this, string*/
    const thisStrStructIdx = 1;
    const sepStrIdx = 2;
    /** Locals: */
    // beging idx for each search
    const searchBegIdx = 3;
    // match idx for each search
    const matchIndexIdx = 4;
    // lenght of split result
    const resArrLenIdx = 5;
    // length of this str
    const thisStrLenIdx = 6;
    // length of sep str
    const sepStrLenIdx = 7;
    // split result
    const resStrArrayIdx = 8;
    // length of split part in each match
    const curStrLenIdx = 9;
    // temp char array for every split part
    const tempCharArrayIdx = 10;
    // cur index of the operating element in result array
    const curStrArrayIndexIdx = 11;

    const arrayIdxInStruct = 1;
    const statementArray: binaryen.ExpressionRef[] = [];

    /**0.1 get length of this string*/
    const thisStrStruct = module.local.get(
        thisStrStructIdx,
        stringTypeInfo.typeRef,
    );

    const thisStrArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        arrayIdxInStruct,
        thisStrStruct,
        charArrayTypeInfo.typeRef,
        false,
    );
    const thisStrLen = binaryenCAPI._BinaryenArrayLen(module.ptr, thisStrArray);
    statementArray.push(module.local.set(thisStrLenIdx, thisStrLen));

    /** 0.2 get length of sep string*/
    const sepStrStruct = module.local.get(sepStrIdx, stringTypeInfo.typeRef);

    const sepStrArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        arrayIdxInStruct,
        sepStrStruct,
        charArrayTypeInfo.typeRef,
        false,
    );
    const sepStrLen = binaryenCAPI._BinaryenArrayLen(module.ptr, sepStrArray);
    statementArray.push(module.local.set(sepStrLenIdx, sepStrLen));

    /**1. cacl len of split array */
    const block_label_1 = 'block_label_1';
    const loop_label_1 = 'loop_block_1';
    const loop_init_1 = module.local.set(searchBegIdx, module.i32.const(0));
    const loop_stmts_1 = module.block(null, [
        module.local.set(
            matchIndexIdx,
            module.call(
                getFuncName(
                    BuiltinNames.builtinModuleName,
                    BuiltinNames.stringIndexOfInternalFuncName,
                ),
                [
                    module.local.get(0, emptyStructType.typeRef),
                    module.local.get(thisStrStructIdx, stringTypeInfo.typeRef),
                    module.local.get(sepStrIdx, stringTypeInfo.typeRef),
                    module.local.get(searchBegIdx, binaryen.i32),
                ],
                binaryen.i32,
            ),
        ),
        // inc length of res string array
        module.local.set(
            resArrLenIdx,
            module.i32.add(
                module.local.get(resArrLenIdx, binaryen.i32),
                module.i32.const(1),
            ),
        ),
        // jmp out the loop
        module.br(
            block_label_1,
            module.i32.eq(
                module.local.get(matchIndexIdx, binaryen.i32),
                module.i32.const(-1),
            ),
        ),
        // update search begin
        module.local.set(
            searchBegIdx,
            module.i32.add(
                module.local.get(matchIndexIdx, binaryen.i32),
                module.local.get(sepStrLenIdx, binaryen.i32),
            ),
        ),
        // jmp to loop again
        module.br(loop_label_1),
    ]);
    const loop_1 = module.loop(loop_label_1, loop_stmts_1);
    const stmts_block_1 = module.block(block_label_1, [loop_init_1, loop_1]);
    statementArray.push(stmts_block_1);
    /**2. create an string array */
    statementArray.push(
        module.local.set(
            resStrArrayIdx,
            binaryenCAPI._BinaryenArrayNew(
                module.ptr,
                stringArrayTypeInfo.heapTypeRef,
                module.local.get(resArrLenIdx, binaryen.i32),
                module.ref.null(stringTypeInfo.typeRef),
            ),
        ),
    );

    /**3. copy split part to the result array */
    // helper function:
    const createNewCharArray = (module: binaryen.Module) => {
        return binaryenCAPI._BinaryenArrayNew(
            module.ptr,
            charArrayTypeInfo.heapTypeRef,
            module.local.get(curStrLenIdx, binaryen.i32),
            module.i32.const(0),
        );
    };

    const block_label_2 = 'block_label_2';
    const loop_label_2 = 'loop_block_2';
    // init search begin idx and current string idx in res array
    const loop_init_2 = module.block(null, [
        module.local.set(searchBegIdx, module.i32.const(0)),
        module.local.set(curStrArrayIndexIdx, module.i32.const(0)),
    ]);

    const loop_stmts_2 = module.block(null, [
        module.local.set(
            matchIndexIdx,
            module.call(
                getFuncName(
                    BuiltinNames.builtinModuleName,
                    BuiltinNames.stringIndexOfInternalFuncName,
                ),
                [
                    module.local.get(0, emptyStructType.typeRef),
                    module.local.get(thisStrStructIdx, stringTypeInfo.typeRef),
                    module.local.get(sepStrIdx, stringTypeInfo.typeRef),
                    module.local.get(searchBegIdx, binaryen.i32),
                ],
                binaryen.i32,
            ),
        ),
        // cal and set current sub string length
        module.if(
            module.i32.eq(
                module.local.get(matchIndexIdx, binaryen.i32),
                module.i32.const(-1),
            ),
            module.local.set(
                curStrLenIdx,
                module.i32.sub(
                    module.local.get(thisStrLenIdx, binaryen.i32),
                    module.local.get(searchBegIdx, binaryen.i32),
                ),
            ),
            module.local.set(
                curStrLenIdx,
                module.i32.sub(
                    module.local.get(matchIndexIdx, binaryen.i32),
                    module.local.get(searchBegIdx, binaryen.i32),
                ),
            ),
        ),
        // create a char array
        module.local.set(tempCharArrayIdx, createNewCharArray(module)),
        // fill the array
        binaryenCAPI._BinaryenArrayCopy(
            module.ptr,
            module.local.get(tempCharArrayIdx, charArrayTypeInfo.typeRef),
            module.i32.const(0),
            thisStrArray,
            module.local.get(searchBegIdx, binaryen.i32),
            module.local.get(curStrLenIdx, binaryen.i32),
        ),
        // Creates a string and places it in the res array.
        binaryenCAPI._BinaryenArraySet(
            module.ptr,
            module.local.get(resStrArrayIdx, stringArrayTypeInfo.typeRef),
            module.local.get(curStrArrayIndexIdx, binaryen.i32),
            binaryenCAPI._BinaryenStructNew(
                module.ptr,
                arrayToPtr([
                    module.i32.const(0),
                    module.local.get(
                        tempCharArrayIdx,
                        charArrayTypeInfo.typeRef,
                    ),
                ]).ptr,
                2,
                stringTypeInfo.heapTypeRef,
            ),
        ),
        // inc the idx
        module.local.set(
            curStrArrayIndexIdx,
            module.i32.add(
                module.local.get(curStrArrayIndexIdx, binaryen.i32),
                module.i32.const(1),
            ),
        ),
        // jmp out the loop
        module.br(
            block_label_2,
            module.i32.eq(
                module.local.get(matchIndexIdx, binaryen.i32),
                module.i32.const(-1),
            ),
        ),
        // jmp to loop
        module.local.set(
            searchBegIdx,
            module.i32.add(
                module.local.get(matchIndexIdx, binaryen.i32),
                module.local.get(sepStrLenIdx, binaryen.i32),
            ),
        ),
        module.br(loop_label_2),
    ]);
    const loop_2 = module.loop(loop_label_2, loop_stmts_2);
    const stmts_block_2 = module.block(block_label_2, [loop_init_2, loop_2]);
    statementArray.push(stmts_block_2);

    // return the array len for debug now
    statementArray.push(
        module.local.get(resStrArrayIdx, stringArrayTypeInfo.typeRef),
    );
    const sliceBlock = module.block('split', statementArray);
    return sliceBlock;
}

function string_indexOf_internal(module: binaryen.Module) {
    /** Args: context, thisStr, pattern, begin Index*/
    const thisStrStructIdx = 1;
    const patternStrIdx = 2;
    const beginIdx = 3;
    /* Locals: i, iend, j, len of this str, len of pattern str*/
    const loopVarIIdx = 4;
    const loopVarIEndIdx = 5;
    const loopVarJIdx = 6;
    const thisStrLenIdx = 7;
    const patternLenIdx = 8;
    /* structure index informations*/
    const arrayIdxInStruct = 1;

    const statementsArray: binaryen.ExpressionRef[] = [];
    /**0. get len of thisStr and patternStr*/
    const thisStrStruct = module.local.get(
        thisStrStructIdx,
        stringTypeInfo.typeRef,
    );

    const patternStrSturct = module.local.get(
        patternStrIdx,
        stringTypeInfo.typeRef,
    );

    const thisStrArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        arrayIdxInStruct,
        thisStrStruct,
        charArrayTypeInfo.typeRef,
        false,
    );

    const patternStrArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        arrayIdxInStruct,
        patternStrSturct,
        charArrayTypeInfo.typeRef,
        false,
    );

    statementsArray.push(
        module.local.set(
            thisStrLenIdx,
            binaryenCAPI._BinaryenArrayLen(module.ptr, thisStrArray),
        ),
        module.local.set(
            patternLenIdx,
            binaryenCAPI._BinaryenArrayLen(module.ptr, patternStrArray),
        ),
    );

    /** 1. get iend and set patternStrLen*/
    statementsArray.push(
        module.local.set(
            loopVarIEndIdx,
            module.i32.sub(
                module.local.get(thisStrLenIdx, binaryen.i32),
                module.local.get(patternLenIdx, binaryen.i32),
            ),
        ),
    );
    /** 2. Loop1 head line*/
    const forLabel1 = 'for_loop_block1';
    const forInit1 = module.local.set(
        loopVarIIdx,
        module.local.get(beginIdx, binaryen.i32),
    );
    const forCondition1 = module.i32.le_s(
        module.local.get(loopVarIIdx, binaryen.i32),
        module.local.get(loopVarIEndIdx, binaryen.i32),
    );
    const forIncrementor1 = module.local.set(
        loopVarIIdx,
        module.i32.add(
            module.local.get(loopVarIIdx, binaryen.i32),
            module.i32.const(1),
        ),
    );

    /* 3. Loop2 headline*/
    const forLabel2 = 'for_loop_2_block';
    const forInit2 = module.local.set(loopVarJIdx, module.i32.const(0));
    const forCondition2 = module.i32.lt_s(
        module.local.get(loopVarJIdx, binaryen.i32),
        module.local.get(patternLenIdx, binaryen.i32),
    );
    const forIncrementor2 = module.local.set(
        loopVarJIdx,
        module.i32.add(
            module.local.get(loopVarJIdx, binaryen.i32),
            module.i32.const(1),
        ),
    );
    const forLoop1Block1 = 'for_loop_1_Block_1';
    /* 3.1 Loop2 body*/
    const forBody2 = module.br(
        forLoop1Block1,
        module.i32.ne(
            binaryenCAPI._BinaryenArrayGet(
                module.ptr,
                patternStrArray,
                module.local.get(loopVarJIdx, binaryen.i32),
                charArrayTypeInfo.typeRef,
                false,
            ),
            binaryenCAPI._BinaryenArrayGet(
                module.ptr,
                thisStrArray,
                module.i32.add(
                    module.local.get(loopVarJIdx, binaryen.i32),
                    module.local.get(loopVarIIdx, binaryen.i32),
                ),
                charArrayTypeInfo.typeRef,
                false,
            ),
        ),
    );

    const flattenLoop_2: FlattenLoop = {
        label: forLabel2,
        condition: forCondition2,
        statements: forBody2,
        incrementor: forIncrementor2,
    };

    /**4 Loop1 body */
    const forBody1Statements: binaryen.ExpressionRef[] = [];

    forBody1Statements.push(forInit2);
    forBody1Statements.push(
        module.block(forLoop1Block1, [
            module.loop(
                forLabel2,
                flattenLoopStatement(
                    flattenLoop_2,
                    ts.SyntaxKind.ForStatement,
                    module,
                ),
            ),
        ]),
    );

    forBody1Statements.push(
        module.if(
            module.i32.eq(
                module.local.get(loopVarJIdx, binaryen.i32),
                module.local.get(patternLenIdx, binaryen.i32),
            ),
            module.return(module.local.get(loopVarIIdx, binaryen.i32)),
        ),
    );

    const flattenLoop_1: FlattenLoop = {
        label: forLabel1,
        condition: forCondition1,
        statements: module.block(null, forBody1Statements),
        incrementor: forIncrementor1,
    };
    statementsArray.push(
        forInit1,
        module.loop(
            forLabel1,
            flattenLoopStatement(
                flattenLoop_1,
                ts.SyntaxKind.ForStatement,
                module,
            ),
        ),
    );

    /**5. default return -1*/
    statementsArray.push(module.i32.const(-1));

    const Block = module.block('indexOfInternal', statementsArray);
    return Block;
}

function string_indexOf(module: binaryen.Module) {
    /** Args: context, this, pattern*/
    const thisStrStructIdx = 1;
    const paramStrIdx = 2;

    const statementArray: binaryen.ExpressionRef[] = [];
    /** call IndexofInternal and convert answer to f64 */
    statementArray.push(
        module.f64.convert_s.i32(
            module.call(
                getFuncName(
                    BuiltinNames.builtinModuleName,
                    BuiltinNames.stringIndexOfInternalFuncName,
                ),
                [
                    module.local.get(0, emptyStructType.typeRef),
                    module.local.get(thisStrStructIdx, stringTypeInfo.typeRef),
                    module.local.get(paramStrIdx, stringTypeInfo.typeRef),
                    module.i32.const(0),
                ],
                binaryen.i32,
            ),
        ),
    );
    const Block = module.block('indexOf', statementArray);
    return Block;
}
function string_match(module: binaryen.Module) {
    /**Args: context, this, targetStr */
    const thisStrStructIdx = 1;
    const targetStrStructIdx = 2;
    /**Locals */
    // current matched index in source string
    const matchedPosIdx = 3;
    // the string array of result
    const resStrArrayIdx = 4;
    // current begining index for search in source string
    const searchBegIdx = 5;
    // current index where a matched word will be placed in the string array
    // currently, the string array contains no more than one element
    const curStrArrayIndexIdx = 6;
    // the string that stores matched word
    const tempCharArrayIdx = 7;
    // the length of matched word
    const curStrLenIdx = 8;
    // the length of pattern to be matched
    const targetStrLenIdx = 9;

    /**1. get targetStr */
    const arrayIdxInStruct = 1;
    const targetStrStruct = module.local.get(
        targetStrStructIdx,
        stringTypeInfo.typeRef,
    );
    const targetStrArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        arrayIdxInStruct,
        targetStrStruct,
        charArrayTypeInfo.typeRef,
        false,
    );
    const statementArray: binaryen.ExpressionRef[] = [];
    /**2. get length of target string */
    const targetStrLen = binaryenCAPI._BinaryenArrayLen(
        module.ptr,
        targetStrArray,
    );
    statementArray.push(module.local.set(targetStrLenIdx, targetStrLen));

    /**3. create a  string array and copy matched string to it*/

    /**3.1 create a string array */
    statementArray.push(
        module.local.set(
            resStrArrayIdx,
            binaryenCAPI._BinaryenArrayNew(
                module.ptr,
                stringArrayTypeInfo.heapTypeRef,
                module.i32.const(1),
                module.ref.null(stringTypeInfo.typeRef),
            ),
        ),
    );
    /**3.2 find a matched string and copy it to resStrArr. Currently, only a single
     * matched string will be copied.
     */
    const createNewCharArray = (module: binaryen.Module) => {
        return binaryenCAPI._BinaryenArrayNew(
            module.ptr,
            charArrayTypeInfo.heapTypeRef,
            module.local.get(curStrLenIdx, binaryen.i32),
            module.i32.const(0),
        );
    };
    const block_label_1 = 'block_label_1';
    const loop_label_1 = 'loop_block_1';
    const loop_init_1 = module.block(null, [
        module.local.set(searchBegIdx, module.i32.const(0)),
        module.local.set(curStrArrayIndexIdx, module.i32.const(0)),
    ]);

    const loop_stmts_1 = module.block(null, [
        module.local.set(
            matchedPosIdx,
            module.call(
                getFuncName(
                    BuiltinNames.builtinModuleName,
                    BuiltinNames.stringIndexOfInternalFuncName,
                ),
                [
                    module.local.get(0, emptyStructType.typeRef),
                    module.local.get(thisStrStructIdx, stringTypeInfo.typeRef),
                    module.local.get(
                        targetStrStructIdx,
                        stringTypeInfo.typeRef,
                    ),
                    module.local.get(searchBegIdx, binaryen.i32),
                ],
                binaryen.i32,
            ),
        ),
        module.if(
            module.i32.eq(
                module.local.get(matchedPosIdx, binaryen.i32),
                module.i32.const(-1),
            ),
            module.return(module.ref.null(stringArrayTypeInfo.typeRef)),
            module.local.set(
                curStrLenIdx,
                module.local.get(targetStrLenIdx, binaryen.i32),
            ),
        ),
        /** 3.2.1 create a char array */
        module.local.set(tempCharArrayIdx, createNewCharArray(module)),
        /** 3.2.2 copy matched sub-string to char array */
        binaryenCAPI._BinaryenArrayCopy(
            module.ptr,
            module.local.get(tempCharArrayIdx, charArrayTypeInfo.typeRef),
            module.i32.const(0),
            targetStrArray,
            module.i32.const(0),
            module.local.get(targetStrLenIdx, binaryen.i32),
        ),

        /** 3.2.3 place char array into string array */
        binaryenCAPI._BinaryenArraySet(
            module.ptr,
            module.local.get(resStrArrayIdx, stringArrayTypeInfo.typeRef),
            module.local.get(curStrArrayIndexIdx, binaryen.i32),
            binaryenCAPI._BinaryenStructNew(
                module.ptr,
                arrayToPtr([
                    module.i32.const(0),
                    module.local.get(
                        tempCharArrayIdx,
                        charArrayTypeInfo.typeRef,
                    ),
                ]).ptr,
                2,
                stringTypeInfo.heapTypeRef,
            ),
        ),
        /**3.3 inc the idx */
        module.local.set(
            curStrArrayIndexIdx,
            module.i32.add(
                module.local.get(curStrArrayIndexIdx, binaryen.i32),
                module.i32.const(1),
            ),
        ),
        /**jump out the loop */
        module.br(
            block_label_1,
            module.i32.eq(module.i32.const(1), module.i32.const(1)),
        ),
        /**jump to loop */
        module.local.set(
            searchBegIdx,
            module.i32.add(
                module.local.get(matchedPosIdx, binaryen.i32),
                module.local.get(targetStrLenIdx, binaryen.i32),
            ),
        ),
        module.br(loop_label_1),
    ]);
    const loop_1 = module.loop(loop_label_1, loop_stmts_1);
    const stmts_block_1 = module.block(block_label_1, [loop_init_1, loop_1]);
    statementArray.push(stmts_block_1);
    statementArray.push(
        module.local.get(resStrArrayIdx, stringArrayTypeInfo.typeRef),
    );
    return module.block('match', statementArray);
}

function string_search(module: binaryen.Module) {
    /**Args: context, this, pattern */
    const thisStrStructIdx = 1;
    const targetStrStructIdx = 2;
    /**Locals */
    // 1.index of matched position
    const matchedPosIdx = 3;
    const statementArray: binaryen.ExpressionRef[] = [];
    const findPattern = module.block(null, [
        module.local.set(
            matchedPosIdx,
            module.call(
                getFuncName(
                    BuiltinNames.builtinModuleName,
                    BuiltinNames.stringIndexOfInternalFuncName,
                ),
                [
                    module.local.get(0, emptyStructType.typeRef),
                    module.local.get(thisStrStructIdx, stringTypeInfo.typeRef),
                    module.local.get(
                        targetStrStructIdx,
                        stringTypeInfo.typeRef,
                    ),
                    module.i32.const(0),
                ],
                binaryen.i32,
            ),
        ),
        module.return(
            module.f64.convert_s.i32(
                module.local.get(matchedPosIdx, binaryen.i32),
            ),
        ),
    ]);
    statementArray.push(findPattern);
    return module.block('search', statementArray);
}

function Array_isArray(module: binaryen.Module) {
    const param = module.local.get(1, binaryen.anyref);
    const statementArray: binaryen.ExpressionRef[] = [];

    const setDefault = module.local.set(2, module.i32.const(0));
    const setTrue = module.local.set(2, module.i32.const(1));
    const returnStmt = module.return(module.local.get(2, binaryen.i32));

    const dynTypeIsArray = module.call(
        dyntype.dyntype_is_array,
        [module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t), param],
        dyntype.bool,
    );
    const is_any_array = module.if(
        module.i32.eq(dynTypeIsArray, dyntype.bool_true),
        setTrue,
    );

    statementArray.push(setDefault);
    statementArray.push(is_any_array);
    statementArray.push(returnStmt);

    return module.block(null, statementArray);
}

export function callBuiltInAPIs(module: binaryen.Module) {
    /** Math.sqrt */
    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.mathSqrtFuncName,
        ),
        binaryen.createType([emptyStructType.typeRef, binaryen.f64]),
        binaryen.f64,
        [],
        module.f64.sqrt(module.local.get(1, binaryen.f64)),
    );
    /** Math.abs */
    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.mathAbsFuncName,
        ),
        binaryen.createType([emptyStructType.typeRef, binaryen.f64]),
        binaryen.f64,
        [],
        module.f64.abs(module.local.get(1, binaryen.f64)),
    );
    /** Math.ceil */
    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.mathCeilFuncName,
        ),
        binaryen.createType([emptyStructType.typeRef, binaryen.f64]),
        binaryen.f64,
        [],
        module.f64.ceil(module.local.get(1, binaryen.f64)),
    );
    /** Math.floor */
    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.mathFloorFuncName,
        ),
        binaryen.createType([emptyStructType.typeRef, binaryen.f64]),
        binaryen.f64,
        [],
        module.f64.floor(module.local.get(1, binaryen.f64)),
    );
    /** Math.trunc */
    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.mathTruncFuncName,
        ),
        binaryen.createType([emptyStructType.typeRef, binaryen.f64]),
        binaryen.f64,
        [],
        module.f64.trunc(module.local.get(1, binaryen.f64)),
    );
    /** Array.isArray */
    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.arrayIsArrayFuncName,
        ),
        binaryen.createType([emptyStructType.typeRef, binaryen.anyref]),
        binaryen.i32,
        [binaryen.i32],
        Array_isArray(module),
    );
    /** string */
    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.stringConcatFuncName,
        ),
        binaryen.createType([
            emptyStructType.typeRef,
            stringTypeInfo.typeRef,
            stringArrayTypeInfo.typeRef,
        ]),
        stringTypeInfo.typeRef,
        [binaryen.i32, binaryen.i32, charArrayTypeInfo.typeRef, binaryen.i32],
        string_concat(module),
    );
    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.stringSliceFuncName,
        ),
        binaryen.createType([
            emptyStructType.typeRef,
            stringTypeInfo.typeRef,
            binaryen.anyref,
            binaryen.anyref,
        ]),
        stringTypeInfo.typeRef,
        [binaryen.i32, binaryen.i32, charArrayTypeInfo.typeRef],
        string_slice(module),
    );
    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.stringEQFuncName,
        ),
        binaryen.createType([stringTypeInfo.typeRef, stringTypeInfo.typeRef]),
        binaryen.i32,
        [binaryen.i32],
        string_eq(module),
    );
    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.stringIndexOfInternalFuncName,
        ),
        binaryen.createType([
            emptyStructType.typeRef,
            stringTypeInfo.typeRef,
            stringTypeInfo.typeRef,
            binaryen.i32,
        ]),
        binaryen.i32,
        [binaryen.i32, binaryen.i32, binaryen.i32, binaryen.i32, binaryen.i32],
        string_indexOf_internal(module),
    );
    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.stringIndexOfFuncName,
        ),
        binaryen.createType([
            emptyStructType.typeRef,
            stringTypeInfo.typeRef,
            stringTypeInfo.typeRef,
        ]),
        binaryen.f64,
        [binaryen.i32, binaryen.i32, binaryen.i32],
        string_indexOf(module),
    );

    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.stringReplaceFuncName,
        ),
        binaryen.createType([
            emptyStructType.typeRef,
            stringTypeInfo.typeRef,
            stringTypeInfo.typeRef,
            stringTypeInfo.typeRef,
        ]),
        stringTypeInfo.typeRef,
        [charArrayTypeInfo.typeRef, binaryen.i32],
        string_replace(module),
    );

    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.stringSplitFuncName,
        ),
        binaryen.createType([
            emptyStructType.typeRef,
            stringTypeInfo.typeRef,
            stringTypeInfo.typeRef,
        ]),
        stringArrayTypeInfo.typeRef,
        [
            binaryen.i32,
            binaryen.i32,
            binaryen.i32,
            binaryen.i32,
            binaryen.i32,
            stringArrayTypeInfo.typeRef,
            binaryen.i32,
            charArrayTypeInfo.typeRef,
            binaryen.i32,
        ],
        string_split(module),
    );
    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.stringMatchFuncName,
        ),
        binaryen.createType([
            emptyStructType.typeRef,
            stringTypeInfo.typeRef,
            stringTypeInfo.typeRef,
        ]),
        stringArrayTypeInfo.typeRef,
        [
            binaryen.i32,
            stringArrayTypeInfo.typeRef,
            binaryen.i32,
            binaryen.i32,
            charArrayTypeInfo.typeRef,
            binaryen.i32,
            binaryen.i32,
        ],
        string_match(module),
    );
    module.addFunction(
        getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.stringSearchFuncName,
        ),
        binaryen.createType([
            emptyStructType.typeRef,
            stringTypeInfo.typeRef,
            stringTypeInfo.typeRef,
        ]),
        binaryen.f64,
        [binaryen.i32, binaryen.f64],
        string_search(module),
    );
    /** TODO: */
    /** array */
}

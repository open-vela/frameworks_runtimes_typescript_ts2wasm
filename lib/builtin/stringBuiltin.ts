import binaryen from 'binaryen';
import * as binaryenCAPI from '../../src/glue/binaryen.js';
import { arrayToPtr } from '../../src/glue/transform.js';
import { BuiltinNames } from './builtinUtil.js';
import { charArrayTypeInfo, stringTypeInfo } from '../../src/glue/packType.js';

function length(module: binaryen.Module) {
    const strStruct = module.local.get(0, stringTypeInfo.typeRef);
    const strArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        1,
        strStruct,
        charArrayTypeInfo.typeRef,
        false,
    );
    const strArrayLen = binaryenCAPI._BinaryenArrayLen(module.ptr, strArray);
    return strArrayLen;
}

function concat(module: binaryen.Module) {
    const strStruct1 = module.local.get(0, stringTypeInfo.typeRef);
    const strStruct2 = module.local.get(1, stringTypeInfo.typeRef);
    const strArray1 = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        1,
        strStruct1,
        charArrayTypeInfo.typeRef,
        false,
    );
    const strArray2 = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        1,
        strStruct2,
        charArrayTypeInfo.typeRef,
        false,
    );
    const str1Len = module.call(
        BuiltinNames.string_length_func,
        [strStruct1],
        binaryen.i32,
    );
    const str2Len = module.call(
        BuiltinNames.string_length_func,
        [strStruct2],
        binaryen.i32,
    );
    const statementArray: binaryen.ExpressionRef[] = [];
    const newStrLen = module.i32.add(str1Len, str2Len);
    const newStrArrayIndex = 2;
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
    const arrayCopyStatement1 = binaryenCAPI._BinaryenArrayCopy(
        module.ptr,
        module.local.get(newStrArrayIndex, newStrArrayType),
        module.i32.const(0),
        strArray1,
        module.i32.const(0),
        str1Len,
    );
    const arrayCopyStatement2 = binaryenCAPI._BinaryenArrayCopy(
        module.ptr,
        module.local.get(newStrArrayIndex, newStrArrayType),
        str1Len,
        strArray2,
        module.i32.const(0),
        str2Len,
    );
    const newStrStruct = binaryenCAPI._BinaryenStructNew(
        module.ptr,
        arrayToPtr([
            module.i32.const(0),
            module.local.get(newStrArrayIndex, newStrArrayType),
        ]).ptr,
        2,
        stringTypeInfo.heapTypeRef,
    );
    statementArray.push(newStrArrayStatement);
    statementArray.push(arrayCopyStatement1);
    statementArray.push(arrayCopyStatement2);
    statementArray.push(module.return(newStrStruct));
    const concatBlock = module.block('concat', statementArray);
    return concatBlock;
}

function slice(module: binaryen.Module) {
    const strStruct = module.local.get(0, stringTypeInfo.typeRef);
    const start = module.local.get(1, binaryen.i32);
    const end = module.local.get(2, binaryen.i32);
    const strArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        1,
        strStruct,
        charArrayTypeInfo.typeRef,
        false,
    );
    const newStrLen = module.i32.sub(end, start);
    const statementArray: binaryen.ExpressionRef[] = [];
    const newStrArrayIndex = 3;
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
    const arrayCopyStatement = binaryenCAPI._BinaryenArrayCopy(
        module.ptr,
        module.local.get(newStrArrayIndex, newStrArrayType),
        module.i32.const(0),
        strArray,
        start,
        newStrLen,
    );
    const newStrStruct = binaryenCAPI._BinaryenStructNew(
        module.ptr,
        arrayToPtr([
            module.i32.const(0),
            module.local.get(newStrArrayIndex, newStrArrayType),
        ]).ptr,
        2,
        stringTypeInfo.heapTypeRef,
    );
    statementArray.push(newStrArrayStatement);
    statementArray.push(arrayCopyStatement);
    statementArray.push(module.return(newStrStruct));
    const sliceBlock = module.block('slice', statementArray);
    return sliceBlock;
}

export function initStringBuiltin(module: binaryen.Module) {
    // init length function
    module.addFunction(
        BuiltinNames.string_length_func,
        binaryen.createType([stringTypeInfo.typeRef]),
        binaryen.i32,
        [],
        length(module),
    );

    // init concat function
    module.addFunction(
        BuiltinNames.string_concat_func,
        binaryen.createType([stringTypeInfo.typeRef, stringTypeInfo.typeRef]),
        stringTypeInfo.typeRef,
        [charArrayTypeInfo.typeRef],
        concat(module),
    );

    // init slice function
    module.addFunction(
        BuiltinNames.string_slice_func,
        binaryen.createType([
            stringTypeInfo.typeRef,
            binaryen.i32,
            binaryen.i32,
        ]),
        stringTypeInfo.typeRef,
        [],
        slice(module),
    );
}

import binaryen from 'binaryen';
import { VariableInfo, AssignKind } from '../../src/utils.js';
import { GlobalScope, FunctionScope, BlockScope } from '../../src/scope.js';
import * as binaryenCAPI from '../../src/glue/binaryen.js';
import { arrayToPtr } from '../../src/glue/transform.js';
import {
    STRING_LENGTH_FUNC,
    STRING_CONCAT_FUNC,
    STRING_SLICE_FUNC,
} from '../../src/glue/utils.js';
import {
    strArrayTypeInfo,
    strStructTypeInfo,
} from '../../src/glue/packType.js';

function length(module: binaryen.Module, lengthFunctionScope: FunctionScope) {
    const strStructValueInfo = lengthFunctionScope.findVariable('strStruct')!;
    const strStruct = module.local.get(
        strStructValueInfo.variableIndex,
        strStructValueInfo.variableType,
    );
    const strArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        1,
        strStruct,
        strArrayTypeInfo.typeRef,
        false,
    );
    const strArrayLen = binaryenCAPI._BinaryenArrayLen(module.ptr, strArray);
    return strArrayLen;
}

function concat(module: binaryen.Module, concatBlockScope: BlockScope) {
    const strStructValueInfo1 = concatBlockScope.findVariable('strStruct1')!;
    const strStruct1 = module.local.get(
        strStructValueInfo1.variableIndex,
        strStructValueInfo1.variableType,
    );
    const strStructValueInfo2 = concatBlockScope.findVariable('strStruct2')!;
    const strStruct2 = module.local.get(
        strStructValueInfo2.variableIndex,
        strStructValueInfo2.variableType,
    );
    const strArray1 = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        1,
        strStruct1,
        strArrayTypeInfo.typeRef,
        false,
    );
    const strArray2 = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        1,
        strStruct2,
        strArrayTypeInfo.typeRef,
        false,
    );
    const str1Len = module.call(STRING_LENGTH_FUNC, [strStruct1], binaryen.i32);
    const str2Len = module.call(STRING_LENGTH_FUNC, [strStruct2], binaryen.i32);
    const newStrLen = module.i32.add(str1Len, str2Len);
    const newStrArray = concatBlockScope.findVariable('newStrArray')!;
    const newStrArrayStatement = module.local.set(
        newStrArray.variableIndex,
        binaryenCAPI._BinaryenArrayNew(
            module.ptr,
            strArrayTypeInfo.heapTypeRef,
            newStrLen,
            module.i32.const(0),
        ),
    );
    const arrayCopyStatement1 = binaryenCAPI._BinaryenArrayCopy(
        module.ptr,
        module.local.get(newStrArray.variableIndex, newStrArray.variableType),
        module.i32.const(0),
        strArray1,
        module.i32.const(0),
        str1Len,
    );
    const arrayCopyStatement2 = binaryenCAPI._BinaryenArrayCopy(
        module.ptr,
        module.local.get(newStrArray.variableIndex, newStrArray.variableType),
        str1Len,
        strArray2,
        module.i32.const(0),
        str2Len,
    );
    const newStrStruct = binaryenCAPI._BinaryenStructNew(
        module.ptr,
        arrayToPtr([
            module.i32.const(0),
            module.local.get(
                newStrArray.variableIndex,
                newStrArray.variableType,
            ),
        ]).ptr,
        2,
        strStructTypeInfo.heapTypeRef,
    );
    concatBlockScope.addStatement(newStrArrayStatement);
    concatBlockScope.addStatement(arrayCopyStatement1);
    concatBlockScope.addStatement(arrayCopyStatement2);
    concatBlockScope.addStatement(module.return(newStrStruct));
    const concatBlock = module.block(
        'concat',
        concatBlockScope.getStatementArray(),
    );
    return concatBlock;
}

function slice(module: binaryen.Module, sliceBlockScope: BlockScope) {
    const strStructValueInfo = sliceBlockScope.findVariable('strStruct')!;
    const strStruct = module.local.get(
        strStructValueInfo.variableIndex,
        strStructValueInfo.variableType,
    );
    const startValueInfo = sliceBlockScope.findVariable('start')!;
    const start = module.local.get(
        startValueInfo.variableIndex,
        startValueInfo.variableType,
    );
    const endValueInfo = sliceBlockScope.findVariable('end')!;
    const end = module.local.get(
        endValueInfo.variableIndex,
        endValueInfo.variableType,
    );
    const strArray = binaryenCAPI._BinaryenStructGet(
        module.ptr,
        1,
        strStruct,
        strArrayTypeInfo.typeRef,
        false,
    );
    const newStrLen = module.i32.sub(end, start);
    const newStrArray = sliceBlockScope.findVariable('newStrArray')!;
    const newStrArrayStatement = module.local.set(
        newStrArray.variableIndex,
        binaryenCAPI._BinaryenArrayNew(
            module.ptr,
            strArrayTypeInfo.heapTypeRef,
            newStrLen,
            module.i32.const(0),
        ),
    );
    const arrayCopyStatement = binaryenCAPI._BinaryenArrayCopy(
        module.ptr,
        module.local.get(newStrArray.variableIndex, newStrArray.variableType),
        module.i32.const(0),
        strArray,
        start,
        newStrLen,
    );
    const newStrStruct = binaryenCAPI._BinaryenStructNew(
        module.ptr,
        arrayToPtr([
            module.i32.const(0),
            module.local.get(
                newStrArray.variableIndex,
                newStrArray.variableType,
            ),
        ]).ptr,
        2,
        strStructTypeInfo.heapTypeRef,
    );
    sliceBlockScope.addStatement(newStrArrayStatement);
    sliceBlockScope.addStatement(arrayCopyStatement);
    sliceBlockScope.addStatement(module.return(newStrStruct));
    const sliceBlock = module.block(
        'slice',
        sliceBlockScope.getStatementArray(),
    );
    return sliceBlock;
}

export function initStringBuiltin(
    module: binaryen.Module,
    gloalScope: GlobalScope,
) {
    // init length function
    const lengthFunctionScope = new FunctionScope(gloalScope);
    lengthFunctionScope.setFuncName(STRING_LENGTH_FUNC);
    lengthFunctionScope.setReturnType(binaryen.i32);
    const lengthParam: VariableInfo = {
        variableName: 'strStruct',
        variableType: strStructTypeInfo.typeRef,
        variableIndex: 0,
        variableInitial: undefined,
        variableAssign: AssignKind.default,
    };
    lengthFunctionScope.addParameter(lengthParam);
    module.addFunction(
        lengthFunctionScope.getFuncName(),
        binaryen.createType(
            lengthFunctionScope
                .getParamArray()
                .map(
                    (param: { variableType: binaryen.Type }) =>
                        param.variableType,
                ),
        ),
        lengthFunctionScope.getReturnType(),
        lengthFunctionScope
            .getVariableArray()
            .map(
                (variable: { variableType: binaryen.Type }) =>
                    variable.variableType,
            ),
        length(module, lengthFunctionScope),
    );
    // init concat function
    const concatFunctionScope = new FunctionScope(gloalScope);
    concatFunctionScope.setFuncName(STRING_CONCAT_FUNC);
    concatFunctionScope.setReturnType(strStructTypeInfo.typeRef);
    const concatParam1: VariableInfo = {
        variableName: 'strStruct1',
        variableType: strStructTypeInfo.typeRef,
        variableIndex: 0,
        variableInitial: undefined,
        variableAssign: AssignKind.default,
    };
    const concatParam2: VariableInfo = {
        variableName: 'strStruct2',
        variableType: strStructTypeInfo.typeRef,
        variableIndex: 1,
        variableInitial: undefined,
        variableAssign: AssignKind.default,
    };
    concatFunctionScope.addParameter(concatParam1);
    concatFunctionScope.addParameter(concatParam2);
    const concatVar: VariableInfo = {
        variableName: 'newStrArray',
        variableType: strArrayTypeInfo.typeRef,
        variableIndex: 2,
        variableInitial: undefined,
        variableAssign: AssignKind.default,
    };
    concatFunctionScope.addVariable(concatVar);
    const concatBlockScope = new BlockScope(concatFunctionScope);
    concatBlockScope.addVariable(concatVar);
    module.addFunction(
        concatFunctionScope.getFuncName(),
        binaryen.createType(
            concatFunctionScope
                .getParamArray()
                .map(
                    (param: { variableType: binaryen.Type }) =>
                        param.variableType,
                ),
        ),
        concatFunctionScope.getReturnType(),
        concatFunctionScope
            .getVariableArray()
            .map(
                (variable: { variableType: binaryen.Type }) =>
                    variable.variableType,
            ),
        concat(module, concatBlockScope),
    );
    // init slice function
    const sliceFunctionScope = new FunctionScope(gloalScope);
    sliceFunctionScope.setFuncName(STRING_SLICE_FUNC);
    sliceFunctionScope.setReturnType(strStructTypeInfo.typeRef);
    const sliceParam1: VariableInfo = {
        variableName: 'strStruct',
        variableType: strStructTypeInfo.typeRef,
        variableIndex: 0,
        variableInitial: undefined,
        variableAssign: AssignKind.default,
    };
    const sliceParam2: VariableInfo = {
        variableName: 'start',
        variableType: binaryen.i32,
        variableIndex: 1,
        variableInitial: undefined,
        variableAssign: AssignKind.default,
    };
    const sliceParam3: VariableInfo = {
        variableName: 'end',
        variableType: binaryen.i32,
        variableIndex: 2,
        variableInitial: undefined,
        variableAssign: AssignKind.default,
    };
    sliceFunctionScope.addParameter(sliceParam1);
    sliceFunctionScope.addParameter(sliceParam2);
    sliceFunctionScope.addParameter(sliceParam3);
    const sliceVar: VariableInfo = {
        variableName: 'newStrArray',
        variableType: strArrayTypeInfo.typeRef,
        variableIndex: 3,
        variableInitial: undefined,
        variableAssign: AssignKind.default,
    };
    sliceFunctionScope.addVariable(sliceVar);
    const sliceBlockScope = new BlockScope(sliceFunctionScope);
    sliceBlockScope.addVariable(sliceVar);
    module.addFunction(
        sliceFunctionScope.getFuncName(),
        binaryen.createType(
            sliceFunctionScope
                .getParamArray()
                .map(
                    (param: { variableType: binaryen.Type }) =>
                        param.variableType,
                ),
        ),
        sliceFunctionScope.getReturnType(),
        sliceFunctionScope
            .getVariableArray()
            .map(
                (variable: { variableType: binaryen.Type }) =>
                    variable.variableType,
            ),
        slice(module, sliceBlockScope),
    );
}

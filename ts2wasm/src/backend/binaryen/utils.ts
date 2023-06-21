import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import ts from 'typescript';
import { BuiltinNames } from '../../../lib/builtin/builtin_name.js';
import { UnimplementError } from '../../error.js';
import { TypeKind } from '../../type.js';
import { dyntype } from './lib/dyntype/utils.js';
import { stringTypeInfo } from './glue/packType.js';

/** typeof an any type object */
export const enum DynType {
    DynUnknown,
    DynNull,
    DynUndefined,
    DynObject,
    DynBoolean,
    DynNumber,
    DynString,
    DynFunction,
    DynSymbol,
    DynBigInt,
    DynExtRefObj,
    DynExtRefFunc,
    DynExtRefInfc,
    DynExtRefArray,
}

export interface FlattenLoop {
    label: string;
    condition?: binaryen.ExpressionRef;
    statements: binaryen.ExpressionRef;
    incrementor?: binaryen.ExpressionRef;
}

export interface IfStatementInfo {
    condition: binaryen.ExpressionRef;
    ifTrue: binaryen.ExpressionRef;
    ifFalse: binaryen.ExpressionRef;
}

export function flattenLoopStatement(
    loopStatementInfo: FlattenLoop,
    kind: ts.SyntaxKind,
    module: binaryen.Module,
): binaryen.ExpressionRef {
    const condition = loopStatementInfo.condition || module.i32.const(1);
    const ifStatementInfo: IfStatementInfo = {
        condition: condition,
        ifTrue: binaryen.none,
        ifFalse: binaryen.none,
    };
    if (kind !== ts.SyntaxKind.DoStatement) {
        const ifTrueBlockArray: binaryen.ExpressionRef[] = [];
        if (loopStatementInfo.statements !== binaryen.none) {
            ifTrueBlockArray.push(loopStatementInfo.statements);
        }
        if (
            kind === ts.SyntaxKind.ForStatement &&
            loopStatementInfo.incrementor
        ) {
            ifTrueBlockArray.push(
                <binaryen.ExpressionRef>loopStatementInfo.incrementor,
            );
        }
        ifTrueBlockArray.push(module.br(loopStatementInfo.label));
        const ifTrueBlock = module.block(null, ifTrueBlockArray);
        ifStatementInfo.ifTrue = ifTrueBlock;
        return module.if(ifStatementInfo.condition, ifStatementInfo.ifTrue);
    } else {
        ifStatementInfo.ifTrue = module.br(loopStatementInfo.label);
        const blockArray: binaryen.ExpressionRef[] = [];
        if (loopStatementInfo.statements !== binaryen.none) {
            blockArray.push(loopStatementInfo.statements);
        }
        const ifExpression = module.if(
            ifStatementInfo.condition,
            ifStatementInfo.ifTrue,
        );
        blockArray.push(ifExpression);
        return module.block(null, blockArray);
    }
}

export function addWatFuncs(
    watModule: binaryen.Module,
    funcName: string,
    curModule: binaryen.Module,
) {
    const funcRef = watModule.getFunction(funcName);
    const funcInfo = binaryen.getFunctionInfo(funcRef);
    curModule.addFunction(
        funcInfo.name,
        funcInfo.params,
        funcInfo.results,
        funcInfo.vars,
        curModule.copyExpression(funcInfo.body),
    );
}

export function getClassNameByTypeKind(typeKind: TypeKind): string {
    switch (typeKind) {
        case TypeKind.BOOLEAN:
            return BuiltinNames.BOOLEAN;
        case TypeKind.NUMBER:
            return BuiltinNames.NUMBER;
        case TypeKind.FUNCTION:
            return BuiltinNames.FUNCTION;
        case TypeKind.STRING:
            return BuiltinNames.STRING;
        case TypeKind.ARRAY:
            return BuiltinNames.ARRAY;
        default:
            throw new UnimplementError('unimplement type class: ${typeKind}');
    }
}

export function unboxAnyTypeToBaseType(
    module: binaryen.Module,
    anyExprRef: binaryen.ExpressionRef,
    typeKind: TypeKind,
) {
    let condFuncName = '';
    let cvtFuncName = '';
    let binaryenType: binaryen.Type;
    if (typeKind === TypeKind.ANY) {
        return anyExprRef;
    }
    switch (typeKind) {
        case TypeKind.NULL: {
            condFuncName = dyntype.dyntype_is_null;
            binaryenType = binaryen.eqref;
            break;
        }
        case TypeKind.UNDEFINED: {
            condFuncName = dyntype.dyntype_is_undefined;
            cvtFuncName = dyntype.dyntype_new_undefined;
            binaryenType = binaryen.anyref;
            break;
        }
        case TypeKind.NUMBER: {
            condFuncName = dyntype.dyntype_is_number;
            cvtFuncName = dyntype.dyntype_to_number;
            binaryenType = binaryen.f64;
            break;
        }
        case TypeKind.BOOLEAN: {
            condFuncName = dyntype.dyntype_is_bool;
            cvtFuncName = dyntype.dyntype_to_bool;
            binaryenType = binaryen.i32;
            break;
        }
        case TypeKind.STRING: {
            condFuncName = dyntype.dyntype_is_string;
            cvtFuncName = dyntype.dyntype_to_string;
            binaryenType = dyntype.dyn_value_t;
            break;
        }
        default: {
            throw Error(
                `unboxing any type to static type, unsupported static type : ${typeKind}`,
            );
        }
    }
    const isBaseTypeRef = module.call(
        condFuncName,
        [
            module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
            anyExprRef,
        ],
        dyntype.bool,
    );
    // iff True
    let value: binaryen.ExpressionRef;
    if (typeKind === TypeKind.NULL) {
        value = binaryenCAPI._BinaryenRefNull(
            module.ptr,
            binaryenCAPI._BinaryenTypeStructref(),
        );
    } else {
        const dynParam = [
            module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
            anyExprRef,
        ];
        if (typeKind === TypeKind.UNDEFINED) {
            dynParam.pop();
        }
        value = module.call(cvtFuncName, dynParam, binaryenType);
    }
    if (typeKind === TypeKind.STRING) {
        const wasmStringType = stringTypeInfo.typeRef;
        const string_value = value;
        value = binaryenCAPI._BinaryenRefCast(
            module.ptr,
            string_value,
            wasmStringType,
        );
    }
    // iff False
    const unreachableRef = module.unreachable();

    const blockStmt = module.if(isBaseTypeRef, value, unreachableRef);
    return module.block(null, [blockStmt], binaryenType);
}

export function isBaseType(
    module: binaryen.Module,
    anyExprRef: binaryen.ExpressionRef,
    condFuncName: string,
) {
    return module.call(
        condFuncName,
        [
            module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
            anyExprRef,
        ],
        dyntype.bool,
    );
}

export function getFuncName(
    moduleName: string,
    funcName: string,
    delimiter = '|',
) {
    return moduleName.concat(delimiter).concat(funcName);
}

export const wasmStringMap = new Map<string, number>();
export function getCString(str: string) {
    if (wasmStringMap.has(str)) {
        return wasmStringMap.get(str) as number;
    }
    const wasmStr = binaryenCAPI._malloc(str.length + 1);
    let index = wasmStr;
    // consider UTF-8 only
    for (let i = 0; i < str.length; i++) {
        binaryenCAPI.__i32_store8(index++, str.codePointAt(i) as number);
    }
    binaryenCAPI.__i32_store8(index, 0);
    wasmStringMap.set(str, wasmStr);
    return wasmStr;
}

export function clearWasmStringMap() {
    wasmStringMap.clear();
}

export function processEscape(str: string) {
    const escapes1 = ['"', "'", '\\'];
    const escapes2 = ['n', 'r', 't', 'b', 'f'];
    const appendingStr = ['\n', '\r', '\t', '\b', '\f'];
    let newStr = '';
    for (let i = 0; i < str.length; i++) {
        if (
            str[i] == '\\' &&
            i < str.length - 1 &&
            (escapes1.includes(str[i + 1]) || escapes2.includes(str[i + 1]))
        ) {
            if (escapes1.includes(str[i + 1])) {
                newStr += str[i + 1];
            } else if (escapes2.includes(str[i + 1])) {
                newStr += appendingStr[escapes2.indexOf(str[i + 1])];
            }
            i += 1;
            continue;
        }
        if (escapes1.includes(str[i]) && (i == 0 || i == str.length - 1)) {
            continue;
        }
        newStr += str[i];
    }
    return newStr;
}

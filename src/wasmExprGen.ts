import ts from 'typescript';
import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import {
    Primitive,
    TSArray,
    TSClass,
    TSFunction,
    Type,
    TypeKind,
} from './type.js';
import { ModifierKind, Variable } from './variable.js';
import {
    BinaryExpression,
    CallExpression,
    ConditionalExpression,
    Expression,
    IdentifierExpression,
    NewExpression,
    NumberLiteralExpression,
    StringLiteralExpression,
    SuperCallExpression,
    UnaryExpression,
    ArrayLiteralExpression,
    ObjectLiteralExpression,
    PropertyAccessExpression,
    ElementAccessExpression,
    AsExpression,
} from './expression.js';
import { arrayToPtr, emptyStructType } from './glue/transform.js';
import { assert } from 'console';
import {
    FunctionScope,
    GlobalScope,
    ClassScope,
    ScopeKind,
    funcDefs,
    findTargetFunction,
} from './scope.js';
import { MatchKind, Stack } from './utils.js';
import * as dyntype from '../lib/dyntype/utils.js';
import { BuiltinNames } from '../lib/builtin/builtinUtil.js';
import {
    charArrayTypeInfo,
    stringTypeInfo,
    objectStructTypeInfo,
} from './glue/packType.js';
import { typeInfo } from './glue/utils.js';
import { isDynFunc, getReturnTypeRef } from './envInit.js';
import { varIndex, WASMGen } from './wasmGen.js';

export class WASMExpressionBase {
    wasmCompiler;
    module;
    wasmType;
    currentScope;
    statementArray: binaryen.ExpressionRef[];
    globalTmpVarStack;
    localTmpVarStack;
    staticValueGen;
    dynValueGen;

    constructor(WASMCompiler: WASMGen) {
        this.wasmCompiler = WASMCompiler;
        this.module = this.wasmCompiler.module;
        this.wasmType = this.wasmCompiler.wasmType;
        this.currentScope = this.wasmCompiler.curScope!;
        this.statementArray = this.wasmCompiler.scopeStateMap.get(
            this.currentScope,
        )!;
        this.globalTmpVarStack = new Stack<string>();
        this.localTmpVarStack = new Stack<string>();
        this.staticValueGen = this.wasmCompiler.wasmExprCompiler;
        this.dynValueGen = this.wasmCompiler.wasmDynExprCompiler;
    }

    setLocalValue(
        variableIndex: number,
        value: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        return this.module.local.set(variableIndex, value);
    }

    getLocalValue(
        variableIndex: number,
        variableType: binaryen.Type,
    ): binaryen.ExpressionRef {
        return this.module.local.get(variableIndex, variableType);
    }

    setGlobalValue(
        variableName: string,
        value: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        return this.module.global.set(variableName, value);
    }

    getGlobalValue(
        variableName: string,
        variableType: binaryen.Type,
    ): binaryen.ExpressionRef {
        return this.module.global.get(variableName, variableType);
    }

    generateTmpVar(prefix: string, typeName = '', varType = new Type()) {
        // add tmp value to current scope
        const tmpNumberName = this.getTmpVariableName(prefix);
        let variableType;
        if (typeName === 'any') {
            variableType = new Primitive('any');
        } else if (typeName === 'address') {
            variableType = new Primitive('boolean');
        } else if (typeName === 'number') {
            variableType = new Primitive('number');
        } else if (typeName === 'boolean') {
            variableType = new Primitive('boolean');
        } else {
            variableType = varType;
        }
        const tmpVar = new Variable(
            tmpNumberName,
            variableType,
            ModifierKind.default,
            -1,
            true,
        );
        this.addVariableToCurrentScope(tmpVar);
        return tmpVar;
    }

    getTmpVariableName(prefix: string) {
        const currentScope = this.currentScope;
        let tmpVariableName: string;
        if (currentScope.kind === ScopeKind.GlobalScope) {
            tmpVariableName = prefix + this.globalTmpVarStack.size();
            this.globalTmpVarStack.push(tmpVariableName);
        } else {
            tmpVariableName = prefix + this.localTmpVarStack.size();
            this.localTmpVarStack.push(tmpVariableName);
        }
        return tmpVariableName;
    }

    addVariableToCurrentScope(variable: Variable) {
        const currentScope = this.currentScope!;
        let variableIndex: number;
        if (currentScope.kind === ScopeKind.GlobalScope) {
            variableIndex = (<GlobalScope>currentScope).startFuncVarArray
                .length;
            variable.setVarIndex(variableIndex);
            const globalScope = <GlobalScope>currentScope;
            globalScope.addStartFuncVar(variable);
        } else {
            const nearestFunctionScope = currentScope.getNearestFunctionScope();
            const funcScope = <FunctionScope>nearestFunctionScope!;
            variableIndex =
                funcScope.paramArray.length + funcScope.varArray.length;
            variable.setVarIndex(variableIndex);
            funcScope.addVariable(variable);
        }
    }

    setVariableToCurrentScope(
        variable: Variable,
        value: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        return this.module.local.set(variable.varIndex, value);
    }

    getVariableValue(variable: Variable, type: binaryen.Type) {
        return this.getLocalValue(variable.varIndex, type);
    }

    convertTypeToI32(
        expression: binaryen.ExpressionRef,
        expressionType: binaryen.Type,
    ): binaryen.ExpressionRef {
        const module = this.module;
        switch (expressionType) {
            case binaryen.f64: {
                return module.i32.trunc_u_sat.f64(expression);
            }
            case binaryen.i32: {
                return expression;
            }
            // TODO: deal with more types
        }
        return binaryen.none;
    }

    convertTypeToI64(
        expression: binaryen.ExpressionRef,
        expressionType: binaryen.Type,
    ): binaryen.ExpressionRef {
        const module = this.module;
        switch (expressionType) {
            case binaryen.f64: {
                return module.i64.trunc_u_sat.f64(expression);
            }
            case binaryen.i64: {
                return expression;
            }
            // TODO: deal with more types
        }
        return binaryen.none;
    }

    convertTypeToF64(
        expression: binaryen.ExpressionRef,
        expressionType: binaryen.Type,
    ): binaryen.ExpressionRef {
        const module = this.module;
        switch (expressionType) {
            case binaryen.i32: {
                return module.f64.convert_u.i32(expression);
            }
            case binaryen.i64: {
                return module.f64.convert_u.i64(expression);
            }
            // TODO: deal with more types
        }
        return binaryen.none;
    }

    operateF64F64(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        switch (operatorKind) {
            case ts.SyntaxKind.PlusToken: {
                return module.f64.add(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.MinusToken: {
                return module.f64.sub(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.AsteriskToken: {
                return module.f64.mul(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.SlashToken: {
                return module.f64.div(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.GreaterThanToken: {
                return module.f64.gt(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.GreaterThanEqualsToken: {
                return module.f64.ge(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.LessThanToken: {
                return module.f64.lt(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.LessThanEqualsToken: {
                return module.f64.le(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.LessThanLessThanToken: {
                return this.convertTypeToF64(
                    module.i64.shl(
                        this.convertTypeToI64(leftExprRef, binaryen.f64),
                        this.convertTypeToI64(rightExprRef, binaryen.f64),
                    ),
                    binaryen.i64,
                );
            }
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsEqualsToken: {
                return module.f64.eq(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.ExclamationEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
                return module.f64.ne(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.AmpersandAmpersandToken: {
                return module.select(
                    this.convertTypeToI32(leftExprRef, binaryen.f64),
                    rightExprRef,
                    leftExprRef,
                    binaryen.f64,
                );
            }
            case ts.SyntaxKind.BarBarToken: {
                return module.select(
                    this.convertTypeToI32(leftExprRef, binaryen.f64),
                    leftExprRef,
                    rightExprRef,
                    binaryen.f64,
                );
            }
            case ts.SyntaxKind.AmpersandToken: {
                return this.convertTypeToF64(
                    module.i64.and(
                        this.convertTypeToI64(leftExprRef, binaryen.f64),
                        this.convertTypeToI64(rightExprRef, binaryen.f64),
                    ),
                    binaryen.i64,
                );
            }
            case ts.SyntaxKind.BarToken: {
                return this.convertTypeToF64(
                    module.i64.or(
                        this.convertTypeToI64(leftExprRef, binaryen.f64),
                        this.convertTypeToI64(rightExprRef, binaryen.f64),
                    ),
                    binaryen.i64,
                );
            }
            default:
                return module.unreachable();
        }
    }

    operateF64I32(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        switch (operatorKind) {
            case ts.SyntaxKind.AmpersandAmpersandToken: {
                return module.select(
                    this.convertTypeToI32(leftExprRef, binaryen.f64),
                    rightExprRef,
                    this.convertTypeToI32(leftExprRef, binaryen.f64),
                    binaryen.i32,
                );
            }
            case ts.SyntaxKind.BarBarToken: {
                return module.select(
                    this.convertTypeToI32(leftExprRef, binaryen.f64),
                    this.convertTypeToI32(leftExprRef, binaryen.f64),
                    rightExprRef,
                    binaryen.i32,
                );
            }
            default:
                return module.unreachable();
        }
    }

    operateI32F64(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        switch (operatorKind) {
            case ts.SyntaxKind.AmpersandAmpersandToken: {
                const condition = Boolean(module.i32.eqz(leftExprRef));
                if (condition) {
                    return module.select(
                        leftExprRef,
                        this.convertTypeToI32(rightExprRef, binaryen.f64),
                        leftExprRef,
                        binaryen.i32,
                    );
                } else {
                    return rightExprRef;
                }
            }
            case ts.SyntaxKind.BarBarToken: {
                // if left is false, then condition is true
                const condition = Boolean(module.i32.eqz(leftExprRef));
                if (condition) {
                    return rightExprRef;
                } else {
                    return module.select(
                        leftExprRef,
                        leftExprRef,
                        this.convertTypeToI32(rightExprRef, binaryen.f64),
                        binaryen.i32,
                    );
                }
            }
            default:
                return module.unreachable();
        }
    }

    operateI32I32(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        switch (operatorKind) {
            case ts.SyntaxKind.AmpersandAmpersandToken: {
                return module.select(
                    leftExprRef,
                    rightExprRef,
                    leftExprRef,
                    binaryen.i32,
                );
            }
            case ts.SyntaxKind.BarBarToken: {
                return module.select(
                    leftExprRef,
                    leftExprRef,
                    rightExprRef,
                    binaryen.i32,
                );
            }
            default:
                return module.unreachable();
        }
    }

    operateAnyAny(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        const dynEq = module.call(
            dyntype.dyntype_type_eq,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                leftExprRef,
                rightExprRef,
            ],
            dyntype.bool,
        );
        const dynTypeIsNumber = module.call(
            dyntype.dyntype_is_number,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                leftExprRef,
            ],
            dyntype.bool,
        );

        // address corresponding to binaryen.i32
        const varAndStates = this.generatePointerVar(8);
        const tmpAddressVar = <Variable>varAndStates[0];
        const setTmpAddressExpression = <binaryen.ExpressionRef>varAndStates[1];
        const setTmpGlobalExpression = <binaryen.ExpressionRef>varAndStates[2];
        const resetGlobalExpression = <binaryen.ExpressionRef>varAndStates[3];

        const leftTrunExpression = this.turnDyntypeToNumber(
            leftExprRef,
            tmpAddressVar,
        );
        const rightTrunExpression = this.turnDyntypeToNumber(
            rightExprRef,
            tmpAddressVar,
        );
        const tmpLeftNumberVar = <Variable>leftTrunExpression[0];
        const leftNumberExpression = <binaryen.ExpressionRef>(
            leftTrunExpression[1]
        );
        const tmpRightNumberVar = <Variable>rightTrunExpression[0];
        const rightNumberExpression = <binaryen.ExpressionRef>(
            rightTrunExpression[1]
        );

        const tmpTotalNumberName = this.getTmpVariableName('~numberTotal|');
        const tmpTotalNumberVar: Variable = new Variable(
            tmpTotalNumberName,
            this.currentScope!.namedTypeMap.get('any')!,
            ModifierKind.default,
            0,
        );

        const setTotalNumberExpression = this.oprateF64F64ToDyn(
            this.getVariableValue(tmpLeftNumberVar, binaryen.f64),
            this.getVariableValue(tmpRightNumberVar, binaryen.f64),
            operatorKind,
            tmpTotalNumberVar,
        );

        // add statements to a block
        const getNumberArray: binaryen.ExpressionRef[] = [];
        getNumberArray.push(setTmpAddressExpression);
        getNumberArray.push(setTmpGlobalExpression);
        getNumberArray.push(leftNumberExpression);
        getNumberArray.push(resetGlobalExpression);
        getNumberArray.push(setTmpAddressExpression);
        getNumberArray.push(setTmpGlobalExpression);
        getNumberArray.push(rightNumberExpression);
        getNumberArray.push(resetGlobalExpression);
        getNumberArray.push(setTotalNumberExpression);

        const anyOperation = module.if(
            module.i32.eq(dynEq, dyntype.bool_true),
            module.if(
                module.i32.eq(dynTypeIsNumber, dyntype.bool_true),
                module.block('getNumber', getNumberArray),
            ),
        );
        // store the external operations into currentScope's statementArray
        this.statementArray.push(anyOperation);

        return this.getVariableValue(tmpTotalNumberVar, binaryen.anyref);
    }

    operateAnyNumber(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        const dynTypeIsNumber = module.call(
            dyntype.dyntype_is_number,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                leftExprRef,
            ],
            dyntype.bool,
        );

        // address corresponding to binaryen.i32
        const varAndStates = this.generatePointerVar(8);
        const tmpAddressVar = <Variable>varAndStates[0];
        const setTmpAddressExpression = <binaryen.ExpressionRef>varAndStates[1];
        const setTmpGlobalExpression = <binaryen.ExpressionRef>varAndStates[2];
        const resetGlobalExpression = <binaryen.ExpressionRef>varAndStates[3];

        const leftTrunExpression = this.turnDyntypeToNumber(
            leftExprRef,
            tmpAddressVar,
        );
        const tmpLeftNumberVar = <Variable>leftTrunExpression[0];
        const leftNumberExpression = <binaryen.ExpressionRef>(
            leftTrunExpression[1]
        );
        const tmpTotalNumberName = this.getTmpVariableName('~numberTotal|');
        const tmpTotalNumberVar: Variable = new Variable(
            tmpTotalNumberName,
            this.currentScope!.namedTypeMap.get('any')!,
            ModifierKind.default,
            0,
        );
        const setTotalNumberExpression = this.oprateF64F64ToDyn(
            this.getVariableValue(tmpLeftNumberVar, binaryen.f64),
            rightExprRef,
            operatorKind,
            tmpTotalNumberVar,
        );

        // add statements to a block
        const getNumberArray: binaryen.ExpressionRef[] = [];
        getNumberArray.push(setTmpAddressExpression);
        getNumberArray.push(setTmpGlobalExpression);
        getNumberArray.push(leftNumberExpression);
        getNumberArray.push(resetGlobalExpression);
        getNumberArray.push(setTotalNumberExpression);

        const anyOperation = module.if(
            module.i32.eq(dynTypeIsNumber, dyntype.bool_true),
            module.block('getNumber', getNumberArray),
        );
        // store the external operations into currentScope's statementArray
        this.statementArray.push(anyOperation);
        return this.getVariableValue(tmpTotalNumberVar, binaryen.anyref);
    }

    oprateF64F64ToDyn(
        leftNumberExpression: binaryen.ExpressionRef,
        rightNumberExpression: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
        tmpTotalNumberVar: Variable,
    ) {
        // operate left expression and right expression
        const operateTotalNumber = this.operateF64F64(
            leftNumberExpression,
            rightNumberExpression,
            operatorKind,
        );
        // add tmp total number value to current scope
        this.addVariableToCurrentScope(tmpTotalNumberVar);
        const setTotalNumberExpression = this.setVariableToCurrentScope(
            tmpTotalNumberVar,
            this.generateDynNumber(operateTotalNumber),
        );
        return setTotalNumberExpression;
    }

    defaultValue(typeKind: TypeKind) {
        switch (typeKind) {
            case TypeKind.BOOLEAN:
                return this.module.i32.const(0);
            case TypeKind.NUMBER:
                return this.module.f64.const(0);
            case TypeKind.STRING:
                return binaryenCAPI._BinaryenRefNull(
                    this.module.ptr,
                    emptyStructType.typeRef,
                );
            default:
                // TODO
                return binaryen.none;
        }
    }

    generateStringRef(value: string) {
        const valueLen = value.length;
        let strRelLen = valueLen;
        const charArray = [];
        for (let i = 0; i < valueLen; i++) {
            const codePoint = value.codePointAt(i)!;
            if (codePoint > 0xffff) {
                i++;
                strRelLen--;
            }
            charArray.push(this.module.i32.const(codePoint));
        }
        const valueContent = binaryenCAPI._BinaryenArrayInit(
            this.module.ptr,
            charArrayTypeInfo.heapTypeRef,
            arrayToPtr(charArray).ptr,
            strRelLen,
        );
        const wasmStringValue = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([this.module.i32.const(0), valueContent]).ptr,
            2,
            stringTypeInfo.heapTypeRef,
        );
        return wasmStringValue;
    }

    generatePointerVar(bit: number) {
        const module = this.module;
        const tmpAddressVar = this.generateTmpVar('~address|', 'address');
        const tmpAddressValue = this.getGlobalValue(
            BuiltinNames.stack_pointer,
            binaryen.i32,
        );
        const setTmpAddressExpression = this.setVariableToCurrentScope(
            tmpAddressVar,
            tmpAddressValue,
        );
        const setTmpGlobalExpression = this.setGlobalValue(
            BuiltinNames.stack_pointer,
            module.i32.sub(
                this.getVariableValue(tmpAddressVar, binaryen.i32),
                module.i32.const(bit),
            ),
        );
        const resetGlobalExpression = this.setGlobalValue(
            BuiltinNames.stack_pointer,
            this.getVariableValue(tmpAddressVar, binaryen.i32),
        );
        return [
            tmpAddressVar,
            setTmpAddressExpression,
            setTmpGlobalExpression,
            resetGlobalExpression,
            tmpAddressValue,
        ];
    }

    turnDyntypeToExtref(
        expression: binaryen.ExpressionRef,
        pointer: binaryen.ExpressionRef,
        targetType: Type,
    ) {
        const module = this.module;
        const expressionToExtref = module.call(
            dyntype.dyntype_to_extref,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                expression,
                pointer,
            ],
            dyntype.int,
        );
        const tmpTableIdx = module.i32.load(0, 4, pointer);
        const objOrigValue = module.table.get(
            BuiltinNames.obj_table,
            tmpTableIdx,
            objectStructTypeInfo.typeRef,
        );

        const tmpObjVarInfo = this.generateTmpVar('~obj|', '', targetType);

        // cast ref ${} to target type
        const objTargetValue = binaryenCAPI._BinaryenRefCast(
            module.ptr,
            objOrigValue,
            this.wasmType.getWASMHeapType(targetType),
        );
        const setExtrefExpression = this.setVariableToCurrentScope(
            tmpObjVarInfo,
            objTargetValue,
        );

        const extrefExpression = module.if(
            module.i32.eq(expressionToExtref, dyntype.DYNTYPE_SUCCESS),
            setExtrefExpression,
        );
        return [tmpObjVarInfo, extrefExpression];
    }

    turnDyntypeToNumber(
        expression: binaryen.ExpressionRef,
        tmpAddressVar: Variable,
    ) {
        const module = this.module;
        const numberPointer = this.getVariableValue(
            tmpAddressVar,
            binaryen.i32,
        );
        const expressionToNumber = module.call(
            dyntype.dyntype_to_number,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                expression,
                numberPointer,
            ],
            dyntype.int,
        );
        const tmpNumber = module.f64.load(
            0,
            8,
            this.getVariableValue(tmpAddressVar, binaryen.i32),
        );
        const tmpNumberVar = this.generateTmpVar('~number|', 'number');

        const setNumberExpression = this.setVariableToCurrentScope(
            tmpNumberVar,
            tmpNumber,
        );
        const numberExpression = module.if(
            module.i32.eq(expressionToNumber, dyntype.DYNTYPE_SUCCESS),
            setNumberExpression,
        );
        return [tmpNumberVar, numberExpression];
    }

    generateDynNumber(dynValue: binaryen.ExpressionRef) {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_number,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                dynValue,
            ],
            dyntype.dyn_value_t,
        );
    }

    generateDynBoolean(dynValue: binaryen.ExpressionRef) {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_boolean,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                dynValue,
            ],
            dyntype.dyn_value_t,
        );
    }

    generateDynString(dynValue: binaryen.ExpressionRef) {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_string,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                dynValue,
            ],
            dyntype.dyn_value_t,
        );
    }

    generateDynNull() {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_null,
            [module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t)],
            dyntype.dyn_value_t,
        );
    }

    generateDynUndefined() {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_undefined,
            [module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t)],
            dyntype.dyn_value_t,
        );
    }

    generateDynArray() {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_array,
            [module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t)],
            dyntype.dyn_value_t,
        );
    }

    generateDynObj() {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_object,
            [module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t)],
            dyntype.dyn_value_t,
        );
    }

    generateDynExtref(dynValue: binaryen.ExpressionRef) {
        const module = this.module;
        // cast obj ref type to ref ${}
        const objTarget = binaryenCAPI._BinaryenRefCast(
            module.ptr,
            dynValue,
            objectStructTypeInfo.heapTypeRef,
        );
        // put table index into a local
        const tmpTableIndexVar = this.generateTmpVar('~tableIdx|', 'boolean');
        const setTableIdxExpr = this.setVariableToCurrentScope(
            tmpTableIndexVar,
            module.table.size(BuiltinNames.obj_table),
        );
        this.statementArray.push(setTableIdxExpr);
        const tableCurIndex = this.getVariableValue(
            tmpTableIndexVar,
            binaryen.i32,
        );
        const tableGrowExpr = module.table.grow(
            BuiltinNames.obj_table,
            objTarget,
            module.i32.const(1),
        );
        this.statementArray.push(module.drop(tableGrowExpr));
        const varAndStates = this.generatePointerVar(4);
        const tmpAddressVar = <Variable>varAndStates[0];
        const setTmpAddressExpression = <binaryen.ExpressionRef>varAndStates[1];
        const setTmpGlobalExpression = <binaryen.ExpressionRef>varAndStates[2];
        const tmpAddressValue = <binaryen.ExpressionRef>varAndStates[4];
        this.statementArray.push(setTmpAddressExpression);
        this.statementArray.push(setTmpGlobalExpression);
        const storeIdxExpression = module.i32.store(
            0,
            4,
            tmpAddressValue,
            tableCurIndex,
        );
        this.statementArray.push(storeIdxExpression);
        const numberPointer = this.getVariableValue(
            tmpAddressVar,
            binaryen.i32,
        );
        return module.call(
            dyntype.dyntype_new_extref,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                numberPointer,
                dyntype.ExtObj,
            ],
            dyntype.dyn_value_t,
        );
    }

    getArrayInitFromArrayType(arrayType: TSArray): binaryen.ExpressionRef {
        const module = this.module;
        const elemType = arrayType.elementType;
        switch (elemType.kind) {
            case TypeKind.NUMBER: {
                return module.f64.const(0);
            }
            case TypeKind.STRING: {
                return this.generateStringRef('');
            }
            case TypeKind.BOOLEAN: {
                return module.i32.const(0);
            }
            default: {
                return binaryenCAPI._BinaryenRefNull(
                    module.ptr,
                    binaryen.anyref,
                );
            }
        }
    }
}

export class WASMExpressionGen extends WASMExpressionBase {
    constructor(WASMCompiler: WASMGen) {
        super(WASMCompiler);
    }

    WASMExprGen(expr: Expression): binaryen.ExpressionRef {
        this.module = this.wasmCompiler.module;
        this.wasmType = this.wasmCompiler.wasmType;
        this.currentScope = this.wasmCompiler.curScope!;
        if (this.currentScope === null) {
            throw new Error('currentScope is null in WASMExprGen');
        }
        this.statementArray = this.wasmCompiler.scopeStateMap.get(
            this.currentScope,
        )!;
        if (this.statementArray === undefined) {
            throw new Error('statementArray is undefined in WASMExprGen');
        }
        this.staticValueGen = this.wasmCompiler.wasmExprCompiler;
        this.dynValueGen = this.wasmCompiler.wasmDynExprCompiler;
        switch (expr.expressionKind) {
            case ts.SyntaxKind.NumericLiteral:
                return this.WASMNumberLiteral(<NumberLiteralExpression>expr);
            case ts.SyntaxKind.FalseKeyword:
                return this.module.i32.const(0);
            case ts.SyntaxKind.TrueKeyword:
                return this.module.i32.const(1);
            case ts.SyntaxKind.StringLiteral:
                return this.WASMStringLiteral(<StringLiteralExpression>expr);
            case ts.SyntaxKind.Identifier:
                return this.WASMIdenfierExpr(<IdentifierExpression>expr);
            case ts.SyntaxKind.BinaryExpression:
                return this.WASMBinaryExpr(<BinaryExpression>expr);
            case ts.SyntaxKind.PrefixUnaryExpression:
            case ts.SyntaxKind.PostfixUnaryExpression:
                return this.WASMUnaryExpr(<UnaryExpression>expr);
            case ts.SyntaxKind.ConditionalExpression:
                return this.WASMConditionalExpr(<ConditionalExpression>expr);
            case ts.SyntaxKind.CallExpression: {
                return this.WASMCallExpr(<CallExpression>expr);
            }
            case ts.SyntaxKind.SuperKeyword: {
                return this.WASMSuperExpr(<SuperCallExpression>expr);
            }
            case ts.SyntaxKind.ParenthesizedExpression: {
                // TODO
                return binaryen.none;
            }
            case ts.SyntaxKind.ArrayLiteralExpression:
                return this.WASMArrayLiteralExpr(<ArrayLiteralExpression>expr);
            case ts.SyntaxKind.ObjectLiteralExpression:
                return this.WASMObjectLiteralExpr(
                    <ObjectLiteralExpression>expr,
                );
            case ts.SyntaxKind.PropertyAccessExpression:
                return this.WASMPropertyAccessExpr(
                    <PropertyAccessExpression>expr,
                );
            case ts.SyntaxKind.ElementAccessExpression:
                return this.WASMElementAccessExpr(
                    <ElementAccessExpression>expr,
                );
            case ts.SyntaxKind.NewExpression: {
                return this.WASMNewExpr(<NewExpression>expr);
            }
            case ts.SyntaxKind.AsExpression:
                return this.WASMAsExpr(<AsExpression>expr);
            default:
                return this.module.unreachable();
        }
    }

    private WASMNumberLiteral(
        expr: NumberLiteralExpression,
    ): binaryen.ExpressionRef {
        return this.module.f64.const(expr.expressionValue);
    }

    private WASMStringLiteral(
        expr: StringLiteralExpression,
    ): binaryen.ExpressionRef {
        const value = expr.expressionValue.substring(
            1,
            expr.expressionValue.length - 1,
        );
        return this.generateStringRef(value);
    }

    private WASMIdenfierExpr(
        expr: IdentifierExpression,
    ): binaryen.ExpressionRef {
        const variable = this.currentScope.findVariable(
            expr.identifierName,
            true,
        );
        if (variable === undefined) {
            /* maybe it's a function */
            // const maybeFuncScope = this.currentScope.getNearestFunctionScope();
            const maybeFuncDef = findTargetFunction(
                this.currentScope,
                expr.identifierName,
            );
            if (maybeFuncDef === undefined) {
                throw new Error(
                    'variable not find, name is <' + expr.identifierName + '>',
                );
            }
            const wasmFuncType = this.wasmType.getWASMType(
                maybeFuncDef.funcType,
            );
            const wasmFuncStructHeapType =
                this.wasmType.getWASMFuncStructHeapType(maybeFuncDef.funcType);
            let context = binaryenCAPI._BinaryenRefNull(
                this.module.ptr,
                emptyStructType.typeRef,
            );
            if (maybeFuncDef !== null) {
                const parentScope = maybeFuncDef.parent;
                if (
                    parentScope !== null &&
                    parentScope.kind === ScopeKind.FunctionScope
                ) {
                    const parentContextType = (<typeInfo>(
                        WASMGen.contextOfFunc.get(<FunctionScope>parentScope)
                    )).typeRef;
                    context = this.module.local.get(
                        (<FunctionScope>parentScope).paramArray.length,
                        parentContextType,
                    );
                }
            }
            return binaryenCAPI._BinaryenStructNew(
                this.module.ptr,
                arrayToPtr([
                    context,
                    this.module.ref.func(maybeFuncDef.funcName, wasmFuncType),
                ]).ptr,
                2,
                wasmFuncStructHeapType,
            );
        }
        const varType = this.wasmType.getWASMType(variable.varType);
        /* iff the identifer is global variable
           iff its free GLOBAL variable ==> global.get/set
        */
        if (!variable.isLocalVar) {
            return this.module.global.get(variable.varName, varType);
        }
        /* iff the identifer is free LOCAL variable */
        if (variable.varIsClosure) {
            const nearestFuncScope = <FunctionScope>(
                this.currentScope.getNearestFunctionScope()
            );
            const localGetType = (<typeInfo>(
                WASMGen.contextOfFunc.get(nearestFuncScope)
            )).typeRef;
            /* the first variable index is context struct */
            let localGet = this.module.local.get(
                nearestFuncScope.paramArray.length,
                localGetType,
            );
            let prevFuncScope = nearestFuncScope;
            // iff found in current function scope
            if (this.currentScope.findFunctionScope(expr.identifierName)) {
                return binaryenCAPI._BinaryenStructGet(
                    this.module.ptr,
                    variable.getClosureIndex(),
                    localGet,
                    localGetType,
                    false,
                );
            } else {
                let scope = nearestFuncScope.parent;
                let targetCtxTypeRef = binaryen.none;
                while (scope !== null) {
                    if (scope.kind === ScopeKind.FunctionScope) {
                        const target = scope.findVariable(
                            variable.varName,
                            false,
                        );
                        const funcScope = <FunctionScope>scope;
                        targetCtxTypeRef = (<typeInfo>(
                            WASMGen.contextOfFunc.get(funcScope)
                        )).typeRef;
                        if (prevFuncScope.getIsClosure()) {
                            localGet = binaryenCAPI._BinaryenStructGet(
                                this.module.ptr,
                                0,
                                localGet,
                                targetCtxTypeRef,
                                false,
                            );
                        }
                        if (target !== undefined) {
                            break;
                        }
                        prevFuncScope = funcScope;
                    }
                    scope = scope.parent;
                }
                return binaryenCAPI._BinaryenStructGet(
                    this.module.ptr,
                    variable.getClosureIndex(),
                    localGet,
                    targetCtxTypeRef,
                    false,
                );
            }
        }

        return this.module.local.get(variable.varIndex, varType);
    }

    private WASMBinaryExpr(expr: BinaryExpression): binaryen.ExpressionRef {
        const leftExpr = expr.leftOperand;
        const rightExpr = expr.rightOperand;
        const operatorKind = expr.operatorKind;
        const leftExprType = leftExpr.exprType;
        const rightExprType = rightExpr.exprType;
        const leftExprRef = this.WASMExprGen(leftExpr);
        const rightExprRef = this.WASMExprGen(rightExpr);
        switch (operatorKind) {
            case ts.SyntaxKind.EqualsToken: {
                /*
                 a = b++  ==>
                 block {
                    a = b;
                    b = b + 1;
                 }
                 a = ++b  ==>
                 block {
                    b = b + 1;
                    a = b;
                 }
                */
                const assignWASMExpr = this.assignBinaryExpr(
                    leftExpr,
                    rightExpr,
                    leftExprType,
                    rightExprType,
                    rightExprRef,
                );
                if (
                    rightExpr.expressionKind ===
                        ts.SyntaxKind.PostfixUnaryExpression ||
                    rightExpr.expressionKind ===
                        ts.SyntaxKind.PrefixUnaryExpression
                ) {
                    const unaryExpr = <UnaryExpression>rightExpr;
                    /* iff  ExclamationToken, no need this step*/
                    if (
                        unaryExpr.operatorKind ===
                        ts.SyntaxKind.ExclamationToken
                    ) {
                        return assignWASMExpr;
                    }
                    const operandExpr = unaryExpr.operand;
                    const operandExprType = unaryExpr.operand.exprType;
                    const rightUnaryAssignWASMExpr = this.assignBinaryExpr(
                        leftExpr,
                        operandExpr,
                        leftExprType,
                        operandExprType,
                    );
                    /* a = ++b  ==>
                        block {
                            b = b + 1;
                            a = b;
                        }
                    */
                    if (
                        unaryExpr.expressionKind ===
                        ts.SyntaxKind.PrefixUnaryExpression
                    ) {
                        return this.module.block(null, [
                            rightExprRef,
                            rightUnaryAssignWASMExpr,
                        ]);
                    } else {
                        return this.module.block(null, [
                            rightUnaryAssignWASMExpr,
                            rightExprRef,
                        ]);
                    }
                }
                return assignWASMExpr;
            }
            case ts.SyntaxKind.PlusEqualsToken: {
                const equalTokenRightExpr = new BinaryExpression(
                    ts.SyntaxKind.PlusToken,
                    leftExpr,
                    rightExpr,
                );
                equalTokenRightExpr.setExprType(leftExprType);
                return this.assignBinaryExpr(
                    leftExpr,
                    equalTokenRightExpr,
                    leftExprType,
                    rightExprType,
                );
            }
            case ts.SyntaxKind.MinusEqualsToken: {
                const equalTokenRightExpr = new BinaryExpression(
                    ts.SyntaxKind.MinusToken,
                    leftExpr,
                    rightExpr,
                );
                equalTokenRightExpr.setExprType(leftExprType);
                return this.assignBinaryExpr(
                    leftExpr,
                    equalTokenRightExpr,
                    leftExprType,
                    rightExprType,
                );
            }
            case ts.SyntaxKind.AsteriskEqualsToken: {
                const equalTokenRightExpr = new BinaryExpression(
                    ts.SyntaxKind.AsteriskToken,
                    leftExpr,
                    rightExpr,
                );
                equalTokenRightExpr.setExprType(leftExprType);
                return this.assignBinaryExpr(
                    leftExpr,
                    equalTokenRightExpr,
                    leftExprType,
                    rightExprType,
                );
            }
            case ts.SyntaxKind.SlashEqualsToken: {
                const equalTokenRightExpr = new BinaryExpression(
                    ts.SyntaxKind.SlashToken,
                    leftExpr,
                    rightExpr,
                );
                equalTokenRightExpr.setExprType(leftExprType);
                return this.assignBinaryExpr(
                    leftExpr,
                    equalTokenRightExpr,
                    leftExprType,
                    rightExprType,
                );
            }
            default: {
                return this.operateBinaryExpr(
                    leftExprRef,
                    rightExprRef,
                    operatorKind,
                    leftExprType,
                    rightExprType,
                );
            }
        }
    }

    private operateBinaryExpr(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
        leftExprType: Type,
        rightExprType: Type,
    ): binaryen.ExpressionRef {
        if (
            leftExprType.kind === TypeKind.NUMBER &&
            rightExprType.kind === TypeKind.NUMBER
        ) {
            return this.operateF64F64(leftExprRef, rightExprRef, operatorKind);
        }
        if (
            leftExprType.kind === TypeKind.NUMBER &&
            rightExprType.kind === TypeKind.BOOLEAN
        ) {
            return this.operateF64I32(leftExprRef, rightExprRef, operatorKind);
        }
        if (
            leftExprType.kind === TypeKind.BOOLEAN &&
            rightExprType.kind === TypeKind.NUMBER
        ) {
            return this.operateI32F64(leftExprRef, rightExprRef, operatorKind);
        }
        if (
            leftExprType.kind === TypeKind.BOOLEAN &&
            rightExprType.kind === TypeKind.BOOLEAN
        ) {
            return this.operateI32I32(leftExprRef, rightExprRef, operatorKind);
        }
        if (
            leftExprType.kind === TypeKind.ANY &&
            rightExprType.kind === TypeKind.ANY
        ) {
            return this.operateAnyAny(leftExprRef, rightExprRef, operatorKind);
        }
        if (
            leftExprType.kind === TypeKind.ANY &&
            rightExprType.kind === TypeKind.NUMBER
        ) {
            return this.operateAnyNumber(
                leftExprRef,
                rightExprRef,
                operatorKind,
            );
        }
        if (
            leftExprType.kind === TypeKind.NUMBER &&
            rightExprType.kind === TypeKind.ANY
        ) {
            return this.operateAnyNumber(
                rightExprRef,
                leftExprRef,
                operatorKind,
            );
        }
        return this.module.unreachable();
    }

    private assignBinaryExpr(
        leftExpr: Expression,
        rightExpr: Expression,
        leftExprType: Type,
        rightExprType: Type,
        rightExprRef?: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const matchKind = this.matchType(leftExprType, rightExprType);
        if (matchKind === MatchKind.MisMatch) {
            throw new Error('Type mismatch in ExpressionStatement');
        }
        switch (leftExpr.expressionKind) {
            case ts.SyntaxKind.PropertyAccessExpression: {
                const propAccessExpr = <PropertyAccessExpression>leftExpr;
                let objType: Type;
                if (!propAccessExpr.isThis) {
                    objType = propAccessExpr.propertyAccessExpr.exprType;
                } else {
                    const scope = <FunctionScope>(
                        this.wasmCompiler.curScope?.getNearestFunctionScope()
                    );
                    objType = (<ClassScope>scope.parent).classType;
                }

                // sample: const obj: any = {}; obj.a = 2;
                if (objType.kind === TypeKind.ANY) {
                    const objExprRef = this.WASMExprGen(leftExpr);
                    const propIdenExpr = <IdentifierExpression>(
                        (<PropertyAccessExpression>leftExpr).propertyExpr
                    );
                    const propName = propIdenExpr.identifierName;
                    const initDynValue =
                        this.dynValueGen.WASMDynExprGen(rightExpr);
                    if (propName === '__proto__') {
                        return module.drop(
                            module.call(
                                dyntype.dyntype_set_prototype,
                                [
                                    module.global.get(
                                        dyntype.dyntype_context,
                                        dyntype.dyn_ctx_t,
                                    ),
                                    objExprRef,
                                    this.WASMExprGen(rightExpr),
                                ],
                                dyntype.int,
                            ),
                        );
                    }
                    const propNameRef = this.generateStringRef(propName);
                    const setPropertyExpression = module.drop(
                        module.call(
                            dyntype.dyntype_set_property,
                            [
                                module.global.get(
                                    dyntype.dyntype_context,
                                    dyntype.dyn_ctx_t,
                                ),
                                objExprRef,
                                propNameRef,
                                initDynValue,
                            ],
                            dyntype.int,
                        ),
                    );
                    return setPropertyExpression;
                } else {
                    const objClassType = <TSClass>objType;
                    const propName = (<IdentifierExpression>(
                        propAccessExpr.propertyExpr
                    )).identifierName;
                    const propIndex =
                        objClassType.getMemberFieldIndex(propName);
                    if (propIndex === -1) {
                        throw new Error(propName + ' property does not exist');
                    }
                    let objExprRef: binaryen.ExpressionRef;
                    const targeObjectType =
                        this.wasmType.getWASMType(objClassType);

                    if (propAccessExpr.isThis) {
                        const scope = <FunctionScope>(
                            this.wasmCompiler.curScope?.getNearestFunctionScope()
                        );
                        objExprRef = this.module.local.get(
                            scope.paramArray.length,
                            targeObjectType,
                        );
                    } else {
                        objExprRef = this.WASMExprGen(
                            propAccessExpr.propertyAccessExpr,
                        );
                    }

                    return binaryenCAPI._BinaryenStructSet(
                        module.ptr,
                        propIndex + 1,
                        objExprRef,
                        this.staticValueGen.WASMExprGen(rightExpr),
                    );
                }
            }
            case ts.SyntaxKind.ElementAccessExpression: {
                // sample: a[2] = 8;
                const elementAccessExpr = <ElementAccessExpression>leftExpr;
                const arrayValue = this.WASMExprGen(
                    elementAccessExpr.accessExpr,
                );
                const index = this.convertTypeToI32(
                    this.WASMExprGen(elementAccessExpr.argExpr),
                    binaryen.f64,
                );
                let assignValue: binaryen.ExpressionRef;
                if (matchKind === MatchKind.ToArrayAnyMatch) {
                    assignValue = this.dynValueGen.WASMDynExprGen(rightExpr);
                } else {
                    assignValue = this.WASMExprGen(rightExpr);
                }
                return binaryenCAPI._BinaryenArraySet(
                    module.ptr,
                    arrayValue,
                    index,
                    assignValue,
                );
            }
            case ts.SyntaxKind.Identifier: {
                const identifierExpr = <IdentifierExpression>leftExpr;
                const identifierName = identifierExpr.identifierName;
                const variable = this.currentScope.findVariable(identifierName);
                if (!variable) {
                    throw new Error('error TS2304');
                }
                let assignValue: binaryen.ExpressionRef;
                if (matchKind === MatchKind.ToAnyMatch) {
                    assignValue = this.dynValueGen.WASMDynExprGen(rightExpr);
                } else {
                    if (rightExprRef) {
                        assignValue = rightExprRef;
                    } else {
                        assignValue = this.WASMExprGen(rightExpr);
                    }
                }
                if (!variable.isLocalVar) {
                    return this.setGlobalValue(variable.varName, assignValue);
                }
                if (variable.varIsClosure) {
                    const nearestFuncScope = <FunctionScope>(
                        this.currentScope.getNearestFunctionScope()
                    );
                    const localGetType = (<typeInfo>(
                        WASMGen.contextOfFunc.get(nearestFuncScope)
                    )).typeRef;
                    let localGet = this.module.local.get(
                        nearestFuncScope.paramArray.length,
                        localGetType,
                    );
                    /* iff found in current function scope */
                    if (this.currentScope.findFunctionScope(identifierName)) {
                        return binaryenCAPI._BinaryenStructSet(
                            this.module.ptr,
                            variable.getClosureIndex(),
                            localGet,
                            assignValue,
                        );
                    } else {
                        let prevFuncScope = nearestFuncScope;
                        let scope = nearestFuncScope.parent;
                        let targetCtxTypeRef = binaryen.none;
                        while (scope !== null) {
                            if (scope.kind === ScopeKind.FunctionScope) {
                                const target = scope.findVariable(
                                    variable.varName,
                                    false,
                                );
                                const funcScope = <FunctionScope>scope;
                                targetCtxTypeRef = (<typeInfo>(
                                    WASMGen.contextOfFunc.get(funcScope)
                                )).typeRef;
                                if (prevFuncScope.getIsClosure()) {
                                    localGet = binaryenCAPI._BinaryenStructGet(
                                        this.module.ptr,
                                        0,
                                        localGet,
                                        targetCtxTypeRef,
                                        false,
                                    );
                                    if (target !== undefined) {
                                        break;
                                    }
                                }
                                prevFuncScope = funcScope;
                            }
                            scope = scope.parent;
                        }
                        return binaryenCAPI._BinaryenStructSet(
                            this.module.ptr,
                            variable.getClosureIndex(),
                            localGet,
                            assignValue,
                        );
                    }
                }
                return this.setLocalValue(variable.varIndex, assignValue);
            }
            default: {
                return module.unreachable();
            }
        }
    }

    private matchType(leftExprType: Type, rightExprType: Type): number {
        if (leftExprType.kind === rightExprType.kind) {
            if (
                leftExprType.kind === TypeKind.NUMBER ||
                leftExprType.kind === TypeKind.STRING ||
                leftExprType.kind === TypeKind.BOOLEAN ||
                leftExprType.kind === TypeKind.ANY
            ) {
                return MatchKind.ExactMatch;
            }
            if (leftExprType.kind === TypeKind.ARRAY) {
                const leftArrayType = <TSArray>leftExprType;
                const rightArrayType = <TSArray>rightExprType;
                if (leftArrayType.elementType === rightArrayType.elementType) {
                    return MatchKind.ExactMatch;
                }
                if (leftArrayType.elementType.kind === TypeKind.ANY) {
                    return MatchKind.ToArrayAnyMatch;
                }
                if (rightArrayType.elementType.kind === TypeKind.ANY) {
                    return MatchKind.FromArrayAnyMatch;
                }
            }
            if (leftExprType.kind === TypeKind.CLASS) {
                const leftClassType = <TSClass>leftExprType;
                const rightClassType = <TSClass>rightExprType;
                const leftClassName = leftClassType.className;
                const rightClassName = rightClassType.className;
                if (leftClassName === rightClassName) {
                    return MatchKind.ClassMatch;
                }
                /* iff explicit subtyping, such as class B extends A ==> it allows: a(A) = b(B)  */
                let rightClassBaseType = rightClassType.getBase();
                while (rightClassBaseType !== null) {
                    if (rightClassBaseType.className === leftClassName) {
                        return MatchKind.ClassInheritMatch;
                    }
                    rightClassBaseType = rightClassBaseType.getBase();
                }
                return MatchKind.MisMatch;
            }
        }
        if (leftExprType.kind === TypeKind.ANY) {
            return MatchKind.ToAnyMatch;
        }
        if (rightExprType.kind === TypeKind.ANY) {
            return MatchKind.FromAnyMatch;
        }
        return MatchKind.MisMatch;
    }

    private WASMUnaryExpr(expr: UnaryExpression): binaryen.ExpressionRef {
        const operator: ts.SyntaxKind = expr.operatorKind;
        const operand: Expression = expr.operand;
        switch (operator) {
            case ts.SyntaxKind.PlusPlusToken: {
                /* i++ ===> i += 1 */
                const numberExpr = new NumberLiteralExpression(1);
                numberExpr.setExprType(expr.exprType);
                const binaryExpr = new BinaryExpression(
                    ts.SyntaxKind.PlusEqualsToken,
                    operand,
                    numberExpr,
                );
                binaryExpr.setExprType(expr.exprType);
                return this.WASMBinaryExpr(binaryExpr);
            }
            case ts.SyntaxKind.MinusMinusToken: {
                /* i-- ===> i -= 1 */
                const numberExpr = new NumberLiteralExpression(1);
                numberExpr.setExprType(expr.exprType);
                const binaryExpr = new BinaryExpression(
                    ts.SyntaxKind.MinusEqualsToken,
                    operand,
                    numberExpr,
                );
                binaryExpr.setExprType(expr.exprType);
                return this.WASMBinaryExpr(binaryExpr);
            }
            case ts.SyntaxKind.ExclamationToken: {
                let WASMOperandExpr = this.WASMExprGen(operand);
                const WASMOperandType =
                    binaryen.getExpressionType(WASMOperandExpr);
                if (WASMOperandType != binaryen.i32) {
                    WASMOperandExpr = this.convertTypeToI32(
                        WASMOperandExpr,
                        WASMOperandType,
                    );
                }
                return this.module.i32.eqz(WASMOperandExpr);
            }
            case ts.SyntaxKind.MinusToken: {
                if (operand.expressionKind === ts.SyntaxKind.NumericLiteral) {
                    const value: number = (<NumberLiteralExpression>operand)
                        .expressionValue;
                    return this.module.f64.const(-value);
                } else {
                    const WASMOperandExpr = this.WASMExprGen(operand);
                    return this.module.f64.sub(
                        this.module.f64.const(0),
                        WASMOperandExpr,
                    );
                }
            }
        }
        return this.module.unreachable();
    }

    private WASMConditionalExpr(
        expr: ConditionalExpression,
    ): binaryen.ExpressionRef {
        let condWASMExpr = this.WASMExprGen(expr.condtion);
        const trueWASMExpr = this.WASMExprGen(expr.whenTrue);
        const falseWASMExpr = this.WASMExprGen(expr.whenFalse);
        // TODO: union type
        assert(
            binaryen.getExpressionType(trueWASMExpr) ===
                binaryen.getExpressionType(falseWASMExpr),
            'trueWASMExprType and falseWASMExprType are not equal in conditional expression ',
        );
        const condWASMExprType = binaryen.getExpressionType(condWASMExpr);
        if (condWASMExprType !== binaryen.i32) {
            condWASMExpr = this.convertTypeToI32(
                condWASMExpr,
                condWASMExprType,
            );
        }
        return this.module.select(condWASMExpr, trueWASMExpr, falseWASMExpr);
    }

    private WASMCallExpr(expr: CallExpression): binaryen.ExpressionRef {
        const callExpr = expr.callExpr;
        const callWASMArgs = new Array<binaryen.ExpressionRef>();
        // call import functions
        if (callExpr.expressionKind === ts.SyntaxKind.Identifier) {
            const calledFuncName = (<IdentifierExpression>callExpr)
                .identifierName;
            if (isDynFunc(calledFuncName)) {
                for (let i = 0; i < expr.callArgs.length; ++i) {
                    callWASMArgs.push(this.WASMExprGen(expr.callArgs[i]));
                }
                return this.module.call(
                    calledFuncName,
                    callWASMArgs,
                    getReturnTypeRef(calledFuncName),
                );
            }
        }
        callWASMArgs.push(
            binaryenCAPI._BinaryenRefNull(
                this.module.ptr,
                emptyStructType.typeRef,
            ),
        );
        const maybeFuncScope = this.currentScope.getNearestFunctionScope();
        for (let i = 0; i !== expr.callArgs.length; ++i) {
            /* here iff argument is IdentifierExpr, try to find it in scopes, iff not find, maybe it's a function
               TODO: should we add FunctionDeclaration as variable to currentScope??
            */
            let isArgIsFunc = false;
            if (expr.callArgs[i].expressionKind === ts.SyntaxKind.Identifier) {
                const argExprName = (<IdentifierExpression>expr.callArgs[i])
                    .identifierName;
                /* iff not find target variable ==> it's a function name */
                if (this.currentScope.findVariable(argExprName) === undefined) {
                    const maybeFuncDef = findTargetFunction(
                        maybeFuncScope,
                        argExprName,
                    );
                    if (maybeFuncDef === undefined) {
                        throw new Error(
                            'argument variable not find, name is <' +
                                argExprName +
                                '>',
                        );
                    }
                    const wasmFuncType = this.wasmType.getWASMType(
                        maybeFuncDef.funcType,
                    );
                    const wasmFuncStructHeapType =
                        this.wasmType.getWASMFuncStructHeapType(
                            maybeFuncDef.funcType,
                        );
                    const wasmArgStructOperands = [
                        binaryenCAPI._BinaryenRefNull(
                            this.module.ptr,
                            emptyStructType.typeRef,
                        ),
                        this.module.ref.func(
                            maybeFuncDef.funcName,
                            wasmFuncType,
                        ),
                    ];
                    const wasmArg = binaryenCAPI._BinaryenStructNew(
                        this.module.ptr,
                        arrayToPtr(wasmArgStructOperands).ptr,
                        wasmArgStructOperands.length,
                        wasmFuncStructHeapType,
                    );
                    callWASMArgs.push(wasmArg);
                    isArgIsFunc = true;
                }
            }
            if (!isArgIsFunc) {
                callWASMArgs.push(this.WASMExprGen(expr.callArgs[i]));
            }
        }
        if (callExpr.expressionKind === ts.SyntaxKind.Identifier) {
            const maybeFuncName = (<IdentifierExpression>callExpr)
                .identifierName;
            // const maybeFuncScope = this.currentScope.getNearestFunctionScope();
            const maybeFuncDef = findTargetFunction(
                maybeFuncScope,
                maybeFuncName,
            );
            // iff identifierName is a function name, call it directly
            if (maybeFuncDef !== undefined) {
                const type = maybeFuncDef.funcType;
                return this.module.call(
                    maybeFuncName,
                    callWASMArgs,
                    this.wasmType.getWASMFuncReturnType(type),
                );
            } else {
                /* iff identifier is a functionType, parameter or variable*/
                const variable = this.currentScope.findVariable(maybeFuncName);
                if (variable === undefined) {
                    throw new Error(
                        'variable not found, variable name <' +
                            maybeFuncName +
                            '>',
                    );
                }
                const type = variable.varType;
                const wasmType = this.wasmType.getWASMFuncStructType(type);
                const getTargetVar = variable.isLocalVar
                    ? this.module.local.get(variable.varIndex, wasmType)
                    : this.module.global.get(variable.varName, wasmType);
                // context
                const context = binaryenCAPI._BinaryenStructGet(
                    this.module.ptr,
                    0,
                    getTargetVar,
                    wasmType,
                    false,
                );
                const funcref = binaryenCAPI._BinaryenStructGet(
                    this.module.ptr,
                    1,
                    getTargetVar,
                    wasmType,
                    false,
                );
                callWASMArgs[0] = context;
                return binaryenCAPI._BinaryenCallRef(
                    this.module.ptr,
                    funcref,
                    arrayToPtr(callWASMArgs).ptr,
                    callWASMArgs.length,
                    binaryenCAPI._BinaryenExpressionGetType(funcref),
                    false,
                );
            }
        } else if (callExpr.expressionKind === ts.SyntaxKind.CallExpression) {
            // TODO
        }
        return this.module.unreachable();
    }
    private WASMArrayLiteralExpr(
        expr: ArrayLiteralExpression,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const arrType = expr.exprType;
        const elements = expr.arrayValues;
        const arrayLen = elements.length;
        const array = [];
        for (let i = 0; i < arrayLen; i++) {
            const elemExpr = elements[i];
            let elemExprRef: binaryen.ExpressionRef;
            if (arrType.kind === TypeKind.ANY) {
                elemExprRef = this.dynValueGen.WASMDynExprGen(expr);
            } else if (arrType.kind === TypeKind.ARRAY) {
                const arrayType = <TSArray>arrType;
                if (arrayType.elementType.kind === TypeKind.ANY) {
                    elemExprRef = this.dynValueGen.WASMDynExprGen(elemExpr);
                } else {
                    elemExprRef = this.WASMExprGen(elemExpr);
                }
            } else {
                elemExprRef = this.WASMExprGen(elemExpr);
            }
            array.push(elemExprRef);
        }
        const arrayHeapType = this.wasmType.getWASMHeapType(arrType);
        const arrayValue = binaryenCAPI._BinaryenArrayInit(
            module.ptr,
            arrayHeapType,
            arrayToPtr(array).ptr,
            arrayLen,
        );
        return arrayValue;
    }

    private WASMObjectLiteralExpr(
        expr: ObjectLiteralExpression,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const objType = <TSClass>expr.exprType;
        // store members and methods seperately
        const propRefList: binaryen.ExpressionRef[] = [binaryen.none];
        const vtable: binaryen.ExpressionRef[] = [];

        const fields = expr.objectFields;
        const values = expr.objectValues;
        const propertyLen = fields.length;
        for (let i = 0; i < propertyLen; i++) {
            const propExpr = values[i];
            const propExprType = propExpr.exprType;
            /* TODO: not parse member function yet */
            if (propExprType.kind === TypeKind.FUNCTION) {
                vtable.push(this.WASMExprGen(propExpr));
            } else {
                let propExprRef: binaryen.ExpressionRef;
                if (propExprType.kind === TypeKind.ANY) {
                    propExprRef = this.dynValueGen.WASMDynExprGen(propExpr);
                } else {
                    propExprRef = this.WASMExprGen(propExpr);
                }
                propRefList.push(propExprRef);
            }
        }
        // const vtableType = new Type(); // TODO: get wasmType based on objType
        // const vtableHeapType = this.wasmType.getWASMHeapType(vtableType);
        const objHeapType = this.wasmType.getWASMHeapType(objType);
        // const vptr = binaryenCAPI._BinaryenStructNew(
        //     module.ptr,
        //     arrayToPtr(vtable).ptr,
        //     vtable.length,
        //     vtableHeapType,
        // );
        propRefList[0] = binaryenCAPI._BinaryenRefNull(
            module.ptr,
            emptyStructType.typeRef,
        );
        const objectLiteralValue = binaryenCAPI._BinaryenStructNew(
            module.ptr,
            arrayToPtr(propRefList).ptr,
            propRefList.length,
            objHeapType,
        );
        return objectLiteralValue;
    }

    // private WASMThisExpr(
    //     expr: ThisExpression,
    //     isEqualToken = false,
    //     rightWASMExpr: binaryen.ExpressionRef = binaryen.none,
    // ): binaryen.ExpressionRef {
    //     const module = this.module;
    //     const scope = <FunctionScope>this.currentScope;
    //     const classScope = <ClassScope>scope.parent;
    //     const classType = classScope.classType;
    //     const wasmRefType = this.wasmType.getWASMType(classType);
    //     const ref = module.local.get(
    //         scope.paramArray.length + scope.varArray.length,
    //         wasmRefType,
    //     );
    //     let index = -1;
    //     for (let i = 0; i !== classType.fields.length; ++i) {
    //         if (
    //             classType.fields[i].name ===
    //             (<IdentifierExpression>expr.propertyExpr).identifierName
    //         ) {
    //             index = i;
    //             break;
    //         }
    //     }
    //     if (index === -1) {
    //         throw new Error(
    //             'class field not found, class field name <' +
    //                 (<IdentifierExpression>expr.propertyExpr).identifierName +
    //                 '>',
    //         );
    //     }
    //     if (isEqualToken) {
    //         return binaryenCAPI._BinaryenStructSet(
    //             module.ptr,
    //             index + 1,
    //             ref,
    //             rightWASMExpr,
    //         );
    //     } else {
    //         return binaryenCAPI._BinaryenStructGet(
    //             module.ptr,
    //             index + 1,
    //             ref,
    //             wasmRefType,
    //             false,
    //         );
    //     }
    // }

    private WASMSuperExpr(expr: SuperCallExpression): binaryen.ExpressionRef {
        // must in a constructor
        const module = this.module;
        const scope = <FunctionScope>this.currentScope;
        const classScope = <ClassScope>scope.parent;
        const classType = classScope.classType;
        const baseClassType = <TSClass>classType.getBase();
        const wasmBaseRefHeapType =
            this.wasmType.getWASMHeapType(baseClassType);
        const ref = module.local.get(0, emptyStructType.typeRef);
        const cast = binaryenCAPI._BinaryenRefCast(
            module.ptr,
            ref,
            wasmBaseRefHeapType,
        );
        const wasmArgs = new Array<binaryen.ExpressionRef>();
        wasmArgs.push(cast);
        for (const arg of expr.callArgs) {
            wasmArgs.push(this.WASMExprGen(arg));
        }
        return module.call(
            baseClassType.className + '_constructor',
            wasmArgs,
            binaryen.none,
        );
    }

    private WASMNewExpr(expr: NewExpression): binaryen.ExpressionRef {
        const type = expr.exprType;
        const module = this.module;
        if (type.kind === TypeKind.ARRAY) {
            const arrayHeapType = this.wasmType.getWASMHeapType(type);
            if (!expr.NewArgs || (expr.NewArgs && expr.NewArgs.length === 0)) {
                const arraySize = this.convertTypeToI32(
                    module.f64.const(expr.arrayLen),
                    binaryen.f64,
                );
                const arrayInit = this.getArrayInitFromArrayType(<TSArray>type);
                return binaryenCAPI._BinaryenArrayNew(
                    module.ptr,
                    arrayHeapType,
                    arraySize,
                    arrayInit,
                );
            } else {
                const arrayType = <TSArray>type;
                const arrayLen = expr.arrayLen;
                const array = [];
                for (let i = 0; i < expr.arrayLen; i++) {
                    const elemExpr = expr.NewArgs[i];
                    let elemExprRef: binaryen.ExpressionRef;
                    if (arrayType.elementType.kind === TypeKind.ANY) {
                        elemExprRef = this.dynValueGen.WASMDynExprGen(elemExpr);
                    } else {
                        elemExprRef = this.WASMExprGen(elemExpr);
                    }

                    array.push(elemExprRef);
                }
                const arrayValue = binaryenCAPI._BinaryenArrayInit(
                    module.ptr,
                    arrayHeapType,
                    arrayToPtr(array).ptr,
                    arrayLen,
                );
                return arrayValue;
            }
        }
        if (type.kind === TypeKind.CLASS) {
            const classType = <TSClass>type;
            const className = classType.className;
            const initStructFields = new Array<binaryen.ExpressionRef>();
            initStructFields.push(this.wasmType.getWASMClassVtable(type));
            const classFields = classType.fields;
            for (const field of classFields) {
                initStructFields.push(this.defaultValue(field.type.kind));
            }
            const newStruct = binaryenCAPI._BinaryenStructNew(
                module.ptr,
                arrayToPtr(initStructFields).ptr,
                initStructFields.length,
                this.wasmType.getWASMHeapType(type),
            );
            const scope = this.wasmCompiler.curScope!;
            const binaryenStmts = this.wasmCompiler.scopeStateMap.get(scope);
            if (binaryenStmts !== undefined) {
                binaryenStmts.push(this.module.local.set(varIndex, newStruct));
            }
            const args = new Array<binaryen.ExpressionRef>();
            args.push(
                this.module.local.get(
                    varIndex,
                    this.wasmType.getWASMType(type),
                ),
            );
            if (expr.NewArgs) {
                for (const arg of expr.NewArgs) {
                    args.push(this.WASMExprGen(arg));
                }
            }
            if (binaryenStmts !== undefined) {
                binaryenStmts.push(
                    this.module.call(
                        className + '_constructor',
                        args,
                        this.wasmType.getWASMType(
                            <Type>classType.classConstructorType,
                        ),
                    ),
                );
            }
            return newStruct;
        }
        return binaryen.none;
    }

    private WASMPropertyAccessExpr(
        expr: PropertyAccessExpression,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const objPropAccessExpr = expr.propertyAccessExpr;
        let objExprRef: binaryen.ExpressionRef = binaryen.none;
        if (!expr.isThis) {
            objExprRef = this.WASMExprGen(objPropAccessExpr);
        }
        const propExpr = expr.propertyExpr;
        const propIdenExpr = <IdentifierExpression>propExpr;
        const propName = propIdenExpr.identifierName;
        if (expr.parentExpr.expressionKind === ts.SyntaxKind.CallExpression) {
            const callExpr = <CallExpression>expr.parentExpr;
            const callArgs = callExpr.callArgs;
            switch (propName) {
                case 'concat': {
                    const strRef = this.WASMExprGen(callArgs[0]);
                    return module.call(
                        BuiltinNames.string_concat_func,
                        [objExprRef, strRef],
                        stringTypeInfo.typeRef,
                    );
                }
                case 'slice': {
                    const startRef = this.WASMExprGen(callArgs[0]);
                    const endRef = this.WASMExprGen(callArgs[1]);
                    return module.call(
                        BuiltinNames.string_slice_func,
                        [
                            objExprRef,
                            this.convertTypeToI32(startRef, binaryen.f64),
                            this.convertTypeToI32(endRef, binaryen.f64),
                        ],
                        stringTypeInfo.typeRef,
                    );
                }
                case 'sqrt': {
                    if (
                        objPropAccessExpr.expressionKind !==
                        ts.SyntaxKind.Identifier
                    ) {
                        throw new Error(
                            'objPropAccessExpr must be an indentifier',
                        );
                    }
                    const objIdenExpr = <IdentifierExpression>objPropAccessExpr;
                    const objName = objIdenExpr.identifierName;
                    if (objName !== 'Math') {
                        throw new Error('objName must be  Math');
                    }
                    const operandRef = this.WASMExprGen(callArgs[0]);
                    return module.f64.sqrt(operandRef);
                }
                default: {
                    // class get method
                    const variable = this.currentScope.findVariable(
                        (<IdentifierExpression>expr.propertyAccessExpr)
                            .identifierName,
                    )!;
                    const wasmArgs = new Array<binaryen.ExpressionRef>();
                    wasmArgs.push(objExprRef);
                    const callExpr = <CallExpression>expr.parentExpr;
                    const callArgs = callExpr.callArgs;
                    for (const arg of callArgs) {
                        wasmArgs.push(this.WASMExprGen(arg));
                    }
                    let type: TSClass | null = <TSClass>variable.varType;
                    while (type !== null) {
                        if (type.getMethod(propName)) {
                            const methodType = <TSFunction>(
                                type.getMethod(propName)?.type
                            );
                            const name = type.className + '_' + propName;
                            return this.module.call(
                                name,
                                wasmArgs,
                                this.wasmType.getWASMFuncReturnType(methodType),
                            );
                        }
                        type = type.getBase();
                    }
                    if (type === null) {
                        throw new Error('method not found, <' + propName + '>');
                    }
                }
            }
        } else {
            let objType: Type;
            if (!expr.isThis) {
                objType = objPropAccessExpr.exprType;
            } else {
                const scope = <FunctionScope>(
                    this.wasmCompiler.curScope?.getNearestFunctionScope()
                );
                objType = (<ClassScope>scope.parent).classType;
            }
            if (objType.kind === TypeKind.ANY) {
                // judge expression's kind: object, extref, etc
                const isObj = module.call(
                    dyntype.dyntype_is_object,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        objExprRef,
                    ],
                    dyntype.bool,
                );
                const isExtref = module.call(
                    dyntype.dyntype_is_extref,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        objExprRef,
                    ],
                    dyntype.bool,
                );
                if (propName === '__proto__') {
                    return module.if(
                        module.i32.eq(isObj, module.i32.const(1)),
                        module.call(
                            dyntype.dyntype_get_prototype,
                            [
                                module.global.get(
                                    dyntype.dyntype_context,
                                    dyntype.dyn_ctx_t,
                                ),
                                objExprRef,
                            ],
                            dyntype.dyn_value_t,
                        ),
                    );
                }

                // add objValue to current scope
                const objLocalVar = this.generateTmpVar('~obj|', 'any');
                // if expression is obj, then get its property.
                const propNameExprRef = this.generateStringRef(
                    propIdenExpr.identifierName,
                );

                // get property value
                const objHasProp = module.call(
                    dyntype.dyntype_has_property,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        objExprRef,
                        propNameExprRef,
                    ],
                    dyntype.int,
                );
                const propValue = module.call(
                    dyntype.dyntype_get_property,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        objExprRef,
                        propNameExprRef,
                    ],
                    dyntype.dyn_value_t,
                );

                this.statementArray.push(
                    module.if(
                        module.i32.eq(isObj, module.i32.const(1)),
                        module.if(
                            module.i32.eq(objHasProp, module.i32.const(1)),
                            this.setVariableToCurrentScope(
                                objLocalVar,
                                propValue,
                            ),
                        ),
                    ),
                );

                // if expression is extref, report error since we can't get the prop directly.
                // wait for exception function

                return this.getVariableValue(objLocalVar, binaryen.anyref);
            } else if (objType.kind === TypeKind.STRING) {
                switch (propName) {
                    case 'length': {
                        return module.call(
                            BuiltinNames.string_length_func,
                            [objExprRef],
                            stringTypeInfo.heapTypeRef,
                        );
                    }
                }
            } else {
                const objClassType = <TSClass>objType;
                const propIndex = objClassType.getMemberFieldIndex(propName);
                const propType = objClassType.getMemberField(propName)!.type;
                const propTypeRef = this.wasmType.getWASMType(propType);
                if (propIndex === -1) {
                    throw new Error(propName + ' property does not exist');
                }

                if (expr.isThis) {
                    const scope = <FunctionScope>(
                        this.wasmCompiler.curScope?.getNearestFunctionScope()
                    );
                    const targeObjectType =
                        this.wasmType.getWASMType(objClassType);
                    objExprRef = this.module.local.get(
                        scope.paramArray.length,
                        targeObjectType,
                    );
                }
                // vtable will be the first in struct
                return binaryenCAPI._BinaryenStructGet(
                    module.ptr,
                    propIndex + 1,
                    objExprRef,
                    propTypeRef,
                    false,
                );
            }
        }
        return module.unreachable();
    }

    private WASMElementAccessExpr(
        expr: ElementAccessExpression,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const accessExpr = expr.accessExpr;
        const argExpr = expr.argExpr;
        const arrayValue = this.WASMExprGen(accessExpr);
        const index = this.convertTypeToI32(
            this.WASMExprGen(argExpr),
            binaryen.f64,
        );
        const arrayType = <TSArray>accessExpr.exprType;
        const elementType = arrayType.elementType;
        const elementValue = binaryenCAPI._BinaryenArrayGet(
            module.ptr,
            arrayValue,
            index,
            this.wasmType.getWASMType(elementType),
            false,
        );
        return elementValue;
    }

    private WASMAsExpr(expr: AsExpression): binaryen.ExpressionRef {
        const module = this.module;
        const originObjExpr = <IdentifierExpression>expr.expression;
        const originObjExprRef = this.WASMExprGen(originObjExpr);
        const originObjName = originObjExpr.identifierName;
        const targetType = expr.expression.exprType;
        const isExtref = module.call(
            dyntype.dyntype_is_extref,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                originObjExprRef,
            ],
            dyntype.bool,
        );
        // use 4 bits to store i32;
        const varAndStates = this.generatePointerVar(4);
        const tmpAddressVar = <Variable>varAndStates[0];
        const setTmpAddressExpression = <binaryen.ExpressionRef>varAndStates[1];
        const setTmpGlobalExpression = <binaryen.ExpressionRef>varAndStates[2];
        const resetGlobalExpression = <binaryen.ExpressionRef>varAndStates[3];
        this.statementArray.push(setTmpAddressExpression);
        this.statementArray.push(setTmpGlobalExpression);
        const extrefPointer = this.getVariableValue(
            tmpAddressVar,
            binaryen.i32,
        );
        // get address which stores extref
        const toExtref = module.call(
            dyntype.dyntype_to_extref,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                originObjExprRef,
                extrefPointer,
            ],
            dyntype.bool,
        );
        this.statementArray.push(toExtref);
        const extrefTurnExpression = this.turnDyntypeToExtref(
            originObjExprRef,
            extrefPointer,
            targetType,
        );
        const tmpObjVarInfo = <Variable>extrefTurnExpression[0];
        const extrefExpression = <binaryen.ExpressionRef>(
            extrefTurnExpression[1]
        );

        const turnExtrefToObjExpression = module.if(
            module.i32.eq(isExtref, module.i32.const(1)),
            extrefExpression,
        );
        this.statementArray.push(turnExtrefToObjExpression);
        this.statementArray.push(resetGlobalExpression);
        return this.getVariableValue(
            tmpObjVarInfo,
            this.wasmType.getWASMType(targetType),
        );
    }
}

export class WASMDynExpressionGen extends WASMExpressionBase {
    constructor(WASMCompiler: WASMGen) {
        super(WASMCompiler);
    }

    WASMDynExprGen(expr: Expression): binaryen.ExpressionRef {
        this.module = this.wasmCompiler.module;
        this.wasmType = this.wasmCompiler.wasmType;
        this.currentScope = this.wasmCompiler.curScope!;
        if (this.currentScope === null) {
            throw new Error('currentScope is null in WASMDynExprGen');
        }
        this.statementArray = this.wasmCompiler.scopeStateMap.get(
            this.currentScope,
        )!;
        if (this.statementArray === undefined) {
            throw new Error('statementArray is undefined in WASMDynExprGen');
        }
        this.staticValueGen = this.wasmCompiler.wasmExprCompiler;
        this.dynValueGen = this.wasmCompiler.wasmDynExprCompiler;
        switch (expr.expressionKind) {
            case ts.SyntaxKind.NumericLiteral:
                return this.generateDynNumber(
                    this.staticValueGen.WASMExprGen(expr),
                );
            case ts.SyntaxKind.FalseKeyword:
            case ts.SyntaxKind.TrueKeyword:
                return this.generateDynBoolean(
                    this.staticValueGen.WASMExprGen(expr),
                );
            case ts.SyntaxKind.StringLiteral:
                return this.generateDynString(
                    this.staticValueGen.WASMExprGen(expr),
                );
            case ts.SyntaxKind.NullKeyword:
                return this.generateDynNull();
            case ts.SyntaxKind.Identifier: {
                const identifierExpr = <IdentifierExpression>expr;
                if (identifierExpr.identifierName === 'undefined') {
                    return this.generateDynUndefined();
                } else {
                    if (identifierExpr.exprType.kind === TypeKind.ANY) {
                        return this.staticValueGen.WASMExprGen(identifierExpr);
                    } else {
                        // generate dynExtref iff identifier's type is not any
                        return this.generateDynExtref(
                            this.staticValueGen.WASMExprGen(identifierExpr),
                        );
                    }
                }
            }
            case ts.SyntaxKind.ArrayLiteralExpression:
                return this.WASMDynArrayExpr(<ArrayLiteralExpression>expr);
            case ts.SyntaxKind.ObjectLiteralExpression:
                return this.WASMDynObjExpr(<ObjectLiteralExpression>expr);
            case ts.SyntaxKind.BinaryExpression:
            case ts.SyntaxKind.CallExpression:
            case ts.SyntaxKind.PropertyAccessExpression:
                return this.staticValueGen.WASMExprGen(expr);
            default:
                throw new Error('unexpected expr kind ' + expr.expressionKind);
        }
    }

    private WASMDynArrayExpr(
        expr: ArrayLiteralExpression,
    ): binaryen.ExpressionRef {
        // generate empty any array
        const arrayValue = this.generateDynArray();
        // TODO: generate more array details
        return arrayValue;
    }

    private WASMDynObjExpr(
        expr: ObjectLiteralExpression,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const fields = expr.objectFields;
        const values = expr.objectValues;
        const propertyLen = fields.length;

        // generate empty any obj
        const objValue = this.generateDynObj();
        // add objValue to current scope, push assign statement
        const objLocalVar = this.generateTmpVar('~obj|', 'any');
        const objLocalVarType = objLocalVar.varType;
        const objLocalVarWasmType = this.wasmType.getWASMType(objLocalVarType);
        this.statementArray.push(
            this.setVariableToCurrentScope(objLocalVar, objValue),
        );
        // set obj's properties
        for (let i = 0; i < propertyLen; i++) {
            const propNameExpr = fields[i];
            const propNameExprRef = this.generateStringRef(
                propNameExpr.identifierName,
            );
            const propValueExpr = values[i];
            const propValueExprRef = this.WASMDynExprGen(propValueExpr);
            const setPropertyExpression = module.drop(
                module.call(
                    dyntype.dyntype_set_property,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        this.getLocalValue(
                            objLocalVar.varIndex,
                            objLocalVarWasmType,
                        ),
                        propNameExprRef,
                        propValueExprRef,
                    ],
                    dyntype.int,
                ),
            );
            this.statementArray.push(setPropertyExpression);
        }
        return this.getVariableValue(objLocalVar, objLocalVarWasmType);
    }
}

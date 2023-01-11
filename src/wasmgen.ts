import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import { TSArray, TSClass, TSFunction, Type, TypeKind } from './type';
import { Variable } from './variable';
import {
    BinaryExpression,
    CallExpression,
    ConditionalExpression,
    Expression,
    IdentifierExpression,
    NumberLiteralExpression,
    StringLiteralExpression,
    UnaryExpression,
    ArrayLiteralExpression,
    ObjectLiteralExpression,
    PropertyAccessExpression,
    ElementAccessExpression,
    AsExpression,
} from './expression.js';
import { Statement, ExpressionStatement } from './statement.js';
import ts from 'typescript';
import { arrayToPtr } from './glue/transform.js';
import { assert } from 'console';
import { FunctionScope, GlobalScope, ScopeKind } from './scope.js';
import { MatchKind, Stack } from './utils.js';
import * as dyntype from '../lib/dyntype/utils.js';
import { Scope } from './scope.js';
import { ModifierKind } from './variable.js';
import { BuiltinNames } from '../lib/builtin/builtinUtil.js';
import {
    charArrayTypeInfo,
    stringTypeInfo,
    objectStructTypeInfo,
} from './glue/packType.js';

export class WASMGen {
    private scopeStatementMap = new Map<Scope, binaryen.ExpressionRef[]>();
    private binaryenModule = new binaryen.Module();
    private wasmTypeCompiler = new WASMTypeGen(this);
    wasmExprBase = new WASMExpressionBase(this);
    wasmExprCompiler = new WASMExpressionGen(this);
    wasmDynExprCompiler = new WASMDynExpressionGen(this);
    private wasmStmtCompiler = new WASMStatementGen(this);
    private currentScope: Scope | null = null;

    constructor(private globalScopes: Stack<GlobalScope>) {}

    WASMGenerate() {
        while (!this.globalScopes.isEmpty()) {
            const globalScope = this.globalScopes.pop();
            // generate global refs
            this.currentScope = globalScope;
            const globalStatementRef: binaryen.ExpressionRef[] = [];
            for (const globalStatement of globalScope.startStateArray) {
                const statement =
                    this.wasmStmtCompiler.WASMStmtGen(globalStatement);
                globalStatementRef.push(statement);
            }
            this.scopeStatementMap.set(this.currentScope, globalStatementRef);
        }
    }

    get module(): binaryen.Module {
        return this.binaryenModule;
    }

    get wasmType(): WASMType {
        return this.wasmTypeCompiler;
    }

    get curScope(): Scope | null {
        return this.currentScope;
    }

    get scopeStateMap() {
        return this.scopeStatementMap;
    }
}

export class WASMType {
    private tsType2WASMTypeMap: Map<Type, binaryenCAPI.TypeRef> = new Map();
    private tsType2WASMHeapTypeMap: Map<Type, binaryenCAPI.HeapTypeRef> =
        new Map();

    constructor() {
        // TODO
    }

    createWASMType(type: Type): void {
        if (this.tsType2WASMTypeMap.has(type)) {
            return;
        }
    }

    hasHeapRype(type: Type): boolean {
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
        // TODO
        return binaryen.none;
    }

    getWASMHeapType(type: Type): binaryenCAPI.HeapTypeRef {
        // TODO
        return binaryen.none;
    }
}

export class WASMValue {
    varInfo: Variable;
    binaryenTypeRef: binaryenCAPI.TypeRef = binaryen.none;
    binaryenHeapTypeRef: binaryenCAPI.HeapTypeRef =
        binaryenCAPI._BinaryenHeapTypeNone();
    index: binaryenCAPI.Index;
    expression: binaryen.ExpressionRef = binaryen.none;

    constructor(varInfo: Variable, index: binaryenCAPI.Index) {
        this.varInfo = varInfo;
        this.index = index;
    }

    // TODO: Set TypeRef through varInfo
    setBinaryenTypeRef() {
        // TODO
    }

    getBinaryenTypeRef(): binaryenCAPI.TypeRef {
        return binaryen.none;
    }

    setBinaryenHeapTypeRef() {
        // TODO
    }

    getBinaryenHeapTypeRef(): binaryenCAPI.HeapTypeRef {
        return binaryen.none;
    }

    // getVarInfo(): Variable {

    // }

    getIndex(): binaryenCAPI.Index {
        // TODO
        return binaryen.none;
    }

    // setExpression() {

    // }

    getExpression(): binaryen.ExpressionRef {
        // TODO
        return binaryen.none;
    }
}

class WASMExpressionBase {
    wasmCompiler;
    module;
    wasmType;
    currentScope;
    statementArray: binaryen.ExpressionRef[];
    globalTmpVarStack;
    localTmpVarStack;
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
        if (typeName === '') {
            variableType = varType;
        } else {
            variableType = this.currentScope.namedTypeMap.get(typeName)!;
        }
        const tmpVar = new Variable(
            tmpNumberName,
            variableType,
            ModifierKind.default,
            0,
            false,
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
            variableIndex = currentScope.varArray.length;
            const globalScope = <GlobalScope>currentScope;
            globalScope.addStartFuncVar(variable);
        } else {
            const nearestFunctionScope = currentScope.getNearestFunctionScope();
            const funcScope = <FunctionScope>nearestFunctionScope!;
            variableIndex =
                funcScope.paramArray.length + funcScope.varArray.length;
            funcScope.addVariable(variable);
        }
        variable.setVarIndex(variableIndex);
    }

    setVariableToCurrentScope(
        variable: Variable,
        value: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        const currentScope = this.currentScope!;
        if (currentScope.kind === ScopeKind.GlobalScope) {
            return this.module.global.set(variable.varName, value);
        } else {
            return this.module.local.set(variable.varIndex, value);
        }
    }

    getVariableValue(variable: Variable, type: binaryen.Type) {
        const currentScope = this.currentScope!;
        if (currentScope.kind === ScopeKind.GlobalScope) {
            return this.getGlobalValue(variable.varName, type);
        } else {
            return this.getLocalValue(variable.varIndex, type);
        }
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
        const tmpAddressVar = this.generateTmpVar('~address|', 'boolean');
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
}

class WASMExpressionGen extends WASMExpressionBase {
    private dynValueGen;
    constructor(WASMCompiler: WASMGen) {
        super(WASMCompiler);
        this.dynValueGen = this.wasmCompiler.wasmDynExprCompiler;
    }

    WASMExprGen(expr: Expression): binaryen.ExpressionRef {
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
                return this.WASMIdenfiterExpr(<IdentifierExpression>expr);
            case ts.SyntaxKind.BinaryExpression:
                return this.WASMBinaryExpr(<BinaryExpression>expr);
            case ts.SyntaxKind.PrefixUnaryExpression:
            case ts.SyntaxKind.PostfixUnaryExpression:
                return this.WASMUnaryExpr(<UnaryExpression>expr);
            case ts.SyntaxKind.ConditionalExpression:
                return this.WASMConditionalExpr(<ConditionalExpression>expr);
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
            case ts.SyntaxKind.AsExpression:
                return this.WASMAsExpr(<AsExpression>expr);
            default:
                return this.module.unreachable();
        }
    }

    WASMNumberLiteral(expr: NumberLiteralExpression): binaryen.ExpressionRef {
        return this.module.f64.const(expr.expressionValue);
    }

    WASMStringLiteral(expr: StringLiteralExpression): binaryen.ExpressionRef {
        const value = expr.expressionValue.substring(
            1,
            expr.expressionValue.length - 1,
        );
        return this.generateStringRef(value);
    }

    WASMIdenfiterExpr(expr: IdentifierExpression): binaryen.ExpressionRef {
        const variable = findVariable(expr.identifierName);
        const varType = this.wasmType.getWASMType(variable.varType);
        if (variable.isLocalVar) {
            return this.module.local.get(variable.varIndex, varType);
        } else {
            return this.module.global.get(variable.varName, varType);
        }
    }

    WASMBinaryExpr(expr: BinaryExpression): binaryen.ExpressionRef {
        const leftExpr = expr.leftOperand;
        const rightExpr = expr.rightOperand;
        const operatorKind = expr.operatorKind;
        const leftExprType = leftExpr.exprType;
        const rightExprType = rightExpr.exprType;
        const leftExprRef = this.WASMExprGen(leftExpr);
        const rightExprRef = this.WASMExprGen(rightExpr);
        switch (operatorKind) {
            case ts.SyntaxKind.EqualsToken: {
                return this.assignBinaryExpr(
                    leftExpr,
                    rightExpr,
                    leftExprType,
                    rightExprType,
                );
            }
            case ts.SyntaxKind.PlusEqualsToken: {
                return this.assignBinaryExpr(
                    leftExpr,
                    new BinaryExpression(
                        ts.SyntaxKind.PlusToken,
                        leftExpr,
                        rightExpr,
                    ),
                    leftExprType,
                    rightExprType,
                );
            }
            case ts.SyntaxKind.MinusEqualsToken: {
                return this.assignBinaryExpr(
                    leftExpr,
                    new BinaryExpression(
                        ts.SyntaxKind.MinusToken,
                        leftExpr,
                        rightExpr,
                    ),
                    leftExprType,
                    rightExprType,
                );
            }
            case ts.SyntaxKind.AsteriskEqualsToken: {
                return this.assignBinaryExpr(
                    leftExpr,
                    new BinaryExpression(
                        ts.SyntaxKind.AsteriskToken,
                        leftExpr,
                        rightExpr,
                    ),
                    leftExprType,
                    rightExprType,
                );
            }
            case ts.SyntaxKind.SlashEqualsToken: {
                return this.assignBinaryExpr(
                    leftExpr,
                    new BinaryExpression(
                        ts.SyntaxKind.SlashToken,
                        leftExpr,
                        rightExpr,
                    ),
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

    operateBinaryExpr(
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
        return this.module.unreachable();
    }

    assignBinaryExpr(
        leftExpr: Expression,
        rightExpr: Expression,
        leftExprType: Type,
        rightExprType: Type,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const matchKind = this.matchType(leftExprType, rightExprType);
        if (matchKind === MatchKind.MisMatch) {
            throw new Error('Type mismatch in ExpressionStatement');
        }
        switch (leftExpr.expressionKind) {
            case ts.SyntaxKind.PropertyAccessExpression: {
                // sample: const obj: any = {}; obj.a = 2;
                const objExprRef = this.WASMExprGen(leftExpr);
                const propIdenExpr = <IdentifierExpression>rightExpr;
                const propName = propIdenExpr.identifierName;
                const initDynValue = this.dynValueGen.WASMDynExprGen(rightExpr);
                if (propName === '__proto__') {
                    return module.call(
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
                    );
                }
                const propNameRef = this.generateStringRef(propName);
                const setPropertyExpression = module.call(
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
                );
                return setPropertyExpression;
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
                    assignValue = this.WASMExprGen(rightExpr);
                }
                if (variable!.isLocalVar) {
                    return this.setLocalValue(variable.varIndex, assignValue);
                } else {
                    return this.setGlobalValue(variable.varName, assignValue);
                }
            }
            default: {
                return module.unreachable();
            }
        }
    }

    matchType(leftExprType: Type, rightExprType: Type): number {
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

    WASMUnaryExpr(expr: UnaryExpression): binaryen.ExpressionRef {
        const operator: ts.SyntaxKind = expr.operatorKind;
        const operand: Expression = expr.operand;
        // TODO: seems here not idenfity `++i' and 'i++'
        switch (operator) {
            case ts.SyntaxKind.PlusPlusToken:
                return this.WASMBinaryExpr(
                    new BinaryExpression(
                        ts.SyntaxKind.PlusToken,
                        operand,
                        new NumberLiteralExpression(1),
                    ),
                );
            case ts.SyntaxKind.MinusMinusToken:
                return this.WASMBinaryExpr(
                    new BinaryExpression(
                        ts.SyntaxKind.MinusToken,
                        operand,
                        new NumberLiteralExpression(1),
                    ),
                );
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

    WASMConditionalExpr(expr: ConditionalExpression): binaryen.ExpressionRef {
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

    WASMCallExpr(expr: CallExpression): binaryen.ExpressionRef {
        const callExpr = expr.callExpr;
        const callWASMArgs = new Array<binaryen.ExpressionRef>();
        for (let i = 0; i !== expr.callArgs.length; ++i) {
            callWASMArgs.push(this.WASMExprGen(expr.callArgs[i]));
        }
        if (callExpr.expressionKind === ts.SyntaxKind.Identifier) {
            // TODO
        } else if (callExpr.expressionKind === ts.SyntaxKind.CallExpression) {
            // TODO
        } else if (
            callExpr.expressionKind === ts.SyntaxKind.PropertyAccessExpression
        ) {
            // todo
        }
        return this.module.unreachable();
    }
    WASMArrayLiteralExpr(expr: ArrayLiteralExpression): binaryen.ExpressionRef {
        const module = this.module;
        const arrType = expr.exprType;
        const elements = expr.arrayValues;
        const arrayLen = elements.length;
        const array = [];
        for (let i = 0; i < arrayLen; i++) {
            const elemExpr = elements[i];
            let elemExprRef: binaryen.ExpressionRef;
            if (arrType.kind === TypeKind.ANY) {
                elemExprRef = this.dynValueGen.WASMDynExprGen(elemExpr);
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

    WASMObjectLiteralExpr(
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
        const vtableType = new Type(); // TODO: get wasmType based on objType
        const vtableHeapType = this.wasmType.getWASMHeapType(vtableType);
        const objHeapType = this.wasmType.getWASMHeapType(objType);

        const vptr = binaryenCAPI._BinaryenStructNew(
            module.ptr,
            arrayToPtr(vtable).ptr,
            vtable.length,
            vtableHeapType,
        );
        propRefList[0] = vptr;
        const objectLiteralValue = binaryenCAPI._BinaryenStructNew(
            module.ptr,
            arrayToPtr(propRefList).ptr,
            propRefList.length,
            objHeapType,
        );
        return objectLiteralValue;
    }

    WASMPropertyAccessExpr(
        expr: PropertyAccessExpression,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const objPropAccessExpr = expr.propertyAccessExpr;
        const objExprRef = this.WASMExprGen(objPropAccessExpr);
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
            }
        } else {
            if (
                objPropAccessExpr.expressionKind === ts.SyntaxKind.ThisKeyword
            ) {
                // TODO
            } else {
                const objType = objPropAccessExpr.exprType;
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
                } else if (objType.kind === TypeKind.CLASS) {
                    const objClassType = <TSClass>objType;
                    const propIndex =
                        objClassType.getMemberFieldIndex(propName);
                    const propType =
                        objClassType.getMemberField(propName)!.type;
                    const propTypeRef = this.wasmType.getWASMType(propType);
                    if (propIndex === -1) {
                        throw new Error(propName + ' property does not exist');
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
        }
        return module.unreachable();
    }

    WASMElementAccessExpr(
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

    WASMAsExpr(expr: AsExpression): binaryen.ExpressionRef {
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

class WASMDynExpressionGen extends WASMExpressionBase {
    private staticValueGen;
    constructor(WASMCompiler: WASMGen) {
        super(WASMCompiler);
        this.staticValueGen = this.wasmCompiler.wasmExprCompiler;
    }

    WASMDynExprGen(expr: Expression): binaryen.ExpressionRef {
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
                    return this.generateDynExtref(
                        this.staticValueGen.WASMExprGen(identifierExpr),
                    );
                }
            }
            case ts.SyntaxKind.BinaryExpression:
                return this.WASMDynBinaryExpr(<BinaryExpression>expr);
            case ts.SyntaxKind.ArrayLiteralExpression:
                return this.WASMDynArrayExpr(<ArrayLiteralExpression>expr);
            case ts.SyntaxKind.ObjectLiteralExpression:
                return this.WASMDynObjExpr(<ObjectLiteralExpression>expr);
            default:
                throw new Error('unexpected expr kind ' + expr.expressionKind);
        }
    }

    WASMDynBinaryExpr(expr: BinaryExpression): binaryen.ExpressionRef {
        const module = this.module;
        const leftExpr = expr.leftOperand;
        const rightExpr = expr.rightOperand;
        const leftExprType = leftExpr.exprType;
        const rightExprType = rightExpr.exprType;
        const operatorKind = expr.operatorKind;

        if (
            leftExprType.kind === TypeKind.NUMBER &&
            rightExprType.kind === TypeKind.NUMBER
        ) {
            const binaryStaticValue = this.staticValueGen.WASMExprGen(expr);
            return this.generateDynNumber(binaryStaticValue);
        }
        if (
            (leftExprType.kind === TypeKind.NUMBER &&
                rightExprType.kind === TypeKind.BOOLEAN) ||
            (leftExprType.kind === TypeKind.BOOLEAN &&
                rightExprType.kind === TypeKind.NUMBER)
        ) {
            const binaryStaticValue = this.staticValueGen.WASMExprGen(expr);
            const binaryStaticType =
                binaryen.getExpressionType(binaryStaticValue);
            if (binaryStaticType === binaryen.i32) {
                return this.generateDynBoolean(binaryStaticValue);
            } else {
                return this.generateDynNumber(binaryStaticValue);
            }
        }
        if (
            leftExprType.kind === TypeKind.BOOLEAN &&
            rightExprType.kind === TypeKind.BOOLEAN
        ) {
            const binaryStaticValue = this.staticValueGen.WASMExprGen(expr);
            return this.generateDynBoolean(binaryStaticValue);
        }
        if (
            leftExprType.kind === TypeKind.ANY &&
            rightExprType.kind === TypeKind.ANY
        ) {
            return this.operateAnyAny(
                this.WASMDynExprGen(leftExpr),
                this.WASMDynExprGen(rightExpr),
                operatorKind,
            );
        }
        return module.unreachable();
    }

    WASMDynArrayExpr(expr: ArrayLiteralExpression): binaryen.ExpressionRef {
        // generate empty any array
        const arrayValue = this.generateDynArray();
        // TODO: generate more array details
        return arrayValue;
    }

    WASMDynObjExpr(expr: ObjectLiteralExpression): binaryen.ExpressionRef {
        const module = this.module;
        const fields = expr.objectFields;
        const values = expr.objectValues;
        const propertyLen = fields.length;

        // generate empty any obj
        const objValue = this.generateDynObj();
        // add objValue to current scope, push assign statement
        const objLocalVar = this.generateTmpVar('~obj|', 'any');
        const objLocalVarType = objLocalVar.varType;
        const objLocalVarWasmType =
            this.wasmType.getWASMHeapType(objLocalVarType);
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
            const setPropertyExpression = module.call(
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
            );
            this.statementArray.push(setPropertyExpression);
        }
        return this.getVariableValue(objLocalVar, objLocalVarWasmType);
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
}

class WASMStatementGen {
    module;
    wasmExprGen;
    constructor(private WASMCompiler: WASMGen) {
        this.module = this.WASMCompiler.module;
        this.wasmExprGen = new WASMExpressionGen(this.WASMCompiler);
    }

    WASMStmtGen(stmt: Statement): binaryen.ExpressionRef {
        switch (stmt.statementKind) {
            case ts.SyntaxKind.ExpressionStatement:
                return this.WASMExprStmt(<ExpressionStatement>stmt);
            default:
                break;
        }
        return this.module.unreachable();
    }

    WASMExprStmt(stmt: ExpressionStatement): binaryen.ExpressionRef {
        const innerExpr = stmt.expression;
        if (innerExpr.expressionKind !== ts.SyntaxKind.BinaryExpression) {
            throw new Error('unexpected situation');
        }
        const binaryExpr = <BinaryExpression>innerExpr;
        return this.wasmExprGen.WASMExprGen(binaryExpr);
    }
}

function findVariable(name: string): Variable {
    // TODO

    return new Variable('', new Type(), 0, 0);
}

function findType(name: string): Type {
    // TODO
    return new Type();
}

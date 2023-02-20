import ts from 'typescript';
import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import {
    builtinTypes,
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
    ParenthesizedExpression,
    FunctionExpression,
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
    Scope,
    NamespaceScope,
} from './scope.js';
import { MatchKind, Stack } from './utils.js';
import { dyntype } from '../lib/dyntype/utils.js';
import { BuiltinNames } from '../lib/builtin/builtinUtil.js';
import { charArrayTypeInfo, stringTypeInfo } from './glue/packType.js';
import { typeInfo } from './glue/utils.js';
import { isDynFunc, getReturnTypeRef } from './envInit.js';
import { WASMGen } from './wasmGen.js';

/* Access information, this is used as return value of IdentifierExpr handler
    or PropertyAccessExpr handler. If these handlers are called with byRef == true,
    or the result is not a direct value (Type, scope), then the Access information
    is returned
*/

enum AccessType {
    LocalVar,
    GlobalVar,
    ClosureVar,
    Function,
    Method,
    Struct,
    Array,
    DynObject,
    DynArray,
    Type,
    Scope,
}

class AccessBase {
    constructor(
        public readonly accessType: AccessType,
    ) { }
}

class TypedAccessBase extends AccessBase {
    constructor(
        public readonly accessType: AccessType,
        public readonly tsType: Type,
    ) {
        super(accessType)
    }
}

class LocalAccess extends TypedAccessBase {
    constructor(
        public index: number,
        public wasmType: binaryenCAPI.TypeRef,
        public tsType: Type,
    ) {
        super(AccessType.LocalVar, tsType);
    }
}

class GlobalAccess extends TypedAccessBase {
    constructor(
        public varName: string,
        public wasmType: binaryenCAPI.TypeRef,
        public tsType: Type,
    ) {
        super(AccessType.GlobalVar, tsType);
    }
}

class ClosureAccess extends TypedAccessBase {
    constructor(
        public index: number,
        public wasmType: binaryenCAPI.TypeRef,
        public closureScope: Scope,
        public tsType: Type,
    ) {
        super(AccessType.ClosureVar, tsType);
    }
}

class FunctionAccess extends AccessBase {
    constructor(
        public funcScope: FunctionScope,
    ) {
        super(AccessType.Function);
    }
}

class MethodAccess extends AccessBase {
    constructor(
        public methodType: TSFunction,
        public thisObj: binaryen.ExpressionRef | null = null,
    ) {
        super(AccessType.Function);
    }
}

class StructAccess extends TypedAccessBase {
    constructor(
        public ref: binaryen.ExpressionRef,
        public fieldIndex: number,
        public wasmType: binaryenCAPI.TypeRef,
        tsType: Type,
    ) {
        super(AccessType.Struct, tsType);
    }
}

class ArrayAccess extends TypedAccessBase {
    constructor(
        public ref: binaryen.ExpressionRef,
        public index: number,
        public wasmType: binaryenCAPI.TypeRef,
        tsType: Type,
    ) {
        super(AccessType.Array, tsType);
    }
}

class DynObjectAccess extends AccessBase {
    constructor(
        public ref: binaryen.ExpressionRef,
        public fieldName: string,
    ) {
        super(AccessType.DynObject);
    }
}

class DynArrayAccess extends AccessBase {
    constructor(
        public ref: binaryen.ExpressionRef,
        public index: binaryen.ExpressionRef,
    ) {
        super(AccessType.DynArray);
    }
}

class TypeAccess extends AccessBase {
    constructor(
        public type: Type,
    ) {
        super(AccessType.Type);
    }
}

class ScopeAccess extends AccessBase {
    constructor(
        public scope: Scope,
    ) {
        super(AccessType.Scope);
    }
}

export class WASMExpressionBase {
    wasmCompiler;
    module;
    wasmType;
    currentFuncCtx;
    globalTmpVarStack;
    localTmpVarStack;
    staticValueGen;
    dynValueGen;
    enterModuleScope;

    constructor(WASMCompiler: WASMGen) {
        this.wasmCompiler = WASMCompiler;
        this.module = this.wasmCompiler.module;
        this.wasmType = this.wasmCompiler.wasmType;
        this.currentFuncCtx = this.wasmCompiler.curFunctionCtx!;
        this.globalTmpVarStack = new Stack<string>();
        this.localTmpVarStack = new Stack<string>();
        this.staticValueGen = this.wasmCompiler.wasmExprCompiler;
        this.dynValueGen = this.wasmCompiler.wasmDynExprCompiler;
        this.enterModuleScope = this.wasmCompiler.enterModuleScope;
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
            variableType = builtinTypes.get(TypeKind.ANY)!;
        } else if (typeName === 'address') {
            variableType = builtinTypes.get(TypeKind.BOOLEAN)!;
        } else if (typeName === 'number') {
            variableType = builtinTypes.get(TypeKind.NUMBER)!;
        } else if (typeName === 'boolean') {
            variableType = builtinTypes.get(TypeKind.BOOLEAN)!;
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
        const currentScope = this.currentFuncCtx.getCurrentScope();
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
        const currentScope = this.currentFuncCtx.getCurrentScope();
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
                    leftExprRef,
                    this.convertTypeToF64(rightExprRef, binaryen.i32),
                    binaryen.f64,
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
                        this.convertTypeToF64(leftExprRef, binaryen.i32),
                        rightExprRef,
                        binaryen.f64,
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
            builtinTypes.get(TypeKind.ANY)!,
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
        this.currentFuncCtx.insert(anyOperation);

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
            builtinTypes.get(TypeKind.ANY)!,
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
        this.currentFuncCtx.insert(anyOperation);
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
            BuiltinNames.extref_table,
            tmpTableIdx,
            binaryen.anyref,
        );

        const tmpObjVarInfo = this.generateTmpVar('~obj|', '', targetType);

        // cast anyref to target type
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
        // table type is anyref, no need to cast
        const objTarget = dynValue;
        // put table index into a local
        const tmpTableIndexVar = this.generateTmpVar('~tableIdx|', 'boolean');
        const setTableIdxExpr = this.setVariableToCurrentScope(
            tmpTableIndexVar,
            module.table.size(BuiltinNames.extref_table),
        );
        this.currentFuncCtx.insert(setTableIdxExpr);
        const tableCurIndex = this.getVariableValue(
            tmpTableIndexVar,
            binaryen.i32,
        );
        const tableGrowExpr = module.table.grow(
            BuiltinNames.extref_table,
            objTarget,
            module.i32.const(1),
        );
        this.currentFuncCtx.insert(module.drop(tableGrowExpr));
        const varAndStates = this.generatePointerVar(4);
        const tmpAddressVar = <Variable>varAndStates[0];
        const setTmpAddressExpression = <binaryen.ExpressionRef>varAndStates[1];
        const setTmpGlobalExpression = <binaryen.ExpressionRef>varAndStates[2];
        const tmpAddressValue = <binaryen.ExpressionRef>varAndStates[4];
        this.currentFuncCtx.insert(setTmpAddressExpression);
        this.currentFuncCtx.insert(setTmpGlobalExpression);
        const storeIdxExpression = module.i32.store(
            0,
            4,
            tmpAddressValue,
            tableCurIndex,
        );
        this.currentFuncCtx.insert(storeIdxExpression);
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
                    this.wasmType.getWASMType(elemType),
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
        let res = this.WASMExprGenInternal(expr);
        if (res instanceof AccessBase) {
            throw Error(`Expression is not a value`)
        }
        return res as binaryen.ExpressionRef;
    }

    private WASMExprGenInternal(expr: Expression,
        byRef: boolean = false)
        : binaryen.ExpressionRef | AccessBase {
        this.module = this.wasmCompiler.module;
        this.wasmType = this.wasmCompiler.wasmType;
        this.staticValueGen = this.wasmCompiler.wasmExprCompiler;
        this.dynValueGen = this.wasmCompiler.wasmDynExprCompiler;
        this.currentFuncCtx = this.wasmCompiler.curFunctionCtx!;
        this.enterModuleScope = this.wasmCompiler.enterModuleScope!;

        switch (expr.expressionKind) {
            case ts.SyntaxKind.NumericLiteral:
                return this.WASMNumberLiteral(<NumberLiteralExpression>expr);
            case ts.SyntaxKind.FalseKeyword:
                return this.module.i32.const(0);
            case ts.SyntaxKind.TrueKeyword:
                return this.module.i32.const(1);
            case ts.SyntaxKind.NullKeyword:
                return this.module.ref.null(emptyStructType.typeRef);
            case ts.SyntaxKind.StringLiteral:
                return this.WASMStringLiteral(<StringLiteralExpression>expr);
            case ts.SyntaxKind.Identifier:
                return this.WASMIdenfierExpr(<IdentifierExpression>expr, byRef);
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
                const parentesizedExpr = <ParenthesizedExpression>expr;
                return this.WASMExprGenInternal(parentesizedExpr.parentesizedExpr);
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
                    byRef,
                );
            case ts.SyntaxKind.ElementAccessExpression:
                return this.WASMElementAccessExpr(
                    <ElementAccessExpression>expr,
                    byRef,
                );
            case ts.SyntaxKind.NewExpression: {
                return this.WASMNewExpr(<NewExpression>expr);
            }
            case ts.SyntaxKind.AsExpression:
                return this.WASMAsExpr(<AsExpression>expr);
            case ts.SyntaxKind.FunctionExpression:
            case ts.SyntaxKind.ArrowFunction:
                return this.WASMFuncExpr(<FunctionExpression>expr);
            default:
                throw new Error('unexpected expr kind ' + expr.expressionKind);
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

    private _loadFromAccessInfo(accessInfo: AccessBase): binaryen.ExpressionRef | AccessBase {
        const module = this.module;
        let loadRef: binaryen.ExpressionRef;

        /* Load value according to accessInfo returned from
            Identifier or PropertyAccess */
        if (accessInfo instanceof GlobalAccess) {
            let { varName, wasmType } = accessInfo;
            loadRef = module.global.get(varName, wasmType);
        }
        else if (accessInfo instanceof LocalAccess) {
            let { index, wasmType } = accessInfo;
            loadRef = module.local.get(index, wasmType);
        }
        else if (accessInfo instanceof FunctionAccess) {
            let { funcScope } = accessInfo;
            loadRef = this.WASMFuncExpr(new FunctionExpression(funcScope));
        }
        else if (accessInfo instanceof StructAccess) {
            let { ref, fieldIndex, wasmType } = accessInfo

            loadRef = binaryenCAPI._BinaryenStructGet(
                module.ptr,
                fieldIndex,
                ref,
                wasmType,
                false,
            );
        }
        else if (accessInfo instanceof ArrayAccess) {
            let { ref, index, wasmType } = accessInfo

            loadRef = binaryenCAPI._BinaryenArrayGet(
                module.ptr,
                ref,
                index,
                wasmType,
                false,
            );
        }
        else if (accessInfo instanceof DynObjectAccess) {
            let { ref, fieldName } = accessInfo;
            if (fieldName === '__proto__') {
                loadRef = module.drop(
                    module.call(
                        dyntype.dyntype_get_prototype,
                        [
                            module.global.get(
                                dyntype.dyntype_context,
                                dyntype.dyn_ctx_t,
                            ),
                            ref,
                        ],
                        dyntype.dyn_value_t,
                    ),
                );
            }
            else {
                const propNameStr = module.i32.const(
                    this.wasmCompiler.generateRawString(fieldName),
                );

                loadRef = module.call(
                    dyntype.dyntype_get_property,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        ref,
                        propNameStr,
                    ],
                    dyntype.dyn_value_t,
                )
            }
        }
        else if (accessInfo instanceof DynArrayAccess) {
            throw Error(`dynamic array not implemented`);
        }
        else {
            return accessInfo;
        }

        return loadRef;
    }

    private _createAccessInfo(identifer: string, scope: Scope, nested: boolean = true): AccessBase {
        /* Step1: Find item according to identifier */
        let identifierInfo = scope.findIdentifier(identifer, nested);
        if (identifierInfo instanceof Variable) {
            const variable = identifierInfo;
            let varType = this.wasmType.getWASMType(variable.varType);
            if (variable.varType instanceof TSFunction) {
                varType = this.wasmType.getWASMFuncStructType(
                    variable.varType
                );
            }

            if (!variable.isLocalVar) {
                return new GlobalAccess(variable.mangledName, varType, variable.varType);
            }
            else if (variable.varIsClosure) {
                /* TODO: process closure var */
                throw Error("unimplement");
            }
            else {
                /* Local variable */
                return new LocalAccess(variable.varIndex, varType, variable.varType);
            }
        }
        else if (identifierInfo instanceof FunctionScope) {
            return new FunctionAccess(identifierInfo);
        }
        else if (identifierInfo instanceof NamespaceScope) {
            let namespaceScope = identifierInfo;
            return new ScopeAccess(namespaceScope);
        }
        else if (identifierInfo instanceof Type) {
            let tsType = identifierInfo;
            return new TypeAccess(tsType);
        }
        else {
            throw new Error(
                `Can't find identifier <"${identifer}">`,
            );
        }
    }

    /* If byRef === true, return AccessInfo for left-value, but right-value is still returned by value */
    private WASMIdenfierExpr(
        expr: IdentifierExpression,
        byRef: boolean = false,
    ): binaryen.ExpressionRef | AccessBase {
        // find the target scope
        let currentScope = this.currentFuncCtx.getCurrentScope();
        let accessInfo = this._createAccessInfo(expr.identifierName, currentScope, true);
        if (!byRef) {
            return this._loadFromAccessInfo(accessInfo);
        }

        return accessInfo;
    }

    private WASMBinaryExpr(expr: BinaryExpression): binaryen.ExpressionRef {
        const leftExpr = expr.leftOperand;
        const rightExpr = expr.rightOperand;
        const operatorKind = expr.operatorKind;
        const leftExprType = leftExpr.exprType;
        const rightExprType = rightExpr.exprType;
        let rightExprRef = this.WASMExprGen(rightExpr);
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
                        unaryExpr.operatorKind !==
                        ts.SyntaxKind.PlusPlusToken &&
                        unaryExpr.operatorKind !== ts.SyntaxKind.MinusMinusToken
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
                let leftExprRef = this.WASMExprGen(leftExpr);

                if (
                    leftExpr.expressionKind ===
                    ts.SyntaxKind.PostfixUnaryExpression ||
                    leftExpr.expressionKind ===
                    ts.SyntaxKind.PrefixUnaryExpression
                ) {
                    const unaryExpr = <UnaryExpression>leftExpr;
                    if (
                        unaryExpr.operatorKind ===
                        ts.SyntaxKind.PlusPlusToken ||
                        unaryExpr.operatorKind === ts.SyntaxKind.MinusMinusToken
                    ) {
                        leftExprRef = <binaryen.ExpressionRef>(
                            this._generateUnaryExprBlock(unaryExpr, leftExprRef)
                        );
                    }
                }
                if (
                    rightExpr.expressionKind ===
                    ts.SyntaxKind.PostfixUnaryExpression ||
                    rightExpr.expressionKind ===
                    ts.SyntaxKind.PrefixUnaryExpression
                ) {
                    const unaryExpr = <UnaryExpression>rightExpr;
                    if (
                        unaryExpr.operatorKind ===
                        ts.SyntaxKind.PlusPlusToken ||
                        unaryExpr.operatorKind === ts.SyntaxKind.MinusMinusToken
                    ) {
                        rightExprRef = <binaryen.ExpressionRef>(
                            this._generateUnaryExprBlock(
                                unaryExpr,
                                rightExprRef,
                            )
                        );
                    }
                }
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
        throw new Error(
            'unexpected left expr type ' +
            leftExprType.kind +
            'unexpected right expr type ' +
            rightExprType.kind,
        );
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

        let accessInfo = this.WASMExprGenInternal(leftExpr, true);
        if (accessInfo instanceof GlobalAccess) {
            let { varName } = accessInfo;
            return module.global.set(varName, assignValue);
        }
        else if (accessInfo instanceof LocalAccess) {
            let { index } = accessInfo;
            return module.local.set(index, assignValue);
        }
        else if (accessInfo instanceof StructAccess) {
            let { ref, fieldIndex } = accessInfo

            return binaryenCAPI._BinaryenStructSet(
                module.ptr,
                fieldIndex,
                ref,
                assignValue,
            );
        }
        else if (accessInfo instanceof ArrayAccess) {
            let { ref, index } = accessInfo

            return binaryenCAPI._BinaryenArraySet(
                module.ptr,
                ref,
                index,
                assignValue,
            );
        }
        else if (accessInfo instanceof DynObjectAccess) {
            let { ref, fieldName } = accessInfo;
            if (fieldName === '__proto__') {
                return module.drop(
                    module.call(
                        dyntype.dyntype_set_prototype,
                        [
                            module.global.get(
                                dyntype.dyntype_context,
                                dyntype.dyn_ctx_t,
                            ),
                            ref,
                            assignValue,
                        ],
                        dyntype.int,
                    ),
                );
            }
            const propNameStr = module.i32.const(
                this.wasmCompiler.generateRawString(fieldName),
            );
            const setPropertyExpression = module.drop(
                module.call(
                    dyntype.dyntype_set_property,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        ref,
                        propNameStr,
                        this.dynValueGen.WASMDynExprGen(rightExpr)!,
                    ],
                    dyntype.int,
                ),
            );
            return setPropertyExpression;
        }
        else if (accessInfo instanceof DynArrayAccess) {
            throw Error(`Dynamic array not implemented`)
        }
        else {
            /* TODO: print the related source code */
            throw new Error(
                `Invalid assign target`,
            );
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
            } else if (leftExprType.kind === TypeKind.ARRAY) {
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

                return this.matchType(
                    leftArrayType.elementType,
                    rightArrayType.elementType,
                );
            } else if (leftExprType.kind === TypeKind.CLASS) {
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
            } else if (leftExprType.kind === TypeKind.FUNCTION) {
                const leftFuncType = <TSFunction>leftExprType;
                const rightFuncType = <TSFunction>rightExprType;
                if (
                    this.matchType(
                        leftFuncType.returnType,
                        rightFuncType.returnType,
                    ) == MatchKind.MisMatch
                ) {
                    return MatchKind.MisMatch;
                }

                const leftParams = leftFuncType.getParamTypes();
                const rightParams = rightFuncType.getParamTypes();
                if (leftParams.length !== rightParams.length) {
                    return MatchKind.MisMatch;
                }

                for (let i = 0; i < leftParams.length; i++) {
                    if (
                        this.matchType(leftParams[i], rightParams[i]) ==
                        MatchKind.MisMatch
                    ) {
                        return MatchKind.MisMatch;
                    }
                }

                // TODO: check rest parameters
                return MatchKind.ExactMatch;
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
            case ts.SyntaxKind.PlusToken: {
                return this.WASMExprGen(operand);
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
        const currentScope = this.currentFuncCtx.getCurrentScope();
        const callExpr = expr.callExpr;

        let callWasmArgs = expr.callArgs.map((expr) => {
            return this.WASMExprGen(expr);
        })

        const accessInfo = this.WASMExprGenInternal(callExpr);
        if (accessInfo instanceof AccessBase) {
            if (accessInfo instanceof FunctionAccess) {
                const { funcScope } = accessInfo;
                let thisObj: binaryen.ExpressionRef | null = null;

                if (callWasmArgs.length + 1 < funcScope.paramArray.length) {
                    for (
                        let i = callWasmArgs.length + 1;
                        i < funcScope.paramArray.length;
                        i++
                    ) {
                        callWasmArgs.push(
                            this.WASMExprGen(funcScope.paramArray[i].initExpression!)
                        )
                    }
                }

                if (funcScope.isMethod()) {
                    /* Call class method */
                    if (thisObj) {
                        callWasmArgs = [thisObj, ...callWasmArgs];
                    }

                    return this.module.call(
                        funcScope.mangledName,
                        callWasmArgs,
                        this.wasmType.getWASMFuncReturnType(funcScope.funcType),
                    );
                }
                else {
                    /* Direct call */
                    let context = binaryenCAPI._BinaryenRefNull(
                        this.module.ptr,
                        emptyStructType.typeRef,
                    );

                    if (funcScope.getIsClosure()) {
                        throw Error(`unimplemented`);
                    }

                    return this.module.call(
                        funcScope.mangledName,
                        [context, ...callWasmArgs],
                        this.wasmType.getWASMFuncReturnType(funcScope.funcType),
                    );
                }
            }
            else if (accessInfo instanceof MethodAccess) {
                throw Error(`call class method not supported`);
            }
            else {
                throw Error(`invalid call target`);
            }
        }
        else {
            /* Call a closure */
            const closureRef = accessInfo;
            const closureType = binaryenCAPI._BinaryenExpressionGetType(closureRef);
            const closureHeapType = binaryenCAPI._BinaryenTypeGetHeapType(closureType);
            const context = binaryenCAPI._BinaryenStructGet(
                this.module.ptr,
                0,
                closureRef,
                closureHeapType,
                false,
            );
            const funcref = binaryenCAPI._BinaryenStructGet(
                this.module.ptr,
                1,
                closureRef,
                closureHeapType,
                false,
            );

            return binaryenCAPI._BinaryenCallRef(
                this.module.ptr,
                funcref,
                arrayToPtr([context, ...callWasmArgs]).ptr,
                callWasmArgs.length + 1,
                binaryenCAPI._BinaryenExpressionGetType(funcref),
                false,
            );
        }
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

    private WASMSuperExpr(expr: SuperCallExpression): binaryen.ExpressionRef {
        // must in a constructor
        const module = this.module;
        const scope = <FunctionScope>this.currentFuncCtx.getCurrentScope();
        const classScope = <ClassScope>scope.getNearestFunctionScope()!.parent;
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
        return module.drop(
            module.call(
                baseClassType.className + '_constructor',
                wasmArgs,
                binaryen.none,
            ),
        );
    }

    private WASMNewExpr(expr: NewExpression): binaryen.ExpressionRef {
        const type = expr.exprType;
        const module = this.module;
        if (type.kind === TypeKind.ARRAY) {
            const arrayHeapType = this.wasmType.getWASMHeapType(type);
            if (expr.lenExpr) {
                const arraySize = this.convertTypeToI32(
                    this.WASMExprGen(expr.lenExpr),
                    binaryen.f64,
                );
                const arrayInit = this.getArrayInitFromArrayType(<TSArray>type);
                return binaryenCAPI._BinaryenArrayNew(
                    module.ptr,
                    arrayHeapType,
                    arraySize,
                    arrayInit,
                    /* Note: We should use binaryen.none here, but currently
                        the corresponding opcode is not supported by runtime */
                );
            } else if (!expr.NewArgs) {
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

            const args = new Array<binaryen.ExpressionRef>();
            args.push(newStruct);
            if (expr.NewArgs) {
                for (const arg of expr.NewArgs) {
                    args.push(this.WASMExprGen(arg));
                }
            }

            throw Error(`call class method not supported`);
        }
        return binaryen.none;
    }

    private WASMPropertyAccessExpr(
        expr: PropertyAccessExpression, byRef: boolean = false,
    ): binaryen.ExpressionRef | AccessBase {
        const module = this.module;
        const objPropAccessExpr = expr.propertyAccessExpr;
        const propExpr = expr.propertyExpr;
        const propIdenExpr = <IdentifierExpression>propExpr;
        const propName = propIdenExpr.identifierName;
        let curAccessInfo: AccessBase | null = null;

        let accessInfo = this.WASMExprGenInternal(objPropAccessExpr, true);
        if (accessInfo instanceof TypedAccessBase) {
            let { tsType } = accessInfo;
            const loadRef = this._loadFromAccessInfo(accessInfo);
            if (loadRef instanceof AccessBase) {
                throw Error(`invalid property access`);
            }

            if (tsType instanceof TSClass) {
                /* Access class field or method */
                let propIndex = tsType.getMemberFieldIndex(propName);
                if (propIndex != -1) {
                    /* member field */
                    let propType = tsType.getMemberField(propName)!.type;
                    curAccessInfo = new StructAccess(
                        loadRef,
                        propIndex + 1,  /* The first slot is reserved for vtable */
                        this.wasmType.getWASMType(propType),
                        propType
                    )
                }
                else if (tsType.getMethodIndex(propName) != -1) {
                    /* class method */
                    const method = tsType.getMethod(propName);
                    /* Currently, we don't have a mechanism to get FunctionScope
                        from TsClassFunc.
                       This is just a work around, we get the class's defined scope
                        (parent scope of the class), then find the ClassScope, then
                        find the method's FunctionScope */
                    // curAccessInfo = new MethodAccess(
                    //     method!.scope as FunctionScope,
                    //     loadRef
                    // );
                    throw Error(`call class method not supported`);
                }
                else {
                    throw new Error(`${propName} property does not exist on ${tsType}`);
                }
            }
            else if (tsType instanceof Primitive) {
                if (tsType.typeKind === TypeKind.ANY) {
                    /* Any-objects */
                    curAccessInfo = new DynObjectAccess(
                        loadRef,
                        propName
                    )
                }
                else {
                    /* TODO: boxing other primitive types */
                }
            }
        }
        else if (accessInfo instanceof DynObjectAccess) {
            const loadRef = this._loadFromAccessInfo(accessInfo);
            if (loadRef instanceof AccessBase) {
                throw Error(`invalid property access`);
            }

            curAccessInfo = new DynObjectAccess(loadRef, propName);
        }
        else if (accessInfo instanceof ScopeAccess) {
            curAccessInfo = this._createAccessInfo(propName, accessInfo.scope, false);
        }
        else if (accessInfo instanceof Type) {
            throw Error("unimplement");
        }
        else {
            /* TODO: print the related source code */
            throw Error(
                `Invalid property access receiver`,
            );
        }

        if (!curAccessInfo) {
            throw Error(`unexpected error during processing propertyAccessExpression`);
        }

        if (!byRef) {
            return this._loadFromAccessInfo(curAccessInfo);
        }

        return curAccessInfo;
    }

    private WASMElementAccessExpr(
        expr: ElementAccessExpression, byRef: boolean = false,
    ): binaryen.ExpressionRef | AccessBase {
        const module = this.module;
        const accessExpr = expr.accessExpr;
        const argExpr = expr.argExpr;
        const accessInfo = this.WASMExprGenInternal(accessExpr, true) as AccessBase;
        const index = this.convertTypeToI32(
            this.WASMExprGen(argExpr),
            binaryen.f64,
        );
        const arrayType = <TSArray>accessExpr.exprType;
        const arrayRef = this._loadFromAccessInfo(accessInfo);
        if (arrayRef instanceof AccessBase) {
            throw Error(`invalid property access`);
        }

        if (arrayType instanceof TSArray) {
            const elementType = arrayType.elementType;
            const elemWasmType = this.wasmType.getWASMType(elementType);

            if (!byRef) {
                return binaryenCAPI._BinaryenArrayGet(
                    module.ptr,
                    arrayRef,
                    index,
                    elemWasmType,
                    false,
                );
            }
            else {
                return new ArrayAccess(arrayRef, index, elemWasmType, elementType);
            }
        }
        else {
            /* Any-objects */
            if (!byRef) {
                throw Error(`Dynamic array not implemented`);
            }
            else {
                return new DynArrayAccess(arrayRef, index);
            }
        }
    }

    private WASMAsExpr(expr: AsExpression): binaryen.ExpressionRef {
        const module = this.module;
        const originObjExpr = <IdentifierExpression>expr.expression;
        const originObjExprRef = this.WASMExprGen(originObjExpr);
        const originObjName = originObjExpr.identifierName;
        const targetType = expr.exprType;
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
        this.currentFuncCtx.insert(setTmpAddressExpression);
        this.currentFuncCtx.insert(setTmpGlobalExpression);
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
        this.currentFuncCtx.insert(toExtref);
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
        this.currentFuncCtx.insert(turnExtrefToObjExpression);
        this.currentFuncCtx.insert(resetGlobalExpression);
        return this.getVariableValue(
            tmpObjVarInfo,
            this.wasmType.getWASMType(targetType),
        );
    }

    private WASMFuncExpr(expr: FunctionExpression): binaryen.ExpressionRef {
        const funcScope = expr.funcScope;
        const wasmFuncType = this.wasmType.getWASMType(funcScope.funcType);
        const funcStructType = this.wasmType.getWASMFuncStructHeapType(
            funcScope.funcType,
        );

        const context = binaryenCAPI._BinaryenRefNull(
            this.module.ptr,
            emptyStructType.typeRef,
        );

        return binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([
                context,
                this.module.ref.func(funcScope.mangledName, wasmFuncType),
            ]).ptr,
            2,
            funcStructType,
        );
    }

    /* get callref from class struct vtable index */
    private _generateClassMethodCallRef(
        classRef: binaryen.ExpressionRef,
        classType: TSClass,
        methodType: TSFunction,
        index: number,
        args: Array<binaryen.ExpressionRef>,
    ) {
        const wasmMethodType = this.wasmType.getWASMType(methodType);
        const vtable = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            0,
            classRef,
            this.wasmType.getWASMClassVtableType(classType),
            false,
        );
        const targetFunction = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            index,
            vtable,
            wasmMethodType,
            false,
        );
        return binaryenCAPI._BinaryenCallRef(
            this.module.ptr,
            targetFunction,
            arrayToPtr(args).ptr,
            args.length,
            wasmMethodType,
            false,
        );
    }

    private _generateUnaryExprBlock(
        unaryExpr: UnaryExpression,
        exprRef: binaryen.ExpressionRef,
    ) {
        if (unaryExpr.expressionKind === ts.SyntaxKind.PrefixUnaryExpression) {
            if (
                unaryExpr.operatorKind === ts.SyntaxKind.PlusPlusToken ||
                unaryExpr.operatorKind === ts.SyntaxKind.MinusMinusToken
            ) {
                return this.wasmCompiler.module.block(
                    null,
                    [exprRef, this.WASMExprGen(unaryExpr.operand)],
                    binaryen.f64,
                );
            }
        }
        if (unaryExpr.expressionKind === ts.SyntaxKind.PostfixUnaryExpression) {
            const wasmUnaryOperandExpr = this.WASMExprGen(unaryExpr.operand);
            if (unaryExpr.operatorKind === ts.SyntaxKind.PlusPlusToken) {
                return this.wasmCompiler.module.block(
                    null,
                    [
                        exprRef,
                        this.module.f64.sub(
                            wasmUnaryOperandExpr,
                            this.module.f64.const(1),
                        ),
                    ],
                    binaryen.f64,
                );
            }
            if (unaryExpr.operatorKind === ts.SyntaxKind.MinusMinusToken) {
                return this.wasmCompiler.module.block(
                    null,
                    [
                        exprRef,
                        this.module.f64.add(
                            wasmUnaryOperandExpr,
                            this.module.f64.const(1),
                        ),
                    ],
                    binaryen.f64,
                );
            }
        }
    }
}

export class WASMDynExpressionGen extends WASMExpressionBase {
    constructor(WASMCompiler: WASMGen) {
        super(WASMCompiler);
    }

    WASMDynExprGen(expr: Expression): binaryen.ExpressionRef {
        this.module = this.wasmCompiler.module;
        this.wasmType = this.wasmCompiler.wasmType;
        this.staticValueGen = this.wasmCompiler.wasmExprCompiler;
        this.dynValueGen = this.wasmCompiler.wasmDynExprCompiler;
        this.currentFuncCtx = this.wasmCompiler.curFunctionCtx!;

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
            case ts.SyntaxKind.StringLiteral: {
                const stringExpr = <StringLiteralExpression>expr;
                return this.generateDynString(
                    this.module.i32.const(
                        this.wasmCompiler.generateRawString(
                            stringExpr.expressionValue,
                        ),
                    ),
                );
            }
            case ts.SyntaxKind.NullKeyword:
                return this.generateDynNull();
            case ts.SyntaxKind.Identifier: {
                const identifierExpr = <IdentifierExpression>expr;
                if (identifierExpr.identifierName === 'undefined') {
                    return this.generateDynUndefined();
                } else {
                    // generate dynExtref iff identifier's type is not any
                    // judge if identifierExpr's type is primitive
                    const extrfIdenType = identifierExpr.exprType;
                    switch (extrfIdenType.kind) {
                        case TypeKind.NUMBER:
                            return this.generateDynNumber(
                                this.staticValueGen.WASMExprGen(expr),
                            );
                        case TypeKind.BOOLEAN:
                            return this.generateDynBoolean(
                                this.staticValueGen.WASMExprGen(expr),
                            );
                        case TypeKind.NULL:
                            return this.generateDynNull();
                        case TypeKind.ANY:
                            return this.staticValueGen.WASMExprGen(
                                identifierExpr,
                            );
                        default:
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
        this.currentFuncCtx.insert(
            this.setVariableToCurrentScope(objLocalVar, objValue),
        );
        // set obj's properties
        for (let i = 0; i < propertyLen; i++) {
            const propNameExpr = fields[i];
            const propNameExprRef = module.i32.const(
                this.wasmCompiler.generateRawString(
                    propNameExpr.identifierName,
                ),
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
            this.currentFuncCtx.insert(setPropertyExpression);
        }
        return this.getVariableValue(objLocalVar, objLocalVarWasmType);
    }
}

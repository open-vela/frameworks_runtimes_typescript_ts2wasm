import ts from 'typescript';
import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import {
    builtinTypes,
    Primitive,
    FunctionKind,
    TSArray,
    TSClass,
    TSFunction,
    TSInterface,
    Type,
    TypeKind,
} from './type.js';
import { Variable } from './variable.js';
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
import {
    arrayToPtr,
    createCondBlock,
    emptyStructType,
} from './glue/transform.js';
import { assert } from 'console';
import {
    FunctionScope,
    GlobalScope,
    ClassScope,
    ScopeKind,
    Scope,
    NamespaceScope,
    ClosureEnvironment,
} from './scope.js';
import { MatchKind, Stack } from './utils.js';
import { dyntype, structdyn } from '../lib/dyntype/utils.js';
import { BuiltinNames } from '../lib/builtin/builtinUtil.js';
import { charArrayTypeInfo, stringTypeInfo } from './glue/packType.js';
import { typeInfo } from './glue/utils.js';
import { isDynFunc, getReturnTypeRef } from './envInit.js';
import { WASMGen } from './wasmGen.js';

export interface WasmValue {
    /* binaryen reference */
    binaryenRef: binaryen.ExpressionRef;
    /* original type in source code */
    tsType: Type;
}

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
    Getter,
    Setter,
    Struct,
    Interface,
    Array,
    DynObject,
    DynArray,
    Type,
    Scope,
}

class AccessBase {
    constructor(public readonly accessType: AccessType) {}
}

class TypedAccessBase extends AccessBase {
    constructor(
        public readonly accessType: AccessType,
        public readonly tsType: Type,
    ) {
        super(accessType);
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

class FunctionAccess extends AccessBase {
    constructor(public funcScope: FunctionScope) {
        super(AccessType.Function);
    }
}

class MethodAccess extends AccessBase {
    constructor(
        public methodType: TSFunction,
        public methodIndex: number,
        public classType: TSClass,
        public thisObj: binaryen.ExpressionRef | null = null,
    ) {
        super(AccessType.Function);
    }
}

class GetterAccess extends AccessBase {
    constructor(
        public methodType: TSFunction,
        public methodIndex: number,
        public classType: TSClass,
        public thisObj: binaryen.ExpressionRef,
    ) {
        super(AccessType.Getter);
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

class InterfaceAccess extends TypedAccessBase {
    constructor(
        public infcTypeId: binaryen.ExpressionRef,
        public objTypeId: binaryen.ExpressionRef,
        public objRef: binaryen.ExpressionRef,
        public objType: binaryenCAPI.TypeRef,
        public fieldIndex: number,
        public dynFieldIndex: binaryen.ExpressionRef,
        tsType: Type,
    ) {
        super(AccessType.Interface, tsType);
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
    constructor(public ref: binaryen.ExpressionRef, public fieldName: string) {
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
    constructor(public type: Type) {
        super(AccessType.Type);
    }
}

class ScopeAccess extends AccessBase {
    constructor(public scope: Scope) {
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
        const tmpVar = new Variable(tmpNumberName, variableType, [], -1, true);
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
        let targetScope: Scope | null = currentScope.getNearestFunctionScope();
        if (!targetScope) {
            targetScope = currentScope.getRootGloablScope()!;
        }

        const variableIndex = targetScope.allocateLocalIndex();
        variable.setVarIndex(variableIndex);
        targetScope.addTempVar(variable);
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
            [],
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
            [],
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
            this.wasmType.getWASMType(targetType),
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

    generateDynExtref(
        dynValue: binaryen.ExpressionRef,
        extObjKind: dyntype.ExtObjKind,
    ) {
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
                module.i32.const(extObjKind),
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

    WASMExprGen(expr: Expression): WasmValue {
        const res = this.WASMExprGenInternal(expr);
        if (res instanceof AccessBase) {
            throw Error(`Expression is not a value`);
        }
        return res as WasmValue;
    }

    private WASMExprGenInternal(
        expr: Expression,
        byRef = false,
    ): WasmValue | AccessBase {
        this.module = this.wasmCompiler.module;
        this.wasmType = this.wasmCompiler.wasmType;
        this.staticValueGen = this.wasmCompiler.wasmExprCompiler;
        this.dynValueGen = this.wasmCompiler.wasmDynExprCompiler;
        this.currentFuncCtx = this.wasmCompiler.curFunctionCtx!;
        this.enterModuleScope = this.wasmCompiler.enterModuleScope!;

        let res: binaryen.ExpressionRef | AccessBase;

        switch (expr.expressionKind) {
            case ts.SyntaxKind.NumericLiteral:
                res = this.WASMNumberLiteral(<NumberLiteralExpression>expr);
                break;
            case ts.SyntaxKind.FalseKeyword:
                res = this.module.i32.const(0);
                break;
            case ts.SyntaxKind.TrueKeyword:
                res = this.module.i32.const(1);
                break;
            case ts.SyntaxKind.NullKeyword:
                res = this.module.ref.null(emptyStructType.typeRef);
                break;
            case ts.SyntaxKind.StringLiteral:
                res = this.WASMStringLiteral(<StringLiteralExpression>expr);
                break;
            case ts.SyntaxKind.Identifier:
                res = this.WASMIdenfierExpr(<IdentifierExpression>expr, byRef);
                break;
            case ts.SyntaxKind.BinaryExpression:
                res = this.WASMBinaryExpr(<BinaryExpression>expr);
                break;
            case ts.SyntaxKind.PrefixUnaryExpression:
            case ts.SyntaxKind.PostfixUnaryExpression:
                res = this.WASMUnaryExpr(<UnaryExpression>expr);
                break;
            case ts.SyntaxKind.ConditionalExpression:
                res = this.WASMConditionalExpr(<ConditionalExpression>expr);
                break;
            case ts.SyntaxKind.CallExpression: {
                res = this.WASMCallExpr(<CallExpression>expr);
                break;
            }
            case ts.SyntaxKind.SuperKeyword: {
                res = this.WASMSuperExpr(<SuperCallExpression>expr);
                break;
            }
            case ts.SyntaxKind.ParenthesizedExpression: {
                const parentesizedExpr = <ParenthesizedExpression>expr;
                return this.WASMExprGenInternal(
                    parentesizedExpr.parentesizedExpr,
                );
            }
            case ts.SyntaxKind.ArrayLiteralExpression:
                res = this.WASMArrayLiteralExpr(<ArrayLiteralExpression>expr);
                break;
            case ts.SyntaxKind.ObjectLiteralExpression:
                res = this.WASMObjectLiteralExpr(<ObjectLiteralExpression>expr);
                break;
            case ts.SyntaxKind.PropertyAccessExpression:
                res = this.WASMPropertyAccessExpr(
                    <PropertyAccessExpression>expr,
                    byRef,
                );
                break;
            case ts.SyntaxKind.ElementAccessExpression:
                res = this.WASMElementAccessExpr(
                    <ElementAccessExpression>expr,
                    byRef,
                );
                break;
            case ts.SyntaxKind.NewExpression: {
                res = this.WASMNewExpr(<NewExpression>expr);
                break;
            }
            case ts.SyntaxKind.AsExpression:
                res = this.WASMAsExpr(<AsExpression>expr);
                break;
            case ts.SyntaxKind.FunctionExpression:
            case ts.SyntaxKind.ArrowFunction:
                res = this.WASMFuncExpr(<FunctionExpression>expr);
                break;
            default:
                throw new Error('unexpected expr kind ' + expr.expressionKind);
        }

        if (res instanceof AccessBase) {
            return res;
        } else {
            return {
                binaryenRef: res,
                tsType: expr.exprType,
            };
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

    private _loadFromAccessInfo(
        accessInfo: AccessBase,
    ): binaryen.ExpressionRef | AccessBase {
        const module = this.module;
        let loadRef: binaryen.ExpressionRef = 0;

        /* Load value according to accessInfo returned from
            Identifier or PropertyAccess */
        if (accessInfo instanceof GlobalAccess) {
            const { varName, wasmType } = accessInfo;
            loadRef = module.global.get(varName, wasmType);
        } else if (accessInfo instanceof LocalAccess) {
            const { index, wasmType } = accessInfo;
            loadRef = module.local.get(index, wasmType);
        } else if (accessInfo instanceof FunctionAccess) {
            const { funcScope } = accessInfo;
            loadRef = this.WASMFuncExpr(new FunctionExpression(funcScope));
        } else if (accessInfo instanceof StructAccess) {
            const { ref, fieldIndex, wasmType } = accessInfo;

            loadRef = binaryenCAPI._BinaryenStructGet(
                module.ptr,
                fieldIndex,
                ref,
                wasmType,
                false,
            );
        } else if (accessInfo instanceof InterfaceAccess) {
            const {
                infcTypeId,
                objTypeId,
                objRef,
                objType,
                fieldIndex,
                dynFieldIndex,
                tsType, // field Type
            } = accessInfo;
            const castedObjRef = binaryenCAPI._BinaryenRefCast(
                module.ptr,
                objRef,
                objType,
            );
            const wasmFieldType = this.wasmType.getWASMType(tsType);
            const ifTrue = binaryenCAPI._BinaryenStructGet(
                module.ptr,
                fieldIndex,
                castedObjRef,
                wasmFieldType,
                false,
            );
            const ifFalse = this.dynGetInfcField(objRef, dynFieldIndex, tsType);

            loadRef = createCondBlock(
                module,
                infcTypeId,
                objTypeId,
                ifTrue,
                ifFalse,
            );
        } else if (accessInfo instanceof ArrayAccess) {
            const { ref, index, wasmType } = accessInfo;

            loadRef = binaryenCAPI._BinaryenArrayGet(
                module.ptr,
                ref,
                index,
                wasmType,
                false,
            );
        } else if (accessInfo instanceof DynObjectAccess) {
            const { ref, fieldName } = accessInfo;
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
            } else {
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
                );
            }
        } else if (accessInfo instanceof GetterAccess) {
            const { methodType, methodIndex, classType, thisObj } = accessInfo;
            if (!thisObj) {
                throw new Error(
                    `object is null when accessing getter method of class, class name is '${classType.className}'`,
                );
            }
            return this._generateClassMethodCallRef(
                thisObj,
                classType,
                methodType,
                methodIndex,
                [
                    binaryenCAPI._BinaryenRefNull(
                        module.ptr,
                        emptyStructType.typeRef,
                    ),
                    thisObj!,
                ],
            );
        } else if (accessInfo instanceof DynArrayAccess) {
            throw Error(`dynamic array not implemented`);
        } else {
            return accessInfo;
        }

        if (loadRef === 0) {
            throw Error(`Failed to load value from AccessInfo`);
        }

        return loadRef;
    }

    private _createAccessInfo(
        identifer: string,
        scope: Scope,
        nested = true,
    ): AccessBase {
        /* Step1: Find item according to identifier */
        const identifierInfo = scope.findIdentifier(identifer, nested);
        if (identifierInfo instanceof Variable) {
            const variable = identifierInfo;
            let varType = this.wasmType.getWASMType(variable.varType);
            if (variable.varType instanceof TSFunction) {
                varType = this.wasmType.getWASMFuncStructType(variable.varType);
            }

            if (!variable.isLocalVar) {
                return new GlobalAccess(
                    variable.mangledName,
                    varType,
                    variable.varType,
                );
            } else if (variable.varIsClosure) {
                const closureScope = variable.scope!;
                const closureIndex = variable.getClosureIndex();
                const currentScope = this.currentFuncCtx.getCurrentScope();
                const tsType = variable.varType;
                let scope: Scope | null = currentScope;

                /* Get current scope's context variable */
                let contextType = WASMGen.contextOfScope.get(scope)!.typeRef;
                let contextRef = this.module.local.get(
                    (scope as ClosureEnvironment).contextVariable!.varIndex,
                    contextType,
                );

                while (scope?.getNearestFunctionScope()) {
                    if (scope.kind === ScopeKind.ClassScope) {
                        scope = scope!.parent;
                        continue;
                    }
                    contextType = WASMGen.contextOfScope.get(scope!)!.typeRef;

                    if (scope !== closureScope) {
                        if ((scope as ClosureEnvironment).hasFreeVar) {
                            contextRef = binaryenCAPI._BinaryenStructGet(
                                this.module.ptr,
                                0,
                                contextRef,
                                contextType,
                                false,
                            );
                        }
                    } else {
                        /* Variable is defined in this scope, covert to StructAccess */
                        return new StructAccess(
                            contextRef,
                            closureIndex,
                            contextType,
                            tsType,
                        );
                    }
                    scope = scope!.parent;
                }

                throw Error(`Can't find closure scope`);
            } else {
                /* Local variable */
                return new LocalAccess(
                    variable.varIndex,
                    varType,
                    variable.varType,
                );
            }
        } else if (identifierInfo instanceof FunctionScope) {
            return new FunctionAccess(identifierInfo);
        } else if (
            identifierInfo instanceof NamespaceScope ||
            identifierInfo instanceof GlobalScope
        ) {
            return new ScopeAccess(identifierInfo);
        } else if (identifierInfo instanceof Type) {
            const tsType = identifierInfo;
            return new TypeAccess(tsType);
        } else {
            throw new Error(`Can't find identifier <"${identifer}">`);
        }
    }

    /* If byRef === true, return AccessInfo for left-value, but right-value is still returned by value */
    private WASMIdenfierExpr(
        expr: IdentifierExpression,
        byRef = false,
    ): binaryen.ExpressionRef | AccessBase {
        // find the target scope
        const currentScope = this.currentFuncCtx.getCurrentScope();
        const accessInfo = this._createAccessInfo(
            expr.identifierName,
            currentScope,
            true,
        );
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
        let rightExprRef = this.WASMExprGen(rightExpr).binaryenRef;
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
                let leftExprRef = this.WASMExprGen(leftExpr).binaryenRef;

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
            assignValue =
                this.dynValueGen.WASMDynExprGen(rightExpr).binaryenRef;
        } else {
            if (rightExprRef) {
                assignValue = rightExprRef;
            } else {
                assignValue = this.WASMExprGen(rightExpr).binaryenRef;
            }
        }
        if (matchKind === MatchKind.ClassInfcMatch) {
            assignValue = this.maybeTypeBoxingAndUnboxing(
                <TSClass>rightExprType,
                <TSClass>leftExprType,
                assignValue,
            );
        }
        const accessInfo = this.WASMExprGenInternal(leftExpr, true);
        if (accessInfo instanceof GlobalAccess) {
            const { varName } = accessInfo;
            return module.global.set(varName, assignValue);
        } else if (accessInfo instanceof LocalAccess) {
            const { index } = accessInfo;
            return module.local.set(index, assignValue);
        } else if (accessInfo instanceof StructAccess) {
            const { ref, fieldIndex } = accessInfo;

            return binaryenCAPI._BinaryenStructSet(
                module.ptr,
                fieldIndex,
                ref,
                assignValue,
            );
        } else if (accessInfo instanceof InterfaceAccess) {
            const {
                infcTypeId,
                objTypeId,
                objRef,
                objType,
                fieldIndex,
                dynFieldIndex,
                tsType, // field Type
            } = accessInfo;
            const castedObjRef = binaryenCAPI._BinaryenRefCast(
                module.ptr,
                objRef,
                objType,
            );
            const ifTrue = binaryenCAPI._BinaryenStructSet(
                module.ptr,
                fieldIndex,
                castedObjRef,
                assignValue,
            );
            const ifFalse = this.dynSetInfcField(
                objRef,
                dynFieldIndex,
                assignValue,
                tsType,
            );

            return module.if(
                module.i32.eq(infcTypeId, objTypeId),
                ifTrue,
                ifFalse,
            );
        } else if (accessInfo instanceof ArrayAccess) {
            const { ref, index } = accessInfo;

            return binaryenCAPI._BinaryenArraySet(
                module.ptr,
                ref,
                index,
                assignValue,
            );
        } else if (accessInfo instanceof DynObjectAccess) {
            const { ref, fieldName } = accessInfo;
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
                        this.dynValueGen.WASMDynExprGen(rightExpr)!.binaryenRef,
                    ],
                    dyntype.int,
                ),
            );
            return setPropertyExpression;
        } else if (accessInfo instanceof DynArrayAccess) {
            throw Error(`Dynamic array not implemented`);
        } else {
            /* TODO: print the related source code */
            throw new Error(`Invalid assign target`);
        }
    }

    private matchType(leftExprType: Type, rightExprType: Type): number {
        if (leftExprType.kind === rightExprType.kind) {
            if (
                leftExprType.kind === TypeKind.NUMBER ||
                leftExprType.kind === TypeKind.STRING ||
                leftExprType.kind === TypeKind.BOOLEAN ||
                leftExprType.kind === TypeKind.ANY ||
                leftExprType.kind === TypeKind.INTERFACE
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
                const leftClassName = leftClassType.mangledName;
                const rightClassName = rightClassType.mangledName;
                if (leftClassName === rightClassName) {
                    return MatchKind.ClassMatch;
                }
                /* iff explicit subtyping, such as class B extends A ==> it allows: a(A) = b(B)  */
                let rightClassBaseType = rightClassType.getBase();
                while (rightClassBaseType !== null) {
                    if (rightClassBaseType.mangledName === leftClassName) {
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
        if (
            (leftExprType.kind === TypeKind.CLASS &&
                rightExprType.kind === TypeKind.INTERFACE) ||
            (leftExprType.kind === TypeKind.INTERFACE &&
                rightExprType.kind === TypeKind.CLASS)
        ) {
            return MatchKind.ClassInfcMatch;
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
                let WASMOperandExpr = this.WASMExprGen(operand).binaryenRef;
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
                    const WASMOperandExpr =
                        this.WASMExprGen(operand).binaryenRef;
                    return this.module.f64.sub(
                        this.module.f64.const(0),
                        WASMOperandExpr,
                    );
                }
            }
            case ts.SyntaxKind.PlusToken: {
                return this.WASMExprGen(operand).binaryenRef;
            }
        }
        return this.module.unreachable();
    }

    private WASMConditionalExpr(
        expr: ConditionalExpression,
    ): binaryen.ExpressionRef {
        let condWASMExpr = this.WASMExprGen(expr.condtion).binaryenRef;
        const trueWASMExpr = this.WASMExprGen(expr.whenTrue).binaryenRef;
        const falseWASMExpr = this.WASMExprGen(expr.whenFalse).binaryenRef;
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
            return this.WASMExprGen(expr).binaryenRef;
        });

        /* In call expression, the callee may be a function scope rather than a variable,
            we use WASMExprGenInternal here which may return a FunctionAccess object */
        const accessInfo = this.WASMExprGenInternal(callExpr);
        if (accessInfo instanceof AccessBase) {
            if (accessInfo instanceof FunctionAccess) {
                const { funcScope } = accessInfo;

                if (callWasmArgs.length + 1 < funcScope.paramArray.length) {
                    for (
                        let i = callWasmArgs.length + 1;
                        i < funcScope.paramArray.length;
                        i++
                    ) {
                        callWasmArgs.push(
                            this.WASMExprGen(
                                funcScope.paramArray[i].initExpression!,
                            ).binaryenRef,
                        );
                    }
                }

                const context = binaryenCAPI._BinaryenRefNull(
                    this.module.ptr,
                    emptyStructType.typeRef,
                );
                for (let i = 0; i < expr.callArgs.length; i++) {
                    const argType = expr.callArgs[i].exprType,
                        paramType = funcScope.paramArray[i + 1].varType;
                    if (
                        argType instanceof TSClass &&
                        paramType instanceof TSClass
                    ) {
                        callWasmArgs[i] = this.maybeTypeBoxingAndUnboxing(
                            argType,
                            paramType,
                            callWasmArgs[i],
                        );
                    }
                }

                if (funcScope.hasFreeVar) {
                    throw Error(`unimplemented`);
                }

                return this.module.call(
                    funcScope.mangledName,
                    [context, ...callWasmArgs],
                    this.wasmType.getWASMFuncReturnType(funcScope.funcType),
                );
            } else if (accessInfo instanceof MethodAccess) {
                const { methodType, methodIndex, classType, thisObj } =
                    accessInfo;
                const refnull = binaryenCAPI._BinaryenRefNull(
                    this.module.ptr,
                    emptyStructType.typeRef,
                );
                // access static method
                if (!thisObj) {
                    const vtable = this.wasmType.getWASMClassVtable(classType);
                    const wasmFuncType = this.wasmType.getWASMType(methodType);
                    const target = binaryenCAPI._BinaryenStructGet(
                        this.module.ptr,
                        methodIndex,
                        vtable,
                        wasmFuncType,
                        false,
                    );
                    return binaryenCAPI._BinaryenCallRef(
                        this.module.ptr,
                        target,
                        arrayToPtr([refnull, ...callWasmArgs]).ptr,
                        1 + callWasmArgs.length,
                        wasmFuncType,
                        false,
                    );
                }
                callWasmArgs = [refnull, thisObj, ...callWasmArgs];

                return this._generateClassMethodCallRef(
                    thisObj,
                    classType,
                    methodType,
                    methodIndex,
                    callWasmArgs,
                );
            } else {
                throw Error(`invalid call target`);
            }
        } else {
            /* Call a closure */
            const closureRef = accessInfo.binaryenRef;
            const closureType =
                binaryenCAPI._BinaryenExpressionGetType(closureRef);
            const context = binaryenCAPI._BinaryenStructGet(
                this.module.ptr,
                0,
                closureRef,
                closureType,
                false,
            );
            const funcref = binaryenCAPI._BinaryenStructGet(
                this.module.ptr,
                1,
                closureRef,
                closureType,
                false,
            );
            const paramTypes = (
                accessInfo.tsType as TSFunction
            ).getParamTypes();
            for (let i = 0; i < expr.callArgs.length; i++) {
                const paramType = paramTypes[i];
                const argType = expr.callArgs[i].exprType;
                if (
                    paramType instanceof TSClass &&
                    argType instanceof TSClass
                ) {
                    callWasmArgs[i] = this.maybeTypeBoxingAndUnboxing(
                        argType,
                        paramType,
                        callWasmArgs[i],
                    );
                }
            }
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
                elemExprRef = this.dynValueGen.WASMDynExprGen(expr).binaryenRef;
            } else if (arrType.kind === TypeKind.ARRAY) {
                const arrayType = <TSArray>arrType;
                if (arrayType.elementType.kind === TypeKind.ANY) {
                    elemExprRef =
                        this.dynValueGen.WASMDynExprGen(elemExpr).binaryenRef;
                } else {
                    elemExprRef = this.WASMExprGen(elemExpr).binaryenRef;
                }
            } else {
                elemExprRef = this.WASMExprGen(elemExpr).binaryenRef;
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
                vtable.push(this.WASMExprGen(propExpr).binaryenRef);
            } else {
                let propExprRef: binaryen.ExpressionRef;
                if (propExprType.kind === TypeKind.ANY) {
                    propExprRef =
                        this.dynValueGen.WASMDynExprGen(propExpr).binaryenRef;
                } else {
                    propExprRef = this.WASMExprGen(propExpr).binaryenRef;
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
        const wasmBaseTypeRef = this.wasmType.getWASMType(baseClassType);
        const ref = module.local.get(0, emptyStructType.typeRef);
        const cast = binaryenCAPI._BinaryenRefCast(
            module.ptr,
            ref,
            wasmBaseTypeRef,
        );
        const wasmArgs = new Array<binaryen.ExpressionRef>();
        wasmArgs.push(
            binaryenCAPI._BinaryenRefNull(module.ptr, emptyStructType.typeRef),
        );
        wasmArgs.push(cast);
        for (const arg of expr.callArgs) {
            wasmArgs.push(this.WASMExprGen(arg).binaryenRef);
        }
        return module.drop(
            module.call(
                baseClassType.mangledName + '|constructor',
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
                    this.WASMExprGen(expr.lenExpr).binaryenRef,
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
                        elemExprRef =
                            this.dynValueGen.WASMDynExprGen(
                                elemExpr,
                            ).binaryenRef;
                    } else {
                        elemExprRef = this.WASMExprGen(elemExpr).binaryenRef;
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
            const classMangledName = classType.mangledName;
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
            // TODO: here just set @context to null
            args.push(
                binaryenCAPI._BinaryenRefNull(
                    this.module.ptr,
                    emptyStructType.typeRef,
                ),
            );
            args.push(newStruct);
            if (expr.NewArgs) {
                for (const arg of expr.NewArgs) {
                    args.push(this.WASMExprGen(arg).binaryenRef);
                }
            }
            return this.module.call(
                classMangledName + '|constructor',
                args,
                this.wasmType.getWASMType(classType),
            );
        }
        return binaryen.none;
    }

    private WASMPropertyAccessExpr(
        expr: PropertyAccessExpression,
        byRef = false,
    ): binaryen.ExpressionRef | AccessBase {
        const module = this.module;
        const objPropAccessExpr = expr.propertyAccessExpr;
        const propExpr = expr.propertyExpr;
        const propIdenExpr = <IdentifierExpression>propExpr;
        const propName = propIdenExpr.identifierName;
        let curAccessInfo: AccessBase | null = null;

        const accessInfo = this.WASMExprGenInternal(objPropAccessExpr);
        if (accessInfo instanceof AccessBase) {
            if (accessInfo instanceof ScopeAccess) {
                curAccessInfo = this._createAccessInfo(
                    propName,
                    accessInfo.scope,
                    false,
                );
            } else if (accessInfo instanceof TypeAccess) {
                const type = accessInfo.type;
                if (type instanceof TSClass) {
                    const methodInfo = type.getMethod(
                        propName,
                        FunctionKind.STATIC,
                    );
                    if (methodInfo.index === -1) {
                        throw new Error(
                            `static method of class '${type.className}' not found`,
                        );
                    }
                    curAccessInfo = new MethodAccess(
                        methodInfo.method!.type,
                        methodInfo.index,
                        type,
                        null,
                    );
                }
            } else if (accessInfo instanceof Type) {
                throw Error("Access type's builtin method unimplement");
            }
        } else {
            const wasmValue = accessInfo;
            const ref = wasmValue.binaryenRef;
            const tsType = wasmValue.tsType;

            switch (tsType.typeKind) {
                case TypeKind.BOOLEAN:
                case TypeKind.NUMBER:
                case TypeKind.FUNCTION:
                case TypeKind.STRING:
                    throw Error(
                        `Access basic type's builtin method unimplemented`,
                    );
                case TypeKind.CLASS: {
                    const classType = tsType as TSClass;
                    const propIndex = classType.getMemberFieldIndex(propName);
                    if (propIndex != -1) {
                        /* member field */
                        const propType =
                            classType.getMemberField(propName)!.type;
                        curAccessInfo = new StructAccess(
                            ref,
                            propIndex +
                                1 /* The first slot is reserved for vtable */,
                            this.wasmType.getWASMType(propType),
                            propType,
                        );
                    } else {
                        let classMethod = classType.getMethod(propName);
                        // iff xxx.getter()
                        if (
                            classMethod.index === -1 &&
                            propExpr.expressionKind ===
                                ts.SyntaxKind.CallExpression
                        ) {
                            classMethod = classType.getMethod(
                                propName,
                                FunctionKind.SETTER,
                            );
                        }
                        if (classMethod.index !== -1) {
                            curAccessInfo = new MethodAccess(
                                classMethod.method!.type,
                                classMethod.index,
                                classType,
                                ref,
                            );
                        } else {
                            classMethod = classType.getMethod(
                                propName,
                                FunctionKind.GETTER,
                            );
                            if (classMethod.index === -1) {
                                throw Error(
                                    `${propName} property does not exist on ${tsType}`,
                                );
                            }
                            curAccessInfo = new GetterAccess(
                                classMethod.method!.type,
                                classMethod.index,
                                classType,
                                ref,
                            );
                        }
                    }
                    break;
                }
                case TypeKind.INTERFACE: {
                    const infcType = tsType as TSInterface;
                    const ifcTypeId = this.module.i32.const(infcType.typeId);
                    const objTypeId = this.getInfcTypeId(ref);
                    const propIndex = infcType.getMemberFieldIndex(propName);
                    const dynFieldIndex = this.module.call(
                        'find_index',
                        [
                            this.getInfcItable(ref),
                            module.i32.const(
                                this.wasmCompiler.generateRawString(propName),
                            ),
                        ],
                        binaryen.i32,
                    );

                    const objRef = this.getInfcObj(ref); // anyref
                    const objType = this.wasmType.getWASMType(infcType, true);
                    if (propIndex != -1) {
                        const propType =
                            infcType.getMemberField(propName)!.type;
                        curAccessInfo = new InterfaceAccess(
                            ifcTypeId,
                            objTypeId,
                            objRef,
                            objType,
                            propIndex + 1,
                            dynFieldIndex,
                            propType,
                        );
                    } else if (infcType.getMethod(propName).index != -1) {
                        throw new Error('interface method not implemented');
                    } else {
                        throw Error(
                            `${propName} property does not exist on ${tsType}`,
                        );
                    }
                    break;
                }
                case TypeKind.ARRAY:
                    throw Error(`Can't access field of array`);
                case TypeKind.ANY:
                    curAccessInfo = new DynObjectAccess(ref, propName);
                    break;
                default:
                    throw Error(
                        `invalid property access, receiver type is: ${tsType.typeKind}`,
                    );
            }
        }

        if (!curAccessInfo) {
            throw Error(
                `unexpected error during processing propertyAccessExpression`,
            );
        }

        if (!byRef) {
            return this._loadFromAccessInfo(curAccessInfo);
        }

        return curAccessInfo;
    }

    private WASMElementAccessExpr(
        expr: ElementAccessExpression,
        byRef = false,
    ): binaryen.ExpressionRef | AccessBase {
        const module = this.module;
        const accessExpr = expr.accessExpr;
        const argExpr = expr.argExpr;
        const wasmValue = this.WASMExprGen(accessExpr);
        const arrayRef = wasmValue.binaryenRef;
        const arrayType = wasmValue.tsType;
        const index = this.convertTypeToI32(
            this.WASMExprGen(argExpr).binaryenRef,
            binaryen.f64,
        );

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
            } else {
                return new ArrayAccess(
                    arrayRef,
                    index,
                    elemWasmType,
                    elementType,
                );
            }
        } else {
            /* Any-objects */
            if (!byRef) {
                throw Error(`Dynamic array not implemented`);
            } else {
                return new DynArrayAccess(arrayRef, index);
            }
        }
    }

    private WASMAsExpr(expr: AsExpression): binaryen.ExpressionRef {
        const module = this.module;
        const originObjExpr = <IdentifierExpression>expr.expression;
        const originObjExprRef = this.WASMExprGen(originObjExpr).binaryenRef;
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
        const funcStructHeapType = this.wasmType.getWASMFuncStructHeapType(
            funcScope.funcType,
        );
        const funcStructType = this.wasmType.getWASMFuncStructType(
            funcScope.funcType,
        );

        const context = binaryenCAPI._BinaryenRefNull(
            this.module.ptr,
            emptyStructType.typeRef,
        );

        const closureVar = new Variable(
            `@closure|${funcScope.mangledName}`,
            funcScope.funcType,
            [],
            -1,
            true,
        );
        this.addVariableToCurrentScope(closureVar);

        const closureRef = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([
                context,
                this.module.ref.func(funcScope.mangledName, wasmFuncType),
            ]).ptr,
            2,
            funcStructHeapType,
        );

        this.currentFuncCtx.insert(
            this.module.local.set(closureVar.varIndex, closureRef),
        );
        return this.module.local.get(closureVar.varIndex, funcStructType);
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
                    [exprRef, this.WASMExprGen(unaryExpr.operand).binaryenRef],
                    binaryen.f64,
                );
            }
        }
        if (unaryExpr.expressionKind === ts.SyntaxKind.PostfixUnaryExpression) {
            const wasmUnaryOperandExpr = this.WASMExprGen(
                unaryExpr.operand,
            ).binaryenRef;
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

    private objAssignToInfc(from: Type, to: Type) {
        if (from.kind === TypeKind.CLASS && to.kind === TypeKind.INTERFACE) {
            return true;
        }
        return false;
    }

    private infcAssgnToObj(from: Type, to: Type) {
        if (from.kind === TypeKind.INTERFACE && to.kind === TypeKind.CLASS) {
            return true;
        }
        return false;
    }

    private getInfcItable(ref: binaryenCAPI.ExpressionRef) {
        assert(
            binaryen.getExpressionType(ref) === this.wasmType.getInfcTypeRef(),
        );
        const infcItable = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            0,
            ref,
            binaryen.i32,
            false,
        );
        return infcItable;
    }

    private getInfcTypeId(ref: binaryenCAPI.ExpressionRef) {
        assert(
            binaryen.getExpressionType(ref) === this.wasmType.getInfcTypeRef(),
        );
        const infcTypeId = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            1,
            ref,
            this.wasmType.getInfcTypeRef(),
            false,
        );
        return infcTypeId;
    }

    private getInfcObj(ref: binaryenCAPI.ExpressionRef) {
        assert(
            binaryen.getExpressionType(ref) === this.wasmType.getInfcTypeRef(),
        );
        const infcObj = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            2,
            ref,
            binaryen.anyref,
            false,
        );
        return infcObj;
    }

    private objTypeBoxing(ref: binaryen.ExpressionRef, type: TSClass) {
        const itablePtr = this.module.i32.const(
            this.wasmCompiler.generateItable(type),
        );
        const wasmTypeId = this.module.i32.const(type.typeId);
        return binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([itablePtr, wasmTypeId, ref]).ptr,
            3,
            this.wasmType.getInfcHeapTypeRef(),
        );
    }

    private infcTypeUnboxing(ref: binaryen.ExpressionRef, type: Type) {
        assert(type instanceof TSClass);
        const obj = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            2,
            ref,
            this.wasmType.getInfcTypeRef(),
            false,
        );
        return binaryenCAPI._BinaryenRefCast(
            this.module.ptr,
            obj,
            this.wasmType.getWASMType(type),
        );
    }

    maybeTypeBoxingAndUnboxing(
        fromType: TSClass,
        toType: TSClass,
        ref: binaryen.ExpressionRef,
    ) {
        if (this.objAssignToInfc(fromType, toType)) {
            return this.objTypeBoxing(ref, fromType);
        }
        if (this.infcAssgnToObj(fromType, toType)) {
            const infcTypeId = this.getInfcTypeId(ref);
            const objTypeId = this.module.i32.const(toType.typeId);
            const obj = this.infcTypeUnboxing(ref, toType);
            return createCondBlock(this.module, infcTypeId, objTypeId, obj);
        }
        return ref;
    }

    private dynGetInfcField(
        ref: binaryen.ExpressionRef,
        index: binaryen.ExpressionRef,
        type: Type,
    ) {
        const wasmType = this.wasmType.getWASMType(type);
        switch (wasmType) {
            case binaryen.i32:
                return this.module.call(
                    structdyn.StructDyn.struct_get_dyn_i32,
                    [ref, index],
                    binaryen.i32,
                );
            case binaryen.i64:
                return this.module.call(
                    structdyn.StructDyn.struct_get_dyn_i64,
                    [ref, index],
                    binaryen.i64,
                );
            case binaryen.f32:
                return this.module.call(
                    structdyn.StructDyn.struct_get_dyn_f32,
                    [ref, index],
                    binaryen.f32,
                );
            case binaryen.f64:
                return this.module.call(
                    structdyn.StructDyn.struct_get_dyn_f64,
                    [ref, index],
                    binaryen.f64,
                );
            default: {
                const obj = this.module.call(
                    structdyn.StructDyn.struct_get_dyn_anyref,
                    [ref, index],
                    binaryen.anyref,
                );
                const wasmType = this.wasmType.getWASMType(type);
                return binaryenCAPI._BinaryenRefCast(
                    this.module.ptr,
                    obj,
                    wasmType,
                );
            }
        }
    }

    private dynSetInfcField(
        ref: binaryen.ExpressionRef,
        index: binaryen.ExpressionRef,
        value: binaryen.ExpressionRef,
        type: Type,
    ) {
        const wasmType = this.wasmType.getWASMType(type);
        switch (wasmType) {
            case binaryen.i32:
                return this.module.call(
                    structdyn.StructDyn.struct_set_dyn_i32,
                    [ref, index, value],
                    binaryen.none,
                );
            case binaryen.i64:
                return this.module.call(
                    structdyn.StructDyn.struct_set_dyn_i64,
                    [ref, index, value],
                    binaryen.none,
                );
            case binaryen.f32:
                return this.module.call(
                    structdyn.StructDyn.struct_set_dyn_f32,
                    [ref, index, value],
                    binaryen.none,
                );
            case binaryen.f64:
                return this.module.call(
                    structdyn.StructDyn.struct_set_dyn_f64,
                    [ref, index, value],
                    binaryen.none,
                );
            default: {
                return this.module.call(
                    structdyn.StructDyn.struct_set_dyn_anyref,
                    [ref, index, value],
                    binaryen.none,
                );
            }
        }
    }
}

export class WASMDynExpressionGen extends WASMExpressionBase {
    constructor(WASMCompiler: WASMGen) {
        super(WASMCompiler);
    }

    WASMDynExprGen(expr: Expression): WasmValue {
        this.module = this.wasmCompiler.module;
        this.wasmType = this.wasmCompiler.wasmType;
        this.staticValueGen = this.wasmCompiler.wasmExprCompiler;
        this.dynValueGen = this.wasmCompiler.wasmDynExprCompiler;
        this.currentFuncCtx = this.wasmCompiler.curFunctionCtx!;

        let res: binaryen.ExpressionRef;

        switch (expr.expressionKind) {
            case ts.SyntaxKind.NumericLiteral:
                res = this.generateDynNumber(
                    this.staticValueGen.WASMExprGen(expr).binaryenRef,
                );
                break;
            case ts.SyntaxKind.FalseKeyword:
            case ts.SyntaxKind.TrueKeyword:
                res = this.generateDynBoolean(
                    this.staticValueGen.WASMExprGen(expr).binaryenRef,
                );
                break;
            case ts.SyntaxKind.StringLiteral: {
                const stringExpr = <StringLiteralExpression>expr;
                res = this.generateDynString(
                    this.module.i32.const(
                        this.wasmCompiler.generateRawString(
                            stringExpr.expressionValue,
                        ),
                    ),
                );
                break;
            }
            case ts.SyntaxKind.NullKeyword:
                res = this.generateDynNull();
                break;
            case ts.SyntaxKind.Identifier: {
                const identifierExpr = <IdentifierExpression>expr;
                if (identifierExpr.identifierName === 'undefined') {
                    res = this.generateDynUndefined();
                } else {
                    // generate dynExtref iff identifier's type is not any
                    // judge if identifierExpr's type is primitive
                    const extrfIdenType = identifierExpr.exprType;
                    switch (extrfIdenType.kind) {
                        case TypeKind.NUMBER:
                            res = this.generateDynNumber(
                                this.staticValueGen.WASMExprGen(expr)
                                    .binaryenRef,
                            );
                            break;
                        case TypeKind.BOOLEAN:
                            res = this.generateDynBoolean(
                                this.staticValueGen.WASMExprGen(expr)
                                    .binaryenRef,
                            );
                            break;
                        case TypeKind.NULL:
                            res = this.generateDynNull();
                            break;
                        case TypeKind.ANY:
                            res =
                                this.staticValueGen.WASMExprGen(
                                    identifierExpr,
                                ).binaryenRef;
                            break;
                        case TypeKind.INTERFACE:
                            res = this.generateDynExtref(
                                this.staticValueGen.WASMExprGen(identifierExpr)
                                    .binaryenRef,
                                dyntype.ExtObjKind.ExtInfc,
                            );
                            break;
                        default:
                            res = this.generateDynExtref(
                                this.staticValueGen.WASMExprGen(identifierExpr)
                                    .binaryenRef,
                                dyntype.ExtObjKind.ExtObj,
                            );
                            break;
                    }
                }
                break;
            }
            case ts.SyntaxKind.ArrayLiteralExpression:
                res = this.WASMDynArrayExpr(<ArrayLiteralExpression>expr);
                break;
            case ts.SyntaxKind.ObjectLiteralExpression:
                res = this.WASMDynObjExpr(<ObjectLiteralExpression>expr);
                break;
            case ts.SyntaxKind.BinaryExpression:
            case ts.SyntaxKind.CallExpression:
            case ts.SyntaxKind.PropertyAccessExpression:
                return this.staticValueGen.WASMExprGen(expr);
            default:
                throw new Error('unexpected expr kind ' + expr.expressionKind);
        }

        return {
            binaryenRef: res,
            tsType: expr.exprType,
        };
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
            const propValueExprRef =
                this.WASMDynExprGen(propValueExpr).binaryenRef;
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

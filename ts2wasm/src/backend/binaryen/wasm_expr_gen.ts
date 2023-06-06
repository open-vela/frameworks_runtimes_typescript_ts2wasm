/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import ts from 'typescript';
import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import TypeResolver, {
    builtinTypes,
    FunctionKind,
    GenericType,
    Primitive,
    TSArray,
    TSClass,
    TSFunction,
    TSInterface,
    Type,
    TypeKind,
    WasmType,
} from '../../type.js';
import { Variable } from '../../variable.js';
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
} from '../../expression.js';
import {
    arrayToPtr,
    createCondBlock,
    emptyStructType,
    generateArrayStructTypeInfo,
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
    importSearchTypes,
} from '../../scope.js';
import { MatchKind, Stack } from '../../utils.js';
import { dyntype, structdyn } from './lib/dyntype/utils.js';
import { BuiltinNames } from '../../../lib/builtin/builtin_name.js';
import {
    anyArrayTypeInfo,
    charArrayTypeInfo,
    stringTypeInfo,
    stringArrayTypeInfo,
    stringArrayStructTypeInfo,
} from './glue/packType.js';
import { WASMGen } from './index.js';
import { Logger } from '../../log.js';
import {
    getClassNameByTypeKind,
    unboxAnyTypeToBaseType,
    getFuncName,
} from './utils.js';

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
    ImportScope,
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
    public mangledMethodName;
    constructor(
        public methodType: TSFunction,
        public methodIndex: number,
        public classType: TSClass,
        public thisObj: binaryen.ExpressionRef | null = null,
        public isBuiltInMethod: boolean = false,
        public methodName: string = '',
        /* Currently only support one type parameter */
        public typeParameter: Type | null = null,
    ) {
        super(AccessType.Function);
        this.mangledMethodName = classType.mangledName.concat(
            BuiltinNames.moduleDelimiter,
            methodName,
        );
    }
}

class InfcMethodAccess extends AccessBase {
    constructor(
        public infcTypeId: binaryen.ExpressionRef,
        public objTypeId: binaryen.ExpressionRef,
        public objRef: binaryen.ExpressionRef,
        public objType: binaryenCAPI.TypeRef, // ref.cast objHeapType anyref
        public methodIndex: number,
        public dynMethodIndex: binaryen.ExpressionRef,
        public infcType: TSInterface,
        public methodType: TSFunction,
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

class InfcGetterAccess extends AccessBase {
    constructor(
        public infcTypeId: binaryen.ExpressionRef,
        public objTypeId: binaryen.ExpressionRef,
        public objRef: binaryen.ExpressionRef,
        public objType: binaryenCAPI.TypeRef, // ref.cast objHeapType anyref
        public methodIndex: number,
        public dynMethodIndex: binaryen.ExpressionRef,
        public infcType: TSInterface,
        public methodType: TSFunction,
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

class ImportScopeAccess extends AccessBase {
    constructor(public scope: GlobalScope) {
        super(AccessType.ImportScope);
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
    extrefTableSize = 0;

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

    getDynCond(
        name: string,
        expr: binaryen.ExpressionRef,
        type: binaryen.Type,
    ) {
        const condition = this.module.call(
            name,
            [
                this.module.global.get(
                    dyntype.dyntype_context,
                    dyntype.dyn_ctx_t,
                ),
                expr,
            ],
            type,
        );
        return condition;
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

    unboxAny(exprRef: binaryen.ExpressionRef, targetType: Type) {
        let res;
        if (targetType instanceof Primitive) {
            res = this.unboxAnyToBase(exprRef, targetType.kind);
        } else {
            res = this.unboxAnyToExtref(exprRef, targetType);
        }
        return res;
    }

    unboxAnyToBase(anyExprRef: binaryen.ExpressionRef, typeKind: TypeKind) {
        return unboxAnyTypeToBaseType(this.module, anyExprRef, typeKind);
    }

    unboxAnyToExtref(anyExprRef: binaryen.ExpressionRef, targetType: Type) {
        const module = this.module;

        const condition = this.getDynCond(
            dyntype.dyntype_is_extref,
            anyExprRef,
            dyntype.bool,
        );
        const wasmType = this.wasmType.getWASMType(targetType);
        // iff True
        const tableIndex = module.call(
            dyntype.dyntype_to_extref,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                anyExprRef,
            ],
            dyntype.int,
        );
        const externalRef = module.table.get(
            BuiltinNames.extrefTable,
            tableIndex,
            binaryen.anyref,
        );
        const value = binaryenCAPI._BinaryenRefCast(
            module.ptr,
            externalRef,
            wasmType,
        );
        // iff False
        const unreachableRef = module.unreachable();

        const blockStmt = module.if(condition, value, unreachableRef);
        return module.block(null, [blockStmt], wasmType);
    }

    boxBaseTypeToAny(expr: Expression): binaryen.ExpressionRef {
        let res: binaryen.ExpressionRef;
        const staticRef = this.staticValueGen.WASMExprGen(expr).binaryenRef;
        switch (expr.exprType.kind) {
            case TypeKind.NUMBER:
                res = this.generateDynNumber(staticRef);
                break;
            case TypeKind.BOOLEAN:
                res = this.generateDynBoolean(staticRef);
                break;
            case TypeKind.STRING: {
                /** TODO: need to do more research on string */
                res = this.generateDynString(staticRef);
                break;
            }
            case TypeKind.NULL:
                res = this.generateDynNull();
                break;
            case TypeKind.UNDEFINED:
                res = this.generateDynUndefined();
                break;
            default:
                throw Error(
                    `unboxing static type to any type, unsupported static type : ${expr.exprType.kind}`,
                );
        }
        return res;
    }

    boxNonLiteralToAny(expr: Expression): binaryen.ExpressionRef {
        let res: binaryen.ExpressionRef;
        /** box non-literal expression to any:
         *  new dynamic value: number, boolean, null
         *  direct assignment: any
         *  new string: string (which will be put into table too)
         *  new extref: obj (including class type, interface type, array type)
         */
        const staticRef = this.staticValueGen.WASMExprGen(expr).binaryenRef;
        switch (expr.exprType.kind) {
            case TypeKind.NUMBER:
            case TypeKind.BOOLEAN:
            case TypeKind.STRING:
            case TypeKind.NULL:
            case TypeKind.UNDEFINED:
                res = this.boxBaseTypeToAny(expr);
                break;
            case TypeKind.ANY:
            case TypeKind.GENERIC:
                res = staticRef;
                break;
            // case TypeKind.STRING:
            case TypeKind.INTERFACE:
            case TypeKind.ARRAY:
            case TypeKind.CLASS:
            case TypeKind.FUNCTION:
                res = this.generateDynExtref(staticRef, expr.exprType.kind);
                break;
            default:
                throw Error(
                    `boxing static type to any type failed, static type is: ${expr.exprType.kind}`,
                );
        }
        // }
        return res;
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
                throw new Error(`operator doesn't support, ${operatorKind}`);
        }
    }

    operateStringString(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        let res: binaryen.ExpressionRef;

        switch (operatorKind) {
            case ts.SyntaxKind.ExclamationEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsEqualsToken: {
                res = module.call(
                    getFuncName(
                        BuiltinNames.builtinModuleName,
                        BuiltinNames.stringEQFuncName,
                    ),
                    [leftExprRef, rightExprRef],
                    dyntype.bool,
                );
                if (
                    operatorKind === ts.SyntaxKind.ExclamationEqualsToken ||
                    operatorKind === ts.SyntaxKind.ExclamationEqualsEqualsToken
                ) {
                    res = module.i32.eqz(res);
                }
                break;
            }
            case ts.SyntaxKind.PlusToken: {
                const vartype = new TSArray(new Primitive('string'));
                const objLocalVar = this.generateTmpVar(
                    '~string|',
                    '',
                    vartype,
                );

                const statementArray: binaryen.ExpressionRef[] = [];

                const arrayValue = binaryenCAPI._BinaryenArrayInit(
                    module.ptr,
                    stringArrayTypeInfo.heapTypeRef,
                    arrayToPtr([rightExprRef]).ptr,
                    1,
                );

                statementArray.push(
                    this.setVariableToCurrentScope(
                        objLocalVar,
                        binaryenCAPI._BinaryenStructNew(
                            module.ptr,
                            arrayToPtr([arrayValue, module.i32.const(1)]).ptr,
                            2,
                            stringArrayStructTypeInfo.heapTypeRef,
                        ),
                    ),
                );

                statementArray.push(
                    module.call(
                        getFuncName(
                            BuiltinNames.builtinModuleName,
                            BuiltinNames.stringConcatFuncName,
                        ),
                        [
                            binaryenCAPI._BinaryenRefNull(
                                module.ptr,
                                emptyStructType.typeRef,
                            ),
                            leftExprRef,
                            this.getVariableValue(
                                objLocalVar,
                                stringArrayStructTypeInfo.typeRef,
                            ),
                        ],
                        stringTypeInfo.typeRef,
                    ),
                );
                const concatBlock = module.block(null, statementArray);
                res = concatBlock;
                break;
            }
            default:
                // iff two any type operation, the logic is
                // if (type eq) {
                //     if (is_number) {

                //     } else if (is_string) {

                //     } else {
                //         ...
                //     }
                // }
                // so in order to match the logic of number, here we return unreachable
                res = this.module.unreachable();
        }

        return res;
    }

    operateRefRef(
        leftExprRef: binaryen.ExpressionRef,
        leftExprType: Type,
        rightExprRef: binaryen.ExpressionRef,
        rightExprType: Type,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        if (leftExprType.kind === TypeKind.INTERFACE) {
            leftExprRef = this.getInterfaceObj(leftExprRef);
        }
        if (rightExprType.kind === TypeKind.INTERFACE) {
            rightExprRef = this.getInterfaceObj(rightExprRef);
        }
        let res: binaryen.ExpressionRef;
        switch (operatorKind) {
            case ts.SyntaxKind.ExclamationEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsEqualsToken: {
                res = binaryenCAPI._BinaryenRefEq(
                    module.ptr,
                    leftExprRef,
                    rightExprRef,
                );
                if (
                    operatorKind === ts.SyntaxKind.ExclamationEqualsToken ||
                    operatorKind === ts.SyntaxKind.ExclamationEqualsEqualsToken
                ) {
                    res = module.i32.eqz(res);
                }
                break;
            }
            default:
                throw new Error(`operator doesn't support, ${operatorKind}`);
        }
        return res;
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
                throw new Error(`operator doesn't support, ${operatorKind}`);
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
                throw new Error(`operator doesn't support, ${operatorKind}`);
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
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsToken: {
                return module.i32.eq(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.ExclamationEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
                return module.i32.ne(leftExprRef, rightExprRef);
            }
            default:
                throw new Error(`operator doesn't support, ${operatorKind}`);
        }
    }

    operateAnyAny(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        // TODO: not support ref type cmp
        let res: binaryen.ExpressionRef;
        switch (operatorKind) {
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
            case ts.SyntaxKind.LessThanEqualsToken:
            case ts.SyntaxKind.LessThanToken:
            case ts.SyntaxKind.GreaterThanEqualsToken:
            case ts.SyntaxKind.GreaterThanToken:
            case ts.SyntaxKind.ExclamationEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
                res = this.module.call(
                    dyntype.dyntype_cmp,
                    [
                        this.module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        leftExprRef,
                        rightExprRef,
                        this.module.i32.const(operatorKind),
                    ],
                    binaryen.i32,
                );
                break;
            }
            default: {
                const tmpVarName = this.getTmpVariableName('~staticToDyn|');
                const tmpVar = new Variable(
                    tmpVarName,
                    builtinTypes.get(TypeKind.ANY)!,
                    [],
                    0,
                );
                const setTotalNumberExpression = this.operateStaticToDyn(
                    leftExprRef,
                    rightExprRef,
                    operatorKind,
                    tmpVar,
                );
                // store the external operations into currentScope's statementArray
                this.currentFuncCtx.insert(setTotalNumberExpression);
                res = this.getVariableValue(tmpVar, binaryen.anyref);
                /** iff not compare or plus token, tsc will auto convert to number */
                if (
                    !(
                        operatorKind >= ts.SyntaxKind.LessThanToken &&
                        operatorKind <= ts.SyntaxKind.PlusToken
                    )
                ) {
                    res = this.unboxAnyToBase(res, TypeKind.NUMBER);
                }
                break;
            }
        }
        return res;
    }

    operateStaticNullUndefined(
        leftType: Type,
        leftExprRef: binaryen.ExpressionRef,
        rightTypekind: TypeKind,
        operatorKind: ts.SyntaxKind,
    ) {
        let res: binaryen.ExpressionRef;
        const isNotEqToken =
            operatorKind === ts.SyntaxKind.ExclamationEqualsToken ||
            operatorKind === ts.SyntaxKind.ExclamationEqualsEqualsToken
                ? true
                : false;
        if (leftType.kind === rightTypekind) {
            res = isNotEqToken ? 0 : 1;
        } else {
            res = isNotEqToken ? 1 : 0;
        }
        res = this.module.i32.const(res);
        // let xx: A | null === null;
        // xx === null
        if (
            !(leftType instanceof Primitive) &&
            rightTypekind === TypeKind.NULL
        ) {
            res = this.module.ref.is_null(leftExprRef);
            if (isNotEqToken) {
                res = this.module.i32.eqz(res);
            }
        }
        return res;
    }

    operatorAnyStatic(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        rightExprType: Type,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        let res: binaryen.ExpressionRef;
        const dynCtx = module.global.get(
            dyntype.dyntype_context,
            dyntype.dyn_ctx_t,
        );
        switch (operatorKind) {
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
                if (rightExprType.kind === TypeKind.NULL) {
                    res = module.call(
                        dyntype.dyntype_is_null,
                        [dynCtx, leftExprRef],
                        binaryen.i32,
                    );
                    // TODO: ref.null need table.get support in native API
                } else if (rightExprType.kind === TypeKind.UNDEFINED) {
                    res = module.call(
                        dyntype.dyntype_is_undefined,
                        [dynCtx, leftExprRef],
                        binaryen.i32,
                    );
                } else if (rightExprType.kind === TypeKind.NUMBER) {
                    res = this.operateF64F64ToDyn(
                        leftExprRef,
                        rightExprRef,
                        operatorKind,
                        true,
                    );
                } else if (rightExprType.kind === TypeKind.STRING) {
                    res = this.operateStrStrToDyn(
                        leftExprRef,
                        rightExprRef,
                        operatorKind,
                        true,
                    );
                } else {
                    throw new Error(
                        `operand type doesn't support on any static operation, static type is ${rightExprType.kind}`,
                    );
                }
                if (
                    operatorKind === ts.SyntaxKind.ExclamationEqualsToken ||
                    operatorKind === ts.SyntaxKind.ExclamationEqualsEqualsToken
                ) {
                    res = module.i32.eqz(res);
                }
                break;
            }
            default:
                if (rightExprType.kind === TypeKind.NUMBER) {
                    res = this.operateF64F64ToDyn(
                        leftExprRef,
                        rightExprRef,
                        operatorKind,
                        true,
                    );
                } else if (rightExprType.kind === TypeKind.STRING) {
                    res = this.operateStrStrToDyn(
                        leftExprRef,
                        rightExprRef,
                        operatorKind,
                        true,
                    );
                } else {
                    throw new Error(
                        `operator doesn't support on any static operation, ${operatorKind}`,
                    );
                }
        }
        return res;
    }

    operateStaticToDyn(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
        tmpVar: Variable,
    ) {
        const dynTypeCtx = this.module.global.get(
            dyntype.dyntype_context,
            dyntype.dyn_ctx_t,
        );
        const typeEq = this.module.call(
            dyntype.dyntype_type_eq,
            [dynTypeCtx, leftExprRef, rightExprRef],
            binaryen.i32,
        );
        // const
        const ifFalse = this.module.unreachable();
        const ifNumber = this.module.call(
            dyntype.dyntype_is_number,
            [dynTypeCtx, leftExprRef],
            binaryen.i32,
        );
        const ifString = this.module.call(
            dyntype.dyntype_is_string,
            [dynTypeCtx, leftExprRef],
            binaryen.i32,
        );
        const ifStringTrue = this.operateStrStrToDyn(
            leftExprRef,
            rightExprRef,
            operatorKind,
        );
        const ifTpeEqTrue = this.module.if(
            ifNumber,
            this.operateF64F64ToDyn(leftExprRef, rightExprRef, operatorKind),
            this.module.if(ifString, ifStringTrue, ifFalse),
        );
        this.addVariableToCurrentScope(tmpVar);
        const res = this.setVariableToCurrentScope(
            tmpVar,
            this.module.if(typeEq, ifTpeEqTrue, ifFalse),
        );
        return res;
    }

    operateF64F64ToDyn(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
        isRightStatic = false,
    ) {
        const tmpLeftNumberRef = this.module.call(
            dyntype.dyntype_to_number,
            [
                this.module.global.get(
                    dyntype.dyntype_context,
                    binaryen.anyref,
                ),
                leftExprRef,
            ],
            binaryen.f64,
        );
        const tmpRightNumberRef = isRightStatic
            ? rightExprRef
            : this.module.call(
                  dyntype.dyntype_to_number,
                  [
                      this.module.global.get(
                          dyntype.dyntype_context,
                          binaryen.anyref,
                      ),
                      rightExprRef,
                  ],
                  binaryen.f64,
              );
        const operateNumber = this.operateF64F64(
            tmpLeftNumberRef,
            tmpRightNumberRef,
            operatorKind,
        );
        return this.generateDynNumber(operateNumber);
    }

    operateStrStrToDyn(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
        isRightStatic = false,
    ) {
        const tmpLeftStrRef = this.unboxAnyToBase(leftExprRef, TypeKind.STRING);
        const tmpRightStrRef = isRightStatic
            ? rightExprRef
            : this.unboxAnyToBase(rightExprRef, TypeKind.STRING);
        // operate left expression and right expression
        const operateString = this.operateStringString(
            tmpLeftStrRef,
            tmpRightStrRef,
            operatorKind,
        );
        return this.generateDynString(operateString);
    }

    defaultValue(typeKind: TypeKind) {
        switch (typeKind) {
            case TypeKind.BOOLEAN:
                return this.module.i32.const(0);
            case TypeKind.NUMBER:
                return this.module.f64.const(0);
            default:
                return binaryenCAPI._BinaryenRefNull(
                    this.module.ptr,
                    binaryenCAPI._BinaryenTypeStructref(),
                );
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
        extrefTypeKind: TypeKind,
    ) {
        const module = this.module;
        // table type is anyref, no need to cast
        /** we regard string-nonLiteral as extref too */
        let extObjKind: dyntype.ExtObjKind = 0;
        switch (extrefTypeKind) {
            case TypeKind.CLASS: {
                extObjKind = dyntype.ExtObjKind.ExtObj;
                break;
            }
            case TypeKind.FUNCTION: {
                extObjKind = dyntype.ExtObjKind.ExtFunc;
                break;
            }
            case TypeKind.INTERFACE: {
                extObjKind = dyntype.ExtObjKind.ExtInfc;
                break;
            }
            case TypeKind.ARRAY: {
                extObjKind = dyntype.ExtObjKind.ExtArray;
                break;
            }
            default: {
                throw Error(
                    `unexpected type kind when boxing to external reference, type kind is ${extrefTypeKind}`,
                );
            }
        }
        const newExternRef = getFuncName(
            BuiltinNames.builtinModuleName,
            BuiltinNames.newExternRef,
        );
        const newExternRefCall = module.call(
            newExternRef,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                module.i32.const(extObjKind),
                dynValue,
            ],
            binaryen.anyref,
        );
        return newExternRefCall;
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

    generateCondition(exprRef: binaryen.ExpressionRef, exprKind: TypeKind) {
        let res = this.module.unreachable();

        if (exprKind === TypeKind.BOOLEAN) {
            res = exprRef;
        } else if (exprKind === TypeKind.NUMBER) {
            const n0 = this.module.f64.ne(exprRef, this.module.f64.const(0));
            const nNaN = this.module.f64.eq(exprRef, exprRef);
            res = this.module.i32.and(n0, nNaN);
        } else if (
            exprKind === TypeKind.ANY ||
            exprKind === TypeKind.UNDEFINED
        ) {
            const targetFunc = getFuncName(
                BuiltinNames.builtinModuleName,
                BuiltinNames.anyrefCond,
            );
            res = this.module.call(targetFunc, [exprRef], binaryen.i32);
        } else if (exprKind === TypeKind.STRING) {
            // '' => false, '123' => true
            const array = binaryenCAPI._BinaryenStructGet(
                this.module.ptr,
                1,
                exprRef,
                binaryen.i32,
                false,
            );
            const len = binaryenCAPI._BinaryenArrayLen(this.module.ptr, array);
            res = this.module.i32.ne(len, this.module.i32.const(0));
        } else {
            res = this.module.i32.eqz(
                binaryenCAPI._BinaryenRefIsNull(this.module.ptr, exprRef),
            );
        }
        return res;
    }

    getInterfaceObj(expr: binaryen.ExpressionRef) {
        const obj = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            2,
            expr,
            this.wasmType.getInfcTypeRef(),
            false,
        );
        return binaryenCAPI._BinaryenRefCast(
            this.module.ptr,
            obj,
            emptyStructType.typeRef,
        );
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
        const identifer: string | undefined = (<IdentifierExpression>expr)
            .identifierName;
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
                res = this.module.ref.null(
                    binaryenCAPI._BinaryenTypeStructref(),
                );
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
                throw new Error(
                    'unexpected expr kind ' +
                        ts.SyntaxKind[expr.expressionKind],
                );
        }
        if (res instanceof AccessBase) {
            return res;
        } else {
            if (BuiltinNames.JSGlobalObjects.has(identifer)) {
                const tsType_ = new Primitive('any');
                return {
                    binaryenRef: res,
                    tsType: tsType_,
                };
            }
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
            const arrayRef = binaryenCAPI._BinaryenStructGet(
                module.ptr,
                0,
                ref,
                binaryen.getExpressionType(ref),
                false,
            );
            loadRef = binaryenCAPI._BinaryenArrayGet(
                module.ptr,
                arrayRef,
                index,
                wasmType,
                false,
            );
        } else if (accessInfo instanceof DynObjectAccess) {
            const { ref, fieldName } = accessInfo;
            if (fieldName === '__proto__') {
                loadRef = module.call(
                    dyntype.dyntype_get_prototype,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        ref,
                    ],
                    dyntype.dyn_value_t,
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
            loadRef = this._generateClassMethodCallRef(
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
        } else if (accessInfo instanceof MethodAccess) {
            const { methodType, methodIndex, classType, thisObj } = accessInfo;
            if (accessInfo.isBuiltInMethod) {
                /** builtin instance field invoke */
                const mangledMethodName = accessInfo.mangledMethodName;
                switch (mangledMethodName) {
                    case BuiltinNames.builtinModuleName.concat(
                        BuiltinNames.moduleDelimiter,
                        BuiltinNames.stringLengthFuncName,
                    ):
                        loadRef = this._getStringRefLen(thisObj!);
                        break;
                    case BuiltinNames.builtinModuleName.concat(
                        BuiltinNames.moduleDelimiter,
                        BuiltinNames.arrayLengthFuncName,
                    ):
                        loadRef = this._getArrayRefLen(thisObj!);
                        break;
                }
            } else {
                const vtable = this.wasmType.getWASMClassVtable(classType);
                const wasmMethodType = this.wasmType.getWASMType(methodType);
                const targetFunction = binaryenCAPI._BinaryenStructGet(
                    this.module.ptr,
                    methodIndex,
                    vtable,
                    wasmMethodType,
                    false,
                );
                loadRef = targetFunction;
            }
        } else if (accessInfo instanceof InfcGetterAccess) {
            const {
                infcTypeId,
                objTypeId,
                objRef,
                objType,
                methodIndex,
                dynMethodIndex,
                infcType,
                methodType,
            } = accessInfo;
            const refnull = binaryenCAPI._BinaryenRefNull(
                this.module.ptr,
                emptyStructType.typeRef,
            );
            const castedObjRef = binaryenCAPI._BinaryenRefCast(
                this.module.ptr,
                objRef,
                objType,
            );
            const callWasmArgs = [refnull, castedObjRef];
            const ifTrue = this._generateClassMethodCallRef(
                castedObjRef,
                infcType,
                methodType,
                methodIndex,
                callWasmArgs,
            );
            const dynTargetField = this.dynGetInfcField(
                objRef,
                dynMethodIndex,
                methodType,
            );
            callWasmArgs[1] = binaryenCAPI._BinaryenRefCast(
                this.module.ptr,
                objRef,
                emptyStructType.typeRef,
            );
            const ifFalse = binaryenCAPI._BinaryenCallRef(
                this.module.ptr,
                dynTargetField,
                arrayToPtr(callWasmArgs).ptr,
                callWasmArgs.length,
                this.wasmType.getWASMType(methodType),
                false,
            );
            loadRef = createCondBlock(
                this.module,
                infcTypeId,
                objTypeId,
                ifTrue,
                ifFalse,
            );
        } else if (accessInfo instanceof DynArrayAccess) {
            const { ref, index } = accessInfo;
            loadRef = module.call(
                dyntype.dyntype_get_elem,
                [
                    module.global.get(
                        dyntype.dyntype_context,
                        dyntype.dyn_ctx_t,
                    ),
                    ref,
                    index,
                ],
                dyntype.dyn_value_t,
            );
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
        convertName = false,
    ): AccessBase {
        /* Step1: Find item according to identifier */
        const identifierInfo = scope.findIdentifier(
            identifer,
            nested,
            importSearchTypes.All,
            convertName,
        );
        if (identifierInfo instanceof Variable) {
            const variable = identifierInfo;
            let varType = this.wasmType.getWASMType(variable.varType);
            if (variable.varType instanceof TSFunction) {
                varType = this.wasmType.getWASMFuncStructType(variable.varType);
            }
            if (variable.varType instanceof TSArray) {
                const wasmHeapType = this.wasmType.getWASMHeapType(
                    variable.varType,
                );
                varType = generateArrayStructTypeInfo({
                    typeRef: varType,
                    heapTypeRef: wasmHeapType,
                }).typeRef;
            }

            if (!variable.isLocalVar()) {
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
        } else if (identifierInfo instanceof NamespaceScope) {
            return new ScopeAccess(identifierInfo);
        } else if (identifierInfo instanceof GlobalScope) {
            return new ImportScopeAccess(identifierInfo);
        } else if (identifierInfo instanceof Type) {
            const tsType = identifierInfo;
            return new TypeAccess(tsType);
        } else {
            BuiltinNames.JSGlobalObjects.set(identifer, true);
            const tsType = new Primitive('any');
            const wasmType = this.wasmType.getWASMType(tsType);
            return new GlobalAccess(identifer, wasmType, tsType);
        }
    }

    /* If byRef === true, return AccessInfo for left-value, but right-value is still returned by value */
    private WASMIdenfierExpr(
        expr: IdentifierExpression,
        byRef = false,
    ): binaryen.ExpressionRef | AccessBase {
        // find the target scope
        if (expr.identifierName === 'undefined') {
            return this.generateDynUndefined();
        }
        if (expr.identifierName === 'NaN') {
            return this.module.f64.const(NaN);
        }
        if (expr.identifierName === 'Infinity') {
            return this.module.f64.const(Infinity);
        }
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
        let res: binaryen.ExpressionRef = this.module.unreachable();
        if (
            leftExprType.kind === TypeKind.NUMBER &&
            rightExprType.kind === TypeKind.NUMBER
        ) {
            res = this.operateF64F64(leftExprRef, rightExprRef, operatorKind);
        }
        if (
            leftExprType.kind === TypeKind.NUMBER &&
            rightExprType.kind === TypeKind.BOOLEAN
        ) {
            res = this.operateF64I32(leftExprRef, rightExprRef, operatorKind);
        }
        if (
            leftExprType.kind === TypeKind.BOOLEAN &&
            rightExprType.kind === TypeKind.NUMBER
        ) {
            res = this.operateI32F64(leftExprRef, rightExprRef, operatorKind);
        }
        if (
            leftExprType.kind === TypeKind.BOOLEAN &&
            rightExprType.kind === TypeKind.BOOLEAN
        ) {
            res = this.operateI32I32(leftExprRef, rightExprRef, operatorKind);
        }
        if (
            leftExprType.kind === TypeKind.STRING &&
            rightExprType.kind === TypeKind.STRING
        ) {
            res = this.operateStringString(
                leftExprRef,
                rightExprRef,
                operatorKind,
            );
        }
        if (
            leftExprType.kind === TypeKind.ANY &&
            rightExprType.kind === TypeKind.ANY
        ) {
            res = this.operateAnyAny(leftExprRef, rightExprRef, operatorKind);
        }
        if (
            (leftExprType.kind === TypeKind.NULL ||
                leftExprType.kind === TypeKind.UNDEFINED) &&
            rightExprType.kind !== TypeKind.ANY
        ) {
            res = this.operateStaticNullUndefined(
                rightExprType,
                rightExprRef,
                leftExprType.kind,
                operatorKind,
            );
        }
        if (
            leftExprType.kind !== TypeKind.ANY &&
            (rightExprType.kind === TypeKind.NULL ||
                rightExprType.kind === TypeKind.UNDEFINED)
        ) {
            res = this.operateStaticNullUndefined(
                leftExprType,
                leftExprRef,
                rightExprType.kind,
                operatorKind,
            );
        }
        /** static any*/
        if (
            leftExprType.kind === TypeKind.ANY &&
            rightExprType.kind !== TypeKind.ANY
        ) {
            res = this.operatorAnyStatic(
                leftExprRef,
                rightExprRef,
                rightExprType,
                operatorKind,
            );
        }
        if (
            leftExprType.kind !== TypeKind.ANY &&
            rightExprType.kind === TypeKind.ANY
        ) {
            res = this.operatorAnyStatic(
                rightExprRef,
                leftExprRef,
                leftExprType,
                operatorKind,
            );
        }
        // iff array, class or interface
        if (
            (leftExprType.kind === TypeKind.ARRAY &&
                rightExprType.kind === TypeKind.ARRAY) ||
            (leftExprType instanceof TSClass &&
                rightExprType instanceof TSClass)
        ) {
            return this.operateRefRef(
                leftExprRef,
                leftExprType,
                rightExprRef,
                rightExprType,
                operatorKind,
            );
        }
        if (res === this.module.unreachable()) {
            throw new Error(
                'unexpected left expr type ' +
                    leftExprType.kind +
                    ' unexpected right expr type ' +
                    rightExprType.kind,
            );
        }

        return res;
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
            if (rightExpr.exprType.kind === TypeKind.ANY) {
                assignValue = this.unboxAny(assignValue, leftExprType);
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
            /** TODO: arrays get from `Array.of` may grow dynamiclly*/
            const arrayRef = binaryenCAPI._BinaryenStructGet(
                module.ptr,
                0,
                ref,
                binaryen.getExpressionType(ref),
                false,
            );
            return binaryenCAPI._BinaryenArraySet(
                module.ptr,
                arrayRef,
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
            const { ref, index } = accessInfo;
            return module.drop(
                module.call(
                    dyntype.dyntype_set_elem,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        ref,
                        index,
                        assignValue,
                    ],
                    dyntype.cvoid,
                ),
            );
        } else {
            /* TODO: print the related source code */
            throw new Error(`Invalid assign target`);
        }
    }

    private matchType(leftExprType: Type, rightExprType: Type): number {
        /** iff tsc checking is OK, the leftside is any or reference type, both are OK */
        if (rightExprType.kind === TypeKind.NULL) {
            return MatchKind.ExactMatch;
        }
        if (leftExprType.kind === TypeKind.ANY) {
            return MatchKind.ToAnyMatch;
        }
        if (leftExprType.kind === rightExprType.kind) {
            if (
                leftExprType.kind === TypeKind.NUMBER ||
                leftExprType.kind === TypeKind.STRING ||
                leftExprType.kind === TypeKind.BOOLEAN ||
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
        if (
            rightExprType.kind === TypeKind.ANY ||
            rightExprType.kind === TypeKind.GENERIC
        ) {
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
                WASMOperandExpr = this.generateCondition(
                    WASMOperandExpr,
                    operand.exprType.kind,
                );
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
        // convert to condition
        condWASMExpr = this.generateCondition(
            condWASMExpr,
            expr.condtion.exprType.kind,
        );
        const trueWASMExpr = this.WASMExprGen(expr.whenTrue);
        const falseWASMExpr = this.WASMExprGen(expr.whenFalse);
        // TODO: union type
        assert(
            trueWASMExpr.tsType === falseWASMExpr.tsType,
            'trueWASMExprType and falseWASMExprType are not equal in conditional expression ',
        );
        return this.module.select(
            condWASMExpr,
            trueWASMExpr.binaryenRef,
            falseWASMExpr.binaryenRef,
        );
    }

    private _generateFinalArgs(
        envArgs: number[],
        callWasmArgs: binaryen.ExpressionRef[],
        funcScope?: FunctionScope,
    ) {
        /* callWasmArgs.length is funcType.getParamTypes().length */
        const finalCallWasmArgs = new Array(
            callWasmArgs.length + envArgs.length,
        );
        for (let i = 0; i < envArgs.length; i++) {
            finalCallWasmArgs[i] = envArgs[i];
        }
        for (let i = 0; i < callWasmArgs.length; i++) {
            finalCallWasmArgs[i + envArgs.length] = callWasmArgs[i];
        }
        /* parse default parameters, now only work when passing function scope */
        if (funcScope) {
            for (
                let i = envArgs.length;
                i < callWasmArgs.length + envArgs.length;
                i++
            ) {
                /* funcScope.paramArray have already insert envParams  */
                if (
                    funcScope.paramArray[i].initExpression &&
                    !callWasmArgs[i - envArgs.length]
                ) {
                    finalCallWasmArgs[i] = this.getWasmValueByExpr(
                        funcScope.paramArray[i].initExpression!,
                        funcScope.funcType.getParamTypes()[i - envArgs.length],
                    );
                }
            }
        }
        return finalCallWasmArgs;
    }

    private WASMCallExpr(expr: CallExpression): binaryen.ExpressionRef {
        const callExpr = expr.callExpr;
        if (!(callExpr.exprType instanceof TSFunction)) {
            Logger.error(`call non-function`);
        }
        /* In call expression, the callee may be a function scope rather than a variable,
            we use WASMExprGenInternal here which may return a FunctionAccess object */
        const accessInfo = this.WASMExprGenInternal(callExpr, true);

        /* calling method from an any object, fallback to quickJS */
        if (accessInfo instanceof DynObjectAccess) {
            return this.parseDynMethodCall(accessInfo, callExpr, expr.callArgs);
        }
        /* handle the case where an array function is called */
        let isArrayFunc = false;
        if (callExpr.expressionKind == ts.SyntaxKind.PropertyAccessExpression) {
            const ownerType = (<PropertyAccessExpression>callExpr)
                .propertyAccessExpr.exprType;
            isArrayFunc = ownerType instanceof TSArray;
        }
        let callWasmArgs = this.parseArguments(
            callExpr.exprType as TSFunction,
            expr.callArgs,
            null,
            isArrayFunc,
        );
        const context = binaryenCAPI._BinaryenRefNull(
            this.module.ptr,
            emptyStructType.typeRef,
        );
        if (accessInfo instanceof AccessBase) {
            /** TODO: get default parameter information, generate new call args
             *  default parameter information should be recorded in type information
             */
            if (accessInfo instanceof MethodAccess) {
                const { methodType, methodIndex, classType, thisObj } =
                    accessInfo;
                const envArgs: binaryen.ExpressionRef[] = [];
                if (!methodType.isDeclare) {
                    envArgs.push(context);
                }
                if (thisObj) {
                    envArgs.push(thisObj);
                }
                const finalCallWasmArgs = this._generateFinalArgs(
                    envArgs,
                    callWasmArgs,
                );

                if (accessInfo.isBuiltInMethod) {
                    let typeArgument: Type | null = null;
                    let callFuncName = accessInfo.mangledMethodName;
                    if (
                        BuiltinNames.genericBuiltinMethods.includes(
                            callFuncName,
                        )
                    ) {
                        typeArgument = accessInfo.typeParameter;
                        if (!typeArgument) {
                            const errMsg = `no specialized type for ${callFuncName}`;
                            Logger.error(errMsg);
                            throw Error(errMsg);
                        }
                        callFuncName = BuiltinNames.getSpecializedFuncName(
                            callFuncName,
                            typeArgument,
                        );
                    }
                    callWasmArgs = this.parseArguments(
                        methodType,
                        expr.callArgs,
                        typeArgument,
                        isArrayFunc,
                    );
                    const finalCallWasmArgs = this._generateFinalArgs(
                        envArgs,
                        callWasmArgs,
                    );
                    let callResult = this.module.call(
                        callFuncName,
                        finalCallWasmArgs,
                        this.wasmType.getWASMFuncReturnType(methodType),
                    );

                    if (TypeResolver.isTypeGeneric(methodType.returnType)) {
                        const concreteReturnType = expr.exprType;
                        let specializedWasmType: binaryenCAPI.TypeRef;
                        if (concreteReturnType instanceof TSArray) {
                            specializedWasmType =
                                this.wasmType.getWasmArrayStructType(
                                    concreteReturnType,
                                );
                        } else if (concreteReturnType instanceof TSFunction) {
                            specializedWasmType =
                                this.wasmType.getWASMFuncStructType(
                                    concreteReturnType,
                                );
                        } else {
                            specializedWasmType =
                                this.wasmType.getWASMType(concreteReturnType);
                        }

                        if (this.wasmType.hasHeapType(concreteReturnType)) {
                            /* For ref type, the native API may return anyref,
                                we need to cast it back to concrete type */
                            callResult = binaryenCAPI._BinaryenRefCast(
                                this.module.ptr,
                                callResult,
                                specializedWasmType,
                            );
                        }
                    }

                    return callResult;
                } else {
                    return this._generateClassMethodCallRef(
                        thisObj,
                        classType,
                        methodType,
                        methodIndex,
                        finalCallWasmArgs,
                    );
                }
            } else if (accessInfo instanceof InfcMethodAccess) {
                const {
                    infcTypeId,
                    objTypeId,
                    objRef,
                    objType,
                    methodIndex,
                    dynMethodIndex,
                    infcType,
                    methodType,
                } = accessInfo;
                const refnull = binaryenCAPI._BinaryenRefNull(
                    this.module.ptr,
                    emptyStructType.typeRef,
                );
                const castedObjRef = binaryenCAPI._BinaryenRefCast(
                    this.module.ptr,
                    objRef,
                    objType,
                );
                callWasmArgs = [refnull, castedObjRef, ...callWasmArgs];
                const ifTrue = this._generateClassMethodCallRef(
                    castedObjRef,
                    infcType,
                    methodType,
                    methodIndex,
                    callWasmArgs,
                );
                const dynTargetField = this.dynGetInfcField(
                    objRef,
                    dynMethodIndex,
                    methodType,
                );
                callWasmArgs[1] = binaryenCAPI._BinaryenRefCast(
                    this.module.ptr,
                    objRef,
                    emptyStructType.typeRef,
                );
                const ifFalse = binaryenCAPI._BinaryenCallRef(
                    this.module.ptr,
                    dynTargetField,
                    arrayToPtr(callWasmArgs).ptr,
                    callWasmArgs.length,
                    this.wasmType.getWASMType(methodType),
                    false,
                );
                return createCondBlock(
                    this.module,
                    infcTypeId,
                    objTypeId,
                    ifTrue,
                    ifFalse,
                );
            } else {
                return this._generateFuncCall(
                    accessInfo,
                    context,
                    callWasmArgs,
                    expr,
                );
            }
        } else {
            return this._generateFuncCall(
                accessInfo,
                context,
                callWasmArgs,
                expr,
            );
        }
    }

    private WASMArrayLiteralExpr(
        expr: ArrayLiteralExpression,
    ): binaryen.ExpressionRef {
        const arrType = expr.exprType;
        const elements = expr.arrayValues;
        let res: binaryen.ExpressionRef;
        if (arrType.kind === TypeKind.ANY) {
            res = this.dynValueGen.WASMDynExprGen(expr).binaryenRef;
        } else {
            res = this.initArray(arrType as TSArray, elements);
        }
        return res;
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
                const methodStruct = this.WASMExprGen(propExpr).binaryenRef;
                const temp = binaryenCAPI._BinaryenStructGet(
                    module.ptr,
                    1,
                    methodStruct,
                    binaryen.getExpressionType(methodStruct),
                    false,
                );
                vtable.push(temp);
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
        const vtableHeapType =
            this.wasmType.getWASMClassVtableHeapType(objType);
        const objHeapType = this.wasmType.getWASMHeapType(objType);
        propRefList[0] = binaryenCAPI._BinaryenStructNew(
            module.ptr,
            arrayToPtr(vtable).ptr,
            vtable.length,
            vtableHeapType,
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
        // 0: @context 1: @this
        const ref = module.local.get(1, emptyStructType.typeRef);
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
            let arrayRef: binaryen.ExpressionRef;
            let arraySizeRef: binaryen.ExpressionRef;
            const arrayHeapType = this.wasmType.getWASMHeapType(type);
            const arrayStructHeapType =
                this.wasmType.getWasmArrayStructHeapType(type);
            if (expr.lenExpr) {
                arraySizeRef = this.convertTypeToI32(
                    this.WASMExprGen(expr.lenExpr).binaryenRef,
                    binaryen.f64,
                );
                const arrayInit = this.getArrayInitFromArrayType(<TSArray>type);
                arrayRef = binaryenCAPI._BinaryenArrayNew(
                    module.ptr,
                    arrayHeapType,
                    arraySizeRef,
                    arrayInit,
                    /* Note: We should use binaryen.none here, but currently
                        the corresponding opcode is not supported by runtime */
                );
            } else if (!expr.newArgs) {
                arraySizeRef = this.convertTypeToI32(
                    module.f64.const(expr.arrayLen),
                    binaryen.f64,
                );
                const arrayInit = this.getArrayInitFromArrayType(<TSArray>type);
                arrayRef = binaryenCAPI._BinaryenArrayNew(
                    module.ptr,
                    arrayHeapType,
                    arraySizeRef,
                    arrayInit,
                );
            } else {
                const arrayType = <TSArray>type;
                const arrayLen = expr.arrayLen;
                arraySizeRef = module.i32.const(arrayLen);
                const array = [];
                for (let i = 0; i < expr.arrayLen; i++) {
                    const elemExpr = expr.newArgs[i];
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
                arrayRef = binaryenCAPI._BinaryenArrayInit(
                    module.ptr,
                    arrayHeapType,
                    arrayToPtr(array).ptr,
                    arrayLen,
                );
            }
            const arrayStructRef = binaryenCAPI._BinaryenStructNew(
                module.ptr,
                arrayToPtr([arrayRef, arraySizeRef]).ptr,
                2,
                arrayStructHeapType,
            );
            return arrayStructRef;
        }
        if (type.kind === TypeKind.CLASS) {
            const classType = <TSClass>type;
            const ctorType = classType.ctorType;
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

            let args = new Array<binaryen.ExpressionRef>();
            // TODO: here just set @context to null
            args.push(
                binaryenCAPI._BinaryenRefNull(
                    this.module.ptr,
                    emptyStructType.typeRef,
                ),
            );
            args.push(newStruct);
            const newArgs = expr.newArgs ? expr.newArgs : [];
            args = args.concat(this.parseArguments(ctorType, newArgs));
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
            } else if (accessInfo instanceof ImportScopeAccess) {
                curAccessInfo = this._createAccessInfo(
                    propName,
                    accessInfo.scope,
                    false,
                    true,
                );
            } else if (accessInfo instanceof TypeAccess) {
                const type = accessInfo.type;
                if (type instanceof TSClass) {
                    const propIndex = type.getStaticFieldIndex(propName);
                    if (propIndex !== -1) {
                        // static field
                        const wasmStaticFieldsType =
                            this.wasmType.getWASMClassStaticFieldsType(type);
                        const ref = module.global.get(
                            `${type.mangledName}_static_fields`,
                            wasmStaticFieldsType,
                        );
                        const propType =
                            type.getStaticMemberField(propName)!.type;
                        curAccessInfo = new StructAccess(
                            ref,
                            propIndex,
                            this.wasmType.getWASMType(propType),
                            propType,
                        );
                    } else {
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
                }
            } else if (accessInfo instanceof Type) {
                throw Error("Access type's builtin method unimplement");
            }
        } else {
            const wasmValue = accessInfo;
            let ref = wasmValue.binaryenRef;
            const tsType = wasmValue.tsType;
            const currentScope = this.currentFuncCtx.getCurrentScope();
            switch (tsType.typeKind) {
                case TypeKind.BOOLEAN:
                case TypeKind.NUMBER:
                case TypeKind.FUNCTION:
                case TypeKind.STRING:
                case TypeKind.ARRAY: {
                    const className = getClassNameByTypeKind(tsType.typeKind);
                    const classType = <TSClass>(
                        currentScope.findIdentifier(className)
                    );
                    curAccessInfo = new MethodAccess(
                        <TSFunction>propExpr.exprType,
                        classType.getMethod(
                            propName,
                            FunctionKind.METHOD,
                        ).index,
                        classType,
                        ref,
                        true,
                        propName,
                        tsType instanceof TSArray ? tsType.elementType : null,
                    );
                    break;
                }
                case TypeKind.CLASS: {
                    const classType = tsType as TSClass;
                    const propIndex = classType.getMemberFieldIndex(propName);
                    const type = binaryen.getExpressionType(ref);
                    ref = this._parseCallRef(ref, type, tsType);
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
                        // iff xxx.setter()
                        if (classMethod.index === -1 && expr.accessSetter) {
                            classMethod = classType.getMethod(
                                propName,
                                FunctionKind.SETTER,
                            );
                        }
                        // call object literal method
                        if (classMethod.index === -1) {
                            classMethod = classType.getMethod(
                                propName,
                                FunctionKind.DEFAULT,
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
                    let dynFieldIndex = this.findItableIndex(ref, propName, 0);

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
                    } else {
                        let method = infcType.getMethod(propName);
                        dynFieldIndex = this.findItableIndex(ref, propName, 1);
                        if (method.index === -1 && expr.accessSetter) {
                            method = infcType.getMethod(
                                propName,
                                FunctionKind.SETTER,
                            );
                            dynFieldIndex = this.findItableIndex(
                                ref,
                                propName,
                                3,
                            );
                        }
                        if (method.index !== -1) {
                            curAccessInfo = new InfcMethodAccess(
                                ifcTypeId,
                                objTypeId,
                                objRef,
                                objType,
                                method.index,
                                dynFieldIndex,
                                infcType,
                                method.method!.type,
                            );
                        } else {
                            method = infcType.getMethod(
                                propName,
                                FunctionKind.GETTER,
                            );
                            if (method.index === -1) {
                                throw Error(
                                    `${propName} property does not exist on interface ${tsType}`,
                                );
                            }
                            dynFieldIndex = this.findItableIndex(
                                ref,
                                propName,
                                2,
                            );
                            curAccessInfo = new InfcGetterAccess(
                                ifcTypeId,
                                objTypeId,
                                objRef,
                                objType,
                                method.index,
                                dynFieldIndex,
                                infcType,
                                method.method!.type,
                            );
                        }
                    }
                    break;
                }
                case TypeKind.ANY: {
                    curAccessInfo = new DynObjectAccess(ref, propName);
                    break;
                }
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
        const arrayStructRef = wasmValue.binaryenRef;
        const arrayType = wasmValue.tsType;
        const index = this.convertTypeToI32(
            this.WASMExprGen(argExpr).binaryenRef,
            binaryen.f64,
        );

        if (wasmValue.tsType.typeKind == TypeKind.STRING && !byRef) {
            const index_charAt = this.convertTypeToF64(index, binaryen.i32);
            const res = module.call(
                getFuncName(
                    BuiltinNames.builtinModuleName,
                    BuiltinNames.stringcharAtFuncName,
                ),
                [
                    binaryenCAPI._BinaryenRefNull(
                        this.module.ptr,
                        emptyStructType.typeRef,
                    ),
                    arrayStructRef,
                    index_charAt,
                ],
                stringTypeInfo.typeRef,
            );
            return res;
        }
        if (arrayType instanceof TSArray) {
            const elementType = arrayType.elementType;
            const elemWasmType = this.wasmType.getWASMType(elementType);
            const arrayWasmType = this.wasmType.getWASMType(arrayType);
            const arrayHeapType = this.wasmType.getWASMHeapType(arrayType);
            const arrayStructHeapType = generateArrayStructTypeInfo({
                typeRef: arrayWasmType,
                heapTypeRef: arrayHeapType,
            }).heapTypeRef;

            if (!byRef) {
                const arrayRef = binaryenCAPI._BinaryenStructGet(
                    module.ptr,
                    0,
                    arrayStructRef,
                    arrayStructHeapType,
                    false,
                );
                return binaryenCAPI._BinaryenArrayGet(
                    module.ptr,
                    arrayRef,
                    index,
                    elemWasmType,
                    false,
                );
            } else {
                return new ArrayAccess(
                    arrayStructRef,
                    index,
                    elemWasmType,
                    elementType,
                );
            }
        } else {
            /* Any-objects */
            if (!byRef) {
                return module.call(
                    dyntype.dyntype_get_elem,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        arrayStructRef,
                        index,
                    ],
                    dyntype.dyn_value_t,
                );
            } else {
                return new DynArrayAccess(arrayStructRef, index);
            }
        }
    }

    private WASMAsExpr(expr: AsExpression): binaryen.ExpressionRef {
        const originObjExpr = <IdentifierExpression>expr.expression;
        const originObjExprRef = this.WASMExprGen(originObjExpr).binaryenRef;
        const originType = originObjExpr.exprType;
        const targetType = expr.exprType;
        if (originType.kind !== TypeKind.ANY) {
            throw Error(`Static type doesn't support type assertion`);
        }
        return this.unboxAny(originObjExprRef, targetType);
    }

    private WASMFuncExpr(expr: FunctionExpression): binaryen.ExpressionRef {
        const funcScope = expr.funcScope;
        const parentScope = funcScope.parent;
        let funcName = funcScope.mangledName;
        let funcType = funcScope.funcType;

        /** if function is declare,
         *  we create a wrapper function to keep the same calling convention */
        if (funcScope.isDeclare()) {
            const { wrapperName, wrapperType } =
                this.wasmCompiler.generateImportWrapper(funcScope);
            funcName = wrapperName;
            funcType = wrapperType;
        }

        const wasmFuncType = this.wasmType.getWASMType(funcType);

        const funcStructHeapType =
            this.wasmType.getWASMFuncStructHeapType(funcType);
        const funcStructType = this.wasmType.getWASMFuncStructType(funcType);
        let context = binaryenCAPI._BinaryenRefNull(
            this.module.ptr,
            emptyStructType.typeRef,
        );
        if (parentScope instanceof ClosureEnvironment) {
            const ce = parentScope;
            const index = ce.contextVariable!.varIndex;
            const type = ce.contextVariable!.varType;
            context = this.module.local.get(
                index,
                this.wasmType.getWASMType(type),
            );
        }
        const closureVar = new Variable(
            `@closure|${funcName}`,
            funcType,
            [],
            -1,
            true,
        );
        this.addVariableToCurrentScope(closureVar);

        const closureRef = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([context, this.module.ref.func(funcName, wasmFuncType)])
                .ptr,
            2,
            funcStructHeapType,
        );

        this.currentFuncCtx.insert(
            this.module.local.set(closureVar.varIndex, closureRef),
        );
        return this.module.local.get(closureVar.varIndex, funcStructType);
    }

    private _generateInfcArgs(
        paramTypes: Type[],
        callArgs: Expression[],
        callWasmArgs: binaryen.ExpressionRef[],
    ) {
        for (let i = 0; i < callArgs.length; i++) {
            const paramType = paramTypes[i];
            const argType = callArgs[i].exprType;
            if (paramType instanceof TSClass && argType instanceof TSClass) {
                callWasmArgs[i] = this.maybeTypeBoxingAndUnboxing(
                    argType,
                    paramType,
                    callWasmArgs[i],
                );
            }
        }
        return callWasmArgs;
    }

    private _generateFuncCall(
        accessInfo: AccessBase | WasmValue,
        context: binaryen.ExpressionRef,
        callWasmArgs: binaryen.ExpressionRef[],
        expr: CallExpression,
    ) {
        const funcType = expr.callExpr.exprType as TSFunction;
        let funcRef: binaryen.ExpressionRef = -1;
        let tsType: Type = new Type();
        if (accessInfo instanceof AccessBase) {
            const wasmRef = this._loadFromAccessInfo(accessInfo);
            if (wasmRef instanceof AccessBase) {
                throw Error('unexpected error');
            }
            funcRef = wasmRef;
            if (accessInfo instanceof FunctionAccess) {
                // iff top level function, then using call instead of callref
                const parentScope = accessInfo.funcScope.parent;
                if (!(parentScope instanceof ClosureEnvironment)) {
                    funcRef = -1;
                }
            }
        } else {
            funcRef = accessInfo.binaryenRef;
            tsType = accessInfo.tsType;
        }

        const envArgs: binaryen.ExpressionRef[] = [];
        if (accessInfo instanceof FunctionAccess && funcRef === -1) {
            const { funcScope } = accessInfo;
            if (!funcScope.isDeclare()) {
                /* Only add context to non-declare functions */
                envArgs.push(context);
            }
            const finalCallWasmArgs = this._generateFinalArgs(
                envArgs,
                callWasmArgs,
                funcScope,
            );
            return this.module.call(
                funcScope.mangledName,
                finalCallWasmArgs,
                this.wasmType.getWASMFuncReturnType(funcType),
            );
        } else {
            /* Call closure */

            /* Extract context and funcref from closure */
            let closureRef = funcRef;
            const closureType =
                binaryenCAPI._BinaryenExpressionGetType(closureRef);
            closureRef = this._parseCallRef(closureRef, closureType, tsType);

            context = binaryenCAPI._BinaryenStructGet(
                this.module.ptr,
                0,
                closureRef,
                closureType,
                false,
            );
            funcRef = binaryenCAPI._BinaryenStructGet(
                this.module.ptr,
                1,
                closureRef,
                closureType,
                false,
            );
            envArgs.push(context);
            const finalCallWasmArgs = this._generateFinalArgs(
                envArgs,
                callWasmArgs,
            );

            return binaryenCAPI._BinaryenCallRef(
                this.module.ptr,
                funcRef,
                arrayToPtr(finalCallWasmArgs).ptr,
                finalCallWasmArgs.length,
                binaryen.getExpressionType(funcRef),
                false,
            );
        }
    }

    /** binaryen doesn't support struct.get(call_ref ...), so here insert some temp local variables
     * to support it
     */
    private _parseCallRef(
        ref: binaryen.ExpressionRef,
        wasmType: binaryen.Type,
        tsType: Type,
    ) {
        if (tsType.kind === TypeKind.UNKNOWN) {
            return ref;
        }

        const heaptype = binaryenCAPI._BinaryenTypeGetHeapType(wasmType);
        const isSignature = binaryenCAPI._BinaryenHeapTypeIsSignature(heaptype);
        if (isSignature) {
            let tempVarType = this.wasmType.getWASMType(tsType);
            if (tsType instanceof TSFunction) {
                tempVarType = this.wasmType.getWASMFuncStructType(tsType);
            }
            const tmpVarName = this.getTmpVariableName('~temp_call_ref|');
            const tmpVar = new Variable(tmpVarName, tsType, [], 0);
            this.addVariableToCurrentScope(tmpVar);
            const tmpWasmLocal = this.setVariableToCurrentScope(tmpVar, ref);
            this.currentFuncCtx.insert(tmpWasmLocal);
            return this.getVariableValue(tmpVar, tempVarType);
        }
        return ref;
    }

    /* get callref from class struct vtable index */
    private _generateClassMethodCallRef(
        classRef: binaryen.ExpressionRef | null = null,
        classType: TSClass,
        methodType: TSFunction,
        index: number,
        args: Array<binaryen.ExpressionRef>,
    ) {
        const wasmMethodType = this.wasmType.getWASMType(methodType);
        let vtable: binaryen.ExpressionRef;
        if (classRef) {
            vtable = binaryenCAPI._BinaryenStructGet(
                this.module.ptr,
                0,
                classRef,
                this.wasmType.getWASMClassVtableType(classType),
                false,
            );
        } else {
            vtable = this.wasmType.getWASMClassVtable(classType);
        }
        const targetFunction = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            index,
            vtable,
            wasmMethodType,
            false,
        );
        // call object literal method, no @this
        if (methodType.funcKind === FunctionKind.DEFAULT) {
            args = args.filter((item, idx) => idx !== 1);
        }
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

    private infcAssignToObj(from: Type, to: Type) {
        if (from.kind === TypeKind.INTERFACE && to.kind === TypeKind.CLASS) {
            return true;
        }
        return false;
    }

    private getInfcItable(ref: binaryenCAPI.ExpressionRef) {
        assert(
            binaryen.getExpressionType(ref) === this.wasmType.getInfcTypeRef(),
            'interface type error',
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
            'interface type error',
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
            'interface type error',
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
        assert(type instanceof TSClass, 'unbox interface to non-class type');
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
        if (this.infcAssignToObj(fromType, toType)) {
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
        let wasmType: binaryen.Type;
        if (type instanceof TSArray) {
            wasmType = this.wasmType.getWasmArrayStructType(type);
        } else {
            wasmType = this.wasmType.getWASMType(type);
        }
        const typeKind = type.kind;
        let res: binaryen.ExpressionRef | null = null;
        if (typeKind === TypeKind.BOOLEAN) {
            res = this.module.call(
                structdyn.StructDyn.struct_get_dyn_i32,
                [ref, index],
                binaryen.i32,
            );
        } else if (typeKind === TypeKind.NUMBER) {
            res = this.module.call(
                structdyn.StructDyn.struct_get_dyn_f64,
                [ref, index],
                binaryen.f64,
            );
        } else if (typeKind === TypeKind.FUNCTION) {
            /** get vtable firstly */
            res = this.module.call(
                structdyn.StructDyn.struct_get_dyn_anyref,
                [ref, this.module.i32.const(0)],
                binaryen.anyref,
            );
            res = this.module.call(
                structdyn.StructDyn.struct_get_dyn_funcref,
                [res, index],
                binaryen.funcref,
            );
            res = binaryenCAPI._BinaryenRefCast(this.module.ptr, res, wasmType);
        } else if (wasmType === binaryen.i64) {
            res = this.module.call(
                structdyn.StructDyn.struct_get_dyn_i64,
                [ref, index],
                binaryen.i32,
            );
        } else if (wasmType === binaryen.f32) {
            res = this.module.call(
                structdyn.StructDyn.struct_get_dyn_f32,
                [ref, index],
                binaryen.f32,
            );
        } else {
            const obj = this.module.call(
                structdyn.StructDyn.struct_get_dyn_anyref,
                [ref, index],
                binaryen.anyref,
            );
            res = binaryenCAPI._BinaryenRefCast(this.module.ptr, obj, wasmType);
        }
        if (!res) {
            throw new Error(`get interface field failed, type: ${type}`);
        }
        return res;
    }

    private findItableIndex(
        infcRef: binaryen.ExpressionRef,
        propName: string,
        tag: number,
    ) {
        return this.module.call(
            'find_index',
            [
                this.getInfcItable(infcRef),
                this.module.i32.const(
                    this.wasmCompiler.generateRawString(propName),
                ),
                this.module.i32.const(tag),
            ],
            binaryen.i32,
        );
    }

    private dynSetInfcField(
        ref: binaryen.ExpressionRef,
        index: binaryen.ExpressionRef,
        value: binaryen.ExpressionRef,
        type: Type,
    ) {
        const wasmType = this.wasmType.getWASMType(type);
        const typeKind = type.kind;
        let res: binaryen.ExpressionRef | null = null;

        if (typeKind === TypeKind.BOOLEAN) {
            res = this.module.call(
                structdyn.StructDyn.struct_set_dyn_i32,
                [ref, index, value],
                binaryen.none,
            );
        } else if (typeKind === TypeKind.NUMBER) {
            res = this.module.call(
                structdyn.StructDyn.struct_set_dyn_f64,
                [ref, index, value],
                binaryen.none,
            );
        } else if (typeKind === TypeKind.FUNCTION) {
            res = this.module.call(
                structdyn.StructDyn.struct_get_dyn_anyref,
                [ref, this.module.i32.const(0)],
                binaryen.anyref,
            );
            res = this.module.call(
                structdyn.StructDyn.struct_set_dyn_funcref,
                [res, index, value],
                binaryen.none,
            );
        } else if (wasmType === binaryen.i64) {
            res = this.module.call(
                structdyn.StructDyn.struct_set_dyn_i64,
                [ref, index, value],
                binaryen.none,
            );
        } else if (wasmType === binaryen.f32) {
            res = this.module.call(
                structdyn.StructDyn.struct_set_dyn_f32,
                [ref, index, value],
                binaryen.none,
            );
        } else {
            res = this.module.call(
                structdyn.StructDyn.struct_set_dyn_anyref,
                [ref, index, value],
                binaryen.none,
            );
        }
        if (!res) {
            throw new Error(`set interface field failed, type: ${type}`);
        }
        return res;
    }

    private _getArrayRefLen(
        arrRef: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        const arrLenI32 = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            1,
            arrRef,
            binaryen.getExpressionType(arrRef),
            false,
        );
        const arrLenF64 = this.convertTypeToF64(
            arrLenI32,
            binaryen.getExpressionType(arrLenI32),
        );
        return arrLenF64;
    }

    private _getStringRefLen(
        stringRef: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        const strArray = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            1,
            stringRef,
            charArrayTypeInfo.typeRef,
            false,
        );
        const strLenI32 = binaryenCAPI._BinaryenArrayLen(
            this.module.ptr,
            strArray,
        );
        const strLenF64 = this.convertTypeToF64(
            strLenI32,
            binaryen.getExpressionType(strLenI32),
        );
        return strLenF64;
    }

    getWasmValueByExpr(
        expr: Expression,
        targetType: Type,
        isArrayFunction = false,
    ): binaryen.ExpressionRef {
        let res: binaryen.ExpressionRef;
        if (
            targetType.kind === TypeKind.ANY ||
            (targetType.kind === TypeKind.GENERIC && !isArrayFunction)
        ) {
            res = this.dynValueGen.WASMDynExprGen(expr).binaryenRef;
        } else {
            res = this.WASMExprGen(expr).binaryenRef;
            if (expr.exprType.kind === TypeKind.ANY) {
                res = this.unboxAny(res, targetType);
            }
        }
        return res;
    }

    parseArguments(
        funcType: TSFunction,
        args: Expression[],
        typeArg: Type | null = null,
        isArrayFunc = false,
    ) {
        const paramTypes = funcType.getParamTypes();
        const callerArgs: binaryen.ExpressionRef[] = new Array(
            paramTypes.length,
        );

        /* parse regular args */
        for (let i = 0; i < args.length; i++) {
            if (funcType.restParamIdx === i) {
                break;
            }
            callerArgs[i] = this.getWasmValueByExpr(
                args[i],
                paramTypes[i],
                isArrayFunc,
            );
        }

        /* parse optional param as undifined */
        for (let i = 0; i < paramTypes.length; i++) {
            if (!callerArgs[i] && funcType.isOptionalParams[i]) {
                callerArgs[i] = this.generateDynUndefined();
            }
        }

        /* parse rest params */
        if (funcType.hasRest()) {
            const restType = paramTypes[funcType.restParamIdx];
            if (restType instanceof TSArray) {
                if (args.length > funcType.restParamIdx) {
                    callerArgs[funcType.restParamIdx] = this.initArray(
                        restType,
                        args.slice(funcType.restParamIdx),
                        typeArg,
                    );
                } else {
                    callerArgs[funcType.restParamIdx] = this.initArray(
                        restType,
                        [],
                        typeArg,
                    );
                }
            } else {
                Logger.error(`rest type is not array`);
            }
        }

        /* parse interface types */
        const callWasmArgs = this._generateInfcArgs(
            paramTypes,
            args,
            callerArgs,
        );
        return callWasmArgs;
    }

    private initArray(
        arrType: TSArray,
        elements: Expression[],
        typeArg: Type | null = null,
    ) {
        const arrayLen = elements.length;
        const array = [];
        const arrElemType = arrType.elementType;
        for (let i = 0; i < arrayLen; i++) {
            const elemExpr = elements[i];
            let elemExprRef: binaryen.ExpressionRef;
            if (arrType.elementType.kind === TypeKind.ANY) {
                elemExprRef =
                    this.dynValueGen.WASMDynExprGen(elemExpr).binaryenRef;
            } else {
                elemExprRef = this.WASMExprGen(elemExpr).binaryenRef;
                if (
                    arrElemType instanceof TSClass &&
                    elemExpr.exprType instanceof TSClass
                ) {
                    elemExprRef = this.maybeTypeBoxingAndUnboxing(
                        elemExpr.exprType,
                        arrElemType,
                        elemExprRef,
                    );
                }
            }
            array.push(elemExprRef);
        }
        const arrayWasmType = this.wasmType.getWASMType(
            arrType,
            false,
            typeArg,
        );
        const arrayHeapType = this.wasmType.getWASMHeapType(
            arrType,
            false,
            typeArg,
        );
        const arrayStructTypeInfo = generateArrayStructTypeInfo({
            typeRef: arrayWasmType,
            heapTypeRef: arrayHeapType,
        });
        const arrayValue = binaryenCAPI._BinaryenArrayInit(
            this.module.ptr,
            arrayHeapType,
            arrayToPtr(array).ptr,
            arrayLen,
        );
        const arrayStructValue = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([arrayValue, this.module.i32.const(array.length)]).ptr,
            2,
            arrayStructTypeInfo.heapTypeRef,
        );

        return arrayStructValue;
    }

    private parseDynMethodCall(
        access: DynObjectAccess,
        callExpr: Expression,
        args: Expression[],
    ) {
        const nameAddr = this.wasmCompiler.generateRawString(access.fieldName);
        if (!(callExpr instanceof PropertyAccessExpression)) {
            throw new Error(
                'call method from any type should be a property access expr',
            );
        }
        const wasmArgs: binaryen.ExpressionRef[] = [];
        const dynCompiler = this.wasmCompiler.wasmDynExprCompiler;
        for (const arg of args) {
            if (arg instanceof FunctionExpression) {
                wasmArgs.push(this.WASMExprGen(arg).binaryenRef);
            } else {
                wasmArgs.push(dynCompiler.WASMDynExprGen(arg).binaryenRef);
            }
        }
        const arrayValue = binaryenCAPI._BinaryenArrayInit(
            this.module.ptr,
            anyArrayTypeInfo.heapTypeRef,
            arrayToPtr(wasmArgs).ptr,
            wasmArgs.length,
        );
        const arrayStructType = generateArrayStructTypeInfo(anyArrayTypeInfo);
        const arrayStruct = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([arrayValue, this.module.i32.const(wasmArgs.length)])
                .ptr,
            2,
            arrayStructType.heapTypeRef,
        );
        return this.module.call(
            dyntype.dyntype_invoke,
            [
                this.module.global.get(
                    dyntype.dyntype_context,
                    dyntype.dyn_ctx_t,
                ),
                this.module.i32.const(nameAddr),
                access.ref,
                arrayStruct,
            ],
            binaryen.anyref,
        );
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
            case ts.SyntaxKind.FalseKeyword:
            case ts.SyntaxKind.TrueKeyword:
            case ts.SyntaxKind.StringLiteral:
            case ts.SyntaxKind.NullKeyword:
                res = this.boxBaseTypeToAny(expr);
                break;
            case ts.SyntaxKind.ArrayLiteralExpression:
                res = this.WASMDynArrayExpr(<ArrayLiteralExpression>expr);
                break;
            case ts.SyntaxKind.ObjectLiteralExpression:
                res = this.WASMDynObjExpr(<ObjectLiteralExpression>expr);
                break;
            case ts.SyntaxKind.Identifier:
            case ts.SyntaxKind.BinaryExpression:
            case ts.SyntaxKind.PrefixUnaryExpression:
            case ts.SyntaxKind.PostfixUnaryExpression:
            case ts.SyntaxKind.CallExpression:
            case ts.SyntaxKind.PropertyAccessExpression:
            case ts.SyntaxKind.ElementAccessExpression:
                res = this.boxNonLiteralToAny(expr);
                break;
            case ts.SyntaxKind.NewExpression: {
                const newExpr = <NewExpression>expr;
                const objExpr = newExpr.newExpr;
                if (!(objExpr instanceof IdentifierExpression)) {
                    throw new Error(
                        "Not impl when creating dynamic object with NewExpression's expr is not identifier",
                    );
                }
                const identifierName = objExpr.identifierName;
                const scope = this.currentFuncCtx.getCurrentScope();
                const type = scope.findIdentifier(identifierName);
                // access to user defined class
                if (type instanceof Type) {
                    res = this.boxNonLiteralToAny(newExpr);
                } else {
                    // fallback to quickjs iff built-in class
                    res = this.createDynObject(identifierName, newExpr);
                }
                break;
            }
            default:
                throw new Error(
                    'unexpected expr kind ' +
                        ts.SyntaxKind[expr.expressionKind],
                );
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

    /** the dynamic object will fallback to quickjs */
    createDynObject(
        name: string,
        newExpr?: NewExpression,
    ): binaryen.ExpressionRef {
        const namePointer = this.wasmCompiler.generateRawString(name);
        const wasmArgs: binaryen.ExpressionRef[] = [];
        let numArgs;
        if (newExpr && newExpr?.newArgs) {
            numArgs = newExpr.newArgs.length;
            for (const arg of newExpr.newArgs) {
                wasmArgs.push(this.WASMDynExprGen(arg).binaryenRef);
            }
        } else {
            numArgs = 0;
        }
        const argArray = binaryenCAPI._BinaryenArrayInit(
            this.module.ptr,
            anyArrayTypeInfo.heapTypeRef,
            arrayToPtr(wasmArgs).ptr,
            numArgs,
        );

        const arrayStructType = generateArrayStructTypeInfo(anyArrayTypeInfo);
        const arrayStruct = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([argArray, this.module.i32.const(numArgs)]).ptr,
            2,
            arrayStructType.heapTypeRef,
        );
        const res = this.module.call(
            dyntype.dyntype_new_object_with_class,
            [
                this.module.global.get(
                    dyntype.dyntype_context,
                    dyntype.dyn_ctx_t,
                ),
                this.module.i32.const(namePointer),
                arrayStruct,
            ],
            dyntype.dyn_value_t,
        );
        return res;
    }
}

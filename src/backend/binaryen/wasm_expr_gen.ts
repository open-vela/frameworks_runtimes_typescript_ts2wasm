/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import ts from 'typescript';
import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import {
    builtinFunctionType,
    arrayToPtr,
    createCondBlock,
    emptyStructType,
    generateArrayStructTypeInfo,
} from './glue/transform.js';
import { assert } from 'console';
import { WASMGen } from './index.js';
import { Logger } from '../../log.js';
import {
    UtilFuncs,
    FunctionalFuncs,
    getCString,
    ItableFlag,
    InfcFieldIndex,
} from './utils.js';
import { processEscape } from '../../utils.js';
import {
    BinaryExprValue,
    BlockBranchIfValue,
    BlockBranchValue,
    BlockValue,
    CastValue,
    ClosureCallValue,
    ConditionExprValue,
    DirectCallValue,
    DirectGetterValue,
    DirectSetterValue,
    DynamicCallValue,
    DynamicGetValue,
    DynamicSetValue,
    ElementGetValue,
    ElementSetValue,
    FunctionCallValue,
    LiteralValue,
    NewArrayLenValue,
    NewArrayValue,
    NewClosureFunction,
    NewLiteralArrayValue,
    NewLiteralObjectValue,
    OffsetGetValue,
    OffsetSetValue,
    PostUnaryExprValue,
    PrefixUnaryExprValue,
    SemanticsValue,
    SemanticsValueKind,
    ShapeCallValue,
    ShapeGetValue,
    ShapeSetValue,
    SuperValue,
    VarValue,
    VarValueKind,
    OffsetCallValue,
    VTableCallValue,
    TypeofValue,
    ToStringValue,
    AnyCallValue,
    SuperUsageFlag,
    CommaExprValue,
} from '../../semantics/value.js';
import {
    ArrayType,
    ClosureContextType,
    FunctionType,
    ObjectType,
    ObjectTypeFlag,
    Primitive,
    TypeParameterType,
    UnionType,
    ValueType,
    ValueTypeKind,
    ValueTypeWithArguments,
} from '../../semantics/value_types.js';
import { UnimplementError } from '../../error.js';
import {
    FunctionDeclareNode,
    VarDeclareNode,
} from '../../semantics/semantics_nodes.js';
import {
    MemberDescription,
    MemberType,
    ObjectDescription,
    ObjectDescriptionType,
} from '../../semantics/runtime.js';
import { NewConstructorObjectValue } from '../../semantics/value.js';
import { BuiltinNames } from '../../../lib/builtin/builtin_name.js';
import { dyntype, structdyn } from './lib/dyntype/utils.js';
import { anyArrayTypeInfo, infcTypeInfo } from './glue/packType.js';
import { GetBuiltinObjectType } from '../../semantics/builtin.js';
import { getBuiltInFuncName } from '../../utils.js';
import { stringTypeInfo } from './glue/packType.js';

export class WASMExpressionGen {
    private currentFuncCtx;
    private module: binaryen.Module;
    private wasmTypeGen;

    constructor(private wasmCompiler: WASMGen) {
        this.module = this.wasmCompiler.module;
        this.wasmTypeGen = this.wasmCompiler.wasmTypeComp;
        this.currentFuncCtx = this.wasmCompiler.currentFuncCtx!;
    }

    wasmExprGen(value: SemanticsValue): binaryen.ExpressionRef {
        this.module = this.wasmCompiler.module;
        this.wasmTypeGen = this.wasmCompiler.wasmTypeComp;
        this.currentFuncCtx = this.wasmCompiler.currentFuncCtx!;

        switch (value.kind) {
            case SemanticsValueKind.SUPER:
                return this.wasmSuper(<SuperValue>value);
            case SemanticsValueKind.LITERAL:
                return this.wasmLiteral(<LiteralValue>value);
            case SemanticsValueKind.PARAM_VAR:
            case SemanticsValueKind.LOCAL_VAR:
            case SemanticsValueKind.LOCAL_CONST:
            case SemanticsValueKind.GLOBAL_VAR:
            case SemanticsValueKind.GLOBAL_CONST:
            case SemanticsValueKind.CLOSURE_VAR:
            case SemanticsValueKind.CLOSURE_CONST:
                return this.wasmGetValue(<VarValue>value);
            case SemanticsValueKind.NEW_CLOSURE_FUNCTION:
                return this.wasmGetClosure(<NewClosureFunction>value);
            case SemanticsValueKind.BINARY_EXPR:
                return this.wasmBinaryExpr(<BinaryExprValue>value);
            case SemanticsValueKind.COMMA_EXPR:
                return this.wasmCommaExpr(<CommaExprValue>value);
            case SemanticsValueKind.POST_UNARY_EXPR:
                return this.wasmPostUnaryExpr(<PostUnaryExprValue>value);
            case SemanticsValueKind.PRE_UNARY_EXPR:
                return this.wasmPreUnaryExpr(<PrefixUnaryExprValue>value);
            case SemanticsValueKind.CONDITION_EXPR:
                return this.wasmConditionalExpr(<ConditionExprValue>value);
            case SemanticsValueKind.OFFSET_CALL:
                return this.wasmOffsetCall(<OffsetCallValue>value);
            case SemanticsValueKind.DIRECT_CALL:
                return this.wasmDirectCall(<DirectCallValue>value);
            case SemanticsValueKind.FUNCTION_CALL:
                return this.wasmFunctionCall(<FunctionCallValue>value);
            case SemanticsValueKind.CLOSURE_CALL:
                return this.wasmClosureCall(<ClosureCallValue>value);
            case SemanticsValueKind.DYNAMIC_CALL:
                return this.wasmDynamicCall(<DynamicCallValue>value);
            case SemanticsValueKind.VTABLE_CALL:
                return this.wasmVtableCall(<VTableCallValue>value);
            case SemanticsValueKind.ANY_CALL:
                return this.wasmAnyCall(<AnyCallValue>value);
            case SemanticsValueKind.ANY_CAST_VALUE:
            case SemanticsValueKind.VALUE_CAST_ANY:
            case SemanticsValueKind.VALUE_CAST_UNION:
            case SemanticsValueKind.UNION_CAST_VALUE:
            case SemanticsValueKind.OBJECT_CAST_ANY:
            case SemanticsValueKind.OBJECT_CAST_UNION:
            case SemanticsValueKind.UNION_CAST_OBJECT:
            case SemanticsValueKind.UNION_CAST_ANY:
            case SemanticsValueKind.ANY_CAST_OBJECT:
            case SemanticsValueKind.OBJECT_CAST_VALUE:
                return this.wasmAnyCast(<CastValue>value);
            case SemanticsValueKind.VALUE_CAST_VALUE:
                return this.wasmValueCast(<CastValue>value);
            case SemanticsValueKind.SHAPE_SET:
                return this.wasmObjFieldSet(<ShapeSetValue>value);
            case SemanticsValueKind.OFFSET_SET:
                return this.wasmObjFieldSet(<OffsetSetValue>value);
            case SemanticsValueKind.NEW_LITERAL_OBJECT:
                return this.wasmNewLiteralObj(<NewLiteralObjectValue>value);
            case SemanticsValueKind.OBJECT_CAST_OBJECT:
                return this.wasmObjCast(<CastValue>value);
            case SemanticsValueKind.NEW_CONSTRCTOR_OBJECT:
                return this.wasmNewClass(<NewConstructorObjectValue>value);
            case SemanticsValueKind.SHAPE_GET:
                return this.wasmObjFieldGet(<ShapeGetValue>value);
            case SemanticsValueKind.OFFSET_GETTER:
            case SemanticsValueKind.OFFSET_GET:
                return this.wasmObjFieldGet(<OffsetGetValue>value);
            case SemanticsValueKind.DYNAMIC_GET:
                return this.wasmDynamicGet(<DynamicGetValue>value);
            case SemanticsValueKind.DYNAMIC_SET:
                return this.wasmDynamicSet(<DynamicSetValue>value);
            case SemanticsValueKind.NEW_LITERAL_ARRAY:
                return this.wasmNewLiteralArray(<NewLiteralArrayValue>value);
            case SemanticsValueKind.ARRAY_INDEX_GET:
            case SemanticsValueKind.OBJECT_KEY_GET:
            case SemanticsValueKind.STRING_INDEX_GET:
                return this.wasmElemGet(<ElementGetValue>value);
            case SemanticsValueKind.ARRAY_INDEX_SET:
            case SemanticsValueKind.OBJECT_KEY_SET:
            case SemanticsValueKind.STRING_INDEX_SET:
                return this.wasmElemSet(<ElementSetValue>value);
            case SemanticsValueKind.BLOCK:
                return this.wasmBlockValue(<BlockValue>value);
            case SemanticsValueKind.BLOCK_BRANCH_IF:
                return this.wasmBlockIFValue(<BlockBranchIfValue>value);
            case SemanticsValueKind.BLOCK_BRANCH:
                return this.wasmBlockBranchValue(<BlockBranchValue>value);
            case SemanticsValueKind.SHAPE_CALL:
                return this.wasmShapeCall(<ShapeCallValue>value);
            case SemanticsValueKind.DIRECT_GETTER:
                return this.wasmDirectGetter(<DirectGetterValue>value);
            case SemanticsValueKind.DIRECT_SETTER:
                return this.wasmDirectSetter(<DirectSetterValue>value);
            case SemanticsValueKind.NEW_ARRAY:
            case SemanticsValueKind.NEW_ARRAY_LEN:
                return this.wasmNewArray(
                    <NewArrayValue | NewArrayLenValue>value,
                );
            case SemanticsValueKind.TYPEOF:
                return this.wasmTypeof(<TypeofValue>value);
            case SemanticsValueKind.VALUE_TO_STRING:
            case SemanticsValueKind.OBJECT_TO_STRING:
                return this.wasmToString(<ToStringValue>value);
            default:
                throw new Error(`unexpected value: ${value}`);
        }
    }

    private wasmSuper(value: SuperValue): binaryen.ExpressionRef {
        if (value.usageFlag == SuperUsageFlag.SUPER_CALL) {
            const constructor = value.shape?.meta.name + '|constructor';
            const metaInfo = (value.type as ObjectType).meta;
            const ctorFuncDecl = (
                metaInfo.ctor!.methodOrAccessor!.method! as VarValue
            ).ref as FunctionDeclareNode;
            const thisRef = this.module.local.get(1, emptyStructType.typeRef);
            return this.module.drop(
                this.callFunc(
                    metaInfo.ctor!.valueType as FunctionType,
                    constructor,
                    binaryen.none,
                    value.parameters,
                    ctorFuncDecl,
                    undefined,
                    thisRef,
                ),
            );
        } else {
            return this.module.local.get(1, emptyStructType.typeRef);
        }
    }

    private wasmLiteral(value: LiteralValue): binaryen.ExpressionRef {
        switch (value.type) {
            case Primitive.Number: {
                return this.module.f64.const(value.value as number);
            }
            case Primitive.Boolean: {
                const literalValue = value.value as boolean;
                if (literalValue) {
                    return this.module.i32.const(1);
                } else {
                    return this.module.i32.const(0);
                }
            }
            case Primitive.RawString: {
                return FunctionalFuncs.generateStringRef(
                    this.module,
                    processEscape(value.value as string),
                );
            }
            case Primitive.String: {
                return FunctionalFuncs.generateStringRef(
                    this.module,
                    value.value as string,
                );
            }
            case Primitive.Null: {
                return this.module.ref.null(
                    binaryenCAPI._BinaryenTypeStructref(),
                );
            }
            case Primitive.Undefined: {
                /* Currently, we treat undefined as any */
                return FunctionalFuncs.generateDynUndefined(this.module);
            }
            case Primitive.Int: {
                return this.module.i32.const(value.value as number);
            }
            default: {
                throw new UnimplementError(`TODO: wasmLiteral: ${value}`);
            }
        }
    }

    private wasmGetValue(value: VarValue): binaryen.ExpressionRef {
        const varNode = value.ref;
        const varTypeRef = this.wasmTypeGen.getWASMValueType(value.type);
        /** when meeting a ValueType as value, return wasm type */
        if (value.ref instanceof ValueType) {
            return varTypeRef;
        }
        switch (value.kind) {
            case SemanticsValueKind.PARAM_VAR:
            case SemanticsValueKind.LOCAL_VAR:
            case SemanticsValueKind.LOCAL_CONST: {
                const varDeclNode = varNode as VarDeclareNode;
                if (varDeclNode.isUsedInClosureFunction()) {
                    const currCtx = varDeclNode.currCtx;
                    const belongCtx = varDeclNode.belongCtx;

                    if (!currCtx || !belongCtx) {
                        throw new Error(
                            `get context of closure failed, varNode is ${varDeclNode.name}`,
                        );
                    }
                    let currCtxType = currCtx.type as ClosureContextType;
                    const belongCtxType = belongCtx.type as ClosureContextType;
                    let contextTypeRef =
                        this.wasmTypeGen.getWASMType(currCtxType);
                    let contextRef = this.module.local.get(
                        currCtx.index,
                        contextTypeRef,
                    );
                    while (currCtxType != belongCtxType) {
                        if (currCtxType.freeVarTypeList.length !== 0) {
                            contextRef = binaryenCAPI._BinaryenStructGet(
                                this.module.ptr,
                                0,
                                contextRef,
                                contextTypeRef,
                                false,
                            );
                        }

                        currCtxType = currCtxType.parentCtxType!;
                        contextTypeRef =
                            this.wasmTypeGen.getWASMType(currCtxType);
                    }

                    return binaryenCAPI._BinaryenStructGet(
                        this.module.ptr,
                        varDeclNode!.closureIndex! + 1,
                        contextRef,
                        contextTypeRef,
                        false,
                    );
                } else {
                    return this.module.local.get(varNode.index, varTypeRef);
                }
            }
            case SemanticsValueKind.GLOBAL_VAR:
            case SemanticsValueKind.GLOBAL_CONST: {
                if (varNode instanceof VarDeclareNode) {
                    if (varNode.name === BuiltinNames.nanName) {
                        return this.module.f64.const(NaN);
                    } else if (varNode.name === BuiltinNames.infinityName) {
                        return this.module.f64.const(Infinity);
                    } else if (
                        varNode.name.includes(
                            BuiltinNames.builtinTypeManglePrefix,
                        )
                    ) {
                        const fallbackTypeName = varNode.name.substring(
                            varNode.name.indexOf(
                                BuiltinNames.builtinTypeManglePrefix,
                            ),
                        );
                        if (
                            !BuiltinNames.fallbackGlobalNames.includes(
                                fallbackTypeName,
                            )
                        ) {
                            throw new Error(
                                `type ${fallbackTypeName} doesn't exist in fallback type names`,
                            );
                        }
                        const origName = varNode.name.split(
                            BuiltinNames.moduleDelimiter,
                        )[1];
                        BuiltinNames.JSGlobalObjects.add(origName);
                        return this.module.global.get(
                            origName,
                            binaryen.anyref,
                        );
                    }
                    return this.module.global.get(varNode.name, varTypeRef);
                } else if (varNode instanceof FunctionDeclareNode) {
                    return this.createClosureStruct(varNode);
                } else {
                    throw Error(
                        `need to handle global var in wasmGetVar: ${value}`,
                    );
                }
            }
            default:
                throw new UnimplementError(
                    `Need to handle ${value.kind} in wasmGetVar`,
                );
        }
    }

    private wasmGetClosure(value: NewClosureFunction): binaryen.ExpressionRef {
        return this.createClosureStruct(value.funcNode);
    }

    private createClosureStruct(funcNode: FunctionDeclareNode) {
        const funcTypeRef = this.wasmTypeGen.getWASMType(funcNode.funcType);
        const closureStructHeapTypeRef = this.wasmTypeGen.getWASMValueHeapType(
            funcNode.funcType,
        );
        const closureContextRef = funcNode.parentCtx
            ? this.module.local.get(
                  funcNode.parentCtx.index,
                  this.wasmTypeGen.getWASMValueType(funcNode.parentCtx.type),
              )
            : binaryenCAPI._BinaryenRefNull(
                  this.module.ptr,
                  emptyStructType.typeRef,
              );
        const closureStruct = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([
                closureContextRef,
                this.module.ref.func(funcNode.name, funcTypeRef),
            ]).ptr,
            2,
            closureStructHeapTypeRef,
        );
        return closureStruct;
    }

    private wasmSetValue(
        value: VarValue,
        targetValue: SemanticsValue,
    ): binaryen.ExpressionRef {
        const varNode = value.ref as VarDeclareNode;
        const targetValueRef = this.wasmExprGen(targetValue);
        switch (value.kind) {
            case SemanticsValueKind.PARAM_VAR:
            case SemanticsValueKind.LOCAL_VAR:
            case SemanticsValueKind.LOCAL_CONST: {
                if (varNode.isUsedInClosureFunction()) {
                    const currCtx = varNode.currCtx;
                    const belongCtx = varNode.belongCtx;
                    if (!currCtx || !belongCtx) {
                        throw new Error(
                            `get context of closure failed, varNode is ${varNode.name}`,
                        );
                    }
                    let currCtxType = currCtx.type as ClosureContextType;
                    const belongCtxType = belongCtx.type as ClosureContextType;
                    let contextTypeRef =
                        this.wasmTypeGen.getWASMType(currCtxType);
                    let contextRef = this.module.local.get(
                        currCtx.index,
                        contextTypeRef,
                    );
                    while (currCtxType != belongCtxType) {
                        if (currCtxType.freeVarTypeList.length !== 0) {
                            contextRef = binaryenCAPI._BinaryenStructGet(
                                this.module.ptr,
                                0,
                                contextRef,
                                contextTypeRef,
                                false,
                            );
                        }

                        currCtxType = currCtxType.parentCtxType!;
                        contextTypeRef =
                            this.wasmTypeGen.getWASMType(currCtxType);
                    }
                    return binaryenCAPI._BinaryenStructSet(
                        this.module.ptr,
                        varNode.closureIndex! + 1,
                        contextRef,
                        targetValueRef,
                    );
                } else {
                    return this.module.local.set(varNode.index, targetValueRef);
                }
            }
            case SemanticsValueKind.GLOBAL_VAR:
            case SemanticsValueKind.GLOBAL_CONST:
                return this.module.global.set(varNode.name, targetValueRef);
            default:
                throw new UnimplementError(
                    `Need to handle ${value.kind} in wasmSetVar`,
                );
        }
    }

    private parseComplexOp(opKind: ts.SyntaxKind): ts.BinaryOperator {
        switch (opKind) {
            case ts.SyntaxKind.PlusEqualsToken:
                return ts.SyntaxKind.PlusToken;
            case ts.SyntaxKind.MinusEqualsToken:
                return ts.SyntaxKind.MinusToken;
            case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
                return ts.SyntaxKind.AsteriskEqualsToken;
            case ts.SyntaxKind.AsteriskEqualsToken:
                return ts.SyntaxKind.AsteriskToken;
            case ts.SyntaxKind.SlashEqualsToken:
                return ts.SyntaxKind.SlashToken;
            case ts.SyntaxKind.PercentEqualsToken:
                return ts.SyntaxKind.PercentToken;
            case ts.SyntaxKind.PlusPlusToken:
                return ts.SyntaxKind.PlusEqualsToken;
            case ts.SyntaxKind.MinusMinusToken:
                return ts.SyntaxKind.MinusEqualsToken;
            case ts.SyntaxKind.MinusToken:
                return ts.SyntaxKind.MinusToken;
            default:
                throw new UnimplementError('parseAssignmentOp: ${operator}');
        }
    }

    private wasmBinaryExpr(value: BinaryExprValue): binaryen.ExpressionRef {
        const opKind = value.opKind;
        const leftValue = value.left;
        const rightValue = value.right;
        switch (opKind) {
            case ts.SyntaxKind.EqualsToken: {
                return this.assignBinaryExpr(leftValue, rightValue);
            }
            case ts.SyntaxKind.PlusEqualsToken:
            case ts.SyntaxKind.MinusEqualsToken:
            case ts.SyntaxKind.AsteriskEqualsToken:
            case ts.SyntaxKind.SlashEqualsToken: {
                const tmpOpKind = this.parseComplexOp(opKind);
                const tmpValue = new BinaryExprValue(
                    leftValue.type,
                    tmpOpKind,
                    leftValue,
                    rightValue,
                );
                return this.assignBinaryExpr(leftValue, tmpValue);
            }
            case ts.SyntaxKind.InstanceOfKeyword: {
                return this.wasmInstanceOf(leftValue, rightValue);
            }
            default: {
                return this.operateBinaryExpr(leftValue, rightValue, opKind);
            }
        }
    }

    private wasmCommaExpr(value: CommaExprValue): binaryen.ExpressionRef {
        const exprs: binaryen.ExpressionRef[] = [];
        for (const expr of value.exprs) {
            exprs.push(this.wasmExprGen(expr));
        }

        return this.module.block(null, exprs);
    }

    private wasmAnyGen(expr: SemanticsValue): binaryen.ExpressionRef {
        /* TODO */
        return binaryen.unreachable;
    }

    operateBinaryExpr(
        leftValue: SemanticsValue,
        rightValue: SemanticsValue,
        opKind: ts.BinaryOperator,
    ): binaryen.ExpressionRef {
        const leftValueType = leftValue.type;
        const leftValueRef = this.wasmExprGen(leftValue);
        const leftRefType = binaryen.getExpressionType(leftValueRef);
        const rightValueType = rightValue.type;
        const rightValueRef = this.wasmExprGen(rightValue);
        const rightRefType = binaryen.getExpressionType(rightValueRef);
        if (
            leftValueType.kind === ValueTypeKind.NUMBER &&
            rightValueType.kind === ValueTypeKind.NUMBER
        ) {
            return FunctionalFuncs.operateF64F64(
                this.module,
                leftValueRef,
                rightValueRef,
                opKind,
            );
        }
        if (
            leftValueType.kind === ValueTypeKind.NUMBER &&
            rightValueType.kind === ValueTypeKind.BOOLEAN
        ) {
            return FunctionalFuncs.operateF64I32(
                this.module,
                leftValueRef,
                rightValueRef,
                opKind,
            );
        }
        if (
            leftValueType.kind === ValueTypeKind.BOOLEAN &&
            rightValueType.kind === ValueTypeKind.NUMBER
        ) {
            return FunctionalFuncs.operateI32F64(
                this.module,
                leftValueRef,
                rightValueRef,
                opKind,
            );
        }
        if (
            leftValueType.kind === ValueTypeKind.BOOLEAN &&
            rightValueType.kind === ValueTypeKind.BOOLEAN
        ) {
            return FunctionalFuncs.operateI32I32(
                this.module,
                leftValueRef,
                rightValueRef,
                opKind,
            );
        }
        if (
            FunctionalFuncs.treatAsAny(leftValueType.kind) &&
            FunctionalFuncs.treatAsAny(rightValueType.kind)
        ) {
            /* any will be cast to real type when running, now only number is considered */
            return FunctionalFuncs.operateAnyAny(
                this.module,
                leftValueRef,
                rightValueRef,
                opKind,
            );
        }
        if (
            (leftValueType.kind === ValueTypeKind.STRING ||
                leftValueType.kind === ValueTypeKind.RAW_STRING) &&
            (rightValueType.kind === ValueTypeKind.STRING ||
                rightValueType.kind === ValueTypeKind.RAW_STRING)
        ) {
            return FunctionalFuncs.operateStringString(
                this.module,
                leftValueRef,
                rightValueRef,
                opKind,
            );
        }
        if (
            (leftValueType.kind === ValueTypeKind.NULL ||
                leftValueType.kind === ValueTypeKind.UNDEFINED) &&
            !FunctionalFuncs.treatAsAny(rightValueType.kind)
        ) {
            return FunctionalFuncs.operateStaticNullUndefined(
                this.module,
                leftValueType,
                leftValueRef,
                rightValueType.kind,
                opKind,
            );
        }
        if (
            (rightValueType.kind === ValueTypeKind.NULL ||
                rightValueType.kind === ValueTypeKind.UNDEFINED) &&
            !FunctionalFuncs.treatAsAny(leftValueType.kind)
        ) {
            return FunctionalFuncs.operateStaticNullUndefined(
                this.module,
                rightValueType,
                rightValueRef,
                leftValueType.kind,
                opKind,
            );
        }
        /** static any*/
        if (
            FunctionalFuncs.treatAsAny(leftValueType.kind) &&
            !FunctionalFuncs.treatAsAny(rightValueType.kind)
        ) {
            return FunctionalFuncs.operatorAnyStatic(
                this.module,
                leftValueRef,
                rightValueRef,
                rightValueType,
                opKind,
            );
        }
        /** static any*/
        if (
            !FunctionalFuncs.treatAsAny(leftValueType.kind) &&
            FunctionalFuncs.treatAsAny(rightValueType.kind)
        ) {
            return FunctionalFuncs.operatorAnyStatic(
                this.module,
                rightValueRef,
                leftValueRef,
                leftValueType,
                opKind,
            );
        }
        // iff array, class or interface
        if (
            (leftValueType.kind === ValueTypeKind.ARRAY &&
                rightValueType.kind === ValueTypeKind.ARRAY) ||
            (leftValueType instanceof ObjectType &&
                rightValueType instanceof ObjectType)
        ) {
            return FunctionalFuncs.operateRefRef(
                this.module,
                leftValueRef,
                leftValueType,
                rightValueRef,
                rightValueType,
                opKind,
            );
        }

        throw new Error(
            `unsupported operation between ${leftValueType} and ${rightValueType}`,
        );
    }

    private assignBinaryExpr(
        leftValue: SemanticsValue,
        rightValue: SemanticsValue,
    ): binaryen.ExpressionRef {
        if (leftValue instanceof VarValue) {
            return this.wasmSetValue(leftValue, rightValue);
        } else if (leftValue instanceof ShapeSetValue) {
            return this.wasmObjFieldSet(leftValue, rightValue);
        } else if (
            leftValue instanceof OffsetSetValue ||
            leftValue instanceof OffsetGetValue
        ) {
            return this.wasmObjFieldSet(leftValue, rightValue);
        } else {
            throw new UnimplementError(`assignBinaryExpr ${leftValue}`);
        }
    }

    private wasmUnaryExpr(
        value: PostUnaryExprValue | PrefixUnaryExprValue,
    ): binaryen.ExpressionRef {
        const opKind = value.opKind;
        switch (opKind) {
            case ts.SyntaxKind.PlusPlusToken:
            case ts.SyntaxKind.MinusMinusToken: {
                /* i++ ===> i += 1 */
                /* i-- ===> i -= 1 */
                const tmpOpKind = this.parseComplexOp(opKind);
                const tmpLiteralValue = new LiteralValue(Primitive.Number, 1);
                const tmpBinaryExprValue = new BinaryExprValue(
                    value.type,
                    tmpOpKind,
                    value.target,
                    tmpLiteralValue,
                );
                return this.wasmBinaryExpr(tmpBinaryExprValue);
            }
            case ts.SyntaxKind.MinusToken: {
                /* -8 ==> 0-8, -a ===> 0-a */
                const tmpOpKind = this.parseComplexOp(opKind);
                const tmpLiteralValue = new LiteralValue(Primitive.Number, 0);
                const tmpBinaryExprValue = new BinaryExprValue(
                    value.type,
                    tmpOpKind,
                    tmpLiteralValue,
                    value.target,
                );
                return this.wasmBinaryExpr(tmpBinaryExprValue);
            }
            default:
                throw new UnimplementError(`wasmUnaryExpr: ${opKind}`);
        }
    }

    private wasmPostUnaryExpr(
        value: PostUnaryExprValue,
    ): binaryen.ExpressionRef {
        const unaryOp = this.wasmUnaryExpr(value);
        const getValueOp = this.wasmExprGen(value.target);
        let getOriValueOp = binaryen.none;
        const opKind = value.opKind;
        switch (opKind) {
            case ts.SyntaxKind.PlusPlusToken: {
                getOriValueOp = this.module.f64.sub(
                    getValueOp,
                    this.module.f64.const(1),
                );
                break;
            }
            case ts.SyntaxKind.MinusMinusToken: {
                getOriValueOp = this.module.f64.add(
                    getValueOp,
                    this.module.f64.const(1),
                );
                break;
            }
        }
        return this.module.block(null, [unaryOp, getOriValueOp]);
    }

    private wasmPreUnaryExpr(
        value: PrefixUnaryExprValue,
    ): binaryen.ExpressionRef {
        const opKind = value.opKind;
        switch (opKind) {
            case ts.SyntaxKind.PlusPlusToken:
            case ts.SyntaxKind.MinusMinusToken: {
                const unaryOp = this.wasmUnaryExpr(value);
                const getValueOp = this.wasmExprGen(value.target);
                return this.module.block(
                    null,
                    [unaryOp, getValueOp],
                    binaryen.f64,
                );
            }
            case ts.SyntaxKind.ExclamationToken: {
                const operandValueRef = this.wasmExprGen(value.target);
                let result = FunctionalFuncs.generateCondition2(
                    this.module,
                    operandValueRef,
                    value.type.kind,
                );
                result = this.module.i32.eqz(result);
                if (value.type.kind === ValueTypeKind.NUMBER) {
                    /* Workaround: semantic tree treat result of !number
                        as number, so we convert it back to number */
                    result = this.module.f64.convert_u.i32(result);
                }
                return result;
            }
            case ts.SyntaxKind.MinusToken: {
                const operandValueRef = this.wasmExprGen(value.target);
                return this.module.f64.sub(
                    this.module.f64.const(0),
                    operandValueRef,
                );
            }
            case ts.SyntaxKind.PlusToken: {
                return this.wasmExprGen(value.target);
            }
            default:
                throw new UnimplementError('wasmPreUnaryExpr: ${opKind}');
        }
    }

    private wasmConditionalExpr(
        value: ConditionExprValue,
    ): binaryen.ExpressionRef {
        let condValueRef = this.wasmExprGen(value.condition);
        /* convert to condition */
        condValueRef = FunctionalFuncs.generateCondition(
            this.module,
            condValueRef,
        );
        const trueValueRef = this.wasmExprGen(value.trueExpr);
        const falseValueRef = this.wasmExprGen(value.falseExpr);
        assert(
            value.trueExpr.type.equals(value.falseExpr.type),
            // TODO: to check why the type returned by binaryen is not equal
            // binaryen.getExpressionType(trueValueRef) ===
            //     binaryen.getExpressionType(falseValueRef),
            'trueWASMExprType and falseWASMExprType are not equal in conditional expression ',
        );
        return this.module.select(condValueRef, trueValueRef, falseValueRef);
    }

    private wasmInstanceOf(
        leftValue: SemanticsValue,
        rightValue: SemanticsValue,
    ) {
        const leftValueType = leftValue.type;
        const rightValueType = rightValue.type;
        if (!(rightValueType instanceof ObjectType)) {
            // Only support instanceof right-side is an ObjectType
            throw new Error('wasmInstanceOf: rightValue is not ObjectType');
        }
        if (!rightValueType.instanceType) {
            throw new Error(
                'wasmInstanceOf: rightValue does not have ObjectType',
            );
        }
        const rightValueInstType = (rightValueType as ObjectType).instanceType!;
        /** try to determine the result in compile time */
        if (leftValueType instanceof ObjectType) {
            let type: ObjectType | undefined = leftValueType;
            while (type) {
                if (type.equals(rightValueInstType)) {
                    return this.module.i32.const(1);
                }
                type = type.super;
            }
        }
        /** if left-side is object, the instanceof relationship must be determined in the compile time */
        if (
            leftValueType instanceof ObjectType &&
            !leftValueType.meta.isInterface &&
            !rightValueType.meta.isInterface
        ) {
            return this.module.i32.const(0);
        }
        /** try to determine the result in runtime */

        const leftValueRef = this.wasmExprGen(leftValue);
        /** create a default inst of  rightValueInstType */
        let rightWasmHeapType =
            this.wasmTypeGen.getWASMHeapType(rightValueInstType);
        if (
            rightValueInstType.meta.name.includes(
                BuiltinNames.OBJECTCONSTRUCTOR,
            )
        ) {
            rightWasmHeapType = emptyStructType.heapTypeRef;
        }
        if (
            rightValueInstType.meta.name.includes(
                BuiltinNames.FUNCTIONCONSTRCTOR,
            )
        ) {
            rightWasmHeapType = builtinFunctionType.heapTypeRef;
        }
        const defaultRightValue = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([]).ptr,
            0,
            rightWasmHeapType,
        );
        const res = this.module.call(
            dyntype.dyntype_instanceof,
            [
                FunctionalFuncs.getDynContextRef(this.module),
                FunctionalFuncs.boxToAny(this.module, leftValueRef, leftValue),
                defaultRightValue,
            ],
            binaryen.i32,
        );
        return res;
    }

    private callClosureInternal(
        closureRef: binaryen.ExpressionRef,
        funcType: FunctionType,
        args?: SemanticsValue[],
    ) {
        const closureVarTypeRef = binaryen.getExpressionType(closureRef);
        const context = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            0,
            closureRef,
            closureVarTypeRef,
            false,
        );
        const funcRef = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            1,
            closureRef,
            closureVarTypeRef,
            false,
        );
        return this.callFuncRef(funcType, funcRef, args, undefined, context);
    }

    private callBuiltinOrStaticMethod(
        member: MemberDescription,
        target: string,
        args?: SemanticsValue[],
        isBuiltin = false,
    ) {
        let methodName = `${target}|${member.name}`;
        if (isBuiltin) {
            methodName = UtilFuncs.getFuncName(
                BuiltinNames.builtinModuleName,
                methodName,
            );
        }
        const methodType = member.valueType as FunctionType;
        const returnTypeRef = this.wasmTypeGen.getWASMValueType(
            methodType.returnType,
        );
        const thisArg = binaryenCAPI._BinaryenRefNull(
            this.module.ptr,
            emptyStructType.typeRef,
        );
        return this.callFunc(
            methodType,
            methodName,
            returnTypeRef,
            args,
            undefined,
            undefined,
            isBuiltin ? thisArg : undefined,
        );
    }

    private wasmOffsetCall(value: OffsetCallValue) {
        /* Array.xx, console.log */
        const ownerType = value.owner.type as ObjectType;
        const meta = ownerType.meta;
        let isBuiltIn = true;
        const memberIdx = value.index;
        const member = meta.members[memberIdx];
        let target = meta.name;

        /* meta's name is the interface name, it various from the global name */
        if (target.includes('ArrayConstructor')) {
            target = 'Array';
        } else if (target.includes('Console')) {
            target = 'console';
        } else if (target.includes('Math')) {
            target = 'Math';
        } else {
            if (member.isStaic) {
                /* Class static method */
                if (member.isOwn) {
                    target = (value.owner as VarValue).index as string;
                } else {
                    let baseMeta = meta.base;

                    while (baseMeta) {
                        const member = baseMeta.members[memberIdx];
                        if (member.isOwn) {
                            target = baseMeta.name.slice(1);
                            break;
                        }

                        baseMeta = baseMeta.base;
                    }

                    if (!baseMeta) {
                        throw Error(
                            `Can not find static field ${member.name} in inherit chain of ${meta.name}}`,
                        );
                    }
                }
            } else {
                return this.getInfcMember(
                    member,
                    value.owner.type,
                    this.wasmExprGen(value.owner),
                    memberIdx,
                    true,
                    value.parameters,
                );
            }
            isBuiltIn = false;
        }

        return this.callBuiltinOrStaticMethod(
            member,
            target,
            value.parameters,
            isBuiltIn,
        );
    }

    private wasmDirectCall(value: DirectCallValue) {
        const owner = value.owner as VarValue;
        const meta = owner.shape!.meta;
        const method = (value.method as VarValue).ref as FunctionDeclareNode;
        const returnTypeRef = this.wasmTypeGen.getWASMValueType(value.type);
        const member = meta.findMember(
            UtilFuncs.getLastElemOfBuiltinName(method.name),
        )!;
        const methodIdx = this.getTruthIdx(meta, member);
        let thisArg = this.wasmExprGen(owner);
        let ownerTypeRef = this.wasmTypeGen.getWASMValueType(owner.type);

        if ((owner.type as ObjectType).meta.isInterface) {
            /* This is a resolved interface access, "this" should be the object hold by the interface */
            thisArg = this.getInfcInstInfo(
                thisArg,
                infcTypeInfo.typeRef,
                InfcFieldIndex.DATA_INDEX,
            );
            /* workaround: need to get the actual typeRef based on owner.shape */
            ownerTypeRef = this.wasmTypeGen.objTypeMap.get(meta.name)!;
            thisArg = binaryenCAPI._BinaryenRefCast(
                this.module.ptr,
                thisArg,
                ownerTypeRef,
            );
        }

        if (owner.kind === SemanticsValueKind.SUPER) {
            return this.callFunc(
                method.funcType as FunctionType,
                method.name,
                returnTypeRef,
                value.parameters,
                method,
                undefined,
                thisArg,
            );
        } else {
            const methodRef = this.getObjMethod(
                thisArg,
                methodIdx,
                ownerTypeRef,
            );
            return this.callFuncRef(
                method.funcType as FunctionType,
                methodRef,
                value.parameters,
                thisArg,
                undefined,
                method,
            );
        }
    }

    private wasmFunctionCall(value: FunctionCallValue): binaryen.ExpressionRef {
        if (value.func instanceof FunctionCallValue) {
            /* Callee is returned from another function (closure) */
            const closureRef = this.wasmExprGen(value.func);
            const funcType = value.funcType as FunctionType;

            return this.callClosureInternal(
                closureRef,
                funcType,
                value.parameters,
            );
        }
        const funcType = value.funcType as FunctionType;
        const returnTypeRef = this.wasmTypeGen.getWASMValueType(
            funcType.returnType,
        );
        const funcValue = value.func;
        const args = value.parameters;
        if (funcValue instanceof VarValue) {
            /* In function call, ref only can be FunctionDeclareNode */
            const funcNode = funcValue.ref as FunctionDeclareNode;
            return this.callFunc(
                funcType,
                funcNode.name,
                returnTypeRef,
                args,
                funcNode,
            );
        } else {
            const closureRef = this.wasmExprGen(funcValue);
            return this.callClosureInternal(closureRef, funcType, args);
        }
    }

    private wasmClosureCall(value: ClosureCallValue): binaryen.ExpressionRef {
        const funcType = value.funcType as FunctionType;
        const closureRef = this.wasmExprGen(value.func as VarValue);
        return this.callClosureInternal(closureRef, funcType, value.parameters);
    }

    private callClassMethod(
        methodType: FunctionType,
        realReturnType: ValueType,
        calledName: string,
        thisRef: binaryen.ExpressionRef,
        valueType: ValueType,
        args?: SemanticsValue[],
    ): binaryen.ExpressionRef {
        if (BuiltinNames.genericBuiltinMethods.includes(calledName)) {
            if (valueType instanceof ArrayType) {
                const methodSuffix =
                    this.wasmTypeGen.getObjSpecialSuffix(valueType);
                calledName = calledName.concat(methodSuffix);
            } else {
                throw new Error(
                    'Generic builtin method only support array type',
                );
            }

            /* Workaround: semantic tree may forget to specialize some
                method type, we specialize it here
                let a : number[] = []; a.push(10);
            */
            for (let i = 0; i < methodType.argumentsType.length; i++) {
                const argType = methodType.argumentsType[i];
                if (
                    argType instanceof ArrayType &&
                    argType.element.kind === ValueTypeKind.TYPE_PARAMETER
                ) {
                    argType.setSpecialTypeArguments([valueType.element]);
                }
            }
        }

        const returnTypeRef = this.wasmTypeGen.getWASMValueType(
            methodType.returnType,
        );

        let res = this.callFunc(
            methodType,
            calledName,
            returnTypeRef,
            args,
            undefined,
            undefined,
            thisRef,
        );

        if (valueType instanceof ArrayType) {
            /* methodCallResultRef's type may not match the real return type
             * if real return type is not primitive type, we should do cast.
             */
            if (this.wasmTypeGen.hasHeapType(realReturnType)) {
                res = binaryenCAPI._BinaryenRefCast(
                    this.module.ptr,
                    res,
                    this.wasmTypeGen.getWASMValueType(realReturnType),
                );
            }
        }
        return res;
    }

    private callClassStaticMethod(
        ownValue: ObjectType,
        methodName: string,
        args?: SemanticsValue[],
    ) {
        const foundMember = this.getMemberByName(ownValue.meta, methodName);
        const methodMangledName = this.wasmCompiler.getMethodMangledName(
            foundMember,
            ownValue.meta,
        );
        // workaround: reason
        /* Currently, value.funcType is different with member type */
        const funcType = foundMember.valueType as FunctionType;
        /* get return type */
        const returnTypeRef = this.wasmTypeGen.getWASMValueType(
            funcType.returnType,
        );
        return this.callFunc(funcType, methodMangledName, returnTypeRef, args);
    }

    private wasmAnyCall(value: AnyCallValue) {
        /* any function call */
        const anyFuncRef = this.wasmExprGen(value.anyFunc);
        const oriFuncRefWithAnyType = FunctionalFuncs.unboxAny(
            this.module,
            anyFuncRef,
            ValueTypeKind.FUNCTION,
            binaryen.anyref,
        );
        const argStruct = this.generateArgStruct(value.parameters);
        return this.module.call(
            dyntype.invoke_func,
            [
                FunctionalFuncs.getDynContextRef(this.module),
                oriFuncRefWithAnyType,
                argStruct,
            ],
            binaryen.anyref,
        );
    }

    private wasmVtableCall(value: VTableCallValue) {
        const owner = value.owner;
        const meta = owner.shape!.meta;
        const member = meta.members[value.index];
        const methodIdx = this.getTruthIdx(meta, member);
        const ownerRef = this.wasmExprGen(owner);
        const ownerTypeRef = this.wasmTypeGen.getWASMValueType(owner.type);
        switch (owner.type.kind) {
            case ValueTypeKind.OBJECT: {
                const methodRef = this.getObjMethod(
                    ownerRef,
                    methodIdx,
                    ownerTypeRef,
                );
                return this.callFuncRef(
                    value.funcType,
                    methodRef,
                    value.parameters,
                    ownerRef,
                );
            }
            default: {
                /* workaround: arr.push is vtableCall */
                const calledName = `${BuiltinNames.builtinModuleName}|${meta.name}|${member.name}`;
                /* workaround: method.valueType.returnType various from value.funcType.returnType */
                const realReturnType = value.funcType.returnType;
                return this.callClassMethod(
                    member.valueType as FunctionType,
                    realReturnType,
                    calledName,
                    ownerRef,
                    owner.type,
                    value.parameters,
                );
            }
        }
    }

    private wasmDynamicCall(value: DynamicCallValue): binaryen.ExpressionRef {
        const methodName = value.name;
        const owner = value.owner;
        switch (owner.type.kind) {
            case ValueTypeKind.ANY: {
                /* Fallback to libdyntype */
                let invokeArgs = [owner];
                if (value.parameters) {
                    invokeArgs = invokeArgs.concat(value.parameters);
                }
                return this.dyntypeInvoke(methodName, invokeArgs);
            }
            case ValueTypeKind.OBJECT: {
                /*  workaround: call static method has been changed to shapeCall */
                return this.callClassStaticMethod(
                    (owner as VarValue).ref as ObjectType,
                    methodName,
                    value.parameters,
                );
            }
            case ValueTypeKind.ARRAY:
            case ValueTypeKind.FUNCTION:
            case ValueTypeKind.BOOLEAN:
            case ValueTypeKind.NUMBER:
            case ValueTypeKind.STRING: {
                const className = 'String';
                // workaround: reason
                /* currently builtInMeta's members will be empty in semantic tree, which should not */
                /* workaround: builtin may be get meta by owner.shape!.meta! later */
                const builtInMeta = GetBuiltinObjectType(className).meta;
                const foundMember = this.getMemberByName(
                    builtInMeta,
                    methodName,
                );
                const methodType = foundMember.valueType as FunctionType;
                const thisRef = this.wasmExprGen(owner);
                const calledName = `${BuiltinNames.builtinModuleName}|${className}|${methodName}`;
                return this.callClassMethod(
                    methodType,
                    methodType.returnType,
                    calledName,
                    thisRef,
                    owner.type,
                    value.parameters,
                );
            }
            default:
                throw Error(`unimplement wasmDynamicCall in : ${value}`);
        }
    }

    private wasmShapeCall(value: ShapeCallValue): binaryen.ExpressionRef {
        /* When specialized (such as Array):
         * the original unspecialized type is stored in shape, and the specific specialized type is stored in type
         */
        const owner = value.owner as VarValue;
        const meta = owner.shape!.meta!;
        const member = meta.members[value.index];
        const args = value.parameters;
        let target = meta.name;
        let isBuiltin = false;

        /* Workaround: should use meta.isBuiltin, but currently only class defined
            inside src/semantics/builtin.ts will be marked as builtin. After that
            issue fixed, we should modify the code here */
        if (target.includes('Console')) {
            target = 'console';
            isBuiltin = true;
        } else if (target.includes('Math')) {
            target = 'Math';
            isBuiltin = true;
        }

        if (isBuiltin) {
            return this.callBuiltinOrStaticMethod(
                member,
                target,
                value.parameters,
                true,
            );
        }

        switch (owner.type.kind) {
            case ValueTypeKind.OBJECT: {
                if (owner.ref instanceof ObjectType) {
                    const objDescriptionName = owner.ref.meta.name;
                    /* workaround: console.log */
                    if (
                        objDescriptionName.includes(
                            BuiltinNames.builtinModuleName,
                        )
                    ) {
                        const classMangledName = owner.index as string;
                        const methodName = UtilFuncs.getFuncName(
                            classMangledName,
                            member.name,
                        );
                        const methodType = member.valueType as FunctionType;
                        const returnTypeRef = this.wasmTypeGen.getWASMType(
                            methodType.returnType,
                        );
                        return this.callFunc(
                            methodType,
                            methodName,
                            returnTypeRef,
                            value.parameters,
                        );
                    } else {
                        return this.callClassStaticMethod(
                            owner.ref,
                            member.name,
                            value.parameters,
                        );
                    }
                } else {
                    const ownerType = owner.type as ObjectType;
                    const typeMeta = ownerType.meta;
                    const thisRef = this.wasmExprGen(owner);
                    return this.getInstMember(
                        thisRef,
                        ownerType,
                        typeMeta,
                        member,
                        true,
                        args,
                    );
                }
            }
            case ValueTypeKind.ARRAY: {
                // workaround:
                /* Array type can be specialized, so we should get the type meta */
                const typeMeta = (owner.type as ArrayType).meta;
                const member = typeMeta.members[value.index];
                const thisRef = this.wasmExprGen(owner);
                /* array builtin method call */
                let methodName = member.name;
                for (const builtinMethod of BuiltinNames.genericBuiltinMethods) {
                    if (builtinMethod.includes(member.name)) {
                        methodName = builtinMethod;
                        break;
                    }
                }
                const methodSuffix = this.wasmTypeGen.getObjSpecialSuffix(
                    owner.type as ArrayType,
                );
                methodName = methodName.concat(methodSuffix);
                const memberFuncType = member.valueType as FunctionType;
                const returnTypeRef = this.wasmTypeGen.getWASMValueType(
                    memberFuncType.returnType,
                );
                const methodCallResultRef = this.callFunc(
                    memberFuncType,
                    methodName,
                    returnTypeRef,
                    args,
                    undefined,
                    undefined,
                    thisRef,
                );
                /* methodCallResultRef's type may not match the real return type
                 * if real return type is not primitive type, we should do cast.
                 */
                let res = methodCallResultRef;
                if (this.wasmTypeGen.hasHeapType(memberFuncType.returnType)) {
                    res = binaryenCAPI._BinaryenRefCast(
                        this.module.ptr,
                        methodCallResultRef,
                        returnTypeRef,
                    );
                }
                return res;
            }
            case ValueTypeKind.STRING: {
                /* workaround: meta is undefined*/
                const className = 'String';
                const methodType = member.valueType as FunctionType;
                const thisRef = this.wasmExprGen(owner);
                const calledName = `${BuiltinNames.builtinModuleName}|${className}|${member.name}`;
                return this.callClassMethod(
                    methodType,
                    methodType.returnType,
                    calledName,
                    thisRef,
                    owner.type,
                    value.parameters,
                );
            }
            default: {
                throw Error(`TODO: ${value.type.kind}`);
            }
        }
    }

    private wasmAnyCast(value: CastValue): binaryen.ExpressionRef {
        const fromValue = value.value;
        const fromValueRef = this.wasmExprGen(fromValue);
        const fromType = fromValue.type;
        const toType = value.type;
        switch (value.kind) {
            case SemanticsValueKind.ANY_CAST_VALUE:
            case SemanticsValueKind.UNION_CAST_VALUE: {
                return FunctionalFuncs.unboxAnyToBase(
                    this.module,
                    fromValueRef,
                    toType.kind,
                );
            }
            case SemanticsValueKind.VALUE_CAST_ANY:
            case SemanticsValueKind.UNION_CAST_ANY:
            case SemanticsValueKind.VALUE_CAST_UNION: {
                return FunctionalFuncs.boxToAny(
                    this.module,
                    fromValueRef,
                    fromValue,
                );
            }
            case SemanticsValueKind.OBJECT_CAST_ANY: {
                return this.wasmObjTypeCastToAny(value);
            }
            case SemanticsValueKind.ANY_CAST_OBJECT:
            case SemanticsValueKind.UNION_CAST_OBJECT: {
                const toTypeRef = this.wasmTypeGen.getWASMValueType(toType);
                return FunctionalFuncs.unboxAnyToExtref(
                    this.module,
                    fromValueRef,
                    toTypeRef,
                );
            }
            case SemanticsValueKind.OBJECT_CAST_VALUE: {
                if (toType.kind === ValueTypeKind.NULL) {
                    /* Sometimes the function may be inferred to return a null, e.g.:
                        function foo() {
                            const a: A | null = null;
                            return a;
                        }
                    */
                    return this.module.ref.null(
                        this.wasmTypeGen.getWASMType(fromType),
                    );
                } else {
                    throw new UnimplementError(
                        `OBJECT_CAST_VALUE from ${fromType} to ${toType}`,
                    );
                }
            }
            case SemanticsValueKind.OBJECT_CAST_UNION: {
                return FunctionalFuncs.boxToAny(
                    this.module,
                    fromValueRef,
                    fromValue,
                );
            }
            default:
                throw new UnimplementError(`wasmCastValue: ${value}`);
        }
    }

    private wasmValueCast(value: CastValue) {
        const fromType = value.value.type;
        const fromValueRef = this.wasmExprGen(value.value);
        const fromTypeRef = this.wasmTypeGen.getWASMType(fromType);
        const toType = value.type;
        const toTypeRef = this.wasmTypeGen.getWASMType(toType);
        if (fromType.kind === ValueTypeKind.INT) {
            if (toType.kind === ValueTypeKind.NUMBER) {
                return FunctionalFuncs.convertTypeToF64(
                    this.module,
                    fromValueRef,
                    fromTypeRef,
                );
            }
        } else if (fromType.kind === ValueTypeKind.BOOLEAN) {
            if (toType.kind === ValueTypeKind.NUMBER) {
                return FunctionalFuncs.convertTypeToF64(
                    this.module,
                    fromValueRef,
                    binaryen.i32,
                );
            }
        } else if (toType.kind === ValueTypeKind.BOOLEAN) {
            return FunctionalFuncs.generateCondition2(
                this.module,
                fromValueRef,
                fromType.kind,
            );
        }
        throw new UnimplementError(`wasmValueCast: ${value}`);
    }

    private parseArguments(
        funcType: FunctionType,
        envArgs: binaryen.ExpressionRef[],
        args?: SemanticsValue[],
        funcNode?: FunctionDeclareNode,
    ) {
        assert(
            funcType.envParamLen === envArgs.length,
            `funcType.envParamLen is ${funcType.envParamLen}, real envArgsLen is ${envArgs.length}`,
        );
        const envArgLen = envArgs.length;
        const paramTypes = funcType.argumentsType;
        const callerArgs: binaryen.ExpressionRef[] = new Array(
            paramTypes.length + envArgLen,
        );
        /* parse @context and @this */
        for (let i = 0; i < envArgLen; i++) {
            callerArgs[i] = envArgs[i];
        }

        /* parse optional param as undefined */
        for (let i = 0; i < paramTypes.length; i++) {
            if (funcType.isOptionalParams[i]) {
                callerArgs[i + envArgLen] =
                    FunctionalFuncs.generateDynUndefined(this.module);
            }
        }

        /* parse default params */
        if (funcNode && funcNode.parameters) {
            for (let i = 0; i < funcNode.parameters.length; i++) {
                const defaultParam = funcNode.parameters[i];
                if (defaultParam.initValue) {
                    const initValue = defaultParam.initValue;
                    let defaultArg = this.wasmExprGen(defaultParam.initValue);
                    if (
                        defaultParam.type.kind === ValueTypeKind.ANY &&
                        initValue.type.kind !== ValueTypeKind.ANY
                    ) {
                        /* Workaround: for default parameters (e.g. b: any = 8), the type of
                            the initValue is treated as a number and not casted to any, which
                            will make the generated wasm module contained mismatched types */
                        defaultArg = FunctionalFuncs.boxToAny(
                            this.module,
                            defaultArg,
                            initValue,
                        );
                    }

                    callerArgs[i + envArgLen] = defaultArg;
                }
            }
        }

        if (!args) {
            return callerArgs;
        }

        /* parse regular args, real args don't contain @context and @this */
        for (let i = 0; i < args.length; i++) {
            if (funcType.restParamIdx === i) {
                break;
            }
            callerArgs[i + envArgLen] = this.wasmExprGen(args[i]);
        }

        /* parse rest params */
        if (funcType.restParamIdx !== -1) {
            const restType = paramTypes[funcType.restParamIdx];
            if (restType instanceof ArrayType) {
                if (args.length > funcType.restParamIdx) {
                    callerArgs[funcType.restParamIdx + envArgLen] =
                        this.initArray(
                            restType,
                            args.slice(funcType.restParamIdx),
                        );
                } else {
                    callerArgs[funcType.restParamIdx + envArgLen] =
                        this.initArray(restType, []);
                }
            } else {
                Logger.error(`rest type is not array`);
            }
        }
        return callerArgs;
    }

    private initArray(arrType: ArrayType, elements: SemanticsValue[]) {
        const arrayLen = elements.length;
        const array = [];
        if (elements.length === 0) {
            return binaryenCAPI._BinaryenRefNull(
                this.module.ptr,
                binaryenCAPI._BinaryenTypeArrayref(),
            );
        }
        for (let i = 0; i < arrayLen; i++) {
            const elemExpr = elements[i];
            const elemExprRef: binaryen.ExpressionRef =
                this.wasmExprGen(elemExpr);
            array.push(elemExprRef);
        }
        const arrayWasmType = this.wasmTypeGen.getWASMArrayOriType(arrType);
        const arrayHeapType = this.wasmTypeGen.getWASMArrayOriHeapType(arrType);
        const arrayStructTypeInfo = generateArrayStructTypeInfo({
            typeRef: arrayWasmType,
            heapTypeRef: arrayHeapType,
        });
        const arrayValue = binaryenCAPI._BinaryenArrayNewFixed(
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

    /* Currently we don't believe the index provided by semantic tree, semantic
        tree treat all method/accessors as instance field, but in binaryen
        backend we put all these into vtable, so every getter/setter pair will
        occupies two vtable slots */
    private fixVtableIndex(
        meta: ObjectDescription,
        member: MemberDescription,
        isSetter = false,
    ) {
        const members = meta.members;
        const bound = members.findIndex((m) => m.name === member.name);
        let index = bound;
        if (index < 0) {
            throw new Error(
                `get field index failed, field name is ${member.name}`,
            );
        }
        for (let i = 0; i < bound; i++) {
            if (members[i].type === MemberType.FIELD) {
                index--;
            }
            /** it occupies two slots */
            if (members[i].hasGetter && members[i].hasSetter) {
                index++;
            }
        }

        if (isSetter && member.hasGetter) {
            index++;
        }

        return index;
    }

    private fixFieldIndex(
        meta: ObjectDescription,
        member: MemberDescription,
        isStatic = false,
    ) {
        const members = meta.members;
        const bound = members.findIndex((m) => m.name === member.name);
        let index = 0;

        for (let i = 0; i < bound; i++) {
            if (members[i].type === MemberType.FIELD) {
                if (isStatic) {
                    if (members[i].isStaic) {
                        index++;
                    }
                } else {
                    if (!members[i].isStaic) {
                        index++;
                    }
                }
            }
        }
        return index;
    }

    private setObjField(
        objRef: binaryen.ExpressionRef,
        fieldIdx: number,
        targetValueRef: binaryen.ExpressionRef,
    ) {
        return binaryenCAPI._BinaryenStructSet(
            this.module.ptr,
            fieldIdx + 1,
            objRef,
            targetValueRef,
        );
    }

    private getObjField(
        objRef: binaryen.ExpressionRef,
        fieldIdx: number,
        objTypeRef: binaryen.Type,
    ) {
        return binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            fieldIdx + 1,
            objRef,
            objTypeRef,
            false,
        );
    }

    private getObjMethod(
        objRef: binaryen.ExpressionRef,
        methodIdx: number,
        objTypeRef: binaryen.Type,
    ) {
        const vtableRef = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            0,
            objRef,
            objTypeRef,
            false,
        );
        return binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            methodIdx,
            vtableRef,
            binaryen.getExpressionType(vtableRef),
            false,
        );
    }

    private callFuncRef(
        funcType: ValueType,
        targetFunction: binaryen.ExpressionRef,
        args?: SemanticsValue[],
        objRef?: binaryen.ExpressionRef,
        context?: binaryen.ExpressionRef,
        funcDecl?: FunctionDeclareNode,
    ) {
        const funcTypeRef = this.wasmTypeGen.getWASMValueType(
            (funcType as FunctionType).returnType,
        );
        if (!context) {
            context = binaryenCAPI._BinaryenRefNull(
                this.module.ptr,
                emptyStructType.typeRef,
            );
        }
        const envArgs: binaryen.ExpressionRef[] = [context];
        if (objRef) {
            envArgs.push(objRef);
        }
        const callArgsRefs = this.parseArguments(
            funcType as FunctionType,
            envArgs,
            args,
            funcDecl,
        );

        return binaryenCAPI._BinaryenCallRef(
            this.module.ptr,
            targetFunction,
            arrayToPtr(callArgsRefs).ptr,
            callArgsRefs.length,
            funcTypeRef,
            false,
        );
    }

    private callFunc(
        funcType: FunctionType,
        funcName: string,
        returnType: binaryen.Type,
        args?: SemanticsValue[],
        funcDecl?: FunctionDeclareNode,
        context?: binaryen.ExpressionRef,
        thisArg?: binaryen.ExpressionRef,
    ) {
        if (!context) {
            context = binaryenCAPI._BinaryenRefNull(
                this.module.ptr,
                emptyStructType.typeRef,
            );
        }
        const envArgs: binaryen.ExpressionRef[] = [context];
        if (thisArg) {
            envArgs.push(thisArg);
        }
        const callArgsRefs = this.parseArguments(
            funcType,
            envArgs,
            args,
            funcDecl,
        );
        let specializedFuncName = funcName;
        /* If a function is a generic function, we need to generate a specialized type function here */
        if (funcDecl && funcDecl.funcType.typeArguments) {
            /* record the original information */
            const oriFuncType = funcDecl.funcType;
            const oriFuncCtx = this.wasmCompiler.currentFuncCtx;
            const oriFuncParams = funcDecl.parameters;
            const oriFuncVars = funcDecl.varList;
            /* change typeArgument to the specialize version */
            funcDecl.funcType = funcType;
            if (!funcType.specialTypeArguments) {
                throw new Error('not recorded the specialized type yet');
            }
            let specializedSuffix = '';
            for (const specializedTypeArg of funcType.specialTypeArguments!) {
                specializedSuffix = specializedSuffix.concat(
                    '_',
                    specializedTypeArg.typeId.toString(),
                );
            }
            specializedFuncName = funcName.concat(specializedSuffix);
            funcDecl.name = specializedFuncName;
            if (funcDecl.parameters) {
                for (const p of funcDecl.parameters) {
                    if (
                        p.type instanceof TypeParameterType ||
                        p.type instanceof ValueTypeWithArguments
                    ) {
                        this.specializeType(p.type, funcType);
                    }
                }
            }
            if (funcDecl.varList) {
                for (const v of funcDecl.varList) {
                    if (
                        v.type instanceof TypeParameterType ||
                        v.type instanceof ValueTypeWithArguments
                    ) {
                        this.specializeType(v.type, funcType);
                    }
                }
            }

            this.wasmCompiler.parseFunc(funcDecl);
            /* restore the information */
            this.wasmCompiler.currentFuncCtx = oriFuncCtx;
            funcDecl.name = funcName;
            funcDecl.funcType = oriFuncType;
            funcDecl.parameters = oriFuncParams;
            funcDecl.varList = oriFuncVars;
        }
        return this.module.call(specializedFuncName, callArgsRefs, returnType);
    }

    private specializeType(
        type: TypeParameterType | ValueTypeWithArguments,
        root: ValueTypeWithArguments,
    ) {
        if (type instanceof TypeParameterType) {
            const specialType = root.getSpecialTypeArg(type)!;
            type.setSpecialTypeArgument(specialType);
        } else {
            const specTypeArgs = root.getSpecialTypeArgs(type.typeArguments!);
            type.setSpecialTypeArguments(specTypeArgs);
        }
    }

    private wasmObjFieldSet(
        value: ShapeSetValue | OffsetSetValue,
        rightValue?: SemanticsValue,
    ) {
        const owner = value.owner as VarValue;
        const meta = owner.shape!.meta;
        const member = meta.members[value.index];
        const ownerType = owner.type as ObjectType;
        let targetValue = value.value!;
        if (rightValue) {
            targetValue = rightValue;
        }
        const typeMeta = ownerType.meta;
        return this.setInstField(
            this.wasmExprGen(owner),
            targetValue,
            ownerType,
            typeMeta,
            member,
        );
    }

    private setInstField(
        thisRef: binaryen.ExpressionRef,
        targetValue: SemanticsValue,
        ownerType: ObjectType,
        meta: ObjectDescription,
        member: MemberDescription,
    ) {
        const thisTypeRef = this.wasmTypeGen.getWASMType(ownerType);
        const valueIdx = this.getTruthIdx(meta, member, member.hasSetter);
        if (meta.isInterface) {
            return this.setInfcFieldWithSetter(
                member,
                ownerType,
                thisRef,
                valueIdx,
                targetValue,
            );
        } else {
            return this.setObjFieldWithSetter(
                member,
                thisRef,
                thisTypeRef,
                valueIdx,
                targetValue,
            );
        }
    }

    private setInfcFieldWithSetter(
        member: MemberDescription,
        infcType: ValueType,
        thisRef: binaryen.ExpressionRef,
        fieldIdx: number,
        targetValue: SemanticsValue,
    ) {
        let res: binaryen.ExpressionRef;
        let objRef: binaryen.ExpressionRef;
        const targetValueRef = this.wasmExprGen(targetValue);
        if (!member.hasSetter) {
            /* assign target value to infc instance, invoke dynSetInfcField */
            res = this.getOriObjInfoByFindIdx(
                thisRef,
                infcType,
                member.name,
                member.valueType,
                member.type,
                false,
                true,
                fieldIdx,
                targetValueRef,
            )[1];
        } else {
            /* assign target value using setter, call setter */
            const setterType = (member.setter as VarValue).type;
            [objRef, res] = this.getOriObjInfoByFindIdx(
                thisRef,
                infcType,
                member.name,
                setterType,
                member.type,
                true,
                false,
                fieldIdx,
            );
            const oriObjAnyRef = this.getInfcInstInfo(
                thisRef,
                infcTypeInfo.typeRef,
                InfcFieldIndex.DATA_INDEX,
            );
            const castedObjRef = binaryenCAPI._BinaryenRefCast(
                this.module.ptr,
                oriObjAnyRef,
                emptyStructType.typeRef,
            );
            res = this.callFuncRef(
                setterType,
                res,
                [targetValue],
                castedObjRef,
            );
        }
        return res;
    }

    private setObjFieldWithSetter(
        member: MemberDescription,
        thisRef: binaryen.ExpressionRef,
        thisTypeRef: binaryen.Type,
        fieldIdx: number,
        targetValue: SemanticsValue,
    ) {
        let res: binaryen.ExpressionRef;
        let targetFuncRef: binaryen.ExpressionRef;
        const targetValueRef = this.wasmExprGen(targetValue);
        if (!member.hasSetter) {
            res = this.setObjField(thisRef, fieldIdx, targetValueRef);
        } else {
            const setterType = (member.setter as VarValue).type;
            targetFuncRef = this.getObjMethod(thisRef, fieldIdx, thisTypeRef);
            res = this.callFuncRef(
                setterType,
                targetFuncRef,
                [targetValue],
                thisRef,
            );
        }
        return res;
    }

    private getInstMember(
        thisRef: binaryen.ExpressionRef,
        ownerType: ObjectType,
        meta: ObjectDescription,
        member: MemberDescription,
        isCall = false,
        args?: SemanticsValue[],
    ) {
        const thisTypeRef = this.wasmTypeGen.getWASMType(ownerType);
        const valueIdx = this.getTruthIdx(meta, member);
        if (meta.isInterface) {
            return this.getInfcMember(
                member,
                ownerType,
                thisRef,
                valueIdx,
                isCall,
                args,
            );
        } else {
            return this.getObjMember(
                member,
                thisRef,
                thisTypeRef,
                valueIdx,
                isCall,
                args,
            );
        }
    }

    private getInfcMember(
        member: MemberDescription,
        infcType: ValueType,
        thisRef: binaryen.ExpressionRef,
        memberIdx: number,
        isCall = false,
        args?: SemanticsValue[],
    ) {
        let res: binaryen.ExpressionRef;
        let objRef: binaryen.ExpressionRef;
        if (member.type === MemberType.FIELD) {
            /* get target value from infc instance, invoke dynGetInfcField */
            res = this.getOriObjInfoByFindIdx(
                thisRef,
                infcType,
                member.name,
                member.valueType,
                member.type,
                false,
                false,
                memberIdx,
            )[1];
        } else {
            const memberValueType = member.hasGetter
                ? (member.getter as VarValue).type
                : member.valueType;
            [objRef, res] = this.getOriObjInfoByFindIdx(
                thisRef,
                infcType,
                member.name,
                memberValueType,
                member.type,
                true,
                false,
                memberIdx,
            );
            if (
                member.type === MemberType.ACCESSOR ||
                (member.type === MemberType.METHOD && isCall)
            ) {
                const oriObjAnyRef = this.getInfcInstInfo(
                    thisRef,
                    infcTypeInfo.typeRef,
                    InfcFieldIndex.DATA_INDEX,
                );
                const memberFuncType = memberValueType as FunctionType;
                const castedObjRef = binaryenCAPI._BinaryenRefCast(
                    this.module.ptr,
                    oriObjAnyRef,
                    emptyStructType.typeRef,
                );
                res = this.callFuncRef(memberFuncType, res, args, castedObjRef);
            }
        }
        return res;
    }

    private getObjMember(
        member: MemberDescription,
        thisRef: binaryen.ExpressionRef,
        thisTypeRef: binaryen.Type,
        memberIdx: number,
        isCall = false,
        args?: SemanticsValue[],
    ) {
        let res: binaryen.ExpressionRef;
        if (member.type === MemberType.FIELD) {
            res = this.getObjField(thisRef, memberIdx, thisTypeRef);
            if (isCall) {
                res = this.callClosureInternal(
                    res,
                    member.valueType as FunctionType,
                    args,
                );
            }
        } else {
            res = this.getObjMethod(thisRef, memberIdx, thisTypeRef);
            if (member.type === MemberType.METHOD && isCall) {
                const memberFuncType = member.valueType as FunctionType;
                res = this.callFuncRef(memberFuncType, res, args, thisRef);
            }
            if (member.type === MemberType.ACCESSOR) {
                const accessorFuncType = (member.getter! as VarValue).type;
                res = this.callFuncRef(accessorFuncType, res, args, thisRef);
            }
        }
        return res;
    }

    private wasmNewLiteralObj(value: NewLiteralObjectValue) {
        const objHeapTypeRef = this.wasmTypeGen.getWASMHeapType(value.type);
        const vtableHeapTypeRef = this.wasmTypeGen.getWASMVtableHeapType(
            value.type,
        );
        const members = (value.type as ObjectType).meta.members;
        const propRefList: binaryen.ExpressionRef[] = [];
        const vtable: binaryen.ExpressionRef[] = [];
        for (let i = 0; i < members.length; i++) {
            /* eg.  arr = [{a:1}, {a:2}, {a:3, b:4}]
            TSC treate arr type is Array<{a:number, b?: number} | {a:number, b:number}>
            */
            if (!value.initValues[i]) {
                propRefList.push(
                    FunctionalFuncs.generateDynUndefined(this.module),
                );
            } else {
                const memberValueRef = this.wasmExprGen(value.initValues[i]);
                if (members[i].type === MemberType.FIELD) {
                    propRefList.push(memberValueRef);
                } else if (members[i].type === MemberType.METHOD) {
                    vtable.push(memberValueRef);
                }
            }
        }
        const vtableRef = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr(vtable).ptr,
            vtable.length,
            vtableHeapTypeRef,
        );
        propRefList.unshift(vtableRef);
        const objectLiteralValueRef = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr(propRefList).ptr,
            propRefList.length,
            objHeapTypeRef,
        );
        return objectLiteralValueRef;
    }

    private wasmObjCast(value: CastValue) {
        const oriValueRef = this.wasmExprGen(value.value);
        const oriValueType = value.value.type as ObjectType;
        const toValueType = value.type as ObjectType;
        if (toValueType.flags === ObjectTypeFlag.UNION) {
            return this.wasmObjTypeCastToAny(value);
        }
        if (oriValueType instanceof UnionType) {
            const toTypeRef = this.wasmTypeGen.getWASMValueType(toValueType);
            return FunctionalFuncs.unboxAnyToExtref(
                this.module,
                oriValueRef,
                toTypeRef,
            );
        }
        switch (oriValueType.meta.type) {
            case ObjectDescriptionType.OBJECT_INSTANCE:
            case ObjectDescriptionType.OBJECT_CLASS:
            case ObjectDescriptionType.OBJECT_LITERAL: {
                if (toValueType.meta.isInterface) {
                    /* obj to interface */
                    return this.boxObjToInfc(
                        oriValueRef,
                        oriValueType,
                        toValueType,
                    );
                } else {
                    /* obj to obj */
                    /** check if it is upcasting  */
                    let fromType: ObjectType | undefined = oriValueType;
                    while (fromType) {
                        if (fromType.equals(toValueType)) {
                            return oriValueRef;
                        }
                        fromType = fromType.super;
                    }
                    const toValueWasmType =
                        this.wasmTypeGen.getWASMType(toValueType);
                    return binaryenCAPI._BinaryenRefCast(
                        this.module.ptr,
                        oriValueRef,
                        toValueWasmType,
                    );
                }
            }
            case ObjectDescriptionType.INTERFACE: {
                if (toValueType.meta.isInterface) {
                    /* interfaceObj to interfaceObj */
                    return oriValueRef;
                } else {
                    /* interfaceObj to obj */
                    return this.unboxInfcToObj(
                        oriValueRef,
                        oriValueType,
                        toValueType,
                    );
                }
            }
        }
    }

    private boxObjToInfc(
        ref: binaryen.ExpressionRef,
        oriType: ObjectType,
        toType: ObjectType,
    ) {
        const itablePtr = this.module.i32.const(
            this.wasmCompiler.generateItable(oriType),
        );
        const wasmTypeId = this.module.i32.const(oriType.typeId);
        const wasmImplId = this.module.i32.const(oriType.implId);

        return binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([itablePtr, wasmTypeId, wasmImplId, ref]).ptr,
            4,
            this.wasmTypeGen.getWASMHeapType(toType),
        );
    }

    private unboxInfcToObj(
        ref: binaryen.ExpressionRef,
        oriType: ObjectType,
        toType: ObjectType,
    ) {
        const obj = binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            3,
            ref,
            this.wasmTypeGen.getWASMHeapType(oriType),
            false,
        );
        return binaryenCAPI._BinaryenRefCast(
            this.module.ptr,
            obj,
            this.wasmTypeGen.getWASMType(toType),
        );
    }

    private wasmNewClass(value: NewConstructorObjectValue) {
        const objectTypeRef = this.wasmTypeGen.getWASMType(value.type);

        /* currently, ctor is only in a seperate field, not be put into members */
        const metaInfo = (value.type as ObjectType).meta;
        if (!metaInfo.ctor) {
            /* Fallback to libdyntype */
            const className = metaInfo.name;
            return this.dyntypeInvoke(className, value.parameters, true);
        }
        const ctorFuncDecl = (
            metaInfo.ctor!.methodOrAccessor!.method! as VarValue
        ).ref as FunctionDeclareNode;
        const thisArg = this.wasmTypeGen.getWASMThisInst(value.type);

        return this.callFunc(
            metaInfo.ctor!.valueType as FunctionType,
            ctorFuncDecl.name,
            objectTypeRef,
            value.parameters,
            ctorFuncDecl,
            undefined,
            thisArg,
        );
    }

    private getOriObjInfoByFindIdx(
        infcRef: binaryen.ExpressionRef,
        infcType: ValueType,
        memberName: string,
        memberValueType: ValueType,
        memberType: MemberType,
        getFunc = false,
        isSet = false,
        valueIdx?: number,
        targetValueRef?: binaryen.ExpressionRef,
    ) {
        const infcTypeRef = this.wasmTypeGen.getWASMType(infcType);
        const oriObjTypeRef = this.wasmTypeGen.getWASMObjOriType(infcType);
        const infcTypeIdRef = this.module.i32.const(infcType.typeId);
        const itableRef = this.getInfcInstInfo(
            infcRef,
            infcTypeRef,
            InfcFieldIndex.ITABLE_INDEX,
        );
        const oriObjTypeIdRef = this.getInfcInstInfo(
            infcRef,
            infcTypeRef,
            InfcFieldIndex.TYPEID_INDEX,
        );
        const oriObjImplIdRef = this.getInfcInstInfo(
            infcRef,
            infcTypeRef,
            InfcFieldIndex.IMPLID_INDEX,
        );
        const oriObjAnyRef = this.getInfcInstInfo(
            infcRef,
            infcTypeRef,
            InfcFieldIndex.DATA_INDEX,
        );
        const castedObjRef = binaryenCAPI._BinaryenRefCast(
            this.module.ptr,
            oriObjAnyRef,
            oriObjTypeRef,
        );
        const flag =
            memberType === MemberType.FIELD
                ? ItableFlag.FIELD
                : memberType === MemberType.METHOD
                ? ItableFlag.METHOD
                : (memberValueType as FunctionType).argumentsType.length > 0
                ? ItableFlag.SETTER
                : ItableFlag.GETTER;
        const indexRef = this.module.call(
            'find_index',
            [
                itableRef,
                this.module.i32.const(
                    this.wasmCompiler.generateRawString(memberName),
                ),
                this.module.i32.const(flag),
            ],
            binaryen.i32,
        );
        let ifTrue: binaryen.ExpressionRef = binaryen.unreachable;
        let ifFalse: binaryen.ExpressionRef;
        if (isSet) {
            ifTrue = this.setObjField(castedObjRef, valueIdx!, targetValueRef!);
            ifFalse = this.dynSetInfcField(
                oriObjAnyRef,
                indexRef,
                targetValueRef!,
                memberValueType,
            );
        } else {
            if (!getFunc) {
                ifTrue = this.getObjField(
                    castedObjRef,
                    valueIdx!,
                    oriObjTypeRef,
                );
            } else {
                ifTrue = this.getObjMethod(
                    castedObjRef,
                    valueIdx!,
                    oriObjTypeRef,
                );
            }
            ifFalse = this.dynGetInfcField(
                oriObjAnyRef,
                indexRef,
                memberValueType,
            );
        }
        const res = createCondBlock(
            this.module,
            infcTypeIdRef,
            oriObjTypeIdRef,
            oriObjImplIdRef,
            ifTrue,
            ifFalse,
        );
        return [castedObjRef, res];
    }

    private getClassStaticField(
        member: MemberDescription,
        meta: ObjectDescription,
        objType: ObjectType,
    ) {
        /* class A; A.yy */
        if (member.type === MemberType.FIELD && member.isStaic) {
            const valueIdx = this.fixFieldIndex(meta, member, true);
            const staticFieldsTypeRef =
                this.wasmTypeGen.getWASMStaticFieldsType(objType);
            const name = meta.name + '|static_fields';
            const staticFields = binaryenCAPI._BinaryenGlobalGet(
                this.module.ptr,
                getCString(name),
                staticFieldsTypeRef,
            );
            return binaryenCAPI._BinaryenStructGet(
                this.module.ptr,
                valueIdx,
                staticFields,
                staticFieldsTypeRef,
                false,
            );
        } else {
            throw Error(`${member} is not a static field`);
        }
    }

    private wasmObjFieldGet(value: ShapeGetValue | OffsetGetValue) {
        /* Workaround: ShapeGetValue's field index now based on its origin shape, not objectType */
        const owner = value.owner;
        const meta = owner.shape!.meta;
        const member = meta.members[value.index];
        switch (owner.type.kind) {
            case ValueTypeKind.UNION:
            case ValueTypeKind.ANY: {
                /* let o: A|null = new A; o'filed type is real type, not any type */
                const objRef = this.wasmExprGen(owner);
                const propNameRef = this.module.i32.const(
                    this.wasmCompiler.generateRawString(member.name),
                );
                const memberType = member.valueType;
                const anyObjProp = FunctionalFuncs.getDynObjProp(
                    this.module,
                    objRef,
                    propNameRef,
                );
                return FunctionalFuncs.unboxAny(
                    this.module,
                    anyObjProp,
                    memberType.kind,
                    this.wasmTypeGen.getWASMType(memberType),
                );
            }
            case ValueTypeKind.OBJECT: {
                const ownerType = owner.type as ObjectType;
                const typeMeta = ownerType.meta;
                if (
                    owner instanceof VarValue &&
                    owner.ref instanceof ObjectType
                ) {
                    /* static field get */
                    return this.getClassStaticField(member, meta, ownerType);
                } else {
                    /* Workaround: ownerType's meta different from shape's meta */
                    const objRef = this.wasmExprGen(owner);
                    return this.getInstMember(
                        objRef,
                        ownerType,
                        typeMeta,
                        member,
                    );
                }
            }
            case ValueTypeKind.ARRAY: {
                const objRef = this.wasmExprGen(owner);
                if (member.name === 'length') {
                    return FunctionalFuncs.getArrayRefLen(this.module, objRef);
                }
                throw Error(`unhandle Array field get: ${member.name}`);
            }
            case ValueTypeKind.STRING: {
                const objRef = this.wasmExprGen(owner);
                if (member.name === 'length') {
                    return FunctionalFuncs.getStringRefLen(this.module, objRef);
                }
                throw Error(`unhandle String field get: ${member.name}`);
            }
            default:
                throw new UnimplementError('Unimplement wasmObjFieldGet');
        }
    }

    private getInfcInstInfo(
        ref: binaryenCAPI.ExpressionRef,
        typeRef: binaryen.Type,
        idx: number,
    ) {
        return binaryenCAPI._BinaryenStructGet(
            this.module.ptr,
            idx,
            ref,
            typeRef,
            false,
        );
    }

    private dynGetInfcField(
        ref: binaryen.ExpressionRef,
        index: binaryen.ExpressionRef,
        type: ValueType,
    ) {
        const wasmType = this.wasmTypeGen.getWASMType(type);
        const typeKind = type.kind;
        let res: binaryen.ExpressionRef | null = null;
        if (typeKind === ValueTypeKind.BOOLEAN) {
            res = this.module.call(
                structdyn.StructDyn.struct_get_dyn_i32,
                [ref, index],
                binaryen.i32,
            );
        } else if (typeKind === ValueTypeKind.NUMBER) {
            res = this.module.call(
                structdyn.StructDyn.struct_get_dyn_f64,
                [ref, index],
                binaryen.f64,
            );
        } else if (typeKind === ValueTypeKind.FUNCTION) {
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
        } else if (wasmType === binaryen.anyref) {
            res = this.module.call(
                structdyn.StructDyn.struct_get_dyn_anyref,
                [ref, index],
                binaryen.anyref,
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

    private dynSetInfcField(
        ref: binaryen.ExpressionRef,
        index: binaryen.ExpressionRef,
        value: binaryen.ExpressionRef,
        type: ValueType,
    ) {
        const wasmType = this.wasmTypeGen.getWASMType(type);
        const typeKind = type.kind;
        let res: binaryen.ExpressionRef | null = null;

        if (typeKind === ValueTypeKind.BOOLEAN) {
            res = this.module.call(
                structdyn.StructDyn.struct_set_dyn_i32,
                [ref, index, value],
                binaryen.none,
            );
        } else if (typeKind === ValueTypeKind.NUMBER) {
            res = this.module.call(
                structdyn.StructDyn.struct_set_dyn_f64,
                [ref, index, value],
                binaryen.none,
            );
        } else if (typeKind === ValueTypeKind.FUNCTION) {
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

    private wasmDirectGetter(value: DirectGetterValue) {
        const owner = value.owner as VarValue;
        const returnTypeRef = this.wasmTypeGen.getWASMType(value.type);
        let objRef = this.wasmExprGen(owner);

        const methodMangledName = (value.getter as any).index as string;

        if ((owner.type as ObjectType).meta.isInterface) {
            /* This is a resolved interface access, "this" should be the object hold by the interface */
            objRef = this.getInfcInstInfo(
                objRef,
                infcTypeInfo.typeRef,
                InfcFieldIndex.DATA_INDEX,
            );
            objRef = binaryenCAPI._BinaryenRefCast(
                this.module.ptr,
                objRef,
                emptyStructType.typeRef,
            );
        }

        const context = binaryenCAPI._BinaryenRefNull(
            this.module.ptr,
            emptyStructType.typeRef,
        );

        return this.module.call(
            methodMangledName,
            [context, objRef],
            returnTypeRef,
        );
    }

    private wasmDirectSetter(value: DirectSetterValue) {
        const owner = value.owner as VarValue;
        const returnTypeRef = this.wasmTypeGen.getWASMType(value.type);
        let objRef = this.wasmExprGen(owner);

        const methodMangledName = (value.setter as any).index as string;

        if ((owner.type as ObjectType).meta.isInterface) {
            /* This is a resolved interface access, "this" should be the object hold by the interface */
            objRef = this.getInfcInstInfo(
                objRef,
                infcTypeInfo.typeRef,
                InfcFieldIndex.DATA_INDEX,
            );
            objRef = binaryenCAPI._BinaryenRefCast(
                this.module.ptr,
                objRef,
                emptyStructType.typeRef,
            );
        }

        const context = binaryenCAPI._BinaryenRefNull(
            this.module.ptr,
            emptyStructType.typeRef,
        );

        return this.module.call(
            methodMangledName,
            [context, objRef, this.wasmExprGen(value.value!)],
            binaryen.none,
        );
    }

    private getTruthIdx(
        meta: ObjectDescription,
        member: MemberDescription,
        isSetter = false,
    ) {
        /* The index provided by semantic tree is unrealiable, we must recompute it */
        let valueIdx = 0;
        if (member.type === MemberType.FIELD) {
            valueIdx = this.fixFieldIndex(meta, member);
        } else {
            valueIdx = this.fixVtableIndex(meta, member, isSetter);
        }
        return valueIdx;
    }

    private getMemberByName(meta: ObjectDescription, propName: string) {
        let foundMember: MemberDescription | undefined = undefined;
        for (const member of meta.members) {
            if (member.name === propName) {
                foundMember = member;
                break;
            }
        }
        if (!foundMember) {
            throw Error(`not found ${propName} in getMemberByName`);
        }
        return foundMember;
    }

    private wasmDynamicGet(value: DynamicGetValue) {
        const owner = value.owner;
        const propName = value.name;
        const propNameRef = this.module.i32.const(
            this.wasmCompiler.generateRawString(propName),
        );
        switch (owner.type.kind) {
            case ValueTypeKind.ANY:
            case ValueTypeKind.UNION: {
                /* get any prop */
                const ownValueRef = this.wasmExprGen(owner);
                return FunctionalFuncs.getDynObjProp(
                    this.module,
                    ownValueRef,
                    propNameRef,
                );
            }
            case ValueTypeKind.OBJECT: {
                const meta = (owner.type as ObjectType).meta;
                const foundMember = this.getMemberByName(meta, propName);
                const valueIdx = this.getTruthIdx(meta, foundMember);

                if (meta.isInterface) {
                    /* let i: I = xx; i.yy */
                    const ownValueRef = this.wasmExprGen(owner);
                    return this.getInfcMember(
                        foundMember,
                        owner.type,
                        ownValueRef,
                        valueIdx,
                    );
                } else if (meta.isObjectClass) {
                    /* class A; A.yy */
                    /* workaround: class get static field is a ShapeGetValue, this can be deleted later */
                    return this.getClassStaticField(
                        foundMember,
                        meta,
                        owner.type as ObjectType,
                    );
                } else {
                    /* let a: A = xx; a.yy */
                    /* let o = {xx}; o.yy */
                    const ownValueRef = this.wasmExprGen(owner);
                    const ownValueTypeRef = this.wasmTypeGen.getWASMType(
                        owner.type,
                    );
                    return this.getObjMember(
                        foundMember,
                        ownValueRef,
                        ownValueTypeRef,
                        valueIdx,
                    );
                }
            }
            case ValueTypeKind.ARRAY: {
                if (propName === 'length') {
                    const ownValueRef = this.wasmExprGen(owner);
                    return FunctionalFuncs.getArrayRefLen(
                        this.module,
                        ownValueRef,
                    );
                }
                throw Error(`unhandle Array field get: ${propName}`);
            }
            case ValueTypeKind.STRING: {
                if (propName === 'length') {
                    const ownValueRef = this.wasmExprGen(owner);
                    return FunctionalFuncs.getStringRefLen(
                        this.module,
                        ownValueRef,
                    );
                }
                throw Error(`unhandle String field get: ${propName}`);
            }
            default:
                throw Error(`wasmDynamicGet: ${value}`);
        }
    }

    private wasmDynamicSet(value: DynamicSetValue) {
        const oriValue = value.value!;
        const oriValueRef = this.wasmExprGen(oriValue);
        const ownVarDecl = (value.owner as VarValue).ref as VarDeclareNode;
        const ownVarTypeRef = this.wasmTypeGen.getWASMType(
            (value.owner as VarValue).type,
        );
        const ownValueRef = this.module.local.get(
            ownVarDecl.index,
            ownVarTypeRef,
        );
        switch (ownVarDecl.type.kind) {
            case ValueTypeKind.ANY: {
                /* set any prop */
                const propNameRef = this.module.i32.const(
                    this.wasmCompiler.generateRawString(value.name),
                );
                const initValueToAnyRef = FunctionalFuncs.boxToAny(
                    this.module,
                    oriValueRef,
                    oriValue,
                );
                return this.module.drop(
                    FunctionalFuncs.setDynObjProp(
                        this.module,
                        ownValueRef,
                        propNameRef,
                        initValueToAnyRef,
                    ),
                );
            }
            case ValueTypeKind.OBJECT: {
                const objType = ownVarDecl.type as ObjectType;
                const meta = objType.meta;
                const foundMember = this.getMemberByName(meta, value.name);
                return this.setInstField(
                    ownValueRef,
                    oriValue,
                    objType,
                    meta,
                    foundMember,
                );
            }
            default:
                throw Error(`wasmDynamicSet: ${value}`);
        }
    }

    private wasmNewLiteralArray(value: NewLiteralArrayValue) {
        const arrayLen = value.initValues.length;
        const elemRefs: binaryen.ExpressionRef[] = [];
        const arrayOriHeapType = this.wasmTypeGen.getWASMArrayOriHeapType(
            value.type,
        );
        const arrayStructHeapType = this.wasmTypeGen.getWASMHeapType(
            value.type,
        );
        for (let i = 0; i < arrayLen; i++) {
            let elemRef = this.wasmExprGen(value.initValues[i]);
            if (value.initValues[i].type.kind === ValueTypeKind.INT) {
                /* Currently there is no Array<int>, int in array init
                    sequence should be coverted to number */
                elemRef = this.module.f64.convert_u.i32(elemRef);
            }
            elemRefs.push(elemRef);
        }
        const arrayRef = binaryenCAPI._BinaryenArrayNewFixed(
            this.module.ptr,
            arrayOriHeapType,
            arrayToPtr(elemRefs).ptr,
            arrayLen,
        );
        const arraySizeRef = this.module.i32.const(arrayLen);
        const arrayStructRef = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([arrayRef, arraySizeRef]).ptr,
            2,
            arrayStructHeapType,
        );
        return arrayStructRef;
    }

    private wasmNewArray(value: NewArrayValue | NewArrayLenValue) {
        let arrayRef: binaryen.ExpressionRef;
        let arraySizeRef: binaryen.ExpressionRef;
        const arrayHeapType = this.wasmTypeGen.getWASMArrayOriHeapType(
            value.type,
        );
        const arrayStructHeapType = this.wasmTypeGen.getWASMHeapType(
            value.type,
        );

        if (value instanceof NewArrayValue) {
            const arrayLen = value.parameters.length;
            const elemRefs: binaryen.ExpressionRef[] = [];
            for (let i = 0; i < arrayLen; i++) {
                const elemRef = this.wasmExprGen(value.parameters[i]);
                elemRefs.push(elemRef);
            }
            arrayRef = binaryenCAPI._BinaryenArrayNewFixed(
                this.module.ptr,
                arrayHeapType,
                arrayToPtr(elemRefs).ptr,
                arrayLen,
            );
            arraySizeRef = this.module.i32.const(arrayLen);
        } else if (value instanceof NewArrayLenValue) {
            const arrayInit = this.getArrayInitFromArrayType(
                <ArrayType>value.type,
            );
            arraySizeRef = FunctionalFuncs.convertTypeToI32(
                this.module,
                this.wasmExprGen(value.len),
            );

            arrayRef = binaryenCAPI._BinaryenArrayNew(
                this.module.ptr,
                arrayHeapType,
                arraySizeRef,
                arrayInit,
            );
        }

        const arrayStructRef = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([arrayRef!, arraySizeRef!]).ptr,
            2,
            arrayStructHeapType,
        );
        return arrayStructRef;
    }

    private wasmElemGet(value: ElementGetValue) {
        const owner = value.owner;
        const ownerRef = this.wasmExprGen(owner);
        const ownerType = owner.type;
        const idxRef = FunctionalFuncs.convertTypeToI32(
            this.module,
            this.wasmExprGen(value.index),
        );

        switch (ownerType.kind) {
            case ValueTypeKind.ARRAY: {
                const elemTypeRef = this.wasmTypeGen.getWASMType(
                    (ownerType as ArrayType).element,
                );
                const ownerHeapTypeRef =
                    this.wasmTypeGen.getWASMHeapType(ownerType);
                return FunctionalFuncs.getArrayElemByIdx(
                    this.module,
                    elemTypeRef,
                    ownerRef,
                    ownerHeapTypeRef,
                    idxRef,
                );
            }
            /* workaround: sometimes semantic tree will treat array as any
             * test case: array_class2 in array_push.ts
             * However, this case need to reserve.
             */
            case ValueTypeKind.ANY: {
                return FunctionalFuncs.getAnyElemByIdx(
                    this.module,
                    ownerRef,
                    idxRef,
                );
            }
            case ValueTypeKind.STRING: {
                const context = binaryenCAPI._BinaryenRefNull(
                    this.module.ptr,
                    emptyStructType.typeRef,
                );
                const idxF64Ref = FunctionalFuncs.convertTypeToF64(
                    this.module,
                    idxRef,
                );
                return this.module.call(
                    getBuiltInFuncName(BuiltinNames.stringcharAtFuncName),
                    [context, ownerRef, idxF64Ref],
                    stringTypeInfo.typeRef,
                );
            }
            default:
                throw Error(`wasmIdxGet: ${value}`);
        }
    }

    private wasmElemSet(value: ElementSetValue) {
        const owner = value.owner as VarValue;
        const ownerRef = this.wasmExprGen(owner);
        const ownerType = owner.type;
        const ownerHeapTypeRef = this.wasmTypeGen.getWASMHeapType(ownerType);
        const idxRef = FunctionalFuncs.convertTypeToI32(
            this.module,
            this.wasmExprGen(value.index),
        );

        const targetValueRef = this.wasmExprGen(value.value!);
        switch (ownerType.kind) {
            case ValueTypeKind.ARRAY: {
                const arrayOriRef = binaryenCAPI._BinaryenStructGet(
                    this.module.ptr,
                    0,
                    ownerRef,
                    ownerHeapTypeRef,
                    false,
                );
                return binaryenCAPI._BinaryenArraySet(
                    this.module.ptr,
                    arrayOriRef,
                    idxRef,
                    targetValueRef,
                );
            }
            default:
                throw Error(`wasmIdxGet: ${value}`);
        }
    }

    private wasmBlockValue(value: BlockValue) {
        const blockArray: binaryen.ExpressionRef[] = [];
        for (const blockValue of value.values) {
            blockArray.push(this.wasmExprGen(blockValue));
        }

        return this.module.block(
            value.label,
            blockArray,
            this.wasmTypeGen.getWASMType(value.type),
        );
    }

    private wasmBlockIFValue(value: BlockBranchIfValue) {
        const oriCondRef = this.wasmExprGen(value.condition);
        const targetRef = this.wasmExprGen(value.target);
        const isTrueBranch = value.trueBranch;
        let condRef: binaryen.ExpressionRef;
        if (isTrueBranch) {
            condRef = oriCondRef;
        } else {
            condRef = this.module.i32.eqz(oriCondRef);
        }
        return this.module.if(condRef, targetRef);
    }

    private wasmBlockBranchValue(value: BlockBranchValue) {
        const targetLabel = value.target.label;
        return this.module.br(targetLabel);
    }

    private getArrayInitFromArrayType(
        arrayType: ArrayType,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const elemType = arrayType.element;
        switch (elemType.kind) {
            case ValueTypeKind.NUMBER: {
                return module.f64.const(0);
            }
            case ValueTypeKind.STRING: {
                return FunctionalFuncs.generateStringRef(this.module, '');
            }
            case ValueTypeKind.BOOLEAN: {
                return module.i32.const(0);
            }
            default: {
                return binaryenCAPI._BinaryenRefNull(
                    module.ptr,
                    this.wasmTypeGen.getWASMType(elemType),
                );
            }
        }
    }

    private generateArgStruct(args?: Array<SemanticsValue>) {
        const restArgs = args
            ? args.map((a) => {
                  return FunctionalFuncs.boxToAny(
                      this.module,
                      this.wasmExprGen(a),
                      a,
                  );
              })
            : [];
        const argArray = binaryenCAPI._BinaryenArrayNewFixed(
            this.module.ptr,
            anyArrayTypeInfo.heapTypeRef,
            arrayToPtr(restArgs).ptr,
            restArgs.length,
        );
        const arrayStructType = generateArrayStructTypeInfo(anyArrayTypeInfo);
        const arrayStruct = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([argArray, this.module.i32.const(restArgs.length)]).ptr,
            2,
            arrayStructType.heapTypeRef,
        );
        return arrayStruct;
    }

    /** the dynamic object will fallback to libdyntype */
    private dyntypeInvoke(
        name: string,
        args: Array<SemanticsValue>,
        isNew = false,
    ): binaryen.ExpressionRef {
        const namePointer = this.wasmCompiler.generateRawString(name);
        const thisArg = !isNew
            ? this.wasmExprGen(args.splice(0, 1)[0])
            : undefined;
        const arrayStruct = this.generateArgStruct(args);
        const finalArgs = [
            FunctionalFuncs.getDynContextRef(this.module),
            this.module.i32.const(namePointer),
        ];

        if (!isNew) {
            finalArgs.push(thisArg!);
        }

        finalArgs.push(arrayStruct);

        const res = this.module.call(
            isNew
                ? dyntype.dyntype_new_object_with_class
                : dyntype.dyntype_invoke,
            finalArgs,
            dyntype.dyn_value_t,
        );
        return res;
    }

    private wasmTypeof(value: TypeofValue): binaryen.ExpressionRef {
        const expr = this.wasmExprGen(value.value);
        const res = this.module.call(
            dyntype.dyntype_typeof,
            [
                this.module.global.get(
                    dyntype.dyntype_context,
                    binaryen.anyref,
                ),
                expr,
            ],
            stringTypeInfo.typeRef,
        );
        return res;
    }

    private wasmToString(value: ToStringValue): binaryen.ExpressionRef {
        const expr = this.wasmExprGen(value.value);
        const boxedExpr = FunctionalFuncs.boxToAny(
            this.module,
            expr,
            value.value,
        );
        const res = this.module.call(
            dyntype.dyntype_toString,
            [
                this.module.global.get(
                    dyntype.dyntype_context,
                    binaryen.anyref,
                ),
                boxedExpr,
            ],
            stringTypeInfo.typeRef,
        );
        return res;
    }

    private wasmObjTypeCastToAny(value: CastValue) {
        const fromValue = value.value;
        const fromValueRef = this.wasmExprGen(fromValue);
        const fromType = fromValue.type;

        const fromObjType = fromType as ObjectType;

        /* Workaround: semantic tree treat Map/Set as ObjectType,
            then they will be boxed to extref. Here we avoid this
            cast if we find the actual object should be fallbacked
            to libdyntype */
        if (
            fromObjType.meta &&
            BuiltinNames.fallbackConstructors.includes(fromObjType.meta.name)
        ) {
            return fromValueRef;
        }

        if (fromValue instanceof NewLiteralObjectValue) {
            /* created a temVar to store dynObjValue, then set dyn property */
            const tmpVar = this.currentFuncCtx!.insertTmpVar(Primitive.Any);
            const tmpVarTypeRef = this.wasmTypeGen.getWASMType(tmpVar.type);
            const createDynObjOps: binaryen.ExpressionRef[] = [];
            createDynObjOps.push(
                this.module.local.set(
                    tmpVar.index,
                    FunctionalFuncs.boxToAny(
                        this.module,
                        fromValueRef,
                        fromValue,
                    ),
                ),
            );
            for (let i = 0; i < fromValue.initValues.length; i++) {
                let initValue = fromValue.initValues[i];
                let isNestedLiteralObj = false;
                if (initValue instanceof NewLiteralObjectValue) {
                    /* Workaround: semantic tree treat any typed object literal as
                        casting object to any, in the backend, we firstly generate
                        the static version of object literal, and then replace it
                        with dynamic one during cast. And if there are nested literals,
                        we need to insert this CastValue to ensure the inner literals
                        are also replaced with dynamic version.
                        e.g.

                        export function boxNestedObj() {
                            let obj: any;
                            obj = {
                                a: 1,
                                c: true,
                                d: {
                                    e: 1,
                                },
                            };
                            return obj.d.e as number;
                        }

                        Without this workaround, we will miss field 'e' of 'obj.d'
                    */
                    isNestedLiteralObj = true;
                    initValue = new CastValue(
                        SemanticsValueKind.OBJECT_CAST_ANY,
                        initValue.type,
                        initValue,
                    );
                }
                const initValueRef = this.wasmExprGen(initValue);
                let initValueToAnyRef = initValueRef;
                if (!isNestedLiteralObj) {
                    initValueToAnyRef = FunctionalFuncs.boxToAny(
                        this.module,
                        initValueRef,
                        initValue,
                    );
                }
                const propName = fromObjType.meta.members[i].name;
                const propNameRef = this.module.i32.const(
                    this.wasmCompiler.generateRawString(propName),
                );
                createDynObjOps.push(
                    FunctionalFuncs.setDynObjProp(
                        this.module,
                        this.module.local.get(tmpVar.index, tmpVarTypeRef),
                        propNameRef,
                        initValueToAnyRef,
                    ),
                );
            }
            createDynObjOps.push(
                this.module.local.get(tmpVar.index, tmpVarTypeRef),
            );
            return this.module.block(null, createDynObjOps);
        } else {
            let objDescType: ObjectDescriptionType | undefined = undefined;
            if (fromValue.type instanceof ObjectType) {
                objDescType = fromValue.type.meta.type;
            }
            return FunctionalFuncs.boxNonLiteralToAny(
                this.module,
                fromValueRef,
                fromType.kind,
                objDescType,
            );
        }
    }
}

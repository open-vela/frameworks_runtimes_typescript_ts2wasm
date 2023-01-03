import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import { TSFunction, Type, TypeKind } from './type';
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
} from './expression.js';
import ts from 'typescript';
import { strArrayTypeInfo } from './glue/packType.js';
import { arrayToPtr, stringStructTypeInfo } from './glue/transform.js';
import { assert } from 'console';

export class WASMGen {
    private binaryenModule = new binaryen.Module();
    private wasmTypeCompiler = new WASMType();

    constructor() {
        // TODO
    }

    get module(): binaryen.Module {
        return this.binaryenModule;
    }

    get wasmType(): WASMType {
        return this.wasmTypeCompiler;
    }
}

export class WASMType {
    private tsType2WASMTypeMap: Map<Type, binaryenCAPI.TypeRef> = new Map();
    private tsType2WASMHeapTypeMap: Map<Type, binaryenCAPI.HeapTypeRef> =
        new Map();

    constructor() {}

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
    }

    getWASMHeapType(type: Type): binaryenCAPI.HeapTypeRef {
        // TODO
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

    }

    getBinaryenTypeRef(): binaryenCAPI.TypeRef {

    }

    setBinaryenHeapTypeRef() {

    }

    getBinaryenHeapTypeRef(): binaryenCAPI.HeapTypeRef {

    }

    getVarInfo(): Variable {

    }

    getIndex(): binaryenCAPI.Index {

    }

    setExpression() {

    }

    getExpression(): binaryen.ExpressionRef {

    }
}

export class WASMExpression {
    constructor(private WASMCompiler: WASMGen) {}

    WASMExprGen(expr: Expression): binaryen.ExpressionRef {
        switch (expr.expressionKind) {
            case ts.SyntaxKind.NumericLiteral:
                return this.WASMNumberLiteral(<NumberLiteralExpression>expr);
            case ts.SyntaxKind.FalseKeyword:
                return this.WASMCompiler.module.i32.const(0);
            case ts.SyntaxKind.TrueKeyword:
                return this.WASMCompiler.module.i32.const(1);
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
            default:
                return this.WASMCompiler.module.unreachable();
        }
    }

    WASMNumberLiteral(expr: NumberLiteralExpression): binaryen.ExpressionRef {
        return this.WASMCompiler.module.f64.const(expr.expressionValue);
    }

    WASMStringLiteral(expr: StringLiteralExpression): binaryen.ExpressionRef {
        const value = expr.expressionValue.substring(
            1,
            expr.expressionValue.length - 1,
        );
        let valueLen = value.length;
        const strArray = [];
        for (let i = 0; i < valueLen; i++) {
            const codePoint = value.codePointAt(i)!;
            if (codePoint > 0xffff) {
                i++;
                valueLen--;
            }
            strArray.push(this.WASMCompiler.module.i32.const(codePoint));
        }
        const valueContent = binaryenCAPI._BinaryenArrayInit(
            this.WASMCompiler.module.ptr,
            strArrayTypeInfo.heapTypeRef,
            arrayToPtr(strArray).ptr,
            valueLen,
        );
        const wasmStringValue = binaryenCAPI._BinaryenStructNew(
            this.WASMCompiler.module.ptr,
            arrayToPtr([this.WASMCompiler.module.i32.const(0), valueContent]).ptr,
            2,
            strArrayTypeInfo.heapTypeRef,
        );
        return wasmStringValue;
    }

    WASMIdenfiterExpr(expr: IdentifierExpression): binaryen.ExpressionRef {
        const variable = findVariable(expr.identifierName);
        return this.WASMCompiler.module.local.get(
            variable.varIndex,
            this.WASMCompiler.wasmType.getWASMType(variable.varType),
        );
    }

    WASMBinaryExpr(expr: BinaryExpression): binaryen.ExpressionRef {
        const leftWASMExpr = this.WASMExprGen(expr.leftOperand);
        const rightWASMExpr = this.WASMExprGen(expr.rightOperand);
        const leftWASMType = binaryen.getExpressionType(leftWASMExpr);
        const rightWASMType = binaryen.getExpressionType(rightWASMExpr);

        const operator = expr.operatorKind;

        if (leftWASMType === binaryen.f64 && rightWASMType === binaryen.f64) {
            switch (operator) {
                case ts.SyntaxKind.PlusToken: {
                    return this.WASMCompiler.module.f64.add(
                        leftWASMExpr,
                        rightWASMExpr,
                    );
                }
                case ts.SyntaxKind.MinusToken: {
                    return this.WASMCompiler.module.f64.sub(
                        leftWASMExpr,
                        rightWASMExpr,
                    );
                }
                case ts.SyntaxKind.AsteriskToken: {
                    return this.WASMCompiler.module.f64.mul(
                        leftWASMExpr,
                        rightWASMExpr,
                    );
                }
                case ts.SyntaxKind.SlashToken: {
                    return this.WASMCompiler.module.f64.div(
                        leftWASMExpr,
                        rightWASMExpr,
                    );
                }
                case ts.SyntaxKind.GreaterThanToken: {
                    return this.WASMCompiler.module.f64.gt(
                        leftWASMExpr,
                        rightWASMExpr,
                    );
                }
                case ts.SyntaxKind.GreaterThanEqualsToken: {
                    return this.WASMCompiler.module.f64.ge(
                        leftWASMExpr,
                        rightWASMExpr,
                    );
                }
                case ts.SyntaxKind.LessThanToken: {
                    return this.WASMCompiler.module.f64.lt(
                        leftWASMExpr,
                        rightWASMExpr,
                    );
                }
                case ts.SyntaxKind.LessThanEqualsToken: {
                    return this.WASMCompiler.module.f64.le(
                        leftWASMExpr,
                        rightWASMExpr,
                    );
                }
                case ts.SyntaxKind.EqualsEqualsToken:
                case ts.SyntaxKind.EqualsEqualsEqualsToken: {
                    return this.WASMCompiler.module.f64.eq(
                        leftWASMExpr,
                        rightWASMExpr,
                    );
                }
                case ts.SyntaxKind.ExclamationEqualsToken:
                case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
                    return this.WASMCompiler.module.f64.ne(
                        leftWASMExpr,
                        rightWASMExpr,
                    );
                }
                case ts.SyntaxKind.AmpersandAmpersandToken: {
                    return this.WASMCompiler.module.select(
                        this.convertTypeToI32(leftWASMExpr, leftWASMType),
                        leftWASMExpr,
                        rightWASMExpr,
                        binaryen.f64,
                    );
                }
                default:
                    return this.WASMCompiler.module.unreachable();
            }
        }
        if (leftWASMType === binaryen.f64 && rightWASMType === binaryen.i32) {
            switch (operator) {
                case ts.SyntaxKind.AmpersandAmpersandToken: {
                    return this.WASMCompiler.module.select(
                        this.convertTypeToI32(leftWASMExpr, leftWASMType),
                        rightWASMExpr,
                        this.convertTypeToI32(leftWASMExpr, leftWASMType),
                        binaryen.i32,
                    );
                }
                case ts.SyntaxKind.BarBarToken: {
                    return this.WASMCompiler.module.select(
                        this.convertTypeToI32(leftWASMExpr, leftWASMType),
                        this.convertTypeToI32(leftWASMExpr, leftWASMType),
                        rightWASMExpr,
                        binaryen.i32,
                    );
                }
            }
        }
        if (leftWASMType === binaryen.i32 && rightWASMType === binaryen.f64) {
            switch (operator) {
                case ts.SyntaxKind.AmpersandAmpersandToken: {
                    const condition = Boolean(
                        this.WASMCompiler.module.i32.eqz(leftWASMExpr),
                    );
                    if (condition) {
                        return this.WASMCompiler.module.select(
                            leftWASMExpr,
                            this.convertTypeToI32(rightWASMExpr, rightWASMType),
                            leftWASMExpr,
                            binaryen.i32,
                        );
                    } else {
                        return rightWASMExpr;
                    }
                }
                case ts.SyntaxKind.BarBarToken: {
                    // if left is false, then condition is true
                    const condition = Boolean(
                        this.WASMCompiler.module.i32.eqz(leftWASMExpr),
                    );
                    if (condition) {
                        return rightWASMExpr;
                    } else {
                        return this.WASMCompiler.module.select(
                            leftWASMExpr,
                            leftWASMExpr,
                            this.convertTypeToI32(rightWASMExpr, rightWASMType),
                            binaryen.i32,
                        );
                    }
                }
            }
        }
        if (leftWASMType === binaryen.i32 && rightWASMType === binaryen.i32) {
            switch (operator) {
                case ts.SyntaxKind.AmpersandAmpersandToken: {
                    return this.WASMCompiler.module.select(
                        leftWASMExpr,
                        rightWASMExpr,
                        leftWASMExpr,
                        binaryen.i32,
                    );
                }
                case ts.SyntaxKind.BarBarToken: {
                    return this.WASMCompiler.module.select(
                        leftWASMExpr,
                        leftWASMExpr,
                        rightWASMExpr,
                        binaryen.i32,
                    );
                }
            }
        }
        return this.WASMCompiler.module.unreachable();
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
                return this.WASMCompiler.module.i32.eqz(WASMOperandExpr);
            }
            case ts.SyntaxKind.MinusToken: {
                if (operand.expressionKind === ts.SyntaxKind.NumericLiteral) {
                    const value: number = (<NumberLiteralExpression>operand)
                        .expressionValue;
                    return this.WASMCompiler.module.f64.const(-value);
                } else {
                    const WASMOperandExpr = this.WASMExprGen(operand);
                    return this.WASMCompiler.module.f64.sub(
                        this.WASMCompiler.module.f64.const(0),
                        WASMOperandExpr,
                    );
                }
            }
        }
        return this.WASMCompiler.module.unreachable();
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
        return this.WASMCompiler.module.select(
            condWASMExpr,
            trueWASMExpr,
            falseWASMExpr,
        );
    }

    WASMCallExpr(expr: CallExpression): binaryen.ExpressionRef {
        const callExpr = expr.callExpr;
        const callWASMArgs = new Array<binaryen.ExpressionRef>();
        for (let i = 0; i !== expr.callArgs.length; ++i) {
            callWASMArgs.push(this.WASMExprGen(expr.callArgs[i]));
        }
        if (callExpr.expressionKind === ts.SyntaxKind.Identifier) {
            const type = findType(
                (<IdentifierExpression>callExpr).identifierName,
            );
            const tsFunctionType = <TSFunction>type;
            const parameters = tsFunctionType.getParameters();
            if (parameters.length > callWASMArgs.length) {
                const argsSize = callWASMArgs.length;
                for (let i = argsSize; i !== parameters.length; ++i) {
                    callWASMArgs.push(
                        this.WASMExprGen(parameters[i].initExpression),
                    );
                }
            }
            return this.WASMCompiler.module.call(
                (<IdentifierExpression>callExpr).identifierName,
                callWASMArgs,
                this.WASMCompiler.wasmType.getWASMType(
                    tsFunctionType.returnType,
                ),
            );
        }
        return this.WASMCompiler.module.unreachable();
    }

    convertTypeToI32(
        expression: binaryen.ExpressionRef,
        expressionType: binaryen.Type,
    ): binaryen.ExpressionRef {
        switch (expressionType) {
            case binaryen.f64: {
                return this.WASMCompiler.module.i32.trunc_u_sat.f64(expression);
            }
            case binaryen.i32: {
                return expression;
            }
            // TODO: deal with more types
        }
        return binaryen.none;
    }
}

function findVariable(name: string): Variable {
    // TODO
}

function findType(name: string): Type {
    // TODO
}

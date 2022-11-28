import ts from 'typescript';
import binaryen from 'binaryen';
import { Compiler } from './compiler.js';
import BaseCompiler from './base.js';
import {
    AssignKind,
    BinaryExpressionInfo,
    VariableInfo,
    ExpressionKind,
} from './utils.js';
import {
    STRING_LENGTH_FUNC,
    STRING_CONCAT_FUNC,
    STRING_SLICE_FUNC,
} from './glue/utils.js';
import { strArrayTypeInfo, strStructTypeInfo } from './glue/packType.js';

export default class ExpressionCompiler extends BaseCompiler {
    constructor(compiler: Compiler) {
        super(compiler);
    }
    visitNode(node: ts.Node, fillScope: boolean): binaryen.ExpressionRef {
        switch (node.kind) {
            case ts.SyntaxKind.Identifier: {
                const identifierNode = <ts.Identifier>node;
                const identifierName = identifierNode.getText();
                const currentScope = this.getCurrentScope();
                let valueInfo = currentScope.findVariable(identifierName);
                if (!valueInfo) {
                    this.reportError(identifierNode, 'error TS2304');
                }
                valueInfo = <VariableInfo>valueInfo;
                if (currentScope.isGlobalVariable(identifierName)) {
                    return this.getGlobalValue(
                        valueInfo.variableName,
                        valueInfo.variableType,
                    );
                } else {
                    return this.getLocalValue(
                        valueInfo.variableIndex,
                        valueInfo.variableType,
                    );
                }
            }

            case ts.SyntaxKind.BinaryExpression: {
                const binaryExpressionNode = <ts.BinaryExpression>node;
                const binaryExpressionInfo: BinaryExpressionInfo = {
                    leftExpression: binaryen.none,
                    leftType: binaryen.none,
                    operator: binaryen.none,
                    rightExpression: binaryen.none,
                    rightType: binaryen.none,
                };
                binaryExpressionInfo.leftExpression = this.visit(
                    binaryExpressionNode.left,
                );
                binaryExpressionInfo.leftType = this.visit(
                    this.getVariableType(
                        binaryExpressionNode.left,
                        this.getTypeChecker(),
                    ),
                );
                binaryExpressionInfo.rightExpression = this.visit(
                    binaryExpressionNode.right,
                );
                binaryExpressionInfo.rightType = this.visit(
                    this.getVariableType(
                        binaryExpressionNode.right,
                        this.getTypeChecker(),
                    ),
                );
                const operatorKind = binaryExpressionNode.operatorToken.kind;
                switch (operatorKind) {
                    case ts.SyntaxKind.PlusToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.PlusToken,
                            );
                        break;
                    }
                    case ts.SyntaxKind.MinusToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.MinusToken,
                            );
                        break;
                    }
                    case ts.SyntaxKind.AsteriskToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.AsteriskToken,
                            );
                        break;
                    }
                    case ts.SyntaxKind.SlashToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.SlashToken,
                            );
                        break;
                    }
                    case ts.SyntaxKind.GreaterThanToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.GreaterThanToken,
                            );
                        break;
                    }
                    case ts.SyntaxKind.GreaterThanEqualsToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.GreaterThanEqualsToken,
                            );
                        break;
                    }
                    case ts.SyntaxKind.EqualsToken: {
                        return this.handleExpressionStatement(
                            binaryExpressionNode.left as ts.Identifier,
                            binaryExpressionInfo,
                            ExpressionKind.equalsExpression,
                        );
                    }
                    case ts.SyntaxKind.LessThanToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.LessThanToken,
                            );
                        break;
                    }
                    case ts.SyntaxKind.LessThanEqualsToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.LessThanEqualsToken,
                            );
                        break;
                    }
                    // "xx && xx expression"
                    case ts.SyntaxKind.AmpersandAmpersandToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.AmpersandAmpersandToken,
                            );
                        break;
                    }
                    // // "xx || xx expression"
                    case ts.SyntaxKind.BarBarToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.BarBarToken,
                            );
                        break;
                    }
                    case ts.SyntaxKind.EqualsEqualsToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.EqualsEqualsToken,
                            );
                        break;
                    }
                    case ts.SyntaxKind.EqualsEqualsEqualsToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.EqualsEqualsEqualsToken,
                            );
                        break;
                    }
                    case ts.SyntaxKind.ExclamationEqualsToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.ExclamationEqualsToken,
                            );
                        break;
                    }
                    case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.ExclamationEqualsEqualsToken,
                            );
                        break;
                    }
                    case ts.SyntaxKind.PlusEqualsToken: {
                        const plusEqualsExpressionInfo: BinaryExpressionInfo = {
                            leftExpression: binaryExpressionInfo.leftExpression,
                            leftType: binaryExpressionInfo.leftType,
                            operator: binaryen.none,
                            rightExpression: this.handleBinaryExpression(
                                binaryExpressionInfo,
                                ts.SyntaxKind.PlusToken,
                            ),
                            rightType: binaryExpressionInfo.rightType,
                        };
                        // TODO: if leftType does not equals rightType, rightType should be fixed.
                        return this.handleExpressionStatement(
                            binaryExpressionNode.left as ts.Identifier,
                            plusEqualsExpressionInfo,
                            ExpressionKind.equalsExpression,
                        );
                    }
                    case ts.SyntaxKind.MinusEqualsToken: {
                        const minusEqualsExpressionInfo: BinaryExpressionInfo =
                            {
                                leftExpression:
                                    binaryExpressionInfo.leftExpression,
                                leftType: binaryExpressionInfo.leftType,
                                operator: binaryen.none,
                                rightExpression: this.handleBinaryExpression(
                                    binaryExpressionInfo,
                                    ts.SyntaxKind.MinusToken,
                                ),
                                rightType: binaryExpressionInfo.rightType,
                            };
                        // TODO: if leftType does not equals rightType, rightType should be fixed.
                        return this.handleExpressionStatement(
                            binaryExpressionNode.left as ts.Identifier,
                            minusEqualsExpressionInfo,
                            ExpressionKind.equalsExpression,
                        );
                    }
                    case ts.SyntaxKind.AsteriskEqualsToken: {
                        const asteriskEqualsExpressionInfo: BinaryExpressionInfo =
                            {
                                leftExpression:
                                    binaryExpressionInfo.leftExpression,
                                leftType: binaryExpressionInfo.leftType,
                                operator: binaryen.none,
                                rightExpression: this.handleBinaryExpression(
                                    binaryExpressionInfo,
                                    ts.SyntaxKind.AsteriskToken,
                                ),
                                rightType: binaryExpressionInfo.rightType,
                            };
                        // TODO: if leftType does not equals rightType, rightType should be fixed.
                        return this.handleExpressionStatement(
                            binaryExpressionNode.left as ts.Identifier,
                            asteriskEqualsExpressionInfo,
                            ExpressionKind.equalsExpression,
                        );
                    }
                    case ts.SyntaxKind.SlashEqualsToken: {
                        const slashEqualsExpressionInfo: BinaryExpressionInfo =
                            {
                                leftExpression:
                                    binaryExpressionInfo.leftExpression,
                                leftType: binaryExpressionInfo.leftType,
                                operator: binaryen.none,
                                rightExpression: this.handleBinaryExpression(
                                    binaryExpressionInfo,
                                    ts.SyntaxKind.SlashToken,
                                ),
                                rightType: binaryExpressionInfo.rightType,
                            };
                        // TODO: if leftType does not equals rightType, rightType should be fixed.
                        return this.handleExpressionStatement(
                            binaryExpressionNode.left as ts.Identifier,
                            slashEqualsExpressionInfo,
                            ExpressionKind.equalsExpression,
                        );
                    }
                }
                return binaryExpressionInfo.operator;
            }

            case ts.SyntaxKind.PrefixUnaryExpression: {
                const prefixUnaryExpressionNode = <ts.PrefixUnaryExpression>(
                    node
                );
                return this.handleUnaryExpression(
                    prefixUnaryExpressionNode,
                    ExpressionKind.prefixUnaryExpression,
                );
            }

            case ts.SyntaxKind.PostfixUnaryExpression: {
                const postfixUnaryExpressionNode = <ts.PostfixUnaryExpression>(
                    node
                );
                return this.handleUnaryExpression(
                    postfixUnaryExpressionNode,
                    ExpressionKind.postfixUnaryExpression,
                );
            }

            // "xx ? xx : xx" expression
            case ts.SyntaxKind.ConditionalExpression: {
                const conditionNode = <ts.ConditionalExpression>node;
                return this.handleConditionalExpression(conditionNode);
            }

            case ts.SyntaxKind.ParenthesizedExpression: {
                const parenthesizedNode = <ts.ParenthesizedExpression>node;
                return this.visit(parenthesizedNode.expression);
            }

            case ts.SyntaxKind.CallExpression: {
                // TODO: add closure
                const callExpressionNode = <ts.CallExpression>node;
                if (
                    callExpressionNode.expression.kind ===
                    ts.SyntaxKind.PropertyAccessExpression
                ) {
                    return this.visit(callExpressionNode.expression);
                }
                const funcName = callExpressionNode.expression.getText();
                const parameters = callExpressionNode.arguments;
                const paramExpressionRefList: binaryen.ExpressionRef[] = [];
                for (let i = 0; i < parameters.length; i++) {
                    paramExpressionRefList.push(this.visit(parameters[i]));
                }
                let paramArray: VariableInfo[] = [];
                let returnType = binaryen.none;
                const currentScope = this.getCurrentScope();
                const childFunctionScope =
                    currentScope.findFunctionScope(funcName);
                if (childFunctionScope) {
                    paramArray = childFunctionScope.getParamArray();
                    returnType = childFunctionScope.getReturnType();
                }
                if (paramArray.length !== paramExpressionRefList.length) {
                    for (
                        let i = paramExpressionRefList.length;
                        i < paramArray.length;
                        i++
                    ) {
                        paramExpressionRefList.push(
                            paramArray[i].variableInitial!,
                        );
                    }
                }
                // Judge if the return value need to drop
                if (returnType !== binaryen.none) {
                    if (
                        callExpressionNode.parent.kind ===
                        ts.SyntaxKind.ExpressionStatement
                    ) {
                        return this.getBinaryenModule().drop(
                            this.getBinaryenModule().call(
                                funcName,
                                paramExpressionRefList,
                                returnType,
                            ),
                        );
                    }
                }
                return this.getBinaryenModule().call(
                    funcName,
                    paramExpressionRefList,
                    returnType,
                );
            }

            case ts.SyntaxKind.PropertyAccessExpression: {
                const propertyAccessNode = <ts.PropertyAccessExpression>node;
                const module = this.getBinaryenModule();
                const strStruct1 = this.visit(propertyAccessNode.expression);
                const builtInFunc = propertyAccessNode.name.getText();
                if (
                    propertyAccessNode.parent.kind ===
                    ts.SyntaxKind.CallExpression
                ) {
                    const callNode = <ts.CallExpression>(
                        propertyAccessNode.parent
                    );
                    const params = callNode.arguments;
                    switch (builtInFunc) {
                        case 'concat': {
                            const strStruct2 = this.visit(params[0]);
                            return module.call(
                                STRING_CONCAT_FUNC,
                                [strStruct1, strStruct2],
                                strStructTypeInfo.heapTypeRef,
                            );
                        }
                        case 'slice': {
                            const start = this.visit(params[0]);
                            const end = this.visit(params[1]);
                            return module.call(
                                STRING_SLICE_FUNC,
                                [strStruct1, start, end],
                                strStructTypeInfo.heapTypeRef,
                            );
                        }
                    }
                } else {
                    switch (builtInFunc) {
                        case 'length': {
                            return module.call(
                                STRING_LENGTH_FUNC,
                                [strStruct1],
                                strStructTypeInfo.heapTypeRef,
                            );
                        }
                    }
                }
                break;
            }
        }
        return binaryen.none;
    }

    handleBinaryExpression(
        binaryExpressionInfo: BinaryExpressionInfo,
        operatorKind: ts.SyntaxKind,
    ): binaryen.ExpressionRef {
        if (
            binaryExpressionInfo.leftType === binaryen.f64 &&
            binaryExpressionInfo.rightType === binaryen.f64
        ) {
            switch (operatorKind) {
                case ts.SyntaxKind.PlusToken: {
                    return this.getBinaryenModule().f64.add(
                        binaryExpressionInfo.leftExpression,
                        binaryExpressionInfo.rightExpression,
                    );
                }
                case ts.SyntaxKind.MinusToken: {
                    return this.getBinaryenModule().f64.sub(
                        binaryExpressionInfo.leftExpression,
                        binaryExpressionInfo.rightExpression,
                    );
                }
                case ts.SyntaxKind.AsteriskToken: {
                    return this.getBinaryenModule().f64.mul(
                        binaryExpressionInfo.leftExpression,
                        binaryExpressionInfo.rightExpression,
                    );
                }
                case ts.SyntaxKind.SlashToken: {
                    return this.getBinaryenModule().f64.div(
                        binaryExpressionInfo.leftExpression,
                        binaryExpressionInfo.rightExpression,
                    );
                }
                case ts.SyntaxKind.GreaterThanToken: {
                    return this.getBinaryenModule().f64.gt(
                        binaryExpressionInfo.leftExpression,
                        binaryExpressionInfo.rightExpression,
                    );
                }
                case ts.SyntaxKind.GreaterThanEqualsToken: {
                    return this.getBinaryenModule().f64.ge(
                        binaryExpressionInfo.leftExpression,
                        binaryExpressionInfo.rightExpression,
                    );
                }
                case ts.SyntaxKind.LessThanToken: {
                    return this.getBinaryenModule().f64.lt(
                        binaryExpressionInfo.leftExpression,
                        binaryExpressionInfo.rightExpression,
                    );
                }
                case ts.SyntaxKind.LessThanEqualsToken: {
                    return this.getBinaryenModule().f64.le(
                        binaryExpressionInfo.leftExpression,
                        binaryExpressionInfo.rightExpression,
                    );
                }
                case ts.SyntaxKind.EqualsEqualsToken: {
                    return this.getBinaryenModule().f64.eq(
                        binaryExpressionInfo.leftExpression,
                        binaryExpressionInfo.rightExpression,
                    );
                }
                case ts.SyntaxKind.EqualsEqualsEqualsToken: {
                    return this.getBinaryenModule().f64.eq(
                        binaryExpressionInfo.leftExpression,
                        binaryExpressionInfo.rightExpression,
                    );
                }
                case ts.SyntaxKind.ExclamationEqualsToken: {
                    return this.getBinaryenModule().f64.ne(
                        binaryExpressionInfo.leftExpression,
                        binaryExpressionInfo.rightExpression,
                    );
                }
                case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
                    return this.getBinaryenModule().f64.ne(
                        binaryExpressionInfo.leftExpression,
                        binaryExpressionInfo.rightExpression,
                    );
                }
                case ts.SyntaxKind.AmpersandAmpersandToken: {
                    const left = binaryExpressionInfo.leftExpression;
                    const right = binaryExpressionInfo.rightExpression;
                    const leftType = binaryExpressionInfo.leftType;
                    return this.getBinaryenModule().select(
                        this.convertTypeToI32(left, leftType),
                        right,
                        left,
                        binaryen.f64,
                    );
                }
                case ts.SyntaxKind.BarBarToken: {
                    const left = binaryExpressionInfo.leftExpression;
                    const right = binaryExpressionInfo.rightExpression;
                    const leftType = binaryExpressionInfo.leftType;
                    return this.getBinaryenModule().select(
                        this.convertTypeToI32(left, leftType),
                        left,
                        right,
                        binaryen.f64,
                    );
                }
            }
        }
        if (
            binaryExpressionInfo.leftType === binaryen.f64 &&
            binaryExpressionInfo.rightType === binaryen.i32
        ) {
            switch (operatorKind) {
                case ts.SyntaxKind.AmpersandAmpersandToken: {
                    const left = binaryExpressionInfo.leftExpression;
                    const right = binaryExpressionInfo.rightExpression;
                    const leftType = binaryExpressionInfo.leftType;
                    return this.getBinaryenModule().select(
                        this.convertTypeToI32(left, leftType),
                        right,
                        this.convertTypeToI32(left, leftType),
                        binaryen.i32,
                    );
                }
                case ts.SyntaxKind.BarBarToken: {
                    const left = binaryExpressionInfo.leftExpression;
                    const right = binaryExpressionInfo.rightExpression;
                    const leftType = binaryExpressionInfo.leftType;
                    return this.getBinaryenModule().select(
                        this.convertTypeToI32(left, leftType),
                        this.convertTypeToI32(left, leftType),
                        right,
                        binaryen.i32,
                    );
                }
            }
        }
        if (
            binaryExpressionInfo.leftType === binaryen.i32 &&
            binaryExpressionInfo.rightType === binaryen.f64
        ) {
            switch (operatorKind) {
                case ts.SyntaxKind.AmpersandAmpersandToken: {
                    const left = binaryExpressionInfo.leftExpression;
                    const right = binaryExpressionInfo.rightExpression;
                    const rightType = binaryExpressionInfo.rightType;
                    // if left is false, then condition is true
                    const condition = Boolean(
                        this.getBinaryenModule().i32.eqz(left),
                    );
                    if (condition) {
                        return this.getBinaryenModule().select(
                            left,
                            this.convertTypeToI32(right, rightType),
                            left,
                            binaryen.i32,
                        );
                    } else {
                        return right;
                    }
                }
                case ts.SyntaxKind.BarBarToken: {
                    const left = binaryExpressionInfo.leftExpression;
                    const right = binaryExpressionInfo.rightExpression;
                    const rightType = binaryExpressionInfo.rightType;
                    // if left is false, then condition is true
                    const condition = Boolean(
                        this.getBinaryenModule().i32.eqz(left),
                    );
                    if (condition) {
                        return right;
                    } else {
                        return this.getBinaryenModule().select(
                            left,
                            left,
                            this.convertTypeToI32(right, rightType),
                            binaryen.i32,
                        );
                    }
                }
            }
        }
        if (
            binaryExpressionInfo.leftType === binaryen.i32 &&
            binaryExpressionInfo.rightType === binaryen.i32
        ) {
            switch (operatorKind) {
                case ts.SyntaxKind.AmpersandAmpersandToken: {
                    const left = binaryExpressionInfo.leftExpression;
                    const right = binaryExpressionInfo.rightExpression;
                    return this.getBinaryenModule().select(
                        left,
                        right,
                        left,
                        binaryen.i32,
                    );
                }
                case ts.SyntaxKind.BarBarToken: {
                    const left = binaryExpressionInfo.leftExpression;
                    const right = binaryExpressionInfo.rightExpression;
                    return this.getBinaryenModule().select(
                        left,
                        left,
                        right,
                        binaryen.i32,
                    );
                }
            }
        }
        // TODO: dyntype API should be invoked here to get actual type.
        return binaryen.none;
    }

    handleUnaryExpression(
        unaryExpressionNode:
            | ts.PostfixUnaryExpression
            | ts.PrefixUnaryExpression,
        expressionKind: ExpressionKind,
    ): binaryen.ExpressionRef {
        const operatorKind = unaryExpressionNode.operator;
        const unaryExpressionInfo: BinaryExpressionInfo = {
            leftExpression: binaryen.none,
            leftType: binaryen.none,
            operator: binaryen.none,
            rightExpression: binaryen.none,
            rightType: binaryen.none,
        };
        const operand = <ts.Identifier>unaryExpressionNode.operand;
        const operandExpression = this.visit(operand);
        unaryExpressionInfo.leftExpression = operandExpression;
        const operandExpressionType = this.visit(
            this.getVariableType(operand, this.getTypeChecker()),
        );
        unaryExpressionInfo.leftType = operandExpressionType;
        const rightExpressionInfo: BinaryExpressionInfo = {
            leftExpression: operandExpression,
            leftType: operandExpressionType,
            operator: binaryen.none,
            rightExpression: this.getBinaryenModule().f64.const(1),
            rightType: binaryen.f64,
        };
        switch (operatorKind) {
            case ts.SyntaxKind.PlusPlusToken: {
                unaryExpressionInfo.rightExpression =
                    this.handleBinaryExpression(
                        rightExpressionInfo,
                        ts.SyntaxKind.PlusToken,
                    );
                break;
            }
            case ts.SyntaxKind.MinusMinusToken: {
                unaryExpressionInfo.rightExpression =
                    this.handleBinaryExpression(
                        rightExpressionInfo,
                        ts.SyntaxKind.MinusToken,
                    );
                break;
            }
            // "!xx" expression
            case ts.SyntaxKind.ExclamationToken: {
                return this.handleExclamationToken(
                    operandExpression,
                    operandExpressionType,
                );
            }
            // "-1" or "-a"
            case ts.SyntaxKind.MinusToken: {
                const operand = unaryExpressionNode.operand;
                const operandType = this.visit(
                    this.getVariableType(operand, this.getTypeChecker()),
                );
                switch (operand.kind) {
                    case ts.SyntaxKind.NumericLiteral: {
                        switch (operandType) {
                            case binaryen.f64: {
                                const numberValue = parseFloat(
                                    unaryExpressionNode.getText(),
                                );
                                return this.getBinaryenModule().f64.const(
                                    numberValue,
                                );
                            }
                        }
                        break;
                    }
                    case ts.SyntaxKind.Identifier: {
                        switch (operandType) {
                            case binaryen.f64: {
                                return this.getBinaryenModule().f64.sub(
                                    this.getBinaryenModule().f64.const(0),
                                    this.visit(operand),
                                );
                            }
                        }
                        break;
                    }
                }
            }
        }

        unaryExpressionInfo.rightType = binaryen.f64;
        return this.handleExpressionStatement(
            operand,
            unaryExpressionInfo,
            expressionKind,
        );
    }

    handleConditionalExpression(
        node: ts.ConditionalExpression,
    ): binaryen.ExpressionRef {
        const module = this.getBinaryenModule();
        let condExpression = this.visit(node.condition);
        const trueExpression = this.visit(node.whenTrue);
        const falseExpression = this.visit(node.whenFalse);
        const condExpressionType = this.visit(
            this.getVariableType(node.condition, this.getTypeChecker()),
        );
        if (condExpressionType != binaryen.i32) {
            condExpression = this.convertTypeToI32(
                condExpression,
                condExpressionType,
            );
        }
        return module.select(condExpression, trueExpression, falseExpression);
    }

    handleExpressionStatement(
        identifierNode: ts.Identifier,
        binaryExpressionInfo: BinaryExpressionInfo,
        expressionKind: ExpressionKind,
    ): binaryen.ExpressionRef {
        const assignedIdentifierName = identifierNode.getText();
        const currentScope = this.getCurrentScope();
        let valueInfo = currentScope.findVariable(assignedIdentifierName);
        if (!valueInfo) {
            this.reportError(identifierNode, 'error TS2304');
        }
        valueInfo = <VariableInfo>valueInfo;
        if (valueInfo.variableAssign === AssignKind.const) {
            this.reportError(identifierNode, 'error TS2588');
        }
        // Only left value can be assigned to right value, expression statement can run.
        if (
            !this.matchType(
                binaryExpressionInfo.leftType,
                binaryExpressionInfo.rightType,
            )
        ) {
            this.reportError(
                identifierNode,
                'Type mismatch in ExpressionStatement',
            );
        }
        if (expressionKind === ExpressionKind.equalsExpression) {
            if (currentScope.isGlobalVariable(assignedIdentifierName)) {
                return this.setGlobalValue(
                    valueInfo.variableName,
                    binaryExpressionInfo.rightExpression,
                );
            } else {
                return this.setLocalValue(
                    valueInfo.variableIndex,
                    binaryExpressionInfo.rightExpression,
                );
            }
        } else if (expressionKind === ExpressionKind.postfixUnaryExpression) {
            const blockArray: binaryen.ExpressionRef[] = [];
            // get value if postfixUnaryExpression's parent is not ExpressionStatement or ForStatement
            if (
                identifierNode.parent.parent.kind !==
                    ts.SyntaxKind.ExpressionStatement &&
                identifierNode.parent.parent.kind !== ts.SyntaxKind.ForStatement
            ) {
                if (currentScope.isGlobalVariable(assignedIdentifierName)) {
                    blockArray.push(
                        this.getGlobalValue(
                            valueInfo.variableName,
                            binaryExpressionInfo.leftType,
                        ),
                    );
                } else {
                    blockArray.push(
                        this.getLocalValue(
                            valueInfo.variableIndex,
                            binaryExpressionInfo.leftType,
                        ),
                    );
                }
            }
            if (currentScope.isGlobalVariable(assignedIdentifierName)) {
                blockArray.push(
                    this.setGlobalValue(
                        valueInfo.variableName,
                        binaryExpressionInfo.rightExpression,
                    ),
                );
            } else {
                blockArray.push(
                    this.setLocalValue(
                        valueInfo.variableIndex,
                        binaryExpressionInfo.rightExpression,
                    ),
                );
            }
            return this.getBinaryenModule().block(null, blockArray);
        } else if (expressionKind === ExpressionKind.prefixUnaryExpression) {
            const blockArray: binaryen.ExpressionRef[] = [];
            if (currentScope.isGlobalVariable(assignedIdentifierName)) {
                blockArray.push(
                    this.setGlobalValue(
                        valueInfo.variableName,
                        binaryExpressionInfo.rightExpression,
                    ),
                );
            } else {
                blockArray.push(
                    this.setLocalValue(
                        valueInfo.variableIndex,
                        binaryExpressionInfo.rightExpression,
                    ),
                );
            }
            // get value if postfixUnaryExpression's parent is not ExpressionStatement or ForStatement
            if (
                identifierNode.parent.parent.kind !==
                    ts.SyntaxKind.ExpressionStatement &&
                identifierNode.parent.parent.kind !== ts.SyntaxKind.ForStatement
            ) {
                if (currentScope.isGlobalVariable(assignedIdentifierName)) {
                    blockArray.push(
                        this.getGlobalValue(
                            valueInfo.variableName,
                            binaryExpressionInfo.leftType,
                        ),
                    );
                } else {
                    blockArray.push(
                        this.getLocalValue(
                            valueInfo.variableIndex,
                            binaryExpressionInfo.leftType,
                        ),
                    );
                }
            }
            return this.getBinaryenModule().block(null, blockArray);
        }

        return binaryen.none;
    }

    matchType(leftType: binaryen.Type, rightType: binaryen.Type): boolean {
        if (leftType === rightType) {
            return true;
        }
        // TODO: if leftType is any, then return true
        if (leftType === binaryen.anyref) {
            return true;
        }
        return false;
    }

    handleExclamationToken(
        operandExpression: binaryen.ExpressionRef,
        operandType: binaryen.Type,
    ): binaryen.ExpressionRef {
        let flag = operandExpression;
        if (operandType !== binaryen.i32) {
            flag = this.convertTypeToI32(operandExpression, operandType);
        }
        return this.getBinaryenModule().i32.eqz(flag);
    }
}

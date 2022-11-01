import ts from 'typescript';
import binaryen from 'binaryen';
import { Compiler } from './compiler.js';
import BaseCompiler from './base.js';
import {
    AssignKind,
    BinaryExpressionInfo,
    OperatorKind,
    VariableInfo,
    ExpressionKind,
} from './utils.js';
import { ScopeKind } from './scope.js';

export default class ExpressionCompiler extends BaseCompiler {
    constructor(compiler: Compiler) {
        super(compiler);
    }
    visitNode(node: ts.Node, fillScope: boolean): binaryen.ExpressionRef {
        switch (node.kind) {
            case ts.SyntaxKind.Identifier: {
                const identifierNode = <ts.Identifier>node;
                const identifierName = identifierNode.getText();
                // find if the identifier is in the scope
                const currentScope = this.getCurrentScope();
                const valueInfo = currentScope?.findVariable(identifierName);
                if (valueInfo) {
                    if (currentScope?.isGlobalVariable.get(identifierName)) {
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
                } else {
                    if (currentScope!.kind == ScopeKind.GlobalScope) {
                        const currentStartBlockScope = this.getStartBlockScope(
                            currentScope!,
                        );
                        const startBlockValueInfo =
                            currentStartBlockScope.findVariable(
                                identifierName,
                                false,
                            );
                        if (startBlockValueInfo) {
                            return this.getLocalValue(
                                startBlockValueInfo.variableIndex,
                                startBlockValueInfo.variableType,
                            );
                        }
                    }
                }
                // TODO DELETE: error TS2304: Cannot find name.
                this.reportError(identifierNode, 'error TS2304');
                break;
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
                        this.getTypeChecker()!,
                    ),
                );
                binaryExpressionInfo.rightExpression = this.visit(
                    binaryExpressionNode.right,
                );
                binaryExpressionInfo.rightType = this.visit(
                    this.getVariableType(
                        binaryExpressionNode.right,
                        this.getTypeChecker()!,
                    ),
                );
                const operatorKind = binaryExpressionNode.operatorToken.kind;
                switch (operatorKind) {
                    case ts.SyntaxKind.PlusToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                OperatorKind.add,
                            );
                        break;
                    }
                    case ts.SyntaxKind.MinusToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                OperatorKind.sub,
                            );
                        break;
                    }
                    case ts.SyntaxKind.AsteriskToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                OperatorKind.mul,
                            );
                        break;
                    }
                    case ts.SyntaxKind.SlashToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                OperatorKind.div,
                            );
                        break;
                    }
                    case ts.SyntaxKind.GreaterThanToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                OperatorKind.gt,
                            );
                        break;
                    }
                    case ts.SyntaxKind.GreaterThanEqualsToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                OperatorKind.ge,
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
                                OperatorKind.lt,
                            );
                        break;
                    }
                    case ts.SyntaxKind.LessThanEqualsToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                OperatorKind.le,
                            );
                        break;
                    }
                    // "xx && xx expression"
                    case ts.SyntaxKind.AmpersandAmpersandToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                OperatorKind.and,
                            );
                        break;
                    }
                    // // "xx || xx expression"
                    case ts.SyntaxKind.BarBarToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                OperatorKind.or,
                            );
                        break;
                    }
                    case ts.SyntaxKind.EqualsEqualsToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                OperatorKind.eq,
                            );
                        break;
                    }
                    case ts.SyntaxKind.EqualsEqualsEqualsToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                OperatorKind.eq_eq,
                            );
                        break;
                    }
                    case ts.SyntaxKind.ExclamationEqualsToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                OperatorKind.ne,
                            );
                        break;
                    }
                    case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
                        binaryExpressionInfo.operator =
                            this.handleBinaryExpression(
                                binaryExpressionInfo,
                                OperatorKind.ne_ne,
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
                                OperatorKind.add,
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
                                    OperatorKind.sub,
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
                                    OperatorKind.mul,
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
                                    OperatorKind.div,
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

            case ts.SyntaxKind.CallExpression: {
                // TODO: add closure
                const callExpressionNode = <ts.CallExpression>node;
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
                    currentScope?.findFunctionScope(funcName);
                if (childFunctionScope) {
                    paramArray = childFunctionScope.getParamArray()!;
                    returnType = childFunctionScope.getReturnType()!;
                }
                if (paramArray?.length !== paramExpressionRefList.length) {
                    for (
                        let i = paramExpressionRefList.length;
                        i < paramArray?.length;
                        i++
                    ) {
                        paramExpressionRefList.push(
                            paramArray[i].variableInitial!,
                        );
                    }
                }
                // judge if the return value need to drop
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
        }
        return binaryen.none;
    }

    handleBinaryExpression(
        binaryExpressionInfo: BinaryExpressionInfo,
        operatorKind: OperatorKind,
    ): binaryen.ExpressionRef {
        if (binaryExpressionInfo.leftType === binaryen.f64) {
            if (binaryExpressionInfo.rightType === binaryen.f64) {
                switch (operatorKind) {
                    case OperatorKind.add: {
                        return this.getBinaryenModule().f64.add(
                            binaryExpressionInfo.leftExpression,
                            binaryExpressionInfo.rightExpression,
                        );
                    }
                    case OperatorKind.sub: {
                        return this.getBinaryenModule().f64.sub(
                            binaryExpressionInfo.leftExpression,
                            binaryExpressionInfo.rightExpression,
                        );
                    }
                    case OperatorKind.mul: {
                        return this.getBinaryenModule().f64.mul(
                            binaryExpressionInfo.leftExpression,
                            binaryExpressionInfo.rightExpression,
                        );
                    }
                    case OperatorKind.div: {
                        return this.getBinaryenModule().f64.div(
                            binaryExpressionInfo.leftExpression,
                            binaryExpressionInfo.rightExpression,
                        );
                    }
                    case OperatorKind.gt: {
                        return this.getBinaryenModule().f64.gt(
                            binaryExpressionInfo.leftExpression,
                            binaryExpressionInfo.rightExpression,
                        );
                    }
                    case OperatorKind.ge: {
                        return this.getBinaryenModule().f64.ge(
                            binaryExpressionInfo.leftExpression,
                            binaryExpressionInfo.rightExpression,
                        );
                    }
                    case OperatorKind.lt: {
                        return this.getBinaryenModule().f64.lt(
                            binaryExpressionInfo.leftExpression,
                            binaryExpressionInfo.rightExpression,
                        );
                    }
                    case OperatorKind.le: {
                        return this.getBinaryenModule().f64.le(
                            binaryExpressionInfo.leftExpression,
                            binaryExpressionInfo.rightExpression,
                        );
                    }
                    case OperatorKind.eq: {
                        return this.getBinaryenModule().f64.eq(
                            binaryExpressionInfo.leftExpression,
                            binaryExpressionInfo.rightExpression,
                        );
                    }
                    case OperatorKind.eq_eq: {
                        return this.getBinaryenModule().f64.eq(
                            binaryExpressionInfo.leftExpression,
                            binaryExpressionInfo.rightExpression,
                        );
                    }
                    case OperatorKind.ne: {
                        return this.getBinaryenModule().f64.ne(
                            binaryExpressionInfo.leftExpression,
                            binaryExpressionInfo.rightExpression,
                        );
                    }
                    case OperatorKind.ne_ne: {
                        return this.getBinaryenModule().f64.ne(
                            binaryExpressionInfo.leftExpression,
                            binaryExpressionInfo.rightExpression,
                        );
                    }
                }
            }
        }

        switch (operatorKind) {
            case OperatorKind.and:
            case OperatorKind.or: {
                return this.handleLogicalToken(
                    binaryExpressionInfo,
                    operatorKind,
                );
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
            this.getVariableType(operand, this.getTypeChecker()!),
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
                        OperatorKind.add,
                    );
                break;
            }
            case ts.SyntaxKind.MinusMinusToken: {
                unaryExpressionInfo.rightExpression =
                    this.handleBinaryExpression(
                        rightExpressionInfo,
                        OperatorKind.sub,
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

            case ts.SyntaxKind.MinusToken: {
                const operand = unaryExpressionNode.operand;
                const operandType = this.visit(
                    this.getVariableType(operand, this.getTypeChecker()!),
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
        const condExpression = this.visit(node.condition);
        const trueExpr = this.visit(node.whenTrue);
        const falseExpr = this.visit(node.whenFalse);
        const cond = this.toTrueOrFalse(
            condExpression,
            binaryen.getExpressionType(condExpression),
        );
        const commonType = this.getCommonType(
            binaryen.getExpressionType(trueExpr),
            binaryen.getExpressionType(falseExpr),
        );
        const convertedTrue = this.convertType(
            trueExpr,
            binaryen.getExpressionType(trueExpr),
            commonType,
        );
        const convertedFalse = this.convertType(
            falseExpr,
            binaryen.getExpressionType(falseExpr),
            commonType,
        );
        return module.select(cond, convertedTrue, convertedFalse);
    }

    handleExpressionStatement(
        identifierNode: ts.Identifier,
        binaryExpressionInfo: BinaryExpressionInfo,
        expressionKind: ExpressionKind,
    ): binaryen.ExpressionRef {
        // get the assigned identifier
        const assignedIdentifierName = identifierNode.getText();
        // find if the identifier is in the scope
        const currentScope = this.getCurrentScope();
        const valueInfo = currentScope?.findVariable(assignedIdentifierName);
        let globalLocalValueInfo;
        if (currentScope!.kind === ScopeKind.GlobalScope) {
            const currentStartBlockScope = this.getStartBlockScope(
                currentScope!,
            );
            globalLocalValueInfo = currentStartBlockScope.findVariable(
                assignedIdentifierName,
                false,
            );
        }
        if (valueInfo || globalLocalValueInfo) {
            // check if the variable is a const
            if (
                (valueInfo && valueInfo.variableAssign === AssignKind.const) ||
                (globalLocalValueInfo &&
                    globalLocalValueInfo.variableAssign === AssignKind.const)
            ) {
                this.reportError(identifierNode, 'error TS2588');
            }
            // check if the type is match
            if (
                this.matchType(
                    binaryExpressionInfo.leftType,
                    binaryExpressionInfo.rightType,
                )
            ) {
                if (expressionKind === ExpressionKind.equalsExpression) {
                    if (valueInfo) {
                        // check the variable is in global or in local
                        if (
                            currentScope?.isGlobalVariable.get(
                                assignedIdentifierName,
                            )
                        ) {
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
                    }
                } else if (
                    expressionKind === ExpressionKind.postfixUnaryExpression
                ) {
                    const blockArray: binaryen.ExpressionRef[] = [];
                    // get local value if postfixUnaryExpression's parent is not ExpressionStatement
                    if (
                        identifierNode.parent.parent.kind !==
                            ts.SyntaxKind.ExpressionStatement &&
                        identifierNode.parent.parent.kind !==
                            ts.SyntaxKind.ForStatement
                    ) {
                        if (
                            valueInfo &&
                            currentScope?.isGlobalVariable.get(
                                assignedIdentifierName,
                            )
                        ) {
                            blockArray.push(
                                this.getGlobalValue(
                                    valueInfo.variableName,
                                    binaryExpressionInfo.leftType,
                                ),
                            );
                        } else {
                            if (!valueInfo && globalLocalValueInfo) {
                                blockArray.push(
                                    this.getLocalValue(
                                        globalLocalValueInfo.variableIndex,
                                        binaryExpressionInfo.leftType,
                                    ),
                                );
                            } else {
                                blockArray.push(
                                    this.getLocalValue(
                                        valueInfo!.variableIndex,
                                        binaryExpressionInfo.leftType,
                                    ),
                                );
                            }
                        }
                    }
                    if (
                        valueInfo &&
                        currentScope?.isGlobalVariable.get(
                            assignedIdentifierName,
                        )
                    ) {
                        blockArray.push(
                            this.setGlobalValue(
                                valueInfo.variableName,
                                binaryExpressionInfo.rightExpression,
                            ),
                        );
                    } else {
                        if (!valueInfo && globalLocalValueInfo) {
                            blockArray.push(
                                this.setLocalValue(
                                    globalLocalValueInfo.variableIndex,
                                    binaryExpressionInfo.rightExpression,
                                ),
                            );
                        } else {
                            blockArray.push(
                                this.setLocalValue(
                                    valueInfo!.variableIndex,
                                    binaryExpressionInfo.rightExpression,
                                ),
                            );
                        }
                    }
                    return this.getBinaryenModule().block(null, blockArray);
                } else if (
                    expressionKind === ExpressionKind.prefixUnaryExpression
                ) {
                    const blockArray: binaryen.ExpressionRef[] = [];
                    if (
                        valueInfo &&
                        currentScope?.isGlobalVariable.get(
                            assignedIdentifierName,
                        )
                    ) {
                        blockArray.push(
                            this.setGlobalValue(
                                valueInfo.variableName,
                                binaryExpressionInfo.rightExpression,
                            ),
                        );
                    } else {
                        if (!valueInfo && globalLocalValueInfo) {
                            blockArray.push(
                                this.setLocalValue(
                                    globalLocalValueInfo.variableIndex,
                                    binaryExpressionInfo.rightExpression,
                                ),
                            );
                        } else {
                            blockArray.push(
                                this.setLocalValue(
                                    valueInfo!.variableIndex,
                                    binaryExpressionInfo.rightExpression,
                                ),
                            );
                        }
                    }
                    // get local value if prefixUnaryExpression's parent is not ExpressionStatement
                    if (
                        identifierNode.parent.parent.kind !=
                            ts.SyntaxKind.ExpressionStatement &&
                        identifierNode.parent.parent.kind !=
                            ts.SyntaxKind.ForStatement
                    ) {
                        if (
                            valueInfo &&
                            currentScope?.isGlobalVariable.get(
                                assignedIdentifierName,
                            )
                        ) {
                            blockArray.push(
                                this.getGlobalValue(
                                    valueInfo.variableName,
                                    binaryExpressionInfo.leftType,
                                ),
                            );
                        } else {
                            if (!valueInfo && globalLocalValueInfo) {
                                blockArray.push(
                                    this.getLocalValue(
                                        globalLocalValueInfo.variableIndex,
                                        binaryExpressionInfo.leftType,
                                    ),
                                );
                            } else {
                                blockArray.push(
                                    this.getLocalValue(
                                        valueInfo!.variableIndex,
                                        binaryExpressionInfo.leftType,
                                    ),
                                );
                            }
                        }
                    }
                    return this.getBinaryenModule().block(null, blockArray);
                }
            } else {
                this.reportError(
                    identifierNode,
                    'Type mismatch in ExpressionStatement',
                );
            }
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
        operandExpression: binaryen.Type,
        operandType: binaryen.Type,
    ): binaryen.ExpressionRef {
        const condition = this.toTrueOrFalse(operandExpression, operandType);
        return this.getBinaryenModule().i32.eqz(condition);
    }

    handleLogicalToken(
        binaryExpressionInfo: BinaryExpressionInfo,
        operatorKind: OperatorKind,
    ): binaryen.ExpressionRef {
        const left = binaryExpressionInfo.leftExpression;
        const leftType = binaryExpressionInfo.leftType;
        const right = binaryExpressionInfo.rightExpression;
        const rightType = binaryExpressionInfo.rightType;
        const module = this.getBinaryenModule();

        const condition = this.toTrueOrFalse(left, leftType);
        const commonType = this.getCommonType(leftType, rightType);
        const convertedLeft = this.convertType(left, leftType, commonType);
        const convertedRight = this.convertType(right, rightType, commonType);

        if (operatorKind === OperatorKind.and) {
            return module.select(condition, convertedRight, convertedLeft);
        } else if (operatorKind === OperatorKind.or) {
            return module.select(condition, convertedLeft, convertedRight);
        }
        return binaryen.none;
    }
}

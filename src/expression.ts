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
    visitNode(node: ts.Node): binaryen.ExpressionRef {
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
                // TODO: function hoisting
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
        const operatorKind = unaryExpressionNode.operator;
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
        }
        unaryExpressionInfo.rightType = binaryen.f64;
        return this.handleExpressionStatement(
            operand,
            unaryExpressionInfo,
            expressionKind,
        );
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
}

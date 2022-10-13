import ts from 'typescript';
import binaryen from 'binaryen';
import { Compiler } from './compiler.js';
import BaseCompiler from './base.js';
import {
    ForStatementInfo,
    IfStatementInfo,
    WhileStatementInfo,
    DoStatementInfo,
    LoopKind,
} from './utils.js';
import { BlockScope, ScopeKind } from './scope.js';

export default class StatementCompiler extends BaseCompiler {
    constructor(compiler: Compiler) {
        super(compiler);
    }
    visitNode(node: ts.Node): binaryen.ExpressionRef {
        switch (node.kind) {
            case ts.SyntaxKind.Block: {
                const blockNode = <ts.Block>node;
                // connet blockScope with its parentScope
                const parentScope = this.getCurrentScope()!;
                const blockScope = new BlockScope(parentScope);
                this.setCurrentScope(blockScope);
                // push the current block into stack
                this.getBlockScopeStack().push(blockScope);
                // get statements of body
                if (blockNode.statements.length !== 0) {
                    // push all statements into statementArray
                    for (let i = 0; i < blockNode.statements.length; i++) {
                        const childExpressionRef = this.visit(
                            blockNode.statements[i],
                        );
                        if (childExpressionRef != binaryen.none) {
                            this.getBlockScopeStack()
                                .peek()
                                .addStatement(childExpressionRef);
                        }
                    }
                }
                // get the current block
                const currentBlockScope = this.getBlockScopeStack().pop()!;
                this.setCurrentScope(currentBlockScope.getParent());
                return this.getBinaryenModule().block(
                    null,
                    currentBlockScope.getStatementArray(),
                );
            }

            case ts.SyntaxKind.VariableStatement: {
                const variableStatementNode = <ts.VariableStatement>node;
                return this.visit(variableStatementNode.declarationList);
            }

            case ts.SyntaxKind.ReturnStatement: {
                const returnStatementNode = <ts.ReturnStatement>node;
                if (returnStatementNode.expression === undefined) {
                    return this.getBinaryenModule().return(undefined);
                } else {
                    // get function's return type according to return value
                    const realReturnType = this.visit(
                        this.getVariableType(
                            returnStatementNode.expression,
                            this.getTypeChecker()!,
                        ),
                    );
                    const functionScope = this.getFunctionScopeStack().peek();
                    if (functionScope.getReturnTypeUndefined()) {
                        functionScope.setReturnType(realReturnType);
                    } else {
                        // TODO DELETE: error TS2322: Type A is not assignable to type B.
                        if (functionScope.getReturnType() !== realReturnType) {
                            this.reportError(
                                returnStatementNode,
                                'error TS2322',
                            );
                        }
                    }
                    return this.getBinaryenModule().return(
                        this.visit(returnStatementNode.expression),
                    );
                }
            }

            case ts.SyntaxKind.IfStatement: {
                const ifStatementNode = <ts.IfStatement>node;
                const ifStatementInfo: IfStatementInfo = {
                    condition: binaryen.none,
                    ifTrue: binaryen.none,
                    ifFalse: binaryen.none,
                };
                if (this.getCurrentScope()!.kind === ScopeKind.GlobalScope) {
                    this.setCurrentScope(
                        this.getStartBlockScope(this.getCurrentScope()!),
                    );
                }
                ifStatementInfo.condition = this.visit(
                    ifStatementNode.expression,
                );
                ifStatementInfo.ifTrue = this.visit(
                    ifStatementNode.thenStatement,
                );
                if (ifStatementNode.elseStatement) {
                    ifStatementInfo.ifFalse = this.visit(
                        ifStatementNode.elseStatement,
                    );
                }
                if (
                    this.getCurrentScope()!.kind === ScopeKind.StartBlockScope
                ) {
                    this.setCurrentScope(
                        this.getCurrentScope()!.getParent()!.getParent()!,
                    );
                }
                return this.handleStatement(
                    this.getBinaryenModule().if(
                        ifStatementInfo.condition,
                        ifStatementInfo.ifTrue,
                        ifStatementInfo.ifFalse,
                    ),
                );
            }

            case ts.SyntaxKind.ExpressionStatement: {
                const expressionStatementNode = <ts.ExpressionStatement>node;
                return this.handleStatement(
                    this.visit(expressionStatementNode.expression),
                );
            }

            case ts.SyntaxKind.ForStatement: {
                const forStatementNode = <ts.ForStatement>node;
                const loopLabel = 'for_loop_' + this.getLoopLabelArray().length;
                this.getLoopLabelArray().push(loopLabel);
                const forStatementInfo: ForStatementInfo = {
                    kind: LoopKind.for,
                    label: loopLabel,
                    initializer: binaryen.none,
                    condition: binaryen.none,
                    incrementor: binaryen.none,
                    statement: binaryen.none,
                };
                if (this.getCurrentScope()!.kind === ScopeKind.GlobalScope) {
                    this.setCurrentScope(
                        this.getStartBlockScope(this.getCurrentScope()!),
                    );
                }
                if (forStatementNode.initializer) {
                    forStatementInfo.initializer = this.visit(
                        forStatementNode.initializer,
                    );
                    const currentScope = this.getCurrentScope();
                    if (currentScope!.kind === ScopeKind.StartBlockScope) {
                        const currentStartBlockScope = <BlockScope>currentScope;
                        currentStartBlockScope.addStatement(
                            forStatementInfo.initializer,
                        );
                    } else {
                        this.getBlockScopeStack()
                            .peek()
                            .addStatement(forStatementInfo.initializer);
                    }
                }
                if (forStatementNode.condition) {
                    forStatementInfo.condition = this.visit(
                        forStatementNode.condition,
                    );
                }
                if (forStatementNode.incrementor) {
                    forStatementInfo.incrementor = this.visit(
                        forStatementNode.incrementor,
                    );
                }
                if (forStatementNode.statement) {
                    forStatementInfo.statement = this.visit(
                        forStatementNode.statement,
                    );
                }
                if (
                    this.getCurrentScope()!.kind === ScopeKind.StartBlockScope
                ) {
                    this.setCurrentScope(
                        this.getCurrentScope()!.getParent()!.getParent()!,
                    );
                }
                return this.handleStatement(
                    this.getBinaryenModule().loop(
                        forStatementInfo.label,
                        this.flattenLoopStatement(forStatementInfo),
                    ),
                );
            }

            case ts.SyntaxKind.ForInStatement: {
                // TODO
                break;
            }

            case ts.SyntaxKind.SwitchStatement: {
                // TODO
                break;
            }

            case ts.SyntaxKind.WhileStatement: {
                const whileStatementNode = <ts.WhileStatement>node;
                const loopLabel =
                    'while_loop_' + this.getLoopLabelArray().length;
                this.getLoopLabelArray().push(loopLabel);
                const whileStatementInfo: WhileStatementInfo = {
                    kind: LoopKind.while,
                    label: loopLabel,
                    condition: binaryen.none,
                    statement: binaryen.none,
                };
                if (this.getCurrentScope()!.kind === ScopeKind.GlobalScope) {
                    this.setCurrentScope(
                        this.getStartBlockScope(this.getCurrentScope()!),
                    );
                }
                if (
                    whileStatementNode.expression.pos ===
                    whileStatementNode.expression.end
                ) {
                    this.reportError(whileStatementNode, 'error TS1109');
                } else {
                    whileStatementInfo.condition = this.visit(
                        whileStatementNode.expression,
                    );
                }
                if (
                    whileStatementNode.statement.pos ===
                    whileStatementNode.statement.end
                ) {
                    this.reportError(whileStatementNode, 'error TS1109');
                } else {
                    whileStatementInfo.statement = this.visit(
                        whileStatementNode.statement,
                    );
                }
                if (
                    this.getCurrentScope()!.kind === ScopeKind.StartBlockScope
                ) {
                    this.setCurrentScope(
                        this.getCurrentScope()!.getParent()!.getParent()!,
                    );
                }
                return this.handleStatement(
                    this.getBinaryenModule().loop(
                        whileStatementInfo.label,
                        this.flattenLoopStatement(whileStatementInfo),
                    ),
                );
            }

            case ts.SyntaxKind.DoStatement: {
                const doStatementNode = <ts.DoStatement>node;
                const loopLabel = 'do_loop_' + this.getLoopLabelArray().length;
                this.getLoopLabelArray().push(loopLabel);
                const doStatementInfo: DoStatementInfo = {
                    kind: LoopKind.do,
                    label: loopLabel,
                    condition: binaryen.none,
                    statement: binaryen.none,
                };
                if (this.getCurrentScope()!.kind === ScopeKind.GlobalScope) {
                    this.setCurrentScope(
                        this.getStartBlockScope(this.getCurrentScope()!),
                    );
                }
                if (
                    doStatementNode.expression.pos ===
                    doStatementNode.expression.end
                ) {
                    this.reportError(doStatementNode, 'error TS1109');
                } else {
                    doStatementInfo.condition = this.visit(
                        doStatementNode.expression,
                    );
                }
                if (
                    doStatementNode.statement.pos ===
                    doStatementNode.statement.end
                ) {
                    this.reportError(doStatementNode, 'error TS1109');
                } else {
                    doStatementInfo.statement = this.visit(
                        doStatementNode.statement,
                    );
                }
                if (
                    this.getCurrentScope()!.kind === ScopeKind.StartBlockScope
                ) {
                    this.setCurrentScope(
                        this.getCurrentScope()!.getParent()!.getParent()!,
                    );
                }
                return this.handleStatement(
                    this.getBinaryenModule().loop(
                        doStatementInfo.label,
                        this.flattenLoopStatement(doStatementInfo),
                    ),
                );
            }

            case ts.SyntaxKind.EmptyStatement: {
                return binaryen.none;
            }
        }

        return binaryen.none;
    }

    flattenLoopStatement(loopStatementInfo: any): binaryen.ExpressionRef {
        const ifStatementInfo: IfStatementInfo = {
            condition: loopStatementInfo.condition,
            ifTrue: binaryen.none,
            ifFalse: binaryen.none,
        };
        if (loopStatementInfo.kind !== LoopKind.do) {
            const ifTrueBlockArray: binaryen.ExpressionRef[] = [];
            if (loopStatementInfo.statement !== binaryen.none) {
                ifTrueBlockArray.push(loopStatementInfo.statement);
            }
            if (loopStatementInfo.kind === LoopKind.for) {
                ifTrueBlockArray.push(loopStatementInfo.incrementor);
            }
            ifTrueBlockArray.push(
                this.getBinaryenModule().br(loopStatementInfo.label),
            );

            const ifTrueBlock = this.getBinaryenModule().block(
                null,
                ifTrueBlockArray,
            );
            ifStatementInfo.ifTrue = ifTrueBlock;
            return this.getBinaryenModule().if(
                ifStatementInfo.condition,
                ifStatementInfo.ifTrue,
            );
        } else {
            ifStatementInfo.ifTrue = this.getBinaryenModule().br(
                loopStatementInfo.label,
            );
            const blockArray: binaryen.ExpressionRef[] = [];
            if (loopStatementInfo.statement !== binaryen.none) {
                blockArray.push(loopStatementInfo.statement);
            }
            const ifExpression = this.getBinaryenModule().if(
                ifStatementInfo.condition,
                ifStatementInfo.ifTrue,
            );
            blockArray.push(ifExpression);
            return this.getBinaryenModule().block(null, blockArray);
        }
    }

    handleStatement(
        expressionRef: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        const currentScope = this.getCurrentScope();
        if (currentScope!.kind == ScopeKind.GlobalScope) {
            const currentStartBlockScope = this.getStartBlockScope(
                currentScope!,
            );
            currentStartBlockScope.addStatement(expressionRef);
            return binaryen.none;
        } else {
            return expressionRef;
        }
    }
}

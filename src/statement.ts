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
    visitNode(node: ts.Node, fillScope: boolean): binaryen.ExpressionRef {
        switch (node.kind) {
            case ts.SyntaxKind.Block: {
                const blockNode = <ts.Block>node;
                if (fillScope) {
                    this.setBlockScopeStructure(blockNode, fillScope);
                } else {
                    return this.visitStatementsOfBlock(blockNode);
                }
                break;
            }

            case ts.SyntaxKind.VariableStatement: {
                const variableStatementNode = <ts.VariableStatement>node;
                if (fillScope) {
                    this.visit(
                        variableStatementNode.declarationList,
                        fillScope,
                    );
                } else {
                    return this.visit(variableStatementNode.declarationList);
                }
                break;
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
                if (fillScope) {
                    if (
                        this.getCurrentScope()!.kind === ScopeKind.GlobalScope
                    ) {
                        this.setCurrentScope(
                            this.getStartBlockScope(this.getCurrentScope()!),
                        );
                    }
                    this.visit(ifStatementNode.thenStatement, fillScope);
                    if (ifStatementNode.elseStatement) {
                        this.visit(ifStatementNode.elseStatement, fillScope);
                    }
                    if (
                        this.getCurrentScope()!.kind ===
                        ScopeKind.StartBlockScope
                    ) {
                        this.setCurrentScope(
                            this.getCurrentScope()!.getParent()!.getParent()!,
                        );
                    }
                } else {
                    const ifStatementInfo: IfStatementInfo = {
                        condition: binaryen.none,
                        ifTrue: binaryen.none,
                        ifFalse: binaryen.none,
                    };
                    if (
                        this.getCurrentScope()!.kind === ScopeKind.GlobalScope
                    ) {
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
                        this.getCurrentScope()!.kind ===
                        ScopeKind.StartBlockScope
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
                break;
            }

            case ts.SyntaxKind.ExpressionStatement: {
                const expressionStatementNode = <ts.ExpressionStatement>node;
                if (!fillScope) {
                    return this.handleStatement(
                        this.visit(expressionStatementNode.expression),
                    );
                }
                break;
            }

            case ts.SyntaxKind.ForStatement: {
                const forStatementNode = <ts.ForStatement>node;
                if (fillScope) {
                    this.setOutofLoopScopeAsCurrentScopeInFillScope(
                        forStatementNode,
                    );
                    if (forStatementNode.initializer) {
                        this.visit(forStatementNode.initializer, fillScope);
                    }
                    this.visit(forStatementNode.statement, fillScope);
                    this.judgeGlobalScopeAsCurrentScope();
                } else {
                    const loopLabel =
                        'for_loop_' + this.getLoopLabelStack().size();
                    const breakLabels = this.getBreakLabelsStack();
                    breakLabels.push(loopLabel + 'block');
                    this.getLoopLabelStack().push(loopLabel);

                    const forStatementInfo: ForStatementInfo = {
                        kind: LoopKind.for,
                        label: loopLabel,
                        initializer: binaryen.none,
                        condition: binaryen.none,
                        incrementor: binaryen.none,
                        statement: binaryen.none,
                    };
                    this.setOutofLoopScopeAsCurrentScope(node);
                    if (forStatementNode.initializer) {
                        forStatementInfo.initializer = this.visit(
                            forStatementNode.initializer,
                        );
                        this.getBlockScopeStack()
                            .peek()
                            .addStatement(forStatementInfo.initializer);
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
                    const blockLabel = breakLabels.pop() as string;
                    this.judgeGlobalScopeAsCurrentScope();
                    this.getBlockScopeStack()
                        .peek()
                        .addStatement(
                            this.getBinaryenModule().loop(
                                forStatementInfo.label,
                                this.flattenLoopStatement(forStatementInfo),
                            ),
                        );
                    const currentOutofLoopBlock =
                        this.getBlockScopeStack().pop();
                    return this.handleStatement(
                        this.getBinaryenModule().block(
                            blockLabel,
                            currentOutofLoopBlock!.getStatementArray(),
                        ),
                    );
                }
                break;
            }

            case ts.SyntaxKind.ForInStatement: {
                // TODO
                break;
            }

            case ts.SyntaxKind.SwitchStatement: {
                const switchStatementNode = <ts.SwitchStatement>node;
                if (fillScope) {
                    this.visit(switchStatementNode.caseBlock, fillScope);
                } else {
                    const switchLabels = this.getSwitchLabelStack();
                    switchLabels.push(switchLabels.size());
                    const breakLabels = this.getBreakLabelsStack();
                    breakLabels.push('break-switch-' + switchLabels.size());
                    const switchExpressionRef = this.visit(
                        switchStatementNode.caseBlock,
                    );
                    switchLabels.pop();
                    breakLabels.pop();
                    return switchExpressionRef;
                }
                break;
            }

            case ts.SyntaxKind.CaseBlock: {
                const caseBlockNode = <ts.CaseBlock>node;
                if (fillScope) {
                    this.setBlockScopeStructure(caseBlockNode, fillScope);
                } else {
                    return this.visitStatementsOfBlock(caseBlockNode);
                }
                break;
            }

            case ts.SyntaxKind.CaseClause: {
                const caseClauseNode = <ts.CaseClause>node;
                if (fillScope) {
                    this.setBlockScopeStructure(caseClauseNode, fillScope);
                } else {
                    return this.visitStatementsOfBlock(caseClauseNode);
                }
                break;
            }

            case ts.SyntaxKind.DefaultClause: {
                const defaultClauseNode = <ts.DefaultClause>node;
                if (fillScope) {
                    this.setBlockScopeStructure(defaultClauseNode, fillScope);
                } else {
                    return this.visitStatementsOfBlock(defaultClauseNode);
                }
                break;
            }

            case ts.SyntaxKind.WhileStatement: {
                const whileStatementNode = <ts.WhileStatement>node;
                if (fillScope) {
                    this.setOutofLoopScopeAsCurrentScopeInFillScope(
                        whileStatementNode,
                    );
                    if (
                        whileStatementNode.statement.pos ===
                        whileStatementNode.statement.end
                    ) {
                        this.reportError(whileStatementNode, 'error TS1109');
                    } else {
                        this.visit(whileStatementNode.statement, fillScope);
                    }
                    this.judgeGlobalScopeAsCurrentScope();
                } else {
                    const loopLabel =
                        'while_loop_' + this.getLoopLabelStack().size();
                    const breakLabels = this.getBreakLabelsStack();
                    breakLabels.push(loopLabel + 'block');
                    this.getLoopLabelStack().push(loopLabel);

                    const whileStatementInfo: WhileStatementInfo = {
                        kind: LoopKind.while,
                        label: loopLabel,
                        condition: binaryen.none,
                        statement: binaryen.none,
                    };
                    this.setOutofLoopScopeAsCurrentScope(whileStatementNode);
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
                    whileStatementInfo.statement = this.visit(
                        whileStatementNode.statement,
                    );
                    const blockLabel = breakLabels.pop() as string;
                    this.judgeGlobalScopeAsCurrentScope();
                    this.getBlockScopeStack()
                        .peek()
                        .addStatement(
                            this.getBinaryenModule().loop(
                                whileStatementInfo.label,
                                this.flattenLoopStatement(whileStatementInfo),
                            ),
                        );
                    const currentOutofLoopBlock =
                        this.getBlockScopeStack().pop();
                    return this.handleStatement(
                        this.getBinaryenModule().block(
                            blockLabel,
                            currentOutofLoopBlock!.getStatementArray(),
                        ),
                    );
                }
                break;
            }

            case ts.SyntaxKind.DoStatement: {
                const doStatementNode = <ts.DoStatement>node;
                if (fillScope) {
                    this.setOutofLoopScopeAsCurrentScopeInFillScope(
                        doStatementNode,
                    );
                    if (
                        doStatementNode.statement.pos ===
                        doStatementNode.statement.end
                    ) {
                        this.reportError(doStatementNode, 'error TS1109');
                    } else {
                        this.visit(doStatementNode.statement, fillScope);
                    }
                    this.judgeGlobalScopeAsCurrentScope();
                } else {
                    const loopLabel =
                        'do_loop_' + this.getLoopLabelStack().size();
                    const breakLabels = this.getBreakLabelsStack();
                    breakLabels.push(loopLabel + 'block');
                    this.getLoopLabelStack().push(loopLabel);

                    const doStatementInfo: DoStatementInfo = {
                        kind: LoopKind.do,
                        label: loopLabel,
                        condition: binaryen.none,
                        statement: binaryen.none,
                    };
                    this.setOutofLoopScopeAsCurrentScope(doStatementNode);
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
                    doStatementInfo.statement = this.visit(
                        doStatementNode.statement,
                    );
                    const blockLabel = breakLabels.pop() as string;
                    this.judgeGlobalScopeAsCurrentScope();
                    this.getBlockScopeStack()
                        .peek()
                        .addStatement(
                            this.getBinaryenModule().loop(
                                doStatementInfo.label,
                                this.flattenLoopStatement(doStatementInfo),
                            ),
                        );
                    const currentOutofLoopBlock =
                        this.getBlockScopeStack().pop();
                    return this.handleStatement(
                        this.getBinaryenModule().block(
                            blockLabel,
                            currentOutofLoopBlock!.getStatementArray(),
                        ),
                    );
                }
                break;
            }

            case ts.SyntaxKind.EmptyStatement: {
                return binaryen.none;
            }

            case ts.SyntaxKind.BreakStatement: {
                if (!fillScope) {
                    const module = this.getBinaryenModule();
                    const breakStatementNode = <ts.BreakStatement>node;
                    if (breakStatementNode.label) {
                        // not support goto currently
                        this.reportError(
                            breakStatementNode,
                            'Not support goto',
                        );
                        return module.unreachable();
                    }
                    const labels = this.getBreakLabelsStack();
                    if (!labels.size()) {
                        this.reportError(
                            breakStatementNode,
                            'parse failed, breakLabelsStack is empty',
                        );
                        return module.unreachable();
                    }
                    return module.br(labels.peek());
                }
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

    handleCaseBlock(
        caseBlockNode: ts.CaseBlock,
        currentBlockScope: BlockScope,
    ) {
        const module = this.getBinaryenModule();
        const clauses = caseBlockNode.clauses;
        // if empty statement
        if (clauses.length === 0) {
            return module.nop();
        }
        const breakLabelsStack = this.getBreakLabelsStack();
        const branches: binaryen.ExpressionRef[] = new Array(clauses.length);
        const switchLabels = this.getSwitchLabelStack();
        const switchLabel = '_' + switchLabels.peek().toString();
        let indexOfDefault = -1;
        let idx = 0;
        clauses.forEach((clause, i) => {
            if (ts.isDefaultClause(clause)) {
                indexOfDefault = i;
            } else {
                const caseClause = <ts.CaseClause>clause;
                // TODO: here just deal with number type, maybe need put br.condition in a common funcion for
                // dealing with more types.
                branches[idx++] = module.br(
                    'case' + i + switchLabel,
                    module.f64.eq(
                        this.visit(caseBlockNode.parent.expression),
                        this.visit(caseClause.expression),
                    ),
                );
            }
        });
        const default_label =
            indexOfDefault === -1
                ? breakLabelsStack.peek()
                : 'case' + indexOfDefault + switchLabel;
        branches[idx] = module.br(default_label);

        let block = module.block('case0' + switchLabel, branches);
        clauses.forEach((clause, i) => {
            const label =
                i === clauses.length - 1
                    ? breakLabelsStack.peek()
                    : 'case' + (i + 1) + switchLabel;
            block = module.block(label, [block].concat(this.visit(clause)));
        });
        currentBlockScope.addStatement(block);
        return currentBlockScope.getStatementArray()[0];
    }

    handleClause(
        clauseNode: ts.CaseClause | ts.DefaultClause,
        currentClauseScope: BlockScope,
    ): binaryen.ExpressionRef {
        for (let i = 0; i < clauseNode.statements.length; i++) {
            currentClauseScope.addStatement(
                this.visit(clauseNode.statements[i]),
            );
        }
        return this.getBinaryenModule().block(
            null,
            currentClauseScope.getStatementArray(),
        );
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

    setOutofLoopScopeAsCurrentScopeInFillScope(node: ts.Node) {
        this.judgeStartBlockScopeAsCurrentScope();
        const outofLoopBlock = new BlockScope(this.getCurrentScope()!);
        outofLoopBlock.setCorNode(node);
        this.getBlockScopeStack().push(outofLoopBlock);
        this.setCurrentScope(outofLoopBlock);
    }

    setOutofLoopScopeAsCurrentScope(node: ts.Node) {
        this.judgeStartBlockScopeAsCurrentScope();
        let outofLoopBlockScope = null;
        for (let i = 0; i < this.getCurrentScope()!.getChildren().length; i++) {
            const child = this.getCurrentScope()!.getChildren()[i];
            if (child.getCorNode() === node) {
                outofLoopBlockScope = child;
            }
        }
        if (outofLoopBlockScope === null) {
            this.reportError(
                node,
                'Cannot find the out block of loop statement',
            );
        }
        this.setCurrentScope(outofLoopBlockScope);
        this.getBlockScopeStack().push(<BlockScope>outofLoopBlockScope);
    }

    judgeGlobalScopeAsCurrentScope() {
        if (
            this.getCurrentScope()!.getParent()!.kind ===
            ScopeKind.StartBlockScope
        ) {
            this.setCurrentScope(
                this.getCurrentScope()!.getParent()!.getParent()!.getParent()!,
            );
        }
    }

    judgeStartBlockScopeAsCurrentScope() {
        if (this.getCurrentScope()!.kind === ScopeKind.GlobalScope) {
            this.setCurrentScope(
                this.getStartBlockScope(this.getCurrentScope()!),
            );
        }
    }

    setBlockScopeStructure(
        node: ts.BlockLike | ts.CaseBlock,
        fillScope = true,
    ) {
        const parentScope = this.getCurrentScope()!;
        const blockScope = new BlockScope(parentScope);
        blockScope.setCorNode(node);
        this.setCurrentScope(blockScope);
        this.getBlockScopeStack().push(blockScope);
        let statements;
        if (ts.isCaseBlock(node)) {
            const caseBlockNode = <ts.CaseBlock>node;
            statements = caseBlockNode.clauses;
        } else {
            statements = node.statements;
        }
        if (statements.length !== 0) {
            // get all internal block structure
            for (let i = 0; i < statements.length; i++) {
                this.visit(statements[i], fillScope);
            }
        }
        const currentBlockScope = this.getBlockScopeStack().pop()!;
        this.setCurrentScope(currentBlockScope.getParent());
    }

    visitStatementsOfBlock(
        node: ts.BlockLike | ts.CaseBlock,
    ): binaryen.ExpressionRef {
        const parentScope = this.getCurrentScope()!;
        let blockScope;
        for (let i = 0; i < parentScope.getChildren().length; i++) {
            const child = parentScope.getChildren()[i];
            if (child.getCorNode() === node) {
                blockScope = child;
                break;
            }
        }
        if (!blockScope) {
            return binaryen.none;
        }
        const currentBlockScope = <BlockScope>blockScope;
        this.getBlockScopeStack().push(currentBlockScope);
        this.setCurrentScope(currentBlockScope);

        let expressionRef;
        if (ts.isCaseBlock(node)) {
            const caseBlockNode = <ts.CaseBlock>node;
            expressionRef = this.handleCaseBlock(
                caseBlockNode,
                currentBlockScope,
            );
        } else if (ts.isCaseClause(node)) {
            const caseClauseNode = <ts.CaseClause>node;
            expressionRef = this.handleClause(
                caseClauseNode,
                currentBlockScope,
            );
        } else if (ts.isDefaultClause(node)) {
            const defaultClauseNode = <ts.DefaultClause>node;
            expressionRef = this.handleClause(
                defaultClauseNode,
                currentBlockScope,
            );
        } else {
            if (node.statements.length !== 0) {
                // push all statements into statementArray
                for (let i = 0; i < node.statements.length; i++) {
                    const childExpressionRef = this.visit(node.statements[i]);
                    if (childExpressionRef != binaryen.none) {
                        currentBlockScope.addStatement(childExpressionRef);
                    }
                }
            }
            expressionRef = this.getBinaryenModule().block(
                null,
                currentBlockScope.getStatementArray(),
            );
        }
        const topBlockScope = this.getBlockScopeStack().pop()!;
        this.setCurrentScope(topBlockScope.getParent());
        return expressionRef;
    }
}

import { assert } from 'console';
import ts from 'typescript';
import { Compiler } from './compiler';
import { Expression } from './expression';

type StatementKind = ts.SyntaxKind;

export class Statement {
    constructor(private kind: StatementKind) {}

    get statementKind(): StatementKind {
        return this.kind;
    }
}

export class IfStatement extends Statement {
    constructor(
        private condition: Expression,
        private ifTrue: Statement,
        private ifFalse: Statement | null,
    ) {
        super(ts.SyntaxKind.IfStatement);
    }

    get ifCondition(): Expression {
        return this.condition;
    }

    get ifIfTrue(): Statement {
        return this.ifTrue;
    }

    get ifIfFalse(): Statement | null {
        return this.ifFalse;
    }
}

export class BlockStatement extends Statement {
    constructor(private blockStatements: Statement[]) {
        super(ts.SyntaxKind.Block);
    }

    get statements(): Statement[] {
        return this.blockStatements;
    }
}

export class ReturnStatement extends Statement {
    constructor(private expr: Expression | null) {
        super(ts.SyntaxKind.ReturnStatement);
    }

    get returnExpression(): Expression | null {
        return this.expr;
    }
}

// create 'while' or 'do...while' loop
export class BaseLoopStatement extends Statement {
    constructor(
        kind: StatementKind,
        private label: string,
        private cond: Expression,
        private body: Statement,
    ) {
        super(kind);
    }

    get loopLabel(): string {
        return this.label;
    }

    get loopCondtion(): Expression {
        return this.cond;
    }

    get loopBody(): Statement {
        return this.body;
    }
}

export class ForStatement extends Statement {
    constructor(
        private label: string,
        private cond: Expression | null,
        private body: Statement,
        private initializer: Statement | null,
        private incrementor: Expression | null,
    ) {
        super(ts.SyntaxKind.ForStatement);
    }

    get forLoopLabel(): string {
        return this.label;
    }

    get forLoopCondtion(): Expression | null {
        return this.cond;
    }

    get forLoopBody(): Statement {
        return this.body;
    }

    get forLoopInitializer(): Statement | null {
        return this.initializer;
    }

    get forLoopIncrementor(): Expression | null {
        return this.incrementor;
    }
}

export class ExpressionStatement extends Statement {
    constructor(private expr: Expression) {
        super(ts.SyntaxKind.ExpressionStatement);
    }

    get expression(): Expression {
        return this.expr;
    }
}

export class EmptyStatement extends Statement {
    constructor() {
        super(ts.SyntaxKind.EmptyStatement);
    }
}

export class CaseClause extends Statement {
    constructor(private expr: Expression, private statements: Statement[]) {
        super(ts.SyntaxKind.CaseClause);
    }

    get caseExpr(): Expression {
        return this.expr;
    }

    get caseStatements(): Statement[] {
        return this.statements;
    }
}

export class DefaultClause extends Statement {
    constructor(private statements: Statement[]) {
        super(ts.SyntaxKind.DefaultClause);
    }

    get defaultCaseStatements(): Statement[] {
        return this.statements;
    }
}

export class CaseBlock extends Statement {
    constructor(private causes: Statement[]) {
        super(ts.SyntaxKind.CaseBlock);
    }

    get caseCauses(): Statement[] {
        return this.causes;
    }
}
export class SwitchStatement extends Statement {
    constructor(
        private cond: Expression,
        private caseBlock: Statement,
        private breakLabel: string,
    ) {
        super(ts.SyntaxKind.SwitchStatement);
    }

    get switchCondition(): Expression {
        return this.cond;
    }

    get switchCaseBlock(): Statement {
        return this.caseBlock;
    }

    get switchBreakLabel(): string {
        return this.breakLabel;
    }
}

export class BreakStatement extends Statement {
    constructor(private label: string) {
        super(ts.SyntaxKind.BreakStatement);
    }

    get breakLabel(): string {
        return this.label;
    }
}

export default class StatementCompiler {
    constructor(private compilerCtx: Compiler) {}

    visit(nodes: Array<ts.SourceFile>) {
        /* TODO: invoke visitNode on interested nodes */
        for (const sourceFile of nodes) {
            ts.forEachChild(sourceFile, this.visitNode);
        }
    }

    visitNode(node: ts.Node): Statement {
        switch (node.kind) {
            case ts.SyntaxKind.IfStatement: {
                const ifStatementNode = <ts.IfStatement>node;
                const condtion: Expression =
                    this.compilerCtx.expressionCompiler.visitNode(
                        ifStatementNode.expression,
                    );
                const ifTrue: Statement = this.visitNode(
                    ifStatementNode.thenStatement,
                );
                const ifFalse: Statement | null = ifStatementNode.elseStatement
                    ? this.visitNode(ifStatementNode.elseStatement)
                    : null;
                return new IfStatement(condtion, ifTrue, ifFalse);
            }
            case ts.SyntaxKind.Block: {
                const blockNode = <ts.Block>node;
                const statements = new Array<Statement>();
                for (let i = 0; i != blockNode.statements.length; ++i) {
                    statements.push(this.visitNode(blockNode.statements[i]));
                }
                return new Statement(ts.SyntaxKind.Unknown);
            }
            case ts.SyntaxKind.ReturnStatement: {
                const returnStatementNode = <ts.ReturnStatement>node;
                return new ReturnStatement(
                    returnStatementNode.expression
                        ? this.compilerCtx.expressionCompiler.visitNode(
                              returnStatementNode.expression,
                          )
                        : null,
                );
            }
            case ts.SyntaxKind.WhileStatement: {
                const whileStatementNode = <ts.WhileStatement>node;
                const loopLabel =
                    'while_loop_' + this.compilerCtx.loopLabels.size();
                const breakLabels = this.compilerCtx.breakLabels;
                breakLabels.push(loopLabel + 'block');
                this.compilerCtx.loopLabels.push(loopLabel);

                const expr = this.compilerCtx.expressionCompiler.visitNode(
                    whileStatementNode.expression,
                );
                const statement = this.visitNode(whileStatementNode.statement);
                return new BaseLoopStatement(
                    ts.SyntaxKind.WhileStatement,
                    loopLabel,
                    expr,
                    statement,
                );
            }
            case ts.SyntaxKind.DoStatement: {
                const doWhileStatementNode = <ts.DoStatement>node;
                const loopLabel =
                    'do_loop_' + this.compilerCtx.loopLabels.size();
                const breakLabels = this.compilerCtx.breakLabels;
                breakLabels.push(loopLabel + 'block');
                this.compilerCtx.loopLabels.push(loopLabel);

                const expr = this.compilerCtx.expressionCompiler.visitNode(
                    doWhileStatementNode.expression,
                );
                const statement = this.visitNode(
                    doWhileStatementNode.statement,
                );
                return new BaseLoopStatement(
                    ts.SyntaxKind.DoStatement,
                    loopLabel,
                    expr,
                    statement,
                );
            }
            case ts.SyntaxKind.ForStatement: {
                const forStatementNode = <ts.ForStatement>node;
                const loopLabel =
                    'for_loop_' + this.compilerCtx.loopLabels.size();
                const breakLabels = this.compilerCtx.breakLabels;
                breakLabels.push(loopLabel + 'block');
                this.compilerCtx.loopLabels.push(loopLabel);
                const initializer = forStatementNode.initializer
                    ? this.visitNode(forStatementNode.initializer)
                    : null;
                const cond = forStatementNode.condition
                    ? this.compilerCtx.expressionCompiler.visitNode(
                          forStatementNode.condition,
                      )
                    : null;
                const incrementor = forStatementNode.incrementor
                    ? this.compilerCtx.expressionCompiler.visitNode(
                          forStatementNode.incrementor,
                      )
                    : null;
                const statement = this.visitNode(forStatementNode.statement);

                return new ForStatement(
                    loopLabel,
                    cond,
                    statement,
                    initializer,
                    incrementor,
                );
            }
            case ts.SyntaxKind.ExpressionStatement: {
                const exprStatement = <ts.ExpressionStatement>node;
                return new ExpressionStatement(
                    this.compilerCtx.expressionCompiler.visitNode(
                        exprStatement.expression,
                    ),
                );
            }
            case ts.SyntaxKind.EmptyStatement: {
                return new EmptyStatement();
            }
            case ts.SyntaxKind.SwitchStatement: {
                const switchStatementNode = <ts.SwitchStatement>node;
                const switchLabels = this.compilerCtx.switchLabels;
                switchLabels.push(switchLabels.size());
                const breakLabels = this.compilerCtx.breakLabels;
                breakLabels.push('break-switch-' + switchLabels.size());
                // xxx: do the below in generating wasm code?
                // switchLabels.pop();
                // breakLabels.pop();
                const expr = this.compilerCtx.expressionCompiler.visitNode(
                    switchStatementNode.expression,
                );
                const caseBlock = this.visitNode(switchStatementNode.caseBlock);
                return new SwitchStatement(expr, caseBlock, breakLabels.peek());
            }
            case ts.SyntaxKind.CaseBlock: {
                const caseBlockNode = <ts.CaseBlock>node;
                const clauses = new Array<Statement>();
                for (let i = 0; i !== caseBlockNode.clauses.length; ++i) {
                    clauses.push(this.visitNode(caseBlockNode.clauses[i]));
                }
                return new CaseBlock(clauses);
            }
            case ts.SyntaxKind.CaseClause: {
                const caseClauseNode = <ts.CaseClause>node;
                const expr = this.compilerCtx.expressionCompiler.visitNode(
                    caseClauseNode.expression,
                );
                const statements = new Array<Statement>();
                const caseStatements = caseClauseNode.statements;
                for (let i = 0; i != caseStatements.length; ++i) {
                    statements.push(this.visitNode(caseStatements[i]));
                }
                return new CaseClause(expr, statements);
            }
            case ts.SyntaxKind.DefaultClause: {
                const defaultClauseNode = <ts.DefaultClause>node;
                const statements = new Array<Statement>();
                const caseStatements = defaultClauseNode.statements;
                for (let i = 0; i != caseStatements.length; ++i) {
                    statements.push(this.visitNode(caseStatements[i]));
                }
                return new DefaultClause(statements);
            }
            case ts.SyntaxKind.BreakStatement: {
                const breakStatementNode = <ts.BreakStatement>node;
                assert(!breakStatementNode.label, 'not support goto');
                return new BreakStatement(this.compilerCtx.breakLabels.peek());
            }
            default:
                return new Statement(ts.SyntaxKind.Unknown);
        }
    }
}

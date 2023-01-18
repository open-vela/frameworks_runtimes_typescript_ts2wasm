import { assert } from 'console';
import ts from 'typescript';
import { Compiler } from './compiler.js';
import { Expression } from './expression.js';
import { GlobalScope, Scope } from './scope.js';
import { Stack } from './utils.js';

type StatementKind = ts.SyntaxKind;

export class Statement {
    private _scope: Scope | null = null;

    constructor(private kind: StatementKind) {}

    get statementKind(): StatementKind {
        return this.kind;
    }

    setScope(scope: Scope) {
        this._scope = scope;
    }

    getScope(): Scope | null {
        return this._scope;
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
    private _isFunctionBlock = false;

    constructor() {
        super(ts.SyntaxKind.Block);
    }

    setFunctionBlock(): void {
        this._isFunctionBlock = true;
    }

    isFunctionBlock(): boolean {
        return this._isFunctionBlock;
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
        private _loopLabel: string,
        private _blockLabel: string,
        private cond: Expression,
        private body: Statement,
    ) {
        super(kind);
    }

    get loopLabel(): string {
        return this._loopLabel;
    }

    get loopBlockLabel(): string {
        return this._blockLabel;
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
        private blockLabel: string,
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

    get forLoopBlockLabel(): string {
        return this.blockLabel;
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

    get caseStatements(): Statement[] {
        return this.statements;
    }
}

export class CaseBlock extends Statement {
    constructor(
        private _switchLabel: string,
        private _breakLabel: string,
        private causes: Statement[],
    ) {
        super(ts.SyntaxKind.CaseBlock);
    }

    get switchLabel(): string {
        return this._switchLabel;
    }

    get breakLabel(): string {
        return this._breakLabel;
    }

    get caseCauses(): Statement[] {
        return this.causes;
    }
}
export class SwitchStatement extends Statement {
    constructor(private cond: Expression, private caseBlock: Statement) {
        super(ts.SyntaxKind.SwitchStatement);
    }

    get switchCondition(): Expression {
        return this.cond;
    }

    get switchCaseBlock(): Statement {
        return this.caseBlock;
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
    private loopLabelStack = new Stack<string>();
    private breakLabelsStack = new Stack<string>();
    private switchLabelStack = new Stack<number>();

    constructor(private compilerCtx: Compiler) {}

    visit(nodes: Array<ts.SourceFile>) {
        for (const sourceFile of nodes) {
            const globalScope = this.compilerCtx.nodeScopeMap.get(
                sourceFile,
            ) as GlobalScope;
            for (const stmt of sourceFile.statements) {
                const compiledStmt = this.visitNode(stmt);
                if (compiledStmt.statementKind === ts.SyntaxKind.Unknown) {
                    continue;
                }
                globalScope.addStatement(compiledStmt);
            }
        }
    }

    visitNode(node: ts.Node): Statement {
        const prevScope = this.compilerCtx.currentScope;
        switch (node.kind) {
            case ts.SyntaxKind.VariableStatement: {
                return new Statement(ts.SyntaxKind.Unknown);
            }
            case ts.SyntaxKind.FunctionDeclaration: {
                /* function scope and Type have been determined */
                const funcDeclNode = <ts.FunctionDeclaration>node;
                this.compilerCtx.currentScope =
                    this.compilerCtx.nodeScopeMap.get(funcDeclNode) as Scope;
                const scope = this.compilerCtx.currentScope;
                if (funcDeclNode.body !== undefined) {
                    for (const stmt of funcDeclNode.body.statements) {
                        const compiledStmt = this.visitNode(stmt);
                        if (
                            compiledStmt.statementKind === ts.SyntaxKind.Unknown
                        ) {
                            continue;
                        }
                        scope.addStatement(compiledStmt);
                    }
                }
                this.compilerCtx.currentScope = prevScope;
                return new Statement(ts.SyntaxKind.Unknown);
            }
            case ts.SyntaxKind.ClassDeclaration: {
                const classDeclNode = <ts.ClassDeclaration>node;
                this.compilerCtx.currentScope =
                    this.compilerCtx.nodeScopeMap.get(classDeclNode) as Scope;
                for (const member of classDeclNode.members) {
                    if (
                        member.kind === ts.SyntaxKind.MethodDeclaration ||
                        member.kind === ts.SyntaxKind.SetAccessor ||
                        member.kind === ts.SyntaxKind.GetAccessor ||
                        member.kind === ts.SyntaxKind.Constructor
                    ) {
                        this.visitNode(member);
                    }
                }
                this.compilerCtx.currentScope = prevScope;
                return new Statement(ts.SyntaxKind.Unknown);
            }
            case ts.SyntaxKind.Constructor: {
                const ctorNode = <ts.ConstructorDeclaration>node;
                this.compilerCtx.currentScope =
                    this.compilerCtx.nodeScopeMap.get(ctorNode) as Scope;
                const scope = this.compilerCtx.currentScope;
                if (ctorNode.body !== undefined) {
                    for (const stmt of ctorNode.body.statements) {
                        const compiledStmt = this.visitNode(stmt);
                        if (
                            compiledStmt.statementKind === ts.SyntaxKind.Unknown
                        ) {
                            continue;
                        }
                        scope.addStatement(compiledStmt);
                    }
                }
                this.compilerCtx.currentScope = prevScope;
                return new Statement(ts.SyntaxKind.Unknown);
            }
            case ts.SyntaxKind.SetAccessor: {
                const setAccessorNode = <ts.SetAccessorDeclaration>node;
                this.compilerCtx.currentScope =
                    this.compilerCtx.nodeScopeMap.get(setAccessorNode) as Scope;
                const scope = this.compilerCtx.currentScope;
                if (setAccessorNode.body !== undefined) {
                    for (const stmt of setAccessorNode.body.statements) {
                        const compiledStmt = this.visitNode(stmt);
                        if (
                            compiledStmt.statementKind === ts.SyntaxKind.Unknown
                        ) {
                            continue;
                        }
                        scope.addStatement(compiledStmt);
                    }
                }
                this.compilerCtx.currentScope = prevScope;
                return new Statement(ts.SyntaxKind.Unknown);
            }
            case ts.SyntaxKind.GetAccessor: {
                const getAccessorNode = <ts.GetAccessorDeclaration>node;
                this.compilerCtx.currentScope =
                    this.compilerCtx.nodeScopeMap.get(getAccessorNode) as Scope;
                const scope = this.compilerCtx.currentScope;
                if (getAccessorNode.body !== undefined) {
                    for (const stmt of getAccessorNode.body.statements) {
                        const compiledStmt = this.visitNode(stmt);
                        if (
                            compiledStmt.statementKind === ts.SyntaxKind.Unknown
                        ) {
                            continue;
                        }
                        scope.addStatement(compiledStmt);
                    }
                }
                this.compilerCtx.currentScope = prevScope;
                return new Statement(ts.SyntaxKind.Unknown);
            }
            case ts.SyntaxKind.MethodDeclaration: {
                const methodNode = <ts.MethodDeclaration>node;
                this.compilerCtx.currentScope =
                    this.compilerCtx.nodeScopeMap.get(methodNode) as Scope;
                const scope = this.compilerCtx.currentScope;
                if (methodNode.body !== undefined) {
                    for (const stmt of methodNode.body.statements) {
                        const compiledStmt = this.visitNode(stmt);
                        if (
                            compiledStmt.statementKind === ts.SyntaxKind.Unknown
                        ) {
                            continue;
                        }
                        scope.addStatement(compiledStmt);
                    }
                }
                this.compilerCtx.currentScope = prevScope;
                return new Statement(ts.SyntaxKind.Unknown);
            }
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
                /* every ts.Block(without function.body) has a corresponding block scope and BlockStatement */
                const blockNode = <ts.Block>node;
                this.compilerCtx.currentScope =
                    this.compilerCtx.nodeScopeMap.get(blockNode) as Scope;
                const scope = <Scope>this.compilerCtx.currentScope;

                for (const stmt of blockNode.statements) {
                    const compiledStmt = this.visitNode(stmt);
                    if (compiledStmt.statementKind === ts.SyntaxKind.Unknown) {
                        continue;
                    }
                    scope.addStatement(compiledStmt);
                }
                const block = new BlockStatement();
                block.setScope(scope);
                this.compilerCtx.currentScope = prevScope;

                return block;
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
                this.compilerCtx.currentScope =
                    this.compilerCtx.nodeScopeMap.get(
                        whileStatementNode,
                    ) as Scope;
                const scope = this.compilerCtx.currentScope;
                const loopLabel = 'while_loop_' + this.loopLabelStack.size();
                const breakLabels = this.breakLabelsStack;
                breakLabels.push(loopLabel + 'block');
                const blockLabel = breakLabels.peek();
                this.loopLabelStack.push(loopLabel);

                const expr = this.compilerCtx.expressionCompiler.visitNode(
                    whileStatementNode.expression,
                );
                const statement = this.visitNode(whileStatementNode.statement);
                this.breakLabelsStack.pop();
                const loopStatment = new BaseLoopStatement(
                    ts.SyntaxKind.WhileStatement,
                    loopLabel,
                    blockLabel,
                    expr,
                    statement,
                );
                this.compilerCtx.currentScope = prevScope;
                loopStatment.setScope(scope);
                return loopStatment;
            }
            case ts.SyntaxKind.DoStatement: {
                const doWhileStatementNode = <ts.DoStatement>node;
                this.compilerCtx.currentScope =
                    this.compilerCtx.nodeScopeMap.get(
                        doWhileStatementNode,
                    ) as Scope;
                const scope = this.compilerCtx.currentScope;
                const loopLabel = 'do_loop_' + this.loopLabelStack.size();
                const breakLabels = this.breakLabelsStack;
                breakLabels.push(loopLabel + 'block');
                const blockLabel = breakLabels.peek();
                this.loopLabelStack.push(loopLabel);

                const expr = this.compilerCtx.expressionCompiler.visitNode(
                    doWhileStatementNode.expression,
                );
                const statement = this.visitNode(
                    doWhileStatementNode.statement,
                );
                this.breakLabelsStack.pop();
                const loopStatment = new BaseLoopStatement(
                    ts.SyntaxKind.DoStatement,
                    loopLabel,
                    blockLabel,
                    expr,
                    statement,
                );
                this.compilerCtx.currentScope = prevScope;
                loopStatment.setScope(scope);
                return loopStatment;
            }
            case ts.SyntaxKind.ForStatement: {
                const forStatementNode = <ts.ForStatement>node;
                this.compilerCtx.currentScope =
                    this.compilerCtx.nodeScopeMap.get(
                        forStatementNode,
                    ) as Scope;
                const scope = this.compilerCtx.currentScope;
                const loopLabel = 'for_loop_' + this.loopLabelStack.size();
                const breakLabels = this.breakLabelsStack;
                breakLabels.push(loopLabel + 'block');
                const blockLabel = breakLabels.peek();
                this.loopLabelStack.push(loopLabel);

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
                this.breakLabelsStack.pop();
                const forStatement = new ForStatement(
                    loopLabel,
                    blockLabel,
                    cond,
                    statement,
                    initializer,
                    incrementor,
                );
                this.compilerCtx.currentScope = prevScope;
                forStatement.setScope(scope);
                return forStatement;
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
                const switchLabels = this.switchLabelStack;
                switchLabels.push(switchLabels.size());
                const breakLabels = this.breakLabelsStack;
                breakLabels.push('break-switch-' + switchLabels.size());
                const expr = this.compilerCtx.expressionCompiler.visitNode(
                    switchStatementNode.expression,
                );
                const caseBlock = this.visitNode(switchStatementNode.caseBlock);
                switchLabels.pop();
                breakLabels.pop();
                return new SwitchStatement(expr, caseBlock);
            }
            case ts.SyntaxKind.CaseBlock: {
                const caseBlockNode = <ts.CaseBlock>node;
                this.compilerCtx.currentScope =
                    this.compilerCtx.nodeScopeMap.get(caseBlockNode) as Scope;
                const scope = this.compilerCtx.currentScope;
                const breakLabelsStack = this.breakLabelsStack;
                const switchLabels = this.switchLabelStack;
                const switchLabel = '_' + switchLabels.peek().toString();

                const clauses = new Array<Statement>();
                for (let i = 0; i !== caseBlockNode.clauses.length; ++i) {
                    clauses.push(this.visitNode(caseBlockNode.clauses[i]));
                }
                const caseBlock = new CaseBlock(
                    switchLabel,
                    breakLabelsStack.peek(),
                    clauses,
                );
                caseBlock.setScope(scope);
                this.compilerCtx.currentScope = prevScope;
                return caseBlock;
            }
            case ts.SyntaxKind.CaseClause: {
                const caseClauseNode = <ts.CaseClause>node;
                this.compilerCtx.currentScope =
                    this.compilerCtx.nodeScopeMap.get(caseClauseNode) as Scope;
                const scope = this.compilerCtx.currentScope;
                const expr = this.compilerCtx.expressionCompiler.visitNode(
                    caseClauseNode.expression,
                );
                const statements = new Array<Statement>();
                const caseStatements = caseClauseNode.statements;
                for (let i = 0; i != caseStatements.length; ++i) {
                    statements.push(this.visitNode(caseStatements[i]));
                }
                const caseCause = new CaseClause(expr, statements);
                this.compilerCtx.currentScope = prevScope;
                caseCause.setScope(scope);
                return caseCause;
            }
            case ts.SyntaxKind.DefaultClause: {
                const defaultClauseNode = <ts.DefaultClause>node;
                this.compilerCtx.currentScope =
                    this.compilerCtx.nodeScopeMap.get(
                        defaultClauseNode,
                    ) as Scope;
                const scope = this.compilerCtx.currentScope;
                const statements = new Array<Statement>();
                const caseStatements = defaultClauseNode.statements;
                for (let i = 0; i != caseStatements.length; ++i) {
                    statements.push(this.visitNode(caseStatements[i]));
                }
                const defaultClause = new DefaultClause(statements);
                this.compilerCtx.currentScope = prevScope;
                defaultClause.setScope(scope);
                return defaultClause;
            }
            case ts.SyntaxKind.BreakStatement: {
                const breakStatementNode = <ts.BreakStatement>node;
                assert(!breakStatementNode.label, 'not support goto');
                return new BreakStatement(this.breakLabelsStack.peek());
            }
            default:
                return new Statement(ts.SyntaxKind.Unknown);
        }
    }
}

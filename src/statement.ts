import ts from 'typescript';
import { assert } from 'console';
import { Compiler } from './compiler.js';
import {
    CallExpression,
    Expression,
    IdentifierExpression,
} from './expression.js';
import {
    FunctionScope,
    GlobalScope,
    NamespaceScope,
    Scope,
    ScopeKind,
} from './scope.js';
import {
    parentIsFunctionLike,
    Stack,
    getImportModulePath,
    getGlobalScopeByModuleName,
    importGlobalInfo,
    importFunctionInfo,
} from './utils.js';
import { Variable } from './variable.js';
import { BuiltinNames } from '../lib/builtin/builtinUtil.js';

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

export class VariableStatement extends Statement {
    private variableArray: Variable[] = [];

    constructor() {
        super(ts.SyntaxKind.VariableStatement);
    }

    addVariable(variable: Variable) {
        this.variableArray.push(variable);
    }

    get varArray(): Variable[] {
        return this.variableArray;
    }
}

export class ImportDeclaration extends Statement {
    importModuleStartFuncName = '';
    private _importGlobalArray: importGlobalInfo[] = [];
    private _importFunctionArray: importFunctionInfo[] = [];

    constructor() {
        super(ts.SyntaxKind.ImportDeclaration);
    }

    addImportGlobal(importGlobalInfo: importGlobalInfo) {
        this._importGlobalArray.push(importGlobalInfo);
    }

    addImportFunction(importFunctionInfo: importFunctionInfo) {
        this._importFunctionArray.push(importFunctionInfo);
    }

    get importGlobalArray(): importGlobalInfo[] {
        return this._importGlobalArray;
    }

    get importFunctionArray(): importFunctionInfo[] {
        return this._importFunctionArray;
    }
}

export default class StatementCompiler {
    private loopLabelStack = new Stack<string>();
    private breakLabelsStack = new Stack<string>();
    private switchLabelStack = new Stack<number>();
    private currentScope: Scope | null = null;

    constructor(private compilerCtx: Compiler) {}

    visit() {
        this.compilerCtx.nodeScopeMap.forEach((scope, node) => {
            this.currentScope = scope;
            if (
                scope.kind !== ScopeKind.BlockScope &&
                scope.kind !== ScopeKind.ClassScope
            ) {
                ts.forEachChild(node, (node) => {
                    const stmt = this.visitNode(node);
                    if (stmt) {
                        scope.addStatement(stmt);
                    }
                });
            }
        });
    }

    visitNode(node: ts.Node): Statement | null {
        switch (node.kind) {
            case ts.SyntaxKind.ImportDeclaration: {
                const importDeclaration = <ts.ImportDeclaration>node;
                // Get the import module name according to the relative position of enter scope
                const enterScope = this.compilerCtx.globalScopeStack.peek();
                const importModuleName = getImportModulePath(
                    importDeclaration,
                    enterScope,
                );
                const importModuleScope = getGlobalScopeByModuleName(
                    importModuleName,
                    this.compilerCtx.globalScopeStack,
                );
                const importStmt = new ImportDeclaration();
                if (!importModuleScope.isMarkStart) {
                    importStmt.importModuleStartFuncName =
                        importModuleScope.startFuncName;
                    importModuleScope.isMarkStart = true;
                    return importStmt;
                }
                const globalScope = this.currentScope!.getRootGloablScope()!;
                for (const importIdentifier of globalScope.identifierModuleImportMap.keys()) {
                    // find identifier, judge if it is declared
                    const res = globalScope.findIdentifier(importIdentifier);
                    if (res instanceof Variable) {
                        if (res.isDeclare) {
                            importStmt.addImportGlobal({
                                internalName: res.mangledName,
                                externalModuleName:
                                    BuiltinNames.external_module_name,
                                externalBaseName: res.varName,
                                globalType: res.varType,
                            });
                        }
                    } else if (res instanceof FunctionScope) {
                        if (res.isDeclare) {
                            importStmt.addImportFunction({
                                internalName: res.mangledName,
                                externalModuleName:
                                    BuiltinNames.external_module_name,
                                externalBaseName: res.funcName,
                                funcType: res.funcType,
                            });
                        }
                    }
                }
                return importStmt;
            }
            case ts.SyntaxKind.VariableStatement: {
                const varStatementNode = <ts.VariableStatement>node;
                const varStatement = new VariableStatement();
                const varDeclarationList = varStatementNode.declarationList;
                this.currentScope = this.compilerCtx.getScopeByNode(node)!;
                this.addVariableInVarStmt(varDeclarationList, varStatement);
                return varStatement;
            }
            case ts.SyntaxKind.FunctionDeclaration:
            case ts.SyntaxKind.FunctionExpression:
            case ts.SyntaxKind.ArrowFunction:
            case ts.SyntaxKind.ClassDeclaration:
            case ts.SyntaxKind.Constructor:
            case ts.SyntaxKind.SetAccessor:
            case ts.SyntaxKind.GetAccessor:
            case ts.SyntaxKind.MethodDeclaration:
            case ts.SyntaxKind.EndOfFileToken:
                /* Ignore end of file token */
                break;
            case ts.SyntaxKind.IfStatement: {
                const ifStatementNode = <ts.IfStatement>node;
                const condtion: Expression =
                    this.compilerCtx.expressionCompiler.visitNode(
                        ifStatementNode.expression,
                    );
                const ifTrue: Statement = this.visitNode(
                    ifStatementNode.thenStatement,
                )!;
                const ifFalse: Statement | null = ifStatementNode.elseStatement
                    ? this.visitNode(ifStatementNode.elseStatement)
                    : null;
                const ifStmt = new IfStatement(condtion, ifTrue, ifFalse);
                return ifStmt;
            }
            case ts.SyntaxKind.Block: {
                /* every ts.Block(without function.body) has a corresponding block scope and BlockStatement */
                const blockNode = <ts.Block>node;
                const scope = this.compilerCtx.getScopeByNode(blockNode)!;

                for (const stmt of blockNode.statements) {
                    const compiledStmt = this.visitNode(stmt)!;
                    if (!compiledStmt) {
                        continue;
                    }
                    scope.addStatement(compiledStmt);
                }

                /* Block of function scope, just add statements to parent scope,
                    don't create a new BlockStatement */
                if (parentIsFunctionLike(node)) {
                    return null;
                }

                const block = new BlockStatement();
                block.setScope(scope);
                return block;
            }
            case ts.SyntaxKind.ReturnStatement: {
                const returnStatementNode = <ts.ReturnStatement>node;
                const retStmt = new ReturnStatement(
                    returnStatementNode.expression
                        ? this.compilerCtx.expressionCompiler.visitNode(
                              returnStatementNode.expression,
                          )
                        : null,
                );
                return retStmt;
            }
            case ts.SyntaxKind.WhileStatement: {
                const whileStatementNode = <ts.WhileStatement>node;
                this.currentScope = this.compilerCtx.getScopeByNode(node)!;
                const scope = this.currentScope;
                const loopLabel = 'while_loop_' + this.loopLabelStack.size();
                const breakLabels = this.breakLabelsStack;
                breakLabels.push(loopLabel + 'block');
                const blockLabel = breakLabels.peek();
                this.loopLabelStack.push(loopLabel);

                const expr = this.compilerCtx.expressionCompiler.visitNode(
                    whileStatementNode.expression,
                );
                const statement = this.visitNode(whileStatementNode.statement)!;
                this.breakLabelsStack.pop();
                const loopStatment = new BaseLoopStatement(
                    ts.SyntaxKind.WhileStatement,
                    loopLabel,
                    blockLabel,
                    expr,
                    statement,
                );
                loopStatment.setScope(scope);
                return loopStatment;
            }
            case ts.SyntaxKind.DoStatement: {
                const doWhileStatementNode = <ts.DoStatement>node;
                this.currentScope = this.compilerCtx.getScopeByNode(node)!;
                const scope = this.currentScope;
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
                )!;
                this.breakLabelsStack.pop();
                const loopStatment = new BaseLoopStatement(
                    ts.SyntaxKind.DoStatement,
                    loopLabel,
                    blockLabel,
                    expr,
                    statement,
                );
                loopStatment.setScope(scope);
                return loopStatment;
            }
            case ts.SyntaxKind.ForStatement: {
                const forStatementNode = <ts.ForStatement>node;
                this.currentScope = this.compilerCtx.getScopeByNode(node)!;
                const scope = this.currentScope;
                const loopLabel = 'for_loop_' + this.loopLabelStack.size();
                const breakLabels = this.breakLabelsStack;
                breakLabels.push(loopLabel + 'block');
                const blockLabel = breakLabels.peek();
                this.loopLabelStack.push(loopLabel);

                let initializer = null;
                if (forStatementNode.initializer) {
                    initializer = this.visitNode(forStatementNode.initializer);
                }

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
                const statement = this.visitNode(forStatementNode.statement)!;
                this.breakLabelsStack.pop();
                const forStatement = new ForStatement(
                    loopLabel,
                    blockLabel,
                    cond,
                    statement,
                    initializer,
                    incrementor,
                );
                forStatement.setScope(scope);
                return forStatement;
            }
            case ts.SyntaxKind.ExpressionStatement: {
                const exprStatement = <ts.ExpressionStatement>node;
                const exprStmt = new ExpressionStatement(
                    this.compilerCtx.expressionCompiler.visitNode(
                        exprStatement.expression,
                    ),
                );
                return exprStmt;
            }
            case ts.SyntaxKind.EmptyStatement: {
                const emptyStmt = new EmptyStatement();
                return emptyStmt;
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
                const caseBlock = this.visitNode(
                    switchStatementNode.caseBlock,
                )!;
                switchLabels.pop();
                breakLabels.pop();
                const swicthStmt = new SwitchStatement(expr, caseBlock);
                return swicthStmt;
            }
            case ts.SyntaxKind.CaseBlock: {
                const caseBlockNode = <ts.CaseBlock>node;
                this.currentScope = this.compilerCtx.getScopeByNode(node)!;
                const scope = this.currentScope;
                const breakLabelsStack = this.breakLabelsStack;
                const switchLabels = this.switchLabelStack;
                const switchLabel = '_' + switchLabels.peek().toString();

                const clauses = new Array<Statement>();
                for (let i = 0; i !== caseBlockNode.clauses.length; ++i) {
                    clauses.push(this.visitNode(caseBlockNode.clauses[i])!);
                }
                const caseBlock = new CaseBlock(
                    switchLabel,
                    breakLabelsStack.peek(),
                    clauses,
                );
                caseBlock.setScope(scope);
                return caseBlock;
            }
            case ts.SyntaxKind.CaseClause: {
                const caseClauseNode = <ts.CaseClause>node;
                this.currentScope = this.compilerCtx.getScopeByNode(node)!;
                const scope = this.currentScope;
                const expr = this.compilerCtx.expressionCompiler.visitNode(
                    caseClauseNode.expression,
                );
                const statements = new Array<Statement>();
                const caseStatements = caseClauseNode.statements;
                for (let i = 0; i != caseStatements.length; ++i) {
                    statements.push(this.visitNode(caseStatements[i])!);
                }
                const caseCause = new CaseClause(expr, statements);
                caseCause.setScope(scope);
                return caseCause;
            }
            case ts.SyntaxKind.DefaultClause: {
                const defaultClauseNode = <ts.DefaultClause>node;
                this.currentScope = this.compilerCtx.getScopeByNode(node)!;
                const scope = this.currentScope;
                const statements = new Array<Statement>();
                const caseStatements = defaultClauseNode.statements;
                for (let i = 0; i != caseStatements.length; ++i) {
                    statements.push(this.visitNode(caseStatements[i])!);
                }
                const defaultClause = new DefaultClause(statements);
                defaultClause.setScope(scope);
                return defaultClause;
            }
            case ts.SyntaxKind.BreakStatement: {
                const breakStatementNode = <ts.BreakStatement>node;
                assert(!breakStatementNode.label, 'not support goto');
                const breakStmt = new BreakStatement(
                    this.breakLabelsStack.peek(),
                );
                return breakStmt;
            }
            case ts.SyntaxKind.BinaryExpression: {
                const exprStmt = new ExpressionStatement(
                    this.compilerCtx.expressionCompiler.visitNode(node),
                );
                return exprStmt;
            }
            default: {
                return null;
            }
            // throw Error(`Unknown statement type ${node.kind}`);
        }

        return null;
    }

    addVariableInVarStmt(
        varDeclarationList: ts.VariableDeclarationList,
        varStatement: VariableStatement,
    ) {
        for (const varDeclaration of varDeclarationList.declarations) {
            const varDecNode = <ts.VariableDeclaration>varDeclaration;
            const varName = (<ts.Identifier>varDecNode.name).getText()!;
            const variable = this.currentScope!.findVariable(varName);
            if (!variable) {
                throw new Error(
                    'can not find ' + varName + ' in current scope',
                );
            }
            varStatement.addVariable(variable);
        }
    }
}

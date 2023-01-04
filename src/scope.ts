import ts from 'typescript';
import { Type, TSFunction, Primitive } from './type.js';
import { Compiler } from './compiler.js';
import { Stack } from './utils.js';
import { Parameter, Variable } from './variable.js';
import { Statement } from './statement.js';

export enum ScopeKind {
    Scope,
    GlobalScope,
    FunctionScope,
    BlockScope,
}

export class Scope {
    kind = ScopeKind.Scope;
    children: Scope[] = [];
    parent: Scope | null;
    namedTypeMap: Map<string, Type> = new Map();
    private variableArray: Variable[] = [];

    constructor(parent: Scope | null) {
        this.parent = parent;
        if (this.parent !== null) {
            this.parent.addChild(this);
        }
    }

    addVariable(variableObj: Variable) {
        this.variableArray.push(variableObj);
    }

    get varArray(): Variable[] {
        return this.variableArray;
    }

    addChild(child: Scope) {
        this.children.push(child);
    }

    findVariable(variableName: string, nested = true): Variable | undefined {
        if (nested) {
            let currentScope: Scope | null = this;
            while (currentScope != null) {
                if (currentScope.findVariable(variableName, false)) {
                    return currentScope.findVariable(variableName, false);
                }
                currentScope = currentScope.parent;
            }
        } else {
            for (let i = 0; i < this.variableArray.length; i++) {
                if (this.variableArray[i].varName === variableName) {
                    return this.variableArray[i];
                }
            }
        }
    }

    findFunctionScope(
        functionName: string,
        nested = true,
    ): FunctionScope | undefined {
        if (nested) {
            let currentScope: Scope | null = this;
            while (currentScope !== null) {
                if (currentScope.findFunctionScope(functionName, false)) {
                    return currentScope.findFunctionScope(functionName, false);
                }
                currentScope = currentScope.parent;
            }
        } else {
            for (let i = 0; i < this.children.length; i++) {
                if (this.children[i].kind === ScopeKind.FunctionScope) {
                    const functionScope = <FunctionScope>this.children[i];
                    if (functionScope.funcName === functionName) {
                        return functionScope;
                    }
                }
            }
        }
    }

    getNearestFunctionScope() {
        let currentScope: Scope | null = this;
        while (currentScope !== null) {
            if (currentScope.kind === ScopeKind.FunctionScope) {
                return currentScope;
            }
            currentScope = currentScope.parent;
        }
        return null;
    }

    getRootGloablScope() {
        let currentScope: Scope | null = this;
        while (currentScope !== null) {
            if (currentScope.kind === ScopeKind.GlobalScope) {
                return currentScope;
            }
            currentScope = currentScope.parent;
        }
        return null;
    }

    getTypeFromCurrentScope(typeName: string): Type {
        const currentScope = this;
        if (!currentScope) {
            throw new Error('current scope is null');
        }
        const TSType = currentScope.namedTypeMap.get(typeName);
        if (!TSType) {
            throw new Error(typeName + 'do not exist');
        }
        return TSType;
    }
}

export class GlobalScope extends Scope {
    kind = ScopeKind.GlobalScope;
    private functionName = '~start';
    private statementArray: Statement[] = [];
    private startFunctionVariableArray: Variable[] = [];
    private functionType = new TSFunction();

    constructor(parent: Scope | null = null) {
        super(parent);
    }

    addStartFuncVar(variableObj: Variable) {
        this.startFunctionVariableArray.push(variableObj);
    }

    get startFuncVarArray(): Variable[] {
        return this.startFunctionVariableArray;
    }

    get startFuncName(): string {
        return this.functionName;
    }

    addStatement(statement: Statement) {
        this.statementArray.push(statement);
    }

    get startStateArray(): Statement[] {
        return this.statementArray;
    }

    get startFuncType(): TSFunction {
        return this.functionType;
    }
}

export class FunctionScope extends Scope {
    kind = ScopeKind.FunctionScope;
    private functionName = '';
    private parameterArray: Parameter[] = [];
    private modifiers: ts.SyntaxKind[] = [];
    private functionType = new TSFunction();

    constructor(parent: Scope) {
        super(parent);
    }

    addParameter(parameter: Parameter) {
        this.parameterArray.push(parameter);
    }

    get paramArray(): Parameter[] {
        return this.parameterArray;
    }

    setFuncName(name: string) {
        this.functionName = name;
    }

    get funcName(): string {
        return this.functionName;
    }

    addModifier(modifier: ts.SyntaxKind) {
        this.modifiers.push(modifier);
    }

    get funcModifiers(): ts.SyntaxKind[] {
        return this.modifiers;
    }

    setFuncType(type: TSFunction) {
        this.functionType = type;
    }

    get funcType(): TSFunction {
        return this.functionType;
    }

    findVariable(variableName: string, nested = true): Variable | undefined {
        if (nested) {
            let currentScope: Scope | null = this;
            while (currentScope != null) {
                if (currentScope.findVariable(variableName, false)) {
                    return currentScope.findVariable(variableName, false);
                }
                currentScope = currentScope.parent;
            }
        } else {
            for (let i = 0; i < this.paramArray.length; i++) {
                if (this.paramArray[i].varName === variableName) {
                    return this.paramArray[i];
                }
            }
            for (let i = 0; i < this.varArray.length; i++) {
                if (this.varArray[i].varName === variableName) {
                    return this.varArray[i];
                }
            }
        }
    }
}

export class BlockScope extends Scope {
    kind = ScopeKind.BlockScope;
    private statementArray: Statement[] = [];

    constructor(parent: Scope) {
        super(parent);
    }

    addStatement(statement: Statement) {
        this.statementArray.push(statement);
    }

    get stateArray(): Statement[] {
        return this.statementArray;
    }
}

export class ScopeScanner {
    globalScopeStack = new Stack<GlobalScope>();
    currentScope: Scope | null = null;
    nodeScopeMap = new Map<ts.Node, Scope>();

    constructor(private compilerCtx: Compiler) {}

    visit(nodes: Array<ts.SourceFile>) {
        for (const sourceFile of nodes) {
            this.visitNode(sourceFile);
        }
        this.compilerCtx.nodeScopeMap = this.nodeScopeMap;
        this.compilerCtx.globalScopeStack = this.globalScopeStack;
    }

    visitNode(node: ts.Node): void {
        switch (node.kind) {
            case ts.SyntaxKind.SourceFile: {
                const sourceFileNode = <ts.SourceFile>node;
                const globalScope = new GlobalScope();
                this.setCurrentScope(globalScope);
                this.globalScopeStack.push(globalScope);
                this.nodeScopeMap.set(sourceFileNode, globalScope);
                for (let i = 0; i < sourceFileNode.statements.length; i++) {
                    this.visitNode(sourceFileNode.statements[i]);
                }
                this.visitNode(sourceFileNode.endOfFileToken);
                break;
            }
            case ts.SyntaxKind.FunctionDeclaration: {
                const functionDeclarationNode = <ts.FunctionDeclaration>node;
                const parentScope = this.getCurrentScope();
                const functionScope = new FunctionScope(parentScope);
                this.setCurrentScope(functionScope);
                this.nodeScopeMap.set(functionDeclarationNode, functionScope);
                this.visitNode(functionDeclarationNode.body!);
                this.setCurrentScope(parentScope);
                break;
            }
            case ts.SyntaxKind.Block: {
                const blockNode = <ts.Block>node;
                this.setBlockScopeStructure(blockNode);
                break;
            }
            case ts.SyntaxKind.IfStatement: {
                const ifStatementNode = <ts.IfStatement>node;
                this.visitNode(ifStatementNode.thenStatement);
                if (ifStatementNode.elseStatement) {
                    this.visitNode(ifStatementNode.elseStatement);
                }
                break;
            }
            case ts.SyntaxKind.ForStatement: {
                const forStatementNode = <ts.ForStatement>node;
                this.setLoopScopeRelation(forStatementNode);
                break;
            }
            case ts.SyntaxKind.WhileStatement: {
                const whileStatementNode = <ts.WhileStatement>node;
                this.setLoopScopeRelation(whileStatementNode);
                break;
            }
            case ts.SyntaxKind.DoStatement: {
                const doStatementNode = <ts.DoStatement>node;
                this.setLoopScopeRelation(doStatementNode);
                break;
            }
            case ts.SyntaxKind.SwitchStatement: {
                const switchStatementNode = <ts.SwitchStatement>node;
                this.visitNode(switchStatementNode.caseBlock);
                break;
            }
            case ts.SyntaxKind.CaseBlock: {
                const caseBlockNode = <ts.CaseBlock>node;
                this.setBlockScopeStructure(caseBlockNode);
                break;
            }
            case ts.SyntaxKind.CaseClause: {
                const caseClauseNode = <ts.CaseClause>node;
                this.setBlockScopeStructure(caseClauseNode);
                break;
            }

            case ts.SyntaxKind.DefaultClause: {
                const defaultClauseNode = <ts.DefaultClause>node;
                this.setBlockScopeStructure(defaultClauseNode);
                break;
            }
        }
    }

    setCurrentScope(currentScope: Scope | null) {
        this.currentScope = currentScope;
    }

    getCurrentScope() {
        let scope = this.currentScope;
        if (!scope) {
            throw new Error('Current Scope is null');
        }
        scope = <Scope>scope;
        return scope;
    }

    setBlockScopeStructure(node: ts.BlockLike | ts.CaseBlock) {
        const parentScope = this.getCurrentScope();
        if (node.parent.kind !== ts.SyntaxKind.FunctionDeclaration) {
            const blockScope = new BlockScope(parentScope);
            this.setCurrentScope(blockScope);
            this.nodeScopeMap.set(node, blockScope);
        }
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
                this.visitNode(statements[i]);
            }
        }
        if (node.parent.kind !== ts.SyntaxKind.FunctionDeclaration) {
            this.setCurrentScope(parentScope);
        }
    }

    setOutOfLoopScopeStructure(node: ts.Node) {
        const currentScope = this.getCurrentScope();
        const outOfLoopBlock = new BlockScope(currentScope);
        this.setCurrentScope(outOfLoopBlock);
        this.nodeScopeMap.set(node, outOfLoopBlock);
    }

    removeOutOfLoopScope() {
        const currentScope = this.getCurrentScope();
        if (!currentScope.parent) {
            throw new Error('CurrentScope parent is null');
        }
        const parentScope = <Scope>currentScope.parent;
        this.setCurrentScope(parentScope);
    }

    setLoopScopeRelation(
        node: ts.ForStatement | ts.WhileStatement | ts.DoStatement,
    ) {
        this.setOutOfLoopScopeStructure(node);
        this.visitNode(node.statement);
        this.removeOutOfLoopScope();
    }
}

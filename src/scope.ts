import ts from 'typescript';
import binaryen from 'binaryen';
import { VariableInfo } from './utils.js';
import { Type } from './type.js';
import { Compiler } from './compiler.js';
import { Stack } from './utils.js';
import { Parameter, Variable } from './variable.js';

export enum ScopeKind {
    Scope,
    GlobalScope,
    FunctionScope,
    BlockScope,
}

export class Scope {
    kind = ScopeKind.Scope;
    variableArray: Variable[] = [];
    children: Scope[] = [];
    parent: Scope | null;
    judgedGlobalVariable = '';
    namedTypeMap: Map<string, Type> = new Map();

    constructor(parent: Scope | null) {
        this.parent = parent;
        if (this.parent !== null) {
            this.parent.addChild(this);
        }
    }

    addVariable(variableObj: Variable) {
        this.variableArray.push(variableObj);
    }

    getVariableArray() {
        return this.variableArray;
    }

    addChild(child: Scope) {
        this.children.push(child);
    }

    getChildren() {
        return this.children;
    }

    getParent() {
        return this.parent;
    }

    findVariable(variableName: string, nested = true): Variable | undefined {
        if (nested) {
            let currentScope: Scope | null = this;
            while (currentScope != null) {
                if (currentScope.findVariable(variableName, false)) {
                    if (currentScope.kind === ScopeKind.GlobalScope) {
                        this.setJudgedGlobalVariable(variableName);
                    }
                    return currentScope.findVariable(variableName, false);
                }
                currentScope = currentScope.getParent();
            }
        } else {
            for (let i = 0; i < this.variableArray.length; i++) {
                if (this.variableArray[i].varName === variableName) {
                    return this.variableArray[i];
                }
            }
        }
    }

    setJudgedGlobalVariable(variableName: string) {
        this.judgedGlobalVariable = variableName;
    }

    isGlobalVariable(variableName: string) {
        if (this.judgedGlobalVariable === variableName) {
            return true;
        }
        return false;
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
                currentScope = currentScope.getParent();
            }
        } else {
            for (let i = 0; i < this.children.length; i++) {
                if (this.children[i].kind === ScopeKind.FunctionScope) {
                    const functionScope = <FunctionScope>this.children[i];
                    if (functionScope.getFuncName() === functionName) {
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
            currentScope = currentScope.getParent();
        }
        return null;
    }

    getRootGloablScope() {
        let currentScope: Scope | null = this;
        while (currentScope !== null) {
            if (currentScope.kind === ScopeKind.GlobalScope) {
                return currentScope;
            }
            currentScope = currentScope.getParent();
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
    funcName = '';
    returnType: binaryen.Type = binaryen.none;
    returnTypeUndefined = false;
    body: binaryen.ExpressionRef = binaryen.none;
    modifiers: ts.SyntaxKind[] = [];
    statementArray: binaryen.ExpressionRef[] = [];
    startFunctionVariableArray: VariableInfo[] = [];

    constructor(parent: Scope | null = null) {
        super(parent);
    }

    addStartFunctionVariable(variableInfo: VariableInfo) {
        this.startFunctionVariableArray.push(variableInfo);
    }

    getStartFunctionVariableArray() {
        return this.startFunctionVariableArray;
    }

    setFuncName(name: string) {
        this.funcName = name;
    }

    getFuncName() {
        return this.funcName;
    }

    setReturnType(returnType: binaryen.Type) {
        this.returnType = returnType;
    }

    getReturnType() {
        return this.returnType;
    }

    setReturnTypeUndefined(returnTypeUndefined: boolean) {
        this.returnTypeUndefined = returnTypeUndefined;
    }

    getReturnTypeUndefined() {
        return this.returnTypeUndefined;
    }

    setBody(body: binaryen.ExpressionRef) {
        this.body = body;
    }

    getBody() {
        return this.body;
    }

    addModifier(modifier: ts.SyntaxKind) {
        this.modifiers.push(modifier);
    }

    getModifiers() {
        return this.modifiers;
    }

    addStatement(statement: binaryen.ExpressionRef) {
        this.statementArray.push(statement);
    }

    getStatementArray() {
        return this.statementArray;
    }
}

export class FunctionScope extends Scope {
    kind = ScopeKind.FunctionScope;
    funcName = '';
    paramArray: Parameter[] = [];
    returnType: binaryen.Type = binaryen.none;
    returnTypeUndefined = false;
    body: binaryen.ExpressionRef = binaryen.none;
    modifiers: ts.SyntaxKind[] = [];

    constructor(parent: Scope) {
        super(parent);
    }

    addParameter(parameter: Parameter) {
        this.paramArray.push(parameter);
    }

    getParamArray() {
        return this.paramArray;
    }

    setFuncName(name: string) {
        this.funcName = name;
    }

    getFuncName() {
        return this.funcName;
    }

    setReturnType(returnType: binaryen.Type) {
        this.returnType = returnType;
    }

    getReturnType() {
        return this.returnType;
    }

    setReturnTypeUndefined(returnTypeUndefined: boolean) {
        this.returnTypeUndefined = returnTypeUndefined;
    }

    getReturnTypeUndefined() {
        return this.returnTypeUndefined;
    }

    setBody(body: binaryen.ExpressionRef) {
        this.body = body;
    }

    getBody() {
        return this.body;
    }

    addModifier(modifier: ts.SyntaxKind) {
        this.modifiers.push(modifier);
    }

    getModifiers() {
        return this.modifiers;
    }

    findVariable(variableName: string, nested = true): Variable | undefined {
        if (nested) {
            let currentScope: Scope | null = this;
            while (currentScope != null) {
                if (currentScope.findVariable(variableName, false)) {
                    if (currentScope.kind === ScopeKind.GlobalScope) {
                        this.setJudgedGlobalVariable(variableName);
                    }
                    return currentScope.findVariable(variableName, false);
                }
                currentScope = currentScope.getParent();
            }
        } else {
            for (let i = 0; i < this.paramArray.length; i++) {
                if (this.paramArray[i].varName === variableName) {
                    return this.paramArray[i];
                }
            }
        }
    }
}

export class BlockScope extends Scope {
    kind = ScopeKind.BlockScope;
    statementArray: binaryen.ExpressionRef[] = [];

    constructor(parent: Scope) {
        super(parent);
    }

    addStatement(statement: binaryen.ExpressionRef) {
        this.statementArray.push(statement);
    }

    getStatementArray() {
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
        if (!currentScope.getParent()) {
            throw new Error('CurrentScope parent is null');
        }
        const parentScope = <Scope>currentScope.getParent();
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

import ts from 'typescript';
import { Expression } from './expression.js';
import { Type } from './type.js';
import { Compiler } from './compiler.js';
import {
    getNodeTypeInfo,
    Stack,
    CONST_KEYWORD,
    LET_KEYWORD,
    VAR_KEYWORD,
    getCurScope,
    getNearestFunctionScopeFromCurrent,
    generateNodeExpression,
} from './utils.js';
import { FunctionScope, GlobalScope, Scope } from './scope.js';

export enum ModifierKind {
    default,
    const,
    let,
    var,
    readonly,
}
export class Variable {
    private isClosure = false;
    constructor(
        private name: string,
        private type: Type,
        private modifier: ModifierKind,
        private index: number,
        private isLocal = true,
        private init: Expression | null = null,
    ) {}

    get varName(): string {
        return this.name;
    }

    get varType(): Type {
        return this.type;
    }

    get varModifier(): ModifierKind {
        return this.modifier;
    }

    set initExpression(init: Expression) {
        this.init = init;
    }

    get initExpression(): Expression {
        if (this.init === null) {
            throw new Error(
                'variable has not been initialized, variable name is <' +
                    this.name +
                    '>',
            );
        }
        return this.init;
    }

    get varIsClosure(): boolean {
        return this.isClosure;
    }

    get varIndex(): number {
        return this.index;
    }

    get isLocalVar(): boolean {
        return this.isLocal;
    }

    setVarIsClosure(): void {
        this.isClosure = true;
    }
}

export class Parameter extends Variable {
    private isOptional: boolean;
    private isDestructuring: boolean;

    constructor(
        name: string,
        type: Type,
        modifier: ModifierKind,
        index: number,
        isOptional: boolean,
        isDestructuring: boolean,
        init: Expression | null = null,
        isLocal = true,
    ) {
        super(name, type, modifier, index, isLocal, init);
        this.isOptional = isOptional;
        this.isDestructuring = isDestructuring;
    }

    get optional(): boolean {
        return this.isOptional;
    }

    get destructuring(): boolean {
        return this.isDestructuring;
    }
}

export class VariableScanner {
    typechecker: ts.TypeChecker | undefined = undefined;
    globalScopeStack = new Stack<GlobalScope>();
    currentScope: Scope | null = null;
    nodeScopeMap = new Map<ts.Node, Scope>();

    constructor(private compilerCtx: Compiler) {}

    visit(nodes: Array<ts.SourceFile>) {
        this.typechecker = this.compilerCtx.typeChecker;
        this.globalScopeStack = this.compilerCtx.globalScopeStack;
        this.nodeScopeMap = this.compilerCtx.nodeScopeMap;
        for (let i = 0; i < nodes.length; i++) {
            const sourceFile = nodes[i];
            this.currentScope = this.globalScopeStack.getItemAtIdx(i);
            this.visitNode(sourceFile);
        }
    }

    visitNode(node: ts.Node): void {
        this.findCurrentScope(node);
        switch (node.kind) {
            case ts.SyntaxKind.Parameter: {
                const parameterNode = <ts.ParameterDeclaration>node;
                const functionScope = <FunctionScope>(
                    getNearestFunctionScopeFromCurrent(this.currentScope)
                );
                // TODO: have not record DotDotDotToken
                const paramName = parameterNode.name.getText();
                let isDestructuring = false;
                if (
                    parameterNode.name.kind ===
                    ts.SyntaxKind.ObjectBindingPattern
                ) {
                    isDestructuring = true;
                }
                const isOptional =
                    parameterNode.questionToken === undefined ? false : true;
                const hasModifier =
                    parameterNode.modifiers === undefined ? false : true;
                let paramModifier = ModifierKind.default;
                if (hasModifier) {
                    const paramModifiers = parameterNode.modifiers!;
                    paramModifier =
                        paramModifiers[0].kind === ts.SyntaxKind.ReadonlyKeyword
                            ? ModifierKind.readonly
                            : ModifierKind.default;
                }
                const paramType =
                    parameterNode.type === undefined
                        ? functionScope.getTypeFromCurrentScope(
                              getNodeTypeInfo(
                                  parameterNode.name,
                                  this.typechecker!,
                              ).typeName,
                          )
                        : functionScope.getTypeFromCurrentScope(
                              getNodeTypeInfo(
                                  parameterNode.type,
                                  this.typechecker!,
                              ).typeName,
                          );
                const paramIndex = functionScope.paramArray.length;
                const paramObj = new Parameter(
                    paramName,
                    paramType,
                    paramModifier,
                    paramIndex,
                    isOptional,
                    isDestructuring,
                );
                functionScope.addParameter(paramObj);
                break;
            }
            case ts.SyntaxKind.VariableDeclaration: {
                const variableDeclarationNode = <ts.VariableDeclaration>node;
                const currentScope = this.getCurrentScope();
                const functionScope =
                    getNearestFunctionScopeFromCurrent(currentScope);
                let isLocalVar = true;
                let nearestScope;
                let variableIndex;
                if (!functionScope) {
                    isLocalVar = false;
                    nearestScope = <GlobalScope>(
                        currentScope.getRootGloablScope()
                    );
                    variableIndex = nearestScope.varArray.length;
                } else {
                    nearestScope = <FunctionScope>functionScope;
                    variableIndex =
                        nearestScope.paramArray.length +
                        nearestScope.varArray.length;
                }
                let variableModifier = ModifierKind.default;
                const variableAssignText =
                    variableDeclarationNode.parent.getText();
                if (variableAssignText.includes(CONST_KEYWORD)) {
                    variableModifier = ModifierKind.const;
                } else if (variableAssignText.includes(LET_KEYWORD)) {
                    variableModifier = ModifierKind.let;
                } else if (variableAssignText.includes(VAR_KEYWORD)) {
                    variableModifier = ModifierKind.var;
                }
                const variableName = variableDeclarationNode.name.getText();
                const variableType =
                    variableDeclarationNode.type === undefined
                        ? currentScope.getTypeFromCurrentScope(
                              getNodeTypeInfo(
                                  variableDeclarationNode.name,
                                  this.typechecker!,
                              ).typeName,
                          )
                        : currentScope.getTypeFromCurrentScope(
                              getNodeTypeInfo(
                                  variableDeclarationNode.type,
                                  this.typechecker!,
                              ).typeName,
                          );
                const variableObj = new Variable(
                    variableName,
                    variableType,
                    variableModifier,
                    variableIndex,
                    isLocalVar,
                );
                currentScope.addVariable(variableObj);
                break;
            }
        }
        ts.forEachChild(node, this.visitNode.bind(this));
    }

    getCurrentScope() {
        let scope = this.currentScope;
        if (!scope) {
            throw new Error('Current Scope is null');
        }
        scope = <Scope>scope;
        return scope;
    }

    findCurrentScope(node: ts.Node) {
        const currentScope = getCurScope(node, this.nodeScopeMap);
        if (!currentScope) {
            throw new Error('current scope is null');
        }
        this.currentScope = currentScope;
    }
}

export class VariableInit {
    typechecker: ts.TypeChecker | undefined = undefined;
    globalScopeStack = new Stack<GlobalScope>();
    currentScope: Scope | null = null;
    nodeScopeMap = new Map<ts.Node, Scope>();

    constructor(private compilerCtx: Compiler) {}

    visit(nodes: Array<ts.SourceFile>) {
        this.typechecker = this.compilerCtx.typeChecker;
        this.globalScopeStack = this.compilerCtx.globalScopeStack;
        this.nodeScopeMap = this.compilerCtx.nodeScopeMap;
        for (let i = 0; i < nodes.length; i++) {
            const sourceFile = nodes[i];
            this.currentScope = this.globalScopeStack.getItemAtIdx(i);
            this.visitNode(sourceFile);
        }
    }

    visitNode(node: ts.Node): void {
        this.findCurrentScope(node);
        switch (node.kind) {
            case ts.SyntaxKind.Parameter: {
                const parameterNode = <ts.ParameterDeclaration>node;
                const functionScope = <FunctionScope>(
                    getNearestFunctionScopeFromCurrent(this.currentScope)
                );
                const paramName = parameterNode.name.getText();
                const paramObj = functionScope.findVariable(paramName);
                if (!paramObj) {
                    throw new Error(
                        "don't find " + paramName + ' in current scope',
                    );
                }
                if (parameterNode.initializer) {
                    const paramInit = generateNodeExpression(
                        this.compilerCtx.expressionCompiler,
                        parameterNode.initializer,
                    );
                    paramObj.initExpression = paramInit;
                }
                break;
            }
            case ts.SyntaxKind.VariableDeclaration: {
                const variableDeclarationNode = <ts.VariableDeclaration>node;
                const currentScope = this.getCurrentScope();
                const variableName = variableDeclarationNode.name.getText();
                const variableObj = currentScope.findVariable(variableName);
                if (!variableObj) {
                    throw new Error(
                        "don't find " + variableName + ' in current scope',
                    );
                }
                if (variableDeclarationNode.initializer) {
                    const variableInit = generateNodeExpression(
                        this.compilerCtx.expressionCompiler,
                        variableDeclarationNode.initializer,
                    );
                    variableObj.initExpression = variableInit;
                }
                break;
            }
        }
        ts.forEachChild(node, this.visitNode.bind(this));
    }

    getCurrentScope() {
        let scope = this.currentScope;
        if (!scope) {
            throw new Error('Current Scope is null');
        }
        scope = <Scope>scope;
        return scope;
    }

    findCurrentScope(node: ts.Node) {
        const currentScope = getCurScope(node, this.nodeScopeMap);
        if (!currentScope) {
            throw new Error('current scope is null');
        }
        this.currentScope = currentScope;
    }
}

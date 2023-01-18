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
import { FunctionScope, GlobalScope, Scope, ScopeKind } from './scope.js';

export enum ModifierKind {
    default,
    const,
    let,
    var,
    readonly,
}
export class Variable {
    private isClosure = false;
    private closureIndex = 0;
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

    setInitExpr(expr: Expression) {
        this.init = expr;
    }

    get initExpression(): Expression | null {
        return this.init;
    }

    get varIsClosure(): boolean {
        return this.isClosure;
    }

    setClosureIndex(index: number) {
        this.closureIndex = index;
    }

    getClosureIndex(): number {
        return this.closureIndex;
    }

    setVarIndex(varIndex: number) {
        this.index = varIndex;
    }

    get varIndex(): number {
        return this.index;
    }

    get isLocalVar(): boolean {
        return this.isLocal;
    }

    setIsLocalVar(isLocal: boolean): void {
        this.isLocal = isLocal;
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
                if (node.parent.kind === ts.SyntaxKind.FunctionType) {
                    break;
                }
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
                let isOptional =
                    parameterNode.questionToken === undefined ? false : true;
                isOptional =
                    isOptional || parameterNode.initializer === undefined
                        ? false
                        : true;
                const paramModifier =
                    parameterNode.modifiers !== undefined &&
                    parameterNode.modifiers[0].kind ===
                        ts.SyntaxKind.ReadonlyKeyword
                        ? ModifierKind.readonly
                        : ModifierKind.default;
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
                let typeName = '';
                if (variableDeclarationNode.type === undefined) {
                    typeName = getNodeTypeInfo(
                        variableDeclarationNode.name,
                        this.typechecker!,
                    ).typeName;
                } else {
                    typeName = getNodeTypeInfo(
                        variableDeclarationNode.type,
                        this.typechecker!,
                    ).typeName;
                }
                if (typeName.startsWith('typeof')) {
                    typeName = typeName.substring(7);
                }
                const variableType =
                    currentScope.getTypeFromCurrentScope(typeName);
                // const variableType =
                //     variableDeclarationNode.type === undefined
                //         ? currentScope.getTypeFromCurrentScope(
                //               getNodeTypeInfo(
                //                   variableDeclarationNode.name,
                //                   this.typechecker!,
                //               ).typeName,
                //           )
                //         : currentScope.getTypeFromCurrentScope(
                //               getNodeTypeInfo(
                //                   variableDeclarationNode.type,
                //                   this.typechecker!,
                //               ).typeName,
                //           );
                const variable = new Variable(
                    variableName,
                    variableType,
                    variableModifier,
                    -1,
                    true,
                );
                /* iff in a global scope, set index based on global scope variable array */
                if (currentScope.kind === ScopeKind.GlobalScope) {
                    variable.setIsLocalVar(false);
                    variable.setVarIndex(currentScope.varArray.length);
                } else {
                    const functionScope =
                        getNearestFunctionScopeFromCurrent(currentScope);
                    /* under global scope, set index based on start function variable array */
                    if (!functionScope) {
                        if (currentScope.getRootGloablScope() === null) {
                            throw new Error('global scope is null');
                        }
                        variable.setVarIndex(
                            (<GlobalScope>currentScope.getRootGloablScope())
                                .startFuncVarArray.length,
                        );
                        (<GlobalScope>(
                            currentScope.getRootGloablScope()
                        )).addStartFuncVar(variable);
                    } else {
                        /* under function scope, set index based on function variable array */
                        variable.setVarIndex(
                            (<FunctionScope>functionScope).paramArray.length +
                                functionScope.varArray.length,
                        );
                        if (currentScope.kind !== ScopeKind.FunctionScope) {
                            functionScope.addVariable(variable);
                        }
                    }
                }

                if (variable.varIndex === -1) {
                    throw new Error(
                        'variable index is not set, variable name is <' +
                            variable.varName +
                            '>',
                    );
                }
                currentScope.addVariable(variable);
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
                if (node.parent.kind === ts.SyntaxKind.FunctionType) {
                    break;
                }
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
                    paramObj.setInitExpr(paramInit);
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
                    this.compilerCtx.currentScope = currentScope;
                    const variableInit = generateNodeExpression(
                        this.compilerCtx.expressionCompiler,
                        variableDeclarationNode.initializer,
                    );
                    variableObj.setInitExpr(variableInit);
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

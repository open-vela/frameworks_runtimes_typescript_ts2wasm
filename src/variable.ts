import ts from 'typescript';
import path from 'path';
import { Expression } from './expression.js';
import { Type } from './type.js';
import { Compiler } from './compiler.js';
import {
    Stack,
    CONST_KEYWORD,
    LET_KEYWORD,
    VAR_KEYWORD,
    generateNodeExpression,
    isScopeNode,
    getGlobalScopeByModuleName,
    getImportModulePath,
} from './utils.js';
import { FunctionScope, GlobalScope, Scope, ScopeKind } from './scope.js';

export enum ModifierKind {
    default = '',
    const = 'const',
    let = 'let',
    var = 'var',
    readonly = 'readonly',
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

    constructor(private compilerCtx: Compiler) {
        this.globalScopeStack = this.compilerCtx.globalScopeStack;
        this.nodeScopeMap = this.compilerCtx.nodeScopeMap;
    }

    visit() {
        this.typechecker = this.compilerCtx.typeChecker;
        this.nodeScopeMap.forEach((scope, node) => {
            this.currentScope = scope;
            ts.forEachChild(node, this.visitNode.bind(this));
        });
    }

    visitNode(node: ts.Node): void {
        switch (node.kind) {
            case ts.SyntaxKind.ImportDeclaration: {
                const importDeclaration = <ts.ImportDeclaration>node;
                const globalScope = this.currentScope!.getRootGloablScope()!;
                // Get the import module name according to the relative position of enter scope
                const enterScope = this.globalScopeStack.peek();
                const importModuleName = getImportModulePath(
                    importDeclaration,
                    enterScope,
                );
                const importModuleScope = getGlobalScopeByModuleName(
                    importModuleName,
                    this.globalScopeStack,
                );
                // get import identifier
                const importClause = importDeclaration.importClause;
                if (!importClause) {
                    // importing modules with side effects
                    // import "otherModule"
                    // TODO
                    break;
                }
                const namedImports = <ts.NamedImports>(
                    importClause.namedBindings
                );
                if (namedImports) {
                    // import regular exports from other module
                    // import {module_case2_var1, module_case2_func1} from './module-case2';
                    for (const importSpecifier of namedImports.elements) {
                        const specificIdentifier = <ts.Identifier>(
                            importSpecifier.name
                        );
                        const specificName = specificIdentifier.getText()!;
                        globalScope.addImportIdentifier(
                            specificName,
                            importModuleScope,
                        );
                        // globalScope.addImportIdentifier(
                        //     this.compilerCtx.moduleScopeMap.get(
                        //         importModuleName,
                        //     )!.startFuncName,
                        //     importModuleScope,
                        // );
                    }
                } else {
                    const importElement = <ts.Identifier>importClause.name;
                    if (importElement) {
                        // import default export from other module
                        // import module_case4_var1 from './module-case4';
                        const importElementName = importElement.getText();
                        globalScope.addImportIdentifier(
                            importElementName,
                            importModuleScope,
                        );
                    } else {
                        // import entire module into a variable
                        // import * as xx from './yy'
                    }
                }
                break;
            }
            case ts.SyntaxKind.Parameter: {
                if (node.parent.kind === ts.SyntaxKind.FunctionType) {
                    break;
                }
                const parameterNode = <ts.ParameterDeclaration>node;
                const functionScope = <FunctionScope>(
                    this.currentScope!.getNearestFunctionScope()
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
                const typeString = this.typechecker!.typeToString(
                    this.typechecker!.getTypeAtLocation(node),
                );
                const paramType = functionScope.getTSType(typeString);
                const paramIndex = functionScope.paramArray.length;
                const paramObj = new Parameter(
                    paramName,
                    paramType!,
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
                const currentScope = this.currentScope!;

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
                const typeName = this.typechecker!.typeToString(
                    this.typechecker!.getTypeAtLocation(node),
                );
                const variableType = currentScope.getTSType(typeName);
                const variable = new Variable(
                    variableName,
                    variableType!,
                    variableModifier,
                    -1,
                    true,
                );
                /* iff in a global scope, set index based on global scope variable array */
                if (currentScope.kind === ScopeKind.GlobalScope) {
                    variable.setIsLocalVar(false);
                    variable.setVarIndex(currentScope.varArray.length);
                } else if (currentScope.kind === ScopeKind.NamespaceScope) {
                    variable.setIsLocalVar(false);
                    const globalScope = currentScope.getRootGloablScope()!;
                    variable.setVarIndex(globalScope.varArray.length);
                    globalScope.addVariable(variable);
                } else {
                    const functionScope =
                        currentScope.getNearestFunctionScope()!;
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
            default: {
                if (isScopeNode(node)) {
                    break;
                }
                ts.forEachChild(node, this.visitNode.bind(this));
            }
        }
    }
}

export class VariableInit {
    typechecker: ts.TypeChecker | undefined = undefined;
    globalScopeStack = new Stack<GlobalScope>();
    currentScope: Scope | null = null;
    nodeScopeMap = new Map<ts.Node, Scope>();

    constructor(private compilerCtx: Compiler) {
        this.globalScopeStack = this.compilerCtx.globalScopeStack;
        this.nodeScopeMap = this.compilerCtx.nodeScopeMap;
    }

    visit() {
        this.typechecker = this.compilerCtx.typeChecker;
        this.nodeScopeMap.forEach((scope, node) => {
            this.currentScope = scope;
            ts.forEachChild(node, this.visitNode.bind(this));
        });
    }

    visitNode(node: ts.Node): void {
        switch (node.kind) {
            case ts.SyntaxKind.Parameter: {
                if (node.parent.kind === ts.SyntaxKind.FunctionType) {
                    break;
                }
                const parameterNode = <ts.ParameterDeclaration>node;
                const functionScope = <FunctionScope>(
                    this.currentScope!.getNearestFunctionScope()
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
                const currentScope = this.currentScope!;
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
            default: {
                if (isScopeNode(node)) {
                    break;
                }
                ts.forEachChild(node, this.visitNode.bind(this));
            }
        }
    }
}

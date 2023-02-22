import ts from 'typescript';
import { Expression } from './expression.js';
import { Type } from './type.js';
import { Compiler } from './compiler.js';
import {
    Stack,
    generateNodeExpression,
    isScopeNode,
    getGlobalScopeByModuleName,
    getImportModulePath,
    getImportIdentifierName,
    getExportIdentifierName,
} from './utils.js';
import {
    FunctionScope,
    GlobalScope,
    NamespaceScope,
    Scope,
    ScopeKind,
} from './scope.js';

export enum ModifierKind {
    default = '',
    const = 'const',
    let = 'let',
    var = 'var',
}
export class Variable {
    private isClosure = false;
    private closureIndex = 0;
    public mangledName = '';
    public scope: Scope | null = null;

    constructor(
        private name: string,
        private type: Type,
        private modifiers: (ModifierKind | ts.SyntaxKind)[] = [],
        private index = -1,
        private isLocal = true,
        private init: Expression | null = null,
    ) {}

    get varName(): string {
        return this.name;
    }

    set varType(type: Type) {
        this.type = type;
    }

    get varType(): Type {
        return this.type;
    }

    get varModifiers(): (ModifierKind | ts.SyntaxKind)[] {
        return this.modifiers;
    }

    get isConst(): boolean {
        return this.modifiers.includes(ModifierKind.const);
    }

    get isReadOnly(): boolean {
        return this.modifiers.includes(ts.SyntaxKind.ReadonlyKeyword);
    }

    get isDeclare(): boolean {
        return this.modifiers.includes(ts.SyntaxKind.DeclareKeyword);
    }

    get isExport(): boolean {
        return this.modifiers.includes(ts.SyntaxKind.ExportKeyword);
    }

    get isDefault(): boolean {
        return this.modifiers.includes(ts.SyntaxKind.DefaultKeyword);
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
        modifiers: (ModifierKind | ts.SyntaxKind)[] = [],
        index = -1,
        isOptional = false,
        isDestructuring = false,
        init: Expression | null = null,
        isLocal = true,
    ) {
        super(name, type, modifiers, index, isLocal, init);
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

            if (scope instanceof FunctionScope) {
                if (scope.className) {
                    /* For class methods, fix the "this" index */
                    if (!scope.isStatic) {
                        scope.varArray[0].setVarIndex(scope.paramArray.length);
                    }
                }
            }
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
                const {
                    importIdentifierArray,
                    nameScopeImportName,
                    nameAliasImportMap,
                    defaultImportName,
                } = getImportIdentifierName(importDeclaration);
                for (const importIdentifier of importIdentifierArray) {
                    globalScope.addImportIdentifier(
                        importIdentifier,
                        importModuleScope,
                    );
                }
                globalScope.setImportNameAlias(nameAliasImportMap);
                if (nameScopeImportName) {
                    globalScope.addImportNameScope(
                        nameScopeImportName,
                        importModuleScope,
                    );
                }
                if (defaultImportName) {
                    globalScope.addImportDefaultName(
                        defaultImportName,
                        importModuleScope,
                    );
                }
                break;
            }
            case ts.SyntaxKind.ExportDeclaration: {
                const exportDeclaration = <ts.ExportDeclaration>node;
                const globalScope = this.currentScope!.getRootGloablScope()!;
                const nameAliasExportMap =
                    getExportIdentifierName(exportDeclaration);
                globalScope.setExportNameAlias(nameAliasExportMap);
                break;
            }
            case ts.SyntaxKind.ExportAssignment: {
                const exportAssign = <ts.ExportAssignment>node;
                const globalScope = this.currentScope!.getRootGloablScope()!;
                const defaultIdentifier = <ts.Identifier>(
                    exportAssign.expression
                );
                const defaultName = defaultIdentifier.getText()!;
                globalScope.defaultNoun = defaultName;
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
                const paramModifiers = [];
                if (parameterNode.modifiers !== undefined) {
                    for (const modifier of parameterNode.modifiers) {
                        paramModifiers.push(modifier.kind);
                    }
                }
                const typeString = this.typechecker!.typeToString(
                    this.typechecker!.getTypeAtLocation(node),
                );
                const paramType = functionScope.findType(typeString);
                const paramIndex = functionScope.paramArray.length;
                const paramObj = new Parameter(
                    paramName,
                    paramType!,
                    paramModifiers,
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
                if (variableAssignText.includes(ModifierKind.const)) {
                    variableModifier = ModifierKind.const;
                } else if (variableAssignText.includes(ModifierKind.let)) {
                    variableModifier = ModifierKind.let;
                } else if (variableAssignText.includes(ModifierKind.var)) {
                    variableModifier = ModifierKind.var;
                }
                const varModifiers = [];
                varModifiers.push(variableModifier);
                const stmtNode = variableDeclarationNode.parent.parent;
                if (ts.isVariableStatement(stmtNode) && stmtNode.modifiers) {
                    for (const modifier of stmtNode.modifiers) {
                        varModifiers.push(modifier.kind);
                    }
                }

                const variableName = variableDeclarationNode.name.getText();
                const typeName = this.typechecker!.typeToString(
                    this.typechecker!.getTypeAtLocation(node),
                );
                const variableType = currentScope.findType(typeName);
                const variable = new Variable(
                    variableName,
                    variableType!,
                    varModifiers,
                    -1,
                    true,
                );
                if (variable.isDefault) {
                    currentScope.getRootGloablScope()!.defaultNoun =
                        variable.varName;
                }
                /* iff in a global scope, set index based on global scope variable array */
                if (
                    currentScope.kind === ScopeKind.GlobalScope ||
                    currentScope.kind === ScopeKind.NamespaceScope
                ) {
                    variable.setIsLocalVar(false);
                    variable.setVarIndex(currentScope.varArray.length);
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

import ts from 'typescript';
import path from 'path';
import { Type, TSFunction, TSClass, builtinTypes } from './type.js';
import { Compiler } from './compiler.js';
import { mangling, parentIsFunctionLike, Stack } from './utils.js';
import { ModifierKind, Parameter, Variable } from './variable.js';
import { Statement } from './statement.js';

export enum ScopeKind {
    Scope,
    GlobalScope = 'Global',
    FunctionScope = 'Function',
    BlockScope = 'Block',
    ClassScope = 'Class',
    NamespaceScope = 'Namespace',
}

export const funcDefs: Map<string, FunctionScope> = new Map<
    string,
    FunctionScope
>();

export class Scope {
    kind = ScopeKind.Scope;
    children: Scope[] = [];
    parent: Scope | null;
    namedTypeMap: Map<string, Type> = new Map();
    private variableArray: Variable[] = [];
    private statementArray: Statement[] = [];

    addStatement(statement: Statement) {
        this.statementArray.push(statement);
    }

    addStatementAtStart(statement: Statement) {
        this.statementArray.unshift(statement);
    }

    get statements(): Statement[] {
        return this.statementArray;
    }

    constructor(parent: Scope | null) {
        this.parent = parent;
        if (this.parent !== null) {
            this.parent.addChild(this);
        }
    }

    addVariable(variableObj: Variable) {
        this.variableArray.push(variableObj);
    }

    addVariableAtStart(variableObj: Variable) {
        this.variableArray.unshift(variableObj);
        this.variableArray.forEach((item, index) => {
            item.setVarIndex(index);
        });
    }

    get varArray(): Variable[] {
        return this.variableArray;
    }

    addChild(child: Scope) {
        this.children.push(child);
    }

    protected _nestFindScopeItem<T>(
        name: string,
        searchFunc: (scope: Scope) => T | undefined,
        nested = true,
    ): T | undefined {
        let result = searchFunc(this);
        if (result) {
            return result;
        }

        if (nested) {
            result = this.parent?._nestFindScopeItem(name, searchFunc, nested);
        }

        return result;
    }

    findVariable(variableName: string, nested = true): Variable | undefined {
        return this._nestFindScopeItem(
            variableName,
            (scope) => {
                let res = scope.variableArray.find((v) => {
                    return v.varName === variableName;
                });

                if (!res && scope instanceof FunctionScope) {
                    res = scope.paramArray.find((v) => {
                        return v.varName === variableName;
                    });
                }

                if (!res && scope instanceof GlobalScope) {
                    const targetModuleScope =
                        scope.identifierModuleImportMap.get(variableName);
                    if (targetModuleScope) {
                        res = targetModuleScope.findVariable(variableName);
                    }
                }

                return res;
            },
            nested,
        );
    }

    findFunctionScope(
        functionName: string,
        nested = true,
    ): FunctionScope | undefined {
        return this._nestFindScopeItem(
            functionName,
            (scope) => {
                let res = scope.children.find((c) => {
                    return (
                        c.kind === ScopeKind.FunctionScope &&
                        (c as FunctionScope).funcName === functionName
                    );
                });

                if (!res && scope instanceof GlobalScope) {
                    const targetModuleScope =
                        scope.identifierModuleImportMap.get(functionName);
                    if (targetModuleScope) {
                        res = targetModuleScope.findFunctionScope(functionName);
                    }
                }

                return res ? (res as FunctionScope) : res;
            },
            nested,
        );
    }

    getTSType(typeName: string, nested = true): Type | undefined {
        const res = builtinTypes.get(typeName);
        if (res) {
            return res;
        }

        return this._nestFindScopeItem(
            typeName,
            (scope) => {
                return scope.namedTypeMap.get(typeName);
            },
            nested,
        );
    }

    _getScopeByType<T>(type: ScopeKind): T | null {
        let currentScope: Scope | null = this;
        while (currentScope !== null) {
            if (currentScope.kind === type) {
                return <T>currentScope;
            }
            currentScope = currentScope.parent;
        }
        return null;
    }

    getNearestFunctionScope() {
        return this._getScopeByType<FunctionScope>(ScopeKind.FunctionScope);
    }

    getRootGloablScope() {
        return this._getScopeByType<GlobalScope>(ScopeKind.GlobalScope);
    }
}

export class GlobalScope extends Scope {
    kind = ScopeKind.GlobalScope;
    private _moduleName = '';
    private functionName = '';
    private startFunctionVariableArray: Variable[] = [];
    private functionType = new TSFunction();
    identifierModuleImportMap = new Map<string, GlobalScope>();
    isMarkStart = false;

    constructor(parent: Scope | null = null) {
        super(parent);
    }

    addStartFuncVar(variableObj: Variable) {
        this.startFunctionVariableArray.push(variableObj);
    }

    get startFuncVarArray(): Variable[] {
        return this.startFunctionVariableArray;
    }

    set moduleName(moduleName: string) {
        this._moduleName = moduleName;
        this.functionName = mangling(moduleName, 'start');
    }

    get moduleName(): string {
        return this._moduleName;
    }

    get startFuncName(): string {
        return this.functionName;
    }

    get startFuncType(): TSFunction {
        return this.functionType;
    }

    addImportIdentifier(identifier: string, moduleScope: GlobalScope) {
        this.identifierModuleImportMap.set(identifier, moduleScope);
    }
}

export class FunctionScope extends Scope {
    kind = ScopeKind.FunctionScope;
    private functionName = '';
    private parameterArray: Parameter[] = [];
    private modifiers: ts.SyntaxKind[] = [];
    private functionType = new TSFunction();
    private isClosure = false;
    /* iff the function is a member function, which class it belong to */
    private _classNmae = '';

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

    setClassName(name: string) {
        this._classNmae = name;
    }

    get className(): string {
        return this._classNmae;
    }

    setIsClosure(): void {
        this.isClosure = true;
    }

    getIsClosure(): boolean {
        return this.isClosure;
    }
}

export class BlockScope extends Scope {
    kind = ScopeKind.BlockScope;
    name = '';

    constructor(parent: Scope, name = '') {
        super(parent);
        this.name = name;
    }
}

export class ClassScope extends Scope {
    kind = ScopeKind.ClassScope;
    private _classType: TSClass = new TSClass();
    private _className = '';

    constructor(parent: Scope, name = '') {
        super(parent);
        this._className = name;
    }

    get className(): string {
        return this._className;
    }

    setClassType(type: TSClass) {
        this._classType = type;
    }

    get classType(): TSClass {
        return this._classType;
    }
}

enum classFuncType {
    Constructor,
    Getter,
    Setter,
    Method,
    StaticMethod,
}

export class NamespaceScope extends Scope {
    kind = ScopeKind.NamespaceScope;
    private _namespaceName;

    constructor(parent: Scope, name = '') {
        super(parent);
        this._namespaceName = name;
    }

    get namespaceName(): string {
        return this._namespaceName;
    }
}

export class ScopeScanner {
    globalScopeStack: Stack<GlobalScope>;
    currentScope: Scope | null = null;
    nodeScopeMap: Map<ts.Node, Scope>;
    /* anonymous function index */
    static anonymousIndex = 0;

    constructor(private compilerCtx: Compiler) {
        this.globalScopeStack = this.compilerCtx.globalScopeStack;
        this.nodeScopeMap = this.compilerCtx.nodeScopeMap;
    }

    _generateClassFuncScope(
        node: ts.AccessorDeclaration | ts.MethodDeclaration,
        methodType: classFuncType,
    ) {
        const parentScope = this.currentScope!;
        const functionScope = new FunctionScope(parentScope);
        functionScope.addParameter(
            new Parameter(
                '',
                new Type(),
                ModifierKind.default,
                -1,
                false,
                false,
            ),
        );
        functionScope.addVariable(
            new Variable('', new Type(), ModifierKind.default, -1),
        );
        functionScope.setClassName((<ClassScope>parentScope).className);
        let methodName = '';
        switch (methodType) {
            case classFuncType.Constructor:
                methodName = functionScope.className + '_constructor';
                break;
            case classFuncType.Getter:
                methodName =
                    functionScope.className + '_get_' + node.name.getText();
                break;
            case classFuncType.Setter:
                methodName =
                    functionScope.className + '_set_' + node.name.getText();
                break;
            case classFuncType.Method:
                methodName =
                    functionScope.className + '_' + node.name.getText();
                break;
        }
        funcDefs.set(methodName, functionScope);
        functionScope.setFuncName(methodName);
        this.setCurrentScope(functionScope);
        this.nodeScopeMap.set(node, functionScope);
        this.visitNode(node.body!);
        this.setCurrentScope(parentScope);
    }

    visit(nodes: Array<ts.SourceFile>) {
        for (const sourceFile of nodes) {
            this.visitNode(sourceFile);
        }
    }

    visitNode(node: ts.Node): void {
        switch (node.kind) {
            case ts.SyntaxKind.SourceFile: {
                const sourceFileNode = <ts.SourceFile>node;
                const globalScope = new GlobalScope();
                this.setCurrentScope(globalScope);
                const filePath = sourceFileNode.fileName.slice(
                    undefined,
                    -'.ts'.length,
                );
                const moduleName = path.relative(process.cwd(), filePath);
                globalScope.moduleName = moduleName;
                this.globalScopeStack.push(globalScope);
                this.nodeScopeMap.set(sourceFileNode, globalScope);
                for (let i = 0; i < sourceFileNode.statements.length; i++) {
                    this.visitNode(sourceFileNode.statements[i]);
                }
                this.visitNode(sourceFileNode.endOfFileToken);
                break;
            }
            case ts.SyntaxKind.ModuleDeclaration: {
                const moduleDeclaration = <ts.ModuleDeclaration>node;
                const namespaceName = moduleDeclaration.name.text;
                const parentScope = this.currentScope!;
                if (
                    parentScope.kind !== ScopeKind.GlobalScope &&
                    parentScope.kind !== ScopeKind.NamespaceScope
                ) {
                    throw Error(
                        'A namespace declaration is only allowed at the top level of a namespace or module',
                    );
                }
                const namespaceScope = new NamespaceScope(
                    parentScope,
                    namespaceName,
                );
                this.setCurrentScope(namespaceScope);
                this.nodeScopeMap.set(node, namespaceScope);
                this.visitNode(moduleDeclaration.body!);
                this.setCurrentScope(parentScope);
                break;
            }
            case ts.SyntaxKind.FunctionDeclaration:
            case ts.SyntaxKind.FunctionExpression:
            case ts.SyntaxKind.ArrowFunction: {
                const functionDeclarationNode = <ts.FunctionDeclaration>node;
                const parentScope = this.currentScope!;
                const functionScope = new FunctionScope(parentScope);
                /* function context struct placeholder */
                functionScope.addParameter(
                    new Parameter(
                        '',
                        new Type(),
                        ModifierKind.default,
                        -1,
                        false,
                        false,
                    ),
                );
                functionScope.addVariable(
                    new Variable('', new Type(), ModifierKind.default, -1),
                );
                if (functionDeclarationNode.modifiers !== undefined) {
                    for (const modifier of functionDeclarationNode.modifiers) {
                        functionScope.addModifier(modifier.kind);
                    }
                }
                let functionName: string;
                if (functionDeclarationNode.name !== undefined) {
                    functionName = functionDeclarationNode.name.getText();
                } else {
                    functionName = 'anonymous' + ScopeScanner.anonymousIndex++;
                }

                const outerFuncScope =
                    functionScope.parent?.getNearestFunctionScope();
                if (outerFuncScope) {
                    functionName = `${outerFuncScope.funcName}|${functionName}`;
                }
                functionScope.setFuncName(functionName);
                funcDefs.set(functionName, functionScope);
                this.setCurrentScope(functionScope);
                this.nodeScopeMap.set(functionDeclarationNode, functionScope);
                this.visitNode(functionDeclarationNode.body!);
                this.setCurrentScope(parentScope);
                break;
            }
            case ts.SyntaxKind.ClassDeclaration: {
                const classDeclarationNode = <ts.ClassDeclaration>node;
                const parentScope = this.currentScope!;
                const className = (<ts.Identifier>(
                    classDeclarationNode.name
                )).getText();
                const classScope = new ClassScope(parentScope, className);
                this.setCurrentScope(classScope);
                this.nodeScopeMap.set(classDeclarationNode, classScope);
                for (const member of classDeclarationNode.members) {
                    if (
                        member.kind === ts.SyntaxKind.SetAccessor ||
                        member.kind === ts.SyntaxKind.GetAccessor ||
                        member.kind === ts.SyntaxKind.Constructor ||
                        member.kind === ts.SyntaxKind.MethodDeclaration
                    ) {
                        this.visitNode(member);
                    }
                }
                this.setCurrentScope(parentScope);
                break;
            }
            case ts.SyntaxKind.SetAccessor: {
                this._generateClassFuncScope(
                    <ts.MethodDeclaration>node,
                    classFuncType.Setter,
                );
                break;
            }
            case ts.SyntaxKind.GetAccessor: {
                this._generateClassFuncScope(
                    <ts.MethodDeclaration>node,
                    classFuncType.Getter,
                );
                break;
            }
            case ts.SyntaxKind.Constructor: {
                this._generateClassFuncScope(
                    <ts.MethodDeclaration>node,
                    classFuncType.Constructor,
                );
                break;
            }
            case ts.SyntaxKind.MethodDeclaration: {
                this._generateClassFuncScope(
                    <ts.MethodDeclaration>node,
                    classFuncType.Method,
                );
                break;
            }
            case ts.SyntaxKind.Block: {
                const blockNode = <ts.Block>node;
                this.createBlockScope(blockNode);
                break;
            }
            case ts.SyntaxKind.ForStatement: {
                const forStatementNode = <ts.ForStatement>node;
                this.createLoopBlockScope(forStatementNode);
                break;
            }
            case ts.SyntaxKind.WhileStatement: {
                const whileStatementNode = <ts.WhileStatement>node;
                this.createLoopBlockScope(whileStatementNode);
                break;
            }
            case ts.SyntaxKind.DoStatement: {
                const doStatementNode = <ts.DoStatement>node;
                this.createLoopBlockScope(doStatementNode);
                break;
            }
            case ts.SyntaxKind.CaseClause: {
                const caseClauseNode = <ts.CaseClause>node;
                this.createBlockScope(caseClauseNode);
                break;
            }
            case ts.SyntaxKind.DefaultClause: {
                const defaultClauseNode = <ts.DefaultClause>node;
                this.createBlockScope(defaultClauseNode);
                break;
            }
            default: {
                ts.forEachChild(node, this.visitNode.bind(this));
            }
        }
    }

    setCurrentScope(currentScope: Scope | null) {
        this.currentScope = currentScope;
    }

    createBlockScope(node: ts.BlockLike) {
        const parentScope = this.currentScope!;

        if (!parentIsFunctionLike(node)) {
            const parentScope = this.currentScope!;
            const parentName = ScopeScanner.getPossibleScopeName(parentScope);
            const blockName = ts.isCaseOrDefaultClause(node) ? 'case' : 'block';
            const blockScope = new BlockScope(
                parentScope,
                `${parentName}.${blockName}`,
            );
            this.setCurrentScope(blockScope);
            this.nodeScopeMap.set(node, blockScope);
        }

        const statements = node.statements;
        if (statements.length !== 0) {
            for (let i = 0; i < statements.length; i++) {
                this.visitNode(statements[i]);
            }
        }

        if (!parentIsFunctionLike(node)) {
            this.setCurrentScope(parentScope);
        }
    }

    createLoopBlockScope(
        node: ts.ForStatement | ts.WhileStatement | ts.DoStatement,
    ) {
        const parentScope = this.currentScope!;
        const parentName = ScopeScanner.getPossibleScopeName(parentScope);
        const outOfLoopBlock = new BlockScope(
            parentScope,
            `${parentName}.loop`,
        );
        this.setCurrentScope(outOfLoopBlock);
        this.nodeScopeMap.set(node, outOfLoopBlock);

        this.visitNode(node.statement);

        this.setCurrentScope(parentScope);
    }

    static getPossibleScopeName(scope: Scope) {
        let possibleName = '';
        if (scope.kind === ScopeKind.FunctionScope) {
            possibleName = (scope as FunctionScope).funcName;
        } else if (scope.kind === ScopeKind.GlobalScope) {
            possibleName = 'global';
        } else if (scope.kind === ScopeKind.ClassScope) {
            possibleName = (scope as ClassScope).className;
        } else {
            possibleName = (scope as BlockScope).name;
        }

        return possibleName;
    }
}

/* try to find function scope base on unique function name */
export function findTargetFunction(
    scope: Scope | null,
    name: string,
): FunctionScope | undefined {
    /* iff in global scope */
    if (scope === null) {
        return funcDefs.get(name);
    }
    let nearestFuncscope = scope.getNearestFunctionScope();
    let targetFuncDef = undefined;
    while (nearestFuncscope) {
        const maybeFuncName = `${nearestFuncscope.funcName}|${name}`;
        targetFuncDef = funcDefs.get(maybeFuncName);
        if (targetFuncDef) {
            break;
        }

        nearestFuncscope =
            nearestFuncscope.parent?.getNearestFunctionScope() || null;
    }

    if (!targetFuncDef) {
        targetFuncDef = funcDefs.get(name);
    }

    return targetFuncDef;
}

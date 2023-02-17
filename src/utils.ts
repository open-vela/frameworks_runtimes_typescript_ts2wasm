import ts from 'typescript';
import path from 'path';
import { GlobalScope, Scope } from './scope.js';
import ExpressionCompiler, { Expression } from './expression.js';
import { BuiltinNames } from '../lib/builtin/builtinUtil.js';

export interface TypeCheckerInfo {
    typeName: string;
    typeNode: ts.Node;
    elemNode?: ts.Node;
}

export enum MatchKind {
    ExactMatch,
    ToAnyMatch,
    FromAnyMatch,
    ClassMatch,
    ClassInheritMatch,
    ToArrayAnyMatch,
    FromArrayAnyMatch,
    MisMatch,
}

export const CONST_KEYWORD = 'const';
export const LET_KEYWORD = 'let';
export const VAR_KEYWORD = 'var';

export class Stack<T> {
    private items: T[] = [];
    push(item: T) {
        this.items.push(item);
    }
    pop() {
        if (this.isEmpty()) {
            throw new Error('Current stack is empty, can not pop');
        }
        return this.items.pop()!;
    }
    peek() {
        if (this.isEmpty()) {
            throw new Error('Current stack is empty, can not get peek item');
        }
        return this.items[this.items.length - 1];
    }
    isEmpty() {
        return this.items.length === 0;
    }
    clear() {
        this.items = [];
    }
    size() {
        return this.items.length;
    }
    getItemAtIdx(index: number) {
        if (index >= this.items.length) {
            throw new Error('index is greater than the size of the stack');
        }
        return this.items[index];
    }
}

export function getNodeTypeInfo(
    node: ts.Node,
    checker: ts.TypeChecker,
): TypeCheckerInfo {
    let variableType: ts.Type;
    let elemNode: ts.Node | undefined = undefined;
    if (ts.isTypeReferenceNode(node)) {
        const typeRefNode = node as ts.TypeReferenceNode;
        node = typeRefNode.typeName;
        if (typeRefNode.typeArguments) {
            elemNode = typeRefNode.typeArguments[0];
        }
    }
    const symbol = checker.getSymbolAtLocation(node);
    if (symbol === undefined) {
        variableType = checker.getTypeAtLocation(node);
    } else {
        if (ts.isTypeReferenceNode(node)) {
            variableType = checker.getDeclaredTypeOfSymbol(symbol);
        } else {
            variableType = checker.getTypeOfSymbolAtLocation(
                symbol,
                symbol.declarations![0],
            );
        }
    }
    const typeCheckerInfo: TypeCheckerInfo = {
        typeName: checker.typeToString(variableType),
        typeNode: checker.typeToTypeNode(variableType, undefined, undefined)!,
        elemNode: elemNode,
    };
    return typeCheckerInfo;
}

export function getCurScope(
    node: ts.Node,
    nodeScopeMap: Map<ts.Node, Scope>,
): Scope | null {
    if (!node) return null;
    const scope = nodeScopeMap.get(node);
    if (scope) return scope;
    return getCurScope(node.parent, nodeScopeMap);
}

export function generateNodeExpression(
    exprCompiler: ExpressionCompiler,
    node: ts.Node,
): Expression {
    return exprCompiler.visitNode(node);
}

export function parentIsFunctionLike(node: ts.Node) {
    if (
        node.parent.kind === ts.SyntaxKind.FunctionDeclaration ||
        node.parent.kind === ts.SyntaxKind.MethodDeclaration ||
        node.parent.kind === ts.SyntaxKind.SetAccessor ||
        node.parent.kind === ts.SyntaxKind.GetAccessor ||
        node.parent.kind === ts.SyntaxKind.FunctionExpression ||
        node.parent.kind === ts.SyntaxKind.ArrowFunction
    ) {
        return true;
    }

    return false;
}

export function parentIsLoopLike(node: ts.Node) {
    if (
        node.parent.kind === ts.SyntaxKind.ForStatement ||
        node.parent.kind === ts.SyntaxKind.DoStatement ||
        node.parent.kind === ts.SyntaxKind.WhileStatement
    ) {
        return true;
    }

    return false;
}

export function parentIsCaseClause(node: ts.Node) {
    if (
        node.parent.kind === ts.SyntaxKind.CaseClause ||
        node.parent.kind === ts.SyntaxKind.DefaultClause
    ) {
        return true;
    }

    return false;
}

export function isScopeNode(node: ts.Node) {
    if (
        node.kind === ts.SyntaxKind.SourceFile ||
        node.kind === ts.SyntaxKind.ModuleDeclaration ||
        node.kind === ts.SyntaxKind.FunctionDeclaration ||
        node.kind === ts.SyntaxKind.FunctionExpression ||
        node.kind === ts.SyntaxKind.ArrowFunction ||
        node.kind === ts.SyntaxKind.ClassDeclaration ||
        node.kind === ts.SyntaxKind.SetAccessor ||
        node.kind === ts.SyntaxKind.GetAccessor ||
        node.kind === ts.SyntaxKind.Constructor ||
        node.kind === ts.SyntaxKind.MethodDeclaration ||
        node.kind === ts.SyntaxKind.ForStatement ||
        node.kind === ts.SyntaxKind.WhileStatement ||
        node.kind === ts.SyntaxKind.DoStatement ||
        node.kind === ts.SyntaxKind.CaseClause ||
        node.kind === ts.SyntaxKind.DefaultClause
    ) {
        return true;
    }
    if (node.kind === ts.SyntaxKind.Block && !parentIsFunctionLike(node)) {
        return true;
    }
    return false;
}

export function mangling(
    leftName: string,
    rightName: string,
    delimiter = BuiltinNames.module_delimiter,
) {
    return leftName.concat(delimiter).concat(rightName);
}

export function getImportModulePath(
    importDeclaration: ts.ImportDeclaration,
    currentGlobalScope: GlobalScope,
) {
    // get import module name
    const moduleSpecifier = importDeclaration.moduleSpecifier
        .getText()
        .slice(1, -1);
    const currentModuleName = currentGlobalScope.moduleName;
    const importModuleName = path.relative(
        process.cwd(),
        path.resolve(path.dirname(currentModuleName), moduleSpecifier),
    );
    return importModuleName;
}

export function getGlobalScopeByModuleName(
    moduleName: string,
    globalScopeStack: Stack<GlobalScope>,
) {
    for (let i = 0; i < globalScopeStack.size(); i++) {
        const globalScope = globalScopeStack.getItemAtIdx(i);
        if (globalScope.moduleName === moduleName) {
            return globalScope;
        }
    }
    throw Error('no such moduleName: ' + moduleName);
}

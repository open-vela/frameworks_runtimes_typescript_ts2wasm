import binaryen from 'binaryen';
import ts from 'typescript';
import { Scope } from './scope.js';
import ExpressionCompiler, { Expression } from './expression.js';

export enum AssignKind {
    default,
    const,
    let,
    var,
}

export interface TypeCheckerInfo {
    typeName: string;
    typeNode: ts.Node;
}

export enum LoopKind {
    default,
    for,
    while,
    do,
}

export enum ExpressionKind {
    equalsExpression,
    postfixUnaryExpression,
    prefixUnaryExpression,
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

export interface HelpMessageCategory {
    General: string[];
    Output: string[];
    Validation: string[];
    Other: string[];
}

export interface VariableInfo {
    variableName: string;
    variableType: binaryen.Type;
    variableIndex: number;
    variableInitial: binaryen.ExpressionRef | undefined;
    variableAssign: AssignKind;
}

export interface BinaryExpressionInfo {
    leftExpression: binaryen.ExpressionRef;
    leftType: binaryen.Type;
    operator: binaryen.ExpressionRef;
    rightExpression: binaryen.ExpressionRef;
    rightType: binaryen.Type;
}

export interface LoopStatementInfo {
    kind: LoopKind;
    label: string;
    condition: binaryen.ExpressionRef;
    statement: binaryen.ExpressionRef;
}

export interface ForStatementInfo extends LoopStatementInfo {
    initializer: binaryen.ExpressionRef;
    incrementor: binaryen.ExpressionRef;
}

export type WhileStatementInfo = LoopStatementInfo;

export type DoStatementInfo = LoopStatementInfo;

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
    if (ts.isTypeReferenceNode(node)) {
        node = (node as ts.TypeReferenceNode).typeName;
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

export function getNearestFunctionScopeFromCurrent(currentScope: Scope | null) {
    if (!currentScope) {
        throw new Error('current scope is null');
    }
    const functionScope = currentScope.getNearestFunctionScope();
    if (!functionScope) {
        return null;
    }
    return functionScope;
}

export function generateNodeExpression(
    exprCompiler: ExpressionCompiler,
    node: ts.Node,
): Expression {
    return exprCompiler.visitNode(node);
}

import binaryen from 'binaryen';
import ts from 'typescript';

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

export interface IfStatementInfo {
    condition: binaryen.ExpressionRef;
    ifTrue: binaryen.ExpressionRef;
    ifFalse: binaryen.ExpressionRef;
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
}

import binaryen from 'binaryen';

export enum AssignKind {
    default,
    const,
    let,
    var,
}

export enum LoopKind {
    default,
    for,
    while,
    do,
}

export enum OperatorKind {
    add,
    sub,
    mul,
    div,
    gt,
    ge,
    lt,
    le,
    and,
    or,
    eq,
    eq_eq,
    ne,
    ne_ne,
    plus_equals,
}

export enum ExpressionKind {
    equalsExpression,
    postfixUnaryExpression,
    prefixUnaryExpression,
}

export const CONST_KEYWORD = 'const';
export const LET_KEYWORD = 'let';
export const VAR_KEYWORD = 'var';

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
        return this.items.pop();
    }
    peek() {
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

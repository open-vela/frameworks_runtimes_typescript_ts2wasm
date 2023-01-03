import ts from 'typescript';
import { Compiler } from './compiler.js';

type OperatorKind = ts.SyntaxKind;
type ExpressionKind = ts.SyntaxKind;
export class Expression {
    private kind: ExpressionKind;

    constructor(kind: ExpressionKind) {
        this.kind = kind;
    }

    get expressionKind() {
        return this.kind;
    }
}

export class NumberLiteralExpression extends Expression {
    private value: number;

    constructor(value: number) {
        super(ts.SyntaxKind.NumericLiteral);
        this.value = value;
    }

    get expressionValue(): number {
        return this.value;
    }
}

export class StringLiteralExpression extends Expression {
    private value: string;

    constructor(value: string) {
        super(ts.SyntaxKind.StringLiteral);
        this.value = value;
    }

    get expressionValue(): string {
        return this.value;
    }
}

export class ObjectLiteralExpression extends Expression {
    constructor(
        private fields: IdentifierExpression[],
        private values: Expression[],
    ) {
        super(ts.SyntaxKind.ObjectLiteralExpression);
    }

    get objectFields(): IdentifierExpression[] {
        return this.fields;
    }

    get objectValues(): Expression[] {
        return this.values;
    }
}

export class ArrayLiteralExpression extends Expression {
    constructor(private elements: Expression[]) {
        super(ts.SyntaxKind.ArrayLiteralExpression);
    }

    get arrayValues(): Expression[] {
        return this.elements;
    }
}

export class FalseLiteralExpression extends Expression {
    constructor() {
        super(ts.SyntaxKind.FalseKeyword);
    }
}

export class TrueLiteralExpression extends Expression {
    constructor() {
        super(ts.SyntaxKind.TrueKeyword);
    }
}

export class IdentifierExpression extends Expression {
    private identifier: string;

    constructor(identifier: string) {
        super(ts.SyntaxKind.Identifier);
        this.identifier = identifier;
    }

    get identifierName(): string {
        return this.identifier;
    }
}

export class BinaryExpression extends Expression {
    private operator: OperatorKind;
    private left: Expression;
    private right: Expression;

    constructor(operator: OperatorKind, left: Expression, right: Expression) {
        super(ts.SyntaxKind.BinaryExpression);
        this.operator = operator;
        this.left = left;
        this.right = right;
    }

    get operatorKind(): OperatorKind {
        return this.operator;
    }

    get leftOperand(): Expression {
        return this.left;
    }

    get rightOperand(): Expression {
        return this.right;
    }
}

export class UnaryExpression extends Expression {
    private operator: OperatorKind;
    private _operand: Expression;

    constructor(
        kind: OperatorKind,
        operator: OperatorKind,
        operand: Expression,
    ) {
        super(kind);
        this.operator = operator;
        this._operand = operand;
    }

    get operatorKind(): OperatorKind {
        return this.operator;
    }

    get operand(): Expression {
        return this._operand;
    }
}

export class ConditionalExpression extends Expression {
    constructor(
        private cond: Expression,
        private trueExpr: Expression,
        private falseExpr: Expression,
    ) {
        super(ts.SyntaxKind.ConditionalExpression);
    }

    get condtion(): Expression {
        return this.cond;
    }

    get whenTrue(): Expression {
        return this.trueExpr;
    }

    get whenFalse(): Expression {
        return this.falseExpr;
    }
}

export class CallExpression extends Expression {
    private expr: Expression;
    private args: Expression[];

    constructor(expr: Expression, args: Expression[]) {
        super(ts.SyntaxKind.CallExpression);
        this.expr = expr;
        this.args = args;
    }

    get callExpr(): Expression {
        return this.expr;
    }

    get callArgs(): Expression[] {
        return this.args;
    }
}

export class ThisExpression extends Expression {
    // private expr: string = 'this';
    private property: Expression;

    constructor(property: Expression) {
        super(ts.SyntaxKind.ThisKeyword);
        this.property = property;
    }

    get propertyExpr(): Expression {
        return this.property;
    }
}

export class PropertyAccessExpression extends Expression {
    private expr: Expression;
    private property: Expression;

    constructor(expr: Expression, property: Expression) {
        super(ts.SyntaxKind.PropertyAccessExpression);
        this.expr = expr;
        this.property = property;
    }

    get propertyAccessExpr(): Expression {
        return this.expr;
    }

    get propertyExpr(): Expression {
        return this.property;
    }
}

export class ParenthesizedExpression extends Expression {
    private expr: Expression;

    constructor(expr: Expression) {
        super(ts.SyntaxKind.ParenthesizedExpression);
        this.expr = expr;
    }

    get parentesizedExpr(): Expression {
        return this.expr;
    }
}

export default class ExpressionCompiler {
    constructor(private compilerCtx: Compiler) {
        //
    }

    visit(nodes: Array<ts.SourceFile>) {
        /* TODO: invoke visitNode on interested nodes */
        for (const sourceFile of nodes) {
            ts.forEachChild(sourceFile, this.visitNode);
        }
    }

    visitNode(node: ts.Node): Expression {
        switch (node.kind) {
            case ts.SyntaxKind.NumericLiteral: {
                return new NumberLiteralExpression(
                    parseFloat((<ts.NumericLiteral>node).getText()),
                );
            }
            case ts.SyntaxKind.FalseKeyword: {
                return new FalseLiteralExpression();
            }
            case ts.SyntaxKind.TrueKeyword: {
                return new TrueLiteralExpression();
            }
            case ts.SyntaxKind.Identifier: {
                return new IdentifierExpression(
                    (<ts.Identifier>node).getText(),
                );
            }
            case ts.SyntaxKind.BinaryExpression: {
                const binaryExprNode = <ts.BinaryExpression>node;
                const leftExpr = this.visitNode(binaryExprNode.left);
                const rightExpr = this.visitNode(binaryExprNode.right);
                return new BinaryExpression(
                    binaryExprNode.operatorToken.kind,
                    leftExpr,
                    rightExpr,
                );
            }
            case ts.SyntaxKind.PrefixUnaryExpression: {
                const prefixExprNode = <ts.PrefixUnaryExpression>node;
                const operand = this.visitNode(prefixExprNode.operand);
                return new UnaryExpression(
                    ts.SyntaxKind.PrefixUnaryExpression,
                    prefixExprNode.operator,
                    operand,
                );
            }
            case ts.SyntaxKind.PostfixUnaryExpression: {
                const postExprNode = <ts.PostfixUnaryExpression>node;
                const operand = this.visitNode(postExprNode.operand);
                return new UnaryExpression(
                    ts.SyntaxKind.PostfixUnaryExpression,
                    postExprNode.operator,
                    operand,
                );
            }
            case ts.SyntaxKind.ConditionalExpression: {
                const condExprNode = <ts.ConditionalExpression>node;
                const cond = this.visitNode(condExprNode.condition);
                const whenTrue = this.visitNode(condExprNode.whenTrue);
                const whenFalse = this.visitNode(condExprNode.whenFalse);
                return new ConditionalExpression(cond, whenTrue, whenFalse);
            }
            case ts.SyntaxKind.CallExpression: {
                const callExprNode = <ts.CallExpression>node;
                const expr = this.visitNode(callExprNode.expression);
                const args = new Array<Expression>(
                    callExprNode.arguments.length,
                );
                for (let i = 0; i != args.length; ++i) {
                    args[i] = this.visitNode(callExprNode.arguments[i]);
                }
                return new CallExpression(expr, args);
            }
            case ts.SyntaxKind.PropertyAccessExpression: {
                const propAccessExprNode = <ts.PropertyAccessExpression>node;
                const property = this.visitNode(propAccessExprNode.name);
                if (
                    propAccessExprNode.expression.kind ===
                    ts.SyntaxKind.ThisKeyword
                ) {
                    return new ThisExpression(property);
                }
                const expr = this.visitNode(propAccessExprNode.expression);
                return new PropertyAccessExpression(expr, property);
            }
            case ts.SyntaxKind.ParenthesizedExpression: {
                const expr = this.visitNode(
                    (<ts.ParenthesizedExpression>node).expression,
                );
                return new ParenthesizedExpression(expr);
            }
            case ts.SyntaxKind.ObjectLiteralExpression: {
                const objLiteralNode = <ts.ObjectLiteralExpression>node;
                const fields = new Array<IdentifierExpression>();
                const values = new Array<Expression>();
                for (const property of objLiteralNode.properties) {
                    const propertyAssign = <ts.PropertyAssignment>property;
                    fields.push(
                        new IdentifierExpression(propertyAssign.name.getText()),
                    );
                    values.push(this.visitNode(propertyAssign.initializer));
                }
                return new ObjectLiteralExpression(fields, values);
            }
            case ts.SyntaxKind.ArrayLiteralExpression: {
                const arrLiteralNode = <ts.ArrayLiteralExpression>node;
                const elements = new Array<Expression>();
                for (const elem of arrLiteralNode.elements) {
                    elements.push(this.visitNode(elem));
                }
                return new ArrayLiteralExpression(elements);
            }
            default:
                return new Expression(ts.SyntaxKind.Unknown);
        }
    }
}

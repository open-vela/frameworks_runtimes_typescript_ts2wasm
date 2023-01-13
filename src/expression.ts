import ts from 'typescript';
import { Compiler } from './compiler.js';
import { Scope, FunctionScope, GlobalScope, ScopeKind } from './scope.js';
import { Variable } from './variable.js';
import { Type } from './type.js';

type OperatorKind = ts.SyntaxKind;
type ExpressionKind = ts.SyntaxKind;

export class Expression {
    private kind: ExpressionKind;
    private type: Type = new Type();

    constructor(kind: ExpressionKind) {
        this.kind = kind;
    }

    get expressionKind() {
        return this.kind;
    }

    setExprType(type: Type) {
        this.type = type;
    }

    get exprType(): Type {
        return this.type;
    }
}

export class NullKeywordExpression extends Expression {
    constructor() {
        super(ts.SyntaxKind.NullKeyword);
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
        kind: ExpressionKind,
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

    constructor(
        expr: Expression,
        args: Expression[] = new Array<Expression>(0),
    ) {
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

export class SuperCallExpression extends Expression {
    private args: Expression[];

    constructor(args: Expression[] = new Array<Expression>(0)) {
        super(ts.SyntaxKind.SuperKeyword);
        this.args = args;
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
    private parent: Expression;

    constructor(expr: Expression, property: Expression, parent: Expression) {
        super(ts.SyntaxKind.PropertyAccessExpression);
        this.expr = expr;
        this.property = property;
        this.parent = parent;
    }

    get propertyAccessExpr(): Expression {
        return this.expr;
    }

    get propertyExpr(): Expression {
        return this.property;
    }

    get parentExpr(): Expression {
        return this.parent;
    }
}

export class NewExpression extends Expression {
    private expr: Expression;
    private arguments: Array<Expression> | undefined;

    constructor(expr: Expression, args: Array<Expression> | undefined) {
        super(ts.SyntaxKind.NewExpression);
        this.expr = expr;
        this.arguments = args;
    }

    get NewExpr(): Expression {
        return this.expr;
    }

    get NewArgs(): Array<Expression> | undefined {
        return this.arguments;
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

export class ElementAccessExpression extends Expression {
    private expr: Expression;
    private argumentExpr: Expression;

    constructor(expr: Expression, argExpr: Expression) {
        super(ts.SyntaxKind.ElementAccessExpression);
        this.expr = expr;
        this.argumentExpr = argExpr;
    }

    get accessExpr(): Expression {
        return this.expr;
    }

    get argExpr(): Expression {
        return this.argumentExpr;
    }
}

export class AsExpression extends Expression {
    private expr: Expression;

    constructor(expr: Expression) {
        super(ts.SyntaxKind.AsExpression);
        this.expr = expr;
    }

    get expression(): Expression {
        return this.expr;
    }
}

export default class ExpressionCompiler {
    // private currentScope: Scope | null = null;

    private typeCompiler;
    constructor(private compilerCtx: Compiler) {
        this.typeCompiler = this.compilerCtx.typeComp;
    }

    visitNode(node: ts.Node): Expression {
        switch (node.kind) {
            case ts.SyntaxKind.NullKeyword: {
                const nullExpr = new NullKeywordExpression();
                nullExpr.setExprType(this.typeCompiler.generateNodeType(node));
                return nullExpr;
            }
            case ts.SyntaxKind.NumericLiteral: {
                const numberLiteralExpr = new NumberLiteralExpression(
                    parseFloat((<ts.NumericLiteral>node).getText()),
                );
                numberLiteralExpr.setExprType(
                    this.typeCompiler.generateNodeType(node),
                );
                return numberLiteralExpr;
            }
            case ts.SyntaxKind.StringLiteral: {
                const stringLiteralExpr = new StringLiteralExpression(
                    (<ts.StringLiteral>node).getText(),
                );
                stringLiteralExpr.setExprType(
                    this.typeCompiler.generateNodeType(node),
                );
                return stringLiteralExpr;
            }
            case ts.SyntaxKind.FalseKeyword: {
                const falseLiteralExpr = new FalseLiteralExpression();
                falseLiteralExpr.setExprType(
                    this.typeCompiler.generateNodeType(node),
                );
                return falseLiteralExpr;
            }
            case ts.SyntaxKind.TrueKeyword: {
                const trueLiteralExpr = new TrueLiteralExpression();
                trueLiteralExpr.setExprType(
                    this.typeCompiler.generateNodeType(node),
                );
                return trueLiteralExpr;
            }
            case ts.SyntaxKind.Identifier: {
                const targetIdentifier = (<ts.Identifier>node).getText();
                let scope = this.compilerCtx.currentScope;
                if (scope !== null) {
                    const nearestFuncScope = scope.getNearestFunctionScope();
                    let variable: Variable | undefined = undefined;
                    let isFreeVar = false;
                    while (scope !== null) {
                        variable = scope.findVariable(targetIdentifier, false);
                        if (
                            variable === undefined &&
                            nearestFuncScope !== null &&
                            scope === nearestFuncScope
                        ) {
                            isFreeVar = true;
                            (<FunctionScope>nearestFuncScope).setIsClosure();
                        }
                        if (variable !== undefined) {
                            if (
                                isFreeVar &&
                                scope.kind === ScopeKind.FunctionScope
                            ) {
                                variable.setVarIsClosure();
                            }
                            break;
                        }
                        scope = scope.parent;
                    }
                }
                const identifierExpr = new IdentifierExpression(
                    (<ts.Identifier>node).getText(),
                );
                identifierExpr.setExprType(
                    this.typeCompiler.generateNodeType(node),
                );
                return identifierExpr;
            }
            case ts.SyntaxKind.BinaryExpression: {
                const binaryExprNode = <ts.BinaryExpression>node;
                const leftExpr = this.visitNode(binaryExprNode.left);
                const rightExpr = this.visitNode(binaryExprNode.right);
                const binaryExpr = new BinaryExpression(
                    binaryExprNode.operatorToken.kind,
                    leftExpr,
                    rightExpr,
                );
                binaryExpr.setExprType(
                    this.typeCompiler.generateNodeType(node),
                );
                return binaryExpr;
            }
            case ts.SyntaxKind.PrefixUnaryExpression: {
                const prefixExprNode = <ts.PrefixUnaryExpression>node;
                const operand = this.visitNode(prefixExprNode.operand);
                const unaryExpr = new UnaryExpression(
                    ts.SyntaxKind.PrefixUnaryExpression,
                    prefixExprNode.operator,
                    operand,
                );
                unaryExpr.setExprType(this.typeCompiler.generateNodeType(node));
                return unaryExpr;
            }
            case ts.SyntaxKind.PostfixUnaryExpression: {
                const postExprNode = <ts.PostfixUnaryExpression>node;
                const operand = this.visitNode(postExprNode.operand);
                const unaryExpr = new UnaryExpression(
                    ts.SyntaxKind.PostfixUnaryExpression,
                    postExprNode.operator,
                    operand,
                );
                unaryExpr.setExprType(this.typeCompiler.generateNodeType(node));
                return unaryExpr;
            }
            case ts.SyntaxKind.ConditionalExpression: {
                const condExprNode = <ts.ConditionalExpression>node;
                const cond = this.visitNode(condExprNode.condition);
                const whenTrue = this.visitNode(condExprNode.whenTrue);
                const whenFalse = this.visitNode(condExprNode.whenFalse);
                const conditionalExpr = new ConditionalExpression(
                    cond,
                    whenTrue,
                    whenFalse,
                );
                conditionalExpr.setExprType(
                    this.typeCompiler.generateNodeType(node),
                );
                return conditionalExpr;
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
                if (
                    callExprNode.expression.kind === ts.SyntaxKind.SuperKeyword
                ) {
                    const callExpr = new SuperCallExpression(args);
                    callExpr.setExprType(
                        this.typeCompiler.generateNodeType(node),
                    );
                    return callExpr;
                }
                const callExpr = new CallExpression(expr, args);
                callExpr.setExprType(this.typeCompiler.generateNodeType(node));
                return callExpr;
            }
            case ts.SyntaxKind.PropertyAccessExpression: {
                const propAccessExprNode = <ts.PropertyAccessExpression>node;
                const parent = this.visitNode(propAccessExprNode.parent);
                const property = this.visitNode(propAccessExprNode.name);
                if (
                    propAccessExprNode.expression.kind ===
                    ts.SyntaxKind.ThisKeyword
                ) {
                    return new ThisExpression(property);
                }
                const expr = this.visitNode(propAccessExprNode.expression);
                const propAccessExpr = new PropertyAccessExpression(
                    expr,
                    property,
                    parent,
                );
                propAccessExpr.setExprType(
                    this.typeCompiler.generateNodeType(node),
                );
                return propAccessExpr;
            }
            case ts.SyntaxKind.ParenthesizedExpression: {
                const expr = this.visitNode(
                    (<ts.ParenthesizedExpression>node).expression,
                );
                const parentesizedExpr = new ParenthesizedExpression(expr);
                parentesizedExpr.setExprType(
                    this.typeCompiler.generateNodeType(node),
                );
                return parentesizedExpr;
            }
            case ts.SyntaxKind.NewExpression: {
                const newExprNode = <ts.NewExpression>node;
                const expr = this.visitNode(newExprNode.expression);
                const args = new Array<Expression>();
                if (newExprNode.arguments !== undefined) {
                    for (const arg of newExprNode.arguments) {
                        args.push(this.visitNode(arg));
                    }
                }
                return new NewExpression(
                    expr,
                    newExprNode.arguments === undefined ? undefined : args,
                );
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
                const objLiteralExpr = new ObjectLiteralExpression(
                    fields,
                    values,
                );
                objLiteralExpr.setExprType(
                    this.typeCompiler.generateNodeType(node),
                );
                return objLiteralExpr;
            }
            case ts.SyntaxKind.ArrayLiteralExpression: {
                const arrLiteralNode = <ts.ArrayLiteralExpression>node;
                const elements = new Array<Expression>();
                for (const elem of arrLiteralNode.elements) {
                    elements.push(this.visitNode(elem));
                }
                const arrLiteralExpr = new ArrayLiteralExpression(elements);
                arrLiteralExpr.setExprType(
                    this.typeCompiler.generateNodeType(node),
                );
                return arrLiteralExpr;
            }
            case ts.SyntaxKind.AsExpression: {
                const asExprNode = <ts.AsExpression>node;
                const expr = this.visitNode(asExprNode.expression);
                const typeNode = asExprNode.type;
                const asExpr = new AsExpression(expr);
                asExpr.setExprType(
                    this.typeCompiler.generateNodeType(typeNode),
                );
                return asExpr;
            }
            default:
                return new Expression(ts.SyntaxKind.Unknown);
        }
    }
}

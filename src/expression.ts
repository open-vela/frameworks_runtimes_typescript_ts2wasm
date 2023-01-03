import ts from 'typescript';

export class Expression {
    private kind: ts.SyntaxKind = ts.SyntaxKind.Unknown;

    get expressionKind() {
        return this.kind;
    }
}

import ts from 'typescript';
import binaryen from 'binaryen';
import { Compiler } from './compiler.js';
import BaseCompiler from './base.js';

export default class LiteralCompiler extends BaseCompiler {
    constructor(compiler: Compiler) {
        super(compiler);
    }

    visitNode(node: ts.Node): binaryen.ExpressionRef {
        switch (node.kind) {
            case ts.SyntaxKind.NumericLiteral: {
                const numericLiteralNode = <ts.NumericLiteral>node;
                const numberValue = parseFloat(numericLiteralNode.getText());
                return this.getBinaryenModule().f64.const(numberValue);
            }
            case ts.SyntaxKind.LiteralType: {
                // used in typechecker, the variable statemented by const has the type.
                const literalTypeNode = <ts.LiteralTypeNode>node;
                // judge literalTypeNode.literal.kind
                const literalKind = literalTypeNode.literal.kind;
                if (literalKind === ts.SyntaxKind.NumericLiteral) {
                    return binaryen.f64;
                } else if (literalKind === ts.SyntaxKind.StringLiteral) {
                    // TODO: more literalTypeNode.literal.kinds, like StringLiteral
                } else if (literalKind === ts.SyntaxKind.FalseKeyword) {
                    return binaryen.i32;
                } else if (literalKind == ts.SyntaxKind.TrueKeyword) {
                    return binaryen.i32;
                }
                break;
            }
        }
        return binaryen.none;
    }
}

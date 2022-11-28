import ts from 'typescript';
import binaryen from 'binaryen';
import { Compiler } from './compiler.js';
import BaseCompiler from './base.js';
import * as binaryenCAPI from './glue/binaryen.js';
import { arrayToPtr } from './glue/transform.js';
import { strArrayTypeInfo, strStructTypeInfo } from './glue/packType.js';

export default class LiteralCompiler extends BaseCompiler {
    constructor(compiler: Compiler) {
        super(compiler);
    }

    visitNode(node: ts.Node, fillScope: boolean): binaryen.ExpressionRef {
        switch (node.kind) {
            case ts.SyntaxKind.NumericLiteral: {
                const numericLiteralNode = <ts.NumericLiteral>node;
                const numberValue = parseFloat(numericLiteralNode.getText());
                return this.getBinaryenModule().f64.const(numberValue);
            }
            case ts.SyntaxKind.StringLiteral: {
                const stringLiteralNode = <ts.StringLiteral>node;
                let stringValue = stringLiteralNode.getText();
                stringValue = stringValue.substring(1, stringValue.length - 1);
                // strLen is equal to strRelLen when character's unicode is less than 0xfff
                // when character's unicode is greater than 0xfff, strLen should be minus 1
                const strLen = stringValue.length;
                let strRelLen = strLen;
                const module = this.getBinaryenModule();
                const strArray = [];
                for (let i = 0; i < strLen; i++) {
                    const codePoint = stringValue.codePointAt(i)!;
                    if (codePoint > 0xffff) {
                        i++;
                        strRelLen--;
                    }
                    strArray.push(module.i32.const(codePoint));
                }
                const arrayValue = binaryenCAPI._BinaryenArrayInit(
                    module.ptr,
                    strArrayTypeInfo.heapTypeRef,
                    arrayToPtr(strArray).ptr,
                    strRelLen,
                );
                const structValue = binaryenCAPI._BinaryenStructNew(
                    module.ptr,
                    arrayToPtr([module.i32.const(0), arrayValue]).ptr,
                    2,
                    strStructTypeInfo.heapTypeRef,
                );
                return structValue;
            }
            case ts.SyntaxKind.LiteralType: {
                // used in typechecker, the variable statemented by const has the type.
                const literalTypeNode = <ts.LiteralTypeNode>node;
                // judge literalTypeNode.literal.kind
                const literalKind = literalTypeNode.literal.kind;
                if (literalKind === ts.SyntaxKind.NumericLiteral) {
                    return binaryen.f64;
                } else if (literalKind === ts.SyntaxKind.StringLiteral) {
                    return strStructTypeInfo.typeRef;
                } else if (literalKind === ts.SyntaxKind.FalseKeyword) {
                    return binaryen.i32;
                } else if (literalKind == ts.SyntaxKind.TrueKeyword) {
                    return binaryen.i32;
                } else if (
                    literalKind === ts.SyntaxKind.PrefixUnaryExpression
                ) {
                    const prefixUnaryExpressionNode = <
                        ts.PrefixUnaryExpression
                    >literalTypeNode.literal;
                    switch (prefixUnaryExpressionNode.operand.kind) {
                        case ts.SyntaxKind.NumericLiteral: {
                            return binaryen.f64;
                        }
                    }
                }
                break;
            }
        }
        return binaryen.none;
    }
}

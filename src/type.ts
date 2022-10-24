import ts from 'typescript';
import binaryen from 'binaryen';
import { Compiler } from './compiler.js';
import BaseCompiler from './base.js';

export default class TypeCompiler extends BaseCompiler {
    constructor(compiler: Compiler) {
        super(compiler);
    }
    visitNode(node: ts.Node, fillScope: boolean): binaryen.Type {
        switch (node.kind) {
            case ts.SyntaxKind.NumberKeyword: {
                return binaryen.f64;
            }
            case ts.SyntaxKind.AnyKeyword: {
                // TODO: handle any type
                return binaryen.anyref;
                break;
            }
            case ts.SyntaxKind.VoidKeyword: {
                return binaryen.none;
            }
            case ts.SyntaxKind.BooleanKeyword: {
                return binaryen.i32;
            }
            case ts.SyntaxKind.FalseKeyword: {
                return this.getBinaryenModule().i32.const(0);
            }
            case ts.SyntaxKind.TrueKeyword: {
                return this.getBinaryenModule().i32.const(1);
            }
            case ts.SyntaxKind.FunctionType: {
                return binaryen.funcref;
            }
        }
        return binaryen.none;
    }
}

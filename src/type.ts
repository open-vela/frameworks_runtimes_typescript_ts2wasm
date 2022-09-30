import ts from 'typescript';
import binaryen from 'binaryen';
import { Compiler } from './compiler.js';
import BaseCompiler from './base.js';

export default class TypeCompiler extends BaseCompiler {
    constructor(compiler: Compiler) {
        super(compiler);
    }
    visitNode(node: ts.Node): binaryen.Type {
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
        }
        return binaryen.none;
    }
}

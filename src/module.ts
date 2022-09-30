import ts from 'typescript';
import binaryen from 'binaryen';
import { Compiler } from './compiler.js';
import BaseCompiler from './base.js';
import { GlobalScope } from './scope.js';

export default class ModuleCompiler extends BaseCompiler {
    constructor(compiler: Compiler) {
        super(compiler);
    }
    visitNode(node: ts.Node): binaryen.Type {
        switch (node.kind) {
            case ts.SyntaxKind.SourceFile: {
                const sourceFileNode = <ts.SourceFile>node;
                const globalScope = new GlobalScope(null);
                this.setCurrentScope(globalScope);
                this.getGlobalScopeStack().push(globalScope);
                for (let i = 0; i < sourceFileNode.statements.length; i++) {
                    this.visit(sourceFileNode.statements[i]);
                }
                this.getGlobalScopeStack().pop();
                break;
            }
        }
        return binaryen.none;
    }
}

import ts from 'typescript';
import binaryen from 'binaryen';
import { Compiler } from './compiler.js';
import BaseCompiler from './base.js';
import { GlobalScope, ScopeKind, FunctionScope, BlockScope } from './scope.js';

export default class ModuleCompiler extends BaseCompiler {
    constructor(compiler: Compiler) {
        super(compiler);
    }
    visitNode(node: ts.Node): binaryen.ExpressionRef {
        switch (node.kind) {
            case ts.SyntaxKind.SourceFile: {
                const sourceFileNode = <ts.SourceFile>node;
                const globalScope = new GlobalScope();
                this.setCurrentScope(globalScope);
                this.getGlobalScopeStack().push(globalScope);
                const startFunctionScope = new FunctionScope(globalScope);
                globalScope.setGlobalFunctionChild(startFunctionScope);
                const startBlockScope = new BlockScope(startFunctionScope);
                startFunctionScope.setFuncName('~start');
                startFunctionScope.setReturnType(binaryen.none);
                for (let i = 0; i < sourceFileNode.statements.length; i++) {
                    this.visit(sourceFileNode.statements[i]);
                }
                this.visit(sourceFileNode.endOfFileToken);
                this.getGlobalScopeStack().pop();
                break;
            }

            case ts.SyntaxKind.EndOfFileToken: {
                const endNode = <ts.EndOfFileToken>node;
                // put all global expressionStatement to a function
                const currentScope = this.getCurrentScope();
                if (currentScope!.kind !== ScopeKind.GlobalScope) {
                    this.reportError(endNode, 'not global scope');
                }
                const currentGlobalScope = <GlobalScope>currentScope;
                const startFunctionScope =
                    currentGlobalScope.getGlobalFunctionChild()!;
                const startBlockScope = <BlockScope>(
                    startFunctionScope.getChildren()[0]
                );
                const body = this.getBinaryenModule().block(
                    null,
                    startBlockScope.getStatementArray(),
                );
                startFunctionScope.setBody(body);
                const startFunctionRef = this.getBinaryenModule().addFunction(
                    startFunctionScope.getFuncName(),
                    binaryen.none,
                    startFunctionScope.getReturnType(),
                    startFunctionScope
                        .getVariableArray()
                        .map(
                            (variable: { variableType: binaryen.Type }) =>
                                variable.variableType,
                        ),
                    body,
                );
                this.getBinaryenModule().setStart(startFunctionRef);
                break;
            }
        }
        return binaryen.none;
    }
}

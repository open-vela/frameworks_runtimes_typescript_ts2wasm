import ts from 'typescript';
import binaryen from 'binaryen';
import { Compiler } from './compiler.js';
import BaseCompiler from './base.js';
import { GlobalScope, ScopeKind } from './scope.js';

export default class ModuleCompiler extends BaseCompiler {
    constructor(compiler: Compiler) {
        super(compiler);
    }
    visitNode(node: ts.Node, fillScope: boolean): binaryen.ExpressionRef {
        switch (node.kind) {
            case ts.SyntaxKind.SourceFile: {
                const sourceFileNode = <ts.SourceFile>node;
                if (fillScope) {
                    const globalScope = new GlobalScope();
                    this.setCurrentScope(globalScope);
                    this.getGlobalScopeStack().push(globalScope);
                    globalScope.setFuncName('~start');
                    globalScope.setReturnType(binaryen.none);
                    for (let i = 0; i < sourceFileNode.statements.length; i++) {
                        this.visit(sourceFileNode.statements[i], fillScope);
                    }
                    this.visit(sourceFileNode.endOfFileToken, fillScope);
                } else {
                    const globalScope = this.getGlobalScopeStack().peek();
                    this.setCurrentScope(globalScope);
                    for (let i = 0; i < sourceFileNode.statements.length; i++) {
                        this.visit(sourceFileNode.statements[i]);
                    }
                    this.visit(sourceFileNode.endOfFileToken);
                    this.getGlobalScopeStack().pop();
                }
                break;
            }

            case ts.SyntaxKind.EndOfFileToken: {
                const endNode = <ts.EndOfFileToken>node;
                if (!fillScope) {
                    // put all global expressionStatement to a function
                    const currentScope = this.getCurrentScope();
                    if (currentScope.kind !== ScopeKind.GlobalScope) {
                        this.reportError(endNode, 'not global scope');
                    }
                    const currentGlobalScope = <GlobalScope>currentScope;
                    const body = this.getBinaryenModule().block(
                        null,
                        currentGlobalScope.getStatementArray(),
                    );
                    currentGlobalScope.setBody(body);
                    const startFunctionRef =
                        this.getBinaryenModule().addFunction(
                            currentGlobalScope.getFuncName(),
                            binaryen.none,
                            currentGlobalScope.getReturnType(),
                            currentGlobalScope
                                .getStartFunctionVariableArray()
                                .map(
                                    (variable: {
                                        variableType: binaryen.Type;
                                    }) => variable.variableType,
                                ),
                            currentGlobalScope.getBody(),
                        );
                    this.getBinaryenModule().setStart(startFunctionRef);
                }

                break;
            }
        }
        return binaryen.none;
    }
}

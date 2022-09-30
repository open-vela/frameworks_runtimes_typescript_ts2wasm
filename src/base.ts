import { Compiler } from './compiler.js';
import ts from 'typescript';
import binaryen from 'binaryen';
import { Scope } from './scope.js';

export default class BaseCompiler {
    compiler: Compiler;

    constructor(compiler: Compiler) {
        this.compiler = compiler;
    }

    visit(node: ts.Node): binaryen.Type {
        return this.compiler.visit(node);
    }

    visitNode(node: ts.Node): binaryen.Type {
        return binaryen.none;
    }

    getGlobalScopeStack() {
        return this.compiler.globalScopeStack;
    }

    getFunctionScopeStack() {
        return this.compiler.functionScopeStack;
    }

    getBlockScopeStack() {
        return this.compiler.blockScopeStack;
    }

    setCurrentScope(currentScope: Scope | null) {
        this.compiler.currentScope = currentScope;
    }

    getCurrentScope() {
        return this.compiler.currentScope;
    }

    getLoopLabelArray() {
        return this.compiler.loopLabelArray;
    }

    getBinaryenModule() {
        return this.compiler.binaryenModule;
    }

    getTypeChecker() {
        return this.compiler.typeChecker;
    }

    reportError(node: ts.Node, message: string) {
        this.compiler.reportError(node, message);
    }

    getVariableType(node: ts.Node, checker: ts.TypeChecker): ts.Node {
        let variableType: ts.Type;
        if (ts.isTypeReferenceNode(node)) {
            node = (node as ts.TypeReferenceNode).typeName;
        }
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol === undefined) {
            variableType = checker.getTypeAtLocation(node);
        } else {
            if (ts.isTypeReferenceNode(node)) {
                variableType = checker.getDeclaredTypeOfSymbol(symbol);
            } else {
                variableType = checker.getTypeOfSymbolAtLocation(
                    symbol,
                    symbol.declarations![0],
                );
            }
        }
        return checker.typeToTypeNode(variableType, undefined, undefined)!;
    }
}

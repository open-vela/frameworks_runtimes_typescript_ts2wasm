import { Compiler } from './compiler.js';
import ts from 'typescript';
import binaryen from 'binaryen';
import { Scope, FunctionScope } from './scope.js';

export default class BaseCompiler {
    compiler: Compiler;

    constructor(compiler: Compiler) {
        this.compiler = compiler;
    }

    visit(node: ts.Node, fillScope = false): binaryen.ExpressionRef {
        // return this.compiler.visit(node, fillScope);
        return binaryen.none;
    }

    visitNode(node: ts.Node, fillScope: boolean): binaryen.ExpressionRef {
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
        let scope = this.compiler.currentScope;
        if (!scope) {
            throw new Error('Current Scope is null');
        }
        scope = <Scope>scope;
        return scope;
    }

    getLoopLabelStack() {
        return this.compiler.loopLabelStack;
    }

    getBreakLabelsStack() {
        return this.compiler.breakLabelsStack;
    }

    getSwitchLabelStack() {
        return this.compiler.switchLabelStack;
    }

    getAnonymousFunctionNameStack() {
        return this.compiler.anonymousFunctionNameStack;
    }

    getBinaryenModule() {
        return this.compiler.binaryenModule;
    }

    setLocalValue(
        variableIndex: number,
        value: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        return this.getBinaryenModule().local.set(variableIndex, value);
    }

    getLocalValue(
        variableIndex: number,
        variableType: binaryen.Type,
    ): binaryen.ExpressionRef {
        return this.getBinaryenModule().local.get(variableIndex, variableType);
    }

    setGlobalValue(
        variableName: string,
        value: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        return this.getBinaryenModule().global.set(variableName, value);
    }

    getGlobalValue(
        variableName: string,
        variableType: binaryen.Type,
    ): binaryen.ExpressionRef {
        return this.getBinaryenModule().global.get(variableName, variableType);
    }

    getTypeChecker() {
        return this.compiler.typeChecker!;
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

    storeFunctionLikeDeclaration(
        node: ts.FunctionLikeDeclaration,
        fillScope = false,
    ) {
        let functionName: string;
        if (node.name !== undefined) {
            functionName = node.name.getText();
        } else {
            functionName =
                'anonymous_' + this.getAnonymousFunctionNameStack().size();
            this.getAnonymousFunctionNameStack().push(functionName);
        }
        const currentScope = this.getCurrentScope();
        const functionScope = new FunctionScope(currentScope);
        this.setCurrentScope(functionScope);
        this.getFunctionScopeStack().push(functionScope);
        functionScope.setCorNode(node);
        const modifiers = ts.getModifiers(node);
        if (modifiers !== undefined) {
            for (let i = 0; i < modifiers.length; i++) {
                functionScope.addModifier(modifiers[i].kind);
            }
        }
        functionScope.setFuncName(functionName);
        for (let i = 0; i < node.parameters.length; i++) {
            this.visit(node.parameters[i]);
        }
        if (node.type === undefined) {
            // By default, the type can be regarded as void, the truely return type will be judged by the return value in the ReturnStatement
            functionScope.setReturnType(binaryen.none);
            functionScope.setReturnTypeUndefined(true);
        } else {
            functionScope.setReturnType(this.visit(node.type));
        }
        // TODO DELETE: error TS2391: Function implementation is missing or not immediately following the declaration.
        if (node.body === undefined) {
            this.reportError(node, 'error TS2391');
        }
        // Continue to record the scope stucture in function's body
        functionScope.setBody(this.visit(node.body!, fillScope));
        const currentFunctionScope = this.getFunctionScopeStack().pop();
        this.setCurrentScope(currentFunctionScope.getParent());
    }

    generateFunctionLikeDeclaration(node: ts.FunctionLikeDeclaration) {
        const currentScope = this.getCurrentScope();
        let currentFunctionScope = null;
        for (let i = 0; i < currentScope.getChildren().length; i++) {
            const child = currentScope.getChildren()[i];
            if (child.getCorNode() === node) {
                currentFunctionScope = child;
            }
        }
        if (!currentFunctionScope) {
            this.reportError(
                node,
                'Can not find the node in the scope structure',
            );
        }
        currentFunctionScope = <FunctionScope>currentFunctionScope;
        this.setCurrentScope(currentFunctionScope);
        this.getFunctionScopeStack().push(currentFunctionScope);
        currentFunctionScope.setBody(this.visit(node.body!));
        this.getBinaryenModule().addFunction(
            currentFunctionScope.getFuncName(),
            binaryen.createType(
                currentFunctionScope
                    .getParamArray()
                    .map(
                        (param: { variableType: binaryen.Type }) =>
                            param.variableType,
                    ),
            ),
            currentFunctionScope.getReturnType(),
            currentFunctionScope
                .getVariableArray()
                .map(
                    (variable: { variableType: binaryen.Type }) =>
                        variable.variableType,
                ),
            currentFunctionScope.getBody(),
        );
        for (let i = 0; i < currentFunctionScope.getModifiers().length; i++) {
            if (
                currentFunctionScope.getModifiers()[i] ===
                ts.SyntaxKind.ExportKeyword
            ) {
                this.getBinaryenModule().addFunctionExport(
                    currentFunctionScope.getFuncName(),
                    currentFunctionScope.getFuncName(),
                );
            }
        }
        this.getFunctionScopeStack().pop();
        this.setCurrentScope(currentFunctionScope.getParent());
    }

    convertTypeToI32(
        expression: binaryen.ExpressionRef,
        expressionType: binaryen.Type,
    ): binaryen.ExpressionRef {
        switch (expressionType) {
            case binaryen.f64: {
                return this.getBinaryenModule().i32.trunc_u_sat.f64(expression);
            }
            case binaryen.i32: {
                return expression;
            }
            // TODO: deal with more types
        }
        return binaryen.none;
    }
}

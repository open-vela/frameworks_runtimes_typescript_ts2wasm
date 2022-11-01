import { Compiler } from './compiler.js';
import ts from 'typescript';
import binaryen from 'binaryen';
import {
    GlobalScope,
    BlockScope,
    Scope,
    ScopeKind,
    FunctionScope,
} from './scope.js';

export default class BaseCompiler {
    compiler: Compiler;

    constructor(compiler: Compiler) {
        this.compiler = compiler;
    }

    visit(node: ts.Node, fillScope = false): binaryen.ExpressionRef {
        return this.compiler.visit(node, fillScope);
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
        return this.compiler.currentScope;
    }

    getStartBlockScope(currentScope: Scope): BlockScope {
        const currentGlobalScope = <GlobalScope>currentScope;
        const currentStartBlockScope = <BlockScope>(
            currentGlobalScope.getGlobalFunctionChild()!.getChildren()[0]
        );
        return currentStartBlockScope;
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
        let currentScope = this.getCurrentScope()!;
        if (currentScope.kind === ScopeKind.StartBlockScope) {
            currentScope = this.getGlobalScopeStack().peek();
        }

        // connet functionScope with its parentScope
        const functionScope = new FunctionScope(currentScope);
        this.setCurrentScope(functionScope);
        // push the current function into stack
        this.getFunctionScopeStack().push(functionScope);
        // add function modifier
        const modifiers = ts.getModifiers(node);
        if (modifiers !== undefined) {
            for (let i = 0; i < modifiers.length; i++) {
                functionScope.addModifier(modifiers[i].kind);
            }
        }
        // set function name
        functionScope.setFuncName(functionName);
        // set function parameters
        for (let i = 0; i < node.parameters.length; i++) {
            this.visit(node.parameters[i]);
        }
        // get return type of function
        if (node.type === undefined) {
            // By default, the type can be regarded as void, else, the function' return type should be judged by the return value
            functionScope.setReturnType(binaryen.none);
            functionScope.setReturnTypeUndefined(true);
        } else {
            functionScope.setReturnType(this.visit(node.type));
        }
        // TODO DELETE: error TS2391: Function implementation is missing or not immediately following the declaration.
        if (node.body === undefined) {
            this.reportError(node, 'error TS2391');
        }
        // handle function body, add connection between functionScope and blockScope in the Block Node.
        functionScope.setBody(this.visit(node.body!, fillScope));
        // pop the current function after setting its value into scope.
        const currentFunctionScope = this.getFunctionScopeStack().pop()!;
        this.setCurrentScope(currentFunctionScope.getParent());
    }

    generateFunctionLikeDeclaration(node: ts.FunctionLikeDeclaration) {
        let functionName: string;
        if (node.name !== undefined) {
            functionName = node.name.getText();
        } else {
            functionName = this.getAnonymousFunctionNameStack().peek();
        }
        let currentScope = this.getCurrentScope()!;
        if (currentScope.kind === ScopeKind.StartBlockScope) {
            currentScope = this.getGlobalScopeStack().peek();
        }
        const currentFunctionScope =
            currentScope.findFunctionScope(functionName)!;
        this.setCurrentScope(currentFunctionScope);
        // push the current function into stack
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
        this.getFunctionScopeStack().pop()!;
        this.setCurrentScope(currentFunctionScope.getParent());
    }

    toTrueOrFalse(
        expression: binaryen.ExpressionRef,
        expressionType: binaryen.Type,
    ): binaryen.ExpressionRef {
        const module = this.getBinaryenModule();

        switch (expressionType) {
            case binaryen.i32: {
                return expression;
            }
            case binaryen.f64: {
                return module.i32.eqz(
                    module.i32.eqz(
                        module.i32.trunc_u_sat.f64(
                            module.f64.ceil(module.f64.abs(expression)),
                        ),
                    ),
                );
            }
            default: {
                return binaryen.none;
            }
        }
    }

    getCommonType(
        lhsType: binaryen.Type,
        rhsType: binaryen.Type,
    ): binaryen.Type {
        if (lhsType === rhsType) {
            return lhsType;
        }
        if (lhsType < rhsType) {
            return rhsType;
        }
        return lhsType;
    }

    convertType(
        expression: binaryen.ExpressionRef,
        from: binaryen.Type,
        to: binaryen.Type,
    ) {
        if (from === to) {
            return expression;
        }
        const module = this.getBinaryenModule();
        if (from === binaryen.i32) {
            if (to === binaryen.f64) {
                return module.f64.convert_s.i32(expression);
            }
        }
        // TODO: deal with more types
        return binaryen.none;
    }
}

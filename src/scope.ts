import ts from 'typescript';
import binaryen from 'binaryen';
import { VariableInfo } from './utils.js';

export enum ScopeKind {
    Scope,
    GlobalScope,
    FunctionScope,
    BlockScope,
}

export class Scope {
    kind = ScopeKind.Scope;
    variableArray: VariableInfo[] = [];
    children: Scope[] = [];
    parent: Scope | null;
    judgedGlobalVariable = '';
    corNode: ts.Node | null = null;

    constructor(parent: Scope | null) {
        this.parent = parent;
        if (this.parent !== null) {
            this.parent.addChild(this);
        }
    }

    addVariable(variableInfo: VariableInfo) {
        this.variableArray.push(variableInfo);
    }

    getVariableArray() {
        return this.variableArray;
    }

    addChild(child: Scope) {
        this.children.push(child);
    }

    getChildren() {
        return this.children;
    }

    getParent() {
        return this.parent;
    }

    setCorNode(corNode: ts.Node) {
        this.corNode = corNode;
    }

    getCorNode() {
        return this.corNode;
    }

    findVariable(
        variableName: string,
        nested = true,
    ): VariableInfo | undefined {
        if (nested) {
            let currentScope: Scope | null = this;
            while (currentScope != null) {
                if (currentScope.findVariable(variableName, false)) {
                    if (currentScope.kind === ScopeKind.GlobalScope) {
                        this.setJudgedGlobalVariable(variableName);
                    }
                    return currentScope.findVariable(variableName, false);
                }
                currentScope = currentScope.getParent();
            }
        } else {
            for (let i = 0; i < this.variableArray.length; i++) {
                if (this.variableArray[i].variableName === variableName) {
                    return this.variableArray[i];
                }
            }
        }
    }

    setJudgedGlobalVariable(variableName: string) {
        this.judgedGlobalVariable = variableName;
    }

    isGlobalVariable(variableName: string) {
        if (this.judgedGlobalVariable === variableName) {
            return true;
        }
        return false;
    }

    findFunctionScope(
        functionName: string,
        nested = true,
    ): FunctionScope | undefined {
        if (nested) {
            let currentScope: Scope | null = this;
            while (currentScope != null) {
                if (currentScope.findFunctionScope(functionName, false)) {
                    return currentScope.findFunctionScope(functionName, false);
                }
                currentScope = currentScope.getParent();
            }
        } else {
            for (let i = 0; i < this.children.length; i++) {
                if (this.children[i].kind === ScopeKind.FunctionScope) {
                    const functionScope = <FunctionScope>this.children[i];
                    if (functionScope.getFuncName() === functionName) {
                        return functionScope;
                    }
                }
            }
        }
    }
}

export class GlobalScope extends Scope {
    kind = ScopeKind.GlobalScope;
    funcName = '';
    paramArray: VariableInfo[] = [];
    returnType: binaryen.Type = binaryen.none;
    returnTypeUndefined = false;
    body: binaryen.ExpressionRef = binaryen.none;
    modifiers: ts.SyntaxKind[] = [];
    statementArray: binaryen.ExpressionRef[] = [];
    startFunctionVariableArray: VariableInfo[] = [];

    constructor(parent: Scope | null = null) {
        super(parent);
    }

    addParameter(parameter: VariableInfo) {
        this.paramArray.push(parameter);
    }

    getParamArray() {
        return this.paramArray;
    }

    addStartFunctionVariable(variableInfo: VariableInfo) {
        this.startFunctionVariableArray.push(variableInfo);
    }

    getStartFunctionVariableArray() {
        return this.startFunctionVariableArray;
    }

    setFuncName(name: string) {
        this.funcName = name;
    }

    getFuncName() {
        return this.funcName;
    }

    setReturnType(returnType: binaryen.Type) {
        this.returnType = returnType;
    }

    getReturnType() {
        return this.returnType;
    }

    setReturnTypeUndefined(returnTypeUndefined: boolean) {
        this.returnTypeUndefined = returnTypeUndefined;
    }

    getReturnTypeUndefined() {
        return this.returnTypeUndefined;
    }

    setBody(body: binaryen.ExpressionRef) {
        this.body = body;
    }

    getBody() {
        return this.body;
    }

    addModifier(modifier: ts.SyntaxKind) {
        this.modifiers.push(modifier);
    }

    getModifiers() {
        return this.modifiers;
    }

    addStatement(statement: binaryen.ExpressionRef) {
        this.statementArray.push(statement);
    }

    getStatementArray() {
        return this.statementArray;
    }
}

export class FunctionScope extends Scope {
    kind = ScopeKind.FunctionScope;
    funcName = '';
    paramArray: VariableInfo[] = [];
    returnType: binaryen.Type = binaryen.none;
    returnTypeUndefined = false;
    body: binaryen.ExpressionRef = binaryen.none;
    modifiers: ts.SyntaxKind[] = [];

    constructor(parent: Scope) {
        super(parent);
    }

    addParameter(parameter: VariableInfo) {
        this.paramArray.push(parameter);
    }

    getParamArray() {
        return this.paramArray;
    }

    setFuncName(name: string) {
        this.funcName = name;
    }

    getFuncName() {
        return this.funcName;
    }

    setReturnType(returnType: binaryen.Type) {
        this.returnType = returnType;
    }

    getReturnType() {
        return this.returnType;
    }

    setReturnTypeUndefined(returnTypeUndefined: boolean) {
        this.returnTypeUndefined = returnTypeUndefined;
    }

    getReturnTypeUndefined() {
        return this.returnTypeUndefined;
    }

    setBody(body: binaryen.ExpressionRef) {
        this.body = body;
    }

    getBody() {
        return this.body;
    }

    addModifier(modifier: ts.SyntaxKind) {
        this.modifiers.push(modifier);
    }

    getModifiers() {
        return this.modifiers;
    }

    findVariable(
        variableName: string,
        nested = true,
    ): VariableInfo | undefined {
        if (nested) {
            let currentScope: Scope | null = this;
            while (currentScope != null) {
                if (currentScope.findVariable(variableName, false)) {
                    if (currentScope.kind === ScopeKind.GlobalScope) {
                        this.setJudgedGlobalVariable(variableName);
                    }
                    return currentScope.findVariable(variableName, false);
                }
                currentScope = currentScope.getParent();
            }
        } else {
            for (let i = 0; i < this.paramArray.length; i++) {
                if (this.paramArray[i].variableName === variableName) {
                    return this.paramArray[i];
                }
            }
        }
    }
}

export class BlockScope extends Scope {
    kind = ScopeKind.BlockScope;
    statementArray: binaryen.ExpressionRef[] = [];

    constructor(parent: Scope) {
        super(parent);
    }

    addStatement(statement: binaryen.ExpressionRef) {
        this.statementArray.push(statement);
    }

    getStatementArray() {
        return this.statementArray;
    }
}

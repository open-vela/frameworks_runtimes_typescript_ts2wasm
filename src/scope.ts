import binaryen from 'binaryen';
import { VariableInfo } from './utils.js';

export enum ScopeKind {
    Scope,
    GlobalScope,
    FunctionScope,
    BlockScope,
    StartFunctionScope,
    StartBlockScope,
}

export class Scope {
    kind = ScopeKind.Scope;
    variableArray: VariableInfo[] = [];
    children: Scope[] = [];
    parent: Scope | null;
    isGlobalVariable: Map<string, boolean> = new Map();

    constructor(parent: Scope | null) {
        this.parent = parent;
        if (this.parent !== null) {
            this.parent.addChild(this);
        }
    }

    addVariable(variableInfo: VariableInfo) {
        this.variableArray.push(variableInfo);
    }

    addChild(child: Scope) {
        this.children.push(child);
    }

    getParent() {
        return this.parent;
    }

    getChildren() {
        return this.children;
    }

    getVariableArray() {
        return this.variableArray;
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
                        this.setIsGlobalVariable(variableName, true);
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

    setIsGlobalVariable(variableName: string, isGlobalVariable: boolean) {
        this.isGlobalVariable.set(variableName, isGlobalVariable);
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
    globalFunctionChild: FunctionScope | null = null;

    constructor() {
        super(null);
    }

    setGlobalFunctionChild(startFunctionScope: FunctionScope) {
        this.globalFunctionChild = startFunctionScope;
        this.globalFunctionChild.kind = ScopeKind.StartFunctionScope;
    }

    getGlobalFunctionChild() {
        return this.globalFunctionChild;
    }
}

export class FunctionScope extends Scope {
    kind = ScopeKind.FunctionScope;
    funcName = '';
    paramArray: VariableInfo[] = [];
    returnType: binaryen.Type = binaryen.none;
    returnTypeUndefined = false;
    body: binaryen.ExpressionRef = binaryen.none;

    constructor(parent: Scope) {
        super(parent);
    }

    addParameter(parameter: VariableInfo) {
        this.paramArray.push(parameter);
    }

    setFuncName(name: string) {
        this.funcName = name;
    }

    setReturnType(returnType: binaryen.Type) {
        this.returnType = returnType;
    }

    setReturnTypeUndefined(returnTypeUndefined: boolean) {
        this.returnTypeUndefined = returnTypeUndefined;
    }

    getParamArray() {
        return this.paramArray;
    }

    getFuncName() {
        return this.funcName;
    }

    getReturnType() {
        return this.returnType;
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

    findVariable(
        variableName: string,
        nested = true,
    ): VariableInfo | undefined {
        if (nested) {
            let currentScope: Scope | null = this;
            while (currentScope != null) {
                if (currentScope.findVariable(variableName, false)) {
                    if (currentScope.kind === ScopeKind.GlobalScope) {
                        this.setIsGlobalVariable(variableName, true);
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
        if (parent.kind === ScopeKind.StartFunctionScope) {
            this.kind = ScopeKind.StartBlockScope;
        }
    }

    addStatement(statement: binaryen.ExpressionRef) {
        this.statementArray.push(statement);
    }

    getStatementArray() {
        return this.statementArray;
    }
}

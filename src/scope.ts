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

    constructor(parent: Scope | null) {
        this.parent = parent;
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

    findVariable(variableName: string) {
        for (let i = 0; i < this.variableArray.length; i++) {
            if (this.variableArray[i].variableName === variableName) {
                return this.variableArray[i];
            }
        }
    }
}

export class GlobalScope extends Scope {
    kind = ScopeKind.GlobalScope;
}

export class FunctionScope extends Scope {
    kind = ScopeKind.FunctionScope;
    funcName = '';
    paramArray: VariableInfo[] = [];
    returnType: binaryen.Type = binaryen.none;
    returnTypeUndefined = false;
    body: binaryen.Type = binaryen.none;

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

    setBody(body: binaryen.Type) {
        this.body = body;
    }

    getBody() {
        return this.body;
    }

    findVariable(variableName: string) {
        for (let i = 0; i < this.paramArray.length; i++) {
            if (this.paramArray[i].variableName === variableName) {
                return this.paramArray[i];
            }
        }
    }
}

export class BlockScope extends Scope {
    kind = ScopeKind.BlockScope;
    statementArray: binaryen.Type[] = [];

    constructor(parent: Scope) {
        super(parent);
    }

    addStatement(statement: binaryen.Type) {
        this.statementArray.push(statement);
    }

    getStatementArray() {
        return this.statementArray;
    }
}

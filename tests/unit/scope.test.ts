import 'mocha';
import binaryen from 'binaryen';
import { expect } from 'chai';
import {
    GlobalScope,
    FunctionScope,
    BlockScope,
    ScopeKind,
} from '../../src/scope.js';
import { AssignKind } from '../../src/utils.js';

describe('testScope', function () {
    it('nestedScope', function () {
        const globalScope = new GlobalScope();
        const funcScope = new FunctionScope(globalScope);
        const blockScope = new BlockScope(funcScope);

        expect(funcScope.getParent()).eq(globalScope);
        expect(blockScope.getParent()).eq(funcScope);
    });

    it('findVariableInGlobalScope', function () {
        const globalScope = new GlobalScope();
        const varInfo = {
            variableName: 'test_var',
            variableType: 0,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        globalScope.addVariable(varInfo);

        expect(globalScope.findVariable('test_var', false)).eq(varInfo);
        expect(globalScope.findVariable('test_var')).eq(varInfo);
    });

    it('findVariableInFuncScope', function () {
        const globalScope = new GlobalScope();
        const funcScope = new FunctionScope(globalScope);
        const varInfo = {
            variableName: 'test_var',
            variableType: 0,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        funcScope.addParameter(varInfo);

        expect(funcScope.findVariable('test_var', false)).eq(varInfo);
        expect(funcScope.findVariable('test_var')).eq(varInfo);
    });

    it('findVariableInBlockScope', function () {
        const globalScope = new GlobalScope();
        const funcScope = new FunctionScope(globalScope);
        const blockScope = new BlockScope(funcScope);
        const varInfo = {
            variableName: 'test_var',
            variableType: 0,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        blockScope.addVariable(varInfo);

        expect(blockScope.findVariable('test_var', false)).eq(varInfo);
        expect(blockScope.findVariable('test_var')).eq(varInfo);
    });

    it('findVariableInBothBlockAndFuncScope', function () {
        const globalScope = new GlobalScope();
        const funcScope = new FunctionScope(globalScope);
        const blockScope = new BlockScope(funcScope);
        const funcVarInfo = {
            variableName: 'test_var',
            variableType: 0,
            variableIndex: 1,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        const blockVarInfo = {
            variableName: 'test_var',
            variableType: 0,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        funcScope.addParameter(funcVarInfo);
        blockScope.addVariable(blockVarInfo);

        expect(funcScope.findVariable('test_var')).eq(funcVarInfo);
        expect(blockScope.findVariable('test_var')).eq(blockVarInfo);
    });

    it('findVariableFromParentScope', function () {
        const globalScope = new GlobalScope();
        const funcScope = new FunctionScope(globalScope);
        const blockScope = new BlockScope(funcScope);
        const varInfo = {
            variableName: 'test_var',
            variableType: 0,
            variableIndex: 1,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        funcScope.addParameter(varInfo);

        expect(funcScope.findVariable('test_var')).eq(varInfo);
        expect(blockScope.findVariable('test_var')).eq(varInfo);
    });

    it('findVariableFromCurrentAndParentScope', function () {
        const globalScope = new GlobalScope();
        const globalVarInfo = {
            variableName: 'test_global_var',
            variableType: 0,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        globalScope.addVariable(globalVarInfo);
        const functionScope = new FunctionScope(globalScope);
        const funcVarInfo = {
            variableName: 'test_func_var',
            variableType: 0,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        functionScope.addParameter(funcVarInfo);
        const blockScope = new BlockScope(functionScope);
        const blockVarInfo = {
            variableName: 'test_block_var',
            variableType: 0,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        blockScope.addVariable(blockVarInfo);

        expect(globalScope.findVariable('test_global_var')).eq(globalVarInfo);
        expect(globalScope.findVariable('test_func_var')).eq(undefined);
        expect(globalScope.findVariable('test_block_var')).eq(undefined);
        expect(functionScope.findVariable('test_global_var')).eq(globalVarInfo);
        expect(functionScope.findVariable('test_func_var')).eq(funcVarInfo);
        expect(functionScope.findVariable('test_block_var')).eq(undefined);
        expect(blockScope.findVariable('test_global_var')).eq(globalVarInfo);
        expect(blockScope.findVariable('test_func_var')).eq(funcVarInfo);
        expect(blockScope.findVariable('test_block_var')).eq(blockVarInfo);
    });

    it('getParentAndChildren', function () {
        const globalScope = new GlobalScope();
        const functionScope = new FunctionScope(globalScope);
        const blockScope = new BlockScope(functionScope);

        expect(globalScope.getParent()).eq(null);
        expect(globalScope.getChildren()[0]).eq(functionScope);
        expect(functionScope.getParent()).eq(globalScope);
        expect(functionScope.getChildren()[0]).eq(blockScope);
        expect(blockScope.getParent()).eq(functionScope);
        expect(blockScope.getChildren().length).eq(0);
    });

    it('judgeVariableIsGlobal', function () {
        const globalScope = new GlobalScope();
        const globalVarInfo = {
            variableName: 'test_global_var',
            variableType: 0,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        globalScope.addVariable(globalVarInfo);
        const functionScope = new FunctionScope(globalScope);
        const blockScope = new BlockScope(functionScope);
        const blockVarInfo = {
            variableName: 'test_block_var',
            variableType: 0,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        blockScope.addVariable(blockVarInfo);

        expect(blockScope.findVariable('test_global_var')).eq(globalVarInfo);
        expect(blockScope.isGlobalVariable('test_global_var')).eq(true);
        expect(blockScope.findVariable('test_block_var')).eq(blockVarInfo);
        expect(blockScope.isGlobalVariable('test_block_var')).eq(false);
    });

    it('judgeScopeKind', function () {
        const globalScope = new GlobalScope();
        const functionScope = new FunctionScope(globalScope);
        const blockScope = new BlockScope(functionScope);

        expect(globalScope.kind).eq(ScopeKind.GlobalScope);
        expect(functionScope.kind).eq(ScopeKind.FunctionScope);
        expect(blockScope.kind).eq(ScopeKind.BlockScope);
    });

    it('findFunctionScope', function () {
        const globalScope = new GlobalScope();
        const functionScope = new FunctionScope(globalScope);
        const blockScope = new BlockScope(functionScope);
        functionScope.setFuncName('function1');

        const internalFunctionScope = new FunctionScope(blockScope);
        const internalBlockScope = new BlockScope(internalFunctionScope);
        internalFunctionScope.setFuncName('function2');

        expect(blockScope.findFunctionScope('function1', false)).eq(undefined);
        expect(blockScope.findFunctionScope('function1')).eq(functionScope);
        expect(blockScope.findFunctionScope('function2', false)).eq(
            internalFunctionScope,
        );
        expect(internalBlockScope.findFunctionScope('function2', false)).eq(
            undefined,
        );
        expect(internalBlockScope.findFunctionScope('function2')).eq(
            internalFunctionScope,
        );
        expect(internalBlockScope.findFunctionScope('function1')).eq(
            functionScope,
        );
    });

    it('getFunctionFromGlobalScope', function () {
        const globalScope = new GlobalScope();
        globalScope.setFuncName('~start');

        expect(globalScope.getFuncName()).eq('~start');
    });

    it('getStartFunctionVariableFromGlobalScope', function () {
        const globalScope = new GlobalScope();
        const startVarInfo1 = {
            variableName: 'test_start_var1',
            variableType: 0,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        const startVarInfo2 = {
            variableName: 'test_start_var2',
            variableType: 1,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        globalScope.addStartFunctionVariable(startVarInfo1);
        globalScope.addStartFunctionVariable(startVarInfo2);
        const varsTypeList = globalScope
            .getStartFunctionVariableArray()
            .map(
                (variable: { variableType: binaryen.Type }) =>
                    variable.variableType,
            );

        expect(varsTypeList.length).eq(2);
        expect(varsTypeList[0]).eq(0);
        expect(varsTypeList[1]).eq(1);
    });

    it('getStatementFromGlobalScope', function () {
        const globalScope = new GlobalScope();
        globalScope.addStatement(1);
        globalScope.addStatement(2);

        expect(globalScope.getStatementArray().length).eq(2);
        expect(globalScope.getStatementArray()[0]).eq(1);
        expect(globalScope.getStatementArray()[1]).eq(2);
    });
});

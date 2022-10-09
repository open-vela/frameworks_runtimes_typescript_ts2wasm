import 'mocha';
import { expect } from 'chai';
import { GlobalScope, FunctionScope, BlockScope } from '../../src/scope.js';
import { AssignKind } from '../../src/utils.js';

describe('testScope', function () {
    it('nestedScope', function () {
        const globalScope = new GlobalScope(null);
        const funcScope = new FunctionScope(globalScope);
        const blockScope = new BlockScope(funcScope);

        expect(funcScope.getParent()).eq(globalScope);
        expect(blockScope.getParent()).eq(funcScope);
    });

    it('findVariableInGlobalScope', function () {
        const globalScope = new GlobalScope(null);
        const varInfo = {
            variableName: 'test_var',
            variableType: 0,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        globalScope.addVariable(varInfo);

        expect(globalScope.findVariable('test_var')).eq(varInfo);
    });

    it('findVariableInFuncScope', function () {
        const globalScope = new GlobalScope(null);
        const funcScope = new FunctionScope(globalScope);
        const varInfo = {
            variableName: 'test_var',
            variableType: 0,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.let,
        };
        funcScope.addParameter(varInfo);

        expect(funcScope.findVariable('test_var')).eq(varInfo);
    });

    it('findVariableInBlockScope', function () {
        const globalScope = new GlobalScope(null);
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

        expect(blockScope.findVariable('test_var')).eq(varInfo);
    });

    it('findVariableInBothBlockAndFuncScope', function () {
        const globalScope = new GlobalScope(null);
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
        const globalScope = new GlobalScope(null);
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
        expect(blockScope.findVariable('test_var')).eq(
            varInfo,
            'Failed to find variable from parent scope',
        );
    });
});

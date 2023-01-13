import ts from 'typescript';
import 'mocha';
import { expect } from 'chai';
import {
    GlobalScope,
    FunctionScope,
    BlockScope,
    ScopeKind,
} from '../../src/scope.js';
import { Variable, Parameter, ModifierKind } from '../../src/variable.js';
import { Primitive, Type } from '../../src/type.js';
import { Statement } from '../../src/statement.js';

describe('testScope', function () {
    it('nestedScope', function () {
        const globalScope = new GlobalScope();
        const funcScope = new FunctionScope(globalScope);
        const blockScope = new BlockScope(funcScope);

        expect(globalScope.parent).eq(null);
        expect(funcScope.parent).eq(globalScope);
        expect(blockScope.parent).eq(funcScope);
    });

    it('scopeKind', function () {
        const globalScope = new GlobalScope();
        const funcScope = new FunctionScope(globalScope);
        const blockScope = new BlockScope(funcScope);

        expect(globalScope.kind).eq(ScopeKind.GlobalScope);
        expect(funcScope.kind).eq(ScopeKind.FunctionScope);
        expect(blockScope.kind).eq(ScopeKind.BlockScope);
    });

    it('findVariableInScope', function () {
        const globalScope = new GlobalScope();
        const var1 = new Variable('var1', new Type(), ModifierKind.default, 0);
        globalScope.addVariable(var1);

        const funcScope = new FunctionScope(globalScope);
        const var2 = new Variable('var2', new Type(), ModifierKind.default, 0);
        funcScope.addVariable(var2);

        const blockScope = new BlockScope(funcScope);
        const var3 = new Variable('var3', new Type(), ModifierKind.default, 0);
        blockScope.addVariable(var3);

        expect(globalScope.findVariable('var1')).eq(var1);
        expect(globalScope.findVariable('var2')).eq(undefined);
        expect(globalScope.findVariable('var3')).eq(undefined);

        expect(funcScope.findVariable('var1')).eq(var1);
        expect(funcScope.findVariable('var2')).eq(var2);
        expect(funcScope.findVariable('var3')).eq(undefined);

        expect(blockScope.findVariable('var1')).eq(var1);
        expect(blockScope.findVariable('var2')).eq(var2);
        expect(blockScope.findVariable('var3')).eq(var3);
    });

    it('findParameterInScope', function () {
        const globalScope = new GlobalScope();
        const funcScope = new FunctionScope(globalScope);
        const blockScope = new BlockScope(funcScope);

        const param1 = new Parameter(
            'param1',
            new Type(),
            ModifierKind.default,
            0,
            false,
            false,
        );
        funcScope.addVariable(param1);

        expect(globalScope.findVariable('param1')).eq(undefined);
        expect(funcScope.findVariable('param1')).eq(param1);
        expect(blockScope.findVariable('param1')).eq(param1);
    });

    it('getParentAndChildren', function () {
        const globalScope = new GlobalScope();
        const functionScope = new FunctionScope(globalScope);
        const blockScope = new BlockScope(functionScope);

        expect(globalScope.parent).eq(null);
        expect(globalScope.children[0]).eq(functionScope);
        expect(functionScope.parent).eq(globalScope);
        expect(functionScope.children[0]).eq(blockScope);
        expect(blockScope.parent).eq(functionScope);
        expect(blockScope.children.length).eq(0);
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

        expect(globalScope.startFuncName).eq('~start');
    });

    it('getStartFunctionVariableArray', function () {
        const globalScope = new GlobalScope();
        const var1 = new Variable('var1', new Type(), ModifierKind.default, 0);
        globalScope.addStartFuncVar(var1);
        const startVarList = globalScope.startFuncVarArray;

        expect(startVarList.length).eq(1);
        expect(startVarList[0].varName).eq('var1');
    });

    it('getStartFunctionStatementArray', function () {
        const globalScope = new GlobalScope();
        globalScope.addStatement(new Statement(ts.SyntaxKind.IfStatement));
        globalScope.addStatement(new Statement(ts.SyntaxKind.ForInStatement));

        expect(globalScope.statements.length).eq(2);
        expect(globalScope.statements[0].statementKind).eq(
            ts.SyntaxKind.IfStatement,
        );
        expect(globalScope.statements[1].statementKind).eq(
            ts.SyntaxKind.ForInStatement,
        );
    });

    it('getNearestFunctionScope', function () {
        const globalScope = new GlobalScope();
        const funcScope1 = new FunctionScope(globalScope);
        const blockScope1 = new BlockScope(funcScope1);
        const funcScope2 = new FunctionScope(funcScope1);
        const funcScope3 = new FunctionScope(blockScope1);
        const blockScope2 = new BlockScope(funcScope2);

        expect(blockScope1.getNearestFunctionScope()).eq(funcScope1);
        expect(funcScope3.getNearestFunctionScope()).eq(funcScope3);
        expect(blockScope2.getNearestFunctionScope()).eq(funcScope2);
    });

    it('getRootGloablScope', function () {
        const globalScope1 = new GlobalScope();
        const funcScope1 = new FunctionScope(globalScope1);
        const blockScope1 = new BlockScope(funcScope1);
        const globalScope2 = new GlobalScope();
        const funcScope2 = new FunctionScope(globalScope2);
        const blockScope2 = new BlockScope(funcScope2);

        expect(blockScope1.getRootGloablScope()).eq(globalScope1);
        expect(blockScope2.getRootGloablScope()).eq(globalScope2);
    });

    it('getTypeFromCurrentScope', function () {
        const globalScope = new GlobalScope();
        const funcScope = new FunctionScope(globalScope);
        const stringType = new Primitive('string');
        funcScope.namedTypeMap.set('string', stringType);
        const blockScope = new BlockScope(funcScope);
        const numberType = new Primitive('number');
        blockScope.namedTypeMap.set('number', numberType);

        expect(funcScope.getTypeFromCurrentScope('string')).eq(stringType);
        expect(blockScope.getTypeFromCurrentScope('number')).eq(numberType);
    });
});

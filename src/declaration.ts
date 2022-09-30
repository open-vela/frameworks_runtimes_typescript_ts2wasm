import ts from 'typescript';
import binaryen from 'binaryen';
import { Compiler } from './compiler.js';
import BaseCompiler from './base.js';
import {
    AssignKind,
    CONST_KEYWORD,
    LET_KEYWORD,
    VariableInfo,
    VAR_KEYWORD,
} from './utils.js';
import { FunctionScope, ScopeKind } from './scope.js';

export default class DeclarationCompiler extends BaseCompiler {
    constructor(compiler: Compiler) {
        super(compiler);
    }
    visitNode(node: ts.Node): binaryen.Type {
        switch (node.kind) {
            case ts.SyntaxKind.FunctionDeclaration: {
                const functionDeclarationNode = <ts.FunctionDeclaration>node;
                // connet functionScope with its parentScope
                const parentScope = this.getCurrentScope()!;
                const functionScope = new FunctionScope(parentScope);
                parentScope.addChild(functionScope);
                this.setCurrentScope(functionScope);
                // push the current function into stack
                this.getFunctionScopeStack().push(functionScope);
                // set function name
                functionScope.setFuncName(
                    typeof functionDeclarationNode.name?.getText() === 'string'
                        ? functionDeclarationNode.name?.getText()
                        : '',
                );
                // set function parameters
                for (
                    let i = 0;
                    i < functionDeclarationNode.parameters.length;
                    i++
                ) {
                    this.visit(functionDeclarationNode.parameters[i]);
                }
                // get return type of function
                if (functionDeclarationNode.type === undefined) {
                    // By default, the type can be regarded as void, else, the function' return type should be judged by the return value
                    functionScope.setReturnType(binaryen.none);
                    functionScope.setReturnTypeUndefined(true);
                } else {
                    functionScope.setReturnType(
                        this.visit(functionDeclarationNode.type),
                    );
                }
                // TODO DELETE: error TS2391: Function implementation is missing or not immediately following the declaration.
                if (functionDeclarationNode.body === undefined) {
                    this.reportError(functionDeclarationNode, 'error TS2391');
                    break;
                }
                // handle function body, add connection between functionScope and blockScope in the Block Node.
                functionScope.setBody(this.visit(functionDeclarationNode.body));
                // get the current function
                const currentFunction = this.getFunctionScopeStack().pop()!;
                this.getBinaryenModule().addFunction(
                    currentFunction.getFuncName(),
                    binaryen.createType(
                        currentFunction
                            .getParamArray()
                            .map(
                                (param: { variableType: binaryen.Type }) =>
                                    param.variableType,
                            ),
                    ),
                    currentFunction.getReturnType(),
                    currentFunction
                        .getVariableArray()
                        .map(
                            (variable: { variableType: binaryen.Type }) =>
                                variable.variableType,
                        ),
                    currentFunction.getBody(),
                );
                if (functionDeclarationNode.modifiers !== undefined) {
                    for (
                        let i = 0;
                        i < functionDeclarationNode.modifiers.length;
                        i++
                    ) {
                        if (
                            functionDeclarationNode.modifiers[i].kind ===
                            ts.SyntaxKind.ExportKeyword
                        ) {
                            this.getBinaryenModule().addFunctionExport(
                                currentFunction.getFuncName(),
                                currentFunction.getFuncName(),
                            );
                        }
                    }
                }

                break;
            }

            case ts.SyntaxKind.Parameter: {
                const parameterNode = <ts.ParameterDeclaration>node;
                const functionScope = this.getFunctionScopeStack().peek();
                const paramInfo: VariableInfo = {
                    variableName: '',
                    variableType: binaryen.none,
                    variableIndex: 0,
                    variableInitial: undefined,
                    variableAssign: AssignKind.let,
                };
                const paramIdentifierNode = <ts.Identifier>parameterNode.name;
                paramInfo.variableName = paramIdentifierNode.getText();
                if (parameterNode.type === undefined) {
                    // if the parameter has an initializer, then get type automatically
                    if (parameterNode.initializer !== undefined) {
                        paramInfo.variableType = this.visit(
                            this.getVariableType(
                                paramIdentifierNode,
                                this.getTypeChecker()!,
                            ),
                        );
                    } else {
                        // TODO DELETE: error TS7006, should be checked before compiling, can be deleted later.
                        this.reportError(parameterNode, 'error TS7006');
                        break;
                    }
                } else {
                    paramInfo.variableType = this.visit(parameterNode.type);
                }
                paramInfo.variableIndex = functionScope.getParamArray().length;
                // get parameter initializer
                if (parameterNode.initializer !== undefined) {
                    paramInfo.variableInitial = this.visit(
                        parameterNode.initializer,
                    );
                }
                functionScope.addParameter(paramInfo);
                break;
            }

            case ts.SyntaxKind.VariableDeclarationList: {
                const variableDeclarationListNode = <
                    ts.VariableDeclarationList
                >node;
                const variableDeclarationList: binaryen.ExpressionRef[] = [];
                for (
                    let i = 0;
                    i < variableDeclarationListNode.declarations.length;
                    i++
                ) {
                    const variableDeclarationExpressionRef = this.visit(
                        variableDeclarationListNode.declarations[i],
                    );
                    if (variableDeclarationExpressionRef != binaryen.none) {
                        variableDeclarationList.push(
                            variableDeclarationExpressionRef,
                        );
                    }
                }
                return this.getBinaryenModule().block(
                    null,
                    variableDeclarationList,
                );
                break;
            }

            case ts.SyntaxKind.VariableDeclaration: {
                const variableDeclarationNode = <ts.VariableDeclaration>node;
                const variableInfo: VariableInfo = {
                    variableName: '',
                    variableType: binaryen.none,
                    variableIndex: 0,
                    variableInitial: undefined,
                    variableAssign: AssignKind.default,
                };
                // get the information of the variableInfo
                const variableAssignText =
                    variableDeclarationNode.parent.getText();
                if (variableAssignText.includes(CONST_KEYWORD)) {
                    variableInfo.variableAssign = AssignKind.const;
                } else if (variableAssignText.includes(LET_KEYWORD)) {
                    variableInfo.variableAssign = AssignKind.let;
                } else if (variableAssignText.includes(VAR_KEYWORD)) {
                    variableInfo.variableAssign = AssignKind.var;
                }

                const variableIdentifierNode = <ts.Identifier>(
                    variableDeclarationNode.name
                );
                variableInfo.variableName = variableIdentifierNode.getText();
                if (variableDeclarationNode.type === undefined) {
                    // get type automatically
                    variableInfo.variableType = this.visit(
                        this.getVariableType(
                            variableIdentifierNode,
                            this.getTypeChecker()!,
                        ),
                    );
                } else {
                    variableInfo.variableType = this.visit(
                        variableDeclarationNode.type,
                    );
                }
                const currentScope = this.getCurrentScope();
                // The variable's index also include param's index
                if (this.getFunctionScopeStack().size() > 0) {
                    const currentFunctionScope =
                        this.getFunctionScopeStack().peek();
                    variableInfo.variableIndex =
                        currentFunctionScope.getVariableArray().length +
                        currentFunctionScope.getParamArray().length;
                } else {
                    variableInfo.variableIndex =
                        currentScope!.getVariableArray().length;
                }
                // get variable initializer
                if (variableDeclarationNode.initializer != undefined) {
                    variableInfo.variableInitial = this.visit(
                        variableDeclarationNode.initializer,
                    );
                } else {
                    if (variableInfo.variableAssign === AssignKind.const) {
                        this.reportError(
                            variableDeclarationNode,
                            'error TS1155',
                        );
                    }
                }
                // check if the variableDeclaration is in global scope.
                if (currentScope?.kind === ScopeKind.GlobalScope) {
                    this.getBinaryenModule().addGlobal(
                        variableInfo.variableName,
                        variableInfo.variableType,
                        variableInfo.variableAssign === AssignKind.const
                            ? false
                            : true,
                        variableInfo.variableInitial === undefined
                            ? binaryen.none
                            : variableInfo.variableInitial,
                    );
                } else {
                    // push the variableInfo into current block's variableArray and function's variableArray
                    const currentFunctionScope =
                        this.getFunctionScopeStack().peek();
                    currentFunctionScope.addVariable(variableInfo);
                    this.getBlockScopeStack().peek().addVariable(variableInfo);
                    // set variable initial value
                    if (variableInfo.variableInitial !== undefined) {
                        return this.getBinaryenModule().local.set(
                            variableInfo.variableIndex,
                            variableInfo.variableInitial,
                        );
                    }
                }
                break;
            }
        }
        return binaryen.none;
    }
}

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
import { BlockScope, FunctionScope, ScopeKind } from './scope.js';

export default class DeclarationCompiler extends BaseCompiler {
    constructor(compiler: Compiler) {
        super(compiler);
    }
    visitNode(node: ts.Node, fillScope: boolean): binaryen.ExpressionRef {
        switch (node.kind) {
            case ts.SyntaxKind.FunctionDeclaration: {
                const functionDeclarationNode = <ts.FunctionDeclaration>node;
                if (fillScope) {
                    this.storeFunctionLikeDeclaration(
                        functionDeclarationNode,
                        fillScope,
                    );
                } else {
                    this.generateFunctionLikeDeclaration(
                        functionDeclarationNode,
                    );
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
                if (fillScope) {
                    for (
                        let i = 0;
                        i < variableDeclarationListNode.declarations.length;
                        i++
                    ) {
                        this.visit(
                            variableDeclarationListNode.declarations[i],
                            fillScope,
                        );
                    }
                } else {
                    const variableDeclarationList: binaryen.ExpressionRef[] =
                        [];
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
                }
                break;
            }

            case ts.SyntaxKind.VariableDeclaration: {
                const variableDeclarationNode = <ts.VariableDeclaration>node;
                const variableIdentifierNode = <ts.Identifier>(
                    variableDeclarationNode.name
                );
                if (fillScope) {
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
                    variableInfo.variableName =
                        variableIdentifierNode.getText();
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
                    if (currentScope!.kind === ScopeKind.StartBlockScope) {
                        const currentStartBlockScope = <BlockScope>currentScope;
                        variableInfo.variableIndex =
                            currentStartBlockScope.getVariableArray().length;
                    } else {
                        if (currentScope!.kind !== ScopeKind.GlobalScope) {
                            // The variable's index also include param's index
                            if (this.getFunctionScopeStack().size() > 0) {
                                const currentFunctionScope =
                                    this.getFunctionScopeStack().peek();
                                variableInfo.variableIndex =
                                    currentFunctionScope.getVariableArray()
                                        .length +
                                    currentFunctionScope.getParamArray().length;
                            } else {
                                variableInfo.variableIndex =
                                    currentScope!.getVariableArray().length;
                            }
                        }
                    }
                    currentScope!.addVariable(variableInfo);
                    if (currentScope?.kind !== ScopeKind.GlobalScope) {
                        let startFunctionScopeFlag = false;
                        let parentScope = currentScope!.getParent();
                        while (parentScope !== null) {
                            if (
                                parentScope!.kind ===
                                ScopeKind.StartFunctionScope
                            ) {
                                startFunctionScopeFlag = true;
                                parentScope.addVariable(variableInfo);
                                break;
                            }
                            parentScope = parentScope.getParent();
                        }
                        if (!startFunctionScopeFlag) {
                            const currentFunctionScope =
                                this.getFunctionScopeStack().peek();
                            currentFunctionScope.addVariable(variableInfo);
                        }
                    }
                } else {
                    const currentScope = this.getCurrentScope();
                    const variableInfo = currentScope!.findVariable(
                        variableIdentifierNode.getText(),
                    )!;
                    // get variable initializer
                    if (variableDeclarationNode.initializer !== undefined) {
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
                    if (currentScope!.kind === ScopeKind.GlobalScope) {
                        const currentStartBlockScope = this.getStartBlockScope(
                            currentScope!,
                        );

                        // check if the global variable has a NumericLiteral initializer
                        if (
                            variableDeclarationNode.initializer === undefined ||
                            variableDeclarationNode.initializer?.kind ===
                                ts.SyntaxKind.NumericLiteral
                        ) {
                            this.getBinaryenModule().addGlobal(
                                variableInfo.variableName,
                                variableInfo.variableType,
                                variableInfo.variableAssign === AssignKind.const
                                    ? false
                                    : true,
                                variableInfo.variableInitial === undefined
                                    ? this.getVariableDeclarationInitialValue(
                                          variableInfo.variableType,
                                      )
                                    : variableInfo.variableInitial,
                            );
                        } else {
                            this.getBinaryenModule().addGlobal(
                                variableInfo.variableName,
                                variableInfo.variableType,
                                true,
                                this.getVariableDeclarationInitialValue(
                                    variableInfo.variableType,
                                ),
                            );
                            currentStartBlockScope.addStatement(
                                this.setGlobalValue(
                                    variableInfo.variableName,
                                    variableInfo.variableInitial!,
                                ),
                            );
                        }
                    } else {
                        // set variable initial value
                        if (variableInfo.variableInitial !== undefined) {
                            return this.setLocalValue(
                                variableInfo.variableIndex,
                                variableInfo.variableInitial,
                            );
                        }
                    }
                }
                break;
            }
        }
        return binaryen.none;
    }

    getVariableDeclarationInitialValue(
        valueType: binaryen.Type,
    ): binaryen.ExpressionRef {
        if (valueType === binaryen.f64) {
            return this.getBinaryenModule().f64.const(0);
        }
        return binaryen.none;
    }
}

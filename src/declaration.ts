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
import { ScopeKind, GlobalScope } from './scope.js';

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
                                this.getTypeChecker(),
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
                        // since variable declaration will return binaryen.none(eg, global variable declaration, local variable declaration with no initializer)
                        // so the judgement is needed.
                        if (
                            variableDeclarationExpressionRef !== binaryen.none
                        ) {
                            variableDeclarationList.push(
                                variableDeclarationExpressionRef,
                            );
                        }
                    }
                    if (variableDeclarationList.length > 0) {
                        return this.getBinaryenModule().block(
                            null,
                            variableDeclarationList,
                        );
                    }
                }
                break;
            }

            case ts.SyntaxKind.VariableDeclaration: {
                const variableDeclarationNode = <ts.VariableDeclaration>node;
                if (fillScope) {
                    this.storeVariableDeclaration(variableDeclarationNode);
                } else {
                    return this.generateVariableDeclaration(
                        variableDeclarationNode,
                    );
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

    storeVariableDeclaration(node: ts.VariableDeclaration) {
        const variableInfo: VariableInfo = {
            variableName: '',
            variableType: binaryen.none,
            variableIndex: 0,
            variableInitial: undefined,
            variableAssign: AssignKind.default,
        };
        const variableAssignText = node.parent.getText();
        if (variableAssignText.includes(CONST_KEYWORD)) {
            variableInfo.variableAssign = AssignKind.const;
        } else if (variableAssignText.includes(LET_KEYWORD)) {
            variableInfo.variableAssign = AssignKind.let;
        } else if (variableAssignText.includes(VAR_KEYWORD)) {
            variableInfo.variableAssign = AssignKind.var;
        }
        variableInfo.variableName = node.name.getText();
        if (node.type === undefined) {
            variableInfo.variableType = this.visit(
                this.getVariableType(node.name, this.getTypeChecker()),
            );
        } else {
            variableInfo.variableType = this.visit(node.type);
        }
        const currentScope = this.getCurrentScope();
        if (currentScope.kind === ScopeKind.GlobalScope) {
            variableInfo.variableIndex = currentScope.getVariableArray().length;
        } else {
            // add variableInfo into current scope's corresponding function scope
            if (!this.getFunctionScopeStack().isEmpty()) {
                const currentFunctionScope =
                    this.getFunctionScopeStack().peek();
                // The variable's index also include param's index
                variableInfo.variableIndex =
                    currentFunctionScope.getVariableArray().length +
                    currentFunctionScope.getParamArray().length;

                currentFunctionScope.addVariable(variableInfo);
            } else {
                this.getGlobalScopeStack()
                    .peek()
                    .addStartFunctionVariable(variableInfo);
            }
        }
        // add variableInfo into current scope
        currentScope.addVariable(variableInfo);
    }

    generateVariableDeclaration(
        node: ts.VariableDeclaration,
    ): binaryen.ExpressionRef {
        const currentScope = this.getCurrentScope();
        let variableInfo = currentScope.findVariable(node.name.getText());
        if (!variableInfo) {
            this.reportError(node, 'Can not find variable in current scope');
        }
        variableInfo = <VariableInfo>variableInfo;
        if (node.initializer !== undefined) {
            variableInfo.variableInitial = this.visit(node.initializer);
            // TODO: in AmpersandAmpersandToken and BarBarToken, typechecker will detect a union type, which need further processing
            // for now, binaryen.getExpressionType may get an exact type, but not work for complex types
            // variableInfo.variableType = binaryen.getExpressionType(
            //     variableInfo.variableInitial,
            // );
        } else {
            if (variableInfo.variableAssign === AssignKind.const) {
                this.reportError(node, 'error TS1155');
            }
        }
        if (currentScope.kind === ScopeKind.GlobalScope) {
            const currentGlobalScope = <GlobalScope>currentScope;
            // If the global variable is undefined or has a NumericLiteral initializer, then addGlobal with None or NumericLiteral.
            // Else, addGlobal with no initialize, and add a assign statement in the statement array.
            if (
                node.initializer === undefined ||
                node.initializer.kind === ts.SyntaxKind.NumericLiteral
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
                if (variableInfo.variableInitial) {
                    currentGlobalScope.addStatement(
                        this.setGlobalValue(
                            variableInfo.variableName,
                            variableInfo.variableInitial,
                        ),
                    );
                }
            }
        } else {
            if (variableInfo.variableInitial) {
                return this.setLocalValue(
                    variableInfo.variableIndex,
                    variableInfo.variableInitial,
                );
            }
        }
        return binaryen.none;
    }
}

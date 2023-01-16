import ts from 'typescript';
import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import { Type, TypeKind } from './type.js';
import { ModifierKind, Variable } from './variable.js';
import {
    arrayToPtr,
    emptyStructType,
    initStructType,
} from './glue/transform.js';
import {
    FunctionScope,
    GlobalScope,
    ClassScope,
    ScopeKind,
    Scope,
} from './scope.js';
import { Stack } from './utils.js';
import { typeInfo } from './glue/utils.js';
import { Compiler } from './compiler.js';
import { importLibApi, initDynContext, freeDynContext } from './envInit.js';
import { WASMTypeGen } from './wasmTypeGen.js';
import {
    WASMExpressionGen,
    WASMDynExpressionGen,
    WASMExpressionBase,
} from './wasmExprGen.js';
import { WASMStatementGen } from './wasmStmtGen.js';

const typeNotPacked = binaryenCAPI._BinaryenPackedTypeNotPacked();

export class WASMGen {
    private scopeStatementMap = new Map<Scope, binaryen.ExpressionRef[]>();
    private binaryenModule = new binaryen.Module();
    private currentScope: Scope | null = null;
    private currentFuncScope: FunctionScope | null = null;
    private globalScopeStack: Stack<GlobalScope>;
    static contextOfFunc: Map<FunctionScope, typeInfo> = new Map<
        FunctionScope,
        typeInfo
    >();
    private wasmTypeCompiler = new WASMTypeGen(this);
    wasmExprCompiler = new WASMExpressionGen(this);
    wasmDynExprCompiler = new WASMDynExpressionGen(this);
    wasmExprBase = new WASMExpressionBase(this);
    private wasmStmtCompiler = new WASMStatementGen(this);

    constructor(private compilerCtx: Compiler) {
        this.binaryenModule = compilerCtx.binaryenModule;
        this.globalScopeStack = compilerCtx.globalScopeStack;
    }

    WASMGenerate() {
        while (!this.globalScopeStack.isEmpty()) {
            const globalScope = this.globalScopeStack.pop();
            this.WASMGenHelper(globalScope);
        }
    }

    WASMGenHelper(scope: Scope) {
        switch (scope.kind) {
            case ScopeKind.GlobalScope:
                /* add ~start function */
                this.WASMStartFunctionGen(<GlobalScope>scope);
                break;
            case ScopeKind.FunctionScope:
                this.WASMFunctionGen(<FunctionScope>scope);
                break;
            case ScopeKind.ClassScope:
                //   classscope
                //       |
                // functionscope
                this.WASMClassGen(<ClassScope>scope);
                break;
            default:
                break;
        }
        for (let i = 0; i !== scope.children.length; ++i) {
            this.WASMGenHelper(scope.children[i]);
        }
    }

    get module(): binaryen.Module {
        return this.binaryenModule;
    }

    get wasmType(): WASMTypeGen {
        return this.wasmTypeCompiler;
    }

    get wasmExpr(): WASMExpressionGen {
        return this.wasmExprCompiler;
    }

    get curScope(): Scope | null {
        return this.currentScope;
    }

    setCurScope(scope: Scope) {
        this.currentScope = scope;
    }

    get scopeStateMap() {
        return this.scopeStatementMap;
    }

    get curFunctionScope(): FunctionScope | null {
        return this.currentFuncScope;
    }

    setCurFunctionScope(scope: FunctionScope) {
        this.currentFuncScope = scope;
    }

    /* add global variables, and generate start function */
    WASMStartFunctionGen(globalScope: GlobalScope) {
        this.currentScope = globalScope;
        this.currentFuncScope = null;
        const globalStatementRef = new Array<binaryen.ExpressionRef>();
        this.scopeStatementMap.set(globalScope, globalStatementRef);
        importLibApi(this.module);
        initDynContext(<GlobalScope>this.currentScope);

        // add global variable
        const globalVars = globalScope.varArray;
        for (const globalVar of globalVars) {
            const varTypeRef = this.wasmType.getWASMType(globalVar.varType);
            const mutable =
                globalVar.varModifier === ModifierKind.const ? false : true;
            if (globalVar.initExpression === null) {
                this.module.addGlobal(
                    globalVar.varName,
                    varTypeRef,
                    mutable,
                    this.getVariableInitValue(globalVar.varType),
                );
            } else {
                const varInitExprRef = this.wasmExpr.WASMExprGen(
                    globalVar.initExpression,
                );
                if (globalVar.varType.kind === TypeKind.NUMBER) {
                    if (
                        globalVar.initExpression.expressionKind ===
                        ts.SyntaxKind.NumericLiteral
                    ) {
                        this.module.addGlobal(
                            globalVar.varName,
                            varTypeRef,
                            mutable,
                            varInitExprRef,
                        );
                    } else {
                        this.module.addGlobal(
                            globalVar.varName,
                            varTypeRef,
                            true,
                            this.module.f64.const(0),
                        );
                        globalStatementRef.push(
                            this.module.global.set(
                                globalVar.varName,
                                varInitExprRef,
                            ),
                        );
                    }
                } else if (globalVar.varType.kind === TypeKind.BOOLEAN) {
                    this.module.addGlobal(
                        globalVar.varName,
                        varTypeRef,
                        mutable,
                        varInitExprRef,
                    );
                } else {
                    this.module.addGlobal(
                        globalVar.varName,
                        varTypeRef,
                        true,
                        binaryenCAPI._BinaryenRefNull(
                            this.module.ptr,
                            varTypeRef,
                        ),
                    );
                    if (globalVar.varType.kind === TypeKind.ANY) {
                        const dynInitExprRef =
                            this.wasmDynExprCompiler.WASMDynExprGen(
                                globalVar.initExpression,
                            );
                        globalStatementRef.push(
                            this.module.global.set(
                                globalVar.varName,
                                dynInitExprRef,
                            ),
                        );
                    } else {
                        globalStatementRef.push(
                            this.module.global.set(
                                globalVar.varName,
                                varInitExprRef,
                            ),
                        );
                    }
                }
            }
        }

        // parse global scope statements, generate start function body
        freeDynContext(globalScope);
        for (const stmt of globalScope.statements) {
            if (stmt.statementKind === ts.SyntaxKind.Unknown) {
                continue;
            }
            globalStatementRef.push(this.wasmStmtCompiler.WASMStmtGen(stmt));
        }
        const body = this.module.block(null, globalStatementRef);

        // generate wasm start function
        const startFunctionRef = this.module.addFunction(
            globalScope.startFuncName,
            binaryen.none,
            binaryen.none,
            globalScope.startFuncVarArray.map((variable: Variable) =>
                this.wasmType.getWASMType(variable.varType),
            ),
            body,
        );
        this.module.setStart(startFunctionRef);
    }

    WASMClassGen(classScope: ClassScope) {
        this.currentScope = classScope;
        this.currentFuncScope = null;
        const tsClassType = classScope.classType;
        this.currentScope = classScope;
        this.wasmTypeCompiler.createWASMType(tsClassType);
    }

    /* parse function scope */
    WASMFunctionGen(functionScope: FunctionScope) {
        this.currentScope = functionScope;
        this.currentFuncScope = functionScope;

        const binaryenExprRefs = new Array<binaryen.ExpressionRef>();
        this.scopeStatementMap.set(functionScope, binaryenExprRefs);

        const tsFuncType = functionScope.funcType;
        // 1. generate function wasm type
        this.wasmTypeCompiler.createWASMType(tsFuncType);
        // 2. generate context struct, iff the function scope do have
        let closureIndex = 1;
        const closureVarArray = new Array<binaryenCAPI.TypeRef>();
        const muts = new Array<number>();

        /* parent level function's context type */
        let maybeParentFuncCtxType: typeInfo | null = null;
        if (
            functionScope.parent !== null &&
            functionScope.parent.kind === ScopeKind.FunctionScope
        ) {
            const parentFuncScope = <FunctionScope>functionScope.parent;
            closureVarArray.push(
                (<typeInfo>WASMGen.contextOfFunc.get(parentFuncScope)).typeRef,
            );
            maybeParentFuncCtxType = <typeInfo>(
                WASMGen.contextOfFunc.get(parentFuncScope)
            );
        } else {
            closureVarArray.push(emptyStructType.typeRef);
        }
        muts.push(0);

        for (const param of functionScope.paramArray) {
            if (param.varIsClosure) {
                closureVarArray.push(
                    this.wasmTypeCompiler.getWASMType(param.varType),
                );
                param.setClosureIndex(closureIndex++);
                muts.push(param.varModifier === ModifierKind.readonly ? 0 : 1);
            }
        }
        for (const variable of functionScope.varArray) {
            if (variable.varIsClosure) {
                closureVarArray.push(
                    this.wasmTypeCompiler.getWASMType(variable.varType),
                );
                variable.setClosureIndex(closureIndex++);
                muts.push(variable.varModifier === ModifierKind.const ? 0 : 1);
            }
        }

        const packed = new Array<binaryenCAPI.PackedType>(
            closureVarArray.length,
        ).fill(typeNotPacked);

        if (functionScope.className === '') {
            /* iff it hasn't free variables */
            if (closureVarArray.length === 1) {
                WASMGen.contextOfFunc.set(
                    functionScope,
                    maybeParentFuncCtxType === null
                        ? emptyStructType
                        : maybeParentFuncCtxType,
                );
            } else {
                WASMGen.contextOfFunc.set(
                    functionScope,
                    initStructType(
                        closureVarArray,
                        packed,
                        muts,
                        closureVarArray.length,
                        true,
                    ),
                );
            }
        }
        // 3. generate wasm function
        for (const stmt of functionScope.statements) {
            binaryenExprRefs.push(this.wasmStmtCompiler.WASMStmtGen(stmt));
        }
        const paramWASMType =
            this.wasmTypeCompiler.getWASMFuncParamType(tsFuncType);

        const returnWASMType =
            this.wasmTypeCompiler.getWASMFuncReturnType(tsFuncType);

        const varWASMTypes = new Array<binaryen.Type>();
        for (const varDef of functionScope.varArray) {
            varWASMTypes.push(
                this.wasmTypeCompiler.getWASMType(varDef.varType),
            );
        }
        // add local variable
        let exprRefs = new Array<binaryen.ExpressionRef>();
        const localVars = functionScope.varArray;
        for (const localVar of localVars) {
            if (localVar.initExpression !== null) {
                let varInitExprRef: binaryen.ExpressionRef;
                if (localVar.varType.kind === TypeKind.ANY) {
                    varInitExprRef = this.wasmDynExprCompiler.WASMDynExprGen(
                        localVar.initExpression,
                    );
                } else {
                    varInitExprRef = this.wasmExpr.WASMExprGen(
                        localVar.initExpression,
                    );
                }
                exprRefs.push(
                    this.module.local.set(localVar.varIndex, varInitExprRef),
                );
            }
        }
        exprRefs = exprRefs.concat(binaryenExprRefs);
        // iff not a member function
        if (functionScope.className === '') {
            varWASMTypes.push(
                (<typeInfo>WASMGen.contextOfFunc.get(functionScope)).typeRef,
            );
        } else {
            const classScope = <ClassScope>functionScope.parent;
            varWASMTypes.push(
                this.wasmTypeCompiler.getWASMType(classScope.classType),
            );
        }
        const functionName =
            functionScope.className === ''
                ? functionScope.funcName
                : functionScope.className + '_' + functionScope.funcName;
        // 4: add wrapper function if exported
        let isExport = false;
        for (const modifierKind of functionScope.funcModifiers) {
            if (modifierKind === ts.SyntaxKind.ExportKeyword) {
                isExport = true;
                break;
            }
        }
        if (isExport) {
            let idx = 0;
            const tempLocGetParams = tsFuncType
                .getParamTypes()
                .map((p) =>
                    this.module.local.get(
                        idx++,
                        this.wasmTypeCompiler.getWASMType(p),
                    ),
                );
            this.module.addFunction(
                functionScope.funcName + '-wrapper',
                this.wasmTypeCompiler.getWASMFuncOrignalParamType(tsFuncType),
                returnWASMType,
                [],
                this.module.block(null, [
                    this.module.return(
                        this.module.call(
                            functionScope.funcName,
                            [
                                binaryenCAPI._BinaryenStructNew(
                                    this.module.ptr,
                                    arrayToPtr([]).ptr,
                                    0,
                                    emptyStructType.heapTypeRef,
                                ),
                            ].concat(tempLocGetParams),
                            returnWASMType,
                        ),
                    ),
                ]),
            );
            this.module.addFunctionExport(
                functionScope.funcName + '-wrapper',
                functionScope.funcName,
            );
        }
        this.module.addFunction(
            functionName,
            paramWASMType,
            returnWASMType,
            varWASMTypes,
            this.module.block(null, exprRefs),
        );
    }

    getVariableInitValue(varType: Type): binaryen.ExpressionRef {
        const module = this.module;
        if (varType.kind === TypeKind.NUMBER) {
            return module.f64.const(0);
        } else if (varType.kind === TypeKind.BOOLEAN) {
            return module.i32.const(0);
        }
        return binaryenCAPI._BinaryenRefNull(module.ptr, binaryen.anyref);
    }
}

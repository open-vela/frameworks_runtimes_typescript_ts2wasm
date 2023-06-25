/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import { TSContext } from '../../type.js';
import { arrayToPtr, emptyStructType } from './glue/transform.js';
import { FunctionScope, GlobalScope } from '../../scope.js';
import { Stack } from '../../utils.js';
import {
    importAnyLibAPI,
    importInfcLibAPI,
    generateGlobalContext,
    generateFreeDynContext,
    addItableFunc,
    generateGlobalJSObject,
    generateExtRefTableMaskArr,
    generateInitDynContext,
} from './lib/env_init.js';
import { WASMTypeGen } from './wasm_type_gen.js';
import { WASMExpressionGen } from './wasm_expr_gen.js';
import { WASMStatementGen } from './wasm_stmt_gen.js';
import {
    initGlobalOffset,
    initDefaultMemory,
    initDefaultTable,
} from './memory.js';
import { ArgNames, BuiltinNames } from '../../../lib/builtin/builtin_name.js';
import { Ts2wasmBackend, ParserContext, DataSegmentContext } from '../index.js';
import { Logger } from '../../log.js';
import { callBuiltInAPIs } from './lib/init_builtin_api.js';
import {
    BlockNode,
    CaseClauseNode,
    DefaultClauseNode,
    ForInNode,
    ForNode,
    ForOfNode,
    FunctionOwnKind,
    IfNode,
    ModuleNode,
    SemanticsNode,
    SwitchNode,
    VarDeclareNode,
    VarStorageType,
    WhileNode,
} from '../../semantics/semantics_nodes.js';
import { BuildModuleNode } from '../../semantics/index.js';
import {
    ClosureContextType,
    FunctionType,
    ObjectType,
    Primitive,
    ValueType,
    ValueTypeKind,
} from '../../semantics/value_types.js';
import { FunctionDeclareNode } from '../../semantics/semantics_nodes.js';
import { FunctionalFuncs, ItableFlag, TmpVarInfo, UtilFuncs } from './utils.js';
import {
    MemberDescription,
    MemberType,
    ObjectDescription,
} from '../../semantics/runtime.js';
import { dyntype } from './lib/dyntype/utils.js';
import { clearWasmStringMap, getCString } from './utils.js';
import { assert } from 'console';

export class WASMFunctionContext {
    private binaryenCtx: WASMGen;
    private funcOpcodeArray: Array<binaryen.ExpressionRef>;
    private opcodeArrayStack = new Stack<Array<binaryen.ExpressionRef>>();
    private returnOpcode: binaryen.ExpressionRef;
    private returnIndex = 0;
    private currentFunc: FunctionDeclareNode;
    private varsTypeRef: Array<binaryen.ExpressionRef> = [];
    private tmpVarsTypeRefs: Array<binaryen.ExpressionRef> = [];
    private hasGenerateVarsTypeRefs = false;
    private tmpBackendVars: Array<TmpVarInfo> = [];

    constructor(binaryenCtx: WASMGen, func: FunctionDeclareNode) {
        this.binaryenCtx = binaryenCtx;
        this.funcOpcodeArray = new Array<binaryen.ExpressionRef>();
        this.opcodeArrayStack.push(this.funcOpcodeArray);
        this.returnOpcode = this.binaryenCtx.module.return();
        this.currentFunc = func;
    }

    insert(insn: binaryen.ExpressionRef) {
        this.opcodeArrayStack.peek().push(insn);
    }

    setReturnOpcode(returnOpcode: binaryen.ExpressionRef) {
        this.returnOpcode = returnOpcode;
    }

    get returnOp() {
        return this.returnOpcode;
    }

    enterScope() {
        this.opcodeArrayStack.push(new Array<binaryen.ExpressionRef>());
    }

    exitScope() {
        const topMostArray = this.opcodeArrayStack.pop();
        return topMostArray;
    }

    getBody() {
        return this.funcOpcodeArray;
    }

    get returnIdx() {
        return this.returnIndex;
    }

    insertReturnVar(returnVarType: ValueType) {
        const returnVarIdx = this.allocateTmpVarIdx();
        this.returnIndex = returnVarIdx;
        const returnVar = {
            index: returnVarIdx,
            type: returnVarType,
        };
        this.tmpBackendVars.push(returnVar);
    }

    insertTmpVar(tmpVarType: ValueType) {
        const tmpVarIdx = this.allocateTmpVarIdx();
        const tmpVar = {
            index: tmpVarIdx,
            type: tmpVarType,
        };
        this.tmpBackendVars.push(tmpVar);
        return tmpVar;
    }

    private generateFuncVarsTypeRefs(varNode: SemanticsNode) {
        if (varNode instanceof FunctionDeclareNode) {
            /* funtion vars */
            if (varNode.varList) {
                for (const variable of varNode.varList) {
                    if (!variable.isTmpVar) {
                        this.varsTypeRef.push(
                            this.binaryenCtx.wasmTypeComp.getWASMValueType(
                                variable.type,
                            ),
                        );
                    } else {
                        this.tmpVarsTypeRefs.push(
                            this.binaryenCtx.wasmTypeComp.getWASMValueType(
                                variable.type,
                            ),
                        );
                    }
                }
            }
            this.generateFuncVarsTypeRefs(varNode.body);
        } else if (varNode instanceof BlockNode) {
            /* block vars */
            if (varNode.varList) {
                for (const variable of varNode.varList) {
                    if (!variable.isTmpVar) {
                        this.varsTypeRef.push(
                            this.binaryenCtx.wasmTypeComp.getWASMValueType(
                                variable.type,
                            ),
                        );
                    } else {
                        this.tmpVarsTypeRefs.push(
                            this.binaryenCtx.wasmTypeComp.getWASMValueType(
                                variable.type,
                            ),
                        );
                    }
                }
            }
            varNode.statements.forEach((s) => {
                this.generateFuncVarsTypeRefs(s);
            });
        } else if (
            varNode instanceof ForNode ||
            varNode instanceof ForInNode ||
            varNode instanceof ForOfNode ||
            varNode instanceof WhileNode ||
            varNode instanceof CaseClauseNode ||
            varNode instanceof DefaultClauseNode
        ) {
            if (varNode.body instanceof BlockNode) {
                this.generateFuncVarsTypeRefs(varNode.body);
            }
        } else if (varNode instanceof SwitchNode) {
            varNode.caseClause.forEach((c) => {
                this.generateFuncVarsTypeRefs(c);
            });
            if (varNode.defaultClause) {
                this.generateFuncVarsTypeRefs(varNode.defaultClause);
            }
        } else if (varNode instanceof IfNode) {
            if (varNode.trueNode) {
                this.generateFuncVarsTypeRefs(varNode.trueNode);
            }
            if (varNode.falseNode) {
                this.generateFuncVarsTypeRefs(varNode.falseNode);
            }
        }
    }

    getFuncVarsTypeRefs(varNode: SemanticsNode) {
        if (!this.hasGenerateVarsTypeRefs) {
            this.generateFuncVarsTypeRefs(varNode);
            this.hasGenerateVarsTypeRefs = true;
        }
        return this.varsTypeRef.concat(this.tmpVarsTypeRefs);
    }

    allocateTmpVarIdx() {
        const allFuncVarsLen = this.getFuncVarsTypeRefs(
            this.currentFunc,
        ).length;
        const allFuncParamsLen =
            (this.currentFunc.parameters
                ? this.currentFunc.parameters.length
                : 0) + this.currentFunc.envParamLen;
        return allFuncParamsLen + allFuncVarsLen + this.tmpBackendVars.length;
    }

    getAllFuncVarsTypeRefs() {
        const funcVarsTypeRefs = this.getFuncVarsTypeRefs(this.currentFunc);
        const backendVarsTypeRefs: binaryen.Type[] = [];
        for (const value of this.tmpBackendVars) {
            backendVarsTypeRefs.push(
                this.binaryenCtx.wasmTypeComp.getWASMValueType(value.type),
            );
        }
        return funcVarsTypeRefs.concat(backendVarsTypeRefs);
    }
}

export class WASMGen extends Ts2wasmBackend {
    private _semanticModule: ModuleNode;
    private _binaryenModule: binaryen.Module;

    private _wasmTypeCompiler;
    private _wasmExprCompiler;
    private _wasmStmtCompiler;

    currentFuncCtx?: WASMFunctionContext;
    dataSegmentContext?: DataSegmentContext;

    private globalInitFuncName = 'global|init|func';
    public globalInitArray: Array<binaryen.ExpressionRef> = [];
    private globalDestoryFuncName = 'global|destory|func';
    public globalDestoryArray: Array<binaryen.ExpressionRef> = [];
    private wasmStringMap = new Map<string, number>();
    private debugInfoFileNames = new Map<string, number>();
    private map: string | null = null;

    constructor(parserContext: ParserContext) {
        super(parserContext);
        this._wasmTypeCompiler = new WASMTypeGen(this);
        this._wasmExprCompiler = new WASMExpressionGen(this);
        this._wasmStmtCompiler = new WASMStatementGen(this);
        this._binaryenModule = new binaryen.Module();
        this._semanticModule = BuildModuleNode(parserContext);
        this.dataSegmentContext = new DataSegmentContext();
    }

    get module(): binaryen.Module {
        return this._binaryenModule;
    }

    get wasmTypeComp(): WASMTypeGen {
        return this._wasmTypeCompiler;
    }

    get wasmExprComp(): WASMExpressionGen {
        return this._wasmExprCompiler;
    }

    public codegen(options?: any): void {
        binaryen.setDebugInfo(options && options.debug ? true : false);
        this._binaryenModule.setFeatures(binaryen.Features.All);
        this._binaryenModule.autoDrop();
        this.wasmGenerate();

        /* Sometimes binaryen can't generate binary module,
            we dump the module to text and load it back.
           This is just a simple workaround, we need to find out the root cause
        */
        const textModule = this._binaryenModule.emitText();
        this._binaryenModule.dispose();

        try {
            this._binaryenModule = binaryen.parseText(textModule);
        } catch (e) {
            Logger.debug(textModule);
            Logger.debug(e);
            Logger.error(`Generated module is invalid`);
            throw e;
        }
        this._binaryenModule.setFeatures(binaryen.Features.All);
        this._binaryenModule.autoDrop();

        if (options && options[ArgNames.opt]) {
            binaryen.setOptimizeLevel(options[ArgNames.opt]);
            this._binaryenModule.optimize();
        }

        const validationResult = this._binaryenModule.validate();
        if (validationResult === 0) {
            Logger.error(`Validation wasm module failed`);
            throw Error('Failed to validate generated wasm module');
        }
    }

    public emitBinary(options?: any): Uint8Array {
        let res: Uint8Array = this._binaryenModule.emitBinary();
        if (!options || !options.sourceMap) {
            res = this._binaryenModule.emitBinary();
        } else {
            const name = `${options.name}.wasm.map`;
            const binaryInfo = this._binaryenModule.emitBinary(name);
            res = binaryInfo.binary;
            this.map = binaryInfo.sourceMap;
        }
        return res;
    }

    public emitText(options?: any): string {
        if (options?.format === 'Stack-IR') {
            return this._binaryenModule.emitStackIR();
        }
        return this._binaryenModule.emitText();
    }

    public emitSourceMap(name: string): string {
        /** generete source map file */
        if (this.map === null) {
            return '';
        }
        const sourceMapStr = this.map;
        const content = JSON.parse(sourceMapStr);
        content.sourceRoot = `./${name}`;
        const sourceCode: string[] = [];
        // for (const global of this.globalScopes) {
        //     if (this.debugInfoFileNames.has(global.srcFilePath)) {
        //         sourceCode.push(global.node!.getSourceFile().getFullText());
        //     }
        // }
        content.sourcesContent = sourceCode;
        this.map = null;
        return JSON.stringify(content);
    }

    public dispose(): void {
        this._binaryenModule.dispose();
    }

    private wasmGenerate() {
        clearWasmStringMap();
        FunctionalFuncs.resetDynContextRef();

        // init wasm environment
        initGlobalOffset(this.module);
        initDefaultTable(this.module);
        /* init builtin APIs */
        callBuiltInAPIs(this.module);
        if (!this.parserContext.compileArgs[ArgNames.disableAny]) {
            importAnyLibAPI(this.module);
            this.globalInitArray.push(generateInitDynContext(this.module));
            this.globalDestoryArray.push(generateFreeDynContext(this.module));
        }
        if (!this.parserContext.compileArgs[ArgNames.disableInterface]) {
            importInfcLibAPI(this.module);
            addItableFunc(this.module);
        }

        /* add global vars */
        this.addGlobalVars();

        /* parse functions */
        this.parseFuncs();

        if (this.parserContext.compileArgs[ArgNames.disableAny]) {
            if (this.wasmTypeComp.typeMap.has(Primitive.Any)) {
                throw Error('any type is in source');
            }
        }

        if (this.parserContext.compileArgs[ArgNames.disableInterface]) {
            if (
                Object.values(this._wasmTypeCompiler.typeMap).some(
                    (type) => type.kind === ValueTypeKind.INTERFACE,
                )
            ) {
                throw Error('interface type is in source');
            }
        }

        if (!this.parserContext.compileArgs[ArgNames.disableAny]) {
            generateGlobalContext(this.module);
            generateExtRefTableMaskArr(this.module);
        }
        BuiltinNames.JSGlobalObjects.forEach((init, key) => {
            generateGlobalJSObject(this.module, key);
            /* Insert at the second slot (right after dyntype context initialized) */
            this.globalInitArray.splice(
                1,
                0,
                this.genrateInitJSGlobalObject(key),
            );
            BuiltinNames.JSGlobalObjects.delete(key);
        });

        const segments = [];
        const segmentInfo = this.dataSegmentContext!.generateSegment();
        if (segmentInfo) {
            segments.push({
                offset: this.module.i32.const(segmentInfo!.offset),
                data: segmentInfo!.data,
                passive: false,
            });
        }
        initDefaultMemory(this.module, segments);

        this.initEnv();
        this.destoryEnv();
    }

    private addGlobalVars() {
        /* all global vars will be put into global init function, all mutable */
        const globalVarArray = this._semanticModule.globalVars;
        for (const globalVar of globalVarArray) {
            if (globalVar.name.includes('builtin')) {
                continue;
            }
            this.module.removeGlobal(globalVar.name);
            /* get wasm type */
            const varTypeRef = this.wasmTypeComp.getWASMValueType(
                globalVar.type,
            );
            /* TODO: it seems that isDeclare information not recorded. flag? */
            /* get the default value based on type */
            this.module.addGlobal(
                globalVar.name,
                varTypeRef,
                true,
                FunctionalFuncs.getVarDefaultValue(
                    this.module,
                    globalVar.type.kind,
                ),
            );
        }
    }

    /* parse functions */
    private parseFuncs() {
        const funcArray = this._semanticModule!.functions;
        for (const func of funcArray) {
            this.parseFunc(func);
        }
    }

    private parseFunc(func: FunctionDeclareNode) {
        if ((func.ownKind & FunctionOwnKind.DECORATOR) !== 0) {
            /* Function with @binaryen decorator is implemented directly
                using binaryen API, don't generate code for them */
            return;
        }
        /* get function type */
        const tsFuncType = func.funcType;
        const paramWASMTypes =
            this.wasmTypeComp.getWASMFuncParamTypes(tsFuncType);
        const returnType = tsFuncType.returnType;
        const returnWASMType = this.wasmTypeComp.getWASMValueType(returnType);
        const oriParamWasmTypes =
            this.wasmTypeComp.getWASMFuncOriParamTypes(tsFuncType);

        /* generate import function name */
        const levelNames = func.name.split(BuiltinNames.moduleDelimiter);
        let importName = levelNames[levelNames.length - 1];
        if ((func.ownKind & FunctionOwnKind.METHOD) !== 0) {
            importName = `${levelNames[levelNames.length - 2]}_${importName}`;
        }

        if ((func.ownKind & FunctionOwnKind.DECLARE) !== 0) {
            const internalFuncName = `${func.name}${BuiltinNames.declareSuffix}`;
            this.module.addFunctionImport(
                internalFuncName,
                BuiltinNames.externalModuleName,
                importName,
                binaryen.createType(oriParamWasmTypes),
                returnWASMType,
            );
            /* use wrappered func to invoke the orignal func */
            const oriParamWasmValues: binaryen.ExpressionRef[] = [];
            for (let i = 0; i < oriParamWasmTypes.length; i++) {
                oriParamWasmValues.push(
                    this.module.local.get(
                        i + func.envParamLen,
                        oriParamWasmTypes[i],
                    ),
                );
            }
            let innerOp: binaryen.ExpressionRef;
            const callOp = this.module.call(
                internalFuncName,
                oriParamWasmValues,
                returnWASMType,
            );
            if (returnType.kind !== ValueTypeKind.VOID) {
                innerOp = this.module.return(callOp);
            } else {
                innerOp = callOp;
            }
            this.module.addFunction(
                func.name,
                binaryen.createType(paramWASMTypes),
                returnWASMType,
                [],
                this.module.block(null, [innerOp], returnWASMType),
            );
            if ((func.ownKind & FunctionOwnKind.EXPORT) !== 0) {
                this.module.addFunctionExport(internalFuncName, importName);
            }
            return;
        }

        /* use WASMFunctionContext to record information */
        this.currentFuncCtx = new WASMFunctionContext(this, func);
        /* the calculation of closureContext value is moved to semantic tree and is a statement in body */

        /* assign value for function's context variable */
        if (func.varList && func.varList[0].initCtx) {
            const freeVars: VarDeclareNode[] = [];
            if (func.parameters) {
                for (const p of func.parameters) {
                    if (p.closureIndex !== undefined) {
                        freeVars.push(p);
                    }
                }
            }
            for (const v of func.varList) {
                if (v.closureIndex !== undefined) {
                    freeVars.push(v);
                }
            }
            this.assignCtxVar(func.varList[0], freeVars);
        }

        /* assign value for method's this variable */
        if (
            func.varList &&
            (func.ownKind & FunctionOwnKind.METHOD) !== 0 &&
            (func.ownKind & FunctionOwnKind.STATIC) === 0
        ) {
            this.assignThisVar(func.varList[1]);
        }

        /* add return value iff return type is not void, must ahead of parse return Statement */
        if (returnType.kind !== ValueTypeKind.VOID) {
            this.currentFuncCtx.insertReturnVar(returnType);
        }

        /* for start function, need to call import start funcs */
        if (func.importStartFuncNameList) {
            for (const importStartFuncName of func.importStartFuncNameList) {
                this.currentFuncCtx.insert(
                    this.module.call(importStartFuncName, [], binaryen.none),
                );
            }
        }
        // manually add SUPER() for ctor should before parseBody()
        /** insert SUPER() for class which haven't declare constructor and is sub class*/
        if (
            levelNames[levelNames.length - 1] === 'constructor' &&
            func.varList &&
            !!(func.ownKind & FunctionOwnKind.METHOD) &&
            !(func.ownKind & FunctionOwnKind.STATIC)
        ) {
            const meta = func.thisClassType!.meta;
            const ctor = meta.ctor;
            const base = meta.base;
            const args: binaryen.ExpressionRef[] = [];
            if (ctor && base && base.ctor) {
                const baseClassCtor = base.name.substring(1) + '|constructor';
                if (!ctor.isDeclaredCtor) {
                    args.push(
                        binaryenCAPI._BinaryenRefNull(
                            this.module.ptr,
                            binaryenCAPI._BinaryenTypeStructref(),
                        ),
                    );
                    args.push(
                        this.module.local.get(
                            func.varList[1].index,
                            emptyStructType.typeRef,
                        ),
                    );
                    if (func.parameters) {
                        for (const arg of func.parameters) {
                            args.push(
                                this.module.local.get(
                                    arg.index,
                                    this.wasmTypeComp.getWASMValueType(
                                        arg.type,
                                    ),
                                ),
                            );
                        }
                    }
                    this.currentFuncCtx.insert(
                        this.module.drop(
                            this.module.call(
                                baseClassCtor,
                                args,
                                binaryen.none,
                            ),
                        ),
                    );
                }
            }
        }
        this.parseBody(func.body);

        /* get all vars wasm types, must behind the parseBody */
        const allVarsTypeRefs = this.currentFuncCtx.getAllFuncVarsTypeRefs();

        /* For class's constructor, should assign to return idx manually */
        if (
            levelNames[levelNames.length - 1] === 'constructor' &&
            func.varList &&
            (func.ownKind & FunctionOwnKind.METHOD) !== 0 &&
            (func.ownKind & FunctionOwnKind.STATIC) === 0
        ) {
            const thisVar = func.varList[1];
            const thisTypeRef = this.wasmTypeComp.getWASMValueType(
                thisVar.type,
            );
            const getThisVar = this.module.local.get(
                thisVar.index,
                thisTypeRef,
            );
            const assignRef = this.module.local.set(
                this.currentFuncCtx.returnIdx,
                getThisVar,
            );

            this.currentFuncCtx.insert(assignRef);
        }

        const bodyRef = this.module.block(
            'statements',
            this.currentFuncCtx.getBody(),
        );

        /* add return statement */
        if (returnType.kind !== ValueTypeKind.VOID) {
            const returnValue = this.module.local.get(
                this.currentFuncCtx.returnIdx,
                returnWASMType,
            );
            this.currentFuncCtx.setReturnOpcode(
                this.module.return(returnValue),
            );
        }
        if (
            func.isInEnterScope &&
            (func.ownKind & FunctionOwnKind.START) !== 0
        ) {
            /* set enter module start function as wasm start function */
            const startFuncStmts: binaryen.ExpressionRef[] = [];
            /* call globalInitFunc */
            startFuncStmts.push(
                this.module.call(this.globalInitFuncName, [], binaryen.none),
            );
            startFuncStmts.push(this.module.call(func.name, [], binaryen.none));
            /* call globalDestoryFunc */
            if (!this.parserContext.compileArgs[ArgNames.noAutoFreeCtx]) {
                startFuncStmts.push(
                    this.module.call(
                        this.globalDestoryFuncName,
                        [],
                        binaryen.none,
                    ),
                );
            }
            const wasmStartFuncRef = this.module.addFunction(
                BuiltinNames.start,
                binaryen.none,
                binaryen.none,
                [],
                this.module.block(null, startFuncStmts),
            );
            this.module.setStart(wasmStartFuncRef);
        }

        this.module.addFunction(
            func.name,
            binaryen.createType(paramWASMTypes),
            returnWASMType,
            allVarsTypeRefs,
            this.module.block(
                null,
                [bodyRef, this.currentFuncCtx.returnOp],
                returnWASMType,
            ),
        );
        if (
            (func.ownKind &
                (FunctionOwnKind.EXPORT | FunctionOwnKind.DEFAULT)) ===
                (FunctionOwnKind.EXPORT | FunctionOwnKind.DEFAULT) &&
            func.isInEnterScope
        ) {
            const wrapperName = importName.concat(BuiltinNames.wrapperSuffix);
            let idx = 0;
            let oriParamWasmValues: binaryen.ExpressionRef[] = [];
            if (func.parameters) {
                oriParamWasmValues = func.parameters.map((param) => {
                    return this.module.local.get(
                        idx++,
                        this.wasmTypeComp.getWASMValueType(param.type),
                    );
                }) as unknown as binaryen.ExpressionRef[];
            }
            /* add init statements */
            const functionStmts: binaryen.ExpressionRef[] = [];
            /* call globalInitFunc */
            functionStmts.push(
                this.module.call(this.globalInitFuncName, [], binaryen.none),
            );
            const wrapperCallArgs: binaryen.ExpressionRef[] = [];
            for (let i = 0; i < func.envParamLen; i++) {
                wrapperCallArgs.push(
                    binaryenCAPI._BinaryenRefNull(
                        this.module.ptr,
                        emptyStructType.typeRef,
                    ),
                );
            }
            const targetCall = this.module.call(
                func.name,
                wrapperCallArgs.concat(oriParamWasmValues),
                returnWASMType,
            );
            const isReturn = returnWASMType === binaryen.none ? false : true;
            functionStmts.push(
                isReturn ? this.module.local.set(idx, targetCall) : targetCall,
            );

            /* call globalDestoryFunc */
            if (!this.parserContext.compileArgs[ArgNames.noAutoFreeCtx]) {
                functionStmts.push(
                    this.module.call(
                        this.globalDestoryFuncName,
                        [],
                        binaryen.none,
                    ),
                );
            }

            /* set return value */
            const functionVars: binaryen.ExpressionRef[] = [];
            if (isReturn) {
                functionStmts.push(
                    this.module.return(
                        this.module.local.get(idx, returnWASMType),
                    ),
                );
                functionVars.push(returnWASMType);
            }

            this.module.addFunction(
                wrapperName,
                binaryen.createType(oriParamWasmTypes),
                returnWASMType,
                functionVars,
                this.module.block(null, functionStmts),
            );
            this.module.addFunctionExport(wrapperName, importName);
        }

        /** set customize local var names iff debug mode*/
        // const debugMode = this.parserContext.compileArgs[ArgNames.debug];
        // if (debugMode) {
        //     this.setDebugLocation(functionScope, funcRef, localVarNameIndexMap);
        // }
    }

    public assignCtxVar(context: VarDeclareNode, freeVars: VarDeclareNode[]) {
        const assignedCtxVar = context;
        const assignedCtxTypeRef = this.wasmTypeComp.getWASMHeapType(
            assignedCtxVar.type,
        );
        const initCtxVar = context.initCtx!;
        const initCtxTypeRef = this.wasmTypeComp.getWASMValueType(
            initCtxVar.type,
        );
        const initCtxVarRef = binaryenCAPI._BinaryenRefCast(
            this.module.ptr,
            this.module.local.get(initCtxVar.index, emptyStructType.typeRef),
            initCtxTypeRef,
        );
        let assignRef: binaryen.ExpressionRef;
        /** the function or block generate free variables */
        if (freeVars.length > 0) {
            const freeVarList: binaryen.ExpressionRef[] = [];
            freeVarList.push(initCtxVarRef);
            for (const f of freeVars) {
                freeVarList.push(
                    this.module.local.get(
                        f.index,
                        this.wasmTypeComp.getWASMValueType(f.type),
                    ),
                );
            }
            const newCtxStruct = binaryenCAPI._BinaryenStructNew(
                this.module.ptr,
                arrayToPtr(freeVarList).ptr,
                freeVarList.length,
                assignedCtxTypeRef,
            );
            assignRef = this.module.local.set(
                assignedCtxVar.index,
                newCtxStruct,
            );
        } else {
            assignRef = this.module.local.set(
                assignedCtxVar.index,
                initCtxVarRef,
            );
        }
        this.currentFuncCtx!.insert(assignRef);
    }

    public assignThisVar(thisVar: VarDeclareNode) {
        const initedThisVarIdx = 1;
        const assignedThisTypeRef = this.wasmTypeComp.getWASMValueType(
            thisVar.type,
        );
        const initCtxVarRef = binaryenCAPI._BinaryenRefCast(
            this.module.ptr,
            this.module.local.get(initedThisVarIdx, emptyStructType.typeRef),
            assignedThisTypeRef,
        );
        const assignRef = this.module.local.set(thisVar.index, initCtxVarRef);
        this.currentFuncCtx!.insert(assignRef);
    }

    /* parse function body */
    private parseBody(body: BlockNode) {
        /* assign value for block's context variable */
        if (
            body.varList &&
            body.varList[0].type instanceof ClosureContextType &&
            body.varList[0].initCtx
        ) {
            const freeVars: VarDeclareNode[] = [];
            for (const v of body.varList) {
                if (v.closureIndex !== undefined) {
                    freeVars.push(v);
                }
            }
            this.assignCtxVar(body.varList[0], freeVars);
        }
        for (const stmt of body.statements) {
            const stmtRef = this._wasmStmtCompiler.WASMStmtGen(stmt);
            this.currentFuncCtx!.insert(stmtRef);
        }
    }

    private initEnv() {
        this.module.addFunction(
            this.globalInitFuncName,
            binaryen.none,
            binaryen.none,
            [],
            this.module.block(null, this.globalInitArray),
        );
    }

    private destoryEnv() {
        this.module.addFunction(
            this.globalDestoryFuncName,
            binaryen.none,
            binaryen.none,
            [],
            this.module.block(null, this.globalDestoryArray),
        );
    }

    public generateRawString(str: string): number {
        const offset = this.dataSegmentContext!.addString(str);
        return offset;
    }

    public generateItable(objType: ObjectType): number {
        if (this.dataSegmentContext!.itableMap.has(objType.typeId)) {
            return this.dataSegmentContext!.itableMap.get(objType.typeId)!;
        }
        const members = objType.meta.members;
        let dataLength = members.length;
        dataLength += members.filter((m) => m.hasSetter && m.hasGetter).length;
        const buffer = new Uint32Array(2 + 3 * dataLength);
        buffer[0] = objType.typeId;
        buffer[1] = dataLength;
        let memberMethodsCnt = 0;
        const cnt = Math.min(dataLength, members.length);
        let memberFieldsCnt = 1; // In obj, the first field is vtable.
        for (let i = 0, j = 2; i < cnt; i++, j += 3) {
            const member = members[i];
            const memberName = member.name;
            buffer[j] = this.generateRawString(memberName);
            if (member.type === MemberType.FIELD) {
                buffer[j + 1] = ItableFlag.FIELD;
                buffer[j + 2] = memberFieldsCnt++;
            } else if (member.type === MemberType.METHOD) {
                buffer[j + 1] = ItableFlag.METHOD;
                buffer[j + 2] = memberMethodsCnt++;
            } else if (member.type === MemberType.ACCESSOR) {
                if (member.hasGetter) {
                    buffer[j + 1] = ItableFlag.GETTER;
                    buffer[j + 2] = memberMethodsCnt++;
                }
                if (member.hasGetter && member.hasSetter) {
                    j += 3;
                    buffer[j] = buffer[j - 3];
                }
                if (member.hasSetter) {
                    buffer[j + 1] = ItableFlag.SETTER;
                    buffer[j + 2] = memberMethodsCnt++;
                }
            }
        }
        const offset = this.dataSegmentContext!.addData(
            new Uint8Array(buffer.buffer),
        );
        this.dataSegmentContext!.itableMap.set(objType.typeId, offset);
        return offset;
    }

    public findMethodImplementClass(
        meta: ObjectDescription,
        member: MemberDescription,
    ): ObjectDescription | undefined {
        if (member.isOwn) {
            return meta;
        }

        let curMeta = meta.base;

        while (curMeta) {
            if (curMeta.findMember(member.name)?.isOwn) {
                return curMeta;
            }

            curMeta = curMeta.base;
        }

        return undefined;
    }

    public getMethodMangledName(
        member: MemberDescription,
        meta: ObjectDescription,
        accessorKind?: number /* 0 is getter, 1 is setter */,
    ) {
        const implClassMeta = this.findMethodImplementClass(meta, member);
        assert(implClassMeta, 'implClassMeta should not be undefined');

        let methodName = member.name;
        if (accessorKind !== undefined) {
            if (accessorKind === 0) {
                methodName = 'get_'.concat(member.name);
            } else if (accessorKind === 1) {
                methodName = 'set_'.concat(member.name);
            }
        }
        let implClassName = implClassMeta!.name;
        if (implClassName.includes('@')) {
            implClassName = implClassName.slice(1);
        }
        return UtilFuncs.getFuncName(implClassName, methodName);
    }

    // public addDebugInfoRef(
    //     node: Statement | Expression,
    //     exprRef: binaryen.ExpressionRef,
    // ) {
    //     if (node.debugLoc && this.currentFuncCtx) {
    //         const scope = this.currentFuncCtx.getFuncScope();
    //         if (
    //             scope instanceof FunctionScope ||
    //             scope instanceof GlobalScope
    //         ) {
    //             node.debugLoc.ref = exprRef;
    //             scope.debugLocations.push(node.debugLoc);
    //         }
    //     }
    // }

    public genrateInitJSGlobalObject(name: string) {
        const namePointer = this.generateRawString(name);
        const JSGlobalObj = this.module.call(
            dyntype.dyntype_get_global,
            [
                this.module.global.get(
                    dyntype.dyntype_context,
                    dyntype.dyn_ctx_t,
                ),
                this.module.i32.const(namePointer),
            ],
            dyntype.dyn_value_t,
        );
        const expr = binaryenCAPI._BinaryenGlobalSet(
            this.module.ptr,
            getCString(name),
            JSGlobalObj,
        );
        return expr;
    }

    private setDebugLocation(
        scope: FunctionScope | GlobalScope,
        funcRef: binaryen.FunctionRef,
        localVarNameIndexMap: Map<string, number>,
    ) {
        localVarNameIndexMap.forEach((index, name) => {
            binaryenCAPI._BinaryenFunctionSetLocalName(
                funcRef,
                index,
                getCString(name),
            );
        });
        const srcPath = scope.getRootGloablScope()!.srcFilePath;
        const isBuiltIn = srcPath.includes(BuiltinNames.builtinTypeName);
        // add debug location
        if (!isBuiltIn && scope.debugLocations.length > 0) {
            if (!this.debugInfoFileNames.has(srcPath)) {
                this.debugInfoFileNames.set(
                    srcPath,
                    this.module.addDebugInfoFileName(srcPath),
                );
            }
            const debugFileName = this.debugInfoFileNames.get(srcPath)!;

            const debugLocs = scope.debugLocations;
            for (let i = 0; i < debugLocs.length; i++) {
                const loc = debugLocs[i];
                this.module.setDebugLocation(
                    funcRef,
                    loc.ref,
                    debugFileName,
                    loc.line,
                    loc.col,
                );
            }
        }
    }
}
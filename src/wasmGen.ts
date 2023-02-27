import ts from 'typescript';
import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import { FunctionKind, getMethodPrefix, TSClass } from './type.js';
import { builtinTypes, TSFunction, Type, TypeKind } from './type.js';
import { Variable } from './variable.js';
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
    ClosureEnvironment,
    BlockScope,
    NamespaceScope,
} from './scope.js';
import { Stack } from './utils.js';
import { typeInfo } from './glue/utils.js';
import { Compiler } from './compiler.js';
import { importLibApi } from './envInit.js';
import { WASMTypeGen } from './wasmTypeGen.js';
import {
    WASMExpressionGen,
    WASMDynExpressionGen,
    WASMExpressionBase,
} from './wasmExprGen.js';
import { WASMStatementGen } from './wasmStmtGen.js';
import {
    initGlobalOffset,
    initDefaultMemory,
    initDefaultTable,
} from './memory.js';
import { initStringBuiltin } from '../lib/builtin/stringBuiltin.js';
import { dyntype } from '../lib/dyntype/utils.js';
import { ArgNames, BuiltinNames } from '../lib/builtin/builtinUtil.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

export class WASMFunctionContext {
    private binaryenCtx: WASMGen;
    private currentScope: Scope;
    private funcScope: FunctionScope | GlobalScope | NamespaceScope;
    private funcOpcodeArray: Array<binaryen.ExpressionRef>;
    private opcodeArrayStack = new Stack<Array<binaryen.ExpressionRef>>();
    private returnOpcode: binaryen.ExpressionRef;
    private returnIndex = 0;

    constructor(
        binaryenCtx: WASMGen,
        scope: FunctionScope | GlobalScope | NamespaceScope,
    ) {
        this.binaryenCtx = binaryenCtx;
        this.currentScope = scope;
        this.funcScope = scope;
        this.funcOpcodeArray = new Array<binaryen.ExpressionRef>();
        this.opcodeArrayStack.push(this.funcOpcodeArray);
        this.returnOpcode = this.binaryenCtx.module.return();
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

    insertAtFuncEntry(insn: binaryen.ExpressionRef) {
        this.funcOpcodeArray.push(insn);
    }

    enterScope(scope: Scope) {
        this.currentScope = scope;
        this.opcodeArrayStack.push(new Array<binaryen.ExpressionRef>());
        /* Init context variable */
        if (scope.getNearestFunctionScope()) {
            /* Only create context for scopes inside function scope */
            this.insert(
                this.binaryenCtx.createClosureContext(
                    scope as ClosureEnvironment,
                ),
            );
        }
    }

    exitScope() {
        const topMostArray = this.opcodeArrayStack.pop();
        this.currentScope = this.currentScope.parent!;

        return topMostArray;
    }

    getCurrentScope() {
        return this.currentScope;
    }

    getFuncScope() {
        return this.funcScope;
    }

    getBody() {
        return this.funcOpcodeArray;
    }

    set returnIdx(idx: number) {
        this.returnIndex = idx;
    }

    get returnIdx() {
        return this.returnIndex;
    }
}

interface segmentInfo {
    data: Uint8Array;
    offset: number;
}

class DataSegmentContext {
    static readonly reservedSpace: number = 1024;
    private binaryenCtx: WASMGen;
    currentOffset;
    stringOffsetMap;
    /* cache <typeid, itable*>*/
    itableMap;
    dataArray: Array<segmentInfo> = [];

    constructor(binaryenCtx: WASMGen) {
        /* Reserve 1024 bytes at beggining */
        this.binaryenCtx = binaryenCtx;
        this.currentOffset = DataSegmentContext.reservedSpace;
        this.stringOffsetMap = new Map<string, number>();
        this.itableMap = new Map<number, number>();
    }

    addData(data: Uint8Array) {
        /* there is no efficient approach to cache the data buffer,
            currently we don't cache it */
        const offset = this.currentOffset;
        this.currentOffset += data.length;

        this.dataArray.push({
            data: data,
            offset: offset,
        });

        return offset;
    }

    addString(str: string) {
        if (this.stringOffsetMap.has(str)) {
            /* Re-use the string to save space */
            return this.stringOffsetMap.get(str)!;
        }

        const offset = this.currentOffset;
        this.stringOffsetMap.set(str, offset);
        this.currentOffset += str.length + 1;

        const buffer = new Uint8Array(str.length + 1);
        for (let i = 0; i < str.length; i++) {
            const byte = str.charCodeAt(i);
            if (byte >= 256) {
                throw Error('UTF-16 string not supported in data segment');
            }
            buffer[i] = byte;
        }
        buffer[str.length] = 0;

        this.dataArray.push({
            data: buffer,
            offset: offset,
        });

        return offset;
    }

    generateSegment(): binaryen.MemorySegment | null {
        const offset = DataSegmentContext.reservedSpace;
        const size = this.currentOffset - offset;

        if (this.dataArray.length === 0) {
            return null;
        }

        const data = new Uint8Array(size);
        this.dataArray.forEach((info) => {
            for (let i = 0; i < info.data.length; i++) {
                const targetOffset =
                    i + info.offset - DataSegmentContext.reservedSpace;
                data[targetOffset] = info.data[i];
            }
        });

        return {
            offset: this.binaryenCtx.module.i32.const(offset),
            data: data,
            passive: false,
        };
    }

    getDataEnd(): number {
        return this.currentOffset;
    }
}

/* used it when creating a wasm struct, to mark a field iff the field is not packed */
const typeNotPacked = binaryenCAPI._BinaryenPackedTypeNotPacked();

export class WASMGen {
    private currentFuncCtx: WASMFunctionContext | null = null;
    private dataSegmentContext: DataSegmentContext | null = null;
    private binaryenModule = new binaryen.Module();
    private globalScopeStack: Stack<GlobalScope>;
    static contextOfScope: Map<Scope, typeInfo> = new Map<Scope, typeInfo>();
    private wasmTypeCompiler = new WASMTypeGen(this);
    wasmExprCompiler = new WASMExpressionGen(this);
    wasmDynExprCompiler = new WASMDynExpressionGen(this);
    wasmExprBase = new WASMExpressionBase(this);
    private wasmStmtCompiler = new WASMStatementGen(this);
    enterModuleScope: GlobalScope | null = null;
    private startBodyArray: Array<binaryen.ExpressionRef> = [];

    constructor(private compilerCtx: Compiler) {
        this.binaryenModule = compilerCtx.binaryenModule;
        this.globalScopeStack = compilerCtx.globalScopeStack;
        this.dataSegmentContext = new DataSegmentContext(this);
    }

    _generateInitDynContext() {
        const initDynContextStmt = this.module.global.set(
            dyntype.dyntype_context,
            this.module.call(dyntype.dyntype_context_init, [], binaryen.none),
        );

        return initDynContextStmt;
    }

    _generateFreeDynContext() {
        const freeDynContextStmt = this.module.call(
            dyntype.dyntype_context_destroy,
            [
                this.module.global.get(
                    dyntype.dyntype_context,
                    this.wasmType.getWASMType(
                        builtinTypes.get(TypeKind.DYNCONTEXTTYPE)!,
                    ),
                ),
            ],
            binaryen.none,
        );

        return freeDynContextStmt;
    }

    WASMGenerate() {
        WASMGen.contextOfScope.clear();
        this.enterModuleScope = this.globalScopeStack.peek();

        // init wasm environment
        initGlobalOffset(this.module);
        initDefaultTable(this.module);
        if (!this.compilerCtx.compileArgs[ArgNames.disableBuiltIn]) {
            initStringBuiltin(this.module);
        }
        if (!this.compilerCtx.compileArgs[ArgNames.disableAny]) {
            importLibApi(this.module);
        }

        for (let i = 0; i < this.globalScopeStack.size(); i++) {
            const globalScope = this.globalScopeStack.getItemAtIdx(i);
            this.WASMGenHelper(globalScope);
            this.WASMStartFunctionGen(globalScope);
        }

        if (this.compilerCtx.compileArgs[ArgNames.disableAny]) {
            if (
                this.wasmTypeCompiler.tsType2WASMTypeMap.has(
                    builtinTypes.get(TypeKind.ANY)!,
                )
            ) {
                throw Error('any type is in source');
            }
        }

        const startFuncOpcodes = [];
        if (!this.compilerCtx.compileArgs[ArgNames.disableAny]) {
            this.module.addGlobal(
                dyntype.dyntype_context,
                dyntype.dyn_ctx_t,
                true,
                this.module.f64.const(0),
            );
            startFuncOpcodes.push(this._generateInitDynContext());
        }
        startFuncOpcodes.push(
            this.module.call(
                this.enterModuleScope.startFuncName,
                [],
                binaryen.none,
            ),
        );
        if (!this.compilerCtx.compileArgs[ArgNames.disableAny]) {
            startFuncOpcodes.push(this._generateFreeDynContext());
        }
        // set enter module start function as wasm start function
        const wasmStartFuncRef = this.module.addFunction(
            BuiltinNames.start,
            binaryen.none,
            binaryen.none,
            [],
            this.module.block(null, startFuncOpcodes),
        );
        this.module.setStart(wasmStartFuncRef);

        const segments = [];
        const segmentInfo = this.dataSegmentContext!.generateSegment();
        if (segmentInfo) {
            segments.push(segmentInfo);
        }
        initDefaultMemory(this.module, segments);

        /* add find_index function from .wat */

        /* TODO: Have not found an effiective way to load import function from .wat yet */
        this.module.addFunctionImport(
            'strcmp',
            'env',
            'strcmp',
            binaryen.createType([binaryen.i32, binaryen.i32]),
            binaryen.i32,
        );
        const itableFilePath = path.join(
            path.dirname(fileURLToPath(import.meta.url)),
            '..',
            'runtime-library',
            'interface-lib',
            'itable.wat',
        );
        const itableLib = fs.readFileSync(itableFilePath, 'utf-8');
        const module = binaryen.parseText(itableLib);
        this.addInterfaceAPIFuncs(module, 'find_index');
    }

    WASMGenHelper(scope: Scope) {
        switch (scope.kind) {
            case ScopeKind.GlobalScope:
                this.WASMGlobalGen(<GlobalScope>scope);
                break;
            case ScopeKind.NamespaceScope:
                this.WASMGlobalGen(<NamespaceScope>scope);
                break;
            case ScopeKind.FunctionScope:
                this.WASMFunctionGen(<FunctionScope>scope);
                break;
            case ScopeKind.ClassScope:
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

    get curFunctionCtx(): WASMFunctionContext | null {
        return this.currentFuncCtx;
    }

    generateStartFuncVarTypes(
        scope: Scope,
        globalScope: GlobalScope,
        varWasmTypes: Array<binaryen.ExpressionRef>,
    ) {
        /* Don't process global vars */
        if (scope !== globalScope) {
            for (const variable of scope.varArray) {
                if (variable.varType.kind !== TypeKind.FUNCTION) {
                    varWasmTypes.push(
                        this.wasmType.getWASMType(variable.varType),
                    );
                } else {
                    varWasmTypes.push(
                        this.wasmType.getWASMFuncStructType(variable.varType),
                    );
                }
            }
        }

        scope.children.forEach((s) => {
            if (s instanceof BlockScope) {
                /* Only process block scope, inner functions will be processed separately */
                this.generateStartFuncVarTypes(s, globalScope, varWasmTypes);
            }
        });

        if (scope === globalScope) {
            /* Append temp vars */
            (scope as FunctionScope).getTempVars().forEach((v) => {
                if (v.varType.kind !== TypeKind.FUNCTION) {
                    varWasmTypes.push(this.wasmType.getWASMType(v.varType));
                } else {
                    varWasmTypes.push(
                        this.wasmType.getWASMFuncStructType(v.varType),
                    );
                }
            });
        }
    }

    /* add global variables, and generate start function */
    WASMStartFunctionGen(globalScope: GlobalScope) {
        const body = this.module.block(null, this.startBodyArray);

        const wasmTypes = new Array<binaryen.ExpressionRef>();
        this.generateStartFuncVarTypes(globalScope, globalScope, wasmTypes);
        // generate module start function
        this.module.addFunction(
            globalScope.startFuncName,
            binaryen.none,
            binaryen.none,
            wasmTypes,
            body,
        );
    }

    generateFuncVarTypes(
        scope: Scope,
        funcScope: FunctionScope,
        varWasmTypes: Array<binaryen.ExpressionRef>,
    ) {
        varWasmTypes.push(
            (<typeInfo>WASMGen.contextOfScope.get(scope)).typeRef,
        );
        const remainVars = scope.varArray.slice(1);

        // if (funcScope.className !== '' && scope === funcScope) {
        //     /* For class method, the second parameter is "this" pointer */
        //     const classScope = <ClassScope>funcScope.parent;
        //     varWasmTypes.push(this.wasmType.getWASMType(classScope.classType));
        //     remainVars = remainVars.slice(1);
        // }

        /* the first one is context struct, no need to parse */
        for (const variable of remainVars) {
            if (variable.varType.kind !== TypeKind.FUNCTION) {
                varWasmTypes.push(this.wasmType.getWASMType(variable.varType));
            } else {
                varWasmTypes.push(
                    this.wasmType.getWASMFuncStructType(variable.varType),
                );
            }
        }

        scope.children.forEach((s) => {
            if (s instanceof BlockScope) {
                /* Only process block scope, inner functions will be processed separately */
                this.generateFuncVarTypes(s, funcScope, varWasmTypes);
            }
        });

        if (scope === funcScope) {
            /* Append temp vars */
            (scope as FunctionScope).getTempVars().forEach((v) => {
                if (v.varType.kind !== TypeKind.FUNCTION) {
                    varWasmTypes.push(this.wasmType.getWASMType(v.varType));
                } else {
                    varWasmTypes.push(
                        this.wasmType.getWASMFuncStructType(v.varType),
                    );
                }
            });
        }
    }

    createClosureContext(scope: ClosureEnvironment) {
        let closureIndex = 1;
        const closureVarTypes = new Array<binaryenCAPI.TypeRef>();
        const closureVarValues = new Array<binaryen.ExpressionRef>();
        const muts = new Array<boolean>();
        closureVarTypes.push(emptyStructType.typeRef);
        muts.push(false);
        closureVarValues.push(
            this.module.local.get(0, emptyStructType.typeRef),
        );

        /* parent level function's context type */
        let maybeParentCtxType: typeInfo | null = null;
        const parentScope = scope.parent;
        if (parentScope) {
            maybeParentCtxType = <typeInfo>(
                WASMGen.contextOfScope.get(parentScope)
            );
            if (
                maybeParentCtxType !== null &&
                maybeParentCtxType !== emptyStructType
            ) {
                closureVarTypes[0] = maybeParentCtxType.typeRef;
                closureVarValues[0] = binaryenCAPI._BinaryenRefCast(
                    this.module.ptr,
                    this.module.local.get(0, emptyStructType.typeRef),
                    maybeParentCtxType.heapTypeRef,
                );
            }
        }

        if (scope instanceof FunctionScope) {
            for (const param of scope.paramArray) {
                if (param.varIsClosure) {
                    const type = this.wasmTypeCompiler.getWASMType(
                        param.varType,
                    );
                    closureVarTypes.push(type);
                    closureVarValues.push(
                        this.module.local.get(param.varIndex, type),
                    );
                    param.setClosureIndex(closureIndex++);
                    muts.push(param.isReadOnly ? false : true);
                }
            }
        }
        for (const variable of scope.varArray) {
            if (variable.varIsClosure) {
                const type = this.wasmTypeCompiler.getWASMType(
                    variable.varType,
                );
                closureVarTypes.push(type);
                closureVarValues.push(
                    this.module.local.get(variable.varIndex, type),
                );
                variable.setClosureIndex(closureIndex++);
                muts.push(variable.isConst ? false : true);
            }
        }

        const packed = new Array<binaryenCAPI.PackedType>(
            closureVarTypes.length,
        ).fill(typeNotPacked);

        /* No closure variable */
        if (closureVarTypes.length === 1) {
            WASMGen.contextOfScope.set(
                scope,
                maybeParentCtxType === null
                    ? emptyStructType
                    : maybeParentCtxType,
            );
            return this.binaryenModule.local.set(
                scope.contextVariable!.varIndex,
                closureVarValues[0],
            );
        } else {
            WASMGen.contextOfScope.set(
                scope,
                initStructType(
                    closureVarTypes,
                    packed,
                    muts,
                    closureVarTypes.length,
                    true,
                ),
            );
            const targetHeapType = (<typeInfo>WASMGen.contextOfScope.get(scope))
                .heapTypeRef;
            const context = binaryenCAPI._BinaryenStructNew(
                this.module.ptr,
                arrayToPtr(closureVarValues).ptr,
                closureVarValues.length,
                targetHeapType,
            );
            return this.binaryenModule.local.set(
                scope.contextVariable!.varIndex,
                context,
            );
        }
    }

    WASMGlobalGen(scope: NamespaceScope | GlobalScope) {
        this.currentFuncCtx = new WASMFunctionContext(this, scope);

        // parse global scope statements, generate start function body
        for (const stmt of scope.statements) {
            const stmtRef = this.wasmStmtCompiler.WASMStmtGen(stmt);
            if (
                stmt.statementKind === ts.SyntaxKind.Unknown ||
                stmt.statementKind === ts.SyntaxKind.VariableStatement
            ) {
                continue;
            }
            this.curFunctionCtx!.insert(stmtRef);
        }
        this.startBodyArray = this.startBodyArray.concat(
            this.curFunctionCtx!.getBody(),
        );
    }

    /* parse function scope */
    WASMFunctionGen(functionScope: FunctionScope) {
        this.currentFuncCtx = new WASMFunctionContext(this, functionScope);

        const tsFuncType = functionScope.funcType;
        // 1. generate function wasm type
        this.wasmTypeCompiler.createWASMType(tsFuncType);
        // 2. generate context struct, iff the function scope do have
        let closureIndex = 1;
        const closureVarTypes = new Array<binaryenCAPI.TypeRef>();
        const closureVarValues = new Array<binaryen.ExpressionRef>();
        const muts = new Array<boolean>();
        closureVarTypes.push(emptyStructType.typeRef);
        muts.push(false);
        closureVarValues.push(
            this.module.local.get(0, emptyStructType.typeRef),
        );

        /* parent level function's context type */
        let maybeParentCtxType: typeInfo | null = null;
        const parentScope = functionScope.parent;
        if (parentScope) {
            maybeParentCtxType = <typeInfo>(
                (WASMGen.contextOfScope.get(parentScope) || null)
            );
            if (maybeParentCtxType && maybeParentCtxType !== emptyStructType) {
                closureVarTypes[0] = maybeParentCtxType.typeRef;
                closureVarValues[0] = binaryenCAPI._BinaryenRefCast(
                    this.module.ptr,
                    this.module.local.get(0, emptyStructType.typeRef),
                    maybeParentCtxType.heapTypeRef,
                );
            }
        }

        for (const param of functionScope.paramArray) {
            if (param.varIsClosure) {
                const type = this.wasmTypeCompiler.getWASMType(param.varType);
                closureVarTypes.push(type);
                closureVarValues.push(
                    this.module.local.get(param.varIndex, type),
                );
                param.setClosureIndex(closureIndex++);
                muts.push(!param.isReadOnly);
            }
        }
        for (const variable of functionScope.varArray) {
            if (variable.varIsClosure) {
                const type = this.wasmTypeCompiler.getWASMType(
                    variable.varType,
                );
                closureVarTypes.push(type);
                closureVarValues.push(
                    this.module.local.get(variable.varIndex, type),
                );
                variable.setClosureIndex(closureIndex++);
                muts.push(!variable.isConst);
            }
        }

        const packed = new Array<binaryenCAPI.PackedType>(
            closureVarTypes.length,
        ).fill(typeNotPacked);

        /* iff it hasn't free variables */
        if (closureVarTypes.length === 1) {
            WASMGen.contextOfScope.set(
                functionScope,
                maybeParentCtxType === null
                    ? emptyStructType
                    : maybeParentCtxType,
            );
        } else {
            WASMGen.contextOfScope.set(
                functionScope,
                initStructType(
                    closureVarTypes,
                    packed,
                    muts,
                    closureVarTypes.length,
                    true,
                ),
            );
        }

        const paramWASMType =
            this.wasmTypeCompiler.getWASMFuncParamType(tsFuncType);
        const returnWASMType =
            this.wasmTypeCompiler.getWASMFuncReturnType(tsFuncType);
        /* context struct variable index */
        const targetVarIndex = functionScope.contextVariable!.varIndex;
        /* iff the function doesn't have free variables */
        if (closureVarTypes.length === 1) {
            this.currentFuncCtx!.insert(
                this.module.local.set(targetVarIndex, closureVarValues[0]),
            );
        } else {
            const targetHeapType = (<typeInfo>(
                WASMGen.contextOfScope.get(functionScope)
            )).heapTypeRef;
            const context = binaryenCAPI._BinaryenStructNew(
                this.module.ptr,
                arrayToPtr(closureVarValues).ptr,
                closureVarValues.length,
                targetHeapType,
            );
            this.currentFuncCtx!.insert(
                this.module.local.set(targetVarIndex, context),
            );
        }

        /* Class's "this" parameter */
        if (functionScope.funcType.funcKind !== FunctionKind.DEFAULT) {
            const classType = (<ClassScope>functionScope.parent).classType;
            const wasmClassHeapType = this.wasmType.getWASMHeapType(classType);
            const thisVarIndex = functionScope.getThisIndex();
            this.currentFuncCtx!.insert(
                this.module.local.set(
                    thisVarIndex,
                    binaryenCAPI._BinaryenRefCast(
                        this.module.ptr,
                        this.module.local.get(1, emptyStructType.typeRef),
                        wasmClassHeapType,
                    ),
                ),
            );
        }
        // add return value iff return type is not void
        if (
            functionScope.funcType.funcKind !== FunctionKind.CONSTRUCTOR &&
            functionScope.funcType.returnType.kind !== TypeKind.VOID
        ) {
            const returnVarIdx = functionScope.allocateLocalIndex();
            const returnVar = new Variable(
                '~returnVar',
                functionScope.funcType.returnType,
                [],
                returnVarIdx,
                true,
            );
            this.currentFuncCtx!.returnIdx = returnVarIdx;
            functionScope.addTempVar(returnVar);
        }

        // generate wasm statements
        for (const stmt of functionScope.statements) {
            const stmtRef = this.wasmStmtCompiler.WASMStmtGen(stmt);
            if (stmt.statementKind === ts.SyntaxKind.VariableStatement) {
                continue;
            }
            this.currentFuncCtx!.insert(stmtRef);
        }

        // add return in last iff return type is not void
        if (functionScope.funcType.returnType.kind !== TypeKind.VOID) {
            let returnValue = this.module.local.get(
                this.curFunctionCtx!.returnIdx,
                returnWASMType,
            );
            if (functionScope.funcType.funcKind === FunctionKind.CONSTRUCTOR) {
                returnValue = this.module.local.get(
                    functionScope.paramArray.length + 1,
                    returnWASMType,
                );
            }
            this.currentFuncCtx!.setReturnOpcode(
                this.module.return(returnValue),
            );
        }

        const varWASMTypes = new Array<binaryen.ExpressionRef>();
        this.generateFuncVarTypes(functionScope, functionScope, varWASMTypes);

        // 4: add wrapper function if exported
        const isExport =
            functionScope.parent === this.enterModuleScope &&
            functionScope.isExport;
        if (isExport) {
            const functionStmts: binaryen.ExpressionRef[] = [];
            // init dyntype contex
            const initDynContextStmt = this.module.global.set(
                dyntype.dyntype_context,
                this.module.call(
                    dyntype.dyntype_context_init,
                    [],
                    binaryen.none,
                ),
            );
            if (!this.compilerCtx.compileArgs[ArgNames.disableAny]) {
                functionStmts.push(initDynContextStmt);
            }

            // call origin function
            let idx = 0;
            const tempLocGetParams = tsFuncType
                .getParamTypes()
                .map((p) =>
                    this.module.local.get(
                        idx++,
                        this.wasmTypeCompiler.getWASMType(p),
                    ),
                );
            const targetCall = this.module.call(
                functionScope.mangledName,
                [
                    binaryenCAPI._BinaryenRefNull(
                        this.module.ptr,
                        emptyStructType.typeRef,
                    ),
                ].concat(tempLocGetParams),
                returnWASMType,
            );
            const isReturn = returnWASMType === binaryen.none ? false : true;
            functionStmts.push(
                isReturn ? this.module.local.set(idx, targetCall) : targetCall,
            );

            // free dyntype context
            const freeDynContextStmt = this.module.call(
                dyntype.dyntype_context_destroy,
                [
                    this.module.global.get(
                        dyntype.dyntype_context,
                        this.wasmType.getWASMType(
                            builtinTypes.get(TypeKind.DYNCONTEXTTYPE)!,
                        ),
                    ),
                ],
                binaryen.none,
            );
            if (!this.compilerCtx.compileArgs[ArgNames.disableAny]) {
                functionStmts.push(freeDynContextStmt);
            }

            // return value
            const functionVars: binaryen.ExpressionRef[] = [];
            if (isReturn) {
                functionStmts.push(
                    this.module.return(
                        this.module.local.get(idx, returnWASMType),
                    ),
                );
                functionVars.push(returnWASMType);
            }
            // add export function
            this.module.addFunction(
                functionScope.funcName + '-wrapper',
                this.wasmTypeCompiler.getWASMFuncOrignalParamType(tsFuncType),
                returnWASMType,
                functionVars,
                this.module.block(null, functionStmts),
            );

            this.module.addFunctionExport(
                functionScope.funcName + '-wrapper',
                functionScope.funcName,
            );
        }

        if (functionScope.isDeclare) {
            this.module.addFunctionImport(
                functionScope.mangledName,
                BuiltinNames.external_module_name,
                functionScope.mangledName,
                paramWASMType,
                returnWASMType,
            );
        } else {
            this.module.addFunction(
                functionScope.mangledName,
                paramWASMType,
                returnWASMType,
                varWASMTypes,
                this.module.block(
                    null,
                    [
                        this.module.block(
                            'statements',
                            this.currentFuncCtx.getBody(),
                        ),
                        this.currentFuncCtx.returnOp,
                    ],
                    returnWASMType,
                ),
            );
        }
    }

    getVariableInitValue(varType: Type): binaryen.ExpressionRef {
        const module = this.module;
        if (varType.kind === TypeKind.NUMBER) {
            return module.f64.const(0);
        } else if (varType.kind === TypeKind.BOOLEAN) {
            return module.i32.const(0);
        } else if (varType.kind === TypeKind.DYNCONTEXTTYPE) {
            return module.i64.const(0, 0);
        }
        return binaryenCAPI._BinaryenRefNull(module.ptr, binaryen.anyref);
    }

    generateRawString(str: string): number {
        const offset = this.dataSegmentContext!.addString(str);
        return offset;
    }

    generateItable(shape: TSClass): number {
        if (this.dataSegmentContext!.itableMap.has(shape.typeId)) {
            return this.dataSegmentContext!.itableMap.get(shape.typeId)!;
        }
        const methodLen = shape.memberFuncs.length;
        const fieldLen = shape.fields.length;
        const dataLength = methodLen + fieldLen;
        const buffer = new Uint32Array(2 + 3 * dataLength);
        buffer[0] = this.module.i32.const(shape.typeId);
        buffer[1] = dataLength;
        for (let i = 0, j = 2; i < methodLen; i++, j += 3) {
            buffer[j] = this.generateRawString(shape.memberFuncs[i].name);
            buffer[j + 1] = 1;
            buffer[j + 2] = this.module.i32.const(i);
        }
        const previousPartLength = 2 + shape.memberFuncs.length * 3;
        for (let i = 0, j = previousPartLength; i < fieldLen; i++, j += 3) {
            buffer[j] = this.generateRawString(shape.fields[i].name);
            buffer[j + 1] = 0;
            buffer[j + 2] = this.module.i32.const(i + 1);
        }
        const offset = this.dataSegmentContext!.addData(
            new Uint8Array(buffer.buffer),
        );
        this.dataSegmentContext!.itableMap.set(shape.typeId, offset);
        return offset;
    }

    /* add function rely on name in other .wat*/
    addInterfaceAPIFuncs(module: binaryen.Module, funcName: string) {
        const func = module.getFunction(funcName);
        const name = binaryenCAPI._BinaryenFunctionGetName(func);
        const params = binaryenCAPI._BinaryenFunctionGetParams(func);
        const results = binaryenCAPI._BinaryenFunctionGetResults(func);
        const vars = [];
        const numvars = binaryenCAPI._BinaryenFunctionGetNumVars(func);
        for (let i = 0; i < numvars; i++) {
            vars.push(binaryenCAPI._BinaryenFunctionGetVar(func, i));
        }
        const body = binaryenCAPI._BinaryenFunctionGetBody(func);
        binaryenCAPI._BinaryenAddFunction(
            this.binaryenModule.ptr,
            name,
            params,
            results,
            arrayToPtr(vars).ptr,
            vars.length,
            body,
        );
    }
}
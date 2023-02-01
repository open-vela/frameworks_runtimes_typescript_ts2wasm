import ts from 'typescript';
import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import { builtinTypes, TSFunction, Type, TypeKind } from './type.js';
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
import {
    initGlobalOffset,
    initDefaultMemory,
    initDefaultTable,
} from './memory.js';
import { initStringBuiltin } from '../lib/builtin/stringBuiltin.js';
import { dyntype } from '../lib/dyntype/utils.js';

export class WASMFunctionContext {
    private binaryenCtx: WASMGen;
    private currentScope: Scope;
    private funcScope: FunctionScope | GlobalScope;
    private funcOpcodeArray: Array<binaryen.ExpressionRef>;
    private opcodeArrayStack = new Stack<Array<binaryen.ExpressionRef>>();
    private returnOpcode: binaryen.ExpressionRef;
    private returnIndex = 0;

    constructor(binaryenCtx: WASMGen, scope: FunctionScope | GlobalScope) {
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
    dataArray: Array<segmentInfo> = [];

    constructor(binaryenCtx: WASMGen) {
        /* Reserve 1024 bytes at beggining */
        this.binaryenCtx = binaryenCtx;
        this.currentOffset = DataSegmentContext.reservedSpace;
        this.stringOffsetMap = new Map<string, number>();
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
        this.dataSegmentContext = new DataSegmentContext(this);
    }

    WASMGenerate() {
        WASMGen.contextOfFunc.clear();

        initGlobalOffset(this.module);
        initDefaultTable(this.module);
        importLibApi(this.module);
        initStringBuiltin(this.module);

        while (!this.globalScopeStack.isEmpty()) {
            const globalScope = this.globalScopeStack.pop();
            this.WASMGenHelper(globalScope);
        }

        const segments = [];
        const segmentInfo = this.dataSegmentContext!.generateSegment();
        if (segmentInfo) {
            segments.push(segmentInfo);
        }
        initDefaultMemory(this.module, segments);
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

    get curFunctionCtx(): WASMFunctionContext | null {
        return this.currentFuncCtx;
    }

    /* add global variables, and generate start function */
    WASMStartFunctionGen(globalScope: GlobalScope) {
        initDynContext(globalScope);

        this.currentFuncCtx = new WASMFunctionContext(this, globalScope);

        // add global dyn context variable
        const globalVars = globalScope.varArray;
        for (const globalVar of globalVars) {
            const varTypeRef =
                globalVar.varType.kind === TypeKind.FUNCTION
                    ? this.wasmType.getWASMFuncStructType(globalVar.varType)
                    : this.wasmType.getWASMType(globalVar.varType);
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
                if (
                    globalVar.varType.kind === TypeKind.NUMBER ||
                    globalVar.varType.kind === TypeKind.DYNCONTEXTTYPE
                ) {
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
                            globalVar.varType.kind === TypeKind.NUMBER
                                ? this.module.f64.const(0)
                                : this.module.i64.const(0, 0),
                        );
                        this.curFunctionCtx?.insert(
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
                        this.curFunctionCtx!.insert(
                            this.module.global.set(
                                globalVar.varName,
                                dynInitExprRef,
                            ),
                        );
                    } else {
                        this.curFunctionCtx!.insert(
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
            const stmtRef = this.wasmStmtCompiler.WASMStmtGen(stmt);
            if (
                stmt.statementKind === ts.SyntaxKind.Unknown ||
                stmt.statementKind === ts.SyntaxKind.VariableStatement
            ) {
                continue;
            }
            this.curFunctionCtx!.insert(stmtRef);
        }
        const body = this.module.block(null, this.curFunctionCtx!.getBody());

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
        const tsClassType = classScope.classType;
        this.wasmTypeCompiler.createWASMType(tsClassType);
        /* iff a class haven't a constructor, create a default on for it */
        if (tsClassType.classConstructorType === null) {
            const tsFuncType = new TSFunction();
            const wasmClassType = this.wasmType.getWASMType(tsClassType);
            tsClassType.setClassConstructor('constructor', tsFuncType);
            const classInstance = binaryenCAPI._BinaryenRefCast(
                this.module.ptr,
                this.module.local.get(0, emptyStructType.typeRef),
                this.wasmType.getWASMHeapType(tsClassType),
            );
            this.module.addFunction(
                classScope.className + '_constructor',
                binaryen.createType([emptyStructType.typeRef]),
                wasmClassType,
                [],
                this.module.block(null, [this.module.return(classInstance)]),
            );
        }
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
        let maybeParentFuncCtxType: typeInfo | null = null;
        const parentFuncScope = functionScope.parent?.getNearestFunctionScope();
        if (parentFuncScope) {
            maybeParentFuncCtxType = <typeInfo>(
                WASMGen.contextOfFunc.get(parentFuncScope)
            );
            if (
                maybeParentFuncCtxType !== null &&
                maybeParentFuncCtxType !== emptyStructType
            ) {
                closureVarTypes[0] = maybeParentFuncCtxType.typeRef;
                closureVarValues[0] = binaryenCAPI._BinaryenRefCast(
                    this.module.ptr,
                    this.module.local.get(0, emptyStructType.typeRef),
                    maybeParentFuncCtxType.heapTypeRef,
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
                muts.push(
                    param.varModifier === ModifierKind.readonly ? false : true,
                );
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
                muts.push(
                    variable.varModifier === ModifierKind.const ? false : true,
                );
            }
        }

        const packed = new Array<binaryenCAPI.PackedType>(
            closureVarTypes.length,
        ).fill(typeNotPacked);

        /* TODO: maybe the condition is not very clearly */
        if (functionScope.className === '') {
            /* iff it hasn't free variables */
            if (closureVarTypes.length === 1) {
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
                        closureVarTypes,
                        packed,
                        muts,
                        closureVarTypes.length,
                        true,
                    ),
                );
            }
        }
        const paramWASMType =
            this.wasmTypeCompiler.getWASMFuncParamType(tsFuncType);
        let returnWASMType =
            this.wasmTypeCompiler.getWASMFuncReturnType(tsFuncType);

        /* context struct variable index */
        const targetVarIndex = functionScope.paramArray.length;
        if (functionScope.className === '') {
            /* iff the function doesn't have free variables */
            if (closureVarTypes.length === 1) {
                this.currentFuncCtx!.insert(
                    this.module.local.set(targetVarIndex, closureVarValues[0]),
                );
            } else {
                const targetHeapType = (<typeInfo>(
                    WASMGen.contextOfFunc.get(functionScope)
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
        } else {
            const classType = (<ClassScope>functionScope.parent).classType;
            const wasmClassHeapType = this.wasmType.getWASMHeapType(classType);
            this.currentFuncCtx!.insert(
                this.module.local.set(
                    targetVarIndex,
                    binaryenCAPI._BinaryenRefCast(
                        this.module.ptr,
                        this.module.local.get(0, emptyStructType.typeRef),
                        wasmClassHeapType,
                    ),
                ),
            );
        }

        // add return value iff return type is not void
        if (functionScope.funcType.returnType.kind !== TypeKind.VOID) {
            const returnVarIdx =
                functionScope.paramArray.length + functionScope.varArray.length;
            const returnVar = new Variable(
                '~returnVar',
                functionScope.funcType.returnType,
                ModifierKind.default,
                returnVarIdx,
                true,
            );
            this.currentFuncCtx!.returnIdx = returnVarIdx;
            functionScope.addVariable(returnVar);
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
            this.currentFuncCtx!.setReturnOpcode(
                this.module.return(
                    this.module.local.get(
                        this.currentFuncCtx!.returnIdx,
                        returnWASMType,
                    ),
                ),
            );
        }
        /* iff constructor, return type is class type  */
        if (
            functionScope.funcName ===
            functionScope.className + '_constructor'
        ) {
            const classScope = <ClassScope>functionScope.parent;
            const wasmClassType = this.wasmType.getWASMType(
                classScope.classType,
            );
            this.currentFuncCtx!.setReturnOpcode(
                this.module.return(
                    this.module.local.get(targetVarIndex, returnWASMType),
                ),
            );
            returnWASMType = wasmClassType;
        }
        const varWASMTypes = new Array<binaryen.ExpressionRef>();
        // iff not a member function
        if (functionScope.className === '') {
            varWASMTypes.push(
                (<typeInfo>WASMGen.contextOfFunc.get(functionScope)).typeRef,
            );
        } else {
            const classScope = <ClassScope>functionScope.parent;
            varWASMTypes.push(this.wasmType.getWASMType(classScope.classType));
        }
        /* the first one is context struct, no need to parse */
        for (const variable of functionScope.varArray.slice(1)) {
            if (variable.varType.kind !== TypeKind.FUNCTION) {
                varWASMTypes.push(this.wasmType.getWASMType(variable.varType));
            } else {
                varWASMTypes.push(
                    this.wasmType.getWASMFuncStructType(variable.varType),
                );
            }
        }

        // 4: add wrapper function if exported
        const isExport = functionScope.funcModifiers.some((v) => {
            return v === ts.SyntaxKind.ExportKeyword;
        });
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
            functionStmts.push(initDynContextStmt);

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
                functionScope.funcName,
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
            functionStmts.push(freeDynContextStmt);

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
        this.module.addFunction(
            functionScope.funcName,
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

    // [this.wasmType.getWASMType((<ClassScope>functionScope.parent).classType), binaryen.f64],

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
}

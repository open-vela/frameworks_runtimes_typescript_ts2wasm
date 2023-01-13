import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import {
    Primitive,
    TSArray,
    TSClass,
    TSFunction,
    Type,
    TypeKind,
} from './type.js';
import { ModifierKind, Variable } from './variable.js';
import {
    BinaryExpression,
    CallExpression,
    ConditionalExpression,
    Expression,
    IdentifierExpression,
    NewExpression,
    NumberLiteralExpression,
    StringLiteralExpression,
    SuperCallExpression,
    ThisExpression,
    UnaryExpression,
    ArrayLiteralExpression,
    ObjectLiteralExpression,
    PropertyAccessExpression,
    ElementAccessExpression,
    AsExpression,
} from './expression.js';
import {
    Statement,
    IfStatement,
    ReturnStatement,
    BaseLoopStatement,
    ForStatement,
    SwitchStatement,
    CaseBlock,
    CaseClause,
    BreakStatement,
    DefaultClause,
    BlockStatement,
    ExpressionStatement,
} from './statement.js';
import ts from 'typescript';
import {
    arrayToPtr,
    emptyStructType,
    initArrayType,
    initStructType,
    createSignatureTypeRefAndHeapTypeRef,
} from './glue/transform.js';
import { assert } from 'console';
import {
    FunctionScope,
    GlobalScope,
    ClassScope,
    ScopeKind,
    funcNames,
} from './scope.js';
import { MatchKind, Stack } from './utils.js';
import * as dyntype from '../lib/dyntype/utils.js';
import { Scope } from './scope.js';
import { BuiltinNames } from '../lib/builtin/builtinUtil.js';
import {
    charArrayTypeInfo,
    stringTypeInfo,
    objectStructTypeInfo,
} from './glue/packType.js';
import { typeInfo, FlattenLoop, IfStatementInfo } from './glue/utils.js';
import { Compiler } from './compiler.js';
import {
    importLibApi,
    isDynFunc,
    initDynContext,
    freeDynContext,
    getReturnTypeRef,
} from './envInit.js';

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
            // TODO: the push operation should be placed here.
            const statement = this.wasmStmtCompiler.WASMStmtGen(stmt);
            // globalStatementRef.push(statement);
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

    WASMFunctionGen(functionScope: FunctionScope) {
        this.currentScope = functionScope;
        this.currentFuncScope = functionScope;

        const funcStatementRef = new Array<binaryen.ExpressionRef>();
        this.scopeStatementMap.set(functionScope, funcStatementRef);

        // add local variable
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
                funcStatementRef.push(
                    this.module.local.set(localVar.varIndex, varInitExprRef),
                );
            }
        }

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
                muts.push(
                    param.varModifier === ModifierKind.readonly
                        ? this.module.i32.const(0)
                        : this.module.i32.const(1),
                );
            }
        }
        for (const variable of functionScope.varArray) {
            if (variable.varIsClosure) {
                closureVarArray.push(
                    this.wasmTypeCompiler.getWASMType(variable.varType),
                );
                variable.setClosureIndex(closureIndex++);
                muts.push(
                    variable.varModifier === ModifierKind.const
                        ? this.module.i32.const(0)
                        : this.module.i32.const(1),
                );
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
                        false,
                    ),
                );
            }
        }
        // 3. generate wasm function
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
        /* functionDeclaration
                |
              Block
        */
        const wasmFuncStmts = this.wasmStmtCompiler.WASMStmtGen(
            functionScope.statements[0],
        );
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
            wasmFuncStmts,
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

class WASMTypeGen {
    private static tsType2WASMTypeMap: Map<Type, binaryenCAPI.TypeRef> =
        new Map();
    private static tsType2WASMHeapTypeMap: Map<Type, binaryenCAPI.HeapTypeRef> =
        new Map();
    // the format is : {context: struct{}, funcref: ref $func}
    private static tsFuncType2WASMStructType: Map<Type, binaryenCAPI.TypeRef> =
        new Map();
    private static tsFuncParamType: Map<Type, binaryenCAPI.TypeRef> = new Map();
    private static tsFuncReturnType: Map<Type, binaryenCAPI.TypeRef> =
        new Map();
    private static tsClassVtableType: Map<Type, binaryenCAPI.TypeRef> =
        new Map();
    private static tsClassVtableHeapType: Map<Type, binaryenCAPI.TypeRef> =
        new Map();
    // not contain context struct
    private static tsFuncOriginalParamType: Map<Type, binaryenCAPI.TypeRef> =
        new Map();

    private static classVtables: Map<Type, binaryenCAPI.ExpressionRef> =
        new Map();

    constructor(private WASMCompiler: WASMGen) {}

    createWASMType(type: Type): void {
        if (WASMTypeGen.tsType2WASMTypeMap.has(type)) {
            return;
        }
        switch (type.typeKind) {
            case TypeKind.VOID:
                WASMTypeGen.tsType2WASMTypeMap.set(type, binaryen.none);
                break;
            case TypeKind.BOOLEAN:
                WASMTypeGen.tsType2WASMTypeMap.set(type, binaryen.i32);
                break;
            case TypeKind.NUMBER:
                WASMTypeGen.tsType2WASMTypeMap.set(type, binaryen.f64);
                break;
            case TypeKind.STRING: {
                WASMTypeGen.tsType2WASMTypeMap.set(
                    type,
                    stringTypeInfo.typeRef,
                );
                WASMTypeGen.tsType2WASMHeapTypeMap.set(
                    type,
                    stringTypeInfo.heapTypeRef,
                );
                break;
            }
            case TypeKind.ANY: {
                WASMTypeGen.tsType2WASMTypeMap.set(type, binaryen.anyref);
                break;
            }
            case TypeKind.ARRAY: {
                const arrayType = <TSArray>type;
                const elemType = arrayType.elementType;
                const elemTypeRef = this.getWASMType(elemType);
                const arrayTypeInfo = initArrayType(
                    elemTypeRef,
                    binaryenCAPI._BinaryenPackedTypeNotPacked(),
                    true,
                    true,
                );
                WASMTypeGen.tsType2WASMTypeMap.set(type, arrayTypeInfo.typeRef);
                WASMTypeGen.tsType2WASMHeapTypeMap.set(
                    type,
                    arrayTypeInfo.heapTypeRef,
                );
                break;
            }
            case TypeKind.FUNCTION: {
                const funcType = <TSFunction>type;
                const paramTypes = funcType.getParamTypes();
                const paramWASMTypes = new Array<binaryenCAPI.TypeRef>(
                    paramTypes.length + 1,
                );
                paramWASMTypes[0] = emptyStructType.typeRef;
                for (let i = 0; i !== paramTypes.length; ++i) {
                    if (paramTypes[i].typeKind === TypeKind.FUNCTION) {
                        paramWASMTypes[i + 1] = this.getWASMFuncStructType(
                            paramTypes[i],
                        );
                    } else {
                        paramWASMTypes[i + 1] = this.getWASMType(paramTypes[i]);
                    }
                }
                WASMTypeGen.tsFuncParamType.set(
                    type,
                    binaryen.createType(paramWASMTypes),
                );
                WASMTypeGen.tsFuncOriginalParamType.set(
                    type,
                    binaryen.createType(paramWASMTypes.slice(1)),
                );
                let resultWASMType = this.getWASMType(funcType.returnType);
                if (funcType.returnType.typeKind === TypeKind.FUNCTION) {
                    resultWASMType = this.getWASMFuncStructType(
                        funcType.returnType,
                    );
                }
                WASMTypeGen.tsFuncReturnType.set(type, resultWASMType);
                const signature = createSignatureTypeRefAndHeapTypeRef(
                    paramWASMTypes,
                    resultWASMType,
                );
                WASMTypeGen.tsType2WASMTypeMap.set(type, signature.typeRef);
                WASMTypeGen.tsType2WASMHeapTypeMap.set(
                    type,
                    signature.heapTypeRef,
                );
                WASMTypeGen.tsFuncType2WASMStructType.set(
                    type,
                    initStructType(
                        [emptyStructType.typeRef, signature.typeRef],
                        [typeNotPacked, typeNotPacked],
                        [0, 0],
                        2,
                        false,
                    ).typeRef,
                );
                break;
            }
            case TypeKind.CLASS: {
                const tsClassType = <TSClass>type;
                // 1. add vtable
                const wasmFuncTypes = new Array<binaryenCAPI.TypeRef>();
                const vtableFuncs = new Array<number>();
                let muts = new Array<number>();
                for (const func of tsClassType.memberFuncs) {
                    if (!tsClassType.isOverrideMethod(func[0])) {
                        continue;
                    }
                    vtableFuncs.push(
                        this.WASMCompiler.module.ref.func(
                            tsClassType.className + '_' + func[0],
                            this.getWASMType(func[1]),
                        ),
                    );
                    wasmFuncTypes.push(this.getWASMType(func[1]));
                    muts.push(0);
                }
                let packed = new Array<binaryenCAPI.PackedType>(
                    wasmFuncTypes.length,
                ).fill(typeNotPacked);
                const vtableType = initStructType(
                    wasmFuncTypes,
                    packed,
                    muts,
                    wasmFuncTypes.length,
                    false,
                );
                const vtableInstance = binaryenCAPI._BinaryenStructNew(
                    this.WASMCompiler.module.ptr,
                    arrayToPtr(vtableFuncs).ptr,
                    vtableFuncs.length,
                    vtableType.heapTypeRef,
                );
                WASMTypeGen.tsClassVtableType.set(type, vtableType.typeRef);
                WASMTypeGen.tsClassVtableHeapType.set(
                    type,
                    vtableType.heapTypeRef,
                );
                WASMTypeGen.classVtables.set(type, vtableInstance);

                // 2. add fields
                const wasmFieldTypes = new Array<binaryenCAPI.TypeRef>();
                muts = new Array<number>(tsClassType.fields.length + 1);
                packed = new Array<binaryenCAPI.PackedType>(
                    tsClassType.fields.length + 1,
                ).fill(typeNotPacked);
                muts[0] = 0;
                wasmFieldTypes[0] = vtableType.typeRef;
                for (let i = 0; i !== tsClassType.fields.length; ++i) {
                    const field = tsClassType.fields[i];
                    wasmFieldTypes.push(this.getWASMType(field.type));
                    if (field.modifier === 'readonly') {
                        muts[i + 1] = 0;
                    } else {
                        muts[i + 1] = 1;
                    }
                }
                // 3. generate class wasm type
                const wasmClassType = initStructType(
                    wasmFieldTypes,
                    packed,
                    muts,
                    wasmFieldTypes.length,
                    false,
                );
                WASMTypeGen.tsType2WASMTypeMap.set(type, wasmClassType.typeRef);
                WASMTypeGen.tsType2WASMHeapTypeMap.set(
                    type,
                    wasmClassType.heapTypeRef,
                );
                break;
            }
            default:
                break;
        }
    }

    hasHeapType(type: Type): boolean {
        if (
            type.kind === TypeKind.VOID ||
            type.kind === TypeKind.BOOLEAN ||
            type.kind === TypeKind.NUMBER
        ) {
            return false;
        }
        return true;
    }

    getWASMType(type: Type): binaryenCAPI.TypeRef {
        if (!WASMTypeGen.tsType2WASMTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsType2WASMTypeMap.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMHeapType(type: Type): binaryenCAPI.HeapTypeRef {
        assert(this.hasHeapType(type));
        if (!WASMTypeGen.tsType2WASMHeapTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsType2WASMHeapTypeMap.get(
            type,
        ) as binaryenCAPI.HeapTypeRef;
    }

    getWASMFuncStructType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!WASMTypeGen.tsFuncType2WASMStructType.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsFuncType2WASMStructType.get(
            type,
        ) as binaryenCAPI.TypeRef;
    }

    getWASMFuncParamType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!WASMTypeGen.tsType2WASMTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsFuncParamType.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMFuncOrignalParamType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!WASMTypeGen.tsType2WASMTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsFuncOriginalParamType.get(
            type,
        ) as binaryenCAPI.TypeRef;
    }

    getWASMFuncReturnType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.FUNCTION);
        if (!WASMTypeGen.tsType2WASMTypeMap.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsFuncReturnType.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMClassVtableType(type: Type): binaryenCAPI.TypeRef {
        assert(type.typeKind === TypeKind.CLASS);
        if (!WASMTypeGen.tsFuncType2WASMStructType.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsClassVtableType.get(type) as binaryenCAPI.TypeRef;
    }

    getWASMClassVtableHeapType(type: Type): binaryenCAPI.HeapTypeRef {
        assert(type.typeKind === TypeKind.CLASS);
        if (!WASMTypeGen.tsFuncType2WASMStructType.has(type)) {
            this.createWASMType(type);
        }
        return WASMTypeGen.tsClassVtableHeapType.get(
            type,
        ) as binaryenCAPI.HeapTypeRef;
    }

    getWASMClassVtable(type: Type): binaryen.ExpressionRef {
        assert(type.typeKind === TypeKind.CLASS);
        return WASMTypeGen.classVtables.get(type) as binaryen.ExpressionRef;
    }
}

class WASMExpressionBase {
    wasmCompiler;
    module;
    wasmType;
    currentScope;
    statementArray: binaryen.ExpressionRef[];
    globalTmpVarStack;
    localTmpVarStack;
    staticValueGen;
    dynValueGen;

    constructor(WASMCompiler: WASMGen) {
        this.wasmCompiler = WASMCompiler;
        this.module = this.wasmCompiler.module;
        this.wasmType = this.wasmCompiler.wasmType;
        // TODO: bug: this.currentScope is null
        this.currentScope = this.wasmCompiler.curScope!;
        this.statementArray = this.wasmCompiler.scopeStateMap.get(
            this.currentScope,
        )!;
        this.globalTmpVarStack = new Stack<string>();
        this.localTmpVarStack = new Stack<string>();
        this.staticValueGen = this.wasmCompiler.wasmExprCompiler;
        this.dynValueGen = this.wasmCompiler.wasmDynExprCompiler;
    }

    setLocalValue(
        variableIndex: number,
        value: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        return this.module.local.set(variableIndex, value);
    }

    getLocalValue(
        variableIndex: number,
        variableType: binaryen.Type,
    ): binaryen.ExpressionRef {
        return this.module.local.get(variableIndex, variableType);
    }

    setGlobalValue(
        variableName: string,
        value: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        return this.module.global.set(variableName, value);
    }

    getGlobalValue(
        variableName: string,
        variableType: binaryen.Type,
    ): binaryen.ExpressionRef {
        return this.module.global.get(variableName, variableType);
    }

    generateTmpVar(prefix: string, typeName = '', varType = new Type()) {
        // add tmp value to current scope
        const tmpNumberName = this.getTmpVariableName(prefix);
        let variableType;
        if (typeName === 'any') {
            variableType = new Primitive('any');
        } else if (typeName === 'address') {
            variableType = new Primitive('boolean');
        } else if (typeName === 'number') {
            variableType = new Primitive('number');
        } else {
            variableType = varType;
        }
        const tmpVar = new Variable(
            tmpNumberName,
            variableType,
            ModifierKind.default,
            0,
            true,
        );
        this.addVariableToCurrentScope(tmpVar);
        return tmpVar;
    }

    getTmpVariableName(prefix: string) {
        const currentScope = this.currentScope;
        let tmpVariableName: string;
        if (currentScope.kind === ScopeKind.GlobalScope) {
            tmpVariableName = prefix + this.globalTmpVarStack.size();
            this.globalTmpVarStack.push(tmpVariableName);
        } else {
            tmpVariableName = prefix + this.localTmpVarStack.size();
            this.localTmpVarStack.push(tmpVariableName);
        }
        return tmpVariableName;
    }

    addVariableToCurrentScope(variable: Variable) {
        const currentScope = this.currentScope!;
        let variableIndex: number;
        if (currentScope.kind === ScopeKind.GlobalScope) {
            variableIndex = (<GlobalScope>currentScope).startFuncVarArray
                .length;
            variable.setVarIndex(variableIndex);
            const globalScope = <GlobalScope>currentScope;
            globalScope.addStartFuncVar(variable);
        } else {
            const nearestFunctionScope = currentScope.getNearestFunctionScope();
            const funcScope = <FunctionScope>nearestFunctionScope!;
            variableIndex =
                funcScope.paramArray.length + funcScope.varArray.length;
            variable.setVarIndex(variableIndex);
            funcScope.addVariable(variable);
        }
    }

    setVariableToCurrentScope(
        variable: Variable,
        value: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        return this.module.local.set(variable.varIndex, value);
    }

    getVariableValue(variable: Variable, type: binaryen.Type) {
        return this.getLocalValue(variable.varIndex, type);
    }

    convertTypeToI32(
        expression: binaryen.ExpressionRef,
        expressionType: binaryen.Type,
    ): binaryen.ExpressionRef {
        const module = this.module;
        switch (expressionType) {
            case binaryen.f64: {
                return module.i32.trunc_u_sat.f64(expression);
            }
            case binaryen.i32: {
                return expression;
            }
            // TODO: deal with more types
        }
        return binaryen.none;
    }

    convertTypeToI64(
        expression: binaryen.ExpressionRef,
        expressionType: binaryen.Type,
    ): binaryen.ExpressionRef {
        const module = this.module;
        switch (expressionType) {
            case binaryen.f64: {
                return module.i64.trunc_u_sat.f64(expression);
            }
            case binaryen.i64: {
                return expression;
            }
            // TODO: deal with more types
        }
        return binaryen.none;
    }

    convertTypeToF64(
        expression: binaryen.ExpressionRef,
        expressionType: binaryen.Type,
    ): binaryen.ExpressionRef {
        const module = this.module;
        switch (expressionType) {
            case binaryen.i32: {
                return module.f64.convert_u.i32(expression);
            }
            case binaryen.i64: {
                return module.f64.convert_u.i64(expression);
            }
            // TODO: deal with more types
        }
        return binaryen.none;
    }

    operateF64F64(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        switch (operatorKind) {
            case ts.SyntaxKind.PlusToken: {
                return module.f64.add(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.MinusToken: {
                return module.f64.sub(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.AsteriskToken: {
                return module.f64.mul(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.SlashToken: {
                return module.f64.div(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.GreaterThanToken: {
                return module.f64.gt(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.GreaterThanEqualsToken: {
                return module.f64.ge(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.LessThanToken: {
                return module.f64.lt(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.LessThanEqualsToken: {
                return module.f64.le(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.LessThanLessThanToken: {
                return this.convertTypeToF64(
                    module.i64.shl(
                        this.convertTypeToI64(leftExprRef, binaryen.f64),
                        this.convertTypeToI64(rightExprRef, binaryen.f64),
                    ),
                    binaryen.i64,
                );
            }
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsEqualsToken: {
                return module.f64.eq(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.ExclamationEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
                return module.f64.ne(leftExprRef, rightExprRef);
            }
            case ts.SyntaxKind.AmpersandAmpersandToken: {
                return module.select(
                    this.convertTypeToI32(leftExprRef, binaryen.f64),
                    rightExprRef,
                    leftExprRef,
                    binaryen.f64,
                );
            }
            case ts.SyntaxKind.BarBarToken: {
                return module.select(
                    this.convertTypeToI32(leftExprRef, binaryen.f64),
                    leftExprRef,
                    rightExprRef,
                    binaryen.f64,
                );
            }
            case ts.SyntaxKind.AmpersandToken: {
                return this.convertTypeToF64(
                    module.i64.and(
                        this.convertTypeToI64(leftExprRef, binaryen.f64),
                        this.convertTypeToI64(rightExprRef, binaryen.f64),
                    ),
                    binaryen.i64,
                );
            }
            case ts.SyntaxKind.BarToken: {
                return this.convertTypeToF64(
                    module.i64.or(
                        this.convertTypeToI64(leftExprRef, binaryen.f64),
                        this.convertTypeToI64(rightExprRef, binaryen.f64),
                    ),
                    binaryen.i64,
                );
            }
            default:
                return module.unreachable();
        }
    }

    operateF64I32(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        switch (operatorKind) {
            case ts.SyntaxKind.AmpersandAmpersandToken: {
                return module.select(
                    this.convertTypeToI32(leftExprRef, binaryen.f64),
                    rightExprRef,
                    this.convertTypeToI32(leftExprRef, binaryen.f64),
                    binaryen.i32,
                );
            }
            case ts.SyntaxKind.BarBarToken: {
                return module.select(
                    this.convertTypeToI32(leftExprRef, binaryen.f64),
                    this.convertTypeToI32(leftExprRef, binaryen.f64),
                    rightExprRef,
                    binaryen.i32,
                );
            }
            default:
                return module.unreachable();
        }
    }

    operateI32F64(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        switch (operatorKind) {
            case ts.SyntaxKind.AmpersandAmpersandToken: {
                const condition = Boolean(module.i32.eqz(leftExprRef));
                if (condition) {
                    return module.select(
                        leftExprRef,
                        this.convertTypeToI32(rightExprRef, binaryen.f64),
                        leftExprRef,
                        binaryen.i32,
                    );
                } else {
                    return rightExprRef;
                }
            }
            case ts.SyntaxKind.BarBarToken: {
                // if left is false, then condition is true
                const condition = Boolean(module.i32.eqz(leftExprRef));
                if (condition) {
                    return rightExprRef;
                } else {
                    return module.select(
                        leftExprRef,
                        leftExprRef,
                        this.convertTypeToI32(rightExprRef, binaryen.f64),
                        binaryen.i32,
                    );
                }
            }
            default:
                return module.unreachable();
        }
    }

    operateI32I32(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        switch (operatorKind) {
            case ts.SyntaxKind.AmpersandAmpersandToken: {
                return module.select(
                    leftExprRef,
                    rightExprRef,
                    leftExprRef,
                    binaryen.i32,
                );
            }
            case ts.SyntaxKind.BarBarToken: {
                return module.select(
                    leftExprRef,
                    leftExprRef,
                    rightExprRef,
                    binaryen.i32,
                );
            }
            default:
                return module.unreachable();
        }
    }

    defaultValue(typeKind: TypeKind) {
        switch (typeKind) {
            case TypeKind.BOOLEAN:
                return this.module.i32.const(0);
            case TypeKind.NUMBER:
                return this.module.f64.const(0);
            default:
                // TODO
                return binaryen.none;
        }
    }

    generateStringRef(value: string) {
        const valueLen = value.length;
        let strRelLen = valueLen;
        const charArray = [];
        for (let i = 0; i < valueLen; i++) {
            const codePoint = value.codePointAt(i)!;
            if (codePoint > 0xffff) {
                i++;
                strRelLen--;
            }
            charArray.push(this.module.i32.const(codePoint));
        }
        const valueContent = binaryenCAPI._BinaryenArrayInit(
            this.module.ptr,
            charArrayTypeInfo.heapTypeRef,
            arrayToPtr(charArray).ptr,
            strRelLen,
        );
        const wasmStringValue = binaryenCAPI._BinaryenStructNew(
            this.module.ptr,
            arrayToPtr([this.module.i32.const(0), valueContent]).ptr,
            2,
            stringTypeInfo.heapTypeRef,
        );
        return wasmStringValue;
    }

    generatePointerVar(bit: number) {
        const module = this.module;
        const tmpAddressVar = this.generateTmpVar('~address|', 'address');
        const tmpAddressValue = this.getGlobalValue(
            BuiltinNames.stack_pointer,
            binaryen.i32,
        );
        const setTmpAddressExpression = this.setVariableToCurrentScope(
            tmpAddressVar,
            tmpAddressValue,
        );
        const setTmpGlobalExpression = this.setGlobalValue(
            BuiltinNames.stack_pointer,
            module.i32.sub(
                this.getVariableValue(tmpAddressVar, binaryen.i32),
                module.i32.const(bit),
            ),
        );
        const resetGlobalExpression = this.setGlobalValue(
            BuiltinNames.stack_pointer,
            this.getVariableValue(tmpAddressVar, binaryen.i32),
        );
        return [
            tmpAddressVar,
            setTmpAddressExpression,
            setTmpGlobalExpression,
            resetGlobalExpression,
            tmpAddressValue,
        ];
    }

    turnDyntypeToExtref(
        expression: binaryen.ExpressionRef,
        pointer: binaryen.ExpressionRef,
        targetType: Type,
    ) {
        const module = this.module;
        const expressionToExtref = module.call(
            dyntype.dyntype_to_extref,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                expression,
                pointer,
            ],
            dyntype.int,
        );
        const tmpTableIdx = module.i32.load(0, 4, pointer);
        const objOrigValue = module.table.get(
            BuiltinNames.obj_table,
            tmpTableIdx,
            objectStructTypeInfo.typeRef,
        );

        const tmpObjVarInfo = this.generateTmpVar('~obj|', '', targetType);

        // cast ref ${} to target type
        const objTargetValue = binaryenCAPI._BinaryenRefCast(
            module.ptr,
            objOrigValue,
            this.wasmType.getWASMHeapType(targetType),
        );
        const setExtrefExpression = this.setVariableToCurrentScope(
            tmpObjVarInfo,
            objTargetValue,
        );

        const extrefExpression = module.if(
            module.i32.eq(expressionToExtref, dyntype.DYNTYPE_SUCCESS),
            setExtrefExpression,
        );
        return [tmpObjVarInfo, extrefExpression];
    }
}

class WASMExpressionGen extends WASMExpressionBase {
    constructor(WASMCompiler: WASMGen) {
        super(WASMCompiler);
    }

    WASMExprGen(expr: Expression): binaryen.ExpressionRef {
        this.module = this.wasmCompiler.module;
        this.wasmType = this.wasmCompiler.wasmType;
        this.currentScope = this.wasmCompiler.curScope!;
        this.statementArray = this.wasmCompiler.scopeStateMap.get(
            this.currentScope,
        )!;
        this.staticValueGen = this.wasmCompiler.wasmExprCompiler;
        this.dynValueGen = this.wasmCompiler.wasmDynExprCompiler;
        switch (expr.expressionKind) {
            case ts.SyntaxKind.NumericLiteral:
                return this.WASMNumberLiteral(<NumberLiteralExpression>expr);
            case ts.SyntaxKind.FalseKeyword:
                return this.module.i32.const(0);
            case ts.SyntaxKind.TrueKeyword:
                return this.module.i32.const(1);
            case ts.SyntaxKind.StringLiteral:
                return this.WASMStringLiteral(<StringLiteralExpression>expr);
            case ts.SyntaxKind.Identifier:
                return this.WASMIdenfierExpr(<IdentifierExpression>expr);
            case ts.SyntaxKind.BinaryExpression:
                return this.WASMBinaryExpr(<BinaryExpression>expr);
            case ts.SyntaxKind.PrefixUnaryExpression:
            case ts.SyntaxKind.PostfixUnaryExpression:
                return this.WASMUnaryExpr(<UnaryExpression>expr);
            case ts.SyntaxKind.ConditionalExpression:
                return this.WASMConditionalExpr(<ConditionalExpression>expr);
            case ts.SyntaxKind.CallExpression: {
                return this.WASMCallExpr(<CallExpression>expr);
            }
            case ts.SyntaxKind.SuperKeyword: {
                return this.WASMSuperExpr(<SuperCallExpression>expr);
            }
            case ts.SyntaxKind.ThisKeyword: {
                return this.WASMThisExpr(<ThisExpression>expr);
            }
            case ts.SyntaxKind.ParenthesizedExpression: {
                // TODO
                return binaryen.none;
            }
            case ts.SyntaxKind.ArrayLiteralExpression:
                return this.WASMArrayLiteralExpr(<ArrayLiteralExpression>expr);
            case ts.SyntaxKind.ObjectLiteralExpression:
                return this.WASMObjectLiteralExpr(
                    <ObjectLiteralExpression>expr,
                );
            case ts.SyntaxKind.PropertyAccessExpression:
                return this.WASMPropertyAccessExpr(
                    <PropertyAccessExpression>expr,
                );
            case ts.SyntaxKind.ElementAccessExpression:
                return this.WASMElementAccessExpr(
                    <ElementAccessExpression>expr,
                );
            case ts.SyntaxKind.NewExpression: {
                return this.WASMNewExpr(<NewExpression>expr);
            }
            case ts.SyntaxKind.AsExpression:
                return this.WASMAsExpr(<AsExpression>expr);
            default:
                return this.module.unreachable();
        }
    }

    WASMNumberLiteral(expr: NumberLiteralExpression): binaryen.ExpressionRef {
        return this.module.f64.const(expr.expressionValue);
    }

    WASMStringLiteral(expr: StringLiteralExpression): binaryen.ExpressionRef {
        const value = expr.expressionValue.substring(
            1,
            expr.expressionValue.length - 1,
        );
        return this.generateStringRef(value);
    }

    WASMIdenfierExpr(expr: IdentifierExpression): binaryen.ExpressionRef {
        const curScope = <Scope>this.currentScope;
        const variable = curScope.findVariable(expr.identifierName, true);
        if (variable === undefined) {
            throw new Error(
                'identifier not found, <' + expr.identifierName + '>',
            );
        }
        const varType = this.wasmType.getWASMType(variable.varType);

        if (!variable.isLocalVar) {
            return this.module.global.get(variable.varName, varType);
        }
        if (variable.varIsClosure) {
            const nearestFuncScope = <FunctionScope>(
                this.currentScope.getNearestFunctionScope()
            );
            const localGetType = (<typeInfo>(
                WASMGen.contextOfFunc.get(nearestFuncScope)
            )).typeRef;
            let localGet = this.module.local.get(
                nearestFuncScope.paramArray.length +
                    nearestFuncScope.varArray.length,
                localGetType,
            );
            // iff found in current function scope
            if (this.currentScope.findFunctionScope(expr.identifierName)) {
                return binaryenCAPI._BinaryenStructGet(
                    this.module.ptr,
                    variable.getClosureIndex(),
                    localGet,
                    localGetType,
                    false,
                );
            } else {
                let scope = nearestFuncScope.parent;
                let targetCtxTypeRef = binaryen.none;
                while (scope !== null) {
                    if (scope.kind === ScopeKind.FunctionScope) {
                        const target = scope.findVariable(
                            variable.varName,
                            false,
                        );

                        const funcScope = <FunctionScope>scope;
                        targetCtxTypeRef = (<typeInfo>(
                            WASMGen.contextOfFunc.get(funcScope)
                        )).typeRef;
                        localGet = binaryenCAPI._BinaryenStructGet(
                            this.module.ptr,
                            0,
                            localGet,
                            targetCtxTypeRef,
                            false,
                        );
                        if (target !== undefined) {
                            break;
                        }
                    }
                    scope = scope.parent;
                }
                return binaryenCAPI._BinaryenStructGet(
                    this.module.ptr,
                    variable.getClosureIndex(),
                    localGet,
                    targetCtxTypeRef,
                    false,
                );
            }
        }

        return this.module.local.get(variable.varIndex, varType);
    }

    WASMBinaryExpr(expr: BinaryExpression): binaryen.ExpressionRef {
        const leftExpr = expr.leftOperand;
        const rightExpr = expr.rightOperand;
        const operatorKind = expr.operatorKind;
        const leftExprType = leftExpr.exprType;
        const rightExprType = rightExpr.exprType;
        const leftExprRef = this.WASMExprGen(leftExpr);
        const rightExprRef = this.WASMExprGen(rightExpr);
        switch (operatorKind) {
            case ts.SyntaxKind.EqualsToken: {
                /*
                 a = b++  ==>
                 block {
                    a = b;
                    b = b + 1;
                 }
                 a = ++b  ==>
                 block {
                    b = b + 1;
                    a = b;
                 }
                */
                const assignWASMExpr = this.assignBinaryExpr(
                    leftExpr,
                    rightExpr,
                    leftExprType,
                    rightExprType,
                );
                if (
                    rightExpr.expressionKind ===
                        ts.SyntaxKind.PostfixUnaryExpression ||
                    rightExpr.expressionKind ===
                        ts.SyntaxKind.PrefixUnaryExpression
                ) {
                    const unaryExpr = <UnaryExpression>rightExpr;
                    /* iff  ExclamationToken, no need this step*/
                    if (
                        unaryExpr.operatorKind ===
                        ts.SyntaxKind.ExclamationToken
                    ) {
                        return assignWASMExpr;
                    }
                    const operandExpr = unaryExpr.operand;
                    const operandExprType = unaryExpr.operand.exprType;
                    const rightUnaryAssignWASMExpr = this.assignBinaryExpr(
                        leftExpr,
                        operandExpr,
                        leftExprType,
                        operandExprType,
                    );
                    /* a = ++b  ==>
                        block {
                            b = b + 1;
                            a = b;
                        }
                    */
                    if (
                        unaryExpr.expressionKind ===
                        ts.SyntaxKind.PrefixUnaryExpression
                    ) {
                        return this.module.block(null, [
                            rightExprRef,
                            rightUnaryAssignWASMExpr,
                        ]);
                    } else {
                        return this.module.block(null, [
                            rightUnaryAssignWASMExpr,
                            rightExprRef,
                        ]);
                    }
                }
                return assignWASMExpr;
            }
            case ts.SyntaxKind.PlusEqualsToken: {
                return this.assignBinaryExpr(
                    leftExpr,
                    new BinaryExpression(
                        ts.SyntaxKind.PlusToken,
                        leftExpr,
                        rightExpr,
                    ),
                    leftExprType,
                    rightExprType,
                );
            }
            case ts.SyntaxKind.MinusEqualsToken: {
                return this.assignBinaryExpr(
                    leftExpr,
                    new BinaryExpression(
                        ts.SyntaxKind.MinusToken,
                        leftExpr,
                        rightExpr,
                    ),
                    leftExprType,
                    rightExprType,
                );
            }
            case ts.SyntaxKind.AsteriskEqualsToken: {
                return this.assignBinaryExpr(
                    leftExpr,
                    new BinaryExpression(
                        ts.SyntaxKind.AsteriskToken,
                        leftExpr,
                        rightExpr,
                    ),
                    leftExprType,
                    rightExprType,
                );
            }
            case ts.SyntaxKind.SlashEqualsToken: {
                return this.assignBinaryExpr(
                    leftExpr,
                    new BinaryExpression(
                        ts.SyntaxKind.SlashToken,
                        leftExpr,
                        rightExpr,
                    ),
                    leftExprType,
                    rightExprType,
                );
            }
            default: {
                return this.operateBinaryExpr(
                    leftExprRef,
                    rightExprRef,
                    operatorKind,
                    leftExprType,
                    rightExprType,
                );
            }
        }
    }

    operateBinaryExpr(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
        leftExprType: Type,
        rightExprType: Type,
    ): binaryen.ExpressionRef {
        if (
            leftExprType.kind === TypeKind.NUMBER &&
            rightExprType.kind === TypeKind.NUMBER
        ) {
            return this.operateF64F64(leftExprRef, rightExprRef, operatorKind);
        }
        if (
            leftExprType.kind === TypeKind.NUMBER &&
            rightExprType.kind === TypeKind.BOOLEAN
        ) {
            return this.operateF64I32(leftExprRef, rightExprRef, operatorKind);
        }
        if (
            leftExprType.kind === TypeKind.BOOLEAN &&
            rightExprType.kind === TypeKind.NUMBER
        ) {
            return this.operateI32F64(leftExprRef, rightExprRef, operatorKind);
        }
        if (
            leftExprType.kind === TypeKind.BOOLEAN &&
            rightExprType.kind === TypeKind.BOOLEAN
        ) {
            return this.operateI32I32(leftExprRef, rightExprRef, operatorKind);
        }
        return this.module.unreachable();
    }

    assignBinaryExpr(
        leftExpr: Expression,
        rightExpr: Expression,
        leftExprType: Type,
        rightExprType: Type,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const matchKind = this.matchType(leftExprType, rightExprType);
        if (matchKind === MatchKind.MisMatch) {
            throw new Error('Type mismatch in ExpressionStatement');
        }
        switch (leftExpr.expressionKind) {
            case ts.SyntaxKind.PropertyAccessExpression: {
                // sample: const obj: any = {}; obj.a = 2;
                const objExprRef = this.WASMExprGen(leftExpr);
                const propIdenExpr = <IdentifierExpression>rightExpr;
                const propName = propIdenExpr.identifierName;
                const initDynValue = this.dynValueGen.WASMDynExprGen(rightExpr);
                if (propName === '__proto__') {
                    return module.call(
                        dyntype.dyntype_set_prototype,
                        [
                            module.global.get(
                                dyntype.dyntype_context,
                                dyntype.dyn_ctx_t,
                            ),
                            objExprRef,
                            this.WASMExprGen(rightExpr),
                        ],
                        dyntype.int,
                    );
                }
                const propNameRef = this.generateStringRef(propName);
                const setPropertyExpression = module.call(
                    dyntype.dyntype_set_property,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        objExprRef,
                        propNameRef,
                        initDynValue,
                    ],
                    dyntype.int,
                );
                return setPropertyExpression;
            }
            case ts.SyntaxKind.ElementAccessExpression: {
                // sample: a[2] = 8;
                const elementAccessExpr = <ElementAccessExpression>leftExpr;
                const arrayValue = this.WASMExprGen(
                    elementAccessExpr.accessExpr,
                );
                const index = this.convertTypeToI32(
                    this.WASMExprGen(elementAccessExpr.argExpr),
                    binaryen.f64,
                );
                let assignValue: binaryen.ExpressionRef;
                if (matchKind === MatchKind.ToArrayAnyMatch) {
                    assignValue = this.dynValueGen.WASMDynExprGen(rightExpr);
                } else {
                    assignValue = this.WASMExprGen(rightExpr);
                }
                return binaryenCAPI._BinaryenArraySet(
                    module.ptr,
                    arrayValue,
                    index,
                    assignValue,
                );
            }
            case ts.SyntaxKind.Identifier: {
                const identifierExpr = <IdentifierExpression>leftExpr;
                const identifierName = identifierExpr.identifierName;
                const variable = this.currentScope.findVariable(identifierName);
                if (!variable) {
                    throw new Error('error TS2304');
                }
                let assignValue: binaryen.ExpressionRef;
                if (matchKind === MatchKind.ToAnyMatch) {
                    assignValue = this.dynValueGen.WASMDynExprGen(rightExpr);
                } else {
                    assignValue = this.WASMExprGen(rightExpr);
                }
                if (!variable.isLocalVar) {
                    return this.setGlobalValue(variable.varName, assignValue);
                }
                if (variable.varIsClosure) {
                    const nearestFuncScope = <FunctionScope>(
                        this.currentScope.getNearestFunctionScope()
                    );
                    const localGetType = (<typeInfo>(
                        WASMGen.contextOfFunc.get(nearestFuncScope)
                    )).typeRef;
                    let localGet = this.module.local.get(
                        nearestFuncScope.paramArray.length +
                            nearestFuncScope.varArray.length,
                        localGetType,
                    );
                    // iff found in current function scope
                    if (this.currentScope.findFunctionScope(identifierName)) {
                        return binaryenCAPI._BinaryenStructSet(
                            this.module.ptr,
                            variable.getClosureIndex(),
                            localGet,
                            assignValue,
                        );
                    } else {
                        let scope = nearestFuncScope.parent;
                        let targetCtxTypeRef = binaryen.none;
                        while (scope !== null) {
                            if (scope.kind === ScopeKind.FunctionScope) {
                                const target = scope.findVariable(
                                    variable.varName,
                                    false,
                                );
                                const funcScope = <FunctionScope>scope;
                                targetCtxTypeRef = (<typeInfo>(
                                    WASMGen.contextOfFunc.get(funcScope)
                                )).typeRef;
                                localGet = binaryenCAPI._BinaryenStructGet(
                                    this.module.ptr,
                                    0,
                                    localGet,
                                    targetCtxTypeRef,
                                    false,
                                );
                                if (target !== undefined) {
                                    break;
                                }
                            }
                            scope = scope.parent;
                        }
                        return binaryenCAPI._BinaryenStructSet(
                            this.module.ptr,
                            variable.getClosureIndex(),
                            localGet,
                            assignValue,
                        );
                    }
                }
                return this.setLocalValue(variable.varIndex, assignValue);
            }
            default: {
                return module.unreachable();
            }
        }
    }

    matchType(leftExprType: Type, rightExprType: Type): number {
        if (leftExprType.kind === rightExprType.kind) {
            if (
                leftExprType.kind === TypeKind.NUMBER ||
                leftExprType.kind === TypeKind.STRING ||
                leftExprType.kind === TypeKind.BOOLEAN ||
                leftExprType.kind === TypeKind.ANY
            ) {
                return MatchKind.ExactMatch;
            }
            if (leftExprType.kind === TypeKind.ARRAY) {
                const leftArrayType = <TSArray>leftExprType;
                const rightArrayType = <TSArray>rightExprType;
                if (leftArrayType.elementType === rightArrayType.elementType) {
                    return MatchKind.ExactMatch;
                }
                if (leftArrayType.elementType.kind === TypeKind.ANY) {
                    return MatchKind.ToArrayAnyMatch;
                }
                if (rightArrayType.elementType.kind === TypeKind.ANY) {
                    return MatchKind.FromArrayAnyMatch;
                }
            }
            if (leftExprType.kind === TypeKind.CLASS) {
                const leftClassType = <TSClass>leftExprType;
                const rightClassType = <TSClass>rightExprType;
                const leftClassName = leftClassType.className;
                const rightClassName = rightClassType.className;
                if (leftClassName === rightClassName) {
                    return MatchKind.ClassMatch;
                }
                return MatchKind.MisMatch;
            }
        }
        if (leftExprType.kind === TypeKind.ANY) {
            return MatchKind.ToAnyMatch;
        }
        if (rightExprType.kind === TypeKind.ANY) {
            return MatchKind.FromAnyMatch;
        }
        return MatchKind.MisMatch;
    }

    WASMUnaryExpr(expr: UnaryExpression): binaryen.ExpressionRef {
        const operator: ts.SyntaxKind = expr.operatorKind;
        const operand: Expression = expr.operand;
        switch (operator) {
            case ts.SyntaxKind.PlusPlusToken:
                return this.WASMBinaryExpr(
                    new BinaryExpression(
                        ts.SyntaxKind.EqualsToken,
                        operand,
                        new BinaryExpression(
                            ts.SyntaxKind.PlusToken,
                            operand,
                            new NumberLiteralExpression(1),
                        ),
                    ),
                );
            case ts.SyntaxKind.MinusMinusToken:
                return this.WASMBinaryExpr(
                    new BinaryExpression(
                        ts.SyntaxKind.EqualsToken,
                        operand,
                        new BinaryExpression(
                            ts.SyntaxKind.MinusToken,
                            operand,
                            new NumberLiteralExpression(1),
                        ),
                    ),
                );
            case ts.SyntaxKind.ExclamationToken: {
                let WASMOperandExpr = this.WASMExprGen(operand);
                const WASMOperandType =
                    binaryen.getExpressionType(WASMOperandExpr);
                if (WASMOperandType != binaryen.i32) {
                    WASMOperandExpr = this.convertTypeToI32(
                        WASMOperandExpr,
                        WASMOperandType,
                    );
                }
                return this.module.i32.eqz(WASMOperandExpr);
            }
            case ts.SyntaxKind.MinusToken: {
                if (operand.expressionKind === ts.SyntaxKind.NumericLiteral) {
                    const value: number = (<NumberLiteralExpression>operand)
                        .expressionValue;
                    return this.module.f64.const(-value);
                } else {
                    const WASMOperandExpr = this.WASMExprGen(operand);
                    return this.module.f64.sub(
                        this.module.f64.const(0),
                        WASMOperandExpr,
                    );
                }
            }
        }
        return this.module.unreachable();
    }

    WASMConditionalExpr(expr: ConditionalExpression): binaryen.ExpressionRef {
        let condWASMExpr = this.WASMExprGen(expr.condtion);
        const trueWASMExpr = this.WASMExprGen(expr.whenTrue);
        const falseWASMExpr = this.WASMExprGen(expr.whenFalse);
        // TODO: union type
        assert(
            binaryen.getExpressionType(trueWASMExpr) ===
                binaryen.getExpressionType(falseWASMExpr),
            'trueWASMExprType and falseWASMExprType are not equal in conditional expression ',
        );
        const condWASMExprType = binaryen.getExpressionType(condWASMExpr);
        if (condWASMExprType !== binaryen.i32) {
            condWASMExpr = this.convertTypeToI32(
                condWASMExpr,
                condWASMExprType,
            );
        }
        return this.module.select(condWASMExpr, trueWASMExpr, falseWASMExpr);
    }

    WASMCallExpr(expr: CallExpression): binaryen.ExpressionRef {
        const callExpr = expr.callExpr;
        const callWASMArgs = new Array<binaryen.ExpressionRef>();
        // call import functions
        if (callExpr.expressionKind === ts.SyntaxKind.Identifier) {
            const calledFuncName = (<IdentifierExpression>callExpr)
                .identifierName;
            if (isDynFunc(calledFuncName)) {
                for (let i = 0; i < expr.callArgs.length; ++i) {
                    callWASMArgs.push(this.WASMExprGen(expr.callArgs[i]));
                }
                return this.module.call(
                    calledFuncName,
                    callWASMArgs,
                    getReturnTypeRef(calledFuncName),
                );
            }
        }
        callWASMArgs.push(
            binaryenCAPI._BinaryenStructNew(
                this.module.ptr,
                arrayToPtr([]).ptr,
                0,
                emptyStructType.typeRef,
            ),
        );
        for (let i = 0; i !== expr.callArgs.length; ++i) {
            callWASMArgs.push(this.WASMExprGen(expr.callArgs[i]));
        }
        if (callExpr.expressionKind === ts.SyntaxKind.Identifier) {
            const maybeFuncName = (<IdentifierExpression>callExpr)
                .identifierName;
            // iff identifierName is a function name
            if (funcNames.has(maybeFuncName)) {
                const type = this.currentScope.namedTypeMap.get(maybeFuncName);
                if (type === undefined) {
                    throw new Error('type not found, <' + maybeFuncName + '>');
                }
                return this.module.call(
                    maybeFuncName,
                    callWASMArgs,
                    this.wasmType.getWASMFuncReturnType(type),
                );
            } else {
                const variable = this.currentScope.findVariable(maybeFuncName)!;
                const type = variable.varType;
                const wasmType = this.wasmType.getWASMFuncStructType(type);
                const wasmSignatureType = this.wasmType.getWASMType(type);
                // context
                const context = binaryenCAPI._BinaryenStructGet(
                    this.module.ptr,
                    0,
                    this.module.local.get(variable.varIndex, wasmType),
                    wasmType,
                    false,
                );
                const funcref = binaryenCAPI._BinaryenStructGet(
                    this.module.ptr,
                    1,
                    this.module.local.get(variable.varIndex, wasmType),
                    wasmType,
                    false,
                );
                callWASMArgs[0] = context;
                return binaryenCAPI._BinaryenCallRef(
                    this.module.ptr,
                    funcref,
                    arrayToPtr(callWASMArgs).ptr,
                    callWASMArgs.length,
                    wasmSignatureType,
                    false,
                );
            }
        } else if (callExpr.expressionKind === ts.SyntaxKind.CallExpression) {
            // TODO
        }
        return this.module.unreachable();
    }
    WASMArrayLiteralExpr(expr: ArrayLiteralExpression): binaryen.ExpressionRef {
        const module = this.module;
        const arrType = expr.exprType;
        const elements = expr.arrayValues;
        const arrayLen = elements.length;
        const array = [];
        for (let i = 0; i < arrayLen; i++) {
            const elemExpr = elements[i];
            let elemExprRef: binaryen.ExpressionRef;
            if (arrType.kind === TypeKind.ANY) {
                elemExprRef = this.dynValueGen.WASMDynExprGen(elemExpr);
            } else {
                elemExprRef = this.WASMExprGen(elemExpr);
            }
            array.push(elemExprRef);
        }
        const arrayHeapType = this.wasmType.getWASMHeapType(arrType);
        const arrayValue = binaryenCAPI._BinaryenArrayInit(
            module.ptr,
            arrayHeapType,
            arrayToPtr(array).ptr,
            arrayLen,
        );
        return arrayValue;
    }

    WASMObjectLiteralExpr(
        expr: ObjectLiteralExpression,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const objType = <TSClass>expr.exprType;
        // store members and methods seperately
        const propRefList: binaryen.ExpressionRef[] = [binaryen.none];
        const vtable: binaryen.ExpressionRef[] = [];

        const fields = expr.objectFields;
        const values = expr.objectValues;
        const propertyLen = fields.length;
        for (let i = 0; i < propertyLen; i++) {
            const propExpr = values[i];
            const propExprType = propExpr.exprType;
            if (propExprType.kind === TypeKind.FUNCTION) {
                vtable.push(this.WASMExprGen(propExpr));
            } else {
                let propExprRef: binaryen.ExpressionRef;
                if (propExprType.kind === TypeKind.ANY) {
                    propExprRef = this.dynValueGen.WASMDynExprGen(propExpr);
                } else {
                    propExprRef = this.WASMExprGen(propExpr);
                }
                propRefList.push(propExprRef);
            }
        }
        const vtableType = new Type(); // TODO: get wasmType based on objType
        const vtableHeapType = this.wasmType.getWASMHeapType(vtableType);
        const objHeapType = this.wasmType.getWASMHeapType(objType);

        const vptr = binaryenCAPI._BinaryenStructNew(
            module.ptr,
            arrayToPtr(vtable).ptr,
            vtable.length,
            vtableHeapType,
        );
        propRefList[0] = vptr;
        const objectLiteralValue = binaryenCAPI._BinaryenStructNew(
            module.ptr,
            arrayToPtr(propRefList).ptr,
            propRefList.length,
            objHeapType,
        );
        return objectLiteralValue;
    }

    WASMThisExpr(
        expr: ThisExpression,
        isEqualToken = false,
        rightWASMExpr: binaryen.ExpressionRef = binaryen.none,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const scope = <FunctionScope>this.currentScope;
        const classScope = <ClassScope>scope.parent;
        const classType = classScope.classType;
        const wasmRefType = this.wasmType.getWASMType(classType);
        const ref = module.local.get(
            scope.paramArray.length + scope.varArray.length,
            wasmRefType,
        );
        let index = -1;
        for (let i = 0; i !== classType.fields.length; ++i) {
            if (
                classType.fields[i].name ===
                (<IdentifierExpression>expr.propertyExpr).identifierName
            ) {
                index = i;
                break;
            }
        }
        if (index === -1) {
            throw new Error(
                'class field not found, class field name <' +
                    (<IdentifierExpression>expr.propertyExpr).identifierName +
                    '>',
            );
        }
        if (isEqualToken) {
            return binaryenCAPI._BinaryenStructSet(
                module.ptr,
                index + 1,
                ref,
                rightWASMExpr,
            );
        } else {
            return binaryenCAPI._BinaryenStructGet(
                module.ptr,
                index + 1,
                ref,
                wasmRefType,
                false,
            );
        }
    }

    WASMSuperExpr(expr: SuperCallExpression): binaryen.ExpressionRef {
        // must in a constructor
        const module = this.module;
        const scope = <FunctionScope>this.currentScope;
        const classScope = <ClassScope>scope.parent;
        const classType = classScope.classType;
        const baseClassType = <TSClass>classType.getBase();
        const wasmBaseRefHeapType =
            this.wasmType.getWASMHeapType(baseClassType);
        const ref = module.local.get(0, emptyStructType.typeRef);
        const cast = binaryenCAPI._BinaryenRefCast(
            module.ptr,
            ref,
            wasmBaseRefHeapType,
        );
        const wasmArgs = new Array<binaryen.ExpressionRef>();
        wasmArgs.push(cast);
        for (const arg of expr.callArgs) {
            wasmArgs.push(this.WASMExprGen(arg));
        }
        return module.call('', wasmArgs, binaryen.none);
    }

    WASMNewExpr(expr: NewExpression): binaryen.ExpressionRef {
        const type = expr.exprType;
        const module = this.module;
        if (type.typeKind === TypeKind.CLASS) {
            const classType = <TSClass>type;
            const className = classType.className;
            const initStructFields = new Array<binaryen.ExpressionRef>();
            initStructFields.push(this.wasmType.getWASMClassVtable(type));
            const classFields = classType.fields;
            for (const field of classFields) {
                initStructFields.push(this.defaultValue(field.type.kind));
            }
            const newStruct = binaryenCAPI._BinaryenStructNew(
                module.ptr,
                arrayToPtr(initStructFields).ptr,
                initStructFields.length,
                this.wasmType.getWASMHeapType(type),
            );
            const args = new Array<binaryen.ExpressionRef>();
            args.push(newStruct);
            if (expr.NewArgs) {
                for (const arg of expr.NewArgs) {
                    args.push(this.WASMExprGen(arg));
                }
            }
            return this.module.call(
                className + '_constructor',
                args,
                this.wasmType.getWASMType(<Type>classType.classConstructorType),
            );
        }
        return binaryen.none;
    }

    WASMPropertyAccessExpr(
        expr: PropertyAccessExpression,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const objPropAccessExpr = expr.propertyAccessExpr;
        const objExprRef = this.WASMExprGen(objPropAccessExpr);
        const propExpr = expr.propertyExpr;
        const propIdenExpr = <IdentifierExpression>propExpr;
        const propName = propIdenExpr.identifierName;
        if (expr.parentExpr.expressionKind === ts.SyntaxKind.CallExpression) {
            const callExpr = <CallExpression>expr.parentExpr;
            const callArgs = callExpr.callArgs;
            switch (propName) {
                case 'concat': {
                    const strRef = this.WASMExprGen(callArgs[0]);
                    return module.call(
                        BuiltinNames.string_concat_func,
                        [objExprRef, strRef],
                        stringTypeInfo.typeRef,
                    );
                }
                case 'slice': {
                    const startRef = this.WASMExprGen(callArgs[0]);
                    const endRef = this.WASMExprGen(callArgs[1]);
                    return module.call(
                        BuiltinNames.string_slice_func,
                        [
                            objExprRef,
                            this.convertTypeToI32(startRef, binaryen.f64),
                            this.convertTypeToI32(endRef, binaryen.f64),
                        ],
                        stringTypeInfo.typeRef,
                    );
                }
                case 'sqrt': {
                    if (
                        objPropAccessExpr.expressionKind !==
                        ts.SyntaxKind.Identifier
                    ) {
                        throw new Error(
                            'objPropAccessExpr must be an indentifier',
                        );
                    }
                    const objIdenExpr = <IdentifierExpression>objPropAccessExpr;
                    const objName = objIdenExpr.identifierName;
                    if (objName !== 'Math') {
                        throw new Error('objName must be  Math');
                    }
                    const operandRef = this.WASMExprGen(callArgs[0]);
                    return module.f64.sqrt(operandRef);
                }
                default: {
                    // class get method
                    const variable = this.currentScope.findVariable(
                        (<IdentifierExpression>expr.propertyAccessExpr)
                            .identifierName,
                    )!;
                    const wasmArgs = new Array<binaryen.ExpressionRef>();
                    wasmArgs.push(objExprRef);
                    const callExpr = <CallExpression>expr.parentExpr;
                    const callArgs = callExpr.callArgs;
                    for (const arg of callArgs) {
                        wasmArgs.push(this.WASMExprGen(arg));
                    }
                    let type: TSClass | null = <TSClass>variable.varType;
                    while (type !== null) {
                        if (type.getMethod(propName)) {
                            const methodType = <TSFunction>(
                                type.getMethod(propName)
                            );
                            const name = type.className + '_' + propName;
                            return this.module.call(
                                name,
                                wasmArgs,
                                this.wasmType.getWASMFuncReturnType(methodType),
                            );
                        }
                        type = type.getBase();
                    }
                    if (type === null) {
                        throw new Error('method not found, <' + propName + '>');
                    }
                }
            }
        } else {
            const objType = objPropAccessExpr.exprType;
            if (objType.kind === TypeKind.ANY) {
                // judge expression's kind: object, extref, etc
                const isObj = module.call(
                    dyntype.dyntype_is_object,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        objExprRef,
                    ],
                    dyntype.bool,
                );
                const isExtref = module.call(
                    dyntype.dyntype_is_extref,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        objExprRef,
                    ],
                    dyntype.bool,
                );
                if (propName === '__proto__') {
                    return module.if(
                        module.i32.eq(isObj, module.i32.const(1)),
                        module.call(
                            dyntype.dyntype_get_prototype,
                            [
                                module.global.get(
                                    dyntype.dyntype_context,
                                    dyntype.dyn_ctx_t,
                                ),
                                objExprRef,
                            ],
                            dyntype.dyn_value_t,
                        ),
                    );
                }

                // add objValue to current scope
                const objLocalVar = this.generateTmpVar('~obj|', 'any');
                // if expression is obj, then get its property.
                const propNameExprRef = this.generateStringRef(
                    propIdenExpr.identifierName,
                );

                // get property value
                const objHasProp = module.call(
                    dyntype.dyntype_has_property,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        objExprRef,
                        propNameExprRef,
                    ],
                    dyntype.int,
                );
                const propValue = module.call(
                    dyntype.dyntype_get_property,
                    [
                        module.global.get(
                            dyntype.dyntype_context,
                            dyntype.dyn_ctx_t,
                        ),
                        objExprRef,
                        propNameExprRef,
                    ],
                    dyntype.dyn_value_t,
                );

                this.statementArray.push(
                    module.if(
                        module.i32.eq(isObj, module.i32.const(1)),
                        module.if(
                            module.i32.eq(objHasProp, module.i32.const(1)),
                            this.setVariableToCurrentScope(
                                objLocalVar,
                                propValue,
                            ),
                        ),
                    ),
                );

                // if expression is extref, report error since we can't get the prop directly.
                // wait for exception function

                return this.getVariableValue(objLocalVar, binaryen.anyref);
            } else if (objType.kind === TypeKind.STRING) {
                switch (propName) {
                    case 'length': {
                        return module.call(
                            BuiltinNames.string_length_func,
                            [objExprRef],
                            stringTypeInfo.heapTypeRef,
                        );
                    }
                }
            } else if (objType.kind === TypeKind.CLASS) {
                const objClassType = <TSClass>objType;
                const propIndex = objClassType.getMemberFieldIndex(propName);
                const propType = objClassType.getMemberField(propName)!.type;
                const propTypeRef = this.wasmType.getWASMType(propType);
                if (propIndex === -1) {
                    throw new Error(propName + ' property does not exist');
                }
                // vtable will be the first in struct
                return binaryenCAPI._BinaryenStructGet(
                    module.ptr,
                    propIndex + 1,
                    objExprRef,
                    propTypeRef,
                    false,
                );
            }
        }
        return module.unreachable();
    }

    WASMElementAccessExpr(
        expr: ElementAccessExpression,
    ): binaryen.ExpressionRef {
        const module = this.module;
        const accessExpr = expr.accessExpr;
        const argExpr = expr.argExpr;
        const arrayValue = this.WASMExprGen(accessExpr);
        const index = this.convertTypeToI32(
            this.WASMExprGen(argExpr),
            binaryen.f64,
        );
        const arrayType = <TSArray>accessExpr.exprType;
        const elementType = arrayType.elementType;
        const elementValue = binaryenCAPI._BinaryenArrayGet(
            module.ptr,
            arrayValue,
            index,
            this.wasmType.getWASMType(elementType),
            false,
        );
        return elementValue;
    }

    WASMAsExpr(expr: AsExpression): binaryen.ExpressionRef {
        const module = this.module;
        const originObjExpr = <IdentifierExpression>expr.expression;
        const originObjExprRef = this.WASMExprGen(originObjExpr);
        const originObjName = originObjExpr.identifierName;
        const targetType = expr.expression.exprType;
        const isExtref = module.call(
            dyntype.dyntype_is_extref,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                originObjExprRef,
            ],
            dyntype.bool,
        );
        // use 4 bits to store i32;
        const varAndStates = this.generatePointerVar(4);
        const tmpAddressVar = <Variable>varAndStates[0];
        const setTmpAddressExpression = <binaryen.ExpressionRef>varAndStates[1];
        const setTmpGlobalExpression = <binaryen.ExpressionRef>varAndStates[2];
        const resetGlobalExpression = <binaryen.ExpressionRef>varAndStates[3];
        this.statementArray.push(setTmpAddressExpression);
        this.statementArray.push(setTmpGlobalExpression);
        const extrefPointer = this.getVariableValue(
            tmpAddressVar,
            binaryen.i32,
        );
        // get address which stores extref
        const toExtref = module.call(
            dyntype.dyntype_to_extref,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                originObjExprRef,
                extrefPointer,
            ],
            dyntype.bool,
        );
        this.statementArray.push(toExtref);
        const extrefTurnExpression = this.turnDyntypeToExtref(
            originObjExprRef,
            extrefPointer,
            targetType,
        );
        const tmpObjVarInfo = <Variable>extrefTurnExpression[0];
        const extrefExpression = <binaryen.ExpressionRef>(
            extrefTurnExpression[1]
        );

        const turnExtrefToObjExpression = module.if(
            module.i32.eq(isExtref, module.i32.const(1)),
            extrefExpression,
        );
        this.statementArray.push(turnExtrefToObjExpression);
        this.statementArray.push(resetGlobalExpression);
        return this.getVariableValue(
            tmpObjVarInfo,
            this.wasmType.getWASMType(targetType),
        );
    }
}

class WASMDynExpressionGen extends WASMExpressionBase {
    constructor(WASMCompiler: WASMGen) {
        super(WASMCompiler);
    }

    WASMDynExprGen(expr: Expression): binaryen.ExpressionRef {
        this.module = this.wasmCompiler.module;
        this.wasmType = this.wasmCompiler.wasmType;
        this.currentScope = this.wasmCompiler.curScope!;
        this.statementArray = this.wasmCompiler.scopeStateMap.get(
            this.currentScope,
        )!;
        this.staticValueGen = this.wasmCompiler.wasmExprCompiler;
        this.dynValueGen = this.wasmCompiler.wasmDynExprCompiler;
        switch (expr.expressionKind) {
            case ts.SyntaxKind.NumericLiteral:
                return this.generateDynNumber(
                    this.staticValueGen.WASMExprGen(expr),
                );
            case ts.SyntaxKind.FalseKeyword:
            case ts.SyntaxKind.TrueKeyword:
                return this.generateDynBoolean(
                    this.staticValueGen.WASMExprGen(expr),
                );
            case ts.SyntaxKind.StringLiteral:
                return this.generateDynString(
                    this.staticValueGen.WASMExprGen(expr),
                );
            case ts.SyntaxKind.NullKeyword:
                return this.generateDynNull();
            case ts.SyntaxKind.Identifier: {
                const identifierExpr = <IdentifierExpression>expr;
                if (identifierExpr.identifierName === 'undefined') {
                    return this.generateDynUndefined();
                } else {
                    return this.generateDynExtref(
                        this.staticValueGen.WASMExprGen(identifierExpr),
                    );
                }
            }
            case ts.SyntaxKind.BinaryExpression:
                return this.WASMDynBinaryExpr(<BinaryExpression>expr);
            case ts.SyntaxKind.ArrayLiteralExpression:
                return this.WASMDynArrayExpr(<ArrayLiteralExpression>expr);
            case ts.SyntaxKind.ObjectLiteralExpression:
                return this.WASMDynObjExpr(<ObjectLiteralExpression>expr);
            case ts.SyntaxKind.CallExpression:
                return this.staticValueGen.WASMExprGen(expr);
            default:
                throw new Error('unexpected expr kind ' + expr.expressionKind);
        }
    }

    WASMDynBinaryExpr(expr: BinaryExpression): binaryen.ExpressionRef {
        const module = this.module;
        const leftExpr = expr.leftOperand;
        const rightExpr = expr.rightOperand;
        const leftExprType = leftExpr.exprType;
        const rightExprType = rightExpr.exprType;
        const operatorKind = expr.operatorKind;

        if (
            leftExprType.kind === TypeKind.NUMBER &&
            rightExprType.kind === TypeKind.NUMBER
        ) {
            const binaryStaticValue = this.staticValueGen.WASMExprGen(expr);
            return this.generateDynNumber(binaryStaticValue);
        }
        if (
            (leftExprType.kind === TypeKind.NUMBER &&
                rightExprType.kind === TypeKind.BOOLEAN) ||
            (leftExprType.kind === TypeKind.BOOLEAN &&
                rightExprType.kind === TypeKind.NUMBER)
        ) {
            const binaryStaticValue = this.staticValueGen.WASMExprGen(expr);
            const binaryStaticType =
                binaryen.getExpressionType(binaryStaticValue);
            if (binaryStaticType === binaryen.i32) {
                return this.generateDynBoolean(binaryStaticValue);
            } else {
                return this.generateDynNumber(binaryStaticValue);
            }
        }
        if (
            leftExprType.kind === TypeKind.BOOLEAN &&
            rightExprType.kind === TypeKind.BOOLEAN
        ) {
            const binaryStaticValue = this.staticValueGen.WASMExprGen(expr);
            return this.generateDynBoolean(binaryStaticValue);
        }
        if (
            leftExprType.kind === TypeKind.ANY &&
            rightExprType.kind === TypeKind.ANY
        ) {
            return this.operateAnyAny(
                this.staticValueGen.WASMExprGen(leftExpr),
                this.staticValueGen.WASMExprGen(rightExpr),
                operatorKind,
            );
        }
        return module.unreachable();
    }

    WASMDynArrayExpr(expr: ArrayLiteralExpression): binaryen.ExpressionRef {
        // generate empty any array
        const arrayValue = this.generateDynArray();
        // TODO: generate more array details
        return arrayValue;
    }

    WASMDynObjExpr(expr: ObjectLiteralExpression): binaryen.ExpressionRef {
        const module = this.module;
        const fields = expr.objectFields;
        const values = expr.objectValues;
        const propertyLen = fields.length;

        // generate empty any obj
        const objValue = this.generateDynObj();
        // add objValue to current scope, push assign statement
        const objLocalVar = this.generateTmpVar('~obj|', 'any');
        const objLocalVarType = objLocalVar.varType;
        const objLocalVarWasmType =
            this.wasmType.getWASMHeapType(objLocalVarType);
        this.statementArray.push(
            this.setVariableToCurrentScope(objLocalVar, objValue),
        );
        // set obj's properties
        for (let i = 0; i < propertyLen; i++) {
            const propNameExpr = fields[i];
            const propNameExprRef = this.generateStringRef(
                propNameExpr.identifierName,
            );
            const propValueExpr = values[i];
            const propValueExprRef = this.WASMDynExprGen(propValueExpr);
            const setPropertyExpression = module.call(
                dyntype.dyntype_set_property,
                [
                    module.global.get(
                        dyntype.dyntype_context,
                        dyntype.dyn_ctx_t,
                    ),
                    this.getLocalValue(
                        objLocalVar.varIndex,
                        objLocalVarWasmType,
                    ),
                    propNameExprRef,
                    propValueExprRef,
                ],
                dyntype.int,
            );
            this.statementArray.push(setPropertyExpression);
        }
        return this.getVariableValue(objLocalVar, objLocalVarWasmType);
    }

    generateDynNumber(dynValue: binaryen.ExpressionRef) {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_number,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                dynValue,
            ],
            dyntype.dyn_value_t,
        );
    }

    generateDynBoolean(dynValue: binaryen.ExpressionRef) {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_boolean,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                dynValue,
            ],
            dyntype.dyn_value_t,
        );
    }

    generateDynString(dynValue: binaryen.ExpressionRef) {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_string,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                dynValue,
            ],
            dyntype.dyn_value_t,
        );
    }

    generateDynNull() {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_null,
            [module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t)],
            dyntype.dyn_value_t,
        );
    }

    generateDynUndefined() {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_undefined,
            [module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t)],
            dyntype.dyn_value_t,
        );
    }

    generateDynArray() {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_array,
            [module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t)],
            dyntype.dyn_value_t,
        );
    }

    generateDynObj() {
        const module = this.module;
        return module.call(
            dyntype.dyntype_new_object,
            [module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t)],
            dyntype.dyn_value_t,
        );
    }

    generateDynExtref(dynValue: binaryen.ExpressionRef) {
        const module = this.module;
        // cast obj ref type to ref ${}
        const objTarget = binaryenCAPI._BinaryenRefCast(
            module.ptr,
            dynValue,
            objectStructTypeInfo.heapTypeRef,
        );
        // put table index into a local
        const tmpTableIndexVar = this.generateTmpVar('~tableIdx|', 'boolean');
        const setTableIdxExpr = this.setVariableToCurrentScope(
            tmpTableIndexVar,
            module.table.size(BuiltinNames.obj_table),
        );
        this.statementArray.push(setTableIdxExpr);
        const tableCurIndex = this.getVariableValue(
            tmpTableIndexVar,
            binaryen.i32,
        );
        const tableGrowExpr = module.table.grow(
            BuiltinNames.obj_table,
            objTarget,
            module.i32.const(1),
        );
        this.statementArray.push(module.drop(tableGrowExpr));
        const varAndStates = this.generatePointerVar(4);
        const tmpAddressVar = <Variable>varAndStates[0];
        const setTmpAddressExpression = <binaryen.ExpressionRef>varAndStates[1];
        const setTmpGlobalExpression = <binaryen.ExpressionRef>varAndStates[2];
        const tmpAddressValue = <binaryen.ExpressionRef>varAndStates[4];
        this.statementArray.push(setTmpAddressExpression);
        this.statementArray.push(setTmpGlobalExpression);
        const storeIdxExpression = module.i32.store(
            0,
            4,
            tmpAddressValue,
            tableCurIndex,
        );
        this.statementArray.push(storeIdxExpression);
        const numberPointer = this.getVariableValue(
            tmpAddressVar,
            binaryen.i32,
        );
        return module.call(
            dyntype.dyntype_new_extref,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                numberPointer,
                dyntype.ExtObj,
            ],
            dyntype.dyn_value_t,
        );
    }

    turnDyntypeToNumber(
        expression: binaryen.ExpressionRef,
        tmpAddressVar: Variable,
    ) {
        const module = this.module;
        const numberPointer = this.getVariableValue(
            tmpAddressVar,
            binaryen.i32,
        );
        const expressionToNumber = module.call(
            dyntype.dyntype_to_number,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                expression,
                numberPointer,
            ],
            dyntype.int,
        );
        const tmpNumber = module.f64.load(
            0,
            8,
            this.getVariableValue(tmpAddressVar, binaryen.i32),
        );
        const tmpNumberVar = this.generateTmpVar('~number|', 'number');

        const setNumberExpression = this.setVariableToCurrentScope(
            tmpNumberVar,
            tmpNumber,
        );
        const numberExpression = module.if(
            module.i32.eq(expressionToNumber, dyntype.DYNTYPE_SUCCESS),
            setNumberExpression,
        );
        return [tmpNumberVar, numberExpression];
    }

    oprateF64F64ToDyn(
        leftNumberExpression: binaryen.ExpressionRef,
        rightNumberExpression: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
        tmpTotalNumberVar: Variable,
    ) {
        // operate left expression and right expression
        const operateTotalNumber = this.operateF64F64(
            leftNumberExpression,
            rightNumberExpression,
            operatorKind,
        );
        // add tmp total number value to current scope
        this.addVariableToCurrentScope(tmpTotalNumberVar);
        const setTotalNumberExpression = this.setVariableToCurrentScope(
            tmpTotalNumberVar,
            this.generateDynNumber(operateTotalNumber),
        );
        return setTotalNumberExpression;
    }

    operateAnyAny(
        leftExprRef: binaryen.ExpressionRef,
        rightExprRef: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        const module = this.module;
        const dynEq = module.call(
            dyntype.dyntype_type_eq,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                leftExprRef,
                rightExprRef,
            ],
            dyntype.bool,
        );
        const dynTypeIsNumber = module.call(
            dyntype.dyntype_is_number,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                leftExprRef,
            ],
            dyntype.bool,
        );

        // address corresponding to binaryen.i32
        const varAndStates = this.generatePointerVar(8);
        const tmpAddressVar = <Variable>varAndStates[0];
        const setTmpAddressExpression = <binaryen.ExpressionRef>varAndStates[1];
        const setTmpGlobalExpression = <binaryen.ExpressionRef>varAndStates[2];
        const resetGlobalExpression = <binaryen.ExpressionRef>varAndStates[3];

        const leftTrunExpression = this.turnDyntypeToNumber(
            leftExprRef,
            tmpAddressVar,
        );
        const rightTrunExpression = this.turnDyntypeToNumber(
            rightExprRef,
            tmpAddressVar,
        );
        const tmpLeftNumberVar = <Variable>leftTrunExpression[0];
        const leftNumberExpression = <binaryen.ExpressionRef>(
            leftTrunExpression[1]
        );
        const tmpRightNumberVar = <Variable>rightTrunExpression[0];
        const rightNumberExpression = <binaryen.ExpressionRef>(
            rightTrunExpression[1]
        );

        const tmpTotalNumberName = this.getTmpVariableName('~numberTotal|');
        const tmpTotalNumberVar: Variable = new Variable(
            tmpTotalNumberName,
            this.currentScope!.namedTypeMap.get('any')!,
            ModifierKind.default,
            0,
        );

        const setTotalNumberExpression = this.oprateF64F64ToDyn(
            this.getVariableValue(tmpLeftNumberVar, binaryen.f64),
            this.getVariableValue(tmpRightNumberVar, binaryen.f64),
            operatorKind,
            tmpTotalNumberVar,
        );

        // add statements to a block
        const getNumberArray: binaryen.ExpressionRef[] = [];
        getNumberArray.push(setTmpAddressExpression);
        getNumberArray.push(setTmpGlobalExpression);
        getNumberArray.push(leftNumberExpression);
        getNumberArray.push(resetGlobalExpression);
        getNumberArray.push(setTmpAddressExpression);
        getNumberArray.push(setTmpGlobalExpression);
        getNumberArray.push(rightNumberExpression);
        getNumberArray.push(resetGlobalExpression);
        getNumberArray.push(setTotalNumberExpression);

        const anyOperation = module.if(
            module.i32.eq(dynEq, dyntype.bool_true),
            module.if(
                module.i32.eq(dynTypeIsNumber, dyntype.bool_true),
                module.block('getNumber', getNumberArray),
            ),
        );
        // store the external operations into currentScope's statementArray
        this.statementArray.push(anyOperation);

        return this.getVariableValue(tmpTotalNumberVar, binaryen.anyref);
    }
}

class WASMStatementGen {
    private scope2stmts: Map<Scope, binaryen.ExpressionRef[]>;

    constructor(private WASMCompiler: WASMGen) {
        this.scope2stmts = this.WASMCompiler.scopeStateMap;
    }

    WASMStmtGen(stmt: Statement): binaryen.ExpressionRef {
        const stmts = this.scope2stmts.get(<Scope>this.WASMCompiler.curScope);
        const scope = <Scope>this.WASMCompiler.curScope;
        switch (stmt.statementKind) {
            case ts.SyntaxKind.IfStatement: {
                const ifStmt = this.WASMIfStmt(<IfStatement>stmt);
                if (stmts) {
                    stmts.push(ifStmt);
                }
                return ifStmt;
            }
            case ts.SyntaxKind.Block: {
                const blockStmt = this.WASMBlock(<BlockStatement>stmt);
                // if (stmts && scope.kind !== ScopeKind.FunctionScope) {
                //     stmts.push(blockStmt);
                // }
                return blockStmt;
            }
            case ts.SyntaxKind.ReturnStatement: {
                const returnStmt = this.WASMReturnStmt(<ReturnStatement>stmt);
                if (stmts) {
                    stmts.push(returnStmt);
                }
                return returnStmt;
            }
            case ts.SyntaxKind.EmptyStatement: {
                const emptyStmt = this.WASMEmptyStmt();
                if (stmts) {
                    stmts.push(emptyStmt);
                }
                return emptyStmt;
            }
            case ts.SyntaxKind.WhileStatement:
            case ts.SyntaxKind.DoStatement: {
                const loopStmt = this.WASMBaseLoopStmt(<BaseLoopStatement>stmt);
                if (stmts) {
                    stmts.push(loopStmt);
                }
                return loopStmt;
            }
            case ts.SyntaxKind.ForStatement: {
                const forStmt = this.WASMForStmt(<ForStatement>stmt);
                if (stmts) {
                    stmts.push(forStmt);
                }
                return forStmt;
            }
            case ts.SyntaxKind.SwitchStatement: {
                const switchStmt = this.WASMSwitchStmt(<SwitchStatement>stmt);
                if (stmts) {
                    stmts.push(switchStmt);
                }
                return switchStmt;
            }
            case ts.SyntaxKind.BreakStatement: {
                const breakStmt = this.WASMBreakStmt(<BreakStatement>stmt);
                if (stmts) {
                    stmts.push(breakStmt);
                }
                return breakStmt;
            }
            case ts.SyntaxKind.ExpressionStatement: {
                const exprStmt = this.WASMExpressionStmt(
                    <ExpressionStatement>stmt,
                );
                if (stmts) {
                    stmts.push(exprStmt);
                }
                return exprStmt;
            }
            default:
                break;
        }
        return binaryen.unreachable;
    }

    WASMIfStmt(stmt: IfStatement): binaryen.ExpressionRef {
        const wasmCond: binaryen.ExpressionRef =
            this.WASMCompiler.wasmExpr.WASMExprGen(stmt.ifCondition);
        const wasmIfTrue: binaryen.ExpressionRef = this.WASMStmtGen(
            stmt.ifIfTrue,
        );
        if (stmt.ifIfFalse === null) {
            return this.WASMCompiler.module.if(wasmCond, wasmIfTrue);
        } else {
            const wasmIfFalse: binaryen.ExpressionRef = this.WASMStmtGen(
                stmt.ifIfFalse,
            );
            return this.WASMCompiler.module.if(
                wasmCond,
                wasmIfTrue,
                wasmIfFalse,
            );
        }
    }

    WASMBlock(stmt: BlockStatement): binaryen.ExpressionRef {
        /* scope is a function scope or a block scope */
        let scope = stmt.getScope();
        const prevScope = this.WASMCompiler.curScope;
        if (scope !== null) {
            this.WASMCompiler.setCurScope(scope);
            this.scope2stmts.set(scope, new Array<binaryen.ExpressionRef>());
        }
        scope = this.WASMCompiler.curScope;
        if (scope === null) {
            throw new Error('current scope is null');
        }
        for (const blockStmt of stmt.statements) {
            /* add wasm statements to current scope */
            this.WASMStmtGen(blockStmt);
        }

        /* iff BlockStatement belongs to a function or member function, insertWASMCode !== [binaryen.none] */
        const insertWASMCode = [binaryen.none];
        if (stmt.getScope() === null) {
            const module = this.WASMCompiler.module;
            const funcScope = <FunctionScope>this.WASMCompiler.curFunctionScope;
            // iff it's a member function
            if (funcScope.className !== '') {
                const classScope = <ClassScope>funcScope.parent;
                const classType = classScope.classType;
                const wasmRefHeapType =
                    this.WASMCompiler.wasmType.getWASMHeapType(classType);
                const cast = binaryenCAPI._BinaryenRefCast(
                    module.ptr,
                    module.local.get(0, emptyStructType.typeRef),
                    wasmRefHeapType,
                );
                insertWASMCode[0] = module.local.set(
                    funcScope.paramArray.length + funcScope.varArray.length + 1,
                    cast,
                );
            } else {
                // iff it's a function
                // 1. get parent level function context
                const closureVars = new Array<binaryen.ExpressionRef>();
                let ctxValue = module.local.get(0, emptyStructType.typeRef);
                if (
                    funcScope.parent !== null &&
                    funcScope.parent.kind === ScopeKind.FunctionScope
                ) {
                    const parentLevelFunction = <FunctionScope>funcScope.parent;
                    const contextType = (<typeInfo>(
                        WASMGen.contextOfFunc.get(parentLevelFunction)
                    )).typeRef;
                    // TODO: maybe not always need to cast
                    ctxValue = binaryenCAPI._BinaryenRefCast(
                        module.ptr,
                        ctxValue,
                        contextType,
                    );
                }
                closureVars.push(ctxValue);
                for (const param of funcScope.paramArray) {
                    if (param.varIsClosure) {
                        closureVars.push(
                            module.local.get(
                                param.varIndex,
                                this.WASMCompiler.wasmType.getWASMType(
                                    param.varType,
                                ),
                            ),
                        );
                    }
                }
                for (const vari of funcScope.varArray) {
                    if (vari.varIsClosure) {
                        closureVars.push(
                            module.local.get(
                                vari.varIndex,
                                this.WASMCompiler.wasmType.getWASMType(
                                    vari.varType,
                                ),
                            ),
                        );
                    }
                }
                const selfCtx =
                    closureVars.length > 1
                        ? binaryenCAPI._BinaryenStructNew(
                              module.ptr,
                              arrayToPtr(closureVars).ptr,
                              closureVars.length,
                              (<typeInfo>WASMGen.contextOfFunc.get(funcScope))
                                  .heapTypeRef,
                          )
                        : closureVars[0];
                insertWASMCode[0] = module.local.set(
                    funcScope.paramArray.length + funcScope.varArray.length + 1,
                    selfCtx,
                );
            }
        }
        const wasmBlockStmts = this.scope2stmts.get(scope);
        if (wasmBlockStmts === undefined) {
            throw new Error(
                'Not found corresponding binaryen statements in scope, scope kind is <' +
                    scope.kind +
                    '>',
            );
        }
        if (prevScope !== null) {
            this.WASMCompiler.setCurScope(prevScope);
        }
        return this.WASMCompiler.module.block(
            null,
            insertWASMCode[0] === binaryen.none
                ? wasmBlockStmts
                : insertWASMCode.concat(wasmBlockStmts),
        );
    }

    WASMReturnStmt(stmt: ReturnStatement): binaryen.ExpressionRef {
        if (stmt.returnExpression === null) {
            return this.WASMCompiler.module.return();
        } else {
            const WASMReturnExpr: binaryen.ExpressionRef =
                this.WASMCompiler.wasmExpr.WASMExprGen(stmt.returnExpression);
            return this.WASMCompiler.module.return(WASMReturnExpr);
        }
    }

    WASMEmptyStmt(): binaryen.ExpressionRef {
        return this.WASMCompiler.module.nop();
    }

    WASMBaseLoopStmt(stmt: BaseLoopStatement): binaryen.ExpressionRef {
        this.WASMCompiler.setCurScope(stmt.getScope() as Scope);
        const WASMCond: binaryen.ExpressionRef =
            this.WASMCompiler.wasmExpr.WASMExprGen(stmt.loopCondtion);
        const WASMStmts: binaryen.ExpressionRef = this.WASMStmtGen(
            stmt.loopBody,
        );
        // (block $break
        //  (loop $loop_label
        //   ...
        //   (if cond
        //    ...
        //    (br $loop_label)
        //   )
        //  )
        // )
        const flattenLoop: FlattenLoop = {
            label: stmt.loopLabel,
            condition: WASMCond,
            statements: WASMStmts,
        };
        return this.WASMCompiler.module.block(stmt.loopBlockLabel, [
            this.WASMCompiler.module.loop(
                stmt.loopLabel,
                this.flattenLoopStatement(flattenLoop, stmt.statementKind),
            ),
        ]);
    }

    WASMForStmt(stmt: ForStatement): binaryen.ExpressionRef {
        this.WASMCompiler.setCurScope(stmt.getScope() as Scope);
        const scope = stmt.getScope() as Scope;

        let WASMCond: binaryen.ExpressionRef = this.WASMCompiler.module.nop();
        let WASMIncrementor: binaryen.ExpressionRef =
            this.WASMCompiler.module.nop();
        let WASMStmts: binaryen.ExpressionRef = this.WASMCompiler.module.nop();
        if (stmt.forLoopInitializer !== null) {
            /* add stmt.forLoopInitializer to corresponding scope, not need its return value */
            this.WASMStmtGen(stmt.forLoopInitializer);
        }
        if (stmt.forLoopCondtion !== null) {
            WASMCond = this.WASMCompiler.wasmExpr.WASMExprGen(
                stmt.forLoopCondtion,
            );
        }
        if (stmt.forLoopIncrementor !== null) {
            WASMIncrementor = this.WASMCompiler.wasmExpr.WASMExprGen(
                stmt.forLoopIncrementor,
            );
        }
        if (stmt.forLoopBody !== null) {
            WASMStmts = this.WASMStmtGen(stmt.forLoopBody);
        }
        const flattenLoop: FlattenLoop = {
            label: stmt.forLoopLabel,
            condition: WASMCond,
            statements: WASMStmts,
            incrementor: WASMIncrementor,
        };
        const stmts = this.scope2stmts.get(scope);
        if (stmts === undefined) {
            throw new Error(
                'Not found corresponding binaryen statements array in scope',
            );
        }
        stmts.push(
            this.WASMCompiler.module.loop(
                stmt.forLoopLabel,
                this.flattenLoopStatement(flattenLoop, stmt.statementKind),
            ),
        );
        return this.WASMCompiler.module.block(stmt.forLoopBlockLabel, stmts);
    }

    WASMSwitchStmt(stmt: SwitchStatement): binaryen.ExpressionRef {
        const WASMCond: binaryen.ExpressionRef =
            this.WASMCompiler.wasmExpr.WASMExprGen(stmt.switchCondition);
        // switch
        //   |
        // CaseBlock
        //   |
        // [Clauses]
        return this.WASMCaseBlockStmt(
            <CaseBlock>stmt.switchCaseBlock,
            WASMCond,
        );
    }

    WASMCaseBlockStmt(
        stmt: CaseBlock,
        condtion: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        this.WASMCompiler.setCurScope(stmt.getScope() as Scope);
        const clauses = stmt.caseCauses;
        if (clauses.length === 0) {
            return this.WASMCompiler.module.nop();
        }
        const module = this.WASMCompiler.module;
        const branches: binaryen.ExpressionRef[] = new Array(clauses.length);
        let indexOfDefault = -1;
        let idx = 0;
        clauses.forEach((clause, i) => {
            if (clause.statementKind === ts.SyntaxKind.DefaultClause) {
                indexOfDefault = i;
            } else {
                const caseCause = <CaseClause>clause;
                branches[idx++] = module.br(
                    'case' + i + stmt.switchLabel,
                    module.f64.eq(
                        condtion,
                        this.WASMCompiler.wasmExpr.WASMExprGen(
                            caseCause.caseExpr,
                        ),
                    ),
                );
            }
        });
        const default_label =
            indexOfDefault === -1
                ? stmt.breakLabel
                : 'case' + indexOfDefault + stmt.switchLabel;
        branches[idx] = module.br(default_label);

        let block = module.block('case0' + stmt.switchLabel, branches);
        for (let i = 0; i !== clauses.length; ++i) {
            const clause = <CaseClause | DefaultClause>clauses[i];
            const label =
                i === clauses.length - 1
                    ? stmt.breakLabel
                    : 'case' + (i + 1) + stmt.switchLabel;
            block = module.block(
                label,
                [block].concat(this.WASMClauseStmt(clause)),
            );
        }

        return block;
    }

    WASMClauseStmt(clause: CaseClause | DefaultClause): binaryen.ExpressionRef {
        this.WASMCompiler.setCurScope(clause.getScope() as Scope);
        const scope = clause.getScope() as Scope;
        for (const statement of clause.caseStatements) {
            this.WASMStmtGen(statement);
        }
        const stmts = this.scope2stmts.get(scope);
        if (stmts === undefined) {
            throw new Error(
                'Not found corresponding binaryen statements array in cause scope',
            );
        }
        return this.WASMCompiler.module.block(null, stmts);
    }

    WASMBreakStmt(stmt: BreakStatement): binaryen.ExpressionRef {
        return this.WASMCompiler.module.br(stmt.breakLabel);
    }

    WASMExpressionStmt(stmt: ExpressionStatement): binaryen.ExpressionRef {
        const innerExpr = stmt.expression;
        return this.WASMCompiler.wasmExpr.WASMExprGen(innerExpr);
    }

    flattenLoopStatement(
        loopStatementInfo: FlattenLoop,
        kind: ts.SyntaxKind,
    ): binaryen.ExpressionRef {
        const ifStatementInfo: IfStatementInfo = {
            condition: loopStatementInfo.condition,
            ifTrue: binaryen.none,
            ifFalse: binaryen.none,
        };
        if (kind !== ts.SyntaxKind.DoStatement) {
            const ifTrueBlockArray: binaryen.ExpressionRef[] = [];
            if (loopStatementInfo.statements !== binaryen.none) {
                ifTrueBlockArray.push(loopStatementInfo.statements);
            }
            if (kind === ts.SyntaxKind.ForStatement) {
                ifTrueBlockArray.push(
                    <binaryen.ExpressionRef>loopStatementInfo.incrementor,
                );
            }
            ifTrueBlockArray.push(
                this.WASMCompiler.module.br(loopStatementInfo.label),
            );
            const ifTrueBlock = this.WASMCompiler.module.block(
                null,
                ifTrueBlockArray,
            );
            ifStatementInfo.ifTrue = ifTrueBlock;
            return this.WASMCompiler.module.if(
                ifStatementInfo.condition,
                ifStatementInfo.ifTrue,
            );
        } else {
            ifStatementInfo.ifTrue = this.WASMCompiler.module.br(
                loopStatementInfo.label,
            );
            const blockArray: binaryen.ExpressionRef[] = [];
            if (loopStatementInfo.statements !== binaryen.none) {
                blockArray.push(loopStatementInfo.statements);
            }
            const ifExpression = this.WASMCompiler.module.if(
                ifStatementInfo.condition,
                ifStatementInfo.ifTrue,
            );
            blockArray.push(ifExpression);
            return this.WASMCompiler.module.block(null, blockArray);
        }
    }
}

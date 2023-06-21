/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import ts from 'typescript';
import { ParserContext } from './frontend.js';
import {
    BlockScope,
    ClassScope,
    ClosureEnvironment,
    FunctionScope,
    GlobalScope,
    NamespaceScope,
    Scope,
    ScopeKind,
} from './scope.js';
import { Parameter, Variable } from './variable.js';
import { Expression } from './expression.js';
import { Logger } from './log.js';
import { adjustPrimitiveNodeType } from './utils.js';
import { UnimplementError } from './error.js';
import { BuiltinNames } from '../lib/builtin/builtin_name.js';

export const enum TypeKind {
    VOID = 'void',
    BOOLEAN = 'boolean',
    NUMBER = 'number',
    ANY = 'any',
    UNDEFINED = 'undefined',
    STRING = 'string',
    ARRAY = 'array',
    FUNCTION = 'function',
    CLASS = 'class',
    ENUM = 'enum',
    NULL = 'null',
    INTERFACE = 'interface',
    UNION = 'unoin',

    WASM_I32 = 'i32',
    WASM_I64 = 'i64',
    WASM_F32 = 'f32',
    WASM_F64 = 'f64',
    WASM_ANYREF = 'anyref',

    GENERIC = 'generic',
    UNKNOWN = 'unknown',

    CONTEXT = 'context',
    TYPE_PARAMETER = 'type_parameter',
}

export class Type {
    protected typeKind = TypeKind.UNKNOWN;
    isPrimitive = false;
    isWasmType = false;

    get kind(): TypeKind {
        return this.typeKind;
    }

    toString(): string {
        return `TYPE(${this.typeKind})`;
    }

    get isDeclare(): boolean {
        return false;
    }
}

export class WasmType extends Type {
    name: string;

    constructor(private type: string) {
        super();
        this.name = type;
        this.isWasmType = true;
        switch (type) {
            case 'i32': {
                this.typeKind = TypeKind.WASM_I32;
                break;
            }
            case 'i64': {
                this.typeKind = TypeKind.WASM_I64;
                break;
            }
            case 'f32': {
                this.typeKind = TypeKind.WASM_F32;
                break;
            }
            case 'f64': {
                this.typeKind = TypeKind.WASM_F64;
                break;
            }
            case 'anyref': {
                this.typeKind = TypeKind.WASM_ANYREF;
                break;
            }
            default: {
                this.typeKind = TypeKind.UNKNOWN;
                break;
            }
        }
    }

    public getName(): string {
        return this.name;
    }
}

export class GenericType extends Type {
    constructor() {
        super();
        this.typeKind = TypeKind.GENERIC;
    }
}

export class Primitive extends Type {
    constructor(private type: string) {
        super();
        this.isPrimitive = true;
        switch (type) {
            case 'number': {
                this.typeKind = TypeKind.NUMBER;
                break;
            }
            case 'string': {
                this.typeKind = TypeKind.STRING;
                break;
            }
            case 'boolean': {
                this.typeKind = TypeKind.BOOLEAN;
                break;
            }
            case 'any': {
                this.typeKind = TypeKind.ANY;
                break;
            }
            case 'undefined': {
                this.typeKind = TypeKind.UNDEFINED;
                break;
            }
            case 'void': {
                this.typeKind = TypeKind.VOID;
                break;
            }
            case 'null': {
                this.typeKind = TypeKind.NULL;
                break;
            }
            default: {
                this.typeKind = TypeKind.UNKNOWN;
            }
        }
    }
}

export class TSContext extends Type {
    constructor(
        public parentCtxType?: TSContext,
        public freeVarTypeList: Type[] = [],
    ) {
        super();
        this.typeKind = TypeKind.CONTEXT;
    }

    toString(): string {
        const typeName = 'ContextType';
        if (this.parentCtxType) {
            typeName.concat('_');
            typeName.concat(this.parentCtxType.toString());
        }
        for (const freeVarType of this.freeVarTypeList) {
            typeName.concat('_');
            typeName.concat(freeVarType.toString());
        }
        return typeName;
    }
}

export const builtinTypes = new Map<string, Type>([
    ['number', new Primitive('number')],
    ['string', new Primitive('string')],
    ['boolean', new Primitive('boolean')],
    ['any', new Primitive('any')],
    ['undefined', new Primitive('undefined')],
    ['void', new Primitive('void')],
    ['null', new Primitive('null')],
    ['undefined', new Primitive('undefined')],
    ['generic', new GenericType()],
]);

export const builtinWasmTypes = new Map<string, WasmType>([
    ['i32', new WasmType('i32')],
    ['f32', new WasmType('f32')],
    ['i64', new WasmType('i64')],
    ['f64', new WasmType('f64')],
    ['anyref', new WasmType('anyref')],
]);

// type for template
export class TSTypeParameter extends Type {
    typeKind = TypeKind.TYPE_PARAMETER;
    private _name: string; // the name of TypeParameter
    private _wide: Type; // the wide type of this type parameter
    private _default?: Type; // the default type of this type parameter
    private _index: number; // the declaration index, important!

    constructor(name: string, wide: Type, index: number, def?: Type) {
        super();
        this._name = name;
        this._wide = wide;
        this._index = index;
        this._default = def;
    }

    get name(): string {
        return this._name;
    }

    get wideType(): Type {
        return this._wide;
    }

    get index(): number {
        return this._index;
    }

    get defaultType(): Type | undefined {
        return this._default;
    }

    toString(): string {
        return `TypeParameter(${this._name} wide:${this._wide} default: ${this._default})`;
    }
}

export interface TsClassField {
    name: string;
    type: Type;
    modifier?: 'readonly';
    visibility?: 'public' | 'protected' | 'private';
    static?: 'static';
}

export const enum FunctionKind {
    DEFAULT = 'default',
    CONSTRUCTOR = 'constructor',
    METHOD = 'method',
    GETTER = 'getter',
    SETTER = 'setter',
    STATIC = 'static',
}

export function getMethodPrefix(kind: FunctionKind): string {
    switch (kind) {
        case FunctionKind.CONSTRUCTOR:
            return 'constructor';
        case FunctionKind.GETTER:
            return 'get_';
        case FunctionKind.SETTER:
            return 'set_';
        default:
            return '';
    }
}

export interface TsClassFunc {
    name: string;
    type: TSFunction;
}

export interface ClassMethod {
    index: number;
    method: TsClassFunc | null;
}

export class TSTypeWithArguments extends Type {
    private _typeArguments?: TSTypeParameter[];

    constructor() {
        super();
    }

    get typeArguments(): TSTypeParameter[] | undefined {
        return this._typeArguments;
    }

    addTypeParameter(type: TSTypeParameter) {
        if (!this._typeArguments) this._typeArguments = [];

        this._typeArguments.push(type); // ignore the index
    }

    setTypeParameters(types: TSTypeParameter[] | undefined) {
        this._typeArguments = types;
    }

    getTypeParameter(name: string): TSTypeParameter | undefined {
        if (this._typeArguments) {
            const param = this._typeArguments.find((p) => p.name == name);
            if (param) return param;
        }
        return undefined;
    }
}

export class TSClass extends TSTypeWithArguments {
    typeKind = TypeKind.CLASS;
    private _typeId = 0;
    private _name = '';
    private _mangledName = '';
    private _memberFields: Array<TsClassField> = [];
    private _staticFields: Array<TsClassField> = [];
    private _methods: Array<TsClassFunc> = [];
    private _baseClass: TSClass | null = null;
    private _isLiteral = false;
    private _ctor: TSFunction | null = null;
    public hasDeclareCtor = true;
    private _isDeclare = false;

    private _numberIndexType?: Type;
    private _stringIndexType?: Type;

    public staticFieldsInitValueMap: Map<number, Expression> = new Map();
    /* override or own methods */
    public overrideOrOwnMethods: Set<string> = new Set();

    constructor() {
        super();
        this.typeKind = TypeKind.CLASS;
    }

    toString(): string {
        return `Class(${this._name}(${this._mangledName} ${
            this._isLiteral ? 'Literanl' : ''
        }))`;
    }

    get fields(): Array<TsClassField> {
        return this._memberFields;
    }

    get staticFields(): TsClassField[] {
        return this._staticFields;
    }

    get memberFuncs(): Array<TsClassFunc> {
        return this._methods;
    }

    set ctorType(ctor: TSFunction) {
        this._ctor = ctor;
    }

    get ctorType(): TSFunction {
        return this._ctor!;
    }

    get isDeclare(): boolean {
        return this._isDeclare;
    }

    set isDeclare(value: boolean) {
        this._isDeclare = value;
    }

    get numberIndexType(): Type | undefined {
        return this._numberIndexType;
    }

    setNumberIndexType(type: Type) {
        this._numberIndexType = type;
    }

    get stringIndexType(): Type | undefined {
        return this._stringIndexType;
    }

    setStringIndexType(type: Type) {
        this._stringIndexType = type;
    }

    setBase(base: TSClass): void {
        this._baseClass = base;
    }

    getBase(): TSClass | null {
        return this._baseClass;
    }

    addMemberField(memberField: TsClassField): void {
        this._memberFields.push(memberField);
    }

    getMemberField(name: string): TsClassField | null {
        return (
            this._memberFields.find((f) => {
                return f.name === name;
            }) || null
        );
    }

    getMemberFieldIndex(name: string): number {
        return this._memberFields.findIndex((f) => {
            return f.name === name;
        });
    }

    addStaticMemberField(memberField: TsClassField): void {
        this._staticFields.push(memberField);
    }

    getStaticMemberField(name: string): TsClassField | null {
        return (
            this._staticFields.find((f) => {
                return f.name === name;
            }) || null
        );
    }

    getStaticFieldIndex(name: string): number {
        return this._staticFields.findIndex((f) => {
            return f.name === name;
        });
    }

    addMethod(classMethod: TsClassFunc): void {
        classMethod.type.isMethod = true;
        this._methods.push(classMethod);
    }

    getMethod(
        name: string,
        kind: FunctionKind = FunctionKind.METHOD,
    ): ClassMethod {
        const res = this.memberFuncs.findIndex((f) => {
            return name === f.name && kind === f.type.funcKind;
        });
        if (res !== -1) {
            return { index: res, method: this.memberFuncs[res] };
        }
        return { index: -1, method: null };
    }

    setClassName(name: string) {
        this._name = name;
    }

    get className(): string {
        return this._name;
    }

    get mangledName(): string {
        return this._mangledName;
    }

    set mangledName(name: string) {
        this._mangledName = name;
    }

    setTypeId(id: number) {
        this._typeId = id;
    }

    get typeId() {
        return this._typeId;
    }

    set isLiteral(b: boolean) {
        this._isLiteral = b;
    }

    get isLiteral(): boolean {
        return this._isLiteral;
    }
}

export class TSInterface extends TSClass {
    constructor() {
        super();
        this.typeKind = TypeKind.INTERFACE;
    }
}

export class TSArray extends Type {
    constructor(private _elemType: Type) {
        super();
        this.typeKind = TypeKind.ARRAY;
    }

    get elementType(): Type {
        return this._elemType;
    }

    toString(): string {
        return `Array<${this._elemType}>`;
    }
}

export class TSFunction extends TSTypeWithArguments {
    typeKind = TypeKind.FUNCTION;
    private _parameterTypes: Type[] = [];
    private _isOptionalParams: boolean[] = [];
    private _returnType: Type = new Primitive('void');
    // iff last parameter is rest paremeter
    private _restParamIdex = -1;
    private _isMethod = false;
    private _isDeclare = false;
    private _isStatic = false;
    private _isBinaryenImpl = false;
    private _isExport = false;
    public envParamLen = 0;

    toString(): string {
        const s: string[] = [];
        this._parameterTypes.forEach((t) => s.push(t.toString()));
        return `Function(${s.join(',')})${this._returnType}`;
    }

    constructor(public funcKind: FunctionKind = FunctionKind.DEFAULT) {
        super();
        this.typeKind = TypeKind.FUNCTION;
    }

    set returnType(type: Type) {
        this._returnType = type;
    }

    get returnType(): Type {
        return this._returnType;
    }

    addParamType(paramType: Type) {
        this._parameterTypes.push(paramType);
    }

    setParamTypes(paramTypes: Type[]) {
        this._parameterTypes = paramTypes;
    }

    getParamTypes(): Type[] {
        return this._parameterTypes;
    }

    addIsOptionalParam(isOptional: boolean) {
        this._isOptionalParams.push(isOptional);
    }

    get isOptionalParams() {
        return this._isOptionalParams;
    }

    set restParamIdx(idx: number) {
        this._restParamIdex = idx;
    }

    get restParamIdx() {
        return this._restParamIdex;
    }

    hasRest() {
        return this._restParamIdex >= 0;
    }

    get isMethod() {
        return this._isMethod;
    }

    set isMethod(value: boolean) {
        this._isMethod = value;
    }

    get isDeclare(): boolean {
        return this._isDeclare;
    }

    set isDeclare(value: boolean) {
        this._isDeclare = value;
    }

    get isBinaryenImpl() {
        return this._isBinaryenImpl;
    }

    set isBinaryenImpl(value: boolean) {
        this._isBinaryenImpl = value;
    }

    get isStatic() {
        return this._isStatic;
    }

    set isStatic(value: boolean) {
        this._isStatic = value;
    }

    get isExport() {
        return this._isExport;
    }

    set isExport(value: boolean) {
        this._isExport = value;
    }

    // shadow copy, content of parameterTypes and returnType is not copied
    public clone(): TSFunction {
        const func = new TSFunction(this.funcKind);
        func.returnType = this.returnType;
        func._parameterTypes = this._parameterTypes;
        func._isOptionalParams = this._isOptionalParams;
        func._restParamIdex = this._restParamIdex;
        func.isMethod = this.isMethod;
        func.isDeclare = this.isDeclare;
        func.isStatic = this.isStatic;
        func.envParamLen = this.envParamLen;
        func.setTypeParameters(this.typeArguments);
        return func;
    }
}

export class TSUnion extends Type {
    typeKind = TypeKind.UNION;
    _types: Type[] = [];

    constructor() {
        super();
    }

    get types(): Array<Type> {
        return this._types;
    }

    addType(type: Type) {
        this._types.push(type);
    }

    toString(): string {
        const s: string[] = [];
        this._types.forEach((t) => s.push(t.toString()));
        return `Union(${s.join(' | ')})`;
    }
}

const MixEnumMemberType: Type = (function () {
    const union = new TSUnion();
    union.addType(builtinTypes.get('number')!);
    union.addType(builtinTypes.get('string')!);
    return union;
})();

export class TSEnum extends Type {
    typeKind = TypeKind.ENUM;
    private _name: string;
    private _memberType: Type = builtinTypes.get('undefined')!;
    private _members: Map<string, number | string> = new Map();

    constructor(name: string) {
        super();
        this._name = name;
    }

    get name(): string {
        return this._name;
    }

    get memberType(): Type {
        return this._memberType;
    }

    addMember(name: string, value: number | string) {
        if (this._members.has(name)) {
            throw Error(`EnumMember exist: ${name}`);
        }
        this._members.set(name, value);
        if (this._memberType.kind == TypeKind.UNDEFINED) {
            if (typeof value == 'string') {
                this._memberType = builtinTypes.get('string')!;
            } else {
                this._memberType = builtinTypes.get('number')!;
            }
        } else if (
            (this._memberType.kind == TypeKind.STRING &&
                typeof value != 'string') ||
            (this._memberType.kind == TypeKind.NUMBER &&
                typeof value != 'number')
        ) {
            this._memberType = MixEnumMemberType;
        }
    }

    getMember(name: string): number | string | undefined {
        return this._members.get(name);
    }

    get members(): Map<string, number | string> {
        return this._members;
    }

    toString(): string {
        let i = 0;
        let s = '';
        this._members.forEach((v, k) => {
            if (i < 4) {
                s += k + ',';
                i++;
            } else if (i == 4) {
                s = s + '...';
            }
        });

        return `Enum(${s})`;
    }
}

export class TypeResolver {
    typechecker: ts.TypeChecker | undefined = undefined;
    globalScopes: Array<GlobalScope>;
    currentScope: Scope | null = null;
    nodeScopeMap: Map<ts.Node, Scope>;
    // cache class shape layout string, <class name, type string>
    methodShapeStr = new Map<string, string>();
    fieldShapeStr = new Map<string, string>();
    // cache node & type
    /*
       e.g : interface Array<T> {
               ...
               filter(predicate: (value: T, index: number, array: T[]) => boolean): T[];
               ..
             }

       if some code:
       ```
             arr.filter((value, indx, arr) => { ... });
       ```
       when build 'arr.filter' in src/expression.ts build PropertyAccessExpression:
       ```
           propAccessExpr.setExprType(
                this.typeResolver.generateNodeType(node),   <--- node is 'arr.filter'
           );
       ```
        TypeResolver try to parse the type of 'arr.filter', call generateNodeType:
       ```
           let tsType = this.typechecker!.getTypeAtLocation(node);
       ```
       the 'tsType' is AST of 'filter(predicate: (value: T, index: number, array: T[]) => boolean): T[]'

       But, 'T' is defined in 'Array<T>', 'T' cannot be resolved becasue generateNodeType lost the context of 'Array';

       So, We must cache the 'node' and 'type' in 'nodeTypeCache', so that,
       TypeResolve just parse the type when it's declared, don't need to parse it EVERYTIME.
     */
    nodeTypeCache = new Map<ts.Node, Type>();
    // for TypeParameter
    /*
        interface Array<T> {
           ....
            map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[];
           ...
        }

        T is type of interface
        U is type of map
        the parameter callbackfn use T & U
        we must put the owner of T, U into the typeParameterStack,
        so that callbackfn can find them
     */
    typeParameterStack: TSTypeWithArguments[] = [];

    constructor(private parserCtx: ParserContext) {
        this.nodeScopeMap = this.parserCtx.nodeScopeMap;
        this.globalScopes = this.parserCtx.globalScopes;
    }

    visit() {
        this.typechecker = this.parserCtx.typeChecker;
        this.nodeScopeMap.forEach((scope, node) => {
            ts.forEachChild(node, this.visitNode.bind(this));
        });
    }

    private visitNode(node: ts.Node): void {
        this.currentScope = this.parserCtx.getScopeByNode(node)!;

        switch (node.kind) {
            case ts.SyntaxKind.VariableDeclaration:
            case ts.SyntaxKind.Parameter:
            case ts.SyntaxKind.FunctionDeclaration:
            case ts.SyntaxKind.FunctionExpression:
            case ts.SyntaxKind.ArrowFunction: {
                const type = this.generateNodeType(node);
                this.addTypeToTypeMap(type, node);
                break;
            }
            case ts.SyntaxKind.ClassDeclaration: {
                const type = this.parseClassDecl(node as ts.ClassDeclaration);
                this.addTypeToTypeMap(type, node);
                break;
            }
            case ts.SyntaxKind.InterfaceDeclaration: {
                const type = this.parseInfcDecl(
                    node as ts.InterfaceDeclaration,
                );
                this.addTypeToTypeMap(type, node);
                //break;
                return; // dno't visit it's children, parseInfDecl do all things
            }
            case ts.SyntaxKind.UnionType: {
                const type = this.parseUnionTypeNode(node as ts.UnionTypeNode);
                this.addTypeToTypeMap(type, node);
                break;
            }
            case ts.SyntaxKind.EnumDeclaration: {
                const type = this.parseEnumType(node as ts.EnumDeclaration);
                this.addTypeToTypeMap(type, node);
                break;
            }
        }
        ts.forEachChild(node, this.visitNode.bind(this));
    }

    private addTypeToTypeMap(type: Type, node: ts.Node) {
        let tsTypeString = this.typechecker!.typeToString(
            this.typechecker!.getTypeAtLocation(node),
        );

        const maybeWasmType = TypeResolver.maybeBuiltinWasmType(node);
        if (maybeWasmType) {
            tsTypeString = maybeWasmType.getName();
        }

        if (
            this.currentScope!.kind === ScopeKind.FunctionScope &&
            type.kind === TypeKind.FUNCTION &&
            ts.isFunctionLike(node)
        ) {
            (<FunctionScope>this.currentScope!).setFuncType(type as TSFunction);
        }
        if (ts.isClassDeclaration(node)) {
            this.currentScope!.parent!.addType(tsTypeString, type);
            if (this.currentScope! instanceof ClassScope) {
                this.currentScope!.setClassType(type as TSClass);
            }
        } else {
            this.currentScope!.addType(tsTypeString, type);
        }
    }

    generateNodeType(node: ts.Node): Type {
        const cached_type = this.nodeTypeCache.get(node);
        if (cached_type) return cached_type;

        if (ts.isConstructorDeclaration(node)) {
            return this.parseSignature(
                this.typechecker!.getSignatureFromDeclaration(node)!,
            );
        }

        if (node.kind == ts.SyntaxKind.ConstructSignature) {
            return this.parseSignature(
                this.typechecker!.getSignatureFromDeclaration(
                    node as ts.ConstructSignatureDeclaration,
                )!,
            );
        }
        /* Resolve wasm specific type */
        const maybeWasmType = TypeResolver.maybeBuiltinWasmType(node);
        if (maybeWasmType) {
            return maybeWasmType;
        }

        let tsType = this.typechecker!.getTypeAtLocation(node);
        if ('isThisType' in tsType && (tsType as any).isThisType) {
            /* For "this" keyword, tsc will inference the actual type */
            tsType = this.typechecker!.getDeclaredTypeOfSymbol(tsType.symbol);
        }
        let type = this.tsTypeToType(tsType);
        type = adjustPrimitiveNodeType(type, node, this.currentScope)!;
        /* for example, a: string[] = new Array(), the type of new Array() should be string[]
         instead of any[]*/
        if (type instanceof TSArray) {
            const parentNode = node.parent;
            if (
                ts.isVariableDeclaration(parentNode) ||
                ts.isBinaryExpression(parentNode) ||
                ts.isPropertyDeclaration(parentNode)
            ) {
                type = this.generateNodeType(parentNode);
            }
            if (
                ts.isNewExpression(parentNode) ||
                ts.isArrayLiteralExpression(parentNode)
            ) {
                type = (<TSArray>this.generateNodeType(parentNode)).elementType;
            }
        }

        this.nodeTypeCache.set(node, type);
        return type;
    }

    public tsTypeToType(type: ts.Type): Type {
        const typeFlag = type.flags;
        // basic types
        if (
            typeFlag & ts.TypeFlags.Number ||
            typeFlag & ts.TypeFlags.NumberLiteral
        ) {
            return builtinTypes.get('number')!;
        }
        if (
            typeFlag & ts.TypeFlags.String ||
            typeFlag & ts.TypeFlags.StringLiteral
        ) {
            return builtinTypes.get('string')!;
        }
        if (
            typeFlag & ts.TypeFlags.Boolean ||
            typeFlag & ts.TypeFlags.BooleanLiteral
        ) {
            return builtinTypes.get('boolean')!;
        }
        if (typeFlag & ts.TypeFlags.Void) {
            return builtinTypes.get('void')!;
        }
        if (typeFlag & ts.TypeFlags.Any) {
            return builtinTypes.get('any')!;
        }
        if (typeFlag & ts.TypeFlags.Undefined) {
            return builtinTypes.get('undefined')!;
        }
        if (typeFlag & ts.TypeFlags.Null) {
            return builtinTypes.get('null')!;
        }
        if (typeFlag & ts.TypeFlags.TypeParameter) {
            const type_name = type.symbol.getName();
            for (let i = this.typeParameterStack.length - 1; i >= 0; i--) {
                const typeWithArgs = this.typeParameterStack[i];
                const type = typeWithArgs.getTypeParameter(type_name);
                if (type) return type;
            }

            const type_param = this.currentScope!.findType(type_name);
            if (!type_param || type_param.kind != TypeKind.TYPE_PARAMETER) {
                throw Error(
                    `Cannot find the type ${type_name} or it isn't a TypeParameter (${type_param})`,
                );
            }
            return type_param!;
            //return builtinTypes.get('generic')!;
        }
        // union type ==> type of first elem, iff all types are same, otherwise, any
        if (type.isUnion()) {
            if (this.parserCtx.compileArgs.buildWASM) {
                const nodeTypeArray = type.types.map((elem) => {
                    return this.tsTypeToType(elem);
                });
                let res = builtinTypes.get('any')!;
                // iff there is at least one null type
                if (nodeTypeArray.find((type) => type.kind === TypeKind.NULL)) {
                    const nonNullTypes = nodeTypeArray.filter(
                        (type) => type.kind !== TypeKind.NULL,
                    );
                    // iff A | null => ref.null A, otherwise => any
                    if (
                        nonNullTypes.length > 0 &&
                        nonNullTypes.every(
                            (type) => type === nonNullTypes[0],
                        ) &&
                        !nonNullTypes[0].isPrimitive
                    ) {
                        res = nonNullTypes[0];
                    }
                } else {
                    if (
                        nodeTypeArray.every((type) => type === nodeTypeArray[0])
                    ) {
                        res = nodeTypeArray[0];
                    }
                }
                return res;
            } else {
                const typeArray = type.types.map((elem) => {
                    return this.tsTypeToType(elem);
                });
                // iff there is at least one null type
                if (typeArray.find((type) => type.kind === TypeKind.NULL)) {
                    const nonNullTypes = typeArray.filter(
                        (type) => type.kind !== TypeKind.NULL,
                    );
                    // iff Class | null => Class, otherwise => UnionType
                    if (
                        nonNullTypes.length == 1 &&
                        nonNullTypes[0] instanceof TSClass
                    ) {
                        return nonNullTypes[0];
                    }
                } else {
                    // iff all types are same
                    if (typeArray.every((type) => type === typeArray[0])) {
                        return typeArray[0];
                    }
                }
                return this.parseUnionType(type as ts.UnionType);
            }
        }
        // sophisticated types
        //               object
        //           /    \         \
        // typereference objliteral function
        //    / \
        // array class/infc

        // iff array type
        if (this.isArray(type)) {
            if (!type.typeArguments) {
                throw new Error('array type has no type arguments');
            }
            const elemType = this.tsTypeToType(type.typeArguments![0]);
            return new TSArray(elemType);
        }
        // iff class/infc
        if (this.isTypeReference(type) || this.isInterface(type)) {
            const decl = type.symbol.declarations![0];
            const tsType = this.nodeTypeCache.get(decl);
            if (!tsType) {
                throw new Error(
                    `class/interface not found, type name <${type.symbol.name}>. `,
                );
            }
            return tsType;
        }

        // iff object literal type
        if (this.isObjectLiteral(type)) {
            const decl = type.symbol.declarations![0];
            const cached_type = this.nodeTypeCache.get(decl);
            if (cached_type) return cached_type;

            const tsClass = new TSClass();
            tsClass.setClassName(this.generateObjectLiteralName());
            tsClass.isLiteral = true;
            this.nodeTypeCache.set(decl, tsClass);
            const methodTypeStrs: string[] = [];
            const fieldTypeStrs: string[] = [];
            type.getProperties().map((prop) => {
                const propertyKind = prop.valueDeclaration!.kind;
                let property: ts.PropertyAssignment | ts.MethodDeclaration;
                if (propertyKind === ts.SyntaxKind.PropertyAssignment) {
                    property = prop.valueDeclaration as ts.PropertyAssignment;
                } else if (propertyKind === ts.SyntaxKind.MethodDeclaration) {
                    property = prop.valueDeclaration as ts.MethodDeclaration;
                } else {
                    throw new UnimplementError(
                        `unImplement propertyKind ${propertyKind} in objLiteral`,
                    );
                }
                const propType = this.typechecker!.getTypeAtLocation(property);
                let typeString = this.typeToString(property);
                // ts.Type's intrinsicName is `true` or `false`, instead of `boolean`
                if (typeString === 'true' || typeString === 'false') {
                    typeString = 'boolean';
                }
                const propName = prop.name;
                const tsType = this.tsTypeToType(propType);
                /* functionType in objLiteral will always have 2 envParams */
                // TODO: set objLiteral's envParamLen here, add a wrapper method in backend
                // if (tsType instanceof TSFunction) {
                //     tsType.envParamLen = 2;
                // }
                if (ts.isMethodDeclaration(property)) {
                    tsClass.addMethod({
                        name: propName,
                        type: tsType as TSFunction,
                    });
                    methodTypeStrs.push(`${propName}: ${typeString}`);
                } else {
                    tsClass.addMemberField({
                        name: propName,
                        type: tsType,
                    });
                    fieldTypeStrs.push(`${propName}: ${typeString}`);
                }
            });
            const typeString =
                methodTypeStrs.join(', ') + ', ' + fieldTypeStrs.join(', ');
            tsClass.setTypeId(this.generateTypeId(typeString));
            Logger.info(
                `Assign type id [${tsClass.typeId}] for object literal type: ${typeString}`,
            );
            return tsClass;
        }

        // iff function type
        if (this.isFunction(type)) {
            const signature = type.getCallSignatures()[0];
            return this.parseSignature(signature);
        }

        Logger.debug(`Encounter un-processed type: ${type.flags}`);
        /* cases have not been considered or covered yet... */
        return new Type();
    }

    private isObject(type: ts.Type): type is ts.ObjectType {
        return !!(type.flags & ts.TypeFlags.Object);
    }

    private isTypeReference(type: ts.Type): type is ts.TypeReference {
        return (
            this.isObject(type) &&
            !!(type.objectFlags & ts.ObjectFlags.Reference)
        );
    }

    private isInterface(type: ts.Type): type is ts.InterfaceType {
        return (
            this.isObject(type) &&
            !!(type.objectFlags & ts.ObjectFlags.Interface)
        );
    }

    private isObjectLiteral(type: ts.Type) {
        return this.isObject(type) && type.symbol.name === '__object';
    }

    private isArray(type: ts.Type): type is ts.TypeReference {
        return this.isTypeReference(type) && type.symbol.name === 'Array';
    }

    private isFunction(type: ts.Type): type is ts.ObjectType {
        if (this.isObject(type)) {
            return type.getCallSignatures().length > 0;
        }
        return false;
    }

    private parseSignature(signature: ts.Signature | undefined) {
        if (!signature) {
            throw new Error('signature is undefined');
        }

        const cached_type = this.nodeTypeCache.get(signature.getDeclaration());
        if (cached_type) return cached_type as TSFunction;

        const tsFunction = new TSFunction();

        /* parse modifiers */
        tsFunction.isDeclare = signature.declaration
            ? this.parseNestDeclare(
                  <
                      | ts.FunctionLikeDeclaration
                      | ts.ModuleDeclaration
                      | ts.ClassDeclaration
                  >signature.declaration,
              )
            : false;

        tsFunction.isStatic = signature.declaration
            ? this.parseStatic(
                  <ts.FunctionLikeDeclaration>signature.declaration,
              )
            : false;

        tsFunction.isBinaryenImpl = !!signature.declaration?.modifiers?.find(
            (modifier) =>
                modifier.kind === ts.SyntaxKind.Decorator &&
                (<ts.Decorator>modifier).expression.getText() ===
                    BuiltinNames.decorator,
        );

        tsFunction.isExport = !!signature.declaration?.modifiers?.find(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        );

        tsFunction.isMethod = !!(
            signature.declaration &&
            ((
                signature.declaration as
                    | ts.ConstructSignatureDeclaration
                    | ts.MethodSignature
                    | ts.ConstructorDeclaration
                    | ts.MethodDeclaration
            ).kind === ts.SyntaxKind.ConstructSignature ||
                (
                    signature.declaration as
                        | ts.ConstructSignatureDeclaration
                        | ts.MethodSignature
                        | ts.ConstructorDeclaration
                        | ts.MethodDeclaration
                ).kind === ts.SyntaxKind.MethodSignature ||
                (
                    signature.declaration as
                        | ts.ConstructSignatureDeclaration
                        | ts.MethodSignature
                        | ts.ConstructorDeclaration
                        | ts.MethodDeclaration
                ).kind === ts.SyntaxKind.Constructor ||
                (
                    signature.declaration as
                        | ts.ConstructSignatureDeclaration
                        | ts.MethodSignature
                        | ts.ConstructorDeclaration
                        | ts.MethodDeclaration
                ).kind === ts.SyntaxKind.MethodDeclaration)
        );

        /* get env type length: @context & @this */
        let envTypeLen = 1;
        if (tsFunction.isMethod && !tsFunction.isStatic) {
            envTypeLen++;
        }
        tsFunction.envParamLen = envTypeLen;

        /* parse original parameters type */
        this.typeParameterStack.push(tsFunction);
        // TODO check currentScope is right
        this.parseTypeParameters(
            tsFunction,
            signature.getDeclaration(),
            this.currentScope &&
                this.currentScope!.kind == ScopeKind.FunctionScope
                ? this.currentScope
                : null,
        );

        signature.getParameters().map((param, index) => {
            const valueDecl = param.valueDeclaration!;
            if (ts.isParameter(valueDecl) && valueDecl.dotDotDotToken) {
                /* restParamIdx should include the @context and @this */
                tsFunction.restParamIdx = index;
            }
            if (ts.isParameter(valueDecl) && valueDecl.questionToken) {
                tsFunction.addIsOptionalParam(true);
            } else {
                tsFunction.addIsOptionalParam(false);
            }
            let tsType = this.tsTypeToType(
                this.typechecker!.getTypeAtLocation(valueDecl),
            );

            /* builtin wasm types */
            const maybeWasmType = TypeResolver.maybeBuiltinWasmType(valueDecl);
            if (maybeWasmType) {
                tsType = maybeWasmType;
            }

            tsFunction.addParamType(tsType);
        });

        /* parse return type */
        const returnType =
            this.typechecker!.getReturnTypeOfSignature(signature);
        if (
            !signature.declaration ||
            !ts.isConstructorDeclaration(signature.declaration)
        ) {
            tsFunction.returnType = this.tsTypeToType(returnType);
        }

        this.typeParameterStack.pop();
        this.nodeTypeCache.set(signature.getDeclaration(), tsFunction);
        return tsFunction;
    }

    private parseNestDeclare(
        node:
            | ts.FunctionLikeDeclaration
            | ts.ModuleDeclaration
            | ts.ClassDeclaration
            | ts.InterfaceDeclaration,
    ): boolean {
        let res = false;
        if (node.modifiers) {
            const hasDeclareKeyword = node.modifiers.find((modifier) => {
                return modifier.kind === ts.SyntaxKind.DeclareKeyword;
            });
            if (hasDeclareKeyword) {
                return true;
            }
        }
        if (node.parent.kind === ts.SyntaxKind.ModuleBlock) {
            res = this.parseNestDeclare(
                <ts.ModuleDeclaration>node.parent.parent,
            );
        } else if (node.parent.kind === ts.SyntaxKind.ClassDeclaration) {
            res = this.parseNestDeclare(<ts.ModuleDeclaration>node.parent);
        }
        return res;
    }

    private parseStatic(node: ts.FunctionLikeDeclaration): boolean {
        let res = false;
        if (node.modifiers) {
            const hasStaticKeyword = node.modifiers.find((modifier) => {
                return modifier.kind === ts.SyntaxKind.StaticKeyword;
            });
            if (hasStaticKeyword) {
                res = true;
            }
        }
        return res;
    }

    private parseClassDecl(node: ts.ClassDeclaration): TSClass {
        const classType = new TSClass();
        this.nodeTypeCache.set(node, classType);
        classType.setClassName(node.name!.getText());
        let methodTypeStrs: string[] = [];
        let fieldTypeStrs: string[] = [];

        this.parseTypeParameters(classType, node, this.currentScope);
        this.typeParameterStack.push(classType);

        classType.isDeclare = this.parseNestDeclare(node);

        const heritage = node.heritageClauses;
        let baseType: TSClass | null = null;
        if (
            heritage !== undefined &&
            heritage[0].token !== ts.SyntaxKind.ImplementsKeyword
        ) {
            /* base class node, iff it really has the one */
            const heritageName = heritage[0].types[0].getText();

            const scope = this.currentScope!;
            // TODO try resolve the template type
            const heritageType = <TSClass>scope.findType(heritageName);
            classType.setBase(heritageType);
            methodTypeStrs = this.methodShapeStr
                .get(heritageType.className)!
                .split(', ');
            fieldTypeStrs = this.fieldShapeStr
                .get(heritageType.className)!
                .split(', ');

            baseType = heritageType;
            for (const field of heritageType.fields) {
                classType.addMemberField(field);
            }
            for (const pair of heritageType.staticFieldsInitValueMap) {
                classType.staticFieldsInitValueMap.set(pair[0], pair[1]);
            }
            for (const staticField of heritageType.staticFields) {
                classType.addStaticMemberField(staticField);
            }
            for (const method of heritageType.memberFuncs) {
                classType.addMethod(method);
            }
        }
        // 1. parse constructor
        const constructor = node.members.find((member) => {
            return ts.isConstructorDeclaration(member);
        });
        let ctorScope: FunctionScope;
        let ctorType: TSFunction;
        // iff not, add a default constructor
        const defaultCtor = this.currentScope!.children.find((child) => {
            if (child instanceof FunctionScope) {
                return child.funcName === 'constructor';
            }
            return false;
        });
        if (!constructor) {
            if (defaultCtor) {
                ctorScope = <FunctionScope>defaultCtor;
                ctorType = ctorScope.funcType;
            } else {
                /* create scope & type manually */
                ctorScope = new FunctionScope(this.currentScope!);
                ctorType = new TSFunction(FunctionKind.CONSTRUCTOR);
                ctorScope.setFuncName('constructor');
                ctorScope.setClassName(node.name!.getText());
                ctorType.isMethod = true;
                /* insert params, variables, types */
                ctorType.envParamLen = 2;
                ctorScope.envParamLen = 2;
                ctorScope.addVariable(new Variable('this', classType));
                classType.hasDeclareCtor = false;
                if (baseType) {
                    const baseCtorType = baseType.ctorType;
                    const paramTypes = baseCtorType.getParamTypes();
                    for (let i = 0; i < paramTypes.length; i++) {
                        ctorType.addParamType(paramTypes[i]);
                        ctorScope.addParameter(
                            new Parameter(`@anonymous${i}`, paramTypes[i]),
                        );
                    }
                }
            }
        } else {
            const func = <ts.ConstructorDeclaration>constructor;
            ctorType = this.generateNodeType(func) as TSFunction;
            ctorScope =
                <FunctionScope>this.parserCtx.getScopeByNode(func) || undefined;
        }
        ctorType.returnType = classType;
        ctorType.funcKind = FunctionKind.CONSTRUCTOR;
        ctorScope.setFuncType(ctorType);
        classType.ctorType = ctorType;

        // 2. parse other fields
        for (const member of node.members) {
            if (ts.isSemicolonClassElement(member)) {
                /* ES6 allows Semicolon as class elements, we just skip them */
                continue;
            }
            const name = ts.isConstructorDeclaration(member)
                ? 'constructor'
                : member.name!.getText();

            const typeString = this.typeToString(member);
            if (member.kind === ts.SyntaxKind.PropertyDeclaration) {
                const field = <ts.PropertyDeclaration>member;
                const type = this.generateNodeType(field);
                const modifier = field.modifiers?.find((m) => {
                    return m.kind === ts.SyntaxKind.ReadonlyKeyword;
                })
                    ? 'readonly'
                    : undefined;
                const staticModifier = field.modifiers?.find((m) => {
                    return m.kind === ts.SyntaxKind.StaticKeyword;
                })
                    ? 'static'
                    : undefined;
                const classField: TsClassField = {
                    name: name,
                    type: type,
                    modifier: modifier,
                    visibility: 'public',
                    static: staticModifier,
                };
                if (field.initializer) {
                    let index = classType.getStaticFieldIndex(name);
                    if (index === -1) {
                        index = classType.staticFields.length;
                    }
                    if (classField.static) {
                        classType.staticFieldsInitValueMap.set(
                            index,
                            this.parserCtx.expressionProcessor.visitNode(
                                field.initializer,
                            ),
                        );
                    } else {
                        ctorScope.addStatement(
                            this.parserCtx.statementProcessor.createFieldAssignStmt(
                                field.initializer,
                                classType,
                                type,
                                name,
                            ),
                        );
                    }
                }
                if (!classField.static) {
                    fieldTypeStrs.push(`${name}: ${typeString}`);
                }
                if (
                    classType.getMemberField(name) ||
                    classType.getStaticMemberField(name)
                ) {
                    continue;
                }
                if (!classField.static) {
                    classType.addMemberField(classField);
                } else {
                    classType.addStaticMemberField(classField);
                }
            }
            if (member.kind === ts.SyntaxKind.SetAccessor) {
                const func = <ts.SetAccessorDeclaration>member;
                methodTypeStrs.push(`${name}: ${typeString}`);
                this.setMethod(func, baseType, classType, FunctionKind.SETTER);
            }
            if (member.kind === ts.SyntaxKind.GetAccessor) {
                const func = <ts.GetAccessorDeclaration>member;
                methodTypeStrs.push(`${name}: ${typeString}`);
                this.setMethod(func, baseType, classType, FunctionKind.GETTER);
            }
            if (member.kind === ts.SyntaxKind.MethodDeclaration) {
                const func = <ts.MethodDeclaration>member;
                const kind = func.modifiers?.find((m) => {
                    return m.kind === ts.SyntaxKind.StaticKeyword;
                })
                    ? FunctionKind.STATIC
                    : FunctionKind.METHOD;
                methodTypeStrs.push(`${name}: ${typeString}`);
                this.setMethod(func, baseType, classType, kind);
            }
        }

        const methodType = methodTypeStrs.join(', ');
        const fieldType = fieldTypeStrs.join(', ');
        this.methodShapeStr.set(classType.className, methodType);
        this.fieldShapeStr.set(classType.className, fieldType);
        const typeString = methodType + ', ' + fieldType;
        classType.setTypeId(this.generateTypeId(typeString));
        Logger.info(
            `Assign type id [${classType.typeId}] for class [${classType.className}], type string: ${typeString}`,
        );
        this.typeParameterStack.pop();
        return classType;
    }

    private parseIndexSignature(
        infc: TSInterface,
        indexSignature: ts.IndexSignatureDeclaration,
    ) {
        const param_type = indexSignature.parameters[0];
        const key_type = this.tsTypeToType(
            this.typechecker!.getTypeFromTypeNode(param_type.type!),
        );
        const value_type = this.tsTypeToType(
            this.typechecker!.getTypeFromTypeNode(indexSignature.type),
        );
        if (
            key_type.kind !== TypeKind.NUMBER &&
            key_type.kind !== TypeKind.STRING
        ) {
            throw Error(
                `${infc.className} indexSignature need number or string : ${key_type}`,
            );
        }
        if (key_type.kind === TypeKind.NUMBER) {
            infc.setNumberIndexType(value_type);
        } else {
            infc.setStringIndexType(value_type);
        }
        Logger.debug(
            `=== ${infc.className} index type [${key_type}] : ${value_type}`,
        );
    }

    private parseInfcDecl(node: ts.InterfaceDeclaration): TSInterface {
        const infc = new TSInterface();
        this.nodeTypeCache.set(node, infc);
        infc.setClassName(node.name!.getText());
        const methodTypeStrs: string[] = [];
        const fieldTypeStrs: string[] = [];

        this.parseTypeParameters(infc, node, this.currentScope);
        this.typeParameterStack.push(infc);

        infc.isDeclare = this.parseNestDeclare(node);

        node.members.map((member) => {
            if (member.kind == ts.SyntaxKind.IndexSignature) {
                this.parseIndexSignature(
                    infc,
                    member as ts.IndexSignatureDeclaration,
                );
                return;
            }
            /** Currently, we only handle PropertySignature and MethodSignature */
            if (
                member.kind !== ts.SyntaxKind.ConstructSignature &&
                member.kind !== ts.SyntaxKind.PropertySignature &&
                member.kind !== ts.SyntaxKind.MethodSignature &&
                member.kind !== ts.SyntaxKind.GetAccessor &&
                member.kind !== ts.SyntaxKind.SetAccessor
            ) {
                return;
            }
            let fieldType = this.generateNodeType(member);
            const typeString = this.typeToString(member);
            let funcKind =
                member.kind == ts.SyntaxKind.ConstructSignature
                    ? FunctionKind.CONSTRUCTOR
                    : FunctionKind.METHOD;
            if (ts.isSetAccessor(member)) {
                const type = new TSFunction();
                type.addParamType(fieldType);
                fieldType = type;
                funcKind = FunctionKind.SETTER;
                this.parseTypeParameters(
                    type,
                    member as ts.DeclarationWithTypeParameters,
                    null,
                );
            }
            if (ts.isGetAccessor(member)) {
                const type = new TSFunction(FunctionKind.GETTER);
                type.returnType = fieldType;
                fieldType = type;
                funcKind = FunctionKind.GETTER;
                this.parseTypeParameters(
                    type,
                    member as ts.DeclarationWithTypeParameters,
                    null,
                );
            }
            const fieldName =
                funcKind == FunctionKind.CONSTRUCTOR
                    ? 'constructor'
                    : member.name!.getText();
            if (fieldType instanceof TSFunction) {
                fieldType.funcKind = funcKind;
                infc.addMethod({
                    name: fieldName,
                    type: fieldType,
                });
                methodTypeStrs.push(`${fieldName}: ${typeString}`);
                this.parseTypeParameters(
                    fieldType as TSFunction,
                    member as ts.DeclarationWithTypeParameters,
                    null,
                );
                infc.overrideOrOwnMethods.add(fieldName);
            } else {
                infc.addMemberField({
                    name: fieldName,
                    type: fieldType,
                });
                fieldTypeStrs.push(`${fieldName}: ${typeString}`);
            }
        });
        const typeString =
            methodTypeStrs.join(', ') + ', ' + fieldTypeStrs.join(', ');
        infc.setTypeId(this.generateTypeId(typeString));
        Logger.info(
            `Assign type id [${infc.typeId}] for interface(${infc.className}): ${typeString}`,
        );

        this.typeParameterStack.pop();
        return infc;
    }

    private parseUnionTypeNode(unionType: ts.UnionTypeNode): Type {
        return this.parseUnionType(
            this.typechecker!.getTypeFromTypeNode(unionType) as ts.UnionType,
        );
    }

    private parseUnionType(type: ts.UnionType): Type {
        const union_type = new TSUnion();

        if (!type.types) {
            return builtinTypes.get('any')!;
        }

        for (const tstype of type.types) {
            union_type.addType(this.tsTypeToType(tstype));
        }

        const types = union_type.types;
        if (types.every((type) => type === types[0])) {
            return types[0];
        }

        // T | null will be treated as nullable T type
        if (types.find((type) => type.kind === TypeKind.NULL)) {
            const nonNullTypes = types.filter(
                (type) => type.kind !== TypeKind.NULL,
            );
            if (
                nonNullTypes.length > 0 &&
                nonNullTypes.every((type) => type === nonNullTypes[0]) &&
                !nonNullTypes[0].isPrimitive
            ) {
                return nonNullTypes[0];
            }
        }

        return union_type;
    }

    private generateTypeId(typeString: string): number {
        if (this.parserCtx.typeIdMap.has(typeString)) {
            return this.parserCtx.typeIdMap.get(typeString)!;
        }
        const id = this.parserCtx.typeIdMap.size;
        this.parserCtx.typeIdMap.set(typeString, id);
        return id;
    }

    private generateObjectLiteralName(): string {
        const id = this.parserCtx.typeIdMap.size;
        const name = `@object_literal${id}`;
        this.generateTypeId(name);
        return name;
    }

    private typeToString(node: ts.Node) {
        const type = this.typechecker!.getTypeAtLocation(node);
        let typeString = this.typechecker!.typeToString(type);

        const maybeWasmType = TypeResolver.maybeBuiltinWasmType(node);
        if (maybeWasmType) {
            typeString = maybeWasmType.getName();
        }

        // setter : T ==> (x: T) => void
        if (ts.isSetAccessor(node)) {
            const paramName = node.parameters[0].getText();
            typeString = `(${paramName}) => void`;
        }
        // getter : T ==> () => T
        if (ts.isGetAccessor(node)) {
            typeString = `() => ${typeString}`;
        }
        // typeReference: T ==> typeId
        // TODO
        return typeString;
    }

    private setMethod(
        func: ts.AccessorDeclaration | ts.MethodDeclaration,
        baseType: TSClass | null,
        classType: TSClass,
        funcKind: FunctionKind,
    ) {
        const methodName = func.name.getText();

        const type = this.generateNodeType(func);
        let tsFuncType = new TSFunction(funcKind);
        /* record tsFuncType envParamLen: @context. @this */
        tsFuncType.envParamLen = 2;

        this.parseTypeParameters(tsFuncType, func, this.currentScope);

        const nameWithPrefix = getMethodPrefix(funcKind) + func.name.getText();

        if (type instanceof TSFunction) {
            type.funcKind = tsFuncType.funcKind;
            tsFuncType = type;
        }
        if (funcKind === FunctionKind.GETTER) {
            tsFuncType.returnType = type;
        }
        if (funcKind === FunctionKind.SETTER) {
            tsFuncType.addParamType(type);
        }

        let isOverride = false;
        if (baseType) {
            const baseFuncType = baseType.getMethod(methodName, funcKind).method
                ?.type;
            if (baseFuncType) {
                tsFuncType = baseFuncType;
                isOverride = true;
            }
        }
        if (!isOverride) {
            /* override methods has been copied from base class,
                only add non-override methods here */
            classType.addMethod({
                name: methodName,
                type: tsFuncType,
            });
        }

        const funcDef = this.parserCtx.getScopeByNode(func);
        if (funcDef && funcDef instanceof FunctionScope) {
            funcDef.setFuncType(tsFuncType);
        }
        classType.overrideOrOwnMethods.add(nameWithPrefix);
    }

    parseTypeParameters(
        tstype: TSTypeWithArguments,
        node: ts.DeclarationWithTypeParameters,
        scope: Scope | null,
    ) {
        const typeParams = ts.getEffectiveTypeParameterDeclarations(node);
        if (!typeParams) return;

        let index = 0;
        for (const tp of typeParams!) {
            const name = tp.name.getText();
            const constraint_node =
                ts.getEffectiveConstraintOfTypeParameter(tp);
            let wide_type: Type = builtinTypes.get('generic')!;
            if (constraint_node) {
                // TypeNode
                const constraint_tstype =
                    this.typechecker!.getTypeFromTypeNode(constraint_node);
                wide_type = this.tsTypeToType(constraint_tstype);
            }
            let default_type: Type | undefined = undefined;
            const default_node = tp.default;
            if (default_node) {
                const default_tstype =
                    this.typechecker!.getTypeFromTypeNode(default_node);
                default_type = this.tsTypeToType(default_tstype);
            }

            const type_param = new TSTypeParameter(
                name,
                wide_type,
                index++,
                default_type,
            );

            tstype.addTypeParameter(type_param);

            if (scope) {
                scope.addType(type_param.name, type_param);
            }
        }
    }

    private parseEnumType(node: ts.EnumDeclaration): Type {
        const scope = this.currentScope!;

        let start = 0;
        const enumType = new TSEnum(node.name.getText());
        for (const member of node.members) {
            const name = member.name.getText();
            let value: number | string = start;
            if (member.initializer) {
                value = this.parseEnumMemberValue(enumType, member.initializer);
            } else {
                start++;
            }
            enumType.addMember(name, value);
        }
        scope.addType(node.name.getText(), enumType);
        return enumType;
    }

    private parseEnumMemberValue(
        enumType: TSEnum,
        expr: ts.Expression,
    ): number | string {
        switch (expr.kind) {
            case ts.SyntaxKind.StringLiteral:
                return (expr as ts.StringLiteral).text; // return the string value without \' or \"
            case ts.SyntaxKind.NumericLiteral:
                return parseInt((expr as ts.NumericLiteral).getText());
            case ts.SyntaxKind.Identifier: {
                const name = (expr as ts.Identifier).getText();
                const value = enumType.getMember(name);
                if (!value) {
                    throw Error(`EnumMember cannot find ${name}`);
                }
                return value;
            }
            case ts.SyntaxKind.BinaryExpression: {
                const bnode = expr as ts.BinaryExpression;
                const left = this.parseEnumMemberValue(enumType, bnode.left);
                const right = this.parseEnumMemberValue(enumType, bnode.right);
                switch (bnode.operatorToken.kind) {
                    case ts.SyntaxKind.PlusToken:
                        if (typeof left == 'string' || typeof right == 'string')
                            return `${left}${right}`;
                        else return (left as number) + (right as number);
                    default:
                        throw Error(
                            `EnumMember cannot support the operator ${
                                ts.SyntaxKind[bnode.operatorToken.kind]
                            }`,
                        );
                }
            }
            default:
                throw Error(`EnumMember don't support dynamic expression`);
        }
        return 0;
    }

    public static maybeBuiltinWasmType(node: ts.Node) {
        const definedTypeName = (node as any).type?.typeName?.escapedText;
        if (definedTypeName) {
            if (builtinWasmTypes.has(definedTypeName)) {
                return builtinWasmTypes.get(definedTypeName)!;
            }
        }
    }

    /* Check if the type, and all of its children contains generic type */
    public static isTypeGeneric(type: Type): boolean {
        switch (type.kind) {
            case TypeKind.VOID:
            case TypeKind.BOOLEAN:
            case TypeKind.NUMBER:
            case TypeKind.ANY:
            case TypeKind.UNDEFINED:
            case TypeKind.STRING:
            case TypeKind.UNKNOWN:
            case TypeKind.NULL:
            case TypeKind.WASM_I32:
            case TypeKind.WASM_I64:
            case TypeKind.WASM_F32:
            case TypeKind.WASM_F64:
            case TypeKind.WASM_ANYREF: {
                return false;
            }
            case TypeKind.ARRAY: {
                return this.isTypeGeneric((type as TSArray).elementType);
            }
            case TypeKind.FUNCTION: {
                const funcType = type as TSFunction;
                return (
                    funcType.getParamTypes().some((paramType) => {
                        return this.isTypeGeneric(paramType);
                    }) || this.isTypeGeneric(funcType.returnType)
                );
            }
            case TypeKind.CLASS:
            case TypeKind.INTERFACE: {
                const classType = type as TSClass;
                return (
                    classType.fields.some((field) => {
                        return this.isTypeGeneric(field.type);
                    }) ||
                    classType.memberFuncs.some((func) => {
                        return this.isTypeGeneric(func.type);
                    }) ||
                    classType.staticFields.some((field) => {
                        return this.isTypeGeneric(field.type);
                    })
                );
            }
            case TypeKind.GENERIC: {
                return true;
            }
            default: {
                throw new UnimplementError('Not implemented type: ${type}');
            }
        }
        return false;
    }

    public static createSpecializedType(type: Type, typeArg: Type): Type {
        if (!this.isTypeGeneric(type)) {
            return type;
        }

        switch (type.kind) {
            case TypeKind.VOID:
            case TypeKind.BOOLEAN:
            case TypeKind.NUMBER:
            case TypeKind.ANY:
            case TypeKind.UNDEFINED:
            case TypeKind.STRING:
            case TypeKind.UNKNOWN:
            case TypeKind.NULL:
            case TypeKind.WASM_I32:
            case TypeKind.WASM_I64:
            case TypeKind.WASM_F32:
            case TypeKind.WASM_F64:
            case TypeKind.WASM_ANYREF: {
                return type;
            }
            case TypeKind.ARRAY: {
                return new TSArray(
                    this.createSpecializedType(
                        (type as TSArray).elementType,
                        typeArg,
                    ),
                );
            }
            case TypeKind.FUNCTION: {
                const funcType = type as TSFunction;
                const newFuncType = new TSFunction(funcType.funcKind);
                funcType.getParamTypes().forEach((paramType) => {
                    newFuncType.addParamType(
                        this.createSpecializedType(paramType, typeArg),
                    );
                });
                newFuncType.returnType = this.createSpecializedType(
                    funcType.returnType,
                    typeArg,
                );
                return newFuncType;
            }
            case TypeKind.CLASS:
            case TypeKind.INTERFACE: {
                const classType = type as TSClass;
                let newType: TSClass;
                if (type.kind === TypeKind.CLASS) {
                    newType = new TSClass();
                } else {
                    newType = new TSInterface();
                }
                classType.fields.forEach((field) => {
                    newType.addMemberField({
                        name: field.name,
                        type: this.createSpecializedType(field.type, typeArg),
                    });
                });
                classType.memberFuncs.forEach((func) => {
                    newType.addMethod({
                        name: func.name,
                        type: this.createSpecializedType(
                            func.type,
                            typeArg,
                        ) as TSFunction,
                    });
                });
                classType.staticFields.forEach((field) => {
                    newType.addStaticMemberField({
                        name: field.name,
                        type: this.createSpecializedType(field.type, typeArg),
                    });
                });
                return newType;
            }
            case TypeKind.GENERIC: {
                if (typeArg) {
                    return typeArg;
                }

                return builtinTypes.get('any')!;
            }
            default: {
                throw new UnimplementError('Not implemented type: ${type}');
            }
        }
        return builtinTypes.get('any')!;
    }

    public arrayTypeCheck(node: ts.Node): boolean {
        const parentNode = node.parent;
        if (
            ts.isVariableDeclaration(parentNode) ||
            (ts.isBinaryExpression(parentNode) &&
                parentNode.operatorToken.kind === ts.SyntaxKind.EqualsToken)
        ) {
            const type = this.typechecker!.getTypeAtLocation(parentNode);
            if (this.isArray(type) && type.typeArguments) {
                return true;
            }
        }
        return false;
    }
}

export class CustomTypeResolver {
    globalScopes: Array<GlobalScope>;

    constructor(private parserCtx: ParserContext) {
        this.globalScopes = this.parserCtx.globalScopes;
    }

    visit() {
        for (const globalScope of this.globalScopes) {
            this.parseThis(globalScope);
            this.parseContext(globalScope);
        }
    }

    private parseThis(scope: Scope) {
        if (
            scope instanceof FunctionScope &&
            scope.parent instanceof ClassScope &&
            scope.isMethod() &&
            !scope.isStatic()
        ) {
            const thisType: Type = scope.parent.classType;
            for (const variable of scope.varArray) {
                if (variable.varName === 'this') {
                    variable.varType = thisType;
                    break;
                }
            }
        }

        /* traverse scope's children */
        for (const child of scope.children) {
            this.parseThis(child);
        }
    }

    private parseContext(scope: Scope) {
        if (scope instanceof ClosureEnvironment) {
            const currentCtxVar = scope.contextVariable!;
            let parentScope = scope.parent;
            let parentCtxVar: Variable | undefined = undefined;
            // skip class scope
            while (
                parentScope instanceof ClassScope ||
                parentScope instanceof NamespaceScope
            ) {
                parentScope = parentScope.parent;
            }
            if (scope instanceof FunctionScope) {
                /* function scope: parse param context type and variable context type */
                if (parentScope instanceof GlobalScope) {
                    parentCtxVar = undefined;
                } else if (parentScope instanceof ClosureEnvironment) {
                    parentCtxVar = parentScope.contextVariable!;
                }
                this.parseParamContextType(scope, parentCtxVar);
                const realParamCtxVar = new Parameter(
                    '@context',
                    scope.realParamCtxType,
                    [],
                    0,
                );
                this.parseVarContextType(
                    scope,
                    currentCtxVar,
                    realParamCtxVar.varType as TSContext,
                    realParamCtxVar,
                );
            } else if (
                scope instanceof BlockScope &&
                scope.parent?.getNearestFunctionScope()
            ) {
                /* block scope: parse variable context type */
                if (parentScope instanceof GlobalScope) {
                    parentCtxVar = undefined;
                } else if (parentScope instanceof ClosureEnvironment) {
                    parentCtxVar = parentScope.contextVariable;
                }
                this.parseVarContextType(
                    scope,
                    currentCtxVar,
                    parentCtxVar
                        ? (parentCtxVar.varType as TSContext)
                        : new TSContext(),
                    parentCtxVar,
                );
            }
        }

        /* traverse scope's children */
        for (const child of scope.children) {
            this.parseContext(child);
        }
    }

    private parseParamContextType(
        scope: FunctionScope,
        parentVarContextVar?: Variable,
    ) {
        let paramContextType = new TSContext();
        if (parentVarContextVar) {
            paramContextType = new TSContext(
                parentVarContextVar!.varType as TSContext,
            );
        }
        /* record the realType */
        scope.realParamCtxType = paramContextType;
        scope.addType(paramContextType.toString(), paramContextType);
    }

    private parseVarContextType(
        scope: ClosureEnvironment,
        currentCtxVar: Variable,
        parentContextType: TSContext,
        parentCtxVar?: Variable,
    ) {
        if (parentCtxVar) {
            currentCtxVar.initContext = parentCtxVar;
        }
        const varFreeVarTypeList: Type[] = [];
        if (scope instanceof FunctionScope) {
            scope.paramArray.forEach((value) => {
                if (value.varIsClosure) {
                    value.belongCtx = currentCtxVar;
                    value.closureIndex = varFreeVarTypeList.length;
                    varFreeVarTypeList.push(value.varType);
                }
            });
        }
        scope.varArray.forEach((value) => {
            if (value.varIsClosure) {
                value.belongCtx = currentCtxVar;
                value.closureIndex = varFreeVarTypeList.length;
                varFreeVarTypeList.push(value.varType);
            }
        });
        const varContextType = new TSContext(
            parentContextType,
            varFreeVarTypeList,
        );
        currentCtxVar.varType = varContextType;
        scope.addType(varContextType.toString(), varContextType);
        return varContextType;
    }
}

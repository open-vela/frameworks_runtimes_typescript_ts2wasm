import ts from 'typescript';
import { Compiler } from './compiler.js';
import { Stack } from './utils.js';
import {
    ClassScope,
    funcDefs,
    FunctionScope,
    GlobalScope,
    Scope,
    ScopeKind,
} from './scope.js';
import { assert } from 'console';

export const enum TypeKind {
    VOID = 'void',
    BOOLEAN = 'boolean',
    NUMBER = 'number',
    ANY = 'any',
    STRING = 'string',
    ARRAY = 'array',
    FUNCTION = 'function',
    CLASS = 'class',
    UNKNOWN = 'unknown',
    NULL = 'null',
    DYNCONTEXTTYPE = 'dyntype_context',
}

export class Type {
    typeKind = TypeKind.UNKNOWN;

    get kind(): TypeKind {
        return this.typeKind;
    }
}

export class Primitive extends Type {
    typeKind;
    constructor(private type: string) {
        super();
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
            case 'void': {
                this.typeKind = TypeKind.VOID;
                break;
            }
            case 'null': {
                this.typeKind = TypeKind.NULL;
                break;
            }
            case 'dyntype_context': {
                this.typeKind = TypeKind.DYNCONTEXTTYPE;
                break;
            }
            default: {
                this.typeKind = TypeKind.UNKNOWN;
            }
        }
    }
}

export const builtinTypes = new Map<string, Type>([
    ['number', new Primitive('number')],
    ['string', new Primitive('string')],
    ['boolean', new Primitive('boolean')],
    ['any', new Primitive('any')],
    ['void', new Primitive('void')],
    ['null', new Primitive('null')],
    ['dyntype_context', new Primitive('dyntype_context')],
]);

export interface TsClassField {
    name: string;
    type: Type;
    modifier?: 'readonly';
    visibility?: 'public' | 'protected' | 'private';
    static?: 'static';
}

export interface TsClassFunc {
    name: string;
    type: TSFunction;
    isSetter: boolean;
    isGetter: boolean;
}

export class TSClass extends Type {
    typeKind = TypeKind.CLASS;
    private name = '';
    private memberFields: Array<TsClassField> = [];
    private staticFields: Array<TsClassField> = [];
    private constructorMethodName = '';
    private constructorMethod: TSFunction | null = null;
    private methods: Array<TsClassFunc> = [];
    /* override or own methods */
    public overrideOrOwnMethods: Set<string> = new Set();
    private staticMethods: Map<string, TSFunction> = new Map();
    private baseClass: TSClass | null = null;

    constructor() {
        super();
    }

    get classConstructorName(): string {
        return this.constructorMethodName;
    }

    get classConstructorType(): TSFunction | null {
        return this.constructorMethod;
    }

    get fields(): Array<TsClassField> {
        return this.memberFields;
    }

    get memberFuncs(): Array<TsClassFunc> {
        return this.methods;
    }

    setClassConstructor(name: string, functionType: TSFunction) {
        this.constructorMethodName = name;
        this.constructorMethod = functionType;
    }

    setBase(base: TSClass): void {
        this.baseClass = base;
    }

    getBase(): TSClass | null {
        return this.baseClass;
    }

    addMemberField(memberField: TsClassField): void {
        this.memberFields.push(memberField);
    }

    getMemberField(name: string): TsClassField | null {
        return (
            this.memberFields.find((f) => {
                return f.name === name;
            }) || null
        );
    }

    getMemberFieldIndex(name: string): number {
        return this.memberFields.findIndex((f) => {
            return f.name === name;
        });
    }

    addStaticMemberField(memberField: TsClassField): void {
        this.staticFields.push(memberField);
    }

    getStaticMemberField(name: string): TsClassField | null {
        for (const memberField of this.staticFields) {
            if (memberField.name === name) {
                return memberField;
            }
        }
        return null;
    }

    addMethod(classMethod: TsClassFunc): void {
        this.methods.push(classMethod);
    }

    /* when calling a getter, it's not a CallExpression */
    getMethod(name: string, findGetter = false): TsClassFunc | null {
        return (
            this.memberFuncs.find((f) => {
                return name === f.name && findGetter === f.isGetter;
            }) || null
        );
    }

    getMethodIndex(name: string, findGetter = false): number {
        return this.memberFuncs.findIndex((f) => {
            return name === f.name && findGetter === f.isGetter;
        });
    }

    addStaticMethod(name: string, methodType: TSFunction): void {
        this.staticMethods.set(name, methodType);
    }

    getStaticMethod(name: string): TSFunction {
        const method = this.staticMethods.get(name);
        if (method === undefined) {
            throw new Error(
                'static method function not found, function name <' +
                    name +
                    '>',
            );
        }
        return method;
    }

    setClassName(name: string) {
        this.name = name;
    }

    get className(): string {
        return this.name;
    }
}

export class TSArray extends Type {
    typeKind = TypeKind.ARRAY;
    constructor(private elemType: Type) {
        super();
    }

    get elementType(): Type {
        return this.elemType;
    }
}

export class TSFunction extends Type {
    typeKind = TypeKind.FUNCTION;
    private parameterTypes: Type[] = [];
    private _returnType: Type = new Primitive('void');
    // iff last parameter is rest paremeter
    private hasRestParameter = false;

    constructor() {
        super();
    }

    set returnType(type: Type) {
        this._returnType = type;
    }

    get returnType(): Type {
        return this._returnType;
    }

    addParamType(paramType: Type) {
        this.parameterTypes.push(paramType);
    }

    getParamTypes(): Type[] {
        return this.parameterTypes;
    }

    setRest() {
        this.hasRestParameter = true;
    }

    hasRest() {
        return this.hasRestParameter === true;
    }
}

export default class TypeCompiler {
    typechecker: ts.TypeChecker | undefined = undefined;
    globalScopeStack: Stack<GlobalScope>;
    currentScope: Scope | null = null;
    nodeScopeMap: Map<ts.Node, Scope>;

    constructor(private compilerCtx: Compiler) {
        this.nodeScopeMap = this.compilerCtx.nodeScopeMap;
        this.globalScopeStack = this.compilerCtx.globalScopeStack;
    }

    visit() {
        this.typechecker = this.compilerCtx.typeChecker;
        this.nodeScopeMap.forEach((scope, node) => {
            ts.forEachChild(node, this.visitNode.bind(this));
        });
    }

    private visitNode(node: ts.Node): void {
        this.currentScope = this.compilerCtx.getScopeByNode(node)!;

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
        }
        ts.forEachChild(node, this.visitNode.bind(this));
    }

    private addTypeToTypeMap(type: Type, node: ts.Node) {
        const tsTypeString = this.typechecker!.typeToString(
            this.typechecker!.getTypeAtLocation(node),
        );

        if (
            this.currentScope!.kind === ScopeKind.FunctionScope &&
            type.kind === TypeKind.FUNCTION &&
            !ts.isParameter(node) &&
            !ts.isVariableDeclaration(node)
        ) {
            (<FunctionScope>this.currentScope!).setFuncType(type as TSFunction);
        }
        if (ts.isClassDeclaration(node)) {
            this.currentScope!.parent!.namedTypeMap.set(tsTypeString, type);
            if (this.currentScope! instanceof ClassScope) {
                this.currentScope!.setClassType(type as TSClass);
            }
        } else {
            if (!this.currentScope!.namedTypeMap.has(tsTypeString)) {
                this.currentScope!.namedTypeMap.set(tsTypeString, type);
            }
        }
    }

    generateNodeType(node: ts.Node): Type {
        if (ts.isConstructorDeclaration(node)) {
            return this.parseSignature(
                this.typechecker!.getSignatureFromDeclaration(node)!,
            );
        }
        const tsType = this.typechecker!.getTypeAtLocation(node);
        const type = this.tsTypeToType(tsType);
        /* for example, a: string[] = new Array(), the type of new Array() should be string[]
         instead of any[]*/
        if (type instanceof TSArray) {
            const parentNode = node.parent;
            if (
                ts.isVariableDeclaration(parentNode) ||
                ts.isBinaryExpression(parentNode)
            ) {
                return this.generateNodeType(parentNode);
            }
            if (
                ts.isNewExpression(parentNode) ||
                ts.isArrayLiteralExpression(parentNode)
            ) {
                return (<TSArray>this.generateNodeType(parentNode)).elementType;
            }
        }
        return type;
    }

    private tsTypeToType(type: ts.Type): Type {
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
        if (typeFlag & ts.TypeFlags.Any || typeFlag & ts.TypeFlags.Undefined) {
            return builtinTypes.get('any')!;
        }
        if (typeFlag & ts.TypeFlags.Null) {
            return builtinTypes.get('null')!;
        }
        // union type ==> type of first elem, iff all types are same, otherwise, any
        if (type.isUnion()) {
            const nodeTypeArray = type.types.map((elem) => {
                return this.tsTypeToType(elem);
            });
            return nodeTypeArray.every((type) => type === nodeTypeArray[0])
                ? nodeTypeArray[0]
                : builtinTypes.get('any')!;
        }

        // sophisticated types
        //               object
        //           /    \         \
        // typereference objliteral function
        //    / \
        // array class/infc

        // iff array type
        if (this.isArray(type)) {
            assert(type.typeArguments !== undefined);
            if (!type.typeArguments) {
                throw new Error('array type has no type arguments');
            }
            const elemType = this.tsTypeToType(type.typeArguments![0]);
            return new TSArray(elemType);
        }
        // iff class/infc
        if (this.isTypeReference(type)) {
            const symbolName = type.symbol.name;
            const tsType = this.currentScope!.findType(symbolName);
            if (!tsType) {
                throw new Error(
                    `class/interface not found, type name <' + ${symbolName} + '>`,
                );
            }
            return tsType;
        }
        // iff object literal type
        if (this.isObjectLiteral(type)) {
            const tsClass = new TSClass();
            type.getProperties().map((prop) => {
                const propertyAssignment =
                    prop.valueDeclaration as ts.PropertyAssignment;
                const propType = this.typechecker!.getTypeAtLocation(
                    propertyAssignment.initializer,
                );
                const tsType = this.tsTypeToType(propType);
                if (tsType.kind === TypeKind.FUNCTION) {
                    tsClass.addMethod({
                        name: prop.name,
                        type: <TSFunction>tsType,
                        isSetter: false,
                        isGetter: false,
                    });
                } else {
                    tsClass.addMemberField({
                        name: prop.name,
                        type: tsType,
                    });
                }
            });
            return tsClass;
        }

        // iff function type
        if (this.isFunction(type)) {
            const signature = type.getCallSignatures()[0];
            return this.parseSignature(signature);
        }

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

        const tsFunction = new TSFunction();
        signature.getParameters().map((param) => {
            const tsType = this.tsTypeToType(
                this.typechecker!.getTypeAtLocation(param.valueDeclaration!),
            );

            tsFunction.addParamType(tsType);
        });

        const returnType =
            this.typechecker!.getReturnTypeOfSignature(signature);
        /* maybe we can deduce the return type of constructor?
          constructor(): void ==> constructor: TsClass ??
        */
        const symbol = returnType.symbol;
        if (
            symbol &&
            symbol.valueDeclaration?.kind === ts.SyntaxKind.ClassDeclaration
        ) {
            tsFunction.returnType = builtinTypes.get('void')!;
        } else {
            tsFunction.returnType = this.tsTypeToType(returnType);
        }

        return tsFunction;
    }

    private parseClassDecl(node: ts.ClassDeclaration): TSClass {
        const classType = new TSClass();
        classType.setClassName(node.name!.getText());
        const heritage = node.heritageClauses;
        if (heritage !== undefined) {
            /* base class node, iff it really has the one */
            const heritageName = heritage[0].types[0].getText();
            const scope = this.currentScope;
            if (scope !== null) {
                const heritageType = <TSClass>scope.findType(heritageName);
                classType.setBase(heritageType);

                for (const field of heritageType.fields) {
                    classType.addMemberField(field);
                }
                for (const method of heritageType.memberFuncs) {
                    classType.addMethod(method);
                }
            }
        }
        for (const member of node.members) {
            if (member.kind === ts.SyntaxKind.PropertyDeclaration) {
                if (classType.getMemberField(member.name!.getText())) {
                    continue;
                }
                const field = <ts.PropertyDeclaration>member;
                const name = member.name!.getText(),
                    type = this.generateNodeType(field);
                const modifier = field.modifiers?.some((m) => {
                    return m.kind === ts.SyntaxKind.ReadonlyKeyword;
                })
                    ? 'readonly'
                    : undefined;
                const staticModifier = field.modifiers?.some((m) => {
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
                classType.addMemberField(classField);
            }
            if (member.kind === ts.SyntaxKind.SetAccessor) {
                const func = <ts.SetAccessorDeclaration>member;
                const methodName = member.name!.getText();
                const base = classType.getBase();
                let isOverride = false;
                if (base !== null) {
                    for (const method of base.memberFuncs) {
                        if (method.name === methodName && method.isSetter) {
                            isOverride = true;
                            break;
                        }
                    }
                }
                const tsFuncType = new TSFunction();
                tsFuncType.addParamType(this.generateNodeType(func));

                if (!isOverride) {
                    classType.addMethod({
                        name: methodName,
                        type: tsFuncType,
                        isSetter: true,
                        isGetter: false,
                    });
                }
                const targetFuncDef = funcDefs.get(
                    classType.className + '_set_' + methodName,
                );
                if (targetFuncDef !== undefined) {
                    targetFuncDef.setFuncType(tsFuncType);
                }

                classType.overrideOrOwnMethods.add('_set_' + methodName);
            }
            if (member.kind === ts.SyntaxKind.GetAccessor) {
                const func = <ts.GetAccessorDeclaration>member;
                const methodName = member.name!.getText();
                const base = classType.getBase();
                let isOverride = false;
                if (base !== null) {
                    for (const method of base.memberFuncs) {
                        if (method.name === methodName && method.isGetter) {
                            isOverride = true;
                            break;
                        }
                    }
                }
                const tsFuncType = new TSFunction();
                tsFuncType.returnType = this.generateNodeType(func);

                if (!isOverride) {
                    classType.addMethod({
                        name: methodName,
                        type: tsFuncType,
                        isSetter: false,
                        isGetter: true,
                    });
                }
                if (!isOverride) {
                    classType.addMethod({
                        name: methodName,
                        type: tsFuncType,
                        isSetter: false,
                        isGetter: true,
                    });
                }
                const targetFuncDef = funcDefs.get(
                    classType.className + '_get_' + methodName,
                );
                if (targetFuncDef !== undefined) {
                    targetFuncDef.setFuncType(tsFuncType);
                }
                classType.overrideOrOwnMethods.add('_get_' + methodName);
            }
            if (member.kind === ts.SyntaxKind.MethodDeclaration) {
                const func = <ts.MethodDeclaration>member;
                const methodName = member.name!.getText();
                const base = classType.getBase();
                let isOverride = false;
                if (base !== null) {
                    for (const method of base.memberFuncs) {
                        if (method.name === methodName) {
                            isOverride = true;
                            break;
                        }
                    }
                }
                const tsFuncType = <TSFunction>this.generateNodeType(func);
                if (!isOverride) {
                    classType.addMethod({
                        name: methodName,
                        type: tsFuncType,
                        isSetter: false,
                        isGetter: false,
                    });
                }
                const targetFuncDef = funcDefs.get(
                    classType.className + '_' + methodName,
                );
                if (targetFuncDef !== undefined) {
                    targetFuncDef.setFuncType(tsFuncType);
                }
                classType.overrideOrOwnMethods.add(methodName);
            }
            if (member.kind === ts.SyntaxKind.Constructor) {
                const func = <ts.ConstructorDeclaration>member;
                const tsFuncType = this.generateNodeType(func) as TSFunction;
                classType.setClassConstructor('constructor', tsFuncType);
                const targetFuncDef = funcDefs.get(
                    classType.className + '_constructor',
                );
                if (targetFuncDef !== undefined) {
                    targetFuncDef.setFuncType(tsFuncType);
                }
            }
        }
        return classType;
    }
}

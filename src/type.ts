import ts, { SyntaxKind } from 'typescript';
import { Compiler } from './compiler.js';
import { Stack, getNodeTypeInfo, getCurScope } from './utils.js';
import { FunctionScope, GlobalScope, Scope, ScopeKind } from './scope.js';

export const enum TypeKind {
    VOID,
    BOOLEAN,
    NUMBER,
    ANY,
    STRING,
    ARRAY,
    FUNCTION,
    CLASS,
    UNKNOWN,
    NULL,
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
            default: {
                this.typeKind = TypeKind.UNKNOWN;
            }
        }
    }
}

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

    // get memberFuncs(): Map<string, TSFunction> {
    //     return this.methods;
    // }
    get memberFuncs(): Array<TsClassFunc> {
        return this.methods;
    }

    // setOverrideMethod(name: string): void {
    //     this.methodsOverride.add(name);
    // }

    // isOverrideMethod(name: string): boolean {
    //     if (this.methodsOverride.has(name)) {
    //         return true;
    //     }
    //     return false;
    // }

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
        for (const memberField of this.memberFields) {
            if (memberField.name === name) {
                return memberField;
            }
        }
        return null;
    }

    getMemberFieldIndex(name: string): number {
        for (let i = 0; i < this.memberFields.length; i++) {
            if (this.memberFields[i].name === name) {
                return i;
            }
        }
        return -1;
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

    getMethod(name: string): TsClassFunc | null {
        for (const method of this.memberFuncs) {
            if (name === method.name) {
                return method;
            }
        }
        return null;
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
    globalScopeStack = new Stack<GlobalScope>();
    currentScope: Scope | null = null;
    nodeScopeMap = new Map<ts.Node, Scope>();

    constructor(private compilerCtx: Compiler) {
        this.nodeScopeMap = this.compilerCtx.nodeScopeMap;
        this.globalScopeStack = this.compilerCtx.globalScopeStack;
    }

    visit(nodes: Array<ts.SourceFile>) {
        this.typechecker = this.compilerCtx.typeChecker;
        for (let i = 0; i < nodes.length; i++) {
            const sourceFile = nodes[i];
            this.currentScope = this.globalScopeStack.getItemAtIdx(i);
            this.visitNode(sourceFile);
        }
    }

    visitNode(node: ts.Node): void {
        this.findCurrentScope(node);
        switch (node.kind) {
            case ts.SyntaxKind.ClassDeclaration: {
                const classNode = <ts.ClassDeclaration>node;
                let className = '';
                if (
                    classNode.name !== undefined &&
                    classNode.name.kind === ts.SyntaxKind.Identifier
                ) {
                    className = (<ts.Identifier>classNode.name).getText();
                }
                if (
                    this.currentScope !== null &&
                    this.currentScope.parent !== null
                ) {
                    const parentScope = this.currentScope.parent;
                    parentScope.namedTypeMap.set(
                        className,
                        this.generateNodeType(classNode),
                    );
                }

                break;
            }
            case ts.SyntaxKind.TypeAliasDeclaration: {
                /* TODO: new corresponding type and insert to this.namedTypeMap */
                break;
            }
            case ts.SyntaxKind.Identifier: {
                // const dd = [{ a: 1 }, { a: 2 }, { a: 3, b: 3 }];
                // In this case, identifier's type is not equal with array's type.
                if (node.parent.kind === ts.SyntaxKind.VariableDeclaration) {
                    this.setType(node);
                }
                break;
            }
            case ts.SyntaxKind.NewExpression: {
                const newExpressionNode = <ts.NewExpression>node;
                const identifierName = newExpressionNode.expression.getText()!;
                switch (identifierName) {
                    case 'Array': {
                        this.setType(newExpressionNode);
                        break;
                    }
                }
                break;
            }
            case ts.SyntaxKind.ArrayType:
            case ts.SyntaxKind.ArrayLiteralExpression:
            case ts.SyntaxKind.ObjectLiteralExpression:
            case ts.SyntaxKind.NumberKeyword:
            case ts.SyntaxKind.NumericLiteral:
            case ts.SyntaxKind.StringKeyword:
            case ts.SyntaxKind.StringLiteral:
            case ts.SyntaxKind.BooleanKeyword:
            case ts.SyntaxKind.TrueKeyword:
            case ts.SyntaxKind.FalseKeyword:
            case ts.SyntaxKind.NullKeyword:
            case ts.SyntaxKind.FunctionDeclaration: {
                this.setType(node);
                break;
            }
        }
        ts.forEachChild(node, this.visitNode.bind(this));
    }

    generateNodeType(node: ts.Node): Type {
        switch (node.kind) {
            case ts.SyntaxKind.Identifier: {
                const typeCheckerInfo = getNodeTypeInfo(
                    node,
                    this.typechecker!,
                );
                const typeNode = typeCheckerInfo.typeNode;
                return this.generateNodeType(typeNode);
            }
            case ts.SyntaxKind.BinaryExpression: {
                const typeCheckerInfo = getNodeTypeInfo(
                    node,
                    this.typechecker!,
                );
                const typeNode = typeCheckerInfo.typeNode;
                return this.generateNodeType(typeNode);
            }
            case ts.SyntaxKind.PostfixUnaryExpression: {
                const typeCheckerInfo = getNodeTypeInfo(
                    node,
                    this.typechecker!,
                );
                const typeNode = typeCheckerInfo.typeNode;
                return this.generateNodeType(typeNode);
            }
            case ts.SyntaxKind.PrefixUnaryExpression: {
                const typeCheckerInfo = getNodeTypeInfo(
                    node,
                    this.typechecker!,
                );
                const typeNode = typeCheckerInfo.typeNode;
                return this.generateNodeType(typeNode);
            }
            case ts.SyntaxKind.ObjectLiteralExpression: {
                const typeCheckerInfo = getNodeTypeInfo(
                    node,
                    this.typechecker!,
                );
                const typeNode = typeCheckerInfo.typeNode;
                return this.generateNodeType(typeNode);
            }
            case ts.SyntaxKind.NumberKeyword:
            case ts.SyntaxKind.NumericLiteral: {
                return this.generatePrimitiveType('number');
            }
            case ts.SyntaxKind.AnyKeyword:
            case ts.SyntaxKind.UnionType: {
                // treat union as any
                return this.generatePrimitiveType('any');
            }
            case ts.SyntaxKind.StringKeyword:
            case ts.SyntaxKind.StringLiteral: {
                return this.generatePrimitiveType('string');
            }
            case ts.SyntaxKind.VoidKeyword: {
                return this.generatePrimitiveType('void');
            }
            case ts.SyntaxKind.FalseKeyword:
            case ts.SyntaxKind.TrueKeyword:
            case ts.SyntaxKind.BooleanKeyword: {
                return this.generatePrimitiveType('boolean');
            }
            case ts.SyntaxKind.NullKeyword: {
                return this.generatePrimitiveType('null');
            }
            case ts.SyntaxKind.FunctionType: {
                const funcTypeNode = <ts.FunctionTypeNode>node;
                return this.generateFunctionType(funcTypeNode);
            }
            case ts.SyntaxKind.ClassDeclaration: {
                const classTypeNode = <ts.ClassDeclaration>node;
                return this.generateClassType(classTypeNode);
            }
            case ts.SyntaxKind.TypeLiteral: {
                const typeLiteralNode = <ts.TypeLiteralNode>node;
                const objLiteralType = new TSClass();
                for (const member of typeLiteralNode.members) {
                    if (member.kind === ts.SyntaxKind.PropertySignature) {
                        const memberNode = <ts.PropertySignature>member;
                        const memberIdentifier = <ts.Identifier>memberNode.name;
                        const fieldName =
                            memberIdentifier.escapedText.toString();
                        const fieldType = this.generateNodeType(
                            memberNode.type!,
                        );
                        const objField: TsClassField = {
                            name: fieldName,
                            type: fieldType,
                        };
                        objLiteralType.addMemberField(objField);
                    } else if (member.kind === ts.SyntaxKind.MethodSignature) {
                        const memberNode = <ts.MethodSignature>member;
                        const memberIdentifier = <ts.Identifier>memberNode.name;
                        const funcName =
                            memberIdentifier.escapedText.toString();
                        const funcType = this.generateFunctionType(memberNode);
                        objLiteralType.addMethod({
                            name: funcName,
                            type: funcType,
                            isSetter: false,
                            isGetter: false,
                        });
                    } else {
                        throw new Error('unexpected node type ' + member.kind);
                    }
                }
                return objLiteralType;
            }
            case ts.SyntaxKind.ArrayType: {
                const arrayTypeNode = <ts.ArrayTypeNode>node;
                const elementTypeNode = arrayTypeNode.elementType;
                const elementType = this.generateNodeType(elementTypeNode);
                const TSArrayType = new TSArray(elementType);
                return TSArrayType;
            }
            case ts.SyntaxKind.TypeReference: {
                const typeRefNode = <ts.TypeReferenceNode>node;
                const typeNameNode = <ts.Identifier>typeRefNode.typeName;
                const refName = typeNameNode.escapedText.toString();
                if (refName === 'Array') {
                    const typeArgNode = typeRefNode.typeArguments![0];
                    const elementType = this.generateNodeType(typeArgNode);
                    const TSArrayType = new TSArray(elementType);
                    return TSArrayType;
                }
                if (!this.currentScope!.namedTypeMap.has(refName)) {
                    throw new Error('can not find the ref type ' + refName);
                }
                return this.currentScope!.namedTypeMap.get(refName)!;
            }
            case ts.SyntaxKind.ParenthesizedType: {
                const parentheNode = <ts.ParenthesizedTypeNode>node;
                return this.generateNodeType(parentheNode.type);
            }
            case ts.SyntaxKind.LiteralType: {
                const literalTypeNode = <ts.LiteralTypeNode>node;
                return this.generateNodeType(literalTypeNode.literal);
            }
        }
        return new Type();
    }

    generatePrimitiveType(typeName: string): Type {
        return new Primitive(typeName);
    }

    setType(node: ts.Node) {
        const typeCheckerInfo = getNodeTypeInfo(node, this.typechecker!);
        const typeName = typeCheckerInfo.typeName;
        if (this.currentScope!.namedTypeMap.has(typeName)) {
            return;
        }
        const typeNode = typeCheckerInfo.typeNode;
        const TSType = this.generateNodeType(typeNode);
        this.currentScope!.namedTypeMap.set(typeName, TSType);
        if (
            this.currentScope &&
            this.currentScope.kind === ScopeKind.FunctionScope &&
            (node.kind === ts.SyntaxKind.FunctionDeclaration ||
                node.kind === ts.SyntaxKind.SetAccessor ||
                node.kind === ts.SyntaxKind.GetAccessor ||
                node.kind === ts.SyntaxKind.MethodDeclaration ||
                node.kind === ts.SyntaxKind.Constructor)
        ) {
            (<FunctionScope>this.currentScope).setFuncType(<TSFunction>TSType);
        }
    }

    findCurrentScope(node: ts.Node) {
        const currentScope = getCurScope(node, this.nodeScopeMap);
        if (!currentScope) {
            throw new Error('current scope is null');
        }
        this.currentScope = currentScope;
    }

    generateFunctionType(
        node:
            | ts.MethodSignature
            | ts.FunctionTypeNode
            | ts.SetAccessorDeclaration
            | ts.GetAccessorDeclaration
            | ts.MethodDeclaration
            | ts.ConstructorDeclaration,
    ): TSFunction {
        const funcType = new TSFunction();
        const paramList = node.parameters;
        const returnTypeNode = node.type;
        for (const param of paramList) {
            const paramNode = <ts.ParameterDeclaration>param;
            const paramType = this.generateNodeType(paramNode);
            funcType.addParamType(paramType);
        }
        if (returnTypeNode) {
            const returnType = this.generateNodeType(returnTypeNode);
            funcType.returnType = returnType;
        }
        return funcType;
    }

    generateClassType(node: ts.ClassDeclaration): TSClass {
        const classType = new TSClass();
        const heritage = node.heritageClauses;
        if (heritage !== undefined) {
            /* base class node, iff it really has the one */
            const heritageName = heritage[0].types[0].getText();
            const scope = this.currentScope;
            if (scope !== null) {
                const heritageType = <TSClass>(
                    scope.getTypeFromCurrentScope(heritageName)
                );
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
                const name = member.getText(),
                    type = this.generateNodeType(field);
                const modifier = findModifier(
                    field.modifiers,
                    ts.SyntaxKind.ReadonlyKeyword,
                )
                    ? 'readonly'
                    : undefined;
                const staticModifier = findModifier(
                    field.modifiers,
                    ts.SyntaxKind.StaticKeyword,
                )
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
                if (!isOverride) {
                    const tsFuncType = this.generateFunctionType(func);
                    classType.addMethod({
                        name: methodName,
                        type: tsFuncType,
                        isSetter: true,
                        isGetter: false,
                    });
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
                if (!isOverride) {
                    const tsFuncType = this.generateFunctionType(func);
                    classType.addMethod({
                        name: methodName,
                        type: tsFuncType,
                        isSetter: false,
                        isGetter: true,
                    });
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
                if (!isOverride) {
                    const tsFuncType = this.generateFunctionType(func);
                    classType.addMethod({
                        name: methodName,
                        type: tsFuncType,
                        isSetter: false,
                        isGetter: false,
                    });
                }
                classType.overrideOrOwnMethods.add(methodName);
            }
            if (member.kind === ts.SyntaxKind.Constructor) {
                const func = <ts.ConstructorDeclaration>member;
                const tsFuncType = this.generateFunctionType(func);
                classType.setClassConstructor('constructor', tsFuncType);
                classType.setClassName('constructor');
            }
        }
        return classType;
    }
}

function findModifier(
    modifiers: ts.NodeArray<ts.ModifierLike> | undefined,
    kind: ts.SyntaxKind,
): boolean {
    if (modifiers === undefined) {
        return false;
    }
    for (let i = 0; i !== modifiers.length; ++i) {
        if (modifiers[i].kind === kind) {
            return true;
        }
    }
    return false;
}

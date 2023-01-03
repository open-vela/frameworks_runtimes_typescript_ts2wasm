import ts from 'typescript';
import { Compiler } from './compiler.js';
import { Stack, getNodeTypeInfo, getCurScope } from './utils.js';
import { GlobalScope, Scope } from './scope.js';

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
}

export class TSClass extends Type {
    typeKind = TypeKind.CLASS;
    memberFields: Array<TsClassField> = [];
    staticFields: Array<TsClassField> = [];

    constructor() {
        super();
    }
}

export class TSArray extends Type {
    typeKind = TypeKind.ARRAY;
    constructor(private elemType: Type) {
        super();
    }
}

export class TSFunction extends Type {
    typeKind = TypeKind.FUNCTION;
    constructor() {
        super();
    }
}

export default class TypeCompiler {
    typechecker: ts.TypeChecker | undefined = undefined;
    globalScopeStack = new Stack<GlobalScope>();
    currentScope: Scope | null = null;
    nodeScopeMap = new Map<ts.Node, Scope>();

    constructor(private compilerCtx: Compiler) {}

    visit(nodes: Array<ts.SourceFile>) {
        this.typechecker = this.compilerCtx.typeChecker;
        this.globalScopeStack = this.compilerCtx.globalScopeStack;
        this.nodeScopeMap = this.compilerCtx.nodeScopeMap;
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
                /* TODO: new TSClass and insert to this.namedTypeMap */
                break;
            }
            case ts.SyntaxKind.TypeAliasDeclaration: {
                /* TODO: new corresponding type and insert to this.namedTypeMap */
                break;
            }
            case ts.SyntaxKind.Identifier: {
                // const dd = [{ a: 1 }, { a: 2 }, { a: 3, b: 3 }];
                // In this case, identifier's type is not equal with array's type.
                if (node.parent.kind === ts.SyntaxKind.NewExpression) {
                    break;
                }
                this.setType(node);
                break;
            }
            case ts.SyntaxKind.ArrayType:
            case ts.SyntaxKind.ArrayLiteralExpression:
            case ts.SyntaxKind.ObjectLiteralExpression: {
                this.setComplexLiteralType(node);
                break;
            }
            case ts.SyntaxKind.NewExpression: {
                const newExpressionNode = <ts.NewExpression>node;
                const identifierName = newExpressionNode.expression.getText()!;
                switch (identifierName) {
                    case 'Array': {
                        this.setComplexLiteralType(newExpressionNode);
                        break;
                    }
                }
                break;
            }
            case ts.SyntaxKind.NumberKeyword:
            case ts.SyntaxKind.NumericLiteral:
            case ts.SyntaxKind.StringKeyword:
            case ts.SyntaxKind.StringLiteral:
            case ts.SyntaxKind.BooleanKeyword:
            case ts.SyntaxKind.TrueKeyword:
            case ts.SyntaxKind.FalseKeyword:
            case ts.SyntaxKind.NullKeyword: {
                this.setPrimitiveLiteralType(node);
                break;
            }
        }
        ts.forEachChild(node, this.visitNode.bind(this));
    }

    generateNodeType(node: ts.Node): Type {
        switch (node.kind) {
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
                const funcType = new TSFunction();
                const paramList = funcTypeNode.parameters;
                const returnTypeNode = funcTypeNode.type;
                const paramTypeList = [];
                for (const param of paramList) {
                    const paramNode = <ts.ParameterDeclaration>param;
                    paramTypeList.push(this.generateNodeType(paramNode.type!));
                }
                const returnType = this.generateNodeType(returnTypeNode);
                // TODO: set paramTypeList and returnType into funcType
                return funcType;
            }
            case ts.SyntaxKind.TypeLiteral: {
                const typeLiteralNode = <ts.TypeLiteralNode>node;
                const objLiteral = new TSClass();
                for (const member of typeLiteralNode.members) {
                    const memberNode = <ts.PropertySignature>member;
                    const memberIdentifier = <ts.Identifier>memberNode.name;
                    const fieldName = memberIdentifier.escapedText.toString();
                    const fieldType = this.generateNodeType(memberNode.type!);
                    const objField: TsClassField = {
                        name: fieldName,
                        type: fieldType,
                    };
                    objLiteral.memberFields.push(objField);
                }
                return objLiteral;
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
                if (!this.currentScope!.namedTypeMap.has(refName)) {
                    this.compilerCtx.reportError(
                        typeRefNode,
                        'can not find the ref type ' + refName,
                    );
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
        let TSType: Type;
        if (!this.currentScope!.namedTypeMap.has(typeName)) {
            TSType = new Primitive(typeName);
            this.currentScope!.namedTypeMap.set(typeName, TSType);
        } else {
            TSType = this.currentScope!.namedTypeMap.get(typeName)!;
        }
        return TSType;
    }

    setType(node: ts.Node) {
        const typeCheckerInfo = getNodeTypeInfo(node, this.typechecker!);
        const typeName = typeCheckerInfo.typeName;
        if (this.currentScope!.namedTypeMap.has(typeName)) {
            return;
        }
        const typeNode = typeCheckerInfo.typeNode;
        const TSType = this.generateNodeType(typeNode);
        if (this.isPrimitiveType(TSType)) {
            this.setPrimitiveLiteralType(node);
        } else {
            this.setComplexLiteralType(node);
        }
    }

    isPrimitiveType(TSType: Type) {
        if (
            TSType.kind === TypeKind.NUMBER ||
            TSType.kind === TypeKind.STRING ||
            TSType.kind === TypeKind.BOOLEAN ||
            TSType.kind === TypeKind.ANY ||
            TSType.kind === TypeKind.NULL ||
            TSType.kind === TypeKind.VOID
        ) {
            return true;
        } else {
            return false;
        }
    }

    setComplexLiteralType(node: ts.Node) {
        const typeCheckerInfo = getNodeTypeInfo(node, this.typechecker!);
        const typeName = typeCheckerInfo.typeName;
        if (this.currentScope!.namedTypeMap.has(typeName)) {
            return;
        }
        const typeNode = typeCheckerInfo.typeNode;
        const TSType = this.generateNodeType(typeNode);
        this.currentScope!.namedTypeMap.set(typeName, TSType);
    }

    setPrimitiveLiteralType(node: ts.Node) {
        const typeCheckerInfo = getNodeTypeInfo(node, this.typechecker!);
        const typeNode = typeCheckerInfo.typeNode;
        this.generateNodeType(typeNode);
    }

    findCurrentScope(node: ts.Node) {
        const currentScope = getCurScope(node, this.nodeScopeMap);
        if (!currentScope) {
            throw new Error('current scope is null');
        }
        this.currentScope = currentScope;
    }
}

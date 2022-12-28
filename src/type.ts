import ts from 'typescript';
import { Compiler } from './compiler.js';
import { TypeCheckerInfo } from './utils.js';

export class Type {}

export class Primitive extends Type {
    constructor(private type: string) {
        super();
    }
}

export interface TsClassField {
    name: string;
    type: Type;
    modifier?: 'readonly';
    visibility?: 'public' | 'protected' | 'private';
}

export class TSClass extends Type {
    memberFields: Array<TsClassField> = [];
    staticFields: Array<TsClassField> = [];

    constructor() {
        super();
    }
}

export class TSArray extends Type {
    constructor(private elemType: Type) {
        super();
    }
}

export class TSFunction extends Type {
    constructor() {
        super();
    }
}

export default class TypeCompiler {
    namedTypeMap: Map<string, Type> =
        this.compilerCtx.currentScope!.namedTypeMap;
    typechecker = this.compilerCtx.typeChecker!;

    constructor(private compilerCtx: Compiler) {
        this.namedTypeMap.set('number', new Primitive('number'));
        this.namedTypeMap.set('any', new Primitive('any'));
        this.namedTypeMap.set('string', new Primitive('string'));
        this.namedTypeMap.set('void', new Primitive('void'));
        this.namedTypeMap.set('boolean', new Primitive('boolean'));
    }

    visit(nodes: Array<ts.SourceFile>) {
        /* TODO: invoke visitNode on interested nodes */
        for (const sourceFile of nodes) {
            ts.forEachChild(sourceFile, this.visitNode);
        }
    }

    visitNode(node: ts.Node): void {
        switch (node.kind) {
            case ts.SyntaxKind.ClassDeclaration: {
                /* TODO: new TSClass and insert to this.namedTypeMap */
                break;
            }
            case ts.SyntaxKind.TypeAliasDeclaration: {
                /* TODO: new corresponding type and insert to this.namedTypeMap */
                break;
            }
            case ts.SyntaxKind.ArrayLiteralExpression: {
                const typeCheckerInfo = this.getNodeTypeName(
                    node,
                    this.typechecker,
                );
                const typeName = typeCheckerInfo.typeName;
                if (this.namedTypeMap.has(typeName)) {
                    break;
                }
                const typeNode = typeCheckerInfo.typeNode;
                const arrayType = this.generateNodeType(typeNode);
                this.namedTypeMap.set(typeName, arrayType);
                break;
            }
            case ts.SyntaxKind.NewExpression: {
                break;
            }
            case ts.SyntaxKind.ObjectLiteralExpression: {
                break;
            }
        }
    }

    generateNodeType(node: ts.Node): Type {
        switch (node.kind) {
            case ts.SyntaxKind.NumberKeyword: {
                let numberType: Type;
                if (!this.namedTypeMap.has('number')) {
                    numberType = new Primitive('number');
                    this.namedTypeMap.set('number', numberType);
                } else {
                    numberType = this.namedTypeMap.get('number')!;
                }
                return numberType;
            }
            case ts.SyntaxKind.AnyKeyword: {
                let anyType: Type;
                if (!this.namedTypeMap.has('any')) {
                    anyType = new Primitive('any');
                    this.namedTypeMap.set('any', anyType);
                } else {
                    anyType = this.namedTypeMap.get('any')!;
                }
                return anyType;
            }
            case ts.SyntaxKind.StringKeyword: {
                let stringType: Type;
                if (!this.namedTypeMap.has('string')) {
                    stringType = new Primitive('string');
                    this.namedTypeMap.set('string', stringType);
                } else {
                    stringType = this.namedTypeMap.get('string')!;
                }
                return stringType;
            }
            case ts.SyntaxKind.VoidKeyword: {
                let voidType: Type;
                if (!this.namedTypeMap.has('void')) {
                    voidType = new Primitive('void');
                    this.namedTypeMap.set('void', voidType);
                } else {
                    voidType = this.namedTypeMap.get('void')!;
                }
                return voidType;
            }
            case ts.SyntaxKind.BooleanKeyword: {
                let booleanType: Type;
                if (!this.namedTypeMap.has('boolean')) {
                    booleanType = new Primitive('boolean');
                    this.namedTypeMap.set('boolean', booleanType);
                } else {
                    booleanType = this.namedTypeMap.get('boolean')!;
                }
                return booleanType;
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
                if (!this.namedTypeMap.has(refName)) {
                    this.compilerCtx.reportError(
                        typeRefNode,
                        'can not find the ref type ' + refName,
                    );
                }
                return this.namedTypeMap.get(refName)!;
            }
            case ts.SyntaxKind.ParenthesizedType: {
                const parentheNode = <ts.ParenthesizedTypeNode>node;
                return this.generateNodeType(parentheNode.type);
            }
            case ts.SyntaxKind.UnionType: {
                // treat union as any
                let unionType: Type;
                if (!this.namedTypeMap.has('any')) {
                    unionType = new Primitive('any');
                    this.namedTypeMap.set('any', unionType);
                } else {
                    unionType = this.namedTypeMap.get('any')!;
                }
                return unionType;
            }
        }
        return new Type();
    }

    getNodeTypeName(node: ts.Node, checker: ts.TypeChecker): TypeCheckerInfo {
        let variableType: ts.Type;
        if (ts.isTypeReferenceNode(node)) {
            node = (node as ts.TypeReferenceNode).typeName;
        }
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol === undefined) {
            variableType = checker.getTypeAtLocation(node);
        } else {
            if (ts.isTypeReferenceNode(node)) {
                variableType = checker.getDeclaredTypeOfSymbol(symbol);
            } else {
                variableType = checker.getTypeOfSymbolAtLocation(
                    symbol,
                    symbol.declarations![0],
                );
            }
        }
        const typeCheckerInfo: TypeCheckerInfo = {
            typeName: checker.typeToString(variableType),
            typeNode: checker.typeToTypeNode(
                variableType,
                undefined,
                undefined,
            )!,
        };
        return typeCheckerInfo;
    }
}

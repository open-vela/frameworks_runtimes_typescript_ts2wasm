import ts from 'typescript';
import { Compiler } from './compiler.js';

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
    constructor(private elemType: Type) {
        super();
    }
}

export default class TypeCompiler {
    namedTypeMap: Map<string, Type> = new Map();

    constructor(private compilerCtx: Compiler) {
        this.namedTypeMap.set('number', new Primitive('number'));
        this.namedTypeMap.set('any', new Primitive('any'));
        this.namedTypeMap.set('string', new Primitive('string'));
        this.namedTypeMap.set('void', new Primitive('void'));
        this.namedTypeMap.set('boolean', new Primitive('boolean'));
    }

    visit(node: ts.Node | Array<ts.Node>) {
        /* TODO: invoke visitNode on interested nodes */
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
        }
    }
}

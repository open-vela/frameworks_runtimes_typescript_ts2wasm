import ts from 'typescript';
import binaryen from 'binaryen';
import TypeCompiler from './type.js';
import { Stack } from './utils.js';
import {
    BlockScope,
    FunctionScope,
    GlobalScope,
    Scope,
    ScopeKind,
    ScopeScanner,
} from './scope.js';
import { VariableScanner, VariableInit } from './variable.js';
import ExpressionCompiler from './expression.js';
import StatementCompiler from './statement.js';
import { WASMGen } from './wasmgen.js';

export const COMPILER_OPTIONS: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2015,
};
export class Compiler {
    private scopeScanner;
    private typeCompiler;
    private variableScanner;
    private variableInit;
    private exprCompiler;
    private stmtCompiler;
    private wasmGen;

    typeChecker: ts.TypeChecker | undefined;
    globalScopeStack = new Stack<GlobalScope>();
    nodeScopeMap = new Map<ts.Node, Scope>();

    // Not used currently
    binaryenModule = new binaryen.Module();
    functionScopeStack = new Stack<FunctionScope>();
    blockScopeStack = new Stack<BlockScope>();
    scopesStack = new Stack<Scope>();
    currentScope: Scope | null = null;
    anonymousFunctionNameStack = new Stack<string>();

    constructor() {
        this.scopeScanner = new ScopeScanner(this);
        this.typeCompiler = new TypeCompiler(this);
        this.variableScanner = new VariableScanner(this);
        this.variableInit = new VariableInit(this);
        this.exprCompiler = new ExpressionCompiler(this);
        this.stmtCompiler = new StatementCompiler(this);
        this.wasmGen = new WASMGen(this);
    }

    compile(fileNames: string[]): void {
        const compilerOptions: ts.CompilerOptions = this.getCompilerOptions();
        const program: ts.Program = ts.createProgram(
            fileNames,
            compilerOptions,
        );
        this.typeChecker = program.getTypeChecker();

        const sourceFileList = program
            .getSourceFiles()
            .filter(
                (sourceFile: ts.SourceFile) =>
                    !sourceFile.fileName.match(/\.d\.ts$/),
            );

        /* Step1: Resolve all scopes */
        this.scopeScanner.visit(sourceFileList);
        /* Step2: Resolve all type declarations */
        this.typeCompiler.visit(sourceFileList);
        this.variableScanner.visit(sourceFileList);
        this.variableInit.visit(sourceFileList);
        /* Step3: Add statements to scopes */
        this.stmtCompiler.visit(sourceFileList);
        /* Step4: code generation */
        this.wasmGen.WASMGenerate();
    }

    get typeComp() {
        return this.typeCompiler;
    }

    get expressionCompiler(): ExpressionCompiler {
        return this.exprCompiler;
    }

    private getCompilerOptions() {
        const opts: ts.CompilerOptions = {};
        for (const i of Object.keys(COMPILER_OPTIONS)) {
            opts[i] = COMPILER_OPTIONS[i];
        }
        return opts;
    }
}

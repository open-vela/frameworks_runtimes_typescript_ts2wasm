import ts from 'typescript';
import binaryen from 'binaryen';
import TypeCompiler from './type.js';
import { Stack } from './utils.js';
import {
    BlockScope,
    FunctionScope,
    GlobalScope,
    Scope,
    ScopeScanner,
} from './scope.js';
import { VariableScanner, VariableInit } from './variable.js';
import ExpressionCompiler from './expression.js';

export const COMPILER_OPTIONS: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2015,
};
export class Compiler {
    private scopeScanner;
    private typeCompiler;
    private variableScanner;
    private VariableInit;
    private exprCompiler;

    typeChecker: ts.TypeChecker | undefined;
    globalScopeStack = new Stack<GlobalScope>();
    nodeScopeMap = new Map<ts.Node, Scope>();

    // Not used currently
    binaryenModule = new binaryen.Module();
    functionScopeStack = new Stack<FunctionScope>();
    blockScopeStack = new Stack<BlockScope>();
    currentScope: Scope | null = null;
    loopLabelStack = new Stack<string>();
    breakLabelsStack = new Stack<string>();
    switchLabelStack = new Stack<number>();
    anonymousFunctionNameStack = new Stack<string>();

    constructor() {
        this.scopeScanner = new ScopeScanner(this);
        this.typeCompiler = new TypeCompiler(this);
        this.variableScanner = new VariableScanner(this);
        this.VariableInit = new VariableInit(this);
        this.exprCompiler = new ExpressionCompiler(this);
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
        this.VariableInit.visit(sourceFileList);

        // TODO: other steps
        /* Step3: Resolve all variables */

        /* Step3: additional type checking rules (optional) */
        /* Step4: code generation */
        // this.condegen.visit(sourceFileList);
    }

    get expressionCompiler(): ExpressionCompiler {
        return this.exprCompiler;
    }

    get loopLabels(): Stack<string> {
        return this.loopLabelStack;
    }

    get breakLabels(): Stack<string> {
        return this.breakLabels;
    }

    get switchLabels(): Stack<number> {
        return this.switchLabelStack;
    }

    reportError(node: ts.Node, message: string) {
        const file = node.getSourceFile();
        const fileName = file.fileName;
        const start = node.getStart(file);
        const pos = file.getLineAndCharacterOfPosition(start);
        const fullMessage = `${fileName}:${pos.line + 1}:${
            pos.character + 1
        }: ${message}`;
        throw new Error(fullMessage);
    }

    private getCompilerOptions() {
        const opts: ts.CompilerOptions = {};
        for (const i of Object.keys(COMPILER_OPTIONS)) {
            opts[i] = COMPILER_OPTIONS[i];
        }
        return opts;
    }
}

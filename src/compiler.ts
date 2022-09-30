import fs from 'fs';
import BaseCompiler from './base.js';
import ExpressionCompiler from './expression.js';
import ModuleCompiler from './module.js';
import ts from 'typescript';
import binaryen from 'binaryen';
import StatementCompiler from './statement.js';
import DeclarationCompiler from './declaration.js';
import LiteralCompiler from './literal.js';
import TypeCompiler from './type.js';
import { Stack } from './utils.js';
import { BlockScope, FunctionScope, GlobalScope, Scope } from './scope.js';

export const COMPILER_OPTIONS: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2015,
};
export class Compiler {
    private compilers: BaseCompiler[];
    typeChecker: ts.TypeChecker | undefined;
    binaryenModule = new binaryen.Module();
    globalScopeStack = new Stack<GlobalScope>();
    functionScopeStack = new Stack<FunctionScope>();
    blockScopeStack = new Stack<BlockScope>();
    currentScope: Scope | null = null;
    loopLabelArray: string[] = [];

    constructor() {
        this.compilers = [
            new ExpressionCompiler(this),
            new StatementCompiler(this),
            new DeclarationCompiler(this),
            new LiteralCompiler(this),
            new ModuleCompiler(this),
            new TypeCompiler(this),
        ];
    }

    compile(fileNames: string[]): void {
        const compilerHost: ts.CompilerHost = this.createCompilerHost();
        const compilerOptions: ts.CompilerOptions = this.getCompilerOptions();
        const program: ts.Program = ts.createProgram(
            fileNames,
            compilerOptions,
            compilerHost,
        );
        this.typeChecker = program.getTypeChecker();
        program
            .getSourceFiles()
            .filter(
                (sourceFile: ts.SourceFile) =>
                    !sourceFile.fileName.match(/\.d\.ts$/),
            )
            .forEach((sourceFile: ts.SourceFile) => {
                this.visit(sourceFile);
            });
    }

    visit(node: ts.Node): binaryen.Type {
        for (let i = 0; i < this.compilers.length; i++) {
            const visitValue = this.compilers[i].visitNode(node);
            if (visitValue != binaryen.none) {
                return visitValue;
            }
        }
        return binaryen.none;
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

    private createCompilerHost(): ts.CompilerHost {
        const defaultLibFileName = ts.getDefaultLibFileName(COMPILER_OPTIONS);
        const compilerHost: ts.CompilerHost = {
            getSourceFile: (sourceName) => {
                let sourcePath = sourceName;
                if (sourceName === defaultLibFileName) {
                    sourcePath = ts.getDefaultLibFilePath(COMPILER_OPTIONS);
                }
                if (!fs.existsSync(sourcePath)) return undefined;
                const contents = fs.readFileSync(sourcePath).toString();
                return ts.createSourceFile(
                    sourceName,
                    contents,
                    COMPILER_OPTIONS.target!, // TODO: check why COMPILER_OPTIONS.target still has undefined type.
                    true,
                );
            },
            writeFile(fileName, data, writeByteOrderMark) {
                fs.writeFile(fileName, data, (err) => {
                    if (err) console.log(err);
                });
            },
            fileExists: (fileName) => fs.existsSync(fileName),
            readFile: (fileName) => fs.readFileSync(fileName, 'utf-8'),
            getDefaultLibFileName: () => defaultLibFileName,
            useCaseSensitiveFileNames: () => true,
            getCanonicalFileName: (fileName) => fileName,
            getCurrentDirectory: () => '',
            getNewLine: () => '\n',
        };
        return compilerHost;
    }
}

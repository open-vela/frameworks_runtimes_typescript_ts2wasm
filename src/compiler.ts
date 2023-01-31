import ts from 'typescript';
import binaryen from 'binaryen';
import TypeCompiler from './type.js';
import { Stack } from './utils.js';
import { fileURLToPath } from 'url';
import {
    BlockScope,
    funcDefs,
    FunctionScope,
    GlobalScope,
    ClassScope,
    Scope,
    ScopeKind,
    ScopeScanner,
} from './scope.js';
import { VariableScanner, VariableInit } from './variable.js';
import ExpressionCompiler from './expression.js';
import StatementCompiler from './statement.js';
import { WASMGen } from './wasmGen.js';
import path from 'path';

export const COMPILER_OPTIONS: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2015,
    strict: true,
    /* disable some features to speedup tsc */
    noResolve: true,
    skipLibCheck: true,
    skipDefaultLibCheck: true,
};

export class Compiler {
    private scopeScanner;
    private typeCompiler;
    private variableScanner;
    private variableInit;
    private exprCompiler;
    private stmtCompiler;
    private wasmGen;
    private _errorMessage: ts.Diagnostic[] | null = null;

    typeChecker: ts.TypeChecker | undefined;
    globalScopeStack = new Stack<GlobalScope>();
    nodeScopeMap = new Map<ts.Node, Scope>();
    binaryenModule = new binaryen.Module();
    currentScope: Scope | null = null;

    constructor() {
        this.scopeScanner = new ScopeScanner(this);
        this.typeCompiler = new TypeCompiler(this);
        this.variableScanner = new VariableScanner(this);
        this.variableInit = new VariableInit(this);
        this.exprCompiler = new ExpressionCompiler(this);
        this.stmtCompiler = new StatementCompiler(this);
        this.wasmGen = new WASMGen(this);
    }

    compile(fileNames: string[], optlevel = 0): void {
        const compilerOptions: ts.CompilerOptions = this.getCompilerOptions();
        const program: ts.Program = ts.createProgram(
            fileNames,
            compilerOptions,
        );
        this.typeChecker = program.getTypeChecker();

        const allDiagnostics = ts.getPreEmitDiagnostics(program);
        if (allDiagnostics.length > 0) {
            const formattedError = ts.formatDiagnosticsWithColorAndContext(
                allDiagnostics,
                {
                    getCurrentDirectory: () => {
                        return path.dirname(fileURLToPath(import.meta.url));
                    },
                    getCanonicalFileName: (fileNames) => {
                        return fileNames;
                    },
                    getNewLine: () => {
                        return '\n';
                    },
                },
            );
            console.log(formattedError);
            this._errorMessage = allDiagnostics as ts.Diagnostic[];
            throw Error('\nSyntax error in source file.');
        }

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

        if (process.env['TS2WASM_DUMP_SCOPE']) {
            this.dumpScopes();
        }

        /* Step4: code generation */
        this.binaryenModule.setFeatures(binaryen.Features.All);
        this.binaryenModule.autoDrop();

        this.wasmGen.WASMGenerate();

        /* Sometimes binaryen can't generate binary module,
            we dump the module to text and load it back.
           This is just a simple workaround, we need to find out the root cause
        */
        const textModule = this.binaryenModule.emitText();
        this.binaryenModule.dispose();

        try {
            this.binaryenModule = binaryen.parseText(textModule);
        } catch (e) {
            console.log(textModule);
            console.log(`Generated module is invalid`);
            throw e;
        }
        this.binaryenModule.setFeatures(binaryen.Features.All);
        this.binaryenModule.autoDrop();

        if (optlevel) {
            binaryen.setOptimizeLevel(optlevel);
            this.binaryenModule.optimize();
        }

        if (process.env['TS2WASM_VALIDATE']) {
            this.binaryenModule.validate();
        }
    }

    getScopeByNode(node: ts.Node): Scope | undefined {
        let res: Scope | undefined;

        while (node) {
            res = this.nodeScopeMap.get(node);
            if (res) {
                break;
            }
            node = node.parent;
        }

        return res;
    }

    get typeComp() {
        return this.typeCompiler;
    }

    get expressionCompiler(): ExpressionCompiler {
        return this.exprCompiler;
    }

    get errorMessage() {
        return this._errorMessage;
    }

    dumpScopes() {
        const scopeInfos: Array<any> = [];
        this.nodeScopeMap.forEach((scope) => {
            const scopeName = ScopeScanner.getPossibleScopeName(scope);
            let paramCount = 0;

            if (scope.kind === ScopeKind.FunctionScope) {
                const funcScope = <FunctionScope>scope;
                paramCount = funcScope.paramArray.length;
            }

            scopeInfos.push({
                kind: `${scope.kind}`,
                name: scopeName,
                param_cnt: paramCount,
                var_cnt: scope.varArray.length,
                stmt_cnt: scope.statements.length,
                child_cnt: scope.children.length,
            });

            const varInfos: Array<any> = [];
            if (scope.kind === ScopeKind.FunctionScope) {
                (<FunctionScope>scope).paramArray.forEach((v) => {
                    if (v.varName === '') {
                        /* Skip implicit variable */
                        return;
                    }
                    varInfos.push({
                        kind: 'param',
                        name: v.varName,
                        type: v.varType,
                        isClosure: v.varIsClosure,
                        modifier: v.varModifier,
                        index: v.varIndex,
                    });
                });
            }
            scope.varArray.forEach((v) => {
                if (v.varName === '') {
                    /* Skip implicit variable */
                    return;
                }
                varInfos.push({
                    kind: 'var',
                    name: v.varName,
                    type: v.varType,
                    isClosure: v.varIsClosure,
                    modifier: v.varModifier,
                    index: v.varIndex,
                });
            });

            console.log(
                `============= Variables in scope '${scopeName}' (${scope.kind}) =============`,
            );
            console.table(varInfos);

            const typeInfos: Array<any> = [];
            scope.namedTypeMap.forEach((t, name) => {
                typeInfos.push({
                    name: name,
                    type: t,
                });
            });

            console.log(
                `============= Types in scope '${scopeName}' (${scope.kind}) =============`,
            );
            console.table(typeInfos);
        });

        console.log(`============= Scope Summary =============`);
        console.table(scopeInfos);
    }

    private getCompilerOptions() {
        const opts: ts.CompilerOptions = {};
        for (const i of Object.keys(COMPILER_OPTIONS)) {
            opts[i] = COMPILER_OPTIONS[i];
        }
        return opts;
    }
}

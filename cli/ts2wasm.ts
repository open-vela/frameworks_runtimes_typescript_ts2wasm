/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import minimist from 'minimist';
import cp from 'child_process';
import fs, { constants } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ParserContext, CompileArgs } from '../src/frontend.js';
import log4js from 'log4js';
import { Logger, consoleLogger } from '../src/log.js';
import { Ts2wasmBackend } from '../src/backend/index.js';
import { WASMGen } from '../src/backend/binaryen/index.js';
import { CCodeGen } from '../src/backend/c/index.js';
import { default as logConfig } from '../config/log4js.js';
import { SyntaxError } from '../src/error.js';
import { DumpAST } from '../src/dump_ast.js';

interface HelpMessageCategory {
    General: string[];
    Compile: string[];
    Output: string[];
    Validation: string[];
    Other: string[];
}

function parseOptions(optionPath: string) {
    const helpFile = fs.readFileSync(optionPath, 'utf8');
    const helpConfig = JSON.parse(helpFile);
    return helpConfig;
}

function showVersion(packagePath: string) {
    const packageFile = fs.readFileSync(packagePath, 'utf8');
    const packageConfig = JSON.parse(packageFile);
    const version = packageConfig.version;
    console.log('Version ' + version);
    process.exit(0);
}

function showHelp(helpConfig: any) {
    const printOption = {
        indent: 4,
        padding: 28,
        eol: '\n',
    };
    const categories: HelpMessageCategory = {
        General: [],
        Compile: [],
        Output: [],
        Validation: [],
        Other: [],
    };

    Object.keys(helpConfig).forEach((commandKey) => {
        const helpMessage: string[] = [];
        const option = helpConfig[commandKey];
        let comment = '';
        while (comment.length < printOption.indent) {
            comment += ' ';
        }
        comment += '--' + commandKey;
        if (option.alias) {
            comment += ', -' + option.alias;
        }
        while (comment.length < printOption.padding) {
            comment += ' ';
        }
        comment += option.description;
        helpMessage.push(comment);
        if (option.category) {
            const categoryKey = <keyof HelpMessageCategory>option.category;
            categories[categoryKey].push(helpMessage[0]);
        } else {
            categories['Other'].push(helpMessage[0]);
        }
    });

    const optionMessage: string[] = [];
    Object.keys(categories).forEach((category) => {
        const categoryKey = <keyof HelpMessageCategory>category;
        optionMessage.push(
            printOption.eol + ' ' + categoryKey + printOption.eol,
        );
        optionMessage.push(categories[categoryKey].join(printOption.eol));
    });
    optionMessage.join(printOption.eol);

    const otherMessage = [
        'EXAMPLES\n',
        '  ' + 'node' + ' build/cli/ts2wasm.js' + ' --help',
        '  ' +
            'node' +
            ' build/cli/ts2wasm.js' +
            ' sample.ts' +
            ' --output' +
            ' sample.wasm',
        '  ' +
            'node' +
            ' build/cli/ts2wasm.js' +
            ' sample.ts' +
            ' --output' +
            ' sample.wasm' +
            ' --wat',
        '  ' +
            'node' +
            ' build/cli/ts2wasm.js' +
            ' sample.ts' +
            ' --output' +
            ' sample.wasm' +
            ' --validate' +
            ' functionName' +
            ' param1' +
            ' param2',
        '\n',
        'OPTIONS',
    ];
    const outMessage = otherMessage.concat(optionMessage);
    console.log(outMessage.join(printOption.eol));
    process.exit(0);
}

export function writeFile(filename: string, contents: any, baseDir = '') {
    const dirPath = path.resolve(baseDir, path.dirname(filename));
    const filePath = path.join(dirPath, path.basename(filename));
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(filePath, contents);
}

function getAbsolutePath(filename: string, baseDir = '') {
    const dirPath = path.resolve(baseDir, path.dirname(filename));
    const filePath = path.join(dirPath, path.basename(filename));
    return filePath;
}

function createBackend(args: any, parserCtx: ParserContext): Ts2wasmBackend {
    if (args.c) {
        return new CCodeGen(parserCtx);
    }
    return new WASMGen(parserCtx);
}

function main() {
    try {
        const args = minimist(process.argv.slice(2));
        const dirname = path.dirname(fileURLToPath(import.meta.url));
        const optionPath = path.join(
            dirname,
            '..',
            '..',
            'cli',
            'options.json',
        );
        const packagePath = path.join(dirname, '..', '..', 'package.json');
        const optionConfig = parseOptions(optionPath);
        const optionKey: string[] = [];
        const compileArgs: CompileArgs = {};

        Object.keys(optionConfig).forEach((commandKey) => {
            const option = optionConfig[commandKey];
            if (option.category.toString() === 'Compile') {
                compileArgs[commandKey] = args[commandKey];
            }
        });

        Object.keys(optionConfig).forEach((commandKey) => {
            optionKey.push(commandKey);
            if (optionConfig[commandKey].alias) {
                optionKey.push(optionConfig[commandKey].alias);
            }
        });
        Object.keys(args).forEach((arg) => {
            if (arg !== '_' && optionKey.indexOf(arg) === -1) {
                console.warn("WARNING: Unknown option '" + arg + "'");
            }
        });

        if (args.help || args.h) {
            showHelp(optionConfig);
        }
        if (args.version || args.v) {
            showVersion(packagePath);
        }
        const sourceFileList: string[] = [];
        let paramString = '';
        for (let i = 0; i < args._.length; i++) {
            const arg = args._[i];
            if (typeof arg === 'string' && fs.statSync(arg).isFile()) {
                fs.accessSync(arg, constants.R_OK);
                sourceFileList.push(arg);
            } else {
                paramString += arg.toString();
                paramString += ' ';
            }
        }

        if (!sourceFileList.length && !paramString) {
            showHelp(optionConfig);
        }

        if (!sourceFileList.length) {
            throw new Error('No ts file to be handled.');
        }

        if (args.dumpast) {
            DumpAST(sourceFileList);
            return;
        }

        /* Step1: Semantic checking, construct scope tree */
        const parserCtx = new ParserContext();
        parserCtx.parse(sourceFileList, compileArgs);
        /* Step2: Backend codegen */
        const backend = createBackend(args, parserCtx);
        backend.codegen(compileArgs);

        /* Step3: output */
        /* Set up specified base directory */
        const baseDir = path.normalize(args.baseDir || '.');
        let generatedWasmFile = '';
        if (args.output || args.o) {
            if (args.output) {
                generatedWasmFile = args.output;
            }
            if (args.o) {
                generatedWasmFile = args.o;
            }
            const sourceMapCfg = {
                sourceMap: args.sourceMap,
                name: generatedWasmFile.split('.')[0], // file name
            };
            const output = backend.emitBinary(sourceMapCfg);
            writeFile(generatedWasmFile, output, baseDir);
            console.log(
                "The wasm file '" + generatedWasmFile + "' has been generated.",
            );
            if (args.sourceMap) {
                const sourceMap = backend.emitSourceMap(sourceMapCfg.name);
                writeFile(`${sourceMapCfg.name}.wasm.map`, sourceMap, baseDir);
                console.log(
                    `The source map file ${sourceMapCfg.name}.wasm.map has been generated.`,
                );
            }
            if (args.validate) {
                const cmd = `iwasm -f ${args.validate} ${getAbsolutePath(
                    generatedWasmFile,
                )} ${paramString}`;
                const ret = cp.execSync(cmd);
                console.log('WebAssembly output is: ' + ret);
            }
            if (args.wat) {
                let generatedWatFile = '';
                if (generatedWasmFile.endsWith('.wasm')) {
                    generatedWatFile = generatedWasmFile.replace(
                        '.wasm',
                        '.wat',
                    );
                } else {
                    generatedWatFile = generatedWasmFile.concat('.wat');
                }

                const output = backend.emitText();
                writeFile(generatedWatFile, output, baseDir);
                console.log(
                    "The wat file '" +
                        generatedWatFile +
                        "' has been generated.",
                );
            }
        } else if (args.wat || args.validate) {
            console.warn('WARNING: No wasm file specified.');
        } else {
            console.log(backend.emitText());
        }

        backend.dispose();
    } catch (e) {
        if (e instanceof SyntaxError) {
            /* Syntax error are reported by frontend.ts */
            console.log(e.message);
            process.exit(1);
        } else {
            /* TODO: print line number in error message */
            consoleLogger.error(
                (<Error>e).message,
                '\n',
                `Error details is in '${logConfig.appenders.file.filename}'`,
            );
            Logger.error(e);
            log4js.shutdown(() => process.exit(1));
        }
    }
}

main();

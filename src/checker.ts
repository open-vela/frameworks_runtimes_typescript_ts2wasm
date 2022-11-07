import ts from 'typescript';
import fs from 'fs';
import pathUtil from 'path';

export let hasError = false;

export function checkTSFiles(rootFiles: string[]) {
    const createProgram = ts.createSemanticDiagnosticsBuilderProgram;
    const configPath = ts.findConfigFile(
        '../../',
        ts.sys.fileExists,
        'tsconfig.json',
    );
    if (!configPath) {
        throw new Error("Could not find a valid 'tsconfig.json'.");
    }
    const compilerOptions = getTSConfig(configPath);
    const host = ts.createWatchCompilerHost(
        rootFiles,
        compilerOptions,
        ts.sys,
        createProgram,
        reportDiagnostic,
        reportWatchStatusChanged,
    );
    const origCreateProgram = host.createProgram;
    host.createProgram = (
        rootNames: ReadonlyArray<string> | undefined,
        options,
        host,
        oldProgram,
    ) => {
        return origCreateProgram(rootNames, options, host, oldProgram);
    };
    const origPostProgramCreate = host.afterProgramCreate!;
    host.afterProgramCreate = (program) => {
        origPostProgramCreate(program);
    };

    const watch = ts.createWatchProgram(host);
    watch.close();
}

function reportDiagnostic(diagnostic: ts.Diagnostic) {
    const errorMessage = getErrorMessage(diagnostic);
    if (errorMessage) {
        hasError = true;
    }
    console.error(errorMessage);
}

function getErrorMessage(diagnostic: ts.Diagnostic) {
    let message = '';
    if (diagnostic.file) {
        const position = diagnostic.file.getLineAndCharacterOfPosition(
            diagnostic.start!,
        );
        message += `\n${diagnostic.file.fileName}(${position.line + 1},${
            position.character + 1
        }): `;
    }
    message += `\nERROR TS${diagnostic.code}: ${diagnostic.messageText}`;
    return message;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
function reportWatchStatusChanged() {}

function getTSConfig(fileName: string) {
    const configText = fs.readFileSync(fileName, { encoding: 'utf8' });
    const result = ts.parseConfigFileTextToJson(fileName, configText);
    const configObject = result.config;
    const configParseResult = ts.parseJsonConfigFileContent(
        configObject,
        ts.sys,
        pathUtil.dirname(fileName),
    );
    return configParseResult.options;
}

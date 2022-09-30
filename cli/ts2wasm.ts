import minimist from 'minimist';
import cp from 'child_process';
import fs from 'fs';
import path from 'path';
import { Compiler } from '../src/compiler.js';

function showHelp() {
    console.log(
        `  
        --wasmFile            Write the compiled wasm file.                   
        --watFile             Write the compiled wat file.
        --validate            Use WAMR to test the function
        `,
    );
    process.exit(0);
}

function writeFile(filename: string, contents: any, baseDir = '') {
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

// entry point
const args = minimist(process.argv.slice(2));
const sourceFileList: string[] = [];
let paramString = '';
for (let i = 0; i < args._.length; i++) {
    const arg = args._[i];
    if (typeof arg == 'string' && arg.includes('.ts')) {
        sourceFileList.push(arg);
    } else {
        paramString += arg.toString();
        paramString += ' ';
    }
}
const compiler = new Compiler();
try {
    compiler.compile(sourceFileList);
} catch (e) {
    console.error(e);
    process.exit(1);
}

// Set up base directory
const baseDir = path.normalize(args.baseDir || '.');
if (args.help) {
    showHelp();
}
if (args.wasmFile) {
    const output = compiler.binaryenModule.emitBinary();
    writeFile(args.wasmFile, output, baseDir);
    if (args.validate) {
        const cmd = `iwasm -f ${args.validate} ${getAbsolutePath(
            args.wasmFile,
        )} ${paramString}`;
        const ret = cp.execSync(cmd);
        console.log('WebAssembly output is: ' + ret);
    }
}
if (args.watFile) {
    const output = compiler.binaryenModule.emitText();
    writeFile(args.watFile, output, baseDir);
}

# run generated module

This document record how to run generated .wasm module

## run generated module by V8

### prerequisites
 - v8 version 11.3.0 or higher
 - wasm file should not contain any related opcodes now, otherwise the result will unexpected

   when using node to generate .wasm module, `--disableAny` might be added, for example:

   `node build/cli/ts2wasm.js --disableAny --opt 0 xx.ts -o xxx.wasm`

### steps

 - cd `load.js` folder

    `cd tools/module_gen`

 - run `load.js` by d8 with `experimental-wasm-gc` option:

    `d8 --experimental-wasm-gc load.js -- xxx.wasm funcName`

    the parameter `xxx.wasm` is the module you want to run, and `funcName` is the export function you want to execute in the module.

 - export function parameters

   the export function maybe accept parameters, you can pass them by pairs, the first one of the pair represents the type of argument, 0: boolean, 1: number 2: string(**currently V8 doesn't support**). For example, the export function you want to execute is:

   `export function foo(x: number, y: boolean, z: number)`

   so you maybe can run:

   `d8 --experimental-wasm-gc load.js -- xxx.wasm foo 1 10 0 false 1 11`

   the above command expected equal to call:
   `foo(10, false, 11)`

   because `boolean` is represent by `i32` in wasm, so the command below equals to the command above:

   `d8 --experimental-wasm-gc load.js -- xxx.wasm foo 1 10 1 0 1 11`
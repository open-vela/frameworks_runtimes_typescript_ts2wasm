# ts2wasm

ts2wasm is a compiler which compiles TypeScript source code directly into WebAssembly bytecode. It will leverage WebAssembly's GC proposal. The strategy is to apply static compilation for those with type information, while supporting dynamic type (any) through a builtin runtime library.

> **Note: This project is highly experimental and under active development, DO NOT use in production**

## Build and run

1. install the dependencies
    ``` bash
    npm install
    ```

2. build

    ``` bash
    npm run build
    ```

3. run

    ``` bash
    cd build
    node cli/ts2wasm.js <source> -o out.wasm
    ```

## Test

``` bash
npm run test
```

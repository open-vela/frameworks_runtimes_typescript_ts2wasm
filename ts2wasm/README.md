<div align="center">
  <h1><code>ts2wasm-compiler</code></h1>

  <p>
    <strong>Toolchain for compiling TypeScript to WasmGC</strong>
  </p>

  <p>
  <a href="https://github.com/bytecodealliance/governance/blob/main/SIGs/SIG-TypeScript-Compilation/proposal.md"><img src="https://img.shields.io/badge/SIG-TypeScript--Compilation-blue"></a>
  <a href="https://github.com/WebAssembly/gc"><img src="https://img.shields.io/badge/-WasmGC-brightgreen"></a>
  
  </p>
</div>

## Overview

`ts2wasm-compiler` is a toolchain for compiling TypeScript source code directly into [WasmGC](https://github.com/WebAssembly/gc) bytecode. The strategy is to apply static compilation for those with type information, while supporting dynamic type (any) through builtin runtime library or host APIs.

> **Note**: **This project is highly experimental and under active development, DO NOT use in production**

## Features

- **garbage collection**. `ts2wasm-compiler` leverage WebAssembly GC proposal, which can benefit from runtime's GC capability.
- **optimization**. `ts2wasm-compiler` uses binaryen as backend, which can benefit from binaryen's powerful optimization capabilities.
- **small footprint**. Data structures in source code is represented as WasmGC types, which avoids the requirement for `memory allocator` and `garbage collector` inside wasm module.
- **static compilation**. Type information in TypeScript source code is used to create static WasmGC types, which avoids the overhead of dynamic type checking.
- **dynamic typing**. `any` type in TypeScript source code is supported by builtin runtime library or host APIs. In browser environment `any` is delegate to JavaScript engine.
- **duck typing**. `ts2wasm-compiler` will generate runtime type information for name based field accessing on static types (currently only supported by [WAMR gc branch](https://github.com/bytecodealliance/wasm-micro-runtime/tree/dev/gc_refactor))

## Getting Started

### Build ts source code

1. install the dependencies
    ``` bash
    npm install
    ```

2. build

    ``` bash
    npm run build
    ```

3. use the compiler

    ``` bash
    cd build
    node cli/ts2wasm.js <source> -o out.wasm
    ```

### Execute the generated module

- Execute on WAMR

    Refer to [iwasm_gc](./runtime-library/README.md)

- Execute on browser

    Refer to [ts2wasm playground](./tools/playground/README.md)

### Source debuggin (browser only)

To debug the generated wasm module, use `--debug --sourceMap` command line options to generate wasm module containing source map.

```bash
node cli/ts2wasm.js <source> -o out.wasm --debug --sourceMap
```

## Contributing

### Testing

#### Test compilation

This will compile our samples and check if the compiler exit normally, it doesn't guarantee the correctness of the generated wasm module.

``` bash
npm run test
```

#### Validate execution on WAMR

See [validate/wamr](./tools/validate/wamr/README.md) for how to validate results on WAMR

#### Validate execution on browser

See [validate/browser](./tools/validate/browser/README.md) for how to validate results on browser

> `ts2wasm-compiler` is under development, some test cases can't pass validation yet.

### Code Formatting

Code is required to be formatted with `npm run lint`.

### Submitting Changes

Changes to `ts2wasm-compiler` are managed through github [pull requests](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests) (PR). 

## License

`ts2wasm-compiler` uses the same license as LLVM: the Apache 2.0 license with the LLVM exception. See the [LICENSE](./LICENSE) file for details. This license allows you to freely use, modify, distribute and sell your own products based on WAMR. Any contributions you make will be under the same license.



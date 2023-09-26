<div align="center">
  <h1><code>Wasmnizer-ts</code></h1>

  <p>
    <strong>Toolchain for compiling TypeScript to WasmGC</strong>
  </p>

  <p>
  <a href="https://github.com/WebAssembly/gc"><img src="https://img.shields.io/badge/-WasmGC-brightgreen"></a>

  </p>
</div>

## Overview

`Wasmnizer-ts` utilizes [WasmGC](https://github.com/WebAssembly/gc) to compile TypeScript source code into WebAssembly bytecode, and support dynamic type (such as any) through host APIs. The `Wasmnizer-ts` now supports a strict subset of TypeScript and continuously strives to accommodate more semantics.

There are three components in `Wasmnizer-ts`:
- `ts2wasm-compiler`: a compiler for compiling TypeScript source code into WasmGC bytecode.
- `ts2wasm-stdlib`: standard library implemented in ts source code, will be compiled with application together. See [standard library](./doc/standard-library/index.md).
- `ts2wasm-runtime-library`: runtime libraries for exposing host APIs required for running the generated wasm module, including:
    1. `libdyntype`: support dynamic objects, see API spec [here](./doc/libdyntype_api_spec.md). We have proposed a [WASI proposal](https://github.com/WebAssembly/WASI/issues/552).
    2. `libstruct-indirect`: access WasmGC struct fields through index calculated during runtime, see API spec [here](./doc/libstruct_indirect_api_spec.md). These APIs are used to emulate the behaviour of the [proposed struct.get/set_indirect opcode](https://github.com/WebAssembly/gc/issues/397).
    3. `libstd`: standard library implemented in native, such as `console.log`, see [standard library](./doc/standard-library/index.md).

> **Note**: **This project is highly experimental and under active development, DO NOT use in production**

## Features

- **garbage collection**. `ts2wasm-compiler` leverage WebAssembly GC proposal, which can benefit from runtime's GC capability.
- **optimization**. `ts2wasm-compiler` uses binaryen as backend, which can benefit from binaryen's powerful optimization capabilities.
- **small footprint**. Data structures in source code is represented as WasmGC types, which avoids the requirement for `memory allocator` and `garbage collector` inside wasm module.
- **static compilation**. Type information in TypeScript source code is used to create static WasmGC types, which avoids the overhead of dynamic type checking.
- **dynamic typing**. `any` and other dynamic types in TypeScript source code are supported by host APIs.

## Execution environment

The wasm module generated by `ts2wasm-compiler` is designed to be executed in a WasmGC runtime environment. The runtime should provide the following capabilities:
  - **WebAssembly proposals:**
    - **[WasmGC](https://github.com/WebAssembly/gc) (mandatory)**: WasmGC proposal, which is a garbage collection mechanism for WebAssembly.
      > Note: the GC opcode generated by binaryen is slightly different than [GC MVP](https://github.com/WebAssembly/gc/blob/main/proposals/gc/MVP.md), please see [here](https://docs.google.com/document/d/1DklC3qVuOdLHSXB5UXghM_syCh-4cMinQ50ICiXnK3Q/edit#heading=h.9dwoku9340md) for details.
    - **[Exception handling](https://github.com/WebAssembly/exception-handling) (required by try-catch statements)**: exception handling proposal, which adds exception handling mechanism to WebAssembly.
    - **[stringref](https://github.com/WebAssembly/stringref) (required by stringref feature)**: reference-typed strings proposal, provide a language independent string representation.
  - **APIs:**
    - **[libdyntype API](./doc/libdyntype_api_spec.md) (required by dynamic typing)**: APIs for supporting dynamic objects.
    - **[libstruct-indirect API](./doc/libstruct_indirect_api_spec.md) (required by `interface` type)**: APIs for accessing WasmGC struct fields through index calculated during runtime.
    - **libstd API (required by standard libraries)**: APIs for providing standard libraries from host environment.

<<<<<<< PATCH SET (f3e864 Wasmnizer-ts first version (#1))
`Wasmnizer-ts` currently provides `libdyntype API`, `libstruct-indirect API` and `libstd API` based on [WebAssembly Micro Runtime (WAMR)](https://github.com/bytecodealliance/wasm-micro-runtime/tree/dev/gc_refactor), and provides part of `libdyntype API` for chrome browser. Please see [feature list](./doc/developer-guide/feature_list.md) for supporting status of each feature.
=======
`Wasmnizer-ts` currently implemented host APIs on multiple environments:
  - [WebAssembly Micro Runtime (WAMR)](https://github.com/bytecodealliance/wasm-micro-runtime/tree/dev/gc_refactor): `libdyntype API`, `libstruct-indirect API` and `libstd API`
  - chrome browser and nodejs (20.6.1+): part of `libdyntype API` implemented with JavaScript

Please see [feature list](./doc/developer-guide/feature_list.md) for supporting status of each feature.
>>>>>>> BASE      (805e8e add code_of_conduct, contributing agreement, and security.md)

Please goto [Getting Started](./doc/getting_started.md) for how to use the project and [Introduction](./doc/developer-guide/index.md) for more details.

## Contributing

### Testing

#### Test compilation

This will compile our samples and check if the compiler exit normally, it doesn't guarantee the correctness of the generated wasm module.

``` bash
npm run test
```

#### Validate execution on WAMR

See [validate/wamr](./tools/validate/wamr/README.md) for how to validate results on WAMR

### Code Formatting

Code is required to be formatted with `npm run lint`.

### Submitting Changes

Changes to `Wasmnizer-ts` are managed through github [pull requests](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests) (PR).

## License

`Wasmnizer-ts` uses the same license as LLVM: the Apache 2.0 license with the LLVM exception. See the [LICENSE](./LICENSE) file for details. Any contributions you make will be under the same license.

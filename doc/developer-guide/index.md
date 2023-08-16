# ts2wasm developer guide

TypeScript is a typed superset of JavaScript, its rich type information has been used by several tools to achieve refactoring, linting and so on, but it need to be transpiled to pure JavaScript code before executing, which lost all the type information.

Ts2wasm compiler leverage WasmGC to apply static compilation as much as possible, and reserves some escape hatch for dynamic types. This documents describe the supported language features and some known limitations.

## Type system overview

Ts2wasm compiler treats TypeScript as a mixed typed language, there are static types such as `Class`, `Primitives`, as well as dynamic types such as `any` and `union`, the developers should be aware that different types will have different performance impact, it is always recommended to reduce the usage of dynamic types.

|  ts type | wasm type | access strategy | performance overhead |
| :----: | :----: | :----: | :----: |
| boolean | i32 | static | low |
| number | f64 | static | low |
| string | struct / stringref | static | low |
| class | struct | static | low |
| function | func | static | low |
| interface | struct | static + reflection | medium |
| union | externref | dynamic | high |
| any | externref | dynamic | high |

## Supported features

Please refer to [feature list](./ts2wasm_feature_list.md)

It's hard to enumerate every detailed syntax in the list, please refer to our [test cases](../../tests/samples/) for more samples.

---
id: lsh1yzapnp9l197562ed91p
title: Builtin
desc: ''
updated: 1677749371481
created: 1677725803438
---
## New Structure
### BuiltInObjAccess
- Basic： ClassName.staticMethod
- Example： `Math.sqrt(...)`, `Array.isArray(...)`
- Solution： We achieved the class and the static method in ts, use compiler compile the ts file to wat file, add the wat function to targetModule for further call.
- Structure: We only need to record the obj name and the prop name.
    ```typescript
    {
        objName: string,
        propName: string,
    }
    ```
### BuiltInInstAccess
- Basic： instance.method / instance.field
- Example： `stringInst.concat(...)`, `stringInst.length`
- Solution： We achieved the method in ts, use compiler compile the ts file to wat file, add the wat function to targetModule for further call.
- Key problem: We regard the instance `stringInst` as one of the call params, so a new Access class should be created to distinguish it from normal method calls.
- Structure:
    ```typescript
    {
        // if the propertyAccess node's parent node is callExpression.
        // if true, call builtin methods in wasmCallExpr. (stringInst.concat(...))
        // if false, call builtin methods in wasmProperExpr, (stringInst.length)
        isCallExpr;
        // the instance's wasm value
        value: WasmValue,
        propName: string,
        // the whole access's type, we may need this to get the builtin function's return type
        exprType: Type,
    }
    ```
## Generate builtin lib
Run `npm run build`


## How to add builtin functions
### custom ts file

We regard this kind of built-in as `class` and its `static method`, so we will create a new class and its methods.

Example: `Math.sqrt`

Steps:

    1. Create a ts file `Math.ts` in dir `/ts2wasm/lib/builtin/tsFile`
    2. Write a class and its method in the ts file, this file will be compiled to a wat file after building.
        ```typescript
        export class Math {
            static pow(x: number, y: number): number {
                let res = 1;
                let power = y < 0 ? -y : y;
                while (power > 0) {
                    res = res * x;
                    power--;
                }
                res = y < 0 ? 1 / res : res;
                return res;
            }
        }
        ```
    3. Check if the built-in funcName exists in `BuiltinNames.MathBuiltInFuncs`.
    4. Check if wat funcs have been added in `addBuiltInFunc` in `/ts2wasm/lib/builtin/addBuiltIn.ts`.
    5. Re-build the project.

### Invoke binaryen APIs
If it is easier to generate wat file by invoking binaryen APIs, we can use these APIs.
Specially, we can use decorator `@binaryen` to explicitly record that the functions in  API wat file will be added instead of compiled by the compiler.

Example: `Math.sqrt`

Steps:

    1. Add `@binaryen` in the sqrt method.
        ```typescript
        export class Math {
            @binaryen
            static sqrt(x: number): number {
                return Math.sqrt(x);
            }
        }
        ```
    2. Implement the `sqrt` method through invoking binaryen API in `/ts2wasm/lib/builtin/initBuiltInAPI.ts`
    3. Check if the built-in funcName exists in `BuiltinNames.MathBuiltInFuncs`.
    4. Check if wat funcs have been added in `addBuiltInFunc` in `/ts2wasm/lib/builtin/addBuiltIn.ts`.
    5. Re-build the project.
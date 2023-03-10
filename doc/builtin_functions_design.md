# Built-In function implementation
## Built-In function classification
### Ordinary functions
1. Object instance's bulit-in functions: use a variable with a certain type to invoke.
    - String:  `charAt`, `charCodeAt`, `concat`...
    - Array: `concat`, `join`, `push`...
    - Object: `toString`, `isPrototypeOf`...
    - Number: `toFixed`, `toPrecision`...
    - Boolean: `valueOf`...
2. Object's built-in functions: no need to create an instance to invoke
    - Math: `sqrt`...
    - Array: `isArray`...
    - Object: `keys`...
    - console: `log`...
    - JSON: `parse`...
3. Directly invoke:
    - `setTimeout`

### Helper functions
- `typeof`
- `instanceof`
- `async`
- `await`
- `Promise`

## Basic ideas
Currently, we only consider about ordinary functions：
1. `Object instance's bulit-in functions convention` can be regarded as `class instances invoke class methods`.
2. `Object's built-in functions convention` can be regarded as `class invoke static methods`.
3. Directly invoke is an ordinary function call.

In target compilation, we want to generate the function call opcode directly, which means that the corresponding wasm functions should be found in target wasm module. Depending on the builtin function, we can choose one of the following two methods:
1. Implement all class, methods and functions in typescript, generate corresponding wat files during build, added the generated wasm functions to target wasm module.
2. Insert a function import opcode in target module's import session.

## Way to implement method 1
When implementing built-in functions in ts in advance, we may miss the built-in ts types in the target compilation process, which will cause the compilation error. So there are two ways to solve this problem:
1. Manually record all built-in ts types (mainly function types and class types) based on ts implementation to target scope tree, so that the built-in call is insensible.
2. Don't care the built-in ts types, create new structures to record the built-in convention information, according to ts implementation function names to invoke built-in functions.


**Now, we have implemented method 2.**

### Method 2
#### New Structure
##### BuiltInObjAccess
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
##### BuiltInInstAccess
- Basic： instance.method / instance.field
- Example： `stringInst.concat(...)`, `stringInst.length`
- Solution： We achieved the method in ts, use compiler compile the ts file to wat file, add the wat function to targetModule for further call.
- Key problem: We regard the instance `stringInst` as one of the call params (like `this`), so the instance's wasm value should be recorded.
- Structure:
    ```typescript
    {
        // the instance's wasm value
        value: WasmValue,
        propName: string,
        // we should get `stringInst.length` expressionRef in `_loadFromAccessInfo`, in which we only can get accessInfo, so we should record expression type in the structure.
        exprType: Type,
    }
    ```

#### How to add builtin functions
##### custom ts file

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

##### Invoke binaryen APIs
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

#### How to generate builtin lib
Run `npm run build`


## Way to implement method 2
We need to use a runtime library to run. So there are two steps to implement method 2.
1. In compilation phase, insert a function import in import section in advance, when meeting built-in function in target compilation, call the function directly.
2. In execution phase, implement this function.

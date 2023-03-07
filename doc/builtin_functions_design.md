# Built-In function implementation
## Built-In function classification
### Built-in functions in the JavaScript standard library
1. object instance's bulit-in functions: use a variable with a certain type to invoke.
    - String:  `charAt`, `charCodeAt`, `concat`...
    - Array: `concat`, `join`, `push`...
    - Object: `toString`, `isPrototypeOf`...
    - Number: `toFixed`, `toPrecision`...
    - Boolean: `valueOf`...
2. Object's built-in functions: no need to create an instance to invoke
    - Math: `sqrt`...
    - console: `log`...
    - JSON: `parse`...
3. Directly invoke:
    - `setTimeout`

### Helper functions in TypeScript
- `Array.isArray`
- `Object.keys`
- `typeof`
- `instanceof`

### Built-in functions in the TypeScript standard library
- `async`
- `await`
- `Promise`

## Basic ideas
### Built-in functions in the JavaScript standard library
Built-in functions will be regrad as `Identifier` in AST, we should record all built-in function names, especially, object instance's bulit-in functions should bind to its type.
1. Object's built-in functions
    - We should both record the property access identifier's name and the property's identifier's name, get the result in `CallExpr`.
    - Approach
        - `IdentifierExpression` generation:
        When identifier name is in built-in list, return an identifierExpression with the built-in identifier name.
        - Add `AccessType` kind -> `BuiltInObj`, add `BuiltInObjAccess` class to represent built-in identifiers.
        - create `BuiltInObjAccess` in `_createAccessInfo` when meeting the built-in identifier.
        - `IdentifierExpr` handler:
        Always return `AccessInfo` regardless `byref`.
        - `PropertyAccessExpr` handler:
        `accessInfo instanceof BuiltInObjAccess` means we should record the built-in property name.
        - `_loadFromAccessInfo` handler:
        add property name in `BuiltInObjAccess`.
        - `CallExpr` handler:
        call built-in functions, pass arguments.
2. object instance's bulit-in functions
    - We should record the instance's wasmValue and the property's identifier's name, get the result in `CallExpr`.
    - Approach
        - `PropertyAccessExpression` generation:
        When property expr's type is in built-in type, just record the property identifier name, not generate the propertyAccessExpression type.
        - Add `AccessType` kind -> `BuiltInInst`, add `BuiltInInstAccess` class to represent instance value and prop name.
        - `PropertyAccessExpr` handler:
        Record built-in property name in when handling the corresponding ts types.
        - `CallExpr` handler:
        call built-in functions, pass arguments.

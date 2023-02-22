# Variable/property access processing

Property access may be used in several ways:

1. get objects' field value (a.b.c)
2. get objects' method (a.b.f())
3. access namespace's fields (NamespaceA.x)
4. access type's fields (Array.new, Number.parse)
5. set objects' field value (a.b = 1)

It can be divided into this three categories:
1. Get value from variable (**byval**)
2. Get the reference of a variable, will be used as an assignment target (**byref**)
3. Non-value access (scope, type)

It may become a child node of:
- BinaryExpression
	- as left hand  --> set value
	- as right hand  --> get value
- CallExpression
	- as parameter --> get value
	- as callee --> call / get value
- VariableDeclaration
	- as initializer --> get value
- PropertyAccessExpression
    - nested access

## Challenge

In native world, everything is stored in memory, and the reference is just an address. `byval` get the value, `byref` get the address
But in WebAssembly GC proposal, the `byref` can be many things:
- `index` for local variable
- `index` for global variable
- `struct ref` or `array ref` for wasm struct/array
- `field index` + `struct ref` for wasm struct field
- `element index` + `array ref` for array element

And there are also non-value identifiers
- type
- scope

## Basic ideas

- `IdentifierExpr` handler

    1. `IdentifierExpr` handler receives a `byref : boolean` parameter, if it's true, return `AccessInfo` rather than `binaryen.ExpressionRef`
    2. Search neareast variable / function / scope according to the identifier, the result can be:
        - local variable
        - closure variable
        - global variable
        - function
        - closure
        - type (class, Array)
        - namespace

- `PropertyAccessExpr` handler

    1. `PropertyAccessExpr` handler receives a `byref : boolean` parameter, if it's true, return `AccessInfo` rather than `binaryen.ExpressionRef`
    2. Inner `PropertyAccessExpr` handler always access by value
    3. `PropertyAccessExpr` firstly get result of left expression:
        - `binaryen.ExpressionRef`: treat as object reference
        - `TypeAccess` or `ScopeAccess`: search identifier in corresponding Type or scope

- `AccessInfo`

    ``` typescript
    enum AccessType {
        Local,
        Global,
        Function,
        Struct,
        Array,
        AnyRef,
        Type,
        Scope,
    }

    class AccessBase {
        accessType: AccessType
    }

    class LocalAccess extends AccessBase {
        index: number,
        varType: binaryenCAPI.TypeRef
    }

    class GlobalAccess extends AccessBase {
        index: number,
        varType: binaryenCAPI.TypeRef
    }

    class FunctionAccess extends AccessBase {
        funcName: string,
        closure: binaryen.ExpressionRef,
        funcType: TSFunction
    }

    class StructAccess extends AccessBase {
        ref: binaryen.ExpressionRef,
        fieldIndex: number,
        varType: binaryenCAPI.TypeRef
    }

    class ArrayAccess extends AccessBase {
        ref: binaryen.ExpressionRef,
        index: number,
        elemType: binaryenCAPI.TypeRef
    }

    class DynAccess extends AccessBase {
        ref: binaryen.ExpressionRef,
        fieldName: string
    }

    class TypeAccess extends AccessBase {
        type: Type
    }

    class ScopeAccess extends AccessBase {
        scope: Scope
    }
    ```

## Class method

Class method itself is a scope, and it has a corresponding type `TSFunction`, we can get type from scope, but can't get scope from type.

The problem is:
- When we access a class's field, we can only get the type information
- But when we want to call a method, we need the scope information

There are some possible solutions:
1. Don't use FunctionScope during invoke, just use type
    - scope information is required by closure and default parameter
    - implicit variable/parameters are recorded in scope rather than type
2. Add the binding between scope and type
    - multiple scope may have the same type
3. Find the TSClass scope during processing property access expression
    - it's hard to know which scope the variable belongs to, e.g. it may be returned from a function
4. Record method's function scope during generating type information

``` typescript
function a() {
    class A {
        test () {}
    }
    return new A();
}

a().test(); // from current scope we don't know where class A is defined
```

Current decision:
- normal functions still use function scope
- method use type, closure and default parameter not support

 # ts2wasm name mangling rules

## Function name

 1. anonymous functions (arrow function, function expression)

    we use `anonymous_index` to identify them. for example `anonymous_0`

 2. function declaration

    in order to acquire a unique name, we conbine the name of its parent level function to generate a unique name for them, the rule is
    `parent_level_function_name | current_function_name`.

    for example:
    ```typescript
    function foo() {
        function bar() {

        }
    }
    ```
    the name of function `foo` is `foo` because it's a top level function,  and the name of function `bar` is `foo|bar`

 3. class member function

    3.1 constructor

    the rule is class name + '_constructor', for example `XXX_constructor`.

    3.2 getter/setter

    the rule is class name + '_get/set_' + function name, for example `XXX_get_foo`, `XXX_set_foo`

    3.3 member function

    the rule is class name + '_' + function name, for example `XXX_foo`.

## Type name mangling rules of  `binaryen`

 1. function type

    the rule is `paramType1_paramType2_...=>_returnType`, for example,

    ```typescript
    (i: number, j: false) => number
    ```
    the type name in binaryen is `f64_i32_=>_f64`

 2. GC type

    2.1 struct type

    the rule is, if the field is mutable, add `mut:` as prefix, if the field is nullable, add `?` as suffix, if the field is a reference type, add `ref` as prefix and the reference type is wrapped by `||`;  each field is split using `_`; wrapped it by `{}`

    2.2 array type

    the difference between struct type is its type name is wrapped by `[]`

    for example,

    ```typescript
    struct XX {
        i: number(mutable),
        j: boolean,
        k: array type [false] (nullable)
    }
    ```

    the type name in binaryen is `{mut:f64_i32_ref?|[i32]|}`

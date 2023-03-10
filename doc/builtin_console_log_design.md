# Built-In function `console.log` implementation
## Basic
In typescipt, `console.log` can print everything, the parameter's ts type is `any[]`.

To print in the console, we need to use a runtime library. So there are two steps to implement the special method.
1. In compilation phase, insert a function import in import section in advance, when meeting `console.log` in target compilation, call the function directly.
2. In execution phase, get the context based on the paramether (which represents a pointer list), print in the console.

## Details in step 1
1. Record the function name and function type in advance.
2. Invoke `addFunctionImport` in `addBuiltIn.ts`, so that when the flag `disableBuiltIn` is false, the function has been inserted into import session.
3. Calling convention obey `BuiltInObjAccess` convention.

## Details in step 2
Since the parameter's type is `any[]`, we can parse the parameter's elements one by one, and print the elements one by one.
Each element represents a `any`, which means that the pointer we get is in the dynamic world, we should get the real value depending on the true element type.

### dyntype_is_number / dyntype_is_bool / dyntype_is_array / dyntype_is_object
The real value is stored in dynamic world, we can get the value out depending on the implementation of runtime.

### dyntype_is_string
How to get the real value depends on the runtime implementation, the dyn string is still under consideration.


### dyntype_is_extref
Now we have four tags to flag the kind of exterf:
1. ExtObj

If extref is an object, we can only print `[Object]` since the details of the object is missing.

2. ExtFunc

If extref is a function, we can only print `[Function]` since the details of the function is missing.

3. ExtInfc

If extref is an interface object, the details are stored into itable, so we can get the real value, we can print the object.

4. ExtArray

If extref is an array, we can only print `[Array]` since the details of the array is missing.

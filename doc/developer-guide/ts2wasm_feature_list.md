# ts2wasm feature list

## Primitives
- [x] boolean
- [x] number
- [x] string
    - [ ] string template
- [ ] BigInt
- [ ] Symbol

## Class
- [x] declaration
- [x] inherit
- [x] method overwrite
- [x] static field/method
- [x] field initializer
- [x] visibility control
- [x] getter/setter
- [ ] class as value

## Function
- [x] closure
- [x] optional parameter
- [x] default parameter (closure and class method don’t support default parameter)
- [ ] destructor parameter
- [x] rest parameter
- [ ] this binding

## Interface
- [x] optional fields
- [x] readonly fields
- [ ] function signature
- [ ] indexed signature

## Enum
- [x] numeric enum
- [x] string enum
- [ ] heterogeneous enums

## Built-in objects/method
- Console (only work on WAMR)
    - [x] log
- [ ] Object
- [ ] Function
- [x] JSON ([fallback to dynamic](./fallback.md))
- [x] Date ([fallback to dynamic](./fallback.md))
- Math
    - [x] pow
    - [x] max
    - [x] min
    - [x] sqrt
    - [x] abs
    - [x] ceil
    - [x] floor
- [ ] Number
- String
- Array
- [x] Map ([fallback to dynamic](./fallback.md))
- [x] Set ([fallback to dynamic](./fallback.md))
- [ ] ArrayBuffer
- [ ] RegExp
- [ ] ... others

## Runtime capabilities
- [x] exception handling (only work on chrome)
- [x] promise ([fallback to dynamic](./fallback.md))
- [x] source debugging (only work on chrome)
- [ ] AoT compilation
- [ ] async/await
- [x] [import host API](./expose_host_API.md)

## Dynamics
- [x] assign static to any
- [x] assign any to static
- [x] property access
- [x] prototype
- [x] comparison
- arithmetic operation
    - [x] number
- [ ] mixed type (Box static object to any and add new property on it)
- [ ] dynamic function
- [ ] eval

## Type casting
- [x] static to static (static type checking)
- [x] static to dynamic (always success)
- [x] dynamic to static (runtime type checking)
- [x] dynamic to dynamic (no check)

## Misc
- [x] typeof
- [x] instanceof
- [x] toString
- [ ] iterator
- [ ] generic
- [x] module (generate single wasm module)
    - [ ] dynamic import

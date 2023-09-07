# ts2wasm feature list

## Primitives

| feature | WAMR | chrome |
| :---: | :---: | :---: |
| boolean | :heavy_check_mark: | :heavy_check_mark: |
| number | :heavy_check_mark: | :heavy_check_mark: |
| string | :heavy_check_mark: | :heavy_check_mark: |
| string template | :x: | :x: |
| bigint | :x: | :x: |
| symbol | :x: | :x: |

## [Class](./class.md)

| feature | WAMR | chrome |
| :---: | :---: | :---: |
| declaration | :heavy_check_mark: | :heavy_check_mark: |
| inherit | :heavy_check_mark: | :heavy_check_mark: |
| method overwrite | :heavy_check_mark: | :heavy_check_mark: |
| static field/method | :heavy_check_mark: | :heavy_check_mark: |
| field initializer | :heavy_check_mark: | :heavy_check_mark: |
| visibility control | :heavy_check_mark: | :heavy_check_mark: |
| getter/setter | :heavy_check_mark: | :heavy_check_mark: |
| class as value | :x: | :x: |

## [Function](./function.md)

| feature | WAMR | chrome |
| :---: | :---: | :---: |
| closure | :heavy_check_mark: | :heavy_check_mark: |
| optional parameter | :heavy_check_mark: | :heavy_check_mark: |
| function default parameter | :heavy_check_mark: | :heavy_check_mark: |
| method default parameter | :heavy_check_mark: | :heavy_check_mark: |
| closure default parameter | :x: | :x: |
| destructor parameter | :x: | :x: |
| rest parameter | :heavy_check_mark: | :heavy_check_mark: |
| this binding | :x: | :x: |
| overload | :x: | :x: |

## [Interface](./interface.md)

| feature | WAMR | chrome |
| :---: | :---: | :---: |
| explicitly implemented interface | :heavy_check_mark: | :heavy_check_mark: |
| implicitly implemented interface | :heavy_check_mark: | :x: |
| implicitly implemented interface | :heavy_check_mark: | :x: |
| readonly fields | :heavy_check_mark: | :x: |
| function signature | :x: | :x: |
| indexed signature | :x: | :x: |

## Enum

| feature | WAMR | chrome |
| :---: | :---: | :---: |
| numeric enum | :heavy_check_mark: | :heavy_check_mark: |
| string enum | :heavy_check_mark: | :heavy_check_mark: |
| heterogeneous enum | :x: | :x: |

## Built-in objects/method

| feature | WAMR | chrome | note |
| :---: | :---: | :---: | :---: |
| console | :heavy_check_mark: | :x: | only support `log` |
| Object | :x: | :x: | |
| Function | :x: | :x: | |
| JSON | :heavy_check_mark: | :heavy_check_mark: | [fallback to dynamic](./fallback.md) |
| Date | :heavy_check_mark: | :heavy_check_mark: | [fallback to dynamic](./fallback.md) |
| Math | :heavy_check_mark: | :heavy_check_mark: | only support `pow`, `max`, `min`, `sqrt`, `abs`, `ceil`, `floor` |
| Number | :x: | :x: | |
| [String](../standard-library/string.md) | :heavy_check_mark: | :heavy_check_mark: | |
| [Array](../standard-library/array.md) | :heavy_check_mark: | :x: | |
| Map | :heavy_check_mark: | :heavy_check_mark: | [fallback to dynamic](./fallback.md) |
| Set | :heavy_check_mark: | :heavy_check_mark: | [fallback to dynamic](./fallback.md) |
| ArrayBuffer | :x: | :x: | |
| RegExp | :x: | :x: | |
| ... others | :x: | :x: | |


## Wasm runtime capabilities
| feature | WAMR | chrome | note |
| :---: | :---: | :---: | :---: |
| exception handling | :x: | :heavy_check_mark: | |
| promise | :heavy_check_mark: | :heavy_check_mark: | [fallback to dynamic](./fallback.md) |
| source debugging | :x: | :heavy_check_mark: | |
| AoT compilation | :x: | :x: | |
| async/await | :x: | :x: | |
| import host API | :heavy_check_mark: | :heavy_check_mark: | [import host API](./expose_host_API.md) |

## [Dynamics](./any_object.md)
| feature | WAMR | chrome | note |
| :---: | :---: | :---: | :---: |
| any | :heavy_check_mark: | :heavy_check_mark: | |
| unknown | :x: | :x: | |
| never | :x: | :x: | |
| assign static to any | :heavy_check_mark: | :heavy_check_mark: | |
| assign any to static | :heavy_check_mark: | :heavy_check_mark: | |
| property access | :heavy_check_mark: | :heavy_check_mark: | |
| prototype | :heavy_check_mark: | :heavy_check_mark: | |
| comparison | :heavy_check_mark: | :x: | |
| arithmetic operation | :heavy_check_mark: | :heavy_check_mark: | only support `number` and `string` |
| mixed type | :heavy_check_mark: | :x: | Box static object to any and add new property on it |
| dynamic function | :x: | :x: | |
| eval | :x: | :x: | |

## Type casting
| feature | WAMR | chrome | note |
| :---: | :---: | :---: | :---: |
| static to static | :heavy_check_mark: | :heavy_check_mark: | static type checking |
| static to dynamic | :heavy_check_mark: | :heavy_check_mark: | always success |
| dynamic to static | :heavy_check_mark: | :heavy_check_mark: | runtime type checking |
| dynamic to dynamic | :heavy_check_mark: | :heavy_check_mark: | no check |

## Misc
| feature | WAMR | chrome | note |
| :---: | :---: | :---: | :---: |
| typeof | :heavy_check_mark: | :x: | |
| instanceof | :heavy_check_mark: | :heavy_check_mark: | |
| toString | :heavy_check_mark: | :x: | |
| for ... of | :heavy_check_mark: | :heavy_check_mark: | |
| for ... in | :x: | :x: | |
| generic | :x: | :x: | |
| module (static import) | :heavy_check_mark: | :heavy_check_mark: | |
| module (dynamic import) | :x: | :x: | |

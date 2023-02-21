# namespace scope rules

## Basics

namespace scope in typescript means a code sample like this:
```typescript
namespace ns {
    let a = 1;
    function b() {
        a++;
        return a;
    }
    b();
    ...
}
```
In a namespace scope, ts can do everything, just like in a module scope.

It follow these rules:
- Defined variables, functions, classes, etc in a namespace scope with an `export` modifier can be used by `namespaceName.xx`.
- The statements defined in namespace will be invoked like global statements.

## Data Storage


- Variables defined in a namespace will be stored in namespaceScope's varArray.
- Scopes defined in a namespace will be stored in namespaceScope's children.
- Statements defined in a namespace will be stored in namespaceScope's stmtArray.

## Mangling

Variables names and functions names in namespace should be mangled:
- change `a` to `ns|a`
- change `b` to `ns|b`

## Statement handling

Statements defined in a namespace will be handled in global start function, the running order is determined by the upper and lower order of appearance.


## Error
If we put namespace statements into namespace scope, not in global scope, the running order can not be guaranteed.

If we put namespace statements into global scope, the running order can be guaranteed, but in the statement, the used identifier name is `xx` not `namespace.xx`, `findIdentifier` will cause error.

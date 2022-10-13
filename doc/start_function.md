# Start Function
## Motivation
The origin typescript code may have many global statements, these statements will be stored in a function in the corresponding webassembly code, named `~start`.

## Define
After the global scope is defined, the start function scope and its block scope will be defined. The start block scope's parent is the start function scope, and the start function scope's parent is the global scope.

Since a function scope only has a child, which represents its corredsponding block scope, so through `startFunctionScope.getChildren()[0]`, we can get the `startBlockScope`. However, a global scope may have many children, so we can't get its special child `startFunctionScope`, so we should add an attribute `globalFunctionChild` to represent its unique child `startFunctionScope`. Then we can look for information through the top level to the low level.

## Usage
### Example 1
```typescript
let globalVariable1: number;
let globalVariable2: number;
// expression statement
globalVariable1 = 99;
// if statement
if (globalVariable1 > 2) {
    globalVariable2 = 22;
} else {
    globalVariable2 = 11;
}
```
The global variable's defination will be added to webassembly through `module.global.set`, and the following statements will be palced in the startBlockScope's statementArray.

### Example 2
One special case I found is the for loop.
```typescript
let globalVariable1: number;
// expression statement
globalVariable1 = 99;
// for statement
for (let i = 1; i < 5; ++i) {
    globalVariable1++;
}
```
The initilization of `let i = 1` will defined as a local variable, and when seeking for `i` in expressions `i < 5` and `i++`, the variables stored in the block scope outside the for loop will be found, not the global scope.
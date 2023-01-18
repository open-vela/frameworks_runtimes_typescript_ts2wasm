// as parameter

function foo(y: number) {
    return '123';
}

function FirstClassFuncClosureCase2(x: (y: number) => string) {
    let a = 10;
    let z = x(a);
    return z;
}

// let res = FirstClassFuncClosureCase2(foo);

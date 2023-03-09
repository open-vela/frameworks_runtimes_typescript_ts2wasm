// as parameter

function foo(y: number) {
    return y;
}

function FirstClassFuncClosureCase2(x: (y: number) => number) {
    let a = 10;
    let z = x(a);
    return z;
}

export function firstClassFuncTest() {
    let y = FirstClassFuncClosureCase2(foo);
    return y;
}

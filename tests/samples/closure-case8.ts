// as variable
export function FirstClassFuncClosureCase1() {
    let x = 10;
    function inner(i: number) {
        return x + i;
    }
    return inner;
}

export function firstClassFuncTest() {
    let inner = FirstClassFuncClosureCase1();
    let y = inner(11);
    return y;
}

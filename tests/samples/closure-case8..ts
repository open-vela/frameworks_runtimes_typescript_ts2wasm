// as variable
export function FirstClassFuncClosureCase1() {
    let x = 10;
    function inner(i: number) {
        return x + i;
    }
    return inner;
}

let inner = FirstClassFuncClosureCase1();
let y = inner(11);

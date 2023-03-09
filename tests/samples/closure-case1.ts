export function closure(x: number, y: boolean) {
    let z = 1;
    let j = 2;
    function inner() {
        z++;
        function inner1() {
            j++;
            return j;
        }
        return inner1;
    }
    let p = 11;
    return inner;
}

export function closureTest() {
    const f1 = closure(1, false);
    const f2 = f1();
    const res = f2();
    return res;
}

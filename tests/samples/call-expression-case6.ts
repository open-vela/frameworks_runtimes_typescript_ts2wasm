export function callInternalReturnTest(a: number, b = 2) {
    function callReturnTest(a: number, b: number, c: number) {
        return a + b + c;
    }
    const c = callReturnTest(a, b, 3);
    const d = callReturnTest(1, 2, 3);
    return c + d;
}

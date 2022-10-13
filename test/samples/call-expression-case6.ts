export function callInternalReturnTest(a: number, b = 2) {
    function callReturnTest(a = 10, b = 1, c = 99) {
        return a + b + c;
    }
    const c = callReturnTest(a, b, 3);
    const d = callReturnTest();
    return c + d;
}

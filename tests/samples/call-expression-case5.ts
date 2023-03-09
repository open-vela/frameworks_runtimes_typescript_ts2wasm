export function callReturnTest(a: number, b: number, c: number) {
    return a + b + c;
}

export function callExpressionTest() {
    return callReturnTest(1, 2, 3);
}

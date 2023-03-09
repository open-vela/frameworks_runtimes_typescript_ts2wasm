export function callNoReturnTest(a: number, b = 2) {
    const c = a + b;
    return c;
}

export function callExpressionTest() {
    return callNoReturnTest(2, 3);
}

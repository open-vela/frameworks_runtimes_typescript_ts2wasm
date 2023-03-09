export function callReturnTest(a = 10, b = 1, c = 99) {
    return a + b + c;
}

export function callExpressionTest() {
    return callReturnTest() + callReturnTest(1, 2, 3);
}

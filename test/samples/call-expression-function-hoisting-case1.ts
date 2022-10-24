const a = callReturnTest();
export function callReturnTest(a = 10, b = 1, c = 99) {
    return a + b + c;
}

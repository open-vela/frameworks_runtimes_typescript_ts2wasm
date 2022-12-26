export function callNoReturnTest(a: number, b = 2) {
    const c = a + b;
}
callNoReturnTest(2, 3);

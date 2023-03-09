export function restParameterTest() {
    function bar1(a: number, ...b: number[]) {
        const c = a + b[0] + b[1];
        return c;
    }
    function bar2(a: number, ...b: number[]) {
        return a;
    }
    return bar1(10, 11, 12, 13) + bar2(14);
}

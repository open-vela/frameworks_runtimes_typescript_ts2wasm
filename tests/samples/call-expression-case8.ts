export function callTest(a: any) {
    function inner(b: number) {
        return b;
    }
    return inner;
}

callTest(1)(2);

export function callTest(a: any) {
    function inner(b: number) {
        return a;
    }
    return inner;
}

callTest(1)(2);

export function ClosureTestCase4(x: number, y: boolean) {
    function inner() {
        x = 1;
        y = false;
    }
    return inner;
}

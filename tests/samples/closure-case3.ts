export function ClosureTestCase3(x: number, y: boolean) {
    let z = 1;
    z += 10;
    function inner() {
        z = 10;
    }
    return inner;
}

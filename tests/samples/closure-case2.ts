export function ClosureTestCase2(x: number, y: boolean) {
    let z = 1;
    function inner() {
        function inner1(a: number) {
            let m = 1;
            return m + z;
        }
        return inner1;
    }
    return inner;
}

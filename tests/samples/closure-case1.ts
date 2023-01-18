export function ClosureTestCase1(x: number, y: boolean) {
    let z = 1;
    let j = 2;
    function inner() {
        z++;
        function inner1() {
            j++;
        }
        return inner1;
    }
    let p = 11;
    return inner;
}

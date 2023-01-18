let y = '123';

function ClosureTestCase7() {
    function inner1() {
        return y;
    }
    return inner1;
}

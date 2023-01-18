function outer() {
    let i = 10;
    function inner1() {
        i++;
    }
    function inner2() {
        i--;
    }
    return [inner1, inner2];
}

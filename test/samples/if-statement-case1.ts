export function ifTest() {
    const a = 10;
    const b = 5;
    const c = 1;
    let d = 1;
    if (a > 1) {
        d = 10;
    } else {
        d = 100;
    }
    return a + b + c + d;
}

export function ifTest(a: number, b: number) {
    const c = 1;
    let d = 1;
    if (a > 1) {
        d = 10;
        if (b > 2) {
            a = d + 10;
        }
    } else {
        d = 100;
    }
    return a + b + c + d;
}

export function functionTest() {
    c = 2;
    const a = c,
        b = a;
    // eslint-disable-next-line no-var
    var c = 6;
    let d: number;
    d = 3;
    return a + b + d;
}

export function functionTest() {
    c = 2;
    const a = c;
    // eslint-disable-next-line no-var
    var c = 3;
    const b = c;
    return a + b;
}

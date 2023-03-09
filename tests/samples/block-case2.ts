export function blockTest() {
    let a = 1,
        c = 9;
    let b = 8;
    if (a == 1) {
        let b = a;
        c -= b;
    }
    return c;
}

export function forTest(): number {
    let c = 100;
    for (let q = 10; q > 4; --q) {
        c = c + 2;
        c--;
    }
    return c;
}

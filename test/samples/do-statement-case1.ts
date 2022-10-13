export function doTest(): number {
    let o = 9;
    let c = 10;
    do {
        c++;
    } while (++o < 10);
    return c;
}

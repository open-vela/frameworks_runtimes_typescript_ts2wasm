export function doTest(): number {
    let o = 9;
    let c = 10;
    do {
        c++;
        if (c > 15) {
            break;
        }
    } while (o++ < 20);
    return c;
}

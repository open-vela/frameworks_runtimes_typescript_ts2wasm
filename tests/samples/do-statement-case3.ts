export function doTest(): number {
    let c = 10;

    do {
        if (c > 20) {
            break;
        }
        c++;
    } while (c < 30);

    return c;
}

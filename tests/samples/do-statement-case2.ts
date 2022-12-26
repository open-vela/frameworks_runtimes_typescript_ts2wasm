export function doTest() {
    const o = 9;
    const c = 10;
    // eslint-disable-next-line no-empty
    do {} while (c > 100);
    return c;
}

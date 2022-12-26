export function forTest(): number {
    const c = 100;
    // eslint-disable-next-line no-empty
    for (let k = 10; k > 4; --k) {}
    return c;
}

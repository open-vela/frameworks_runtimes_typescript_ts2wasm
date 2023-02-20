export function forTest(): number {
    let i: number;
    let c: number = 0;

    for (i = 0; i < 100; i++) {
        c += i;
    }

    return c;
}

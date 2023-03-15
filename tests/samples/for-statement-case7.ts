export function forTest(): number {
    let i: number;
    let c: number = 0;

    for (i = 10; i < 100; i++) {
        c += i;
    }

    return c;
}

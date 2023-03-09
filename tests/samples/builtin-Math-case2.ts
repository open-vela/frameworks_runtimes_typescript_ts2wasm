export function mathTest() {
    const a = Math.max(3);
    const b = Math.max(1, 2, 4, 8, 9);
    const c = Math.min(1, 2, 4, 8, 9);
    const d = Math.min(2);
    const e = Math.pow(3, 0);
    const any1: any = 4;
    const any2: any = 2;
    const e2 = Math.pow(any1 as number, any2 as number);
    const f = Math.pow(3, -2);
    const g = Math.pow(3, Math.abs(-3));
}

mathTest();

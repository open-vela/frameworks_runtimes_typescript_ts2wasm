interface I {
    x: number;
    y: boolean;
}

function anyTest() {
    const i: I = { x: 1, y: true };
    const a: any = i;
    const b = a as I;
    const c = b.y;

    return c;
}

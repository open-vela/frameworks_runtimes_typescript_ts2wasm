interface I {
    x: number;
    y: boolean;
}

function infc16() {
    const i: I = { y: true, x: 10 };
    const b = 20;
    i.x = b;
}

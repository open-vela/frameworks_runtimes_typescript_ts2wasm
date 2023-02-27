interface I {
    x: number;
    y: boolean;
}

function infc14() {
    const i: I = { x: 1, y: true };
    const b = i.y;
}

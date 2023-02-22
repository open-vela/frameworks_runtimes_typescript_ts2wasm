interface I {
    x: number;
    y: boolean;
}

function infc12() {
    const i = new Array<I>(2);
    i[0] = { y: true, x: 12 };
}

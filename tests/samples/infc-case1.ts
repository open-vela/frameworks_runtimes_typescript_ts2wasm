interface I {
    x: number;
    y: boolean;
}

class Foo {
    y: boolean;
    x: number;
    constructor() {
        this.x = 1;
        this.y = false;
    }
}

function infc1() {
    const i: I = { x: 1, y: false };
    const f: Foo = i;
}

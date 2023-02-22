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

function infc2() {
    const i: I = new Foo();
    const f: Foo = i;
}

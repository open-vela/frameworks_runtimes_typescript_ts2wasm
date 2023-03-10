interface I {
    x: number;
    y: boolean;
}

interface I2 {
    y: boolean;
    x: number;
    z: string;
}

class Foo {
    y: boolean;
    z: string;
    x: number;
    constructor() {
        this.x = 1;
        this.y = false;
        this.z = 'str';
    }
}
function testInfc(f: I) {
    return f;
}

function infc7() {
    const i: Foo = new Foo();
    const f = testInfc(i);
}

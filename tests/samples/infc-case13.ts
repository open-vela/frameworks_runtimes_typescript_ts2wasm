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

function infc13() {
    const i = new Array<Foo>(2);
    const j: I2 = { x: 1, y: true, z: 'str' };
    i[0] = j;
}
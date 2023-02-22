interface I {
    x: number;
    y: boolean;
}

interface I2 {
    y: boolean;
    x: number;
    z: string;
}

function infc3() {
    const i: I2 = { y: true, x: 10, z: 'str' };
    const f: I = i;
}

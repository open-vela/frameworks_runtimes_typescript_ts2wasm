interface I {
    x: number;
    z: string;
}

interface I2 {
    y: boolean;
    x: number;
    z: string;
}

function infc15() {
    const i1: I2 = { x: 1, y: true, z: 'str' };
    const i: I = i1;
    const b = i.z;
    return b;
}
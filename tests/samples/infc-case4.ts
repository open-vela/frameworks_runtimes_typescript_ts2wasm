interface I {
    x: number;
    y: boolean;
}

interface I2 {
    y: boolean;
    x: number;
    z: string;
}

function infc4(): I {
    const i = { y: true, x: 10, z: 'str' };
    return i;
}
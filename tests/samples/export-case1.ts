export function add(a: number, b: number): number {
    return a + b;
}

function sub(a: number, b: number): number {
    return a - b;
}

export { sub };

function mul(a: number, b: number): number {
    // not exported as "mul"
    return a * b;
}

export { mul as renamed_mul };

export const a = 1;

const b = 2;

export { b };

const c = 3; // not exported as "c"

export { c as renamed_c };

export namespace ns {
    function one(): void {}
    export function two(): void {}
}

export default ns;

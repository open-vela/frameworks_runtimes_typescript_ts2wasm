class A5 {
    public _a: number;
    public _b: string;

    constructor(a: number, b: string) {
        this._a = a;
        this._b = b;
        let c = this._b;
    }
}

export function classTest5() {
    const i: A5 = new A5(1, 'true');
}

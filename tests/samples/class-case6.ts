class A6 {
    public _a: number;
    public _b: number;

    constructor(a: number, b: number) {
        this._a = a;
        this._b = b;
    }
}

class B6 extends A6 {
    _c: number;
    constructor(a: number, b: number, c: number) {
        super(a, b);
        this._c = c;
    }
}

class A7 {
    public _a: number;
    constructor(a: number) {
        this._a = a;
    }
    set a(m: number) {
        this._a = m;
    }
    get a() {
        return this._a;
    }
    test(m: number) {
        return 10;
    }
}

class B7 extends A7 {
    constructor(a: number) {
        super(a);
    }
    test(m: number) {
        return m;
    }
    set a(m: number) {
        this._a = m;
    }
    get a() {
        return 0;
    }
}

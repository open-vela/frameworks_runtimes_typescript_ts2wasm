class A2 {
    public _a: number;
    constructor(a: number) {
        this._a = a;
    }
    public testFunc() {
        this._a = 10;
    }
    get a() {
        return this._a;
    }
    set a(m: number) {
        this._a = m;
    }
}

export function classTest2() {
    let a: A2 = new A2(10);
}

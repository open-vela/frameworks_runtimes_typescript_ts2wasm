class A11 {
    a: number = 10;
    constructor(a1: number) {
        this.a = a1;
        this.b = true;
    }
    b = false;
    c = 'c';
}

export function classTest11() {
    let a: A11 = new A11(18);
    return a.a;
}

class A14 {
    static test() {
        return 1;
    }
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    constructor() {}
}

class B14 extends A14 {
    constructor() {
        super();
    }
}
export function classTest14() {
    return B14.test();
}

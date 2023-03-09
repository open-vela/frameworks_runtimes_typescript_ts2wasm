class A13 {
    static test1() {
        return 1;
    }

    static test2() {
        return 2;
    }
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    constructor() {}
}

function classTest13() {
    const func = A13.test1;
    func();
    const var2 = A13.test2();
}

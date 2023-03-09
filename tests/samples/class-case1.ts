class A1 {
    // empty constructor
    test() {
        return 123;
    }

    test2() {
        return 1;
    }
}

export function classTest() {
    let a: A1 = new A1();
    let b = a.test();
    return b;
}

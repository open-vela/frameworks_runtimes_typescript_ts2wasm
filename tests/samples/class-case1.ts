class A1 {
    // empty constructor
    test() {
        return 'xyz';
    }
}

export function classTest2() {
    let a: A1 = new A1();
    let b = a.test();
}

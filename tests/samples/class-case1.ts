class A1 {
    // empty constructor
    test() {
        return 'xyz';
    }

    test2() {
        return 1;
    }
}

export function classTest2() {
    let a: A1 = new A1();
    let b = a.test();
    let test2Func = a.test2;
    const num = test2Func();
}

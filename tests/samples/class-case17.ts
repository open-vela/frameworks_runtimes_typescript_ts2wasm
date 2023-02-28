class A17 {
    test() {
        return 1;
    }
}

function foo() {
    const a = new A17();
    {
        class A17 {
            //
        }
        const b = a.test();
    }
}

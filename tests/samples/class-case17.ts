class A17 {
    test() {
        return 1;
    }
}

export function classTest17() {
    const a = new A17();
    {
        class A17 {
            //
        }
        const b = a.test();
        if (b > 0) {
            return b;
        }
    }
    return -1;
}

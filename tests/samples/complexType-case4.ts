class cpxCase3Class1 {
    foo(i: number, j: number) {
        return i + j;
    }
}

function cpxCase3Func1() {
    const a: cpxCase3Class1 = new cpxCase3Class1();
    let k = a.foo(1, 2);
}

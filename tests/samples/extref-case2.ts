export function objTest() {
    const obj1 = {
        a: 1,
        b: true,
        c: 'hi',
    };
    const objAny: any = obj1;
    const objAny1 = objAny as typeof obj1;
    // return objAny1.a;
}

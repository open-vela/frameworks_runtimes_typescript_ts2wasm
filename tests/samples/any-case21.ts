export function anyTest() {
    let obj: any = { a: 1 };
    obj.a = 2;
    return obj.a;
}

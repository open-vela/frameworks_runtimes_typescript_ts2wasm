class A {
    static c = 10; //10
    static readonly d = 12 + A.c; //22
}

class B extends A {
    static c = 20; // 20 20
}
export function classTest() {
    return A.c + A.d + B.c + B.d;
}
// 74

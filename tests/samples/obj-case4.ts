export function objTest() {
    const obj1 = {
        a: 1,
        b: true,
        c: {
            d: 4,
        },
    };
    obj1.c = {
        d: 6,
    };
    return obj1.c;
}

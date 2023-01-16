export function objTest() {
    const obj1 = {
        a: 1,
        b: true,
        c: {
            d: 4,
            e: {
                f: false,
            },
        },
    };
    return obj1.c.e;
}

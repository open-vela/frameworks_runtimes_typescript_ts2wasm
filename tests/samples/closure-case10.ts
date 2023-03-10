export function closureTest(m: number) {
    function test2(x: number) {
        let y = 10 + m;
        const func = function () {
            const z = x + y++;
            return z;
        };
        x++;
        return func;
    }
    const x = test2(10);
    const y = x();
    return y;
}

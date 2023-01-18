/* eslint-disable @typescript-eslint/no-empty-function */

export function outer() {
    function inner1() {
        //
    }
    function inner2() {
        //
    }
    return [inner1, inner2];
}

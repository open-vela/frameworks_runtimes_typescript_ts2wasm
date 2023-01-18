/* eslint-disable @typescript-eslint/no-empty-function */

function inner1() {
    //
}
function inner2() {
    //
}
export function outer() {
    return [inner1, inner2];
}

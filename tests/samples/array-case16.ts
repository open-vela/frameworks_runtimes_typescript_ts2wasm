export function arrayTest16() {
    const array1 = [new Array('hi')];
    array1[0][0] = 'hello';
    return array1;
}

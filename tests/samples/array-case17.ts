export function arrayTest() {
    const array1 = [new Array(new Array('hi'))];
    array1[0][0][0] = 'hello';
    return array1;
}

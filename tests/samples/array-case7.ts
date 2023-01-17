export function arrayTest() {
    const array1 = new Array(1);
    // currently, array1[0] is undefined, how to represent its type?
    array1[0] = 3;
    return array1;
}

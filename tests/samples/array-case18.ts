export function arrayTest18() {
    const array1: Array<string[]> = new Array<string[]>(1);
    array1[0][0] = 'hi';
    return array1;
}

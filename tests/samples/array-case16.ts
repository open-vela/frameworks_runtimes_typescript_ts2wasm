export function arrayTest16() {
    const array1 = [new Array<string>('hi')];
    array1[0][0] = 'hello';
    return array1;
}

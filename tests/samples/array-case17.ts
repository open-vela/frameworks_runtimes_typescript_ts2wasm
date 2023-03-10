export function arrayTest17() {
    // const array1 = [new Array(new Array<string>('hi'))];
    const array1 = [new Array<Array<string>>(new Array<string>('hi'))];
    array1[0][0][0] = 'hello';
    return array1;
}

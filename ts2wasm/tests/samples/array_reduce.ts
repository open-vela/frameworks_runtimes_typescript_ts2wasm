class A {
    x: string = 'xxx'
    constructor(x: string) {
        this.x = x;
    }
}

interface I {
    x: string
}
export function array_reduce_test() {
    let arr = [1, 2, 3, 4, 5, 6];
    console.log(arr.reduce((accumulator, currentValue) => {
        return accumulator + currentValue;
    }, 0));             // 21
}
export function array_reduce_number() {
    let arr = [1, 2, 3, 4, 5, 6];
    console.log(arr.reduce((accumulator, currentValue) => {
        return accumulator + currentValue;
    }, 0));             // 21
}

export function array_reduce_string() {
    let arr = ["1", "2", "3", "4"];
    console.log(arr.reduce((accumulator, currentValue) => {
        return accumulator.concat(currentValue);
    }, "0"));           // 01234
}

export function array_reduce_boolean() {
    let arr = [true, false];
    console.log(arr.reduce((accumulator, currentValue) => {
        return currentValue;
    }, true));          // false
}

export function array_reduce_class() {
    let A1 = new A("1");
    let A2 = new A("2");
    let A3 = new A("3");
    let A4 = new A("4");
    let A5 = new A("5");
    let arr: A[] = [A1, A2, A3, A4, A5];
    console.log(arr.reduce((accumulator, currentValue) => {
        return new A(accumulator.x.concat(currentValue.x));
    }, A3).x);          // 312345
}

export function array_reduce_interface() {
    let A1: I = { x: 'A1' };
    let A2: I = { x: 'A2' };
    let A3: I = { x: 'A3' };
    let arr: I[] = [A1, A2];
    console.log(arr.reduce((accumulator, currentValue) => {
        return currentValue;
    }, A3).x);          // A2
}
export function array_findIndex_number() {
    const arr = [1, 2, 3, 4, 5];
    const foundIndex = arr.findIndex((element) => {
        return element > 2;
    });
    const notfoundIndex = arr.findIndex((element) => {
        return element > 6;
    });

    console.log('foundIndex:', foundIndex);
    console.log('notfoundIndex:', notfoundIndex);
}

export function array_findIndex_string() {
    const words = ['spray', 'limit', 'elite', 'exuberant', 'destruction', 'present'];
    const result = words.findIndex(word => word.length > 6);
    const noresult = words.findIndex(word => word.length > 20);

    console.log('result:', result);
    console.log('noresult:', noresult);
}

export function array_findIndex_boolean() {
    const boolArr = [false, true, false, true];
    const index = boolArr.findIndex(element => !!element);

    console.log(index);
}

export function array_findIndex_class() {
    const array = [
        { name: "Alice", age: 25 },
        { name: "Bob", age: 30 },
        { name: "Charlie", age: 35 },
        { name: "David", age: 40 }
    ];

    const index1 = array.findIndex(person => person.age === 30);
    console.log(index1);

    const index2 = array.findIndex(person => person.age === 50);
    console.log(index2);
}

export function array_findIndex_interface() {
    interface SomeInterface {
        id: number;
        name: string;
    }

    let someArray: SomeInterface[] = [
        { id: 1, name: "John" },
        { id: 2, name: "Mary" }
    ];

    let index = someArray.findIndex(item => item.id === 2);
    console.log(index);
}
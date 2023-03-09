declare class declareClass1 {
    grade: number;
    constructor(grade: number);
    sayHello(): void;
    static whoSayHi(name: string): number;
}

const sayHiFunc = declareClass1.whoSayHi('i');

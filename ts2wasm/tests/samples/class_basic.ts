/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

class A1 {
    // empty constructor
    test() {
        return 123;
    }

    test2() {
        return 1;
    }
}

class A2 {
    public _a: number;
    constructor(a: number) {
        this._a = a;
    }
    public testFunc() {
        this._a = 10;
    }
    get a() {
        return this._a;
    }
    set a(m: number) {
        this._a = m;
    }
}

export function withoutCtor() {
    let a: A1 = new A1();
    let b = a.test();
    return b;
}

export function basic() {
    let a: A2 = new A2(10);
    return a.a;
}

class A9 {
    public _a: number;
    constructor(a: number) {
        this._a = a;
    }
    set a(m: number) {
        this._a = m;
    }
    get a() {
        return this._a;
    }
    test(m: number) {
        return m;
    }
    test1() {}
}

export function getterSetter() {
    let a: A9 = new A9(10);
    let i = a._a;
    a.a = i;
    let j = a.test(5);
    let k = a.a;
    return i + j + k;
}

// class with any type fields
class A3 {
    public _a: any;
    constructor(a: any) {
        this._a = a;
    }
    public testFunc() {
        this._a = 10;
    }
    get a() {
        return this._a;
    }
    set a(m: any) {
        this._a = m;
    }
}

export function anyType() {
    const a: A3 = new A3(10);
    return a.a;
}

class Base {
    _arg: number;
    _arg1: number;

    constructor(arg: number, arg1: number) {
        this._arg = arg;
        this._arg1 = arg1;
    }

    test() {
        return this._arg + this._arg1;
    }
}

class Derived extends Base {
    //
}

export function defaultCtor() {
    const a = new Derived(1, 2);
    return a.test();
}

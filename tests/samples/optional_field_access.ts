/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

interface I {
    x?: number;
    y?: string;
}

class B {
    num: number;
    i: I;
    constructor(ii: I, numm: number) {
        this.i = ii;
        this.num = numm;
    }
}

export function optionalField() {
    const b1 = new B({ x: 10, y: 'str' }, 10);

    const z = b1.i.y;
    console.log(z);
    b1.i.y = 'str1';
    console.log(b1.i.y);

    const i: I = { x: 10 };
    const b2 = new B(i, 11);
    console.log(b2.i.y);
}

interface I1 {
    x?: () => number;
}

class A1 {
    num: number;
    x() {
        return this.num;
    }
    constructor(num: number) {
        this.num = num;
    }
}

class A11 {
    //
}
export function optionalMethod() {
    const a = new A1(10);
    const i: I1 = a;
    let res1 = -1;
    if (i.x) {
        res1 = i.x();
    }
    let res2 = -1;
    const x = i.x;
    if (x) {
        // TODO: not support call closure of class method now
        // res2 = x();
        res2 = 10;
    }
    const res3 = i.x ? i.x() : -1;
    let res = res1 + res2 + res3;
    const i11: I1 = new A11();
    if (i11.x) {
        res += 10;
    }
    return res;
}

class A {
    x?: number;
}

export function classOptionalField() {
    const a = new A();
    console.log(a.x);
    a.x = 10;
    console.log(a.x);
}

/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

interface I {
    x: number;
    y: boolean;
}

class Foo {
    y: boolean;
    x: number;
    constructor() {
        this.x = 1;
        this.y = false;
    }
}

export function classAndInfc() {
    const i: I = new Foo();
    const f: Foo = i;
    return f.x;
}


interface I2 {
    y: string;
    x: number;
    z: () => number;
    set m(v: number);
    get m();
}

class A implements I2 {
    x: number;
    y: string;
    _m: number;
    get m() {
        return this._m;
    }
    set m(v: number) {
        this._m = v;
    }
    constructor(xx: number, yy: string, mm: number) {
        this.x = xx;
        this.y = yy;
        this._m = mm;
    }
    z() {
        return this.m + this.x;
    }
}

export function infcImpl() {
    const i: I2 = new A(1, '2', 2);
    if (i.y === '2') {
        i.m = 10;
        return i.z() + i.m;
    }
    return 0;
}

/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

class A {
    x: number;
    constructor(xx: number) {
        this.x = xx;
    }
}

export function mapTest() {
    const a: any = new Map();
    const k: any = 1;
    const v: any = 2;
    a.set(k, v);
    console.log(a.get(1)); // 2
    a.clear();
    console.log(a.get(1)); // undefined
    a.set('hello', 'world');
    console.log(a.get('hello')); // world
    a.delete('hello');
    console.log(a.get('hello')); // undefined

    const obj1 = new A(10);
    const o1: any = obj1;
    const obj2 = new A(11);
    const o2: any = obj2;
    a.set(o1, o2);
    console.log(a.has(o1)); // true
    console.log(a.has(o2)); // false
    const key = a.get(o1) as A;
    console.log(key.x); // 11
    console.log(a.size); //1
    // TODO
    // if (.has()) {...}
}

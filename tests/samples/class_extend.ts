/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

class A6 {
    public _a: number;
    public _b: number;

    constructor(a: number, b: number) {
        this._a = a;
        this._b = b;
    }
}

class B6 extends A6 {
    _c: number;
    constructor(a: number, b: number, c: number) {
        super(a, b);
        this._c = c;
    }
}

export function extendWithNewProp() {
    let a: A6 = new B6(10, 20, 30);
    let res = a._a + a._b;
    let b = new B6(10, 20, 30);
    res += b._a + b._b + b._c;
    return res;
}

class A7 {
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
        return 10;
    }
}

class B7 extends A7 {
    constructor(a: number) {
        super(a);
    }
    test(m: number) {
        return m;
    }
    set a(m: number) {
        this._a = m;
    }
    get a() {
        return this._a;
    }
}

export function methodOverwrite() {
    let a: A7 = new B7(10);
    a.a = 20;
    let b = new B7(10);
    b.a = 20;
    return a.a + b.a;
}

class Base {
    init(): void {
        console.log('Base');
    }
}

class A extends Base {
    init2(): void {
        console.log('A');
    }
}

class B extends A {
    init(): void {
        console.log('B');
    }
}

export function multiLevelExtend() {
    const b: B = new B();
    b.init();
}

class Base1 {
    x: number = 1;
    foo() {

    }
    y: string = '100';
}

class ExtendReordered extends Base1 {
    z: number = 12;
    y: string = 'Hello';
    x: number = 10;
}

export function testExtendReordered() {
    const e = new ExtendReordered();
    return e.x + e.z;  // 22
}

class InheritGetter extends B7 {

}

export function testInheritGetter() {
    const a = new InheritGetter(10);
    return a.a; // 10
}


/** class cast by using as keyword */
class Baz {
    constructor() {
      //
    }
    base() {
        console.log('base');
    }
}

class Foo extends Baz {
    constructor() {
        super();
    }
    foo() {
        console.log('foo');
    }
}

class Bar extends Foo {
    constructor() {
        super();
    }
    bar() {
        console.log('bar');
    }
}

export function inheritCast() {
    const b = new Bar();

    // upcast
    const f: Foo = b as Foo;
    const bs: Baz = b as Baz;
    f.foo();
    bs.base();

    // downcast
    const f1 = bs as Foo;
    const b1 = bs as Bar;

    f1.foo();
    b1.bar();
}

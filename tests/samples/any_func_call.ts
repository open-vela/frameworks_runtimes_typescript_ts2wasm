/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

export function anyFuncCallWithNumber() {
    const fn1: any = (a: number): number => {
        return a;
    };
    const fn2: any = (a: number): number => {
        return a + 100;
    };
    const a1 = fn1(20);
    console.log(a1);
    const a2 = fn2(10)
    console.log(a2);
}

function funcWithBoolean(a: boolean) {
    if (a) {
        return 10;
    }
    return 11;
}

export function anyFuncCallWithBoolean() {
    const fn1: any = (a: boolean): boolean => {
        return a;
    };
    const fn2: any = funcWithBoolean;
    const a1 = fn1(true);
    console.log(a1);
    const a2 = fn2(false);
    console.log(a2);
}

export function anyFuncCallWithString() {
    const fn1: any = (): string => {
        return 'hi';
    };
    const fn2: any = (a: string): string => {
        return a.concat(', world');
    };
    const a1 = fn1();
    console.log(a1);
    const a2 = fn2('hello');
    console.log(a2);
}

export function anyFuncCallWithAny() {
    const fn1: any = (a: any): number => {
        return 100;
    };
    const fn2: any = (a: any): any => {
        return a;
    };
    const a = fn1(8);
    console.log(a);
    const b = fn2('world');
    console.log(b);
}

export function anyFuncCallWithFunc() {
    const fn: any = (a: ()=>number): ()=>number => {
        return a;
    };
    const a = fn(()=> {return 8});
    const b = a();
    console.log(b);
}

export function anyFuncCallWithObj() {
    const fn: any = (a: {x: number, y:boolean}):{x: number, y:boolean}  => {
        return a;
    };
    const obj = {x:3, y:true};
    const a = fn(obj);
    console.log(a.x);
    console.log(a.y);
}

interface I {
    x: number;
    y: boolean;
}

export function anyFuncCallWithInfc() {
    const fn: any = (a: I): I => {
        return a;
    };
    const obj:I = {x:3, y:true};
    const a = fn(obj);
    console.log(a.x);
    console.log(a.y);
}

export function anyFuncCallWithArray() {
    const fn: any = (a: number[]): number[] => {
        return a;
    };
    const arr = [9, 6];
    const a = fn(arr);
    const b = a[0];
    console.log(b);
    const len = a.length;
    console.log(len);
}

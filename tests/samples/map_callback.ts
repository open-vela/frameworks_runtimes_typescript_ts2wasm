/*
 * Copyright (C) 2023 Xiaomi Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

export function mapTest() {
    const mmap: any = new Map();
    console.log("1");
    mmap.set('0', 3);
    mmap.set('1', 4);
    mmap.set('2', 5);
    console.log("2");
    // if there is a type error: forEach -> foreach , it will be segment fault, how to avoid
    mmap.forEach((v: any, k: any, m: any) => { // parms must be any
        console.log(k, v);
    });
}
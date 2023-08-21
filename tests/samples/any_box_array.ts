/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

export function boxEmptyArr() {
    let a: any = [];
    console.log(a);    // []
}

export function setArrElem() {
    let a: any = [10];
    a[0] = 100;
    console.log(a);     // [100]
}

export function getArrElem() {
    let a: any = [10];
    const b = a[0];
    console.log(b);   // 10
}

/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

export function deadCodeAfterReturn(a: number, b: number) {
    if (a > b) {
        return a - b;
        a += 1;
    }
    return a;
}

function helper() {
    return;
}
export function returnVoid(): void {
    console.log('before');
    return helper();
    console.log('after');
}

function helper1(a: number) {
    if (a > 0) {
        return a;
        return 'hi';
    }
}
export function deadReturnStatement(a: number) {
    console.log(helper1(a));
}

export function returnNaN() {
    const a = NaN;
    return a;
}

export function returnInfiity() {
    const a = Infinity;
    return a;
}

export function returnNegInfiity() {
    const a = -Infinity;
    return a;
}

/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

function anyFunc(num: any) {
    console.log(num);
}

function genericFunc<T>(num: T) {
    anyFunc(num);
}

export function testGenericParam() {
    genericFunc('hi');
}

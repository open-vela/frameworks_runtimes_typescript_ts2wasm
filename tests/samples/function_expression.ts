/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

const fe_case1_1 = function (a: number, b: number) {
    return a + b;
};

export function functionExpression() {
    return fe_case1_1(7.1, 1997);
}

const arrowFunc = (a: number) => {
    return a + 1
};

export function arrowFunction() {
    return arrowFunc(1);
}

const arrowFuncNoReturn = (a: number) => a + 1;
const arrowFuncNoReturn1 = (a: number) => console.log(a);

export function arrowFunctionWithoutReturn() {
    arrowFuncNoReturn1(1);
    return arrowFuncNoReturn(1);
}

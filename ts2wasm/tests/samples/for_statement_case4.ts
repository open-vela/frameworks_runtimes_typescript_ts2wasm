/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

export function forTest(): number {
    let c = 100;
    for (let q = 10; q > 4; --q) {
        c = c + 2;
        c--;
    }
    return c;
}
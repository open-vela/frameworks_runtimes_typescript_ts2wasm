/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

export function returnTest3(a: number) {
    if (a > 0) {
        return a;
        a += 1;
    }
    return a;
}
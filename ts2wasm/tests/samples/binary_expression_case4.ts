/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

export function binaryExpressionTest() {
    const a = 5;
    const b = 5;
    if (a >= 5) {
        if (b >= 4) {
            return 1;
        }
    }
    return 0;
}
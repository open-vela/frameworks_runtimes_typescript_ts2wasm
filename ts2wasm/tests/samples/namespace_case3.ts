/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

let nscase3_global1 = 1;

namespace NSCase3 {
    namespace NSInner {
        // eslint-disable-next-line no-inner-declarations
        function case2() {
            nscase3_global1 += 1;
        }
        case2();
    }
    // eslint-disable-next-line no-inner-declarations
    function case2() {
        nscase3_global1 += 1;
    }
    case2();
}

export function namespaceTest() {
    nscase3_global1 += 1;
    return nscase3_global1;
}
// 2
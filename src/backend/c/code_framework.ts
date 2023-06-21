/*
 * Copyright (C) 2023 Xiaomi Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import { GeneratorContext } from './gen_context.js';

export function genHeader(context: GeneratorContext) {
    context.addSource('/************************************/');
    context.addSource('/* Generator By TS2WASM C Backend   */');
    context.addSource('/************************************/');
    context.addSource('');
    context.addSource('#include <tsruntime.h>');
    context.addSource('');
}

export function genFooter(context: GeneratorContext) {
    context.addSource('/********************************************/');
    context.addSource('// end');
}

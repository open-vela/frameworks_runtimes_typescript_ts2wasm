/*
 * Copyright (C) 2023 Xiaomi Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import { GeneratorContext } from './gen_context.js';
import { IRFunction } from '../../semantics/ir/function.js';
import Names from './name_builder.js';

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

export function genInitFunc(context: GeneratorContext, starts: IRFunction[]) {
    context.newLines();
    context.addSource(`TS_EXPORT void ts_init_module(ts_context_t* context) {`);

    context.shift();
    for (const f of starts) {
        context.addSource(
            `${Names.buildIdentifyFromName(f.name)}(context, NULL, 0, 0);`,
        );
    }
    context.unshift();
    context.addSource(`}`);
}

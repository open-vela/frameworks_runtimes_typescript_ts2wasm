/*
 * Copyright (C) 2023 Xiaomi Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import ts from 'typescript';

import { GeneratorContext } from './gen_context.js';

import Names from './name_builder.js';

import { RuntimeData, IRModule } from '../../semantics/ir/irmodule.js';

import { MemberType } from '../../semantics/runtime.js';

import { DataPool } from '../../semantics/ir/data_pool.js';

function genDataPool(context: GeneratorContext, dataPool: DataPool) {
    const data = dataPool.getData();

    context.addSource(`static uint8_t _data [] = {`);
    let s = '';
    context.shift();
    for (let i = 0; i < data.length; i++) {
        s = s + `0x${data[i].toString(16)},`;
        if (i % 16 == 15) {
            context.addSource(s);
            s = '';
        }
    }
    if (s != '') context.addSource(s);
    context.unshift();
    context.addSource(`};`);
}

function genRuntimeData(context: GeneratorContext, runtimeData: RuntimeData) {
    return;
}

export function genRuntime(context: GeneratorContext, vm: IRModule) {
    genDataPool(context, vm.dataPool);
    //genStaticRuntimeData(context, vm.runtimeData!);
    genRuntimeData(context, vm.runtimeData!);
}

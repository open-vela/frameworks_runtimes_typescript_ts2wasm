import binaryen from 'binaryen';
import { assert } from 'console';
import { BuiltinNames } from '../lib/builtin/builtinUtil.js';
import Long from 'long';
import { objectStructTypeInfo } from './glue/packType.js';

function i64_new(low: number, high: number) {
    return Long.fromBits(low, high);
}

function i64_add(left: Long, right: Long) {
    return left.add(right);
}

function i64_align(value: Long, alignment: number) {
    assert(alignment && (alignment & (alignment - 1)) == 0);
    const mask = Long.fromInt(alignment - 1);
    return value.add(mask).and(mask.not());
}

function getByteSize(size: number) {
    return (size + 7) >>> 3;
}

function initMemoryOffset() {
    const memoryOffset = Long.fromBits(BuiltinNames.memoryOffset, 0);
    return memoryOffset;
}

export function initGlobalOffset(module: binaryen.Module) {
    let memoryOffset = initMemoryOffset();
    // finalize data
    module.addGlobal(
        BuiltinNames.data_end,
        binaryen.i32,
        false,
        module.i32.const(memoryOffset.low),
    );

    // finalize stack
    memoryOffset = i64_align(
        i64_add(memoryOffset, i64_new(BuiltinNames.stackSize, 0)),
        getByteSize(BuiltinNames.byteSize),
    );
    module.addGlobal(
        BuiltinNames.stack_pointer,
        binaryen.i32,
        true,
        module.i32.const(memoryOffset.low),
    );

    // finalize heap
    module.addGlobal(
        BuiltinNames.heap_base,
        binaryen.i32,
        false,
        module.i32.const(memoryOffset.low),
    );
}

export function initDefaultMemory(module: binaryen.Module): void {
    module.setMemory(
        BuiltinNames.mem_initialPages,
        BuiltinNames.mem_maximumPages,
    );
}

export function initDefaultTable(module: binaryen.Module): void {
    module.addTable(
        BuiltinNames.obj_table,
        BuiltinNames.table_initialPages,
        BuiltinNames.table_maximumPages,
        objectStructTypeInfo.typeRef,
    );
}

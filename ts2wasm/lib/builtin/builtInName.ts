/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

export namespace BuiltinNames {
    // wasm global variable
    export const data_end = '~lib/memory/__data_end';
    export const stack_pointer = '~lib/memory/__stack_pointer';
    export const heap_base = '~lib/memory/__heap_base';

    // wasm table
    export const extref_table = 'extref_table';

    // wasm default variable
    export const byteSize = 32;
    export const stackSize = 32768;
    export const memoryOffset = 8;
    export const mem_initialPages = 1;
    export const mem_maximumPages = 10;
    export const table_initialPages = 1;
    export const table_maximumPages = 10;
    export const tableGrowDelta = 10;

    // wasm function
    export const start = '~start';
    export const global_init_func = 'global_init';

    // delimiters
    export const module_delimiter = '|';

    // import external name
    export const external_module_name = 'env';

    // builtIn module name
    export const bulitIn_module_name = 'builtIn';

    // builtIn file name
    export const builtInImplementFileName = 'lib.builtIn.ts';
    export const builtInFileNames = ['lib.type.d.ts', builtInImplementFileName];

    // builtIn class name
    export const MATH = 'Math';
    export const ARRAY = 'Array';
    export const String = 'String';
    export const Number = 'Number';
    export const Boolean = 'Boolean';
    export const Object = 'Object';
    export const Function = 'Function';
    export const console = 'console';

    export const builtInIdentifierArray = [
        MATH,
        ARRAY,
        String,
        Number,
        Boolean,
        Object,
        Function,
        console,
    ];

    // decorator name
    export const decorator = 'binaryen';

    // decorator function name
    export const Math_sqrt_funcName = 'Math|sqrt';
    export const Math_abs_funcName = 'Math|abs';
    export const Math_ceil_funcName = 'Math|ceil';
    export const Math_floor_funcName = 'Math|floor';
    export const Math_trunc_funcName = 'Math|trunc';
    export const Array_isArray_funcName = 'Array|isArray';
    export const string_concat_funcName = 'String|concat';
    export const string_slice_funcName = 'String|slice';

    // builtIn instance function name
    export const string_length_funcName = 'String|length';
    export const array_length_funcName = 'Array|length';
}

export namespace ArgNames {
    export const opt = 'opt';
    export const disableAny = 'disableAny';
    export const disableBuiltIn = 'disableBuiltIn';
    export const disableInterface = 'disableInterface';
    export const isBuiltIn = 'isBuiltIn';
}

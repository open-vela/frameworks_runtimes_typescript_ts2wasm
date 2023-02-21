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

    // wasm function
    export const start = '~start';

    // string builtin function
    export const string_length_func = '~lib/string-length';
    export const string_concat_func = '~lib/string-concat';
    export const string_slice_func = '~lib/string-slice';

    // delimiters
    export const module_delimiter = '|';

    // import external name
    export const external_module_name = 'env';

    // other builtin Identifiers
    export const builtinIdentifiers = ['Array', 'Math'];
}

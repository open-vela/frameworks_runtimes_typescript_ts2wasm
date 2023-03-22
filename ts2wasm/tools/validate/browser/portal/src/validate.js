/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

let wasmMemory;

export function setWasmMemory(value) {
    wasmMemory = value;
}

export const importObject = {
    libdstructdyn: {
        struct_get_dyn_i32: (obj, index) => {},
        struct_get_dyn_i64: (obj, index) => {},
        struct_get_dyn_f32: (obj, index) => {},
        struct_get_dyn_f64: (obj, index) => {},
        struct_get_dyn_anyref: (obj, index) => {},
        struct_set_dyn_i32: (obj, index, value) => {},
        struct_set_dyn_i64: (obj, index, value) => {},
        struct_set_dyn_f32: (obj, index, value) => {},
        struct_set_dyn_f64: (obj, index, value) => {},
        struct_set_dyn_anyref: (obj, index, value) => {},
    },
    libdytype: {
        dyntype_context_init: () => BigInt(0),
        dyntype_context_destroy: (ctx) => { },

        dyntype_new_number: (ctx, value) => {
            return new Number(value);
        },
        dyntype_to_number: (ctx, value, pres) => {
            const memView = new DataView(wasmMemory.buffer);
            memView.setFloat64(pres, value, true);
        },
        dyntype_is_number: (ctx, value) => {
            return typeof value === 'number' || value instanceof Number;
        },

        dyntype_new_boolean: (ctx, value) => {
            return new Boolean(value);
        },
        dyntype_to_bool: (ctx, value, pres) => {
            const memView = new DataView(wasmMemory.buffer);
            memView.setInt32(pres, value.valueOf(), true);
        },
        dyntype_is_bool: (ctx, value) => {
            return typeof value === 'boolean' || value instanceof Boolean;
        },

        dyntype_new_string: (ctx, value) => {
            // TODO
            return new String(value);
        },
        dyntype_to_cstring: (ctx, value, pres) => {
            // TODO
            const memView = new DataView(wasmMemory.buffer);
            memView.setInt32(pres, value);
        },
        dyntype_free_cstring: (ctx, value) => {
            // TODO
        },
        dyntype_is_string: (ctx, value) => {
            // TODO
            return typeof value === 'string' || value instanceof String;
        },

        dyntype_new_array: (ctx, len) => new Array(len),
        dyntype_is_array: (ctx, value) => {
            return Array.isArray(value);
        },
        dyntype_add_elem: (ctx, arr, elem) => {
            arr.push(elem);
            return true;
        },
        dyntype_set_elem: (ctx, arr, idx, elem) => {
            arr[idx] = elem;
            return true;
        },
        dyntype_get_elem: (ctx, arr, idx) => {
            return arr[idx];
        },
        dyntype_typeof: (ctx, value) => {
            // TODO
            return 0;
        },

        dyntype_type_eq: (ctx, a, b) => {
            // TODO
            return 1;
        },

        dyntype_new_object: (ctx) => new Object(),
        dyntype_set_property: (ctx, obj, prop, value) => {
            obj[prop] = value;
            return true;
        },
        dyntype_get_property: (ctx, obj, prop) => {
            return obj[prop];
        },
        dyntype_has_property: (ctx, obj, prop) => {
            return prop in obj;
        },
        dyntype_is_object: (ctx, obj) => {
            return typeof obj === 'object';
        },

        dyntype_new_undefined: (ctx) => undefined,

        dyntype_new_null: (ctx) => null,

        dyntype_new_extref: (ctx, value, flag) => {
            const ref = new Object();
            ref['ptr'] = value;
            ref['tag'] = flag;
            return ref;
        },
        dyntype_is_extref: (ctx, obj) => {
            const tag = obj['tag'];
            if (tag === 0 || tag === 1 || tag === 2 || tag === 3) {
                return true;
            }
            return false;
        },
        dyntype_to_extref: (ctx, obj, pres) => {
            const memView = new DataView(wasmMemory.buffer);
            memView.setInt32(pres, obj['ptr'], true);
        },

        dyntype_get_prototype: (ctx, obj) => {
            // TODO
            return obj;
        },
        dyntype_set_prototype: (ctx, obj1, obj2) => {
            return 1;
        },
    },
    env: {
        console_log: (obj) => {
            //
        },
        strcmp(a, b) {
            return a == b;
        },
    },
};

export const validateData = [
    'any_case1.wasm 1 1 1 anyTest',
    'any_case2.wasm 0 0 0 anyTest',
    'any_case3.wasm 1 0 1 anyTest',
    'any_case4.wasm 1 1 1 anyTest',
    'any_case5.wasm 0 0 0 anyTest',
    'any_case6.wasm 1 1 1 anyTest',
    'any_case7.wasm 1 1 3 anyTest',
    'any_case8.wasm 0 0 0 anyTest',
    'any_case9.wasm 1 3 0 anyTest',
    'any_case10.wasm 0 0 0 anyTest',
    'any_case11.wasm 1 0 1 anyTest',
    'any_case12.wasm 1 1 1 anyTest',
    'any_case13.wasm 1 1 1 anyTest',
    'any_case14.wasm 1 1 1 anyTest',
    'any_case15.wasm 1 1 4 anyTest',
    'any_case16.wasm 1 1 2 anyTest',
    'any_case17.wasm 1 1 2 anyTest',
    'any_case18.wasm 1 1 3 anyTest',
    'any_case19.wasm 1 1 1 anyTest',
    'any_case20.wasm 1 1 9 anyTest',
    'any_case21.wasm 1 1 2 anyTest',
    'any_case22.wasm 0 0 0 anyTest',
    'any_case23.wasm 0 0 0 anyTest',
    'array_case1.wasm 1 1 3 arrayTest1',
    'array_case2.wasm 0 1 3 arrayTest2',
    'array_case3.wasm 1 1 1 arrayTest3',
    'array_case4.wasm 0 1 1 arrayTest4',
    'array_case5.wasm 1 1 5 arrayTest5',
    'array_case6.wasm 1 1 1 arrayTest6',
    'array_case7.wasm 0 1 1 arrayTest7',
    'array_case8.wasm 0 1 1 arrayTest8',
    'array_case9.wasm 0 1 1 arrayTest9',
    'array_case10.wasm 1 1 3 arrayTest10',
    'binary_expression_case1.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case2.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case3.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case4.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case5.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case6.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case7.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case8.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case9.wasm 1 1 3 binaryExpressionTest',
    'binary_expression_case10.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case11.wasm 1 1 4 binaryExpressionTest',
    'binary_expression_case12.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case13.wasm 1 1 3 binaryExpressionTest',
    'binary_expression_case14.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case15.wasm 1 1 6 binaryExpressionTest',
    'binary_expression_case16.wasm 1 1 2 binaryExpressionTest',
    'binary_expression_case17.wasm 1 1 -1 binaryExpressionTest',
    'binary_expression_case18.wasm 1 1 -1 binaryExpressionTest',
    'binary_expression_case19.wasm 1 1 -1 binaryExpressionTest',
    'binary_expression_case20.wasm 1 1 -1 binaryExpressionTest',
    'binary_expression_case21.wasm 1 1 3 binaryExpressionTest',
    'binary_expression_case22.wasm 1 1 -1 binaryExpressionTest',
    'binary_expression_case23.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case24.wasm 1 1 20 binaryExpressionTest',
    'binary_expression_case25.wasm 1 1 0 binaryExpressionTest',
    'binary_expression_case26.wasm 1 1 0 binaryExpressionTest',
    'binary_expression_case27.wasm 1 1 0 binaryExpressionTest',
    'binary_expression_case28.wasm 1 1 10 binaryExpressionTest',
    'binary_expression_case29.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case30.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case31.wasm 1 1 0 binaryExpressionTest',
    'binary_expression_case32.wasm 1 1 1 binaryExpressionTest',
    'binary_expression_case33.wasm 1 1 1 binaryExpressionTest',
    'block_case1.wasm 1 1 3 blockTest',
    'block_case2.wasm 1 1 8 blockTest',
    'boolean_type_case1.wasm 1 1 1 booleanTestCase1',
    'boolean_type_case2.wasm 1 1 0 booleanTestCase2',
    'boolean_type_case3.wasm 1 1 0 booleanTestCase3',
    'boolean_type_case4.wasm 1 1 1 booleanTestCase4',
    'boolean_type_case5.wasm 1 1 1 booleanTestCase5',
    'boolean_type_case6.wasm 1 1 0 booleanTestCase6',
    'boolean_type_case7.wasm 0 1 0 booleanTestCase7',
    'boolean_type_case8.wasm 1 1 2 booleanTestCase8',
    'builtin_array_case1.wasm 1 1 3 arrayTest',
    'builtin_Math_case1.wasm 1 1 3 mathTest',
    'builtin_Math_case2.wasm 1 1 9 mathTest',
    'builtin_array_case1.wasm 1 1 3 arrayTest',
    'builtin_Math_case1.wasm 1 1 3 mathTest',
    'builtin_Math_case2.wasm 1 1 9 mathTest',
    'builtin_string_case3.wasm 1 1 5 strTest',
    'call_expression_case1.wasm 1 1 6 callExpressionTest',
    'call_expression_case2.wasm 1 1 6 callExpressionTest',
    'call_expression_case3.wasm 1 1 5 callExpressionTest',
    'call_expression_case4.wasm 1 1 116 callExpressionTest',
    'call_expression_case5.wasm 1 1 6 callExpressionTest',
    'call_expression_case6.wasm 1 1 30 callInternalReturnTest 1 10 1 11',
    'call_expression_case7.wasm 1 1 134 callInternalReturnTest 1 10 1 11',
    'call_expression_function_hoisting_case1.wasm 0 0 0 callReturnTest',
    'call_expression_recursive_case1.wasm 1 1 55 fibonacci 1 10',
    'class_case1.wasm 1 1 123 classTest',
    'class_case2.wasm 1 1 10 classTest',
    'class_case3.wasm 1 1 10 classTest',
    'class_case5.wasm 1 1 1 classTest5',
    'class_case6.wasm 1 1 90 classTest6',
    'class_case7.wasm 1 1 40 classTest7',
    'class_case8.wasm 1 1 21 classTest8',
    'class_case9.wasm 1 1 25 classTest9',
    'class_case10.wasm 1 1 26 classTest10',
    'class_case11.wasm 1 1 18 classTest11',
    'class_case12.wasm 1 1 0 classTest12',
    'class_case13.wasm 1 1 1 classTest13',
    'class_case14.wasm 1 1 1 classTest14',
    'class_case15.wasm 1 1 2 classTest15',
    'class_case16.wasm 1 1 1 classTest16',
    'class_case17.wasm 1 1 1 classTest17',
    'class_case18.wasm 1 1 34 classTest',
    'class_case19.wasm 1 1 74 classTest',
    'closure_case1.wasm 1 1 3 closureTest',
    'closure_case2.wasm 1 1 2 closureTest',
    'closure_case3.wasm 1 1 10 closureTest',
    'closure_case4.wasm 1 1 1 closureTest',
    'closure_case5.wasm 0 1 1 ClosureTest',
    'closure_case6.wasm 1 1 3 closureTest',
    'closure_case7.wasm 0 1 3 closureTest',
    'closure_case8.wasm 1 1 21 firstClassFuncTest',
    'closure_case9.wasm 1 1 10 firstClassFuncTest',
    'do_statement_case1.wasm 1 1 16 doTest',
    'do_statement_case2.wasm 1 1 10 doTest',
    'do_statement_case3.wasm 1 1 21 doTest',
    'do_statement_case4.wasm 1 1 16 doTest',
    'do_statement_case5.wasm 1 1 16 doTest',
    'for_statement_case1.wasm 1 1 100 forTest',
    'for_statement_case2.wasm 1 1 90 forTest',
    'for_statement_case3.wasm 1 1 100 forTest',
    'for_statement_case4.wasm 1 1 106 forTest',
    'for_statement_case5.wasm 1 1 105 forTest',
    'for_statement_case6.wasm 1 1 115 forTest',
    'for_statement_case7.wasm 1 1 4905 forTest',
    'switch_case_case1.wasm 1 1 1 switchCaseCase1',
    'switch_case_case2.wasm 1 1 0 switchCaseCase2',
    'switch_case_case3.wasm 1 1 0 switchCaseCase3',
    'switch_case_case4.wasm 1 1 10 switchCaseCase4',
    'switch_case_case5.wasm 1 1 11 switchCaseCase5',
    'switch_case_case6.wasm 1 1 10 switchCaseCase6',
    'switch_case_case7.wasm 1 1 11 switchCaseCase7',
    'switch_case_case8.wasm 1 1 11 switchCaseCase8',
    'switch_case_case9.wasm 1 1 1 switchCaseCase9',
    'switch_case_case10.wasm 1 1 20 switchCaseCase10',
    'variable_var_case3.wasm 1 1 10 funcvv3',
    'while_statement_case1.wasm 1 1 10 whileTest',
    'while_statement_case2.wasm 1 1 100 whileTest',
    'while_statement_case3.wasm 1 1 49 whileTest'];

export function typeConvert(type, arg) {
    switch (type) {
        case '0': {
            // boolean
            if (arg == '0') {
                return false;
            } else if (arg == '1') {
                return true;
            } else {
                console.error(`the input argument is not a boolean: ${arg}`);
            }
            break;
        }
        case '1': // number
            return parseFloat(arg);
        case '2': // string, currently not support
            return arg;
        case '3': // undefined
            return undefined;
        case '4': // null
            return null;
        default:
            console.error(
                `the input argument is not a boolean, number or string: [${type}: ${arg}]`,
            );
    }
}

/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

#include "dyntype.h"
#include "quickjs.h"
#include "gc_export.h"
#include "bh_platform.h"
#include "./utils.h"

/* When growing an array, allocate more slots to avoid frequent allocation */
#define ARRAY_GROW_REDUNDANCE 16

double
array_push_generic(wasm_exec_env_t exec_env, void *ctx, void *obj, void *value)
{
    uint32 len, value_len, capacity;
    wasm_array_type_t arr_type;
    wasm_array_obj_t new_arr;
    wasm_array_obj_t arr_ref = get_array_ref(obj);
    wasm_array_obj_t value_arr_ref = get_array_ref(value);
    wasm_value_t init = { .gc_obj = NULL }, tmp_val = { 0 };

    len = get_array_length(obj);
    value_len = get_array_length(value);

    capacity = get_array_capacity(obj);

    arr_type =
        (wasm_array_type_t)wasm_obj_get_defined_type((wasm_obj_t)arr_ref);

    if (len + value_len >= capacity) {
        /* Current array space not enough, create new array */
        uint32 new_len = len + value_len + ARRAY_GROW_REDUNDANCE;
        new_arr =
            wasm_array_obj_new_with_type(exec_env, arr_type, new_len, &init);
        wasm_array_obj_copy(new_arr, 0, arr_ref, 0, len);
        wasm_array_obj_copy(new_arr, len, value_arr_ref, 0, value_len);

        tmp_val.gc_obj = (wasm_obj_t)new_arr;
        wasm_struct_obj_set_field(obj, 0, &tmp_val);
    }
    else {
        /* Append in current array */
        wasm_array_obj_copy(arr_ref, len, value_arr_ref, 0, value_len);
    }

    /* Update array length */
    tmp_val.u32 = len + value_len;
    wasm_struct_obj_set_field(obj, 1, &tmp_val);

    return (double)(len + value_len);
}

#define ARRAY_POP_API(return_type, wasm_type, wasm_field)                      \
    return_type array_pop_##wasm_type(wasm_exec_env_t exec_env, void *ctx,     \
                                      void *obj)                               \
    {                                                                          \
        uint32 len;                                                            \
        return_type res;                                                       \
        wasm_array_obj_t arr_ref = get_array_ref(obj);                         \
        wasm_value_t value = { 0 };                                            \
                                                                               \
        len = get_array_length(obj);                                           \
        if (len == 0) {                                                        \
            wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env), \
                                       "array is empty");                      \
            return 0;                                                          \
        }                                                                      \
                                                                               \
        wasm_array_obj_get_elem(arr_ref, len - 1, false, &value);              \
        res = value.wasm_field;                                                \
                                                                               \
        value.u32 = len - 1;                                                   \
        wasm_struct_obj_set_field(obj, 1, &value);                             \
                                                                               \
        return res;                                                            \
    }

ARRAY_POP_API(double, f64, f64)
ARRAY_POP_API(float, f32, f32)
ARRAY_POP_API(uint64, i64, i64)
ARRAY_POP_API(uint32, i32, i32)
ARRAY_POP_API(void *, anyref, gc_obj)

void *
array_concat_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                     void *value)
{
    wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                               "not implemented");
    return NULL;
}

void *
array_reverse_generic(wasm_exec_env_t exec_env, void *ctx, void *obj)
{
    wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                               "not implemented");
    return NULL;
}

#define ARRAY_SHIFT_API(return_type, wasm_type, wasm_field)                  \
    return_type array_shift_##wasm_type(wasm_exec_env_t exec_env, void *ctx, \
                                        void *obj)                           \
    {                                                                        \
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),   \
                                   "not implemented");                       \
                                                                             \
        return 0;                                                            \
    }

ARRAY_SHIFT_API(double, f64, f64)
ARRAY_SHIFT_API(float, f32, f32)
ARRAY_SHIFT_API(uint64, i64, i64)
ARRAY_SHIFT_API(uint32, i32, i32)
ARRAY_SHIFT_API(void *, anyref, gc_obj)

void *
array_slice_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                    void *start_obj, void *end_obj)
{
    uint32 len, new_len;
    wasm_struct_obj_t new_arr_struct = NULL;
    wasm_array_obj_t new_arr, arr_ref = get_array_ref(obj);
    wasm_module_inst_t module_inst = wasm_runtime_get_module_inst(exec_env);
    wasm_struct_type_t struct_type;
    wasm_array_type_t arr_type;
    wasm_value_t init = {0}, tmp_val = {0};
    struct_type =
        (wasm_struct_type_t)wasm_obj_get_defined_type((wasm_obj_t)obj);
    arr_type =
        (wasm_array_type_t)wasm_obj_get_defined_type((wasm_obj_t)arr_ref);


    len = get_array_length(obj);
    if (len == 0) {
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                                   "array is empty!");
        return NULL;
    }

    const JSValue* start_idx = wasm_anyref_obj_get_value(start_obj);
    const JSValue* end_idx = wasm_anyref_obj_get_value(end_obj);
    int iter = JS_VALUE_GET_INT(*start_idx);
    int end = JS_VALUE_GET_INT(*end_idx);
    iter = iter < 0 ? 0 : iter;
    end = end > len ? len : end;
    new_len = end - iter;
    new_arr =
        wasm_array_obj_new_with_type(exec_env, arr_type, new_len, &init);
    if (!new_arr) {
        wasm_runtime_set_exception((wasm_module_inst_t)module_inst,
                                   "alloc memory failed");
        goto end;
    }

    for (int i = 0;iter != end; iter++, i++) {
        wasm_array_obj_get_elem(arr_ref, iter, false, &tmp_val);
        wasm_array_obj_set_elem(new_arr, i, &tmp_val);
    }

    new_arr_struct = wasm_struct_obj_new_with_type(exec_env, struct_type);

    if (!new_arr_struct) {
        wasm_runtime_set_exception((wasm_module_inst_t)module_inst,
                                   "alloc memory failed");
        goto end;
    }

    tmp_val.gc_obj = (wasm_obj_t)new_arr;
    wasm_struct_obj_set_field(new_arr_struct, 0, &tmp_val);
    tmp_val.u32 = new_len;
    wasm_struct_obj_set_field(new_arr_struct, 1, &tmp_val);
end:
    return new_arr_struct;
}

void quick_sort(wasm_exec_env_t exec_env, wasm_array_obj_t arr, int l, int r, 
        wasm_func_obj_t closure_func, wasm_value_t context) {
    
    if (l >= r) return;
    int i = l - 1, j = r + 1, pivot_idx = (l + r) >> 1;
    double cmp_res;
    wasm_value_t pivot_elem, elem, tmp_elem, left_elem, right_elem;

    wasm_array_obj_get_elem(arr, pivot_idx, false, &pivot_elem);
    uint32 argv[6], argc = 6;
    /* argc should be 6 means 3 args*/
    uint bsize = sizeof(argv); // actual byte size of argv
    while(i < j) {
        do {
            i++;
            /* arg0: context */
            b_memcpy_s(argv, bsize, &(context.gc_obj), sizeof(void *));
            /* arg1: pivot elem*/
            b_memcpy_s(argv + 2, bsize - 2 * sizeof(uint32),
                       &pivot_elem.gc_obj,
                       sizeof(void *));
            /* arg2: elem*/
            wasm_array_obj_get_elem(arr, i, false, &elem);
            b_memcpy_s(argv + 4, bsize - 4 * sizeof(uint32),
                       &elem.gc_obj,
                       sizeof(void *));
            wasm_runtime_call_func_ref(exec_env,
                    closure_func, argc, argv);
            cmp_res = *(double*)argv;

            // printf("comp left %f\n", cmp_res);
        } while(cmp_res > 0.0);

        do {
            j--;
            /* arg0: context */
            b_memcpy_s(argv, bsize, &(context.gc_obj), sizeof(void *));
            /* arg1: pivot elem*/
            b_memcpy_s(argv + 2, bsize - 2 * sizeof(uint32),
                       &pivot_elem.gc_obj,
                       sizeof(void *));
            /* arg2: elem*/
            wasm_array_obj_get_elem(arr, j, false, &elem);
            b_memcpy_s(argv + 4, bsize - 4 * sizeof(uint32),
                       &elem.gc_obj,
                       sizeof(void *));
            wasm_runtime_call_func_ref(exec_env,
                        closure_func, argc, argv);

            // printf("comp right %f\n", cmp_res);
            cmp_res = *(double*)argv;
        } while(cmp_res < 0.0);

        if (i < j) {
            wasm_array_obj_get_elem(arr, i, false, &left_elem);
            wasm_array_obj_get_elem(arr, j, false, &right_elem);
            tmp_elem = left_elem;
            wasm_array_obj_set_elem(arr, i, &right_elem);
            wasm_array_obj_set_elem(arr, j, &tmp_elem);
        }
    }

    quick_sort(exec_env, arr, l, j, closure_func, context);
    quick_sort(exec_env, arr, j + 1, r, closure_func, context);
}


void *
array_sort_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                   void *closure)
{
    uint32 len;
    wasm_value_t context = {0}, func_obj = {0};
    wasm_array_obj_t arr_ref = get_array_ref(obj);
    len = get_array_length(obj);
    /* get closure context and func ref */
    wasm_struct_obj_get_field(closure, 0, false, &context);
    wasm_struct_obj_get_field(closure, 1, false, &func_obj);
    quick_sort(exec_env, arr_ref, 0, len - 1, (wasm_func_obj_t)func_obj.gc_obj, context);
    return obj;
}

void *
array_splice_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                     double start, void *delete_count_obj, void *value)
{
    wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                               "not implemented");
    return NULL;
}

double
array_unshift_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                      void *value)
{
    wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                               "not implemented");
    return 0;
}

#define ARRAY_INDEXOF_API(elem_type, wasm_type, wasm_field)                \
    double array_indexOf_##wasm_type(wasm_exec_env_t exec_env, void *ctx,  \
                                     void *obj, elem_type element,         \
                                     void *from_index_obj)                 \
    {                                                                      \
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env), \
                                   "not implemented");                     \
                                                                           \
        return -1;                                                         \
    }

ARRAY_INDEXOF_API(double, f64, f64)
ARRAY_INDEXOF_API(float, f32, f32)
ARRAY_INDEXOF_API(uint64, i64, i64)
ARRAY_INDEXOF_API(uint32, i32, i32)
ARRAY_INDEXOF_API(void *, anyref, gc_obj)

#define ARRAY_LAST_INDEXOF_API(elem_type, wasm_type, wasm_field)              \
    double array_lastIndexOf_##wasm_type(wasm_exec_env_t exec_env, void *ctx, \
                                         void *obj, elem_type element,        \
                                         void *from_index_obj)                \
    {                                                                         \
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),    \
                                   "not implemented");                        \
                                                                              \
        return -1;                                                            \
    }

ARRAY_LAST_INDEXOF_API(double, f64, f64)
ARRAY_LAST_INDEXOF_API(float, f32, f32)
ARRAY_LAST_INDEXOF_API(uint64, i64, i64)
ARRAY_LAST_INDEXOF_API(uint32, i32, i32)
ARRAY_LAST_INDEXOF_API(void *, anyref, gc_obj)

bool
array_every_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                    void *closure)
{
    wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                               "not implemented");
    return 0;
}

bool
array_some_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                   void *closure)
{
    wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                               "not implemented");
    return 0;
}

void *
array_forEach_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                      void *closure)
{
    uint32 i, len;
    wasm_array_obj_t arr_ref = get_array_ref(obj);

    len = get_array_length(obj);

    /* invoke callback function */
    for (i = 0; i < len; i++) {
        uint32 argv[10];
        uint32 argc = 8;
        WASMValue element = { 0 };
        WASMValue context = { 0 }, func_obj = { 0 };

        /* get closure context and func ref */
        wasm_struct_obj_get_field(closure, 0, false, &context);
        wasm_struct_obj_get_field(closure, 1, false, &func_obj);

        wasm_array_obj_get_elem(arr_ref, i, false, &element);

        /* prepare args to callback */
        /* arg0: context */
        b_memcpy_s(argv, sizeof(argv), &context.gc_obj, sizeof(void *));
        /* arg1: element */
        b_memcpy_s(argv + 2, sizeof(argv) - 2 * sizeof(uint32), &element.gc_obj,
                   sizeof(void *));
        /* arg2: index */
        *(double *)(argv + 4) = i;
        /* arg3: arr */
        b_memcpy_s(argv + 6, sizeof(argv) - 6 * sizeof(uint32), &obj,
                   sizeof(void *));

        wasm_runtime_call_func_ref(exec_env, (wasm_func_obj_t)func_obj.gc_obj,
                                   argc, argv);
    }

    return wasm_anyref_obj_new(exec_env,
                               dyntype_new_undefined(dyntype_get_context()));
}

void *
array_map_generic(wasm_exec_env_t exec_env, void *ctx, void *obj, void *closure)
{
    uint32 i, len;
    uint32 res_arr_type_idx;
    wasm_array_obj_t new_arr;
    wasm_struct_obj_t new_arr_struct = NULL;
    wasm_array_obj_t arr_ref = get_array_ref(obj);
    wasm_module_inst_t module_inst = wasm_runtime_get_module_inst(exec_env);
    wasm_module_t module = wasm_runtime_get_module(module_inst);
    wasm_value_t init = { 0 }, tmp_val = { 0 };
    wasm_func_type_t cb_func_type;
    wasm_ref_type_t cb_ret_ref_type;
    wasm_struct_type_t res_arr_struct_type = NULL;
    wasm_array_type_t res_arr_type = NULL;
    wasm_value_t element = { 0 };
    wasm_value_t context = { 0 }, func_obj = { 0 };

    /* get closure context and func ref */
    wasm_struct_obj_get_field(closure, 0, false, &context);
    wasm_struct_obj_get_field(closure, 1, false, &func_obj);

    len = get_array_length(obj);

    /* get callback func return type */
    cb_func_type =
        wasm_func_obj_get_func_type((wasm_func_obj_t)func_obj.gc_obj);
    cb_ret_ref_type = wasm_func_type_get_result_type(cb_func_type, 0);

    /* get result array type */
    res_arr_type_idx = get_array_type_by_element(module, &cb_ret_ref_type, true,
                                                 &res_arr_type);
    bh_assert(
        wasm_defined_type_is_array_type((wasm_defined_type_t)res_arr_type));

    /* get result array struct type */
    get_array_struct_type(module, res_arr_type_idx, &res_arr_struct_type);
    bh_assert(wasm_defined_type_is_struct_type(
        (wasm_defined_type_t)res_arr_struct_type));

    /* create new array */
    new_arr = wasm_array_obj_new_with_type(exec_env, res_arr_type, len, &init);
    if (!new_arr) {
        wasm_runtime_set_exception((wasm_module_inst_t)module_inst,
                                   "alloc memory failed");
        return NULL;
    }

    /* invoke callback function */
    for (i = 0; i < len; i++) {
        uint32 argv[10];
        uint32 argc = 8;

        wasm_array_obj_get_elem(arr_ref, i, false, &element);

        /* prepare args to callback */
        /* arg0: context */
        b_memcpy_s(argv, sizeof(argv), &context.gc_obj, sizeof(void *));
        /* arg1: element */
        b_memcpy_s(argv + 2, sizeof(argv) - 2 * sizeof(uint32), &element.gc_obj,
                   sizeof(void *));
        /* arg2: index */
        *(double *)(argv + 4) = i;
        /* arg3: arr */
        b_memcpy_s(argv + 6, sizeof(argv) - 6 * sizeof(uint32), &obj,
                   sizeof(void *));

        wasm_runtime_call_func_ref(exec_env, (wasm_func_obj_t)func_obj.gc_obj,
                                   argc, argv);
        wasm_array_obj_set_elem(new_arr, i, (wasm_value_t *)argv);
    }

    /* wrap with struct */
    new_arr_struct =
        wasm_struct_obj_new_with_type(exec_env, res_arr_struct_type);
    if (!new_arr_struct) {
        wasm_runtime_set_exception((wasm_module_inst_t)module_inst,
                                   "alloc memory failed");
        return NULL;
    }
    tmp_val.gc_obj = (wasm_obj_t)new_arr;
    wasm_struct_obj_set_field(new_arr_struct, 0, &tmp_val);
    tmp_val.u32 = len;
    wasm_struct_obj_set_field(new_arr_struct, 1, &tmp_val);

    return new_arr_struct;
}

void *
array_filter_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                     void *closure)
{
    uint32 i, len, new_arr_len, include_idx = 0;
    wasm_struct_obj_t new_arr_struct = NULL;
    wasm_array_obj_t new_arr, arr_ref = get_array_ref(obj);
    wasm_struct_type_t struct_type;
    wasm_array_type_t arr_type;
    wasm_module_inst_t module_inst = wasm_runtime_get_module_inst(exec_env);
    wasm_value_t init = { 0 }, tmp_val = { 0 };
    wasm_obj_t *include_refs = NULL;

    len = get_array_length(obj);

    struct_type =
        (wasm_struct_type_t)wasm_obj_get_defined_type((wasm_obj_t)obj);
    arr_type =
        (wasm_array_type_t)wasm_obj_get_defined_type((wasm_obj_t)arr_ref);

    /* prepare a buffer to hold included reference */
    include_refs = wasm_runtime_malloc(sizeof(wasm_obj_t) * len);
    if (!include_refs) {
        wasm_runtime_set_exception(module_inst, "alloc memory failed");
        return NULL;
    }

    memset(include_refs, 0, sizeof(wasm_obj_t) * len);
    /* invoke callback function */
    for (i = 0; i < len; i++) {
        uint32 argv[10];
        uint32 argc = 8;
        wasm_value_t element = { 0 };
        wasm_value_t context = { 0 }, func_obj = { 0 };

        /* get closure context and func ref */
        wasm_struct_obj_get_field(closure, 0, false, &context);
        wasm_struct_obj_get_field(closure, 1, false, &func_obj);

        wasm_array_obj_get_elem(arr_ref, i, false, &element);

        /* prepare args to callback */
        /* arg0: context */
        b_memcpy_s(argv, sizeof(argv), &context.gc_obj, sizeof(void *));
        /* arg1: element */
        b_memcpy_s(argv + 2, sizeof(argv) - 2 * sizeof(uint32), &element.gc_obj,
                   sizeof(void *));
        /* arg2: index */
        *(double *)(argv + 4) = i;
        /* arg3: arr */
        b_memcpy_s(argv + 6, sizeof(argv) - 6 * sizeof(uint32), &obj,
                   sizeof(void *));

        wasm_runtime_call_func_ref(exec_env, (wasm_func_obj_t)func_obj.gc_obj,
                                   argc, argv);
        if (argv[0]) {
            include_refs[include_idx++] = element.gc_obj;
        }
    }

    /* create new array */
    new_arr_len = include_idx;
    new_arr =
        wasm_array_obj_new_with_type(exec_env, arr_type, new_arr_len, &init);
    if (!new_arr) {
        wasm_runtime_set_exception((wasm_module_inst_t)module_inst,
                                   "alloc memory failed");
        goto end;
    }
    for (i = 0; i < new_arr_len; i++) {
        wasm_value_t elem = { .gc_obj = include_refs[i] };
        wasm_array_obj_set_elem(new_arr, i, &elem);
    }

    /* wrap with struct */
    new_arr_struct = wasm_struct_obj_new_with_type(exec_env, struct_type);
    if (!new_arr_struct) {
        wasm_runtime_set_exception((wasm_module_inst_t)module_inst,
                                   "alloc memory failed");
        goto end;
    }
    tmp_val.gc_obj = (wasm_obj_t)new_arr;
    wasm_struct_obj_set_field(new_arr_struct, 0, &tmp_val);
    tmp_val.u32 = new_arr_len;
    wasm_struct_obj_set_field(new_arr_struct, 1, &tmp_val);

end:
    if (include_refs) {
        wasm_runtime_free(include_refs);
    }

    return new_arr_struct;
}

#define ARRAY_REDUCE_API(elem_type, wasm_type, wasm_field)                  \
    elem_type array_reduce_##wasm_type(wasm_exec_env_t exec_env, void *ctx, \
                                       void *obj, void *closure,            \
                                       elem_type initial_value)             \
    {                                                                       \
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),  \
                                   "not implemented");                      \
                                                                            \
        return 0;                                                           \
    }

ARRAY_REDUCE_API(double, f64, f64)
ARRAY_REDUCE_API(float, f32, f32)
ARRAY_REDUCE_API(uint64, i64, i64)
ARRAY_REDUCE_API(uint32, i32, i32)
ARRAY_REDUCE_API(void *, anyref, gc_obj)

#define ARRAY_REDUCE_RIGHT_API(elem_type, wasm_type, wasm_field)           \
    elem_type array_reduceRight_##wasm_type(                               \
        wasm_exec_env_t exec_env, void *ctx, void *obj, void *closure,     \
        elem_type initial_value)                                           \
    {                                                                      \
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env), \
                                   "not implemented");                     \
                                                                           \
        return 0;                                                          \
    }

ARRAY_REDUCE_RIGHT_API(double, f64, f64)
ARRAY_REDUCE_RIGHT_API(float, f32, f32)
ARRAY_REDUCE_RIGHT_API(uint64, i64, i64)
ARRAY_REDUCE_RIGHT_API(uint32, i32, i32)
ARRAY_REDUCE_RIGHT_API(void *, anyref, gc_obj)

#define ARRAY_FIND_API(elem_type, wasm_type, wasm_field)                   \
    void *array_find_##wasm_type(wasm_exec_env_t exec_env, void *ctx,      \
                                 void *obj, void *closure)                 \
    {                                                                      \
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env), \
                                   "not implemented");                     \
                                                                           \
        return NULL;                                                       \
    }

ARRAY_FIND_API(double, f64, f64)
ARRAY_FIND_API(float, f32, f32)
ARRAY_FIND_API(uint64, i64, i64)
ARRAY_FIND_API(uint32, i32, i32)
ARRAY_FIND_API(void *, anyref, gc_obj)

double
array_findIndex_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                        void *closure)
{
    wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                               "not implemented");
    return -1;
}

#define ARRAY_FILL_API(elem_type, wasm_type, wasm_field)                      \
    void *array_fill_##wasm_type(wasm_exec_env_t exec_env, void *ctx,         \
                                 void *obj, elem_type fill_value, void *start_obj, \
                                 void *end_obj)                               \
    {                                                                          \
        uint32 len;                                                            \
        wasm_array_obj_t arr_ref = get_array_ref(obj);                         \
        wasm_value_t value = { 0 };                                            \
        len = get_array_length(obj);                                           \
        if (len == 0) {                                                        \
            wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env), \
                                       "array is empty");                      \
            return 0;                                                          \
        }                                                                      \
        value.wasm_field = fill_value;                                         \
        const JSValue* start_idx = wasm_anyref_obj_get_value(start_obj);       \
        const JSValue* end_idx = wasm_anyref_obj_get_value(end_obj);           \
        int iter = JS_VALUE_GET_INT(*start_idx), end = JS_VALUE_GET_INT(*end_idx); \
        iter = iter < 0 ? 0 : iter;                                            \
        end = end > len ? len : end;                                           \
        for (; iter != end; iter++) {                                          \
            wasm_array_obj_set_elem(arr_ref, iter, &value);                    \
        }                                                                      \
        return obj;                                                           \
    }

ARRAY_FILL_API(double, f64, f64)
ARRAY_FILL_API(float, f32, f32)
ARRAY_FILL_API(uint64, i64, i64)
ARRAY_FILL_API(uint32, i32, i32)
ARRAY_FILL_API(void *, anyref, gc_obj)

void *
array_copyWithin_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                         double target, double start, void *end_obj)
{
    wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                               "not implemented");
    return NULL;
}

#define ARRAY_INCLUDES_API(elem_type, wasm_type, wasm_field)               \
    bool array_includes_##wasm_type(wasm_exec_env_t exec_env, void *ctx,   \
                                    void *obj, elem_type search_elem,      \
                                    void *from_obj)                        \
    {                                                                      \
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env), \
                                   "not implemented");                     \
                                                                           \
        return false;                                                      \
    }

ARRAY_INCLUDES_API(double, f64, f64)
ARRAY_INCLUDES_API(float, f32, f32)
ARRAY_INCLUDES_API(uint64, i64, i64)
ARRAY_INCLUDES_API(uint32, i32, i32)
ARRAY_INCLUDES_API(void *, anyref, gc_obj)

/* clang-format off */
#define REG_NATIVE_FUNC(func_name, signature) \
    { #func_name, func_name, signature, NULL }

static NativeSymbol native_symbols[] = {
    REG_NATIVE_FUNC(array_push_generic, "(rrr)F"),
    REG_NATIVE_FUNC(array_pop_f64, "(rr)F"),
    REG_NATIVE_FUNC(array_pop_f32, "(rr)f"),
    REG_NATIVE_FUNC(array_pop_i64, "(rr)I"),
    REG_NATIVE_FUNC(array_pop_i32, "(rr)i"),
    REG_NATIVE_FUNC(array_pop_anyref, "(rr)r"),
    REG_NATIVE_FUNC(array_concat_generic, "(rrr)r"),
    REG_NATIVE_FUNC(array_reverse_generic, "(rr)r"),
    REG_NATIVE_FUNC(array_shift_f64, "(rr)F"),
    REG_NATIVE_FUNC(array_shift_f32, "(rr)f"),
    REG_NATIVE_FUNC(array_shift_i64, "(rr)I"),
    REG_NATIVE_FUNC(array_shift_i32, "(rr)i"),
    REG_NATIVE_FUNC(array_shift_anyref, "(rr)r"),
    REG_NATIVE_FUNC(array_slice_generic, "(rrrr)r"),
    REG_NATIVE_FUNC(array_sort_generic, "(rrr)r"),
    REG_NATIVE_FUNC(array_splice_generic, "(rrFrr)r"),
    REG_NATIVE_FUNC(array_unshift_generic, "(rrr)F"),
    REG_NATIVE_FUNC(array_indexOf_f64, "(rrFr)F"),
    REG_NATIVE_FUNC(array_indexOf_f32, "(rrfr)F"),
    REG_NATIVE_FUNC(array_indexOf_i64, "(rrIr)F"),
    REG_NATIVE_FUNC(array_indexOf_i32, "(rrir)F"),
    REG_NATIVE_FUNC(array_indexOf_anyref, "(rrrr)F"),
    REG_NATIVE_FUNC(array_lastIndexOf_f64, "(rrFr)F"),
    REG_NATIVE_FUNC(array_lastIndexOf_f32, "(rrfr)F"),
    REG_NATIVE_FUNC(array_lastIndexOf_i64, "(rrIr)F"),
    REG_NATIVE_FUNC(array_lastIndexOf_i32, "(rrir)F"),
    REG_NATIVE_FUNC(array_lastIndexOf_anyref, "(rrrr)F"),
    REG_NATIVE_FUNC(array_every_generic, "(rrr)i"),
    REG_NATIVE_FUNC(array_some_generic, "(rrr)i"),
    REG_NATIVE_FUNC(array_forEach_generic, "(rrr)r"),
    REG_NATIVE_FUNC(array_map_generic, "(rrr)r"),
    REG_NATIVE_FUNC(array_filter_generic, "(rrr)r"),
    REG_NATIVE_FUNC(array_reduce_f64, "(rrrF)F"),
    REG_NATIVE_FUNC(array_reduce_f32, "(rrrf)f"),
    REG_NATIVE_FUNC(array_reduce_i64, "(rrrI)I"),
    REG_NATIVE_FUNC(array_reduce_i32, "(rrri)i"),
    REG_NATIVE_FUNC(array_reduce_anyref, "(rrrr)r"),
    REG_NATIVE_FUNC(array_reduceRight_f64, "(rrrF)F"),
    REG_NATIVE_FUNC(array_reduceRight_f32, "(rrrf)f"),
    REG_NATIVE_FUNC(array_reduceRight_i64, "(rrrI)I"),
    REG_NATIVE_FUNC(array_reduceRight_i32, "(rrri)i"),
    REG_NATIVE_FUNC(array_reduceRight_anyref, "(rrrr)r"),
    REG_NATIVE_FUNC(array_find_f64, "(rrr)r"),
    REG_NATIVE_FUNC(array_find_f32, "(rrr)r"),
    REG_NATIVE_FUNC(array_find_i64, "(rrr)r"),
    REG_NATIVE_FUNC(array_find_i32, "(rrr)r"),
    REG_NATIVE_FUNC(array_find_anyref, "(rrr)r"),
    REG_NATIVE_FUNC(array_findIndex_generic, "(rrr)F"),
    REG_NATIVE_FUNC(array_fill_f64, "(rrFrr)r"),
    REG_NATIVE_FUNC(array_fill_f32, "(rrfrr)r"),
    REG_NATIVE_FUNC(array_fill_i64, "(rrIrr)r"),
    REG_NATIVE_FUNC(array_fill_i32, "(rrirr)r"),
    REG_NATIVE_FUNC(array_fill_anyref, "(rrrrr)r"),
    REG_NATIVE_FUNC(array_copyWithin_generic, "(rrFFr)r"),
    REG_NATIVE_FUNC(array_includes_f64, "(rrFr)i"),
    REG_NATIVE_FUNC(array_includes_f32, "(rrfr)i"),
    REG_NATIVE_FUNC(array_includes_i64, "(rrIr)i"),
    REG_NATIVE_FUNC(array_includes_i32, "(rrir)i"),
    REG_NATIVE_FUNC(array_includes_anyref, "(rrrr)i"),
};
/* clang-format on */

uint32_t
get_lib_array_symbols(char **p_module_name, NativeSymbol **p_native_symbols)
{
    *p_module_name = "env";
    *p_native_symbols = native_symbols;
    return sizeof(native_symbols) / sizeof(NativeSymbol);
}

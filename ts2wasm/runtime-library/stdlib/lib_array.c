/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

#include "dyntype.h"
#include "quickjs.h"
#include "gc_export.h"
#include "bh_platform.h"
#include "./utils.h"
#include "wasm.h"

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

/* The implementation of the basic type must first implement the to_string interface */
#define ARRAY_JOIN_API(return_type, wasm_type, wasm_field)                 \
    void *array_join_##wasm_type(wasm_exec_env_t exec_env, void *ctx,      \
                                 void *obj, void *separator)               \
    {                                                                      \
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env), \
                                   "not implemented");                     \
        return NULL;                                                       \
    }

ARRAY_JOIN_API(double, f64, f64)
ARRAY_JOIN_API(float, f32, f32)
ARRAY_JOIN_API(uint64, i64, i64)
ARRAY_JOIN_API(uint32, i32, i32)

/* string type array join interface implementation */
void *
array_join_anyref(wasm_exec_env_t exec_env, void *ctx, void *obj,
                  void *separator)
{
    uint32 len, i, result_len, sep_len;
    uint32 *string_lengths;
    wasm_value_t value = { 0 }, field1 = { 0 };
    wasm_array_obj_t new_arr, arr_ref = get_array_ref(obj);
    wasm_struct_type_t string_struct_type = NULL;
    wasm_struct_obj_t new_string_struct = NULL;
    wasm_array_type_t string_array_type = NULL;
    wasm_local_obj_ref_t local_ref = { 0 };
    wasm_module_inst_t module_inst = wasm_runtime_get_module_inst(exec_env);
    wasm_module_t module = wasm_runtime_get_module(module_inst);
    char **string_addrs, *p, *p_end;
    char *sep = NULL;

    len = get_array_length(obj);

    string_lengths = wasm_runtime_malloc(len * sizeof(uint32));
    if (!string_lengths) {
        wasm_runtime_set_exception(module_inst, "alloc memory failed");
        return NULL;
    }

    string_addrs = wasm_runtime_malloc(len * sizeof(char *));
    if (!string_addrs) {
        wasm_runtime_set_exception(module_inst, "alloc memory failed");
        goto fail;
    }

    /* get separator */
    if (separator) {
        JSValue *js_value = (JSValue *)wasm_anyref_obj_get_value(separator);
        dyntype_to_cstring(dyntype_get_context(), js_value, &sep);
    }

    /* get struct_string_type */
    get_string_struct_type(module, &string_struct_type);
    bh_assert(string_struct_type != NULL);
    bh_assert(wasm_defined_type_is_struct_type(
        (wasm_defined_type_t)string_struct_type));

    /* wrap with string struct */
    new_string_struct =
        wasm_struct_obj_new_with_type(exec_env, string_struct_type);
    if (!new_string_struct) {
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                                   "alloc memory failed");
        goto fail;
    }

    /* Push object to local ref to avoid being freed at next allocation */
    wasm_runtime_push_local_object_ref(exec_env, &local_ref);
    local_ref.val = (wasm_obj_t)new_string_struct;

    for (i = 0; i < len; i++) {
        wasm_array_obj_get_elem(arr_ref, i, 0, &value);
        wasm_struct_obj_get_field((wasm_struct_obj_t)value.gc_obj, 1, false, &field1);
        if (array_element_is_string(module, (wasm_obj_t)value.gc_obj)) {
            wasm_array_obj_t str_array = (wasm_array_obj_t)field1.gc_obj;
            string_lengths[i] = wasm_array_obj_length(str_array);
            string_addrs[i] = wasm_array_obj_first_elem_addr(str_array);
        }
        else {
            wasm_runtime_set_exception(
                wasm_runtime_get_module_inst(exec_env),
                "array join for non-string type not implemented");
            goto fail;
        }
    }

    result_len = 0;
    /* If there is no separator, it will be separated by ',' by default */
    sep_len = sep ? strlen(sep) : strlen(",");
    for (i = 0; i < len; i++) {
        result_len += string_lengths[i] + sep_len;
    }
    if (len >= 1) {
        /* Remove separator after last character */
        result_len -= sep_len;
    }
    /* Create new array for holding string contents */
    value.i32 = 0;
    get_string_array_type(module, &string_array_type);
    new_arr = wasm_array_obj_new_with_type(exec_env, string_array_type,
                                           result_len + 1 , &value);
    if (!new_arr) {
        wasm_runtime_set_exception(module_inst, "alloc memory failed");
        goto fail;
    }
    p = (char*)wasm_array_obj_first_elem_addr(new_arr);
    /* len = 1 add to '\0' */
    p_end = p + result_len + 1 ;
    bh_assert(p);
    bh_assert(p_end);

    for (i = 0; i < len; i++) {
        uint32 cur_string_len = string_lengths[i];
        bh_memcpy_s(p, p_end - p, string_addrs[i], cur_string_len);
        p += cur_string_len;;
        if (i < len - 1) {
            bh_memcpy_s(p, p_end - p, sep ? sep : ",", sep_len);
            p += sep_len;
        }
    }

    /* add '\0' as string end*/
    bh_memcpy_s(p, p_end - p, "\0", 1);
    bh_assert(p == p_end);

    value.gc_obj = (wasm_obj_t)new_arr;
    wasm_struct_obj_set_field(new_string_struct, 1, &value);
    wasm_runtime_pop_local_object_ref(exec_env);
    return new_string_struct;

fail:
    if (string_lengths) {
        wasm_runtime_free(string_lengths);
    }

    if (string_addrs) {
        wasm_runtime_free(string_addrs);
    }

    if (local_ref.val) {
        wasm_runtime_pop_local_object_ref(exec_env);
    }

    if (sep) {
        dyntype_free_cstring(dyntype_get_context(), sep);
    }
    return NULL;
}

/* construct new array struct with new array element, No change to the original array */
void *
array_concat_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                     void *value)
{
    uint32 len, value_len, new_length = 0;
    wasm_array_type_t arr_type = NULL;
    wasm_array_obj_t new_arr = NULL;
    wasm_struct_type_t struct_type = NULL;
    wasm_array_obj_t arr_ref = get_array_ref(obj);
    wasm_array_obj_t value_arr_ref = get_array_ref(value);
    wasm_struct_obj_t new_arr_struct = NULL;
    wasm_module_inst_t module_inst = wasm_runtime_get_module_inst(exec_env);
    wasm_value_t init = { .gc_obj = NULL }, tmp_val = { 0 };

    len = get_array_length(obj);
    value_len = get_array_length(value);

    struct_type =
        (wasm_struct_type_t)wasm_obj_get_defined_type((wasm_obj_t)obj);

    arr_type =
        (wasm_array_type_t)wasm_obj_get_defined_type((wasm_obj_t)arr_ref);

    if (len == 0 && value_len != 0) {
        new_arr = value_arr_ref;
        new_length = value_len;
    }
    else if (len != 0 && value_len == 0) {
        new_arr = arr_ref;
        new_length = len;
    } else {
        new_length = len + value_len;
        new_arr =
            wasm_array_obj_new_with_type(exec_env, arr_type, new_length, &init);
        if (!new_arr) {
            wasm_runtime_set_exception(module_inst, "alloc memory failed");
            return NULL;
        }
        wasm_array_obj_copy(new_arr, 0, arr_ref, 0, len);
        wasm_array_obj_copy(new_arr, len, value_arr_ref, 0, value_len);
    }
    /* wrap with struct */
    new_arr_struct = wasm_struct_obj_new_with_type(exec_env, struct_type);
    if (!new_arr_struct) {
        wasm_runtime_set_exception(module_inst, "alloc memory failed");
        return NULL;
    }
    /* use new_arr_struct warp new array, and no change orginal array_struct. */
    tmp_val.gc_obj = (wasm_obj_t)new_arr;
    wasm_struct_obj_set_field(new_arr_struct, 0, &tmp_val);
    tmp_val.u32 = new_length;
    wasm_struct_obj_set_field(new_arr_struct, 1, &tmp_val);
    return new_arr_struct;
}

void *
array_reverse_generic(wasm_exec_env_t exec_env, void *ctx, void *obj)
{
    uint32 i, len;
    wasm_value_t value1 = { 0 }, value2 = { 0 };
    wasm_array_obj_t arr_ref = get_array_ref(obj);
    len = get_array_length(obj);

    if (len == 0) {
        return obj;
    }
    /* The first and last elements of the array are replaced sequentially */
    for (i = 0; i < len / 2; i++) {
        wasm_array_obj_get_elem(arr_ref, i, false, &value1);
        wasm_array_obj_get_elem(arr_ref, len - 1 - i, false, &value2);
        wasm_array_obj_set_elem(arr_ref, i, &value2);
        wasm_array_obj_set_elem(arr_ref, len - 1 - i, &value1);
    }
    return obj;
}

/* Delete and return the first element of the array */
#define ARRAY_SHIFT_API(return_type, wasm_type, wasm_field)                    \
    return_type array_shift_##wasm_type(wasm_exec_env_t exec_env, void *ctx,   \
                                        void *obj)                             \
    {                                                                          \
        uint32 len;                                                            \
        return_type res;                                                       \
        wasm_array_type_t arr_type;                                            \
        wasm_array_obj_t new_arr;                                              \
        wasm_array_obj_t arr_ref = get_array_ref(obj);                         \
        wasm_module_inst_t module_inst =                                       \
            wasm_runtime_get_module_inst(exec_env);                            \
        wasm_value_t init = { .gc_obj = NULL }, tmp_val = { 0 },               \
                     value = { 0 };                                            \
                                                                               \
        len = get_array_length(obj);                                           \
        arr_type =                                                             \
            (wasm_array_type_t)wasm_obj_get_defined_type((wasm_obj_t)arr_ref); \
        if (len == 0) {                                                        \
            wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env), \
                                       "array is empty:undefined");            \
        }                                                                      \
        wasm_array_obj_get_elem(arr_ref, 0, false, &value);                    \
        res = value.wasm_field;                                                \
        new_arr =                                                              \
            wasm_array_obj_new_with_type(exec_env, arr_type, len - 1, &init);  \
        if (!new_arr) {                                                        \
            wasm_runtime_set_exception(module_inst, "alloc memory failed");    \
        }                                                                      \
        wasm_array_obj_copy(new_arr, 0, arr_ref, 1, len - 1);                  \
        tmp_val.gc_obj = (wasm_obj_t)new_arr;                                  \
        wasm_struct_obj_set_field(obj, 0, &tmp_val);                           \
        value.u32 = len - 1;                                                   \
        wasm_struct_obj_set_field(obj, 1, &value);                             \
        return res;                                                            \
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
    wasm_value_t init = { 0 }, tmp_val = { 0 };
    wasm_local_obj_ref_t local_ref;
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

    const JSValue *start_idx = wasm_anyref_obj_get_value(start_obj);
    const JSValue *end_idx = wasm_anyref_obj_get_value(end_obj);
    int iter = JS_VALUE_GET_INT(*start_idx);
    int end = JS_VALUE_GET_INT(*end_idx);
    iter = iter < 0 ? 0 : iter;
    end = end > len ? len : end;
    new_len = end - iter;
    new_arr = wasm_array_obj_new_with_type(exec_env, arr_type, new_len, &init);
    if (!new_arr) {
        wasm_runtime_set_exception((wasm_module_inst_t)module_inst,
                                   "alloc memory failed");
        return NULL;
    }

    wasm_runtime_push_local_object_ref(exec_env, &local_ref);
    local_ref.val = (wasm_obj_t)new_arr;

    for (int i = 0; iter != end; iter++, i++) {
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
    wasm_runtime_pop_local_object_ref(exec_env);
    return new_arr_struct;
}

void
quick_sort(wasm_exec_env_t exec_env, wasm_array_obj_t arr, int l, int r,
           wasm_func_obj_t closure_func, wasm_value_t context)
{

    if (l >= r)
        return;
    int i = l - 1, j = r + 1, pivot_idx = (l + r) >> 1;
    double cmp_res;
    wasm_value_t pivot_elem, elem, tmp_elem, left_elem, right_elem;

    wasm_array_obj_get_elem(arr, pivot_idx, false, &pivot_elem);
    uint32 argv[6], argc = 6;
    /* argc should be 6 means 3 args*/
    uint bsize = sizeof(argv); // actual byte size of argv
    while (i < j) {
        do {
            i++;
            /* arg0: context */
            b_memcpy_s(argv, bsize, &(context.gc_obj), sizeof(void *));
            /* arg1: pivot elem*/
            b_memcpy_s(argv + 2, bsize - 2 * sizeof(uint32), &pivot_elem.gc_obj,
                       sizeof(void *));
            /* arg2: elem*/
            wasm_array_obj_get_elem(arr, i, false, &elem);
            b_memcpy_s(argv + 4, bsize - 4 * sizeof(uint32), &elem.gc_obj,
                       sizeof(void *));
            wasm_runtime_call_func_ref(exec_env, closure_func, argc, argv);
            cmp_res = *(double *)argv;
        } while (cmp_res > 0.0);

        do {
            j--;
            /* arg0: context */
            b_memcpy_s(argv, bsize, &(context.gc_obj), sizeof(void *));
            /* arg1: pivot elem*/
            b_memcpy_s(argv + 2, bsize - 2 * sizeof(uint32), &pivot_elem.gc_obj,
                       sizeof(void *));
            /* arg2: elem*/
            wasm_array_obj_get_elem(arr, j, false, &elem);
            b_memcpy_s(argv + 4, bsize - 4 * sizeof(uint32), &elem.gc_obj,
                       sizeof(void *));
            wasm_runtime_call_func_ref(exec_env, closure_func, argc, argv);
            cmp_res = *(double *)argv;
        } while (cmp_res < 0.0);

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
    wasm_value_t context = { 0 }, func_obj = { 0 };
    wasm_array_obj_t arr_ref = get_array_ref(obj);
    len = get_array_length(obj);
    /* get closure context and func ref */
    wasm_struct_obj_get_field(closure, 0, false, &context);
    wasm_struct_obj_get_field(closure, 1, false, &func_obj);
    quick_sort(exec_env, arr_ref, 0, len - 1, (wasm_func_obj_t)func_obj.gc_obj,
               context);
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

/* Adds one or more elements to the beginning of the array and returns the new
 * length. */
double
array_unshift_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                      void *value)
{
    uint32 len, value_len, capacity, new_length = 0;
    wasm_array_type_t arr_type;
    wasm_array_obj_t new_arr;
    wasm_array_obj_t arr_ref = get_array_ref(obj);
    wasm_array_obj_t value_arr_ref = get_array_ref(value);
    wasm_module_inst_t module_inst = wasm_runtime_get_module_inst(exec_env);
    wasm_value_t init = { .gc_obj = NULL }, tmp_val = { 0 };

    len = get_array_length(obj);
    value_len = get_array_length(value);

    capacity = get_array_capacity(obj);

    arr_type =
        (wasm_array_type_t)wasm_obj_get_defined_type((wasm_obj_t)arr_ref);

    if (len == 0 && value_len != 0) {
        new_arr = value_arr_ref;
        new_length = value_len;
    }
    else if (len != 0 && value_len == 0) {
        new_arr = arr_ref;
        new_length = len;
    }
    else if (len + value_len >= capacity) {
        /* Current array space not enough, create new array */
        uint32 new_len = len + value_len + ARRAY_GROW_REDUNDANCE;
        new_arr =
            wasm_array_obj_new_with_type(exec_env, arr_type, new_len, &init);
        if (!new_arr) {
            wasm_runtime_set_exception(module_inst, "alloc memory failed");
            return -1;
        }
        wasm_array_obj_copy(new_arr, 0, value_arr_ref, 0, value_len);
        wasm_array_obj_copy(new_arr, value_len, arr_ref, 0, len);
        new_length = len + value_len;
    }
    else {
        wasm_array_obj_copy(arr_ref, value_len, arr_ref, 0, len);
        wasm_array_obj_copy(arr_ref, 0, value_arr_ref, 0, value_len);
        new_arr = arr_ref;
        new_length = len + value_len;
    }
    tmp_val.gc_obj = (wasm_obj_t)new_arr;
    wasm_struct_obj_set_field(obj, 0, &tmp_val);
    tmp_val.u32 = new_length;
    wasm_struct_obj_set_field(obj, 1, &tmp_val);
    return new_length;
}

/* set from_index_obj, reduce the number of comparisons, default index o start
 */
#define ARRAY_INDEXOF_API(elem_type, wasm_type, wasm_field)                   \
    double array_indexOf_##wasm_type(wasm_exec_env_t exec_env, void *ctx,     \
                                     void *obj, elem_type element,            \
                                     void *from_index_obj)                    \
    {                                                                         \
        int32 len, idx = 0;                                                   \
        uint32 i;                                                             \
        wasm_value_t tmp_val = { 0 };                                         \
        wasm_array_obj_t arr_ref = get_array_ref(obj);                        \
        len = get_array_length(obj);                                          \
        if (len == 0) {                                                       \
            return -1;                                                        \
        }                                                                     \
        if (from_index_obj) {                                                 \
            const JSValue *index = wasm_anyref_obj_get_value(from_index_obj); \
            idx = JS_VALUE_GET_INT(*index);                                   \
        }                                                                     \
        if (idx >= len) {                                                     \
            return -1;                                                        \
        }                                                                     \
        else if (idx < -len) {                                                \
            idx = 0;                                                          \
        }                                                                     \
        else {                                                                \
            idx = idx < 0 ? (idx + len) : idx;                                \
        }                                                                     \
        for (i = idx; i < len; i++) {                                         \
            wasm_array_obj_get_elem(arr_ref, i, false, &tmp_val);             \
            if (tmp_val.wasm_field == element) {                              \
                return i;                                                     \
            }                                                                 \
        }                                                                     \
        return -1;                                                            \
    }

ARRAY_INDEXOF_API(double, f64, f64)
ARRAY_INDEXOF_API(float, f32, f32)
ARRAY_INDEXOF_API(uint64, i64, i64)
ARRAY_INDEXOF_API(uint32, i32, i32)

double
array_indexOf_anyref(wasm_exec_env_t exec_env, void *ctx, void *obj,
                     void *element, void *from_index_obj)
{
    int32 len, idx = 0;
    uint32 i;
    wasm_value_t tmp_val = { 0 }, field1 = { 0 }, search_string = { 0 };
    wasm_array_obj_t arr_ref = get_array_ref(obj);
    wasm_module_inst_t module_inst = wasm_runtime_get_module_inst(exec_env);
    wasm_module_t module = wasm_runtime_get_module(module_inst);
    len = get_array_length(obj);
    if (len == 0)
        return -1;

    if (from_index_obj) {
        const JSValue *index = wasm_anyref_obj_get_value(from_index_obj);
        idx = JS_VALUE_GET_INT(*index);
    }

    if (idx >= len) {
        return -1;
    }
    else if (idx < -len) {
        idx = 0;
    }
    else {
        idx = idx < 0 ? (idx + len) : idx;
    }

    wasm_struct_obj_get_field(element, 1, false, &search_string);
    wasm_array_obj_t search_string_arr = (wasm_array_obj_t)search_string.gc_obj;
    /* get search_string array len and addr */
    uint32 search_string_len = wasm_array_obj_length(search_string_arr);
    void *search_string_ptr = wasm_array_obj_first_elem_addr(search_string_arr);
    /* loop through the array */
    for (i = idx; i < len; i++) {
        wasm_array_obj_get_elem(arr_ref, i, 0, &tmp_val);
        wasm_struct_obj_get_field((wasm_struct_obj_t)tmp_val.gc_obj, 1, false,
                                  &field1);
        if (array_element_is_string(module, (wasm_obj_t)tmp_val.gc_obj)) {
            wasm_array_obj_t arr2 = (wasm_array_obj_t)field1.gc_obj;
            uint32 array_element_len = wasm_array_obj_length(arr2);
            void *array_element_ptr = wasm_array_obj_first_elem_addr(arr2);

            if (search_string_len != array_element_len) {
                continue;
            }

            if (memcmp(search_string_ptr, array_element_ptr, array_element_len)
                    == 0
                && array_element_len == search_string_len) {
                return i;
            }
        }
        else {
            if (tmp_val.gc_obj == element)
                return i;
        }
    }
    return -1;
}

/* array_lastIndexOf */
#define ARRAY_LAST_INDEXOF_API(elem_type, wasm_type, wasm_field)              \
    double array_lastIndexOf_##wasm_type(wasm_exec_env_t exec_env, void *ctx, \
                                         void *obj, elem_type element,        \
                                         void *from_index_obj)                \
    {                                                                         \
        int32 len, idx = 0;                                                   \
        uint32 i;                                                             \
        wasm_value_t tmp_val = { 0 };                                         \
        wasm_array_obj_t arr_ref = get_array_ref(obj);                        \
        len = get_array_length(obj);                                          \
        if (len == 0) {                                                       \
            return -1;                                                        \
        }                                                                     \
        if (from_index_obj) {                                                 \
            const JSValue *index = wasm_anyref_obj_get_value(from_index_obj); \
            idx = JS_VALUE_GET_INT(*index);                                   \
        }                                                                     \
        if (idx < -len) {                                                     \
            return -1;                                                        \
        }                                                                     \
        else if (idx == 0) {                                                  \
            idx = len - 1;                                                    \
        }                                                                     \
        else {                                                                \
            idx = idx < 0 ? (idx + len) : (idx >= len ? (len - 1) : idx);     \
        }                                                                     \
        for (i = idx; i >= 0; i--) {                                          \
            wasm_array_obj_get_elem(arr_ref, i, false, &tmp_val);             \
            if (tmp_val.wasm_field == element) {                              \
                return i;                                                     \
            }                                                                 \
        }                                                                     \
        return -1;                                                            \
    }

ARRAY_LAST_INDEXOF_API(double, f64, f64)
ARRAY_LAST_INDEXOF_API(float, f32, f32)
ARRAY_LAST_INDEXOF_API(uint64, i64, i64)
ARRAY_LAST_INDEXOF_API(uint32, i32, i32)

double
array_lastIndexOf_anyref(wasm_exec_env_t exec_env, void *ctx, void *obj,
                         void *element, void *from_index_obj)
{
    int32 len, idx = 0;
    uint32 i;
    wasm_value_t tmp_val = { 0 }, field1 = { 0 }, search_string = { 0 };
    wasm_array_obj_t arr_ref = get_array_ref(obj);
    wasm_module_inst_t module_inst = wasm_runtime_get_module_inst(exec_env);
    wasm_module_t module = wasm_runtime_get_module(module_inst);
    len = get_array_length(obj);
    if (len == 0)
        return -1;

    if (from_index_obj) {
        const JSValue *index = wasm_anyref_obj_get_value(from_index_obj);
        idx = JS_VALUE_GET_INT(*index);
    }

    if (idx < -len) {
        return -1;
    }
    else if (idx == 0) {
        idx = len - 1;
    }
    else {
        idx = idx < 0 ? (idx + len) : (idx >= len ? (len - 1) : idx);
    }

    wasm_struct_obj_get_field(element, 1, false, &search_string);
    wasm_array_obj_t search_string_arr = (wasm_array_obj_t)search_string.gc_obj;
    /* get search_string array len and addr */
    uint32 search_string_len = wasm_array_obj_length(search_string_arr);
    void *search_string_ptr = wasm_array_obj_first_elem_addr(search_string_arr);

    /* loop through the array */
    for (i = idx; i >= 0; i--) {
        wasm_array_obj_get_elem(arr_ref, i, 0, &tmp_val);
        wasm_struct_obj_get_field((wasm_struct_obj_t)tmp_val.gc_obj, 1, false,
                                  &field1);
        if (array_element_is_string(module, (wasm_obj_t)tmp_val.gc_obj)) {
            wasm_array_obj_t arr2 = (wasm_array_obj_t)field1.gc_obj;
            uint32 array_element_len = wasm_array_obj_length(arr2);
            void *array_element_ptr = wasm_array_obj_first_elem_addr(arr2);

            if (search_string_len != array_element_len) {
                continue;
            }

            if (memcmp(search_string_ptr, array_element_ptr, array_element_len)
                    == 0
                && array_element_len == search_string_len) {
                return i;
            }
        }
        else {
            if (tmp_val.gc_obj == element)
                return i;
        }
    }
    return -1;
}

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
    uint32 i, len, elem_size;
    wasm_array_obj_t arr_ref = get_array_ref(obj);
    WASMValue element = { 0 };
    WASMValue context = { 0 }, func_obj = { 0 };

    len = get_array_length(obj);
    elem_size = get_array_element_size(arr_ref);

    /* get closure context and func ref */
    wasm_struct_obj_get_field(closure, 0, false, &context);
    wasm_struct_obj_get_field(closure, 1, false, &func_obj);

    /* invoke callback function */
    for (i = 0; i < len; i++) {
        uint32 argv[10];
        uint32 argc = 8;
        uint32 occupied_slots = 0;

        /* Must get arr ref again since it may be changed inside callback */
        arr_ref = get_array_ref(obj);
        wasm_array_obj_get_elem(arr_ref, i, false, &element);

        /* prepare args to callback */
        /* arg0: context */
        b_memcpy_s(argv, sizeof(argv), &context.gc_obj, sizeof(void *));
        occupied_slots += sizeof(void *) / sizeof(uint32);
        /* arg1: element */
        b_memcpy_s(argv + occupied_slots, sizeof(argv) - occupied_slots,
                   &element, elem_size);
        occupied_slots += elem_size / sizeof(uint32);
        /* arg2: index */
        *(double *)(argv + occupied_slots) = i;
        occupied_slots += sizeof(double) / sizeof(uint32);
        /* arg3: arr */
        b_memcpy_s(argv + occupied_slots, sizeof(argv) - occupied_slots, &obj,
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
    uint32 i, len, elem_size;
    uint32 res_arr_type_idx;
    wasm_array_obj_t new_arr;
    wasm_struct_obj_t new_arr_struct = NULL;
    wasm_array_obj_t arr_ref = get_array_ref(obj);
    wasm_module_inst_t module_inst = wasm_runtime_get_module_inst(exec_env);
    wasm_module_t module = wasm_runtime_get_module(module_inst);
    wasm_value_t init = { 0 }, tmp_val = { 0 };
    wasm_func_type_t cb_func_type;
    wasm_ref_type_t cb_ret_ref_type;
    wasm_local_obj_ref_t local_ref;
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
    wasm_runtime_push_local_object_ref(exec_env, &local_ref);
    local_ref.val = (wasm_obj_t)new_arr;

    /* get current array element type */
    elem_size = get_array_element_size(arr_ref);

    /* invoke callback function */
    for (i = 0; i < len; i++) {
        uint32 argv[10];
        uint32 argc = 8;
        uint32 occupied_slots = 0;

        /* Must get arr ref again since it may be changed inside callback */
        arr_ref = get_array_ref(obj);
        wasm_array_obj_get_elem(arr_ref, i, false, &element);

        /* prepare args to callback */
        /* arg0: context */
        b_memcpy_s(argv, sizeof(argv), &context.gc_obj, sizeof(void *));
        occupied_slots += sizeof(void *) / sizeof(uint32);
        /* arg1: element */
        b_memcpy_s(argv + occupied_slots, sizeof(argv) - occupied_slots,
                   &element, elem_size);
        occupied_slots += elem_size / sizeof(uint32);
        /* arg2: index */
        *(double *)(argv + occupied_slots) = i;
        occupied_slots += sizeof(double) / sizeof(uint32);
        /* arg3: arr */
        b_memcpy_s(argv + occupied_slots, sizeof(argv) - occupied_slots, &obj,
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
        goto end;
    }
    tmp_val.gc_obj = (wasm_obj_t)new_arr;
    wasm_struct_obj_set_field(new_arr_struct, 0, &tmp_val);
    tmp_val.u32 = len;
    wasm_struct_obj_set_field(new_arr_struct, 1, &tmp_val);

end:
    wasm_runtime_pop_local_object_ref(exec_env);
    return new_arr_struct;
}

void *
array_filter_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                     void *closure)
{
    uint32 i, len, elem_size, new_arr_len, include_idx = 0;
    wasm_struct_obj_t new_arr_struct = NULL;
    wasm_array_obj_t new_arr, arr_ref = get_array_ref(obj);
    wasm_struct_type_t struct_type;
    wasm_array_type_t arr_type;
    wasm_local_obj_ref_t local_ref;
    wasm_module_inst_t module_inst = wasm_runtime_get_module_inst(exec_env);
    wasm_value_t init = { 0 }, tmp_val = { 0 };
    wasm_obj_t *include_refs = NULL;
    wasm_value_t element = { 0 };
    wasm_value_t context = { 0 }, func_obj = { 0 };

    len = get_array_length(obj);

    struct_type =
        (wasm_struct_type_t)wasm_obj_get_defined_type((wasm_obj_t)obj);
    arr_type =
        (wasm_array_type_t)wasm_obj_get_defined_type((wasm_obj_t)arr_ref);

    elem_size = get_array_element_size(arr_ref);

    /* prepare a buffer to hold included reference */
    include_refs = wasm_runtime_malloc(sizeof(wasm_obj_t) * len);
    if (!include_refs) {
        wasm_runtime_set_exception(module_inst, "alloc memory failed");
        return NULL;
    }

    /* get closure context and func ref */
    wasm_struct_obj_get_field(closure, 0, false, &context);
    wasm_struct_obj_get_field(closure, 1, false, &func_obj);

    memset(include_refs, 0, sizeof(wasm_obj_t) * len);
    /* invoke callback function */
    for (i = 0; i < len; i++) {
        uint32 argv[10];
        uint32 argc = 8;
        uint32 occupied_slots = 0;

        /* Must get arr ref again since it may be changed inside callback */
        arr_ref = get_array_ref(obj);
        wasm_array_obj_get_elem(arr_ref, i, false, &element);

        /* prepare args to callback */
        /* arg0: context */
        b_memcpy_s(argv, sizeof(argv), &context.gc_obj, sizeof(void *));
        occupied_slots += sizeof(void *) / sizeof(uint32);
        /* arg1: element */
        b_memcpy_s(argv + occupied_slots, sizeof(argv) - occupied_slots,
                   &element, elem_size);
        occupied_slots += elem_size / sizeof(uint32);
        /* arg2: index */
        *(double *)(argv + occupied_slots) = i;
        occupied_slots += sizeof(double) / sizeof(uint32);
        /* arg3: arr */
        b_memcpy_s(argv + occupied_slots, sizeof(argv) - occupied_slots, &obj,
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
        goto end1;
    }
    wasm_runtime_push_local_object_ref(exec_env, &local_ref);
    local_ref.val = (wasm_obj_t)new_arr;

    for (i = 0; i < new_arr_len; i++) {
        wasm_value_t elem = { .gc_obj = include_refs[i] };
        wasm_array_obj_set_elem(new_arr, i, &elem);
    }

    /* wrap with struct */
    new_arr_struct = wasm_struct_obj_new_with_type(exec_env, struct_type);
    if (!new_arr_struct) {
        wasm_runtime_set_exception((wasm_module_inst_t)module_inst,
                                   "alloc memory failed");
        goto end2;
    }
    tmp_val.gc_obj = (wasm_obj_t)new_arr;
    wasm_struct_obj_set_field(new_arr_struct, 0, &tmp_val);
    tmp_val.u32 = new_arr_len;
    wasm_struct_obj_set_field(new_arr_struct, 1, &tmp_val);

end2:
    wasm_runtime_pop_local_object_ref(exec_env);

end1:
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

/* Find the first elements in an array that match the conditions.*/
void *
array_find_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                   void *closure)
{
    uint32 i, len, elem_size;
    wasm_value_t context = { 0 }, func_obj = { 0 }, element = { 0 }, field1 = { 0 };
    wasm_array_obj_t arr_ref = get_array_ref(obj);
    wasm_module_inst_t module_inst = wasm_runtime_get_module_inst(exec_env);
    wasm_module_t module = wasm_runtime_get_module(module_inst);
    wasm_array_type_t arr_type;
    void *ex_ptr;
   
    len = get_array_length(obj);
    arr_type =
        (wasm_array_type_t)wasm_obj_get_defined_type((wasm_obj_t)arr_ref);
    bool is_mut, mutable = true;
    wasm_ref_type_t arr_elem_ref_type =
        wasm_array_type_get_elem_type(arr_type, &is_mut);
    
    elem_size = get_array_element_size(arr_ref);
    /* get closure context and func ref */
    wasm_struct_obj_get_field(closure, 0, false, &context);
    wasm_struct_obj_get_field(closure, 1, false, &func_obj);

    /* invoke callback function */
    for (i = 0; i < len; i++) {
        uint32 argv[10];
        uint32 argc = 8;
        uint32 occupied_slots = 0;

        /* Must get arr ref again since it may be changed inside callback */
        arr_ref = get_array_ref(obj);
        wasm_array_obj_get_elem(arr_ref, i, false, &element);

        /* prepare args to callback */
        /* arg0: context */
        b_memcpy_s(argv, sizeof(argv), &context.gc_obj, sizeof(void *));
        occupied_slots += sizeof(void *) / sizeof(uint32);
        /* arg1: element */
        b_memcpy_s(argv + occupied_slots, sizeof(argv) - occupied_slots,
                   &element, elem_size);
        occupied_slots += elem_size / sizeof(uint32);
        /* arg2: index */
        *(double *)(argv + occupied_slots) = i;
        occupied_slots += sizeof(double) / sizeof(uint32);
        /* arg3: arr */
        b_memcpy_s(argv + occupied_slots, sizeof(argv) - occupied_slots, &obj,
                   sizeof(void *));

        wasm_runtime_call_func_ref(exec_env, (wasm_func_obj_t)func_obj.gc_obj,
                                   argc, argv);
        if (argv[0]) {
            if (arr_elem_ref_type.value_type == VALUE_TYPE_F64
                && is_mut == mutable) {
                return wasm_anyref_obj_new(
                    exec_env,
                    dyntype_new_number(dyntype_get_context(), element.f64));
            }
            else if (arr_elem_ref_type.value_type == VALUE_TYPE_I32
                     && is_mut == mutable) {
                return wasm_anyref_obj_new(
                    exec_env,
                    dyntype_new_boolean(dyntype_get_context(), element.i32));
            }
            else if (array_element_is_string(module, (wasm_obj_t)element.gc_obj)) {
                wasm_struct_obj_get_field((wasm_struct_obj_t)element.gc_obj, 1,
                                          false, &field1);
                wasm_array_obj_t a_ref = (wasm_array_obj_t)(field1.gc_obj);
                const char *str =
                    (const char *)wasm_array_obj_first_elem_addr(a_ref);
                return wasm_anyref_obj_new(
                    exec_env, dyntype_new_string(dyntype_get_context(), str));
            }
            else {
                ex_ptr = element.gc_obj;
                return wasm_anyref_obj_new(
                    exec_env,
                    dyntype_new_extref(dyntype_get_context(), ex_ptr, ExtObj));
            }
            break;
        }
    }
    return wasm_anyref_obj_new(exec_env,
                               dyntype_new_undefined(dyntype_get_context()));
}

double
array_findIndex_generic(wasm_exec_env_t exec_env, void *ctx, void *obj,
                        void *closure)
{
    uint32 i, len, elem_size;
    wasm_array_obj_t arr_ref = get_array_ref(obj);
    wasm_value_t element = { 0 };
    wasm_value_t context = { 0 }, func_obj = { 0 };

    len = get_array_length(obj);

    elem_size = get_array_element_size(arr_ref);

    /* get closure context and func ref */
    wasm_struct_obj_get_field(closure, 0, false, &context);
    wasm_struct_obj_get_field(closure, 1, false, &func_obj);

    /* invoke callback function */
    for (i = 0; i < len; i++) {
        uint32 argv[10];
        uint32 argc = 8;
        uint32 occupied_slots = 0;

        /* Must get arr ref again since it may be changed inside callback */
        arr_ref = get_array_ref(obj);
        wasm_array_obj_get_elem(arr_ref, i, false, &element);

        /* prepare args to callback */
        /* arg0: context */
        b_memcpy_s(argv, sizeof(argv), &context.gc_obj, sizeof(void *));
        occupied_slots += sizeof(void *) / sizeof(uint32);
        /* arg1: element */
        b_memcpy_s(argv + occupied_slots, sizeof(argv) - occupied_slots,
                   &element, elem_size);
        occupied_slots += elem_size / sizeof(uint32);
        /* arg2: index */
        *(double *)(argv + occupied_slots) = i;
        occupied_slots += sizeof(double) / sizeof(uint32);
        /* arg3: arr */
        b_memcpy_s(argv + occupied_slots, sizeof(argv) - occupied_slots, &obj,
                   sizeof(void *));

        wasm_runtime_call_func_ref(exec_env, (wasm_func_obj_t)func_obj.gc_obj,
                                   argc, argv);
        if (argv[0]) {
            return i;
        }
    }

    return -1;
}

#define ARRAY_FILL_API(elem_type, wasm_type, wasm_field)                       \
    void *array_fill_##wasm_type(wasm_exec_env_t exec_env, void *ctx,          \
                                 void *obj, elem_type fill_value,              \
                                 void *start_obj, void *end_obj)               \
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
        const JSValue *start_idx = wasm_anyref_obj_get_value(start_obj);       \
        const JSValue *end_idx = wasm_anyref_obj_get_value(end_obj);           \
        int iter = JS_VALUE_GET_INT(*start_idx),                               \
            end = JS_VALUE_GET_INT(*end_idx);                                  \
        iter = iter < 0 ? 0 : iter;                                            \
        end = end > len ? len : end;                                           \
        for (; iter != end; iter++) {                                          \
            wasm_array_obj_set_elem(arr_ref, iter, &value);                    \
        }                                                                      \
        return obj;                                                            \
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
    REG_NATIVE_FUNC(array_join_f64, "(rrr)r"),
    REG_NATIVE_FUNC(array_join_f32, "(rrr)r"),
    REG_NATIVE_FUNC(array_join_i64, "(rrr)r"),
    REG_NATIVE_FUNC(array_join_i32, "(rrr)r"),
    REG_NATIVE_FUNC(array_join_anyref, "(rrr)r"),
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
    REG_NATIVE_FUNC(array_find_generic, "(rrr)r"),
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

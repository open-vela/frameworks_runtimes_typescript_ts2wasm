/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

#include "gc_export.h"
#include "bh_platform.h"
#include "wasm.h"
#include "type_utils.h"

/*
    utilities for array object

    * array struct (WasmGC struct)
    +----------+      +---------------------------+
    |  0:data  |----->|  content (WasmGC array)   |
    +----------+      +---------------------------+
    |  1:size  |      ^                           ^
    +----------+      |<-------  capacity  ------>|
*/
int
get_array_length(wasm_struct_obj_t obj)
{
    wasm_value_t wasm_array_len = { 0 };
    bh_assert(wasm_obj_is_struct_obj((wasm_obj_t)obj));

    wasm_struct_obj_get_field(obj, 1, false, &wasm_array_len);
    return wasm_array_len.i32;
}

wasm_array_obj_t
get_array_ref(wasm_struct_obj_t obj)
{
    wasm_value_t wasm_array = { 0 };
    bh_assert(wasm_obj_is_struct_obj((wasm_obj_t)obj));

    wasm_struct_obj_get_field(obj, 0, false, &wasm_array);
    return (wasm_array_obj_t)wasm_array.gc_obj;
}

int
get_array_capacity(wasm_struct_obj_t obj)
{
    wasm_array_obj_t array_ref = get_array_ref(obj);

    return wasm_array_obj_length(array_ref);
}

uint32_t
get_array_element_size(wasm_array_obj_t obj)
{
    wasm_array_type_t arr_type =
        (wasm_array_type_t)wasm_obj_get_defined_type((wasm_obj_t)obj);
    return wasm_value_type_size(arr_type->elem_type);
}

int32_t
get_array_type_by_element(wasm_module_t wasm_module,
                          wasm_ref_type_t *element_ref_type, bool is_mutable,
                          wasm_array_type_t *p_array_type)
{
    uint32 i, type_count;

    type_count = wasm_get_defined_type_count(wasm_module);
    for (i = 0; i < type_count; i++) {
        wasm_defined_type_t type = wasm_get_defined_type(wasm_module, i);
        if (wasm_defined_type_is_array_type(type)) {
            bool mutable;
            wasm_ref_type_t arr_elem_ref_type = wasm_array_type_get_elem_type(
                (wasm_array_type_t)type, &mutable);
            if (wasm_ref_type_equal(&arr_elem_ref_type, element_ref_type,
                                    wasm_module)
                && (mutable == is_mutable)) {
                if (p_array_type) {
                    *p_array_type = (wasm_array_type_t)type;
                }
                return i;
            }
        }
    }

    if (p_array_type) {
        *p_array_type = NULL;
    }
    return -1;
}

int32_t
get_array_struct_type(wasm_module_t wasm_module, int32_t array_type_idx,
                      wasm_struct_type_t *p_struct_type)
{
    uint32 i, type_count;
    wasm_ref_type_t res_arr_ref_type;

    wasm_ref_type_set_type_idx(&res_arr_ref_type, true, array_type_idx);

    type_count = wasm_get_defined_type_count(wasm_module);
    for (i = 0; i < type_count; i++) {
        wasm_defined_type_t type = wasm_get_defined_type(wasm_module, i);
        if (wasm_defined_type_is_struct_type(type)
            && (wasm_struct_type_get_field_count((wasm_struct_type_t)type)
                == 2)) {
            bool field1_mutable, field2_mutable;
            wasm_ref_type_t first_field_type = wasm_struct_type_get_field_type(
                (wasm_struct_type_t)type, 0, &field1_mutable);
            wasm_ref_type_t second_field_type = wasm_struct_type_get_field_type(
                (wasm_struct_type_t)type, 1, &field2_mutable);
            if (wasm_ref_type_equal(&first_field_type, &res_arr_ref_type,
                                    wasm_module)
                && second_field_type.value_type == VALUE_TYPE_I32) {
                if (p_struct_type) {
                    *p_struct_type = (wasm_struct_type_t)type;
                }
                return i;
            }
        }
    }

    if (p_struct_type) {
        *p_struct_type = NULL;
    }
    return -1;
}

/*
    utilities for string type

    * string struct (WasmGC struct)
    +----------+
    |  0:flag  |
    +----------+      +---------------------------+
    |  1:data  |----->| content (WasmGC array) |\0|
    +----------+      +---------------------------+
                      ^                        ^
                      |<------  length  ------>|
*/
static bool
is_i8_array(wasm_module_t wasm_module, bool is_mutable,
            wasm_ref_type_t ref_type)
{
    if (ref_type.heap_type >= 0) {
        uint32 type_idx = ref_type.heap_type;
        wasm_defined_type_t type = wasm_get_defined_type(wasm_module, type_idx);

        if (wasm_defined_type_is_array_type(type)) {
            bool mut;
            wasm_ref_type_t ref_element =
                wasm_array_type_get_elem_type((wasm_array_type_t)type, &mut);
            if (ref_element.value_type == VALUE_TYPE_I8 && mut == is_mutable) {
                return true;
            }
        }
    }

    return false;
}

int32_t
get_string_array_type(wasm_module_t wasm_module,
                      wasm_array_type_t *p_array_type_t)
{
    uint32 i, type_count;
    bool is_mutable = true;

    type_count = wasm_get_defined_type_count(wasm_module);
    for (i = 0; i < type_count; i++) {
        wasm_defined_type_t type = wasm_get_defined_type(wasm_module, i);

        if (wasm_defined_type_is_array_type(type)) {
            bool mutable;
            wasm_ref_type_t arr_elem_ref_type = wasm_array_type_get_elem_type(
                (wasm_array_type_t)type, &mutable);

            if (arr_elem_ref_type.value_type == VALUE_TYPE_I8
                && mutable == is_mutable) {
                if (p_array_type_t) {
                    *p_array_type_t = (wasm_array_type_t)type;
                }
                return i;
            }
        }
    }

    if (p_array_type_t) {
        *p_array_type_t = NULL;
    }

    return -1;
}

int32_t
get_string_struct_type(wasm_module_t wasm_module,
                       wasm_struct_type_t *p_struct_type)
{
    uint32 i, type_count;
    wasm_defined_type_t type;

    type_count = wasm_get_defined_type_count(wasm_module);
    for (i = 0; i < type_count; i++) {
        type = wasm_get_defined_type(wasm_module, i);
        if (!is_ts_string_type(wasm_module, type)) {
            continue;
        }
        if (p_struct_type) {
            *p_struct_type = (wasm_struct_type_t)type;
        }
        return i;
    }
    if (p_struct_type) {
        *p_struct_type = NULL;
    }
    return -1;
}

bool
is_ts_string_type(wasm_module_t wasm_module, wasm_defined_type_t type)
{
    bool is_struct_type;
    wasm_struct_type_t struct_type;
    uint32 field_count;
    bool mut;
    wasm_ref_type_t field_type;

    is_struct_type = wasm_defined_type_is_struct_type(type);
    if (!is_struct_type) {
        return false;
    }

    struct_type = (wasm_struct_type_t)type;
    field_count = wasm_struct_type_get_field_count(struct_type);

    if (field_count != 2) {
        return false;
    }
    field_type = wasm_struct_type_get_field_type(struct_type, 0, &mut);
    if (field_type.value_type != VALUE_TYPE_I32 || !mut) {
        return false;
    }
    field_type = wasm_struct_type_get_field_type(struct_type, 1, &mut);
    if (!mut || !is_i8_array(wasm_module, true, field_type)) {
        return false;
    }

    return true;
}

wasm_struct_obj_t create_wasm_string(wasm_exec_env_t exec_env, const char *value)
{
    wasm_struct_type_t string_struct_type = NULL;
    wasm_array_type_t string_array_type = NULL;
    wasm_local_obj_ref_t local_ref = { 0 };
    wasm_value_t val = { 0 };
    wasm_struct_obj_t new_string_struct = NULL;
    wasm_array_obj_t new_arr;
    int len = 0;
    char *p, *p_end;
    wasm_module_inst_t module_inst = wasm_runtime_get_module_inst(exec_env);
    wasm_module_t module = wasm_runtime_get_module(module_inst);

    /* get string len */
    len = strlen(value);

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
        return NULL;
    }

    /* Push object to local ref to avoid being freed at next allocation */
    wasm_runtime_push_local_object_ref(exec_env, &local_ref);
    local_ref.val = (wasm_obj_t)new_string_struct;

    val.i32 = 0;
    get_string_array_type(module, &string_array_type);
    new_arr = wasm_array_obj_new_with_type(exec_env, string_array_type, len,
                                           &val);
    if (!new_arr) {
        wasm_runtime_pop_local_object_ref(exec_env);
        wasm_runtime_set_exception(module_inst, "alloc memory failed");
        return NULL;
    }

    p = (char *)wasm_array_obj_first_elem_addr(new_arr);
    p_end = p + len;
    bh_assert(p);
    bh_assert(p_end);

    bh_memcpy_s(p, len, value, len);
    p += len;
    bh_assert(p == p_end);

    val.gc_obj = (wasm_obj_t)new_arr;
    wasm_struct_obj_set_field(new_string_struct, 1, &val);

    wasm_runtime_pop_local_object_ref(exec_env);

    (void)p_end;
    return new_string_struct;
}

bool
is_infc(wasm_obj_t obj) {
    wasm_struct_type_t struct_type;

    if (!obj || !wasm_obj_is_struct_obj(obj)) {
        return false;
    }
    struct_type = (wasm_struct_type_t)wasm_obj_get_defined_type(obj);

    uint32_t fields_count;
    bool mut;
    wasm_ref_type_t field_type;

    fields_count = wasm_struct_type_get_field_count(struct_type);
    if (fields_count != 3) {
        return false;
    }
    field_type = wasm_struct_type_get_field_type(struct_type, 0, &mut);
    if (field_type.value_type != VALUE_TYPE_I32 || mut) {
        return false;
    }
    field_type = wasm_struct_type_get_field_type(struct_type, 1, &mut);
    if (field_type.value_type != VALUE_TYPE_I32 || mut) {
        return false;
    }
    field_type = wasm_struct_type_get_field_type(struct_type, 2, &mut);
    if (field_type.value_type != VALUE_TYPE_ANYREF || !mut) {
        return false;
    }

    return true;
}

void *
get_infc_obj(wasm_exec_env_t exec_env, wasm_obj_t obj) {
    wasm_value_t res = { 0 };
    wasm_struct_obj_t struct_obj;

    if (!is_infc(obj)) {
        return NULL;
    }
    struct_obj = (wasm_struct_obj_t)obj;
    wasm_struct_obj_get_field(struct_obj, 2, false, &res);

    return res.gc_obj;
}
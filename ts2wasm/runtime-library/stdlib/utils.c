/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

#include "gc_export.h"
#include "bh_platform.h"
#include "wasm.h"

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

bool
is_i8_array(wasm_module_t wasm_module, bool is_mutable,
            wasm_ref_type_t ref_type)
{
    if (ref_type.value_type == VALUE_TYPE_ARRAYREF)
        return true;
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
            if (arr_elem_ref_type.value_type == VALUE_TYPE_I8 && mutable == is_mutable) {
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
    type_count = wasm_get_defined_type_count(wasm_module);
    for (i = 0; i < type_count; i++) {
        wasm_defined_type_t type = wasm_get_defined_type(wasm_module, i);
        if (wasm_defined_type_is_struct_type(type)
            && wasm_struct_type_get_field_count((wasm_struct_type_t)type)
                   == 2) {
            bool mutable = false;
            wasm_ref_type_t first_field_type = wasm_struct_type_get_field_type(
                (wasm_struct_type_t)type, 0, &mutable);
            wasm_ref_type_t second_field_type = wasm_struct_type_get_field_type(
                (wasm_struct_type_t)type, 1, &mutable);
            if (first_field_type.value_type == VALUE_TYPE_I32
                && is_i8_array(wasm_module, true, second_field_type)) {
                if (p_struct_type) {
                    *p_struct_type = (wasm_struct_type_t)type;
                }
                return i;
            };
        }
    }
    if (p_struct_type) {
        *p_struct_type = NULL;
    }
    return -1;
}

bool
array_element_is_string(wasm_module_t wasm_module, wasm_obj_t elem)
{
    wasm_struct_type_t struct_type;
    uint32 field_count = 0;
    wasm_value_t field1 = { 0 };
    bool is_struct = wasm_obj_is_struct_obj(elem);

    if (is_struct) {
        struct_type =
            (wasm_struct_type_t)wasm_obj_get_defined_type((wasm_obj_t)elem);
        field_count = wasm_struct_type_get_field_count(struct_type);
        if (field_count != 2) {
            return false;
        }
        bool mutable = false;
        wasm_ref_type_t first_field_type =
            wasm_struct_type_get_field_type(struct_type, 0, &mutable);
        wasm_ref_type_t second_field_type =
            wasm_struct_type_get_field_type(struct_type, 1, &mutable);
        wasm_struct_obj_get_field((wasm_struct_obj_t)elem, 1, false, &field1);

        if (field1.gc_obj != NULL
            && first_field_type.value_type == VALUE_TYPE_I32
            && is_i8_array(wasm_module, true, second_field_type)) {
            return true;
        }
    }
    return false;
}

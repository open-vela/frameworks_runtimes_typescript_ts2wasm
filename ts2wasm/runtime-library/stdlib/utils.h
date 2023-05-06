/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

#include "gc_export.h"

/* Helper to get common used fields */
int
get_array_length(wasm_struct_obj_t obj);

wasm_array_obj_t
get_array_ref(wasm_struct_obj_t obj);

int
get_array_capacity(wasm_struct_obj_t obj);

/* Type reflection */
int32_t
get_array_type_by_element(wasm_module_t wasm_module,
                          wasm_ref_type_t *element_ref_type, bool is_mutable,
                          wasm_array_type_t *p_array_type);

int32_t
get_array_struct_type(wasm_module_t wasm_module, int32_t array_type_idx,
                      wasm_struct_type_t *p_struct_type);

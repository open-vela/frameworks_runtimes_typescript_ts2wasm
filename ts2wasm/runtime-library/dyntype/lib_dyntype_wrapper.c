/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

#include "dyntype.h"
#include "gc_export.h"
#include "bh_platform.h"
#include "type_utils.h"
#include "wamr_utils.h"

/* Convert host pointer to anyref */
#define BOX_ANYREF(ptr)                            \
    do {                                           \
        return wasm_anyref_obj_new(exec_env, ptr); \
    } while (0)

/* Convert anyref to host pointer */
#define UNBOX_ANYREF(anyref) \
    (dyn_value_t) wasm_anyref_obj_get_value((wasm_anyref_obj_t)anyref)

/******************* Initialization and destroy *******************/
void *
dyntype_context_init_wrapper(wasm_exec_env_t exec_env)
{
    BOX_ANYREF(dyntype_context_init());
}

void *
dyntype_context_init_with_opt_wrapper(wasm_exec_env_t exec_env,
                                      dyn_options_t *options)
{
    BOX_ANYREF(dyntype_context_init_with_opt(options));
}

void
dyntype_context_destroy_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx)
{
    return dyntype_context_destroy(UNBOX_ANYREF(ctx));
}

/******************* Field access *******************/
dyn_value_t
dyntype_new_number_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                           double value)
{
    BOX_ANYREF(dyntype_new_number(UNBOX_ANYREF(ctx), value));
}

dyn_value_t
dyntype_new_boolean_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx, bool value)
{
    BOX_ANYREF(dyntype_new_boolean(UNBOX_ANYREF(ctx), value));
}

dyn_value_t
dyntype_new_string_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                           wasm_struct_obj_t str_obj)
{
    WASMValue arr_obj = { 0 };
    uint32_t arr_len = 0;
    const char *str = "";
    wasm_struct_obj_get_field(str_obj, 1, false, &arr_obj);
    arr_len = wasm_array_obj_length((wasm_array_obj_t)arr_obj.gc_obj);

    if (arr_len != 0) {
        str = (char *)wasm_array_obj_first_elem_addr(
            (wasm_array_obj_t)arr_obj.gc_obj);
    }

    BOX_ANYREF(dyntype_new_string_with_length(UNBOX_ANYREF(ctx), str, arr_len));
}

dyn_value_t
dyntype_new_undefined_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx)
{
    BOX_ANYREF(dyntype_new_undefined(UNBOX_ANYREF(ctx)));
}

dyn_value_t
dyntype_new_null_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx)
{
    BOX_ANYREF(dyntype_new_null(UNBOX_ANYREF(ctx)));
}

dyn_value_t
dyntype_new_object_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx)
{
    BOX_ANYREF(dyntype_new_object(UNBOX_ANYREF(ctx)));
}

dyn_value_t
dyntype_new_array_with_length_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                                      int len)
{
    BOX_ANYREF(dyntype_new_array_with_length(UNBOX_ANYREF(ctx), len));
}

dyn_value_t
dyntype_new_array_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx)
{
    BOX_ANYREF(dyntype_new_array(UNBOX_ANYREF(ctx)));
}

void
dyntype_add_elem_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                         dyn_value_t obj, dyn_value_t elem)
{
}

void
dyntype_set_elem_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                         dyn_value_t obj, int index, dyn_value_t elem)
{
    return dyntype_set_elem(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj), index,
                            UNBOX_ANYREF(elem));
}

dyn_value_t
dyntype_get_elem_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                         dyn_value_t obj, int index)
{
    BOX_ANYREF(dyntype_get_elem(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj), index));
}

dyn_value_t
dyntype_new_extref_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx, void *ptr,
                           external_ref_tag tag)
{
    BOX_ANYREF(dyntype_new_extref(UNBOX_ANYREF(ctx), ptr, tag));
}

int
dyntype_set_property_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                             dyn_value_t obj, const char *prop,
                             dyn_value_t value)
{
    return dyntype_set_property(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj), prop,
                                UNBOX_ANYREF(value));
}

int
dyntype_define_property_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                                dyn_value_t obj, const char *prop,
                                dyn_value_t desc)
{
    return dyntype_define_property(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj), prop,
                                   UNBOX_ANYREF(desc));
}

dyn_value_t
dyntype_get_property_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                             dyn_value_t obj, const char *prop)
{
    BOX_ANYREF(
        dyntype_get_property(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj), prop));
}

int
dyntype_has_property_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                             dyn_value_t obj, const char *prop)
{
    return dyntype_has_property(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj), prop);
}

int
dyntype_delete_property_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                                dyn_value_t obj, const char *prop)
{
    return dyntype_delete_property(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj), prop);
}

/******************* Runtime type checking *******************/
int
dyntype_is_undefined_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                             dyn_value_t obj)
{
    return dyntype_is_undefined(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj));
}

int
dyntype_is_null_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                        dyn_value_t obj)
{
    return dyntype_is_null(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj));
}

int
dyntype_is_bool_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                        dyn_value_t obj)
{
    return dyntype_is_bool(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj));
}

int
dyntype_to_bool_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                        dyn_value_t bool_obj)
{
    bool value = 0, ret;

    ret = dyntype_to_bool(UNBOX_ANYREF(ctx), UNBOX_ANYREF(bool_obj), &value);
    if (ret != DYNTYPE_SUCCESS) {
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                                   "libdyntype: failed to convert to bool");
    }

    return value;
}

int
dyntype_is_number_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                          dyn_value_t obj)
{
    return dyntype_is_number(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj));
}

double
dyntype_to_number_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                          dyn_value_t obj)
{
    double value = 0;
    bool ret;

    ret = dyntype_to_number(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj), &value);
    if (ret != DYNTYPE_SUCCESS) {
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                                   "libdyntype: failed to convert to number");
    }

    return value;
}

int
dyntype_is_string_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                          dyn_value_t obj)
{
    return dyntype_is_string(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj));
}

char *
dyntype_to_cstring_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                           dyn_value_t str_obj)
{
    wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                               "libdyntype: string not supported");

    return NULL;
}

void *
dyntype_to_string_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                          dyn_value_t str_obj)
{
    char *value = NULL;
    int ret;
    wasm_struct_obj_t new_string_struct = NULL;

    ret = dyntype_to_cstring(UNBOX_ANYREF(ctx), UNBOX_ANYREF(str_obj), &value);
    if (ret != DYNTYPE_SUCCESS) {
        if (value) {
            dyntype_free_cstring(dyntype_get_context(), value);
        }
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                                   "libdyntype: failed to convert to cstring");
    }

    new_string_struct = create_wasm_string(exec_env, value);

    return (void *)new_string_struct;
}

void
dyntype_free_cstring_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx, char *str)
{
    return dyntype_free_cstring(UNBOX_ANYREF(ctx), str);
}

int
dyntype_is_object_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                          dyn_value_t obj)
{
    return dyntype_is_object(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj));
}

int
dyntype_is_array_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                         dyn_value_t obj)
{
    return dyntype_is_array(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj));
}

int
dyntype_is_extref_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                          dyn_value_t obj)
{
    return dyntype_is_extref(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj));
}

void *
dyntype_to_extref_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                          dyn_value_t obj)
{
    void *value = NULL;
    int ret;

    ret = dyntype_to_extref(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj), &value);
    if (ret < ExtObj || ret > ExtArray) {
        wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                                   "libdyntype: failed to convert to extref");
    }

    return value;
}

int
dyntype_is_falsy_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                         dyn_value_t value)
{
    return dyntype_is_falsy(UNBOX_ANYREF(ctx), UNBOX_ANYREF(value));
}

/******************* Type equivalence *******************/
/* for typeof keyword*/
void *
dyntype_typeof_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx, dyn_value_t obj)
{
    dyn_type_t dyn_type;
    char* value;
    wasm_struct_obj_t res;

    dyn_type = dyntype_typeof(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj));
    switch (dyn_type) {
        case DynUndefined:
            value = "undefined";
            break;
        case DynBoolean:
            value = "boolean";
            break;
        case DynNumber:
            value = "number";
            break;
        case DynString:
            value = "string";
            break;
        case DynFunction:
        case DynExtRefFunc:
            value = "function";
            break;
        case DynNull:
        case DynObject:
        case DynExtRefObj:
        case DynExtRefInfc:
        case DynExtRefArray:
            value = "object";
            break;
        default:
            wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                                    "libdyntype: typeof getting unknown type");
            value = "unknown";
    }
    res = create_wasm_string(exec_env, value);

    return (void*)res;
}

/* for internal use, no need to create a wasm string*/
dyn_type_t
dyntype_typeof1_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx, dyn_value_t obj)
{
    return dyntype_typeof(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj));
}

int
dyntype_type_eq_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                        dyn_value_t lhs, dyn_value_t rhs)
{
    return dyntype_type_eq(UNBOX_ANYREF(ctx), UNBOX_ANYREF(lhs),
                           UNBOX_ANYREF(rhs));
}

int dyntype_cmp_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx, dyn_value_t lhs,
                        dyn_value_t rhs, cmp_operator operator_kind)
{
    int res = 0;
    dyn_type_t type_l, type_r;
    bool l_is_null = false, r_is_null = false;
    void *lhs_ref, *rhs_ref;
    int32_t lhs_idx, rhs_idx;

    type_l = dyntype_typeof(UNBOX_ANYREF(ctx), UNBOX_ANYREF(lhs));
    type_r = dyntype_typeof(UNBOX_ANYREF(ctx), UNBOX_ANYREF(rhs));

    if (type_l == type_r) {
        res = dyntype_cmp(UNBOX_ANYREF(ctx), UNBOX_ANYREF(lhs), UNBOX_ANYREF(rhs),
                        operator_kind);
    }
    if (res) {
        return res;
    }
    if (dyntype_is_null(UNBOX_ANYREF(ctx), UNBOX_ANYREF(lhs))) {
        l_is_null = true;
    }
    if (dyntype_is_null(UNBOX_ANYREF(ctx), UNBOX_ANYREF(rhs))) {
        r_is_null = true;
    }
    // iff undefined
    if (type_l != type_r && (type_l == DynUndefined || type_r == DynUndefined)) {
        if (operator_kind == ExclamationEqualsToken
            || operator_kind == ExclamationEqualsEqualsToken) {
            res = !res;
        }
        return res;
    }
    // iff null
    if ((!l_is_null && (type_l < DynExtRefObj || type_l > DynExtRefArray))
        || (!r_is_null && (type_r < DynExtRefObj || type_r > DynExtRefArray))) {
        if (type_l != type_r && (operator_kind == ExclamationEqualsToken
            || operator_kind == ExclamationEqualsEqualsToken)) {
            res = !res;
        }
        return res;
    }

    if (!l_is_null) {
        dyntype_to_extref(UNBOX_ANYREF(ctx), UNBOX_ANYREF(lhs), &lhs_ref);
        lhs_idx = (int32_t)(intptr_t)lhs_ref;
        lhs_ref = wamr_utils_get_table_element(exec_env, lhs_idx);
        if (is_infc(lhs_ref)) {
            lhs_ref = get_infc_obj(exec_env, lhs_ref);
        }
    } else {
        lhs_ref = NULL;
    }
    if (!r_is_null) {
        dyntype_to_extref(UNBOX_ANYREF(ctx), UNBOX_ANYREF(rhs), &rhs_ref);
        rhs_idx = (int32_t)(intptr_t)rhs_ref;
        rhs_ref = wamr_utils_get_table_element(exec_env, rhs_idx);
        if (is_infc(rhs_ref)) {
            rhs_ref = get_infc_obj(exec_env, rhs_ref);
        }
    } else {
        rhs_ref = NULL;
    }
    res = lhs_ref == rhs_ref;

    if (operator_kind == ExclamationEqualsToken || operator_kind == ExclamationEqualsEqualsToken) {
        res = !res;
    }

    return res;
}

/******************* Subtyping *******************/
dyn_value_t
dyntype_new_object_with_proto_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                                      const dyn_value_t proto_obj)
{
    BOX_ANYREF(dyntype_new_object_with_proto(UNBOX_ANYREF(ctx),
                                             UNBOX_ANYREF(proto_obj)));
}

int
dyntype_set_prototype_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                              dyn_value_t obj, const dyn_value_t proto_obj)
{
    return dyntype_set_prototype(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj),
                                 UNBOX_ANYREF(proto_obj));
}

const dyn_value_t
dyntype_get_prototype_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                              dyn_value_t obj)
{
    BOX_ANYREF(dyntype_get_prototype(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj)));
}

dyn_value_t
dyntype_get_own_property_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                                 dyn_value_t obj, const char *prop)
{
    BOX_ANYREF(
        dyntype_get_own_property(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj), prop));
}

int
dyntype_instanceof_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                           const dyn_value_t src_obj, const dyn_value_t dst_obj)
{
    return dyntype_instanceof(UNBOX_ANYREF(ctx), UNBOX_ANYREF(src_obj),
                              UNBOX_ANYREF(dst_obj));
}

/******************* Dumping *******************/
void
dyntype_dump_value_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                           dyn_value_t obj)
{
    return dyntype_dump_value(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj));
}

int
dyntype_dump_value_buffer_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                                  dyn_value_t obj, void *buffer, int len)
{
    return dyntype_dump_value_buffer(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj),
                                     buffer, len);
}

/******************* Garbage collection *******************/

void
dyntype_hold_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx, dyn_value_t obj)
{
    return dyntype_hold(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj));
}

void
dyntype_release_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                        dyn_value_t obj)
{
    return dyntype_release(UNBOX_ANYREF(ctx), UNBOX_ANYREF(obj));
}

void
dyntype_collect_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx)
{
    return dyntype_collect(UNBOX_ANYREF(ctx));
}

wasm_anyref_obj_t
dyntype_invoke_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                       const char *name, wasm_anyref_obj_t this_obj,
                       wasm_struct_obj_t args_array)
{
    dyn_value_t this_val = (dyn_value_t)wasm_anyref_obj_get_value(this_obj);
    dyn_value_t *argv = NULL;
    dyn_value_t ret = NULL;
    wasm_array_obj_t arr_ref = get_array_ref(args_array);
    wasm_value_t tmp;
    int argc = get_array_length(args_array);

    if (argc) {
        argv = wasm_runtime_malloc(sizeof(dyn_value_t) * argc);
        if (!argv) {
            wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                                       "alloc memory failed");
            return NULL;
        }
    }

    for (int i = 0; i < argc; i++) {
        wasm_array_obj_get_elem(arr_ref, i, false, &tmp);
        argv[i] = (dyn_value_t)UNBOX_ANYREF(tmp.gc_obj);
    }

    ret = dyntype_invoke(UNBOX_ANYREF(ctx), name, this_val, argc, argv);
    if (argv) {
        wasm_runtime_free(argv);
    }

    BOX_ANYREF(ret);
}

wasm_anyref_obj_t
dyntype_get_global_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                           const char *name)
{
    BOX_ANYREF(dyntype_get_global(UNBOX_ANYREF(ctx), name));
}

wasm_anyref_obj_t
dyntype_new_object_with_class_wrapper(wasm_exec_env_t exec_env, dyn_ctx_t ctx,
                                      const char *name,
                                      wasm_struct_obj_t args_array)
{
    wasm_array_obj_t arr_ref = get_array_ref(args_array);
    dyn_value_t ret = NULL;
    dyn_value_t *argv = NULL;
    wasm_value_t tmp;
    int argc = get_array_length(args_array);

    if (argc) {
        argv = wasm_runtime_malloc(sizeof(dyn_value_t) * argc);
        if (!argv) {
            wasm_runtime_set_exception(wasm_runtime_get_module_inst(exec_env),
                                       "alloc memory failed");
            return NULL;
        }
    }

    for (int i = 0; i < argc; i++) {
        wasm_array_obj_get_elem(arr_ref, i, false, &tmp);
        argv[i] = (dyn_value_t)UNBOX_ANYREF(tmp.gc_obj);
    }

    ret = dyntype_new_object_with_class(UNBOX_ANYREF(ctx), name, argc, argv);
    if (argv) {
        wasm_runtime_free(argv);
    }

    BOX_ANYREF(ret);
}

/* clang-format off */
#define REG_NATIVE_FUNC(func_name, signature) \
    { #func_name, func_name##_wrapper, signature, NULL }

static NativeSymbol native_symbols[] = {
    REG_NATIVE_FUNC(dyntype_context_init, "()r"),
    REG_NATIVE_FUNC(dyntype_context_destroy, "(r)"),

    REG_NATIVE_FUNC(dyntype_new_number, "(rF)r"),
    REG_NATIVE_FUNC(dyntype_new_boolean, "(ri)r"),
    REG_NATIVE_FUNC(dyntype_new_string, "(rr)r"),
    REG_NATIVE_FUNC(dyntype_new_undefined, "(r)r"),
    REG_NATIVE_FUNC(dyntype_new_null, "(r)r"),
    REG_NATIVE_FUNC(dyntype_new_object, "(r)r"),
    REG_NATIVE_FUNC(dyntype_new_array_with_length, "(ri)r"),
    REG_NATIVE_FUNC(dyntype_new_array, "(r)r"),
    REG_NATIVE_FUNC(dyntype_add_elem, "(rrr)"),
    REG_NATIVE_FUNC(dyntype_set_elem, "(rrir)"),
    REG_NATIVE_FUNC(dyntype_get_elem, "(rri)r"),
    REG_NATIVE_FUNC(dyntype_new_extref, "(rii)r"),
    REG_NATIVE_FUNC(dyntype_new_object_with_proto, "(rr)r"),

    REG_NATIVE_FUNC(dyntype_set_prototype, "(rrr)i"),
    REG_NATIVE_FUNC(dyntype_get_prototype, "(rr)r"),
    REG_NATIVE_FUNC(dyntype_get_own_property, "(rrir)r"),

    REG_NATIVE_FUNC(dyntype_set_property, "(rr$r)i"),
    REG_NATIVE_FUNC(dyntype_define_property, "(rrrr)i"),
    REG_NATIVE_FUNC(dyntype_get_property, "(rr$)r"),
    REG_NATIVE_FUNC(dyntype_has_property, "(rr$)i"),
    REG_NATIVE_FUNC(dyntype_delete_property, "(rr$)i"),

    REG_NATIVE_FUNC(dyntype_is_undefined, "(rr)i"),
    REG_NATIVE_FUNC(dyntype_is_null, "(rr)i"),
    REG_NATIVE_FUNC(dyntype_is_bool, "(rr)i"),
    REG_NATIVE_FUNC(dyntype_is_number, "(rr)i"),
    REG_NATIVE_FUNC(dyntype_is_string, "(rr)i"),
    REG_NATIVE_FUNC(dyntype_is_object, "(rr)i"),
    REG_NATIVE_FUNC(dyntype_is_array, "(rr)i"),
    REG_NATIVE_FUNC(dyntype_is_extref, "(rr)i"),

    REG_NATIVE_FUNC(dyntype_to_bool, "(rr)i"),
    REG_NATIVE_FUNC(dyntype_to_number, "(rr)F"),
    REG_NATIVE_FUNC(dyntype_to_cstring, "(rr)i"),
    REG_NATIVE_FUNC(dyntype_to_string, "(rr)r"),
    REG_NATIVE_FUNC(dyntype_to_extref, "(rr)i"),
    REG_NATIVE_FUNC(dyntype_is_falsy, "(rr)i"),

    REG_NATIVE_FUNC(dyntype_free_cstring, "(ri)"),

    REG_NATIVE_FUNC(dyntype_typeof, "(rr)r"),
    REG_NATIVE_FUNC(dyntype_typeof1, "(rr)i"),
    REG_NATIVE_FUNC(dyntype_type_eq, "(rrr)i"),
    REG_NATIVE_FUNC(dyntype_cmp, "(rrri)i"),

    REG_NATIVE_FUNC(dyntype_instanceof, "(rrr)i"),

    REG_NATIVE_FUNC(dyntype_new_object_with_class, "(r$r)r"),
    REG_NATIVE_FUNC(dyntype_invoke, "(r$rr)r"),

    REG_NATIVE_FUNC(dyntype_get_global, "(r$)r"),

    /* TODO */
};
/* clang-format on */

uint32_t
get_libdyntype_symbols(char **p_module_name, NativeSymbol **p_native_symbols)
{
    *p_module_name = "libdyntype";
    *p_native_symbols = native_symbols;
    return sizeof(native_symbols) / sizeof(NativeSymbol);
}

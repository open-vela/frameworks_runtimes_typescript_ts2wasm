/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

#include "dyntype.h"
#include "cutils.h"
#include "quickjs.h"
#include <string.h>

static dyn_ctx_t g_dynamic_context = NULL;

typedef struct DynTypeContext {
  JSRuntime *js_rt;
  JSContext *js_ctx;
  JSValue *js_undefined;
  JSValue *js_null;
  dyntype_callback_dispatcher_t cb_dispatcher;
} DynTypeContext;

static inline JSValue* dyntype_dup_value(JSContext *ctx, JSValue value) {
    JSValue *ptr = js_malloc(ctx, sizeof(value));

    if (!ptr) {
        return NULL;
    }
    memcpy(ptr, &value, sizeof(value));
    return ptr;
}

static inline bool number_cmp(double lhs, double rhs, cmp_operator operator_kind) {
    bool res = false;

    switch (operator_kind) {
        case LessThanToken: {
            res = lhs < rhs;
            break;
        }
        case GreaterThanToken: {
            res = lhs > rhs;
            break;
        }
        case EqualsEqualsToken:
        case EqualsEqualsEqualsToken: {
            res = lhs == rhs;
            break;
        }
        case LessThanEqualsToken: {
            res = lhs <= rhs;
            break;
        }
        case GreaterThanEqualsToken: {
            res = lhs >= rhs;
            break;
        }
        case ExclamationEqualsToken:
        case ExclamationEqualsEqualsToken: {
            res = lhs != rhs;
            break;
        }
    }

    return res;
}

static inline bool string_cmp(const char *lhs, const char * rhs, cmp_operator operator_kind) {
    bool res = false;
    int cmp_res = strcmp(lhs, rhs);

    switch (operator_kind) {
        case LessThanToken: {
            res = cmp_res < 0;
            break;
        }
        case GreaterThanToken: {
            res = cmp_res > 0;
            break;
        }
        case EqualsEqualsToken:
        case EqualsEqualsEqualsToken: {
            res = cmp_res == 0;
            break;
        }
        case LessThanEqualsToken: {
            res = cmp_res <= 0;
            break;
        }
        case GreaterThanEqualsToken: {
            res = cmp_res >= 0;
            break;
        }
        case ExclamationEqualsToken:
        case ExclamationEqualsEqualsToken: {
            res = cmp_res != 0;
            break;
        }
    }

    return res;
}

static inline bool bool_cmp(bool lhs, bool rhs, cmp_operator operator_kind) {
    bool res = false;

    switch (operator_kind) {
        case LessThanToken: {
            res = lhs < rhs;
            break;
        }
        case GreaterThanToken: {
            res = lhs > rhs;
            break;
        }
        case EqualsEqualsToken:
        case EqualsEqualsEqualsToken: {
            res = lhs == rhs;
            break;
        }
        case LessThanEqualsToken: {
            res = lhs <= rhs;
            break;
        }
        case GreaterThanEqualsToken: {
            res = lhs >= rhs;
            break;
        }
        case ExclamationEqualsToken:
        case ExclamationEqualsEqualsToken: {
            res = lhs != rhs;
            break;
        }
    }

    return res;
}

static inline bool cmp_operator_has_equal_token(cmp_operator operator_kind) {
    if (operator_kind == EqualsEqualsToken || operator_kind == EqualsEqualsEqualsToken
        || operator_kind == LessThanEqualsToken || operator_kind == GreaterThanEqualsToken) {
        return true;
    }

    return false;
}

static dyn_type_t quickjs_type_to_dyn_type(int quickjs_tag) {
    switch (quickjs_tag) {
#define XX(qtag, dyntype) case qtag: return dyntype;
    XX(0, DynNull);
    XX(69, DynUndefined);
    XX(73, DynObject);
    XX(71, DynBoolean);
    XX(70, DynNumber);
    XX(72, DynString);
    // XX(27, DynFunction); // TODO
    XX(74, DynSymbol);
    // XX(139, DynBigInt); // TODO
#undef XX
    default:
        return DynUnknown;
    }
    return DynUnknown;
}

dyn_ctx_t dyntype_context_init() {
    if (g_dynamic_context) {
        return g_dynamic_context;
    }

    dyn_ctx_t ctx = malloc(sizeof(DynTypeContext));
    if (!ctx) {
        return NULL;
    }
    memset(ctx, 0, sizeof(DynTypeContext));
    ctx->js_rt = JS_NewRuntime();
    if (!ctx->js_rt) {
        goto fail;
    }
    ctx->js_ctx = JS_NewContext(ctx->js_rt);
    if (!ctx->js_ctx) {
        goto fail;
    }

    ctx->js_undefined = dyntype_dup_value(ctx->js_ctx, JS_UNDEFINED);
    if (!ctx->js_undefined) {
        goto fail;
    }

    ctx->js_null = dyntype_dup_value(ctx->js_ctx, JS_NULL);
    if (!ctx->js_null) {
        goto fail;
    }

    g_dynamic_context = ctx;
    return ctx;

fail:
    dyntype_context_destroy(ctx);
    return NULL;
}

dyn_ctx_t dyntype_context_init_with_opt(dyn_options_t *options) {
    // TODO
    return NULL;
}

// TODO: there is exist wild pointer
void dyntype_context_destroy(dyn_ctx_t ctx) {
    if (ctx) {
        if (ctx->js_undefined) {
            js_free(ctx->js_ctx, ctx->js_undefined);
        }
        if (ctx->js_null) {
            js_free(ctx->js_ctx, ctx->js_null);
        }
        if (ctx->js_ctx) {
            JS_FreeContext(ctx->js_ctx);
        }
        if (ctx->js_rt) {
            JS_FreeRuntime(ctx->js_rt);
        }
        free(ctx);
    }

    g_dynamic_context = NULL;
}

void
dyntype_set_callback_dispatcher(dyn_ctx_t ctx,
                                dyntype_callback_dispatcher_t callback)
{
    ctx->cb_dispatcher = callback;
}

dyn_ctx_t dyntype_get_context() {
    return g_dynamic_context;
}

dyn_value_t dyntype_new_number(dyn_ctx_t ctx, double value) {
    JSValue v = JS_NewFloat64(ctx->js_ctx, value);
    return dyntype_dup_value(ctx->js_ctx, v);
}

dyn_value_t dyntype_new_boolean(dyn_ctx_t ctx, bool value) {
    JSValue v = JS_NewBool(ctx->js_ctx, value);
    return dyntype_dup_value(ctx->js_ctx, v);
}

dyn_value_t dyntype_new_string(dyn_ctx_t ctx, const char *str) {
    JSValue v = JS_NewString(ctx->js_ctx, str);
    if (JS_IsException(v)) {
        return NULL;
    }
    return dyntype_dup_value(ctx->js_ctx, v);
}

dyn_value_t dyntype_new_string_with_length(dyn_ctx_t ctx, const char *str, int len) {
    JSValue v = JS_NewStringLen(ctx->js_ctx, str, len);
    if (JS_IsException(v)) {
        return NULL;
    }
    return dyntype_dup_value(ctx->js_ctx, v);
}

static JSValue
WasmCallBackDataForJS(JSContext *ctx, JSValueConst this_obj, int argc,
                      JSValueConst *argv, int magic, JSValue *func_data)
{
    JSValue ret;
    void *vfunc = JS_GetOpaque(func_data[0], JS_CLASS_OBJECT);
    void *exec_env = JS_GetOpaque(func_data[1], JS_CLASS_OBJECT);
    dyn_ctx_t dyntype_ctx = JS_GetOpaque(func_data[2], JS_CLASS_OBJECT);
    dyn_value_t *args = malloc(sizeof(dyn_value_t) * argc);
    dyn_value_t this_dyn_obj = NULL;

    if (!args) {
        return JS_NULL;
    }

    for (int i = 0; i < argc; i++) {
        args[i] = dyntype_dup_value(ctx, *(argv + i));
    }
    this_dyn_obj = dyntype_dup_value(ctx, this_obj);

    if (dyntype_ctx->cb_dispatcher) {
        ret = *(JSValue *)(dyntype_ctx->cb_dispatcher(
            exec_env, dyntype_ctx, vfunc, this_dyn_obj, argc, args));
    }
    else {
        ret = JS_ThrowInternalError(
            ctx, "external callback dispatcher not registered");
    }

    free(args);
    return ret;
}

static JSValue new_function_wrapper(dyn_ctx_t ctx, void* vfunc, void* opaque) {
    JSValue data_hold[3];
    data_hold[0] = JS_NewObject(ctx->js_ctx);
    JS_SetOpaque(data_hold[0], vfunc);
    data_hold[1] = JS_NewObject(ctx->js_ctx);
    JS_SetOpaque(data_hold[1], opaque);
    data_hold[2] = JS_NewObject(ctx->js_ctx);
    JS_SetOpaque(data_hold[2], ctx);
    JSValue func = JS_NewCFunctionData(ctx->js_ctx, WasmCallBackDataForJS,
                0, 0, 3, data_hold); // data will be dup inside qjs
    JS_FreeValue(ctx->js_ctx, data_hold[0]);
    JS_FreeValue(ctx->js_ctx, data_hold[1]);
    JS_FreeValue(ctx->js_ctx, data_hold[2]);
    return func;
}

dyn_value_t dyntype_new_undefined(dyn_ctx_t ctx) {
    return ctx->js_undefined;
}

dyn_value_t dyntype_new_null(dyn_ctx_t ctx) {
    return ctx->js_null;
}

dyn_value_t dyntype_new_object(dyn_ctx_t ctx) {
    JSValue v = JS_NewObject(ctx->js_ctx);
    if (JS_IsException(v)) {
        return NULL;
    }
    return dyntype_dup_value(ctx->js_ctx, v);
}

dyn_value_t
dyntype_parse_json(dyn_ctx_t ctx, const char *str)
{
    JSValue v = JS_ParseJSON(ctx->js_ctx, str, strlen(str), NULL);
    if (JS_IsException(v)) {
        return NULL;
    }
    return dyntype_dup_value(ctx->js_ctx, v);
}

dyn_value_t dyntype_new_array_with_length(dyn_ctx_t ctx, int len) {
    JSValue v = JS_NewArray(ctx->js_ctx);
    if (JS_IsException(v)) {
        return NULL;
    }

    if (len) {
        JSValue vlen = JS_NewInt32(ctx->js_ctx, len);
        set_array_length1(ctx->js_ctx, JS_VALUE_GET_OBJ(v), vlen, 0);
    }

    return dyntype_dup_value(ctx->js_ctx, v);
}

dyn_value_t dyntype_new_array(dyn_ctx_t ctx) {
    return dyntype_new_array_with_length(ctx, 0);
}

dyn_value_t
dyntype_get_global(dyn_ctx_t ctx, const char *name)
{
    JSAtom atom = find_atom(ctx->js_ctx, name);
    JSValue global_var = JS_GetGlobalVar(ctx->js_ctx, atom, true);

    if (JS_IsException(global_var)) {
        return NULL;
    }
    JS_FreeAtom(ctx->js_ctx, atom);
    return dyntype_dup_value(ctx->js_ctx, global_var);
}

dyn_value_t
dyntype_new_object_with_class(dyn_ctx_t ctx, const char *name, int argc,
                              dyn_value_t *args)
{
    JSValue obj;
    JSAtom atom = find_atom(ctx->js_ctx, name);
    JSValue global_var = JS_GetGlobalVar(ctx->js_ctx, atom, true);
    JSValue argv[argc];

    if (JS_IsException(global_var)) {
        return NULL;
    }

    for (int i = 0; i < argc; i++) {
        argv[i] = *(JSValue *)args[i];
    }

    obj = JS_CallConstructorInternal(ctx->js_ctx, global_var, global_var, argc,
                                     argv, 0);

    JS_FreeAtom(ctx->js_ctx, atom);
    JS_FreeValue(ctx->js_ctx, global_var);
    return dyntype_dup_value(ctx->js_ctx, obj);
}

/** this_obj is void*, it comes from dyntype_dup_value(), so actually it has type JSValue*
 * so the cast void* to JSValue* is safe.
*/
dyn_value_t dyntype_invoke(dyn_ctx_t ctx, const char *name, dyn_value_t this_obj,
                           int argc, dyn_value_t *args) {
    JSValue this_val = *(JSValue*)this_obj;
    JSClassCall *call_func = NULL;
    JSAtom atom = find_atom(ctx->js_ctx, name);
    JSValue func = JS_GetProperty(ctx->js_ctx, this_val, atom);
    if (!JS_IsFunction(ctx->js_ctx, func)) {
        return NULL;
    }

    JSObject *func_obj = JS_VALUE_GET_OBJ(func);
    uint32_t class_id =  getClassIdFromObject(func_obj);
    JSValue argv[argc];

    call_func = getCallByClassId(ctx->js_rt, class_id);
    if (!call_func) {
        JS_FreeValue(ctx->js_ctx, func);
        return NULL;
    }

    for (int i = 0; i < argc; i++) {
        argv[i] = *(JSValue*)args[i];
    }
    JSValue v = call_func(ctx->js_ctx, func, this_val, argc, argv, 0); // flags is 0 because quickjs.c:17047

    JS_FreeAtom(ctx->js_ctx, atom);
    JS_FreeValue(ctx->js_ctx, func);
    return dyntype_dup_value(ctx->js_ctx, v);
}

int dyntype_execute_pending_jobs(dyn_ctx_t ctx) {
    JSContext *js_ctx1;

    return JS_ExecutePendingJob(JS_GetRuntime(ctx->js_ctx), &js_ctx1);
}

dyn_value_t dyntype_new_extref(dyn_ctx_t ctx, void *ptr, external_ref_tag tag, void* opaque)
{
    JSValue tag_v, ref_v, v;

    if (tag != ExtObj && tag != ExtFunc && tag != ExtInfc && tag != ExtArray) {
        return NULL;
    }

    if (tag == ExtFunc) {
        v = new_function_wrapper(ctx, ptr, opaque);
    } else {
        v = JS_NewObject(ctx->js_ctx);
    }

    if (JS_IsException(v)) {
        return NULL;
    }

    tag_v = JS_NewInt32(ctx->js_ctx, (int)tag);
    ref_v = JS_NewInt32(ctx->js_ctx, (int32_t)(uintptr_t)ptr);
    JS_SetPropertyStr(ctx->js_ctx, v, "@tag", tag_v);
    JS_SetPropertyStr(ctx->js_ctx, v, "@ref", ref_v);
    return dyntype_dup_value(ctx->js_ctx, v);
}

int
dyntype_set_elem(dyn_ctx_t ctx, dyn_value_t obj, int index, dyn_value_t elem)
{
    JSValue *obj_ptr = (JSValue *)obj;
    JSValue *elem_ptr = (JSValue *)elem;

    if (!JS_IsArray(ctx->js_ctx, *obj_ptr)) {
        return -DYNTYPE_TYPEERR;
    }
    if (index < 0) {
        return -DYNTYPE_TYPEERR;
    }

    if (JS_SetPropertyUint32(ctx->js_ctx, *obj_ptr, index, *elem_ptr) < 0) {
        return -DYNTYPE_EXCEPTION;
    }

    return DYNTYPE_SUCCESS;
}

dyn_value_t
dyntype_get_elem(dyn_ctx_t ctx, dyn_value_t obj, int index)
{
    JSValue val;
    JSValue *obj_ptr = (JSValue *)obj;
    if (!JS_IsArray(ctx->js_ctx, *obj_ptr)) {
        return NULL;
    }
    if (index < 0 ) return dyntype_new_undefined(dyntype_get_context());
    val = JS_GetPropertyUint32(ctx->js_ctx, *obj_ptr, index);
    if (JS_IsException(val)) {
        return NULL;
    }
    return dyntype_dup_value(ctx->js_ctx, val);
}

int dyntype_set_property(dyn_ctx_t ctx, dyn_value_t obj, const char *prop,
                         dyn_value_t value) {
    JSValue *obj_ptr = (JSValue *)obj;
    if (!JS_IsObject(*obj_ptr)) {
        return -DYNTYPE_TYPEERR;
    }
    JSValue *val = (JSValue *)value;
    return JS_SetPropertyStr(ctx->js_ctx, *obj_ptr, prop, *val)
               ? DYNTYPE_SUCCESS
               : -DYNTYPE_EXCEPTION;
}

int dyntype_define_property(dyn_ctx_t ctx, dyn_value_t obj, const char *prop,
                            dyn_value_t desc) {
    JSValue *obj_ptr = (JSValue *)obj;
    if (!JS_IsObject(*obj_ptr)) {
        return -DYNTYPE_TYPEERR;
    }
    JSValue *desc_ptr = (JSValue *)desc;
    if (!JS_IsObject(*desc_ptr)) {
        return -DYNTYPE_TYPEERR;
    }
    JSAtom atom;
    int res;
    atom = JS_NewAtom(ctx->js_ctx, prop);
    if (atom == JS_ATOM_NULL) {
        return -DYNTYPE_EXCEPTION;
    }
    // It will only return TRUE or EXCEPTION, because of JS_PROP_THROW flag
    res = JS_DefinePropertyDesc1(ctx->js_ctx, *obj_ptr, atom, *desc_ptr, JS_PROP_THROW);
    JS_FreeAtom(ctx->js_ctx, atom);
    return res == -1 ? -DYNTYPE_EXCEPTION : DYNTYPE_SUCCESS;
}

dyn_value_t dyntype_get_property(dyn_ctx_t ctx, dyn_value_t obj,
                                 const char *prop) {
    JSValue *obj_ptr = (JSValue *)obj;
    if (!JS_IsObject(*obj_ptr)) {
        return NULL;
    }
    JSValue val = JS_GetPropertyStr(ctx->js_ctx, *obj_ptr, prop);
    if (JS_IsException(val)) {
        return NULL;
    }
    JSValue *ptr = dyntype_dup_value(ctx->js_ctx, val);
    return ptr;
}

int dyntype_has_property(dyn_ctx_t ctx, dyn_value_t obj, const char *prop) {
    int res;
    JSAtom atom;
    JSValue *obj_ptr = (JSValue *)obj;

    if (!JS_IsObject(*obj_ptr)) {
        return -DYNTYPE_TYPEERR;
    }

    atom = JS_NewAtom(ctx->js_ctx, prop);
    if (atom == JS_ATOM_NULL) {
        return -DYNTYPE_EXCEPTION;
    }
    res = JS_HasProperty(ctx->js_ctx, *obj_ptr, atom);
    JS_FreeAtom(ctx->js_ctx, atom);
    if (res == -1) {
        return -DYNTYPE_EXCEPTION;
    }
    return res == 0 ? DYNTYPE_FALSE : DYNTYPE_TRUE;
}

int dyntype_delete_property(dyn_ctx_t ctx, dyn_value_t obj, const char *prop) {
    JSValue *obj_ptr = (JSValue *)obj;
    JSAtom atom;

    if (dyntype_has_property(ctx, obj, prop) != DYNTYPE_TRUE) {
        return -DYNTYPE_FALSE;
    }

    atom = JS_NewAtom(ctx->js_ctx, prop);
    if (atom == JS_ATOM_NULL) {
        return -DYNTYPE_EXCEPTION;
    }

    int res = JS_DeleteProperty(ctx->js_ctx, *obj_ptr, atom, 0);
    JS_FreeAtom(ctx->js_ctx, atom);
    if (res == -1) {
        return -DYNTYPE_EXCEPTION;
    }
    return res == 0 ? DYNTYPE_FALSE : DYNTYPE_TRUE;
}

bool dyntype_is_undefined(dyn_ctx_t ctx, dyn_value_t obj) {
    JSValue *ptr = (JSValue *)obj;
    return (bool)JS_IsUndefined(*ptr);
}

bool dyntype_is_null(dyn_ctx_t ctx, dyn_value_t obj) {
    JSValue *ptr = (JSValue *)obj;
    return (bool)JS_IsNull(*ptr);
}

bool dyntype_is_bool(dyn_ctx_t ctx, dyn_value_t obj) {
    JSValue *ptr = (JSValue *)obj;
    return (bool)JS_IsBool(*ptr);
}

int dyntype_to_bool(dyn_ctx_t ctx, dyn_value_t bool_obj, bool *pres) {
    JSValue *ptr = (JSValue *)bool_obj;
    if (!JS_IsBool(*ptr)) {
        return -DYNTYPE_TYPEERR;
    }
    *pres = (bool)JS_ToBool(ctx->js_ctx, *ptr);
    return DYNTYPE_SUCCESS;
}

bool dyntype_is_number(dyn_ctx_t ctx, dyn_value_t obj) {
    JSValue *ptr = (JSValue *)obj;
    return (bool)JS_IsNumber(*ptr);
}

int dyntype_to_number(dyn_ctx_t ctx, dyn_value_t obj, double *pres) {
    JSValue* ptr = (JSValue *)obj;
    if (!JS_IsNumber(*ptr)) {
        return -DYNTYPE_TYPEERR;
    }
    *pres = (JS_VALUE_GET_TAG(*ptr) == JS_TAG_INT ? JS_VALUE_GET_INT(*ptr) :
            JS_VALUE_GET_FLOAT64(*ptr));
    return DYNTYPE_SUCCESS;
}

bool dyntype_is_string(dyn_ctx_t ctx, dyn_value_t obj) {
    JSValue *ptr = (JSValue *)obj;
    return JS_IsString(*ptr);
}

int dyntype_to_cstring(dyn_ctx_t ctx, dyn_value_t str_obj, char **pres) {
    JSValue *ptr = (JSValue *)str_obj;
    *pres = (char*)JS_ToCString(ctx->js_ctx, *ptr);
    if (*pres == NULL) {
        return -DYNTYPE_EXCEPTION;
    }
    return DYNTYPE_SUCCESS;
}

void dyntype_free_cstring(dyn_ctx_t ctx, char *str) {
    JS_FreeCString(ctx->js_ctx, (const char *)str);
}

bool dyntype_is_object(dyn_ctx_t ctx, dyn_value_t obj) {
    JSValue *ptr = (JSValue *)obj;
    return (bool)JS_IsObject(*ptr);
}

bool dyntype_is_function(dyn_ctx_t ctx, dyn_value_t obj) {
    JSValue *ptr = (JSValue *)obj;
    return (bool)JS_IsFunction(ctx->js_ctx, *ptr);
}

bool dyntype_is_array(dyn_ctx_t ctx, dyn_value_t obj) {
    JSValue *ptr = (JSValue *)obj;
    return (bool)JS_IsArray(ctx->js_ctx, *ptr);
}

bool dyntype_is_extref(dyn_ctx_t ctx, dyn_value_t obj)
{
    if (!dyntype_is_object(ctx, obj)) {
        return false;
    }
    return dyntype_has_property(ctx, obj, "@tag") == DYNTYPE_TRUE ? true
                                                                  : false;
}

int dyntype_to_extref(dyn_ctx_t ctx, dyn_value_t obj, void **pres) {
    JSValue *ref_v;
    JSValue *tag_v;

    if (dyntype_is_extref(ctx, obj) == DYNTYPE_FALSE) {
        return -DYNTYPE_TYPEERR;
    }

    tag_v = dyntype_get_property(ctx, obj, "@tag");
    ref_v = dyntype_get_property(ctx, obj, "@ref");
    *pres = (void *)(uintptr_t)JS_VALUE_GET_INT(*ref_v);

    return JS_VALUE_GET_INT(*tag_v);
}

bool dyntype_is_falsy(dyn_ctx_t ctx, dyn_value_t value) {
    bool res;

    if (dyntype_is_extref(ctx, value)) {
        res = false;
    } else if (dyntype_is_object(ctx, value)) {
        res = false;
    } else if (dyntype_is_undefined(ctx, value) || dyntype_is_null(ctx, value)) {
        res = true;
    } else if (dyntype_is_bool(ctx, value)) {
        bool b;
        dyntype_to_bool(ctx, value, &b);
        res = !b;
    } else if (dyntype_is_number(ctx, value)) {
        double num;
        dyntype_to_number(ctx, value, &num);
        res = num == 0;
    } else if (dyntype_is_string(ctx, value)) {
        char *str;
        dyntype_to_cstring(ctx, value, &str);
        res = strcmp(str, "") == 0;
        dyntype_free_cstring(ctx, str);
    } else {
        res = false;
    }
    return res;
}

bool dyntype_is_exception(dyn_ctx_t ctx, dyn_value_t value) {
    JSValue *ptr = (JSValue *)value;
    return (bool)JS_IsException(*ptr);
}

dyn_type_t dyntype_typeof(dyn_ctx_t ctx, dyn_value_t obj) {
    JSValueConst *ptr = (JSValueConst *)obj;

    if (dyntype_is_extref(ctx, obj)) {
        int tag;
        void *ref;
        tag = dyntype_to_extref(ctx, obj, &ref);
        if (tag == ExtObj) {
            return DynExtRefObj;
        }
        else if (tag == ExtFunc) {
            return DynExtRefFunc;
        }
        else if (tag == ExtInfc) {
            return DynExtRefInfc;
        }
        else if (tag == ExtArray) {
            return DynExtRefArray;
        }
    }

    int q_atom_tag = js_operator_typeof1(ctx->js_ctx, *ptr);
    dyn_type_t tag = quickjs_type_to_dyn_type(q_atom_tag);
    return tag;
}

bool dyntype_type_eq(dyn_ctx_t ctx, dyn_value_t lhs, dyn_value_t rhs) {
    return dyntype_typeof(ctx, lhs) == dyntype_typeof(ctx, rhs);
}

bool dyntype_cmp(dyn_ctx_t ctx, dyn_value_t lhs, dyn_value_t rhs, cmp_operator operator_kind) {
    bool res;
    dyn_type_t type;

    if (lhs == rhs) {
        if (cmp_operator_has_equal_token(operator_kind)) {
            return true;
        } else {
            return false;
        }
    }

    type = dyntype_typeof(ctx, lhs);

    switch (type) {
        case DynBoolean: {
            bool lhs_b = 0, rhs_b = 0;
            dyntype_to_bool(ctx, lhs, &lhs_b);
            dyntype_to_bool(ctx, rhs, &rhs_b);
            res = bool_cmp(lhs_b, rhs_b, operator_kind);
            break;
        }
        case DynNumber: {
            double lhs_n = 0, rhs_n = 0;
            dyntype_to_number(ctx, lhs, &lhs_n);
            dyntype_to_number(ctx, rhs, &rhs_n);
            res = number_cmp(lhs_n, rhs_n, operator_kind);
            break;
        }
        case DynNull: {
            if (cmp_operator_has_equal_token(operator_kind)) {
                res = true;
            } else {
                res = false;
            }
            break;
        }
        case DynUndefined: {
            /** undefined <= undefined => false*/
            if (operator_kind == EqualsEqualsToken || operator_kind == EqualsEqualsEqualsToken) {
                res = true;
            } else {
                res = false;
            }
            break;
        }

        case DynString: {
            char *lhs_s, *rhs_s;
            dyntype_to_cstring(ctx, lhs, &lhs_s);
            dyntype_to_cstring(ctx, rhs, &rhs_s);
            res = string_cmp(lhs_s, rhs_s, operator_kind);
            dyntype_free_cstring(ctx, lhs_s);
            dyntype_free_cstring(ctx, rhs_s);
            break;
        }
        case DynObject: {
            /** only allows == / === / != / !== */
            if (operator_kind < EqualsEqualsToken) {
                printf("[runtime library error]: non-equal compare token on two any type objects");
            }
            JSValue *lhs_v = (JSValue *)lhs;
            JSValue *rhs_v = (JSValue *)rhs;
            res = JS_VALUE_GET_PTR(*lhs_v) == JS_VALUE_GET_PTR(*rhs_v);
            if (operator_kind == ExclamationEqualsToken || operator_kind == ExclamationEqualsEqualsToken) {
                res = !res;
            }
            break;
        }
        default: {
            res = false;
        }
    }
    return res;
}

dyn_value_t dyntype_new_object_with_proto(dyn_ctx_t ctx,
                                          const dyn_value_t proto_obj) {
    JSValueConst *proto = (JSValueConst *)proto_obj;
    if (!JS_IsObject(*proto) && !JS_IsNull(*proto)) {
        return NULL;
    }
    JSValue new_obj = JS_NewObjectProto(ctx->js_ctx, *proto);
    if (JS_IsException(new_obj)) {
        return NULL;
    }
    return dyntype_dup_value(ctx->js_ctx, new_obj);
}

int dyntype_set_prototype(dyn_ctx_t ctx, dyn_value_t obj,
                          const dyn_value_t proto_obj) {
    JSValue *obj_ptr = (JSValue *)obj;
    if (JS_VALUE_GET_TAG(*obj_ptr) == JS_TAG_NULL
        || JS_VALUE_GET_TAG(*obj_ptr) == JS_TAG_UNDEFINED) {
        return -DYNTYPE_TYPEERR;
    }
    JSValue *proto_obj_ptr = (JSValue *)proto_obj;
    if (JS_VALUE_GET_TAG(*proto_obj_ptr) != JS_TAG_NULL
        && JS_VALUE_GET_TAG(*proto_obj_ptr) != JS_TAG_OBJECT) {
        return -DYNTYPE_TYPEERR;
    }
    int res = JS_SetPrototype(ctx->js_ctx, *obj_ptr, *proto_obj_ptr);
    return res == 1 ? DYNTYPE_SUCCESS : -DYNTYPE_EXCEPTION;
}

const dyn_value_t dyntype_get_prototype(dyn_ctx_t ctx, dyn_value_t obj) {
    JSValue *obj_ptr = (JSValue *)obj;
    if (JS_VALUE_GET_TAG(*obj_ptr) == JS_TAG_NULL
        || JS_VALUE_GET_TAG(*obj_ptr) == JS_TAG_UNDEFINED) {
        return NULL;
    }
    JSValue proto = JS_GetPrototype(ctx->js_ctx, *obj_ptr);
    if (JS_IsException(proto)) {
        return NULL;
    }
    JSValue *proto1 = dyntype_dup_value(ctx->js_ctx, proto);
    return proto1;
}

dyn_value_t dyntype_get_own_property(dyn_ctx_t ctx, dyn_value_t obj,
                                     const char *prop) {
    JSValue *obj_ptr = (JSValue *)obj;
    if (JS_VALUE_GET_TAG(*obj_ptr) != JS_TAG_OBJECT) {
        return NULL;
    }
    JSAtom atom = JS_NewAtom(ctx->js_ctx, prop);
    if (atom == JS_ATOM_NULL) {
        return NULL;
    }
    JSPropertyDescriptor desc;
    int res = JS_GetOwnProperty(ctx->js_ctx, &desc, *obj_ptr, atom);
    JS_FreeAtom(ctx->js_ctx, atom);
    if (res != 1) {
        return NULL;
    }
    JSValue *v = dyntype_dup_value(ctx->js_ctx, desc.value);
    return v;
}

bool dyntype_instanceof(dyn_ctx_t ctx, const dyn_value_t src_obj,
                        const dyn_value_t dst_obj) {
    JSValue *src = (JSValue *)src_obj;
    JSValue *dst = (JSValue *)dst_obj;

    int ret = JS_OrdinaryIsInstanceOf1(ctx->js_ctx, *src, *dst);
    if (ret == -1) {
        return -DYNTYPE_EXCEPTION;
    }

    return ret == 1 ? DYNTYPE_TRUE : DYNTYPE_FALSE;
}

void dyntype_dump_value(dyn_ctx_t ctx, dyn_value_t obj) {
    JSValue *v = (JSValue *)obj;
    const char *str;
    size_t len;

    str = JS_ToCStringLen(ctx->js_ctx, &len, *v);
    if (str)
        fwrite(str, 1, len, stdout);
    JS_FreeCString(ctx->js_ctx, str);
}

int dyntype_dump_value_buffer(dyn_ctx_t ctx, dyn_value_t obj, void *buffer,
                              int len) {
    JSValue *v = (JSValue *)obj;
    int res = JS_DumpWithBuffer(ctx->js_rt, v, buffer, len);
    return res == -1 ? -DYNTYPE_EXCEPTION : res;
}

void dyntype_hold(dyn_ctx_t ctx, dyn_value_t obj) {
    JSValue *ptr = (JSValue *)obj;
    if (JS_VALUE_HAS_REF_COUNT(*ptr)) {
        JS_DupValue(ctx->js_ctx, *ptr);
    }
}

// TODO: there is exist wild pointer
void dyntype_release(dyn_ctx_t ctx, dyn_value_t obj) {
    if (obj == NULL) {
        return;
    }
    JSValue *ptr = (JSValue *)(obj);
    if (JS_VALUE_HAS_REF_COUNT(*ptr)) {
        JSRefCountHeader *p = (JSRefCountHeader *)JS_VALUE_GET_PTR(*ptr);
        int ref_cnt = p->ref_count;
        JS_FreeValue(ctx->js_ctx, *ptr);
        if (ref_cnt <= 1) {
            js_free(ctx->js_ctx, obj);
        }
    } else {
        js_free(ctx->js_ctx, obj);
    }
}

void dyntype_collect(dyn_ctx_t ctx) {
    // TODO
}

dyn_value_t
dyntype_throw_exception(dyn_ctx_t ctx, dyn_value_t obj)
{
    JSValue exception_obj;
    JSValue js_exception;

    exception_obj = *(JSValue *)obj;
    js_exception = JS_Throw(ctx->js_ctx, exception_obj);

    return dyntype_dup_value(ctx->js_ctx, js_exception);
}

dyn_value_t
dyntype_get_exception(dyn_ctx_t ctx)
{
    JSValue val = JS_GetException(ctx->js_ctx);

    return dyntype_dup_value(ctx->js_ctx, val);
}

void
dyntype_dump_error(dyn_ctx_t ctx)
{
    dyn_value_t error;
    JSValue val;
    BOOL is_error;

    error = dyntype_get_exception(ctx);
    is_error = JS_IsError(ctx->js_ctx, *(JSValue *)error);
    dyntype_dump_value(ctx, error);
    if (is_error) {
        val = JS_GetPropertyStr(ctx->js_ctx, *(JSValue *)error, "stack");
        if (!JS_IsUndefined(val)) {
            dyntype_dump_value(ctx, dyntype_dup_value(ctx->js_ctx, val));
        }
        JS_FreeValue(ctx->js_ctx, val);
    }
}

dyn_value_t
dyntype_call_func(dyn_ctx_t ctx, dyn_value_t obj, int argc, dyn_value_t *args)
{
    JSValue obj_value = *(JSValue *)obj;
    JSValue *argv = NULL;

    if (!JS_IsFunction(ctx->js_ctx, obj_value)) {
        return NULL;
    }
    if (argc > 0) {
        argv = js_malloc(ctx->js_ctx, sizeof(JSValue) * argc);
        for (int i = 0; i < argc; i++) {
            argv[i] = *(JSValue *)args[i];
        }
    }

    JSValue ret = JS_Call(ctx->js_ctx, obj_value, JS_UNDEFINED, argc, argv);

    js_free(ctx->js_ctx, argv);
    if (JS_IsException(ret)) {
        return NULL;
    }
    JSValue *ptr = dyntype_dup_value(ctx->js_ctx, ret);

    return ptr;
}

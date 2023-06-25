/*
 * Copyright (C) 2023 Xiaomi Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */
import {
    ValueType,
    ValueTypeKind,
    PredefinedTypeId,
} from '../../semantics/value_types.js';

import { GetPredefinedType } from '../../semantics/predefined_types.js';

const idNames = new Map<number, string>();
const typeNames = new Map<ValueType, string>();

function addPredefinedType(id: number, name: string) {
    const type = GetPredefinedType(id);
    if (!type) {
        throw Error(`Cannot find Predefined Type ${id}`);
    }

    idNames.set(id, name);
    typeNames.set(type, name);
}

function initPredefined() {
    addPredefinedType(PredefinedTypeId.VOID, 'ts_void_t');
    addPredefinedType(PredefinedTypeId.UNDEFINED, 'ts_undefined_t');
    addPredefinedType(PredefinedTypeId.NULL, 'ts_null_t');
    addPredefinedType(PredefinedTypeId.NEVER, 'ts_never_t');
    addPredefinedType(PredefinedTypeId.INT, 'ts_int_t');
    addPredefinedType(PredefinedTypeId.NUMBER, 'ts_number_t');
    addPredefinedType(PredefinedTypeId.BOOLEAN, 'ts_boolean_t');
    addPredefinedType(PredefinedTypeId.RAW_STRING, 'ts_raw_string_t');
    addPredefinedType(PredefinedTypeId.STRING, 'ts_string_t');
    addPredefinedType(PredefinedTypeId.ANY, 'ts_any_t');
    addPredefinedType(PredefinedTypeId.ARRAY_ANY, 'ts_array_any_t');
    addPredefinedType(PredefinedTypeId.ARRAY_INT, 'ts_array_int_t');
    addPredefinedType(PredefinedTypeId.ARRAY_NUMBER, 'ts_array_number_t');
    addPredefinedType(PredefinedTypeId.ARRAY_BOOLEAN, 'ts_array_boolean_t');
    addPredefinedType(PredefinedTypeId.ARRAY_STRING, 'ts_array_string_t');
    addPredefinedType(PredefinedTypeId.SET_ANY, 'ts_set_any_t');
    addPredefinedType(PredefinedTypeId.SET_INT, 'ts_set_int_t');
    addPredefinedType(PredefinedTypeId.SET_BOOLEAN, 'ts_set_boolean_t');
    addPredefinedType(PredefinedTypeId.SET_STRING, 'ts_set_string_t');
    addPredefinedType(
        PredefinedTypeId.MAP_STRING_STRING,
        'ts_map_string_string_t',
    );
    addPredefinedType(PredefinedTypeId.MAP_INT_STRING, 'ts_map_int_string_t');
    addPredefinedType(PredefinedTypeId.MAP_INT_ANY, 'ts_map_int_any_t');
    addPredefinedType(
        PredefinedTypeId.FUNC_VOID_VOID_NONE,
        'ts_start_void_void_t',
    );
    addPredefinedType(
        PredefinedTypeId.FUNC_VOID_VOID_DEFAULT,
        'ts_func_void_void_t',
    );
    addPredefinedType(
        PredefinedTypeId.FUNC_VOID_ARRAY_ANY_DEFAULT,
        'ts_func_void_array_any_t',
    );
    addPredefinedType(
        PredefinedTypeId.FUNC_ANY_ARRAY_ANY_DEFAULT,
        'ts_func_any_array_any_t',
    );
    addPredefinedType(
        PredefinedTypeId.FUNC_VOID_VOID_METHOD,
        'ts_method_void_void_t',
    );
    addPredefinedType(
        PredefinedTypeId.FUNC_VOID_ARRAY_ANY_METHOD,
        'ts_method_void_array_any_t',
    );
    addPredefinedType(
        PredefinedTypeId.FUNC_ANY_ARRAY_ANY_METHOD,
        'ts_method_any_array_any_t',
    );
}

initPredefined();

export function GetPredefinedTypeById(id: number): string | undefined {
    return idNames.get(id);
}

export function GetPredefinedTypeByType(type: ValueType): string | undefined {
    return typeNames.get(type);
}

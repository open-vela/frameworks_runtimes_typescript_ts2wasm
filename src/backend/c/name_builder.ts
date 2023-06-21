/*
 * Copyright (C) 2023 Xiaomi Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import { ValueTypeKind, ValueType } from '../../semantics/value_types.js';

const name_pattern = new RegExp('[/.|@\\-]', 'g');
function buildIdentifyFromName(name: string): string {
    return name.replace(name_pattern, '_');
}

function isBuiltin(name: string): boolean {
    return name.indexOf('builtin') >= 0;
}

function instanceMetaName(name: string): string {
    return `_meta_instance_${name}`;
}

function classMetaName(name: string): string {
    return `_meta_class_${name}`;
}

function instanceMetaMembersName(name: string): string {
    return `_meta_instance_members_${name}`;
}

function classMetaMembersName(name: string): string {
    return `_meta_class_${name}`;
}

function enumEntryName(name: string): string {
    return `_enum_entry_${name}`;
}

function labelName(idx: number): string {
    return `_L${idx}`;
}

export default {
    isBuiltin,
    buildIdentifyFromName,
    classMetaName,
    classMetaMembersName,
    instanceMetaName,
    instanceMetaMembersName,
    enumEntryName,
    labelName,
};

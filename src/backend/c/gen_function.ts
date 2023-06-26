/*
 * Copyright (C) 2023 Xiaomi Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import { GeneratorContext } from './gen_context.js';
import Names from './name_builder.js';

import { IRFunction } from '../../semantics/ir/function.js';
import {
    IRCode,
    IRCodeKind,
    IRBlock,
    IRCodeValueType,
    isIntIRValue,
    isStringIRValue,
    isObjectIRValue,
    isNumberIRValue,
} from '../../semantics/ir/ircode.js';

import {
    ValueType,
    ValueTypeKind,
    TypeParameterType,
} from '../../semantics/value_types.js';

class FunctionContext {
    constructor(public func: IRFunction, public spIndex: number) {}

    spNext(): number {
        return this.spIndex++;
    }

    spDrop(n = 1) {
        this.spIndex -= n;
    }

    spCur(): number {
        return this.spIndex - 1;
    }
}

function getTypeParameterOwnerType(vt: ValueType): number {
    if (vt.kind != ValueTypeKind.TYPE_PARAMETER) return 0;
    const vtt = vt as TypeParameterType;
    if (vtt.ownedByFunction) return 1;
    if (vtt.ownedByClass) return 2;
    if (vtt.ownedByClosure) return 3;
    return 0;
}

function getTypeIndex(vt: ValueType): number {
    switch (vt.kind) {
        case ValueTypeKind.INT:
            return 1;
        case ValueTypeKind.NUMBER:
            return 2;
        case ValueTypeKind.BOOLEAN:
            return 3;
        case ValueTypeKind.STRING:
        case ValueTypeKind.RAW_STRING:
            return 4;
        case ValueTypeKind.ARRAY:
            return 5;
        case ValueTypeKind.OBJECT:
            return 6;
        case ValueTypeKind.ANY:
            return 7;
        case ValueTypeKind.TYPE_PARAMETER: {
            const vtt = vt as TypeParameterType;
            if (vtt.wideType.kind == ValueTypeKind.OBJECT) return 6;

            return vtt.index & 15;
        }
    }
    return 0;
}

function buildTypeArgumentsInfo(valueTypes?: ValueType[]): string {
    if (valueTypes) {
        let s = '0';
        const i = 0;
        for (const vt of valueTypes) {
            if (i >= 10) return s;
            const idx = getTypeIndex(vt);
            s = `${s} | (${idx} << ${i * 4})`;
            const owned_type = getTypeParameterOwnerType(vt);
            if (owned_type > 0) {
                s = `${s} | (${owned_type} << ${40 + i * 2})`;
            }
        }
        return s;
    }

    return '0L';
}

export function genFunction(context: GeneratorContext, func: IRFunction) {
    context.onEnterFunction();
    const name = Names.buildIdentifyFromName(func.name);
    context.addSource(
        `int ${name}(ts_context_t* context, ts_value_t* params, int argc, int64_t type_args) {`,
    );
    context.shift();
    if (func.varCount + func.tempCount > 0) {
        context.addSource(
            `ts_value_t vars[${func.varCount}/*varCount*/ + ${func.tempCount}/*tempCount*/];`,
        );
    }
    const func_context = new FunctionContext(func, func.varCount);

    for (const op of func.codes) {
        genCode(context, op, func_context);
    }

    context.unshift();
    context.addSource(`}`);
    context.onLeaveFunction();
    context.newLines();
}

function getGCTypeName(op: IRCode): string {
    return getGCTypeNameType(op.type);
}

function getGCTypeNameType(type: IRCodeValueType): string {
    if (type == IRCodeValueType.OBJECT) return 'obj';
    else if (type == IRCodeValueType.REFERENCE) return 'ref';
    else if (type == IRCodeValueType.ANY) return 'any';
    return 'value';
}

function getValueTypeName(op: IRCode): string {
    return getValueTypeNameFromType(op.type);
}

function getValueTypeNameFromType(type: IRCodeValueType): string {
    if (isIntIRValue(type) || type == IRCodeValueType.BOOLEAN) {
        return 'int';
    } else if (isNumberIRValue(type)) {
        return 'number';
    } else if (isStringIRValue(type)) {
        return 'string';
    } else if (type == IRCodeValueType.ANY) {
        return 'any';
    }

    return getGCTypeNameType(type);
}

function genCode(context: GeneratorContext, op: IRCode, fc: FunctionContext) {
    context.addSource(`//OPCODE: ${op}  SP: ${fc.spCur()}`);
    const gc_type = getGCTypeName(op);
    const value_type = getValueTypeName(op);
    switch (op.kind) {
        case IRCodeKind.LOAD_CONST:
            genLoadConst(context, op, fc);
            break;
        case IRCodeKind.LOAD_STRING:
            context.addSource(
                `ts_load_string(context, &vars[${fc.spNext()}], ${op.offset});`,
            );
            break;
        case IRCodeKind.LOAD_PARAM:
            genLoadParam(context, op, fc);
            break;
        case IRCodeKind.LOAD_LOCAL:
            genLoadLocal(context, op, fc);
            break;
        case IRCodeKind.LOAD_GLOBAL:
            genLoadGlobal(context, op, fc);
            break;
        case IRCodeKind.LOAD_CLOSURE:
            context.addSource(
                `ts_load_closure_${gc_type}(context, &var[${fc.spCur()}], ${
                    op.index
                });`,
            );
            break;
        case IRCodeKind.LOAD_FUNCTION:
            context.addSource(
                `ts_load_function(context, &var[${fc.spNext()}], ${op.index});`,
            );
            break;
        case IRCodeKind.LOAD_CLASS:
            context.addSource(
                `ts_load_class(context, &var[${fc.spNext()}], ${op.index});`,
            );
            break;
        case IRCodeKind.LOAD_UNDEFINED:
        case IRCodeKind.LOAD_NULL:
            context.addSource(`ts_load_null(context, &var[${fc.spNext()}]);`);
            break;
        case IRCodeKind.SAVE_PARAM:
            genSaveParam(context, op, fc);
            break;
        case IRCodeKind.SAVE_LOCAL:
            genSaveLocal(context, op, fc);
            break;
        case IRCodeKind.SAVE_CLOSURE:
            context.addSource(
                `ts_save_closure_${gc_type}(context, &var[${fc.spCur()}]);`,
            );
            fc.spDrop();
            break;
        case IRCodeKind.SAVE_GLOBAL:
            genSaveGlobal(context, op, fc);
            break;
        case IRCodeKind.DROP:
            context.addSource(
                `ts_drop_${gc_type}(context, &var[${fc.spCur()}]);`,
            );
            fc.spDrop();
            break;
        case IRCodeKind.DUP:
            context.addSource(
                `ts_dup_${value_type}(context, &var[${fc.spCur()} + ${
                    op.index
                }], &var[${fc.spNext()}]);`,
            );
            break;
        case IRCodeKind.SWAP:
            context.addSource(
                `ts_swap(context, &var[${fc.spCur()}], &var[${
                    fc.spCur() - 1
                }]);`,
            );
            break;
        case IRCodeKind.NEW_REF:
            context.addSource(
                `ts_new_ref_${gc_type}(context, &var[${fc.spCur()}]);`,
            );
            break;
        case IRCodeKind.READ_REF:
            context.addSource(
                `ts_read_ref_${value_type}(context, &var[${fc.spCur()}]);`,
            );
            break;
        case IRCodeKind.WRITE_REF:
            context.addSource(
                `ts_write_ref_${value_type}(context, &var[${fc.spCur()}]);`,
            );
            fc.spDrop(2);
            break;
        case IRCodeKind.ADD:
            genAdd(context, op, fc);
            break;
        case IRCodeKind.SUB:
            genSub(context, op, fc);
            break;
        case IRCodeKind.MULT:
            genMult(context, op, fc);
            break;
        case IRCodeKind.MOD:
            genMod(context, op, fc);
            break;
        case IRCodeKind.DIV:
            genDiv(context, op, fc);
            break;
        case IRCodeKind.CALL:
            genCall(context, op, value_type, fc);
            break;
        case IRCodeKind.METHOD_CALL:
            genMethodCall(context, op, value_type, fc);
            break;
        case IRCodeKind.CONSTRUCTOR_CALL:
            genConstructorCall(context, op, fc);
            break;
        case IRCodeKind.GET_OFFSET:
            context.addSource(
                `ts_get_offset_${value_type}(context, &vars[${fc.spCur()}], ${
                    op.index
                });`,
            );
            break;
        case IRCodeKind.SET_OFFSET:
            context.addSource(
                `ts_set_offset_${value_type}(context, &vars[${fc.spCur()}], ${
                    op.index
                });`,
            );
            fc.spDrop(2);
            break;
        case IRCodeKind.GET_VTABLE:
            context.addSource(
                `ts_get_vtable_${value_type}(context, &vars[${fc.spCur()}], ${
                    op.index
                });`,
            );
            break;
        case IRCodeKind.SET_VTABLE:
            context.addSource(
                `ts_set_vtable_${value_type}(context, &vars[${fc.spCur()}], ${
                    op.index
                });`,
            );
            fc.spDrop(2);
            break;
        case IRCodeKind.VTABLE_CALL:
            genVTableCall(context, op, value_type, fc);
            break;
        case IRCodeKind.GET_SHAPE:
            context.addSource(
                `ts_get_shape_${value_type}(context, &vars[${fc.spCur()}], ${
                    op.index
                });`,
            );
            break;
        case IRCodeKind.SET_SHAPE:
            context.addSource(
                `ts_set_shape_${value_type}(context, &vars[${fc.spCur()}], ${
                    op.index
                });`,
            );
            fc.spDrop(2);
            break;
        case IRCodeKind.SHAPE_CALL:
            genShapeCall(context, op, value_type, fc);
            break;
        case IRCodeKind.GET_DYNAMIC:
            context.addSource(
                `ts_get_dynamic_${value_type}(context, &vars[${fc.spCur()}], ${
                    op.index
                });`,
            );
            break;
        case IRCodeKind.SET_DYNAMIC:
            context.addSource(
                `ts_set_dynamic_${value_type}(context, &vars[${fc.spCur()}], ${
                    op.index
                });`,
            );
            fc.spDrop(2);
            break;
        case IRCodeKind.DYNAMIC_CALL:
            genDynamicCall(context, op, value_type, fc);
            break;
        case IRCodeKind.STRING_INDEX_GET:
            context.addSource(
                `ts_string_index_get(context, &vars[${fc.spCur()}]);`,
            );
            fc.spDrop();
            break;
        case IRCodeKind.STRING_INDEX_SET:
            context.addSource(
                `ts_string_index_set(context, vars[${fc.spCur()}]);`,
            );
            fc.spDrop(3);
            break;
        case IRCodeKind.ARRAY_INDEX_GET:
            context.addSource(
                `ts_array_index_get_${value_type}(context, &vars[${fc.spCur()}]);`,
            );
            fc.spDrop();
            break;
        case IRCodeKind.ARRAY_INDEX_SET:
            context.addSource(
                `ts_array_index_set_${value_type}(context, vars[${fc.spCur()}]);`,
            );
            fc.spDrop(3);
            break;
        case IRCodeKind.OBJECT_INDEX_GET:
            context.addSource(
                `ts_object_index_get_${value_type}(context, &vars[${fc.spCur()}]);`,
            );
            fc.spDrop();
            break;
        case IRCodeKind.OBJECT_INDEX_SET:
            context.addSource(
                `ts_object_index_set_${value_type}(context, vars[${fc.spCur()}]);`,
            );
            fc.spDrop(3);
            break;
        case IRCodeKind.OBJECT_KEY_GET:
            context.addSource(
                `ts_object_key_get_${value_type}(context, vars[${fc.spCur()}]);`,
            );
            fc.spDrop();
            break;
        case IRCodeKind.OBJECT_KEY_SET:
            context.addSource(
                `ts_object_key_set_${value_type}(context, vars[${fc.spCur()}]);`,
            );
            fc.spDrop(3);
            break;
        case IRCodeKind.NEW_OBJECT:
            context.addSource(
                `ts_new_object(context, vars[${fc.spNext()}], ${
                    op.index
                }, ${buildTypeArgumentsInfo(op.typeArguments)});`,
            );
            break;
        case IRCodeKind.NEW_DYNAMIC:
            context.addSource(
                `ts_new_object_dynamic(context, vars[${fc.spCur()}], ${buildTypeArgumentsInfo(
                    op.typeArguments,
                )});`,
            );
            break;
        case IRCodeKind.NEW_CLOSURE:
            context.addSource(
                `ts_new_closure(context, vars[${fc.spNext()}], ${
                    op.index
                }, ${buildTypeArgumentsInfo(op.typeArguments)});`,
            );
            break;
        case IRCodeKind.NEW_ARRAY_LENGTH:
            context.addSource(
                `ts_new_array_len(context, &vars[${fc.spCur()}], ${buildTypeArgumentsInfo(
                    op.typeArguments,
                )});`,
            );
            break;
        case IRCodeKind.NEW_ARRAY_PARAMS:
            context.addSource(
                `ts_new_array_params(context, &vars[${fc.spCur()}], ${
                    op.index
                }, ${buildTypeArgumentsInfo(op.typeArguments)});`,
            );
            break;
        case IRCodeKind.INIT_CLOSURE_VALUE:
            context.addSource(
                `ts_init_closure_${value_type}(context, vars[${fc.spCur()}], ${
                    op.index
                });`,
            );
            fc.spDrop();
            break;

        case IRCodeKind.INSTANCE_OF:
        case IRCodeKind.INSTANCE_OF_DYNAMIC:
            break;

        case IRCodeKind.BUILD_SHAPE:
            context.addSource(
                `ts_build_shape(context, vars[${fc.spCur()}], ${context.getMetaOffset(
                    op.index,
                )}/*${op.index}*/);`,
            );
            break;
        case IRCodeKind.BIND_SHAPE:
            context.addSource(
                `ts_bind_shape(context, vars[${fc.spCur()}], ${context.getShapeOffset(
                    op.index,
                )}/*${op.index}*/);`,
            );
            break;
        case IRCodeKind.UNBOUND_SHAPE:
            break;
        case IRCodeKind.GET_KEY_ITER:
            break;
        case IRCodeKind.GET_VALUE_ITER:
            break;
        case IRCodeKind.NEXT_ITER:
            break;

        case IRCodeKind.RETURN:
            context.addSource(
                `ts_return_value(context, params, vars[${fc.spCur()}]);`,
            );
            context.addSource(`return 1;`);
            break;
        case IRCodeKind.VALUE_CAST:
            genValueCast(context, op, fc);
            break;
        case IRCodeKind.BLOCK: {
            const block = op.block;
            if (block.isLoop) context.addSource(`${block.label}:`);
            genBlockCode(context, block, fc);
            if (!block.isLoop && block.label != '')
                context.addSource(`${block.label}:`);
            break;
        }
        case IRCodeKind.BRANCH:
            context.addSource(`goto ${op.block.label};`);
            break;
        case IRCodeKind.BRANCH_TRUE:
            context.addSource(
                `if (ts_test(&vars[${fc.spCur()}])) goto ${op.block.label};`,
            );
            break;
        case IRCodeKind.BRANCH_FALSE:
            context.addSource(
                `if (!ts_test(&vars[${fc.spCur()}])) goto ${op.block.label};`,
            );
            break;
        case IRCodeKind.IMPORT_FUNCTION:
            context.addSource(
                `ts_import_and_call_function(context, ${op.index}, params, argc, type_args);`,
            );
    }
}

function genBlockCode(
    context: GeneratorContext,
    block: IRBlock,
    fc: FunctionContext,
) {
    for (const ir of block.codes) genCode(context, ir, fc);
}

function genLoadConst(
    context: GeneratorContext,
    op: IRCode,
    fc: FunctionContext,
) {
    const target = `&vars[${fc.spNext()}]`;
    switch (op.type) {
        case IRCodeValueType.UNDEFINED:
            context.addSource(`ts_set_undefined(${target});`);
            break;
        case IRCodeValueType.NULL:
            context.addSource(`ts_set_null(${target});`);
            break;
        case IRCodeValueType.INT8:
        case IRCodeValueType.INT16:
        case IRCodeValueType.INT32:
        case IRCodeValueType.INT:
        case IRCodeValueType.INT64:
            context.addSource(`ts_set_int(${target}, ${op.value});`);
            break;
        case IRCodeValueType.F32:
        case IRCodeValueType.F64:
            context.addSource(`ts_set_number(${target}, ${op.value});`);
            break;
        case IRCodeValueType.BOOLEAN:
            context.addSource(
                `ts_set_boolean(${target}, ${
                    (op.value as boolean) ? 'ts_true' : 'ts_false'
                });`,
            );
            break;
        case IRCodeValueType.RAW_STRING:
            context.addSource(
                `ts_set_string(context, ${target}, ${op.index});`,
            );
            break;
    }
}

function get_value_set(value_type: IRCodeValueType): string {
    if (value_type == IRCodeValueType.ANY) return 'ts_any_set';
    if (isObjectIRValue(value_type)) return 'ts_object_set';
    return 'ts_value_set';
}

function genLoadParam(
    context: GeneratorContext,
    op: IRCode,
    fc: FunctionContext,
) {
    context.addSource(
        `${get_value_set(op.type)}(&vars[${fc.spNext()}], params[${
            op.index
        }]);`,
    );
}

function genLoadLocal(
    context: GeneratorContext,
    op: IRCode,
    fc: FunctionContext,
) {
    context.addSource(
        `${get_value_set(op.type)}(&vars[${fc.spNext()}], vars[${op.index}]);`,
    );
}

function genLoadGlobal(
    context: GeneratorContext,
    op: IRCode,
    fc: FunctionContext,
) {
    context.addSource(
        `ts_global_get(context, &vars[${fc.spNext()}], ${op.index});`,
    );
}

function genSaveParam(
    context: GeneratorContext,
    op: IRCode,
    fc: FunctionContext,
) {
    context.addSource(
        `${get_value_set(op.type)}(&params[${op.index}], vars[${fc.spCur()}]);`,
    );
    fc.spDrop();
}

function genSaveLocal(
    context: GeneratorContext,
    op: IRCode,
    fc: FunctionContext,
) {
    context.addSource(
        `${get_value_set(op.type)}(&vars[${op.index}], vars[${fc.spCur()}]);`,
    );
    fc.spDrop();
}

function genSaveGlobal(
    context: GeneratorContext,
    op: IRCode,
    fc: FunctionContext,
) {
    context.addSource(
        `ts_global_set(context, vars[${fc.spCur()}], ${op.index});`,
    );
    fc.spDrop();
}

function getValueTypeString(op: IRCode): string {
    if (isIntIRValue(op.type)) {
        return 'int';
    } else if (isStringIRValue(op.type)) {
        return 'string';
    } else {
        return 'number';
    }
}

function genAdd(context: GeneratorContext, op: IRCode, fc: FunctionContext) {
    context.addSource(
        `ts_${getValueTypeString(op)}_add(&vars[${
            fc.spCur() - 1
        }], vars[${fc.spCur()}], vars[${fc.spCur() - 1}]);`,
    );
    fc.spDrop();
}

function genSub(context: GeneratorContext, op: IRCode, fc: FunctionContext) {
    context.addSource(
        `ts_${getValueTypeString(op)}_sub(&vars[${
            fc.spCur() - 1
        }], vars[${fc.spCur()}], vars[${fc.spCur() - 1}]);`,
    );
    fc.spDrop();
}

function genMult(context: GeneratorContext, op: IRCode, fc: FunctionContext) {
    context.addSource(
        `ts_${getValueTypeString(op)}_mult(&vars[${
            fc.spCur() - 1
        }], vars[${fc.spCur()}], vars[${fc.spCur() - 1}]);`,
    );
    fc.spDrop();
}

function genMod(context: GeneratorContext, op: IRCode, fc: FunctionContext) {
    context.addSource(
        `ts_${getValueTypeString(op)}_mod(&vars[${
            fc.spCur() - 1
        }], vars[${fc.spCur()}], vars[${fc.spCur() - 1}]);`,
    );
    fc.spDrop();
}

function genDiv(context: GeneratorContext, op: IRCode, fc: FunctionContext) {
    context.addSource(
        `ts_${getValueTypeString(op)}_div(&vars[${
            fc.spCur() - 1
        }], vars[${fc.spCur()}], vars[${fc.spCur() - 1}]);`,
    );
    fc.spDrop();
}

function genCall(
    context: GeneratorContext,
    op: IRCode,
    value_type: string,
    fc: FunctionContext,
) {
    const param_start = fc.spCur() - op.paramCount;
    const typeArgumentsInfo = buildTypeArgumentsInfo(op.typeArguments);
    context.addSource(
        `ts_function_call_${value_type}(context, &vars[${param_start}], ${op.paramCount}, ${typeArgumentsInfo});`,
    );
    fc.spDrop(op.paramCount);
}

function genMethodCall(
    context: GeneratorContext,
    op: IRCode,
    value_type: string,
    fc: FunctionContext,
) {
    const param_start = fc.spCur() - op.paramCount;
    const typeArgumentsInfo = buildTypeArgumentsInfo(op.typeArguments);
    context.addSource(
        `ts_method_call_${value_type}(context, &vars[${param_start}], ${op.paramCount}, ${typeArgumentsInfo});`,
    );
    fc.spDrop(op.paramCount + 1);
}

function genConstructorCall(
    context: GeneratorContext,
    op: IRCode,
    fc: FunctionContext,
) {
    const param_start = fc.spCur() - op.paramCount;
    const typeArgumentsInfo = buildTypeArgumentsInfo(op.typeArguments);
    context.addSource(
        `ts_constructor_call(context, &vars[${param_start}], ${op.paramCount}, ${typeArgumentsInfo});`,
    );
    fc.spDrop(op.paramCount);
}

function genVTableCall(
    context: GeneratorContext,
    op: IRCode,
    value_type: string,
    fc: FunctionContext,
) {
    const param_start = fc.spCur() - op.paramCount;
    const typeArgumentsInfo = buildTypeArgumentsInfo(op.typeArguments);
    context.addSource(
        `ts_vtable_call_${value_type}(context, &vars[${param_start}], ${op.vtableIndex}, ${op.paramCount}, ${typeArgumentsInfo});`,
    );
    fc.spDrop(op.paramCount + 1);
}

function genShapeCall(
    context: GeneratorContext,
    op: IRCode,
    value_type: string,
    fc: FunctionContext,
) {
    const param_start = fc.spCur() - op.paramCount;
    const typeArgumentsInfo = buildTypeArgumentsInfo(op.typeArguments);
    context.addSource(
        `ts_shape_call_${value_type}(context, &vars[${param_start}], ${op.shapeIndex}, ${op.paramCount}, ${typeArgumentsInfo});`,
    );
    fc.spDrop(op.paramCount + 1);
}

function genDynamicCall(
    context: GeneratorContext,
    op: IRCode,
    value_type: string,
    fc: FunctionContext,
) {
    const param_start = fc.spCur() - op.paramCount;
    context.addSource(
        `ts_dynamic_call_${value_type}(context, &vars[${param_start}], ${op.dynamicIndex}, ${op.paramCount});`,
    );
    fc.spDrop(op.paramCount + 1);
}

function genValueCast(
    context: GeneratorContext,
    op: IRCode,
    fc: FunctionContext,
) {
    const func = `ts_${getValueTypeNameFromType(
        op.type,
    )}_cast_${getValueTypeNameFromType(op.fromType)}`;
    context.addSource(`${func}(&vars[${fc.spCur()}]);`);
}

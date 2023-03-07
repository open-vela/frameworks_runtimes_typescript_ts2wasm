import binaryen from 'binaryen';
import { dyntype, structdyn } from './dyntype/utils.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addWatFuncs } from '../src/utils.js';
import { getWatFilesDir, getFuncName } from './builtin/utils.js';
import { BuiltinNames } from './builtin/builtinUtil.js';

export function importAnyLibAPI(module: binaryen.Module) {
    module.addFunctionImport(
        dyntype.dyntype_context_init,
        dyntype.module_name,
        dyntype.dyntype_context_init,
        binaryen.none,
        dyntype.dyn_ctx_t,
    );
    module.addFunctionImport(
        dyntype.dyntype_context_destroy,
        dyntype.module_name,
        dyntype.dyntype_context_destroy,
        dyntype.dyn_ctx_t,
        dyntype.cvoid,
    );
    module.addFunctionImport(
        dyntype.dyntype_new_number,
        dyntype.module_name,
        dyntype.dyntype_new_number,
        binaryen.createType([dyntype.dyn_ctx_t, dyntype.double]),
        dyntype.dyn_value_t,
    );
    module.addFunctionImport(
        dyntype.dyntype_new_string,
        dyntype.module_name,
        dyntype.dyntype_new_string,
        binaryen.createType([dyntype.dyn_ctx_t, dyntype.cstring]),
        dyntype.dyn_value_t,
    );
    module.addFunctionImport(
        dyntype.dyntype_new_boolean,
        dyntype.module_name,
        dyntype.dyntype_new_boolean,
        binaryen.createType([dyntype.dyn_ctx_t, dyntype.bool]),
        dyntype.dyn_value_t,
    );
    module.addFunctionImport(
        dyntype.dyntype_typeof,
        dyntype.module_name,
        dyntype.dyntype_typeof,
        binaryen.createType([dyntype.dyn_ctx_t, dyntype.dyn_value_t]),
        dyntype.dyn_type_t,
    );
    module.addFunctionImport(
        dyntype.dyntype_type_eq,
        dyntype.module_name,
        dyntype.dyntype_type_eq,
        binaryen.createType([
            dyntype.dyn_ctx_t,
            dyntype.dyn_value_t,
            dyntype.dyn_value_t,
        ]),
        dyntype.bool,
    );
    module.addFunctionImport(
        dyntype.dyntype_is_number,
        dyntype.module_name,
        dyntype.dyntype_is_number,
        binaryen.createType([dyntype.dyn_ctx_t, dyntype.dyn_value_t]),
        dyntype.bool,
    );
    module.addFunctionImport(
        dyntype.dyntype_to_number,
        dyntype.module_name,
        dyntype.dyntype_to_number,
        binaryen.createType([
            dyntype.dyn_ctx_t,
            dyntype.dyn_value_t,
            dyntype.pointer,
        ]),
        dyntype.int,
    );
    module.addFunctionImport(
        dyntype.dyntype_new_undefined,
        dyntype.module_name,
        dyntype.dyntype_new_undefined,
        dyntype.dyn_ctx_t,
        dyntype.dyn_value_t,
    );
    module.addFunctionImport(
        dyntype.dyntype_new_null,
        dyntype.module_name,
        dyntype.dyntype_new_null,
        dyntype.dyn_ctx_t,
        dyntype.dyn_value_t,
    );
    module.addFunctionImport(
        dyntype.dyntype_new_object,
        dyntype.module_name,
        dyntype.dyntype_new_object,
        dyntype.dyn_ctx_t,
        dyntype.dyn_value_t,
    );
    module.addFunctionImport(
        dyntype.dyntype_new_array,
        dyntype.module_name,
        dyntype.dyntype_new_array,
        dyntype.dyn_ctx_t,
        dyntype.dyn_value_t,
    );
    module.addFunctionImport(
        dyntype.dyntype_is_array,
        dyntype.module_name,
        dyntype.dyntype_is_array,
        binaryen.createType([dyntype.dyn_ctx_t, dyntype.dyn_value_t]),
        dyntype.bool,
    );
    module.addFunctionImport(
        dyntype.dyntype_set_property,
        dyntype.module_name,
        dyntype.dyntype_set_property,
        binaryen.createType([
            dyntype.dyn_ctx_t,
            dyntype.dyn_value_t,
            dyntype.cstring,
            dyntype.dyn_value_t,
        ]),
        dyntype.dyn_value_t,
    );
    module.addFunctionImport(
        dyntype.dyntype_get_property,
        dyntype.module_name,
        dyntype.dyntype_get_property,
        binaryen.createType([
            dyntype.dyn_ctx_t,
            dyntype.dyn_value_t,
            dyntype.cstring,
        ]),
        dyntype.dyn_value_t,
    );
    module.addFunctionImport(
        dyntype.dyntype_has_property,
        dyntype.module_name,
        dyntype.dyntype_has_property,
        binaryen.createType([
            dyntype.dyn_ctx_t,
            dyntype.dyn_value_t,
            dyntype.cstring,
        ]),
        dyntype.int,
    );
    module.addFunctionImport(
        dyntype.dyntype_new_extref,
        dyntype.module_name,
        dyntype.dyntype_new_extref,
        binaryen.createType([
            dyntype.dyn_ctx_t,
            dyntype.pointer,
            dyntype.external_ref_tag,
        ]),
        dyntype.dyn_value_t,
    );
    module.addFunctionImport(
        dyntype.dyntype_is_extref,
        dyntype.module_name,
        dyntype.dyntype_is_extref,
        binaryen.createType([dyntype.dyn_ctx_t, dyntype.dyn_value_t]),
        dyntype.bool,
    );
    module.addFunctionImport(
        dyntype.dyntype_to_extref,
        dyntype.module_name,
        dyntype.dyntype_to_extref,
        binaryen.createType([
            dyntype.dyn_ctx_t,
            dyntype.dyn_value_t,
            dyntype.pointer,
        ]),
        dyntype.int,
    );
    module.addFunctionImport(
        dyntype.dyntype_is_object,
        dyntype.module_name,
        dyntype.dyntype_is_object,
        binaryen.createType([dyntype.dyn_ctx_t, dyntype.dyn_value_t]),
        dyntype.bool,
    );
    module.addFunctionImport(
        dyntype.dyntype_get_prototype,
        dyntype.module_name,
        dyntype.dyntype_get_prototype,
        binaryen.createType([dyntype.dyn_ctx_t, dyntype.dyn_value_t]),
        dyntype.dyn_value_t,
    );
    module.addFunctionImport(
        dyntype.dyntype_set_prototype,
        dyntype.module_name,
        dyntype.dyntype_set_prototype,
        binaryen.createType([
            dyntype.dyn_ctx_t,
            dyntype.dyn_value_t,
            dyntype.dyn_value_t,
        ]),
        dyntype.int,
    );
}

export function importInfcLibAPI(module: binaryen.Module) {
    module.addFunctionImport(
        structdyn.StructDyn.struct_get_dyn_i32,
        structdyn.module_name,
        structdyn.StructDyn.struct_get_dyn_i32,
        binaryen.createType([binaryen.anyref, binaryen.i32]),
        binaryen.i32,
    );

    module.addFunctionImport(
        structdyn.StructDyn.struct_get_dyn_i64,
        structdyn.module_name,
        structdyn.StructDyn.struct_get_dyn_i64,
        binaryen.createType([binaryen.anyref, binaryen.i32]),
        binaryen.i64,
    );

    module.addFunctionImport(
        structdyn.StructDyn.struct_get_dyn_f32,
        structdyn.module_name,
        structdyn.StructDyn.struct_get_dyn_f32,
        binaryen.createType([binaryen.anyref, binaryen.i32]),
        binaryen.f32,
    );

    module.addFunctionImport(
        structdyn.StructDyn.struct_get_dyn_f64,
        structdyn.module_name,
        structdyn.StructDyn.struct_get_dyn_f64,
        binaryen.createType([binaryen.anyref, binaryen.i32]),
        binaryen.f64,
    );

    module.addFunctionImport(
        structdyn.StructDyn.struct_get_dyn_anyref,
        structdyn.module_name,
        structdyn.StructDyn.struct_get_dyn_anyref,
        binaryen.createType([binaryen.anyref, binaryen.i32]),
        binaryen.anyref,
    );

    module.addFunctionImport(
        structdyn.StructDyn.struct_set_dyn_i32,
        structdyn.module_name,
        structdyn.StructDyn.struct_set_dyn_i32,
        binaryen.createType([binaryen.anyref, binaryen.i32, binaryen.i32]),
        binaryen.none,
    );

    module.addFunctionImport(
        structdyn.StructDyn.struct_set_dyn_i64,
        structdyn.module_name,
        structdyn.StructDyn.struct_set_dyn_i64,
        binaryen.createType([binaryen.anyref, binaryen.i32, binaryen.i64]),
        binaryen.none,
    );

    module.addFunctionImport(
        structdyn.StructDyn.struct_set_dyn_f32,
        structdyn.module_name,
        structdyn.StructDyn.struct_set_dyn_f32,
        binaryen.createType([binaryen.anyref, binaryen.i32, binaryen.f32]),
        binaryen.none,
    );

    module.addFunctionImport(
        structdyn.StructDyn.struct_set_dyn_f64,
        structdyn.module_name,
        structdyn.StructDyn.struct_set_dyn_f64,
        binaryen.createType([binaryen.anyref, binaryen.i32, binaryen.f64]),
        binaryen.none,
    );

    module.addFunctionImport(
        structdyn.StructDyn.struct_set_dyn_anyref,
        structdyn.module_name,
        structdyn.StructDyn.struct_set_dyn_anyref,
        binaryen.createType([binaryen.anyref, binaryen.i32, binaryen.anyref]),
        binaryen.none,
    );
}

export function isDynFunc(funcName: string) {
    switch (funcName) {
        case dyntype.dyntype_context_init:
        case dyntype.dyntype_context_destroy:
        case dyntype.dyntype_new_number:
        case dyntype.dyntype_new_string:
        case dyntype.dyntype_new_boolean:
        case dyntype.dyntype_typeof:
        case dyntype.dyntype_type_eq:
        case dyntype.dyntype_is_number:
        case dyntype.dyntype_to_number:
        case dyntype.dyntype_new_undefined:
        case dyntype.dyntype_new_null:
        case dyntype.dyntype_new_object:
        case dyntype.dyntype_is_array:
        case dyntype.dyntype_new_array:
        case dyntype.dyntype_set_property:
        case dyntype.dyntype_get_property:
        case dyntype.dyntype_has_property:
        case dyntype.dyntype_new_extref:
        case dyntype.dyntype_is_extref:
        case dyntype.dyntype_to_extref:
        case dyntype.dyntype_is_object:
        case dyntype.dyntype_get_prototype:
        case dyntype.dyntype_set_prototype:
            return true;
        default:
            return false;
    }
}

export function getReturnTypeRef(funcName: string) {
    switch (funcName) {
        case dyntype.dyntype_context_init:
            return dyntype.dyn_ctx_t;
        case dyntype.dyntype_context_destroy:
            return dyntype.cvoid;
        case dyntype.dyntype_typeof:
            return dyntype.dyn_type_t;
        case dyntype.dyntype_to_number:
        case dyntype.dyntype_has_property:
        case dyntype.dyntype_to_extref:
        case dyntype.dyntype_set_prototype:
            return dyntype.int;
        case dyntype.dyntype_new_number:
        case dyntype.dyntype_new_string:
        case dyntype.dyntype_new_boolean:
        case dyntype.dyntype_new_undefined:
        case dyntype.dyntype_new_null:
        case dyntype.dyntype_new_object:
        case dyntype.dyntype_new_array:
        case dyntype.dyntype_set_property:
        case dyntype.dyntype_get_property:
        case dyntype.dyntype_new_extref:
        case dyntype.dyntype_get_prototype:
            return dyntype.dyn_value_t;
        case dyntype.dyntype_is_extref:
        case dyntype.dyntype_type_eq:
        case dyntype.dyntype_is_number:
        case dyntype.dyntype_is_object:
        case dyntype.dyntype_is_array:
            return dyntype.bool;
        default:
            return dyntype.cvoid;
    }
}

export function generateGlobalContext(module: binaryen.Module) {
    module.addGlobal(
        dyntype.dyntype_context,
        dyntype.dyn_ctx_t,
        true,
        module.i64.const(0, 0),
    );
}

export function generateInitDynContext(module: binaryen.Module) {
    const initDynContextStmt = module.global.set(
        dyntype.dyntype_context,
        module.call(dyntype.dyntype_context_init, [], binaryen.none),
    );

    return initDynContextStmt;
}

export function generateFreeDynContext(module: binaryen.Module) {
    const freeDynContextStmt = module.call(
        dyntype.dyntype_context_destroy,
        [module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t)],
        binaryen.none,
    );

    return freeDynContextStmt;
}

export function addItableFunc(module: binaryen.Module) {
    /* add find_index function from .wat */
    /* TODO: Have not found an effiective way to load import function from .wat yet */
    module.addFunctionImport(
        'strcmp',
        'env',
        'strcmp',
        binaryen.createType([binaryen.i32, binaryen.i32]),
        binaryen.i32,
    );
    const itableFilePath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        'interface-lib',
        'itable.wat',
    );
    const itableLib = fs.readFileSync(itableFilePath, 'utf-8');
    const watModule = binaryen.parseText(itableLib);
    addWatFuncs(watModule, 'find_index', module);
}

export function addDecoratorFunc(
    curModule: binaryen.Module,
    builtInFuncName: string,
) {
    const watFileDir = getWatFilesDir();
    const watFiles = fs.readdirSync(watFileDir);
    for (const file of watFiles) {
        const filePath = path.join(watFileDir, file);
        const libWat = fs.readFileSync(filePath, 'utf-8');
        const watModule = binaryen.parseText(libWat);
        const fileName = file.slice(undefined, -'.wat'.length);
        if (fileName === 'API') {
            addWatFuncs(watModule, builtInFuncName, curModule);
        }
    }
}

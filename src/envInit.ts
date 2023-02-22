import binaryen from 'binaryen';
import { dyntype } from '../lib/dyntype/utils.js';

export function importLibApi(module: binaryen.Module) {
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
            return dyntype.bool;
        default:
            return dyntype.cvoid;
    }
}

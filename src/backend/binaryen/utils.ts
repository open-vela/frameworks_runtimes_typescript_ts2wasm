import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import ts from 'typescript';
import { BuiltinNames } from '../../../lib/builtin/builtin_name.js';
import { UnimplementError } from '../../error.js';
import { FunctionKind, TSArray, TSClass, Type, TypeKind } from '../../type.js';
import { dyntype, structdyn } from './lib/dyntype/utils.js';
import { SemanticsKind } from '../../semantics/semantics_nodes.js';
import {
    ObjectType,
    PrimitiveType,
    TypeParameterType,
    ValueType,
    ValueTypeKind,
} from '../../semantics/value_types.js';
import { arrayToPtr, emptyStructType } from './glue/transform.js';
import {
    infcTypeInfo,
    stringTypeInfo,
    charArrayTypeInfo,
    stringArrayTypeInfo,
    stringArrayStructTypeInfo,
} from './glue/packType.js';
import { getBuiltInFuncName } from '../../utils.js';
import { SemanticsValue, SemanticsValueKind } from '../../semantics/value.js';
import { ObjectDescriptionType } from '../../semantics/runtime.js';

/** typeof an any type object */
export const enum DynType {
    DynUnknown,
    DynNull,
    DynUndefined,
    DynObject,
    DynBoolean,
    DynNumber,
    DynString,
    DynFunction,
    DynSymbol,
    DynBigInt,
    DynExtRefObj,
    DynExtRefFunc,
    DynExtRefInfc,
    DynExtRefArray,
}

export interface FlattenLoop {
    label: string;
    condition?: binaryen.ExpressionRef;
    statements: binaryen.ExpressionRef;
    incrementor?: binaryen.ExpressionRef;
}

export interface IfStatementInfo {
    condition: binaryen.ExpressionRef;
    ifTrue: binaryen.ExpressionRef;
    ifFalse: binaryen.ExpressionRef;
}

export interface TmpVarInfo {
    index: number;
    type: ValueType;
}

export enum ItableFlag {
    FIELD = 0,
    METHOD,
    GETTER,
    SETTER,
}

export namespace UtilFuncs {
    export function getFuncName(
        moduleName: string,
        funcName: string,
        delimiter = '|',
    ) {
        return moduleName.concat(delimiter).concat(funcName);
    }

    export function getLastElemOfBuiltinName(builtinName: string) {
        const levelNames = builtinName.split(BuiltinNames.moduleDelimiter);
        return levelNames[levelNames.length - 1];
    }

    export function addWatFuncs(
        watModule: binaryen.Module,
        funcName: string,
        curModule: binaryen.Module,
    ) {
        const funcRef = watModule.getFunction(funcName);
        const funcInfo = binaryen.getFunctionInfo(funcRef);
        curModule.addFunction(
            funcInfo.name,
            funcInfo.params,
            funcInfo.results,
            funcInfo.vars,
            curModule.copyExpression(funcInfo.body),
        );
    }

    export function getClassNameByTypeKind(typeKind: TypeKind): string {
        switch (typeKind) {
            case TypeKind.BOOLEAN:
                return BuiltinNames.BOOLEAN;
            case TypeKind.NUMBER:
                return BuiltinNames.NUMBER;
            case TypeKind.FUNCTION:
                return BuiltinNames.FUNCTION;
            case TypeKind.STRING:
                return BuiltinNames.STRING;
            case TypeKind.ARRAY:
                return BuiltinNames.ARRAY;
            default:
                throw new UnimplementError(
                    'unimplement type class: ${typeKind}',
                );
        }
    }
}

export namespace FunctionalFuncs {
    /* We need to get the dyntype context again and again, so we cache it
        here and don't call module.global.get every time */

    let dyntypeContextRef: binaryen.ExpressionRef | undefined;

    export function resetDynContextRef() {
        dyntypeContextRef = undefined;
    }

    export function getDynContextRef(module: binaryen.Module) {
        if (!dyntypeContextRef) {
            /* module.global.get will cause memory leak issue,
                so we use C-API instead */
            dyntypeContextRef = binaryenCAPI._BinaryenGlobalGet(
                module.ptr,
                getCString(dyntype.dyntype_context),
                dyntype.dyn_ctx_t,
            );
        }

        return dyntypeContextRef;
    }

    export function flattenLoopStatement(
        module: binaryen.Module,
        loopStatementInfo: FlattenLoop,
        kind: SemanticsKind,
    ): binaryen.ExpressionRef {
        const condition = loopStatementInfo.condition || module.i32.const(1);
        const ifStatementInfo: IfStatementInfo = {
            condition: condition,
            ifTrue: binaryen.none,
            ifFalse: binaryen.none,
        };
        if (kind !== SemanticsKind.DOWHILE) {
            const ifTrueBlockArray: binaryen.ExpressionRef[] = [];
            if (loopStatementInfo.statements !== binaryen.none) {
                ifTrueBlockArray.push(loopStatementInfo.statements);
            }
            if (kind === SemanticsKind.FOR && loopStatementInfo.incrementor) {
                ifTrueBlockArray.push(
                    <binaryen.ExpressionRef>loopStatementInfo.incrementor,
                );
            }
            ifTrueBlockArray.push(module.br(loopStatementInfo.label));
            const ifTrueBlock = module.block(null, ifTrueBlockArray);
            ifStatementInfo.ifTrue = ifTrueBlock;
            return module.if(ifStatementInfo.condition, ifStatementInfo.ifTrue);
        } else {
            ifStatementInfo.ifTrue = module.br(loopStatementInfo.label);
            const blockArray: binaryen.ExpressionRef[] = [];
            if (loopStatementInfo.statements !== binaryen.none) {
                blockArray.push(loopStatementInfo.statements);
            }
            const ifExpression = module.if(
                ifStatementInfo.condition,
                ifStatementInfo.ifTrue,
            );
            blockArray.push(ifExpression);
            return module.block(null, blockArray);
        }
    }

    export function getVarDefaultValue(
        module: binaryen.Module,
        typeKind: ValueTypeKind,
        defaultValue?: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        switch (typeKind) {
            case ValueTypeKind.NUMBER:
                // case ValueTypeKind.WASM_F64:
                return defaultValue ? defaultValue : module.f64.const(0);
            case ValueTypeKind.BOOLEAN:
                // case ValueTypeKind.WASM_I32:
                return defaultValue ? defaultValue : module.i32.const(0);
            // case ValueTypeKind.WASM_F32:
            //     return module.f32.const(0);
            // case ValueTypeKind.WASM_I64:
            //     return module.i64.const(0, 0);
            default:
                return binaryenCAPI._BinaryenRefNull(
                    module.ptr,
                    binaryenCAPI._BinaryenTypeStructref(),
                );
        }
    }

    export function generateStringRef(module: binaryen.Module, value: string) {
        const valueLen = value.length;
        let strRelLen = valueLen;
        const charArray = [];
        for (let i = 0; i < valueLen; i++) {
            const codePoint = value.codePointAt(i)!;
            if (codePoint > 0xffff) {
                i++;
                strRelLen--;
            }
            charArray.push(module.i32.const(codePoint));
        }
        const valueContent = binaryenCAPI._BinaryenArrayNewFixed(
            module.ptr,
            charArrayTypeInfo.heapTypeRef,
            arrayToPtr(charArray).ptr,
            strRelLen,
        );
        const wasmStringValue = binaryenCAPI._BinaryenStructNew(
            module.ptr,
            arrayToPtr([module.i32.const(0), valueContent]).ptr,
            2,
            stringTypeInfo.heapTypeRef,
        );
        return wasmStringValue;
    }

    export function generateDynNumber(
        module: binaryen.Module,
        dynValue: binaryen.ExpressionRef,
    ) {
        return module.call(
            dyntype.dyntype_new_number,
            [getDynContextRef(module), dynValue],
            dyntype.dyn_value_t,
        );
    }

    export function generateDynBoolean(
        module: binaryen.Module,
        dynValue: binaryen.ExpressionRef,
    ) {
        return module.call(
            dyntype.dyntype_new_boolean,
            [getDynContextRef(module), dynValue],
            dyntype.dyn_value_t,
        );
    }

    export function generateDynString(
        module: binaryen.Module,
        dynValue: binaryen.ExpressionRef,
    ) {
        return module.call(
            dyntype.dyntype_new_string,
            [getDynContextRef(module), dynValue],
            dyntype.dyn_value_t,
        );
    }

    export function generateDynNull(module: binaryen.Module) {
        return module.call(
            dyntype.dyntype_new_null,
            [getDynContextRef(module)],
            dyntype.dyn_value_t,
        );
    }

    export function generateDynUndefined(module: binaryen.Module) {
        return module.call(
            dyntype.dyntype_new_undefined,
            [getDynContextRef(module)],
            dyntype.dyn_value_t,
        );
    }

    export function generateDynArray(module: binaryen.Module) {
        return module.call(
            dyntype.dyntype_new_array,
            [getDynContextRef(module)],
            dyntype.dyn_value_t,
        );
    }

    export function generateDynObj(module: binaryen.Module) {
        return module.call(
            dyntype.dyntype_new_object,
            [getDynContextRef(module)],
            dyntype.dyn_value_t,
        );
    }

    export function setDynObjProp(
        module: binaryen.Module,
        objValueRef: binaryen.ExpressionRef,
        propNameRef: binaryen.ExpressionRef,
        propValueRef: binaryen.ExpressionRef,
    ) {
        return module.call(
            dyntype.dyntype_set_property,
            [getDynContextRef(module), objValueRef, propNameRef, propValueRef],
            dyntype.int,
        );
    }

    export function getDynObjProp(
        module: binaryen.Module,
        objValueRef: binaryen.ExpressionRef,
        propNameRef: binaryen.ExpressionRef,
    ) {
        return module.call(
            dyntype.dyntype_get_property,
            [getDynContextRef(module), objValueRef, propNameRef],
            dyntype.dyn_value_t,
        );
    }

    export function generateDynExtref(
        module: binaryen.Module,
        dynValue: binaryen.ExpressionRef,
        extrefTypeKind: ValueTypeKind,
    ) {
        // table type is anyref, no need to cast
        const dynFuncName: string = getBuiltInFuncName(
            BuiltinNames.newExternRef,
        );
        let extObjKind: dyntype.ExtObjKind = 0;
        switch (extrefTypeKind) {
            case ValueTypeKind.OBJECT: {
                extObjKind = dyntype.ExtObjKind.ExtObj;
                break;
            }
            case ValueTypeKind.FUNCTION: {
                extObjKind = dyntype.ExtObjKind.ExtFunc;
                break;
            }
            case ValueTypeKind.INTERFACE: {
                extObjKind = dyntype.ExtObjKind.ExtInfc;
                break;
            }
            case ValueTypeKind.ARRAY: {
                extObjKind = dyntype.ExtObjKind.ExtArray;
                break;
            }
            default: {
                throw Error(
                    `unexpected type kind when boxing to external reference, type kind is ${extrefTypeKind}`,
                );
            }
        }
        /** call newExtRef */
        const newExternRefCall = module.call(
            dynFuncName,
            [
                module.global.get(dyntype.dyntype_context, dyntype.dyn_ctx_t),
                module.i32.const(extObjKind),
                dynValue,
            ],
            binaryen.anyref,
        );
        return newExternRefCall;
    }

    export function generateCondition(
        module: binaryen.Module,
        exprRef: binaryen.ExpressionRef,
    ) {
        const type = binaryen.getExpressionType(exprRef);
        switch (type) {
            case binaryen.i32:
                return exprRef;
            case binaryen.f64:
                return module.f64.ne(exprRef, module.f64.const(0));
            default:
                return module.i32.eqz(
                    binaryenCAPI._BinaryenRefIsNull(module.ptr, exprRef),
                );
        }
    }

    export function generateCondition2(
        module: binaryen.Module,
        exprRef: binaryen.ExpressionRef,
        srckind: ValueTypeKind,
    ) {
        const type = binaryen.getExpressionType(exprRef);
        let res: binaryen.ExpressionRef;

        if (binaryen.getExpressionType(exprRef) === binaryen.i32) {
            /* Sometimes the value has already been casted,
                no need to cast again */
            return exprRef;
        }

        if (srckind === ValueTypeKind.BOOLEAN) {
            res = exprRef;
        } else if (srckind === ValueTypeKind.NUMBER) {
            const n0 = module.f64.ne(exprRef, module.f64.const(0));
            const nNaN = module.f64.eq(exprRef, exprRef);
            res = module.i32.and(n0, nNaN);
        } else if (
            srckind === ValueTypeKind.ANY ||
            srckind === ValueTypeKind.UNDEFINED
        ) {
            const targetFunc = getBuiltInFuncName(BuiltinNames.anyrefCond);
            res = module.call(targetFunc, [exprRef], binaryen.i32);
        } else if (srckind === ValueTypeKind.STRING) {
            // '' => false, '123' => true
            const array = binaryenCAPI._BinaryenStructGet(
                module.ptr,
                1,
                exprRef,
                binaryen.i32,
                false,
            );
            const len = binaryenCAPI._BinaryenArrayLen(module.ptr, array);
            res = module.i32.ne(len, module.i32.const(0));
        } else {
            res = module.i32.eqz(
                binaryenCAPI._BinaryenRefIsNull(module.ptr, exprRef),
            );
        }
        return res;
    }

    export function getInterfaceObj(
        module: binaryen.Module,
        expr: binaryen.ExpressionRef,
    ) {
        const obj = binaryenCAPI._BinaryenStructGet(
            module.ptr,
            InfcFieldIndex.DATA_INDEX,
            expr,
            infcTypeInfo.typeRef,
            false,
        );
        return binaryenCAPI._BinaryenRefCast(
            module.ptr,
            obj,
            emptyStructType.typeRef,
        );
    }

    export function unboxAny(
        module: binaryen.Module,
        anyExprRef: binaryen.ExpressionRef,
        typeKind: ValueTypeKind,
        wasmType: binaryen.Type,
    ) {
        switch (typeKind) {
            case ValueTypeKind.NUMBER:
            case ValueTypeKind.BOOLEAN:
            case ValueTypeKind.STRING:
            case ValueTypeKind.NULL:
            case ValueTypeKind.ANY:
            case ValueTypeKind.UNDEFINED:
                return unboxAnyToBase(module, anyExprRef, typeKind);
            case ValueTypeKind.INTERFACE:
            case ValueTypeKind.ARRAY:
            case ValueTypeKind.OBJECT:
            case ValueTypeKind.FUNCTION: {
                return unboxAnyToExtref(module, anyExprRef, wasmType);
            }
            default:
                throw Error(`unboxAny: error kind  ${typeKind}`);
        }
    }

    export function unboxAnyToBase(
        module: binaryen.Module,
        anyExprRef: binaryen.ExpressionRef,
        typeKind: ValueTypeKind,
    ) {
        let condFuncName = '';
        let cvtFuncName = '';
        let binaryenType: binaryen.Type;
        if (
            typeKind === ValueTypeKind.ANY ||
            typeKind === ValueTypeKind.UNION
        ) {
            return anyExprRef;
        }
        if (typeKind === ValueTypeKind.NULL) {
            return binaryenCAPI._BinaryenRefNull(
                module.ptr,
                binaryenCAPI._BinaryenTypeStructref(),
            );
        }
        if (typeKind === ValueTypeKind.UNDEFINED) {
            return generateDynUndefined(module);
        }
        switch (typeKind) {
            case ValueTypeKind.NUMBER: {
                condFuncName = dyntype.dyntype_is_number;
                cvtFuncName = dyntype.dyntype_to_number;
                binaryenType = binaryen.f64;
                break;
            }
            case ValueTypeKind.BOOLEAN: {
                condFuncName = dyntype.dyntype_is_bool;
                cvtFuncName = dyntype.dyntype_to_bool;
                binaryenType = binaryen.i32;
                /* Auto generate condition for boolean type */
                return generateCondition2(
                    module,
                    anyExprRef,
                    ValueTypeKind.ANY,
                );
            }
            case ValueTypeKind.STRING: {
                condFuncName = dyntype.dyntype_is_string;
                cvtFuncName = dyntype.dyntype_to_string;
                binaryenType = dyntype.dyn_value_t;
                break;
            }
            default: {
                throw Error(
                    `unboxing any type to static type, unsupported static type : ${typeKind}`,
                );
            }
        }
        const isBaseTypeRef = isBaseType(module, anyExprRef, condFuncName);

        // iff True
        const dynParam = [getDynContextRef(module), anyExprRef];

        let value = module.call(cvtFuncName, dynParam, binaryenType);

        if (typeKind === ValueTypeKind.STRING) {
            const wasmStringType = stringTypeInfo.typeRef;
            const string_value = value;
            value = binaryenCAPI._BinaryenRefCast(
                module.ptr,
                string_value,
                wasmStringType,
            );
        }

        // iff False
        const unreachableRef = module.unreachable();

        const blockStmt = module.if(isBaseTypeRef, value, unreachableRef);
        return module.block(null, [blockStmt], binaryenType);
    }

    export function isBaseType(
        module: binaryen.Module,
        anyExprRef: binaryen.ExpressionRef,
        condFuncName: string,
    ) {
        return module.call(
            condFuncName,
            [getDynContextRef(module), anyExprRef],
            dyntype.bool,
        );
    }

    /** whether a expression ref is wasm signature, iff true, return result type, otherwise undefined  */
    export function getSignatureResType(exprType: binaryen.Type) {
        const exprHeapType = binaryenCAPI._BinaryenTypeGetHeapType(exprType);
        const isSignature =
            binaryenCAPI._BinaryenHeapTypeIsSignature(exprHeapType);
        if (isSignature) {
            return binaryenCAPI._BinaryenSignatureTypeGetResults(exprHeapType);
        }
        return undefined;
    }

    export function convertTypeToI32(
        module: binaryen.Module,
        expression: binaryen.ExpressionRef,
        expressionType?: binaryen.Type,
    ): binaryen.ExpressionRef {
        const exprType = expressionType
            ? expressionType
            : binaryen.getExpressionType(expression);
        switch (exprType) {
            case binaryen.f64: {
                return module.i32.trunc_u_sat.f64(expression);
            }
            case binaryen.i32: {
                return expression;
            }
            default: {
                const signatureResType = getSignatureResType(exprType);
                if (signatureResType) {
                    return convertTypeToI32(
                        module,
                        expression,
                        signatureResType,
                    );
                }
            }
        }

        return binaryen.none;
    }

    export function convertTypeToI64(
        module: binaryen.Module,
        expression: binaryen.ExpressionRef,
        expressionType?: binaryen.Type,
    ): binaryen.ExpressionRef {
        const exprType = expressionType
            ? expressionType
            : binaryen.getExpressionType(expression);
        switch (expressionType) {
            case binaryen.f64: {
                return module.i64.trunc_u_sat.f64(expression);
            }
            case binaryen.i64: {
                return expression;
            }
            default: {
                const signatureResType = getSignatureResType(exprType);
                if (signatureResType) {
                    return convertTypeToI64(
                        module,
                        expression,
                        signatureResType,
                    );
                }
            }
        }
        return binaryen.none;
    }

    export function convertTypeToF64(
        module: binaryen.Module,
        expression: binaryen.ExpressionRef,
        expressionType?: binaryen.Type,
    ): binaryen.ExpressionRef {
        const exprType = expressionType
            ? expressionType
            : binaryen.getExpressionType(expression);
        switch (binaryen.getExpressionType(expression)) {
            case binaryen.i32: {
                return module.f64.convert_u.i32(expression);
            }
            case binaryen.i64: {
                return module.f64.convert_u.i64(expression);
            }
            default: {
                const signatureResType = getSignatureResType(exprType);
                if (signatureResType) {
                    return convertTypeToF64(
                        module,
                        expression,
                        signatureResType,
                    );
                }
            }
        }
        return binaryen.none;
    }

    export function unboxAnyToExtref(
        module: binaryen.Module,
        anyExprRef: binaryen.ExpressionRef,
        wasmType: binaryen.Type,
    ) {
        const isExternRef = module.call(
            dyntype.dyntype_is_extref,
            [getDynContextRef(module), anyExprRef],
            dyntype.bool,
        );
        const condition = module.i32.eq(isExternRef, module.i32.const(1));
        // const wasmType = this.wasmType.getWASMType(targetType);
        // iff True
        const tableIndex = module.call(
            dyntype.dyntype_to_extref,
            [getDynContextRef(module), anyExprRef],
            dyntype.int,
        );
        const externalRef = module.table.get(
            BuiltinNames.extrefTable,
            tableIndex,
            binaryen.anyref,
        );
        let value = binaryenCAPI._BinaryenRefCast(
            module.ptr,
            externalRef,
            wasmType,
        );
        if (wasmType !== infcTypeInfo.typeRef && wasmType !== binaryen.anyref) {
            /** try to get inteface
             * const i: I = new A()
             * const a: any = i;
             * const b = a as A
             */
            const infc = binaryenCAPI._BinaryenRefCast(
                module.ptr,
                externalRef,
                infcTypeInfo.typeRef,
            );
            const infcData = binaryenCAPI._BinaryenStructGet(
                module.ptr,
                InfcFieldIndex.DATA_INDEX,
                infc,
                infcTypeInfo.typeRef,
                false,
            );
            const infcValue = binaryenCAPI._BinaryenRefCast(
                module.ptr,
                infcData,
                wasmType,
            );
            value = module.if(
                module.i32.eq(
                    module.call(
                        dyntype.dyntype_typeof1,
                        [getDynContextRef(module), anyExprRef],
                        dyntype.int,
                    ),
                    module.i32.const(DynType.DynExtRefInfc),
                ),
                infcValue,
                value,
            );
        }
        // iff False
        const unreachableRef = module.unreachable();

        const blockStmt = module.if(condition, value, unreachableRef);
        return module.block(null, [blockStmt], wasmType);
    }

    export function boxToAny(
        module: binaryen.Module,
        valueRef: binaryen.ExpressionRef,
        value: SemanticsValue,
    ) {
        let valueTypeKind = value.type.kind;
        /* value.type may be specialized, we should update the specialized type kind */
        if (value.type instanceof TypeParameterType) {
            const specializedType = (<TypeParameterType>value.type)
                .specialTypeArgument;
            if (specializedType) {
                valueTypeKind = specializedType.kind;
            } else {
                valueTypeKind = ValueTypeKind.ANY;
            }
        }
        const semanticsValueKind = value.kind;
        let objDespType: ObjectDescriptionType | undefined = undefined;
        if (value.type instanceof ObjectType) {
            objDespType = value.type.meta.type;
        }
        switch (valueTypeKind) {
            case ValueTypeKind.NUMBER:
            case ValueTypeKind.INT:
            case ValueTypeKind.BOOLEAN:
            case ValueTypeKind.STRING:
            case ValueTypeKind.RAW_STRING:
            case ValueTypeKind.NULL:
            case ValueTypeKind.UNDEFINED:
            case ValueTypeKind.ANY:
            case ValueTypeKind.UNION:
                return boxBaseTypeToAny(module, valueRef, valueTypeKind);
            case ValueTypeKind.INTERFACE:
            case ValueTypeKind.ARRAY:
            case ValueTypeKind.OBJECT: {
                switch (semanticsValueKind) {
                    case SemanticsValueKind.NEW_LITERAL_ARRAY:
                    case SemanticsValueKind.NEW_LITERAL_OBJECT:
                        return boxLiteralToAny(module, valueTypeKind);
                    default: {
                        return boxNonLiteralToAny(
                            module,
                            valueRef,
                            valueTypeKind,
                            objDespType,
                        );
                    }
                }
            }
            case ValueTypeKind.FUNCTION: {
                return boxNonLiteralToAny(module, valueRef, valueTypeKind);
            }
            default:
                throw Error(`boxToAny: error kind  ${valueTypeKind}`);
        }
    }

    export function boxBaseTypeToAny(
        module: binaryen.Module,
        valueRef: binaryen.ExpressionRef,
        valueTypeKind: ValueTypeKind,
    ): binaryen.ExpressionRef {
        switch (valueTypeKind) {
            case ValueTypeKind.NUMBER:
                return generateDynNumber(module, valueRef);
            case ValueTypeKind.INT: {
                const floatNumber = module.f64.convert_u.i32(valueRef);
                return generateDynNumber(module, floatNumber);
            }
            case ValueTypeKind.BOOLEAN:
                return generateDynBoolean(module, valueRef);
            case ValueTypeKind.RAW_STRING:
            case ValueTypeKind.STRING: {
                return generateDynString(module, valueRef);
            }
            case ValueTypeKind.NULL:
                return generateDynNull(module);
            case ValueTypeKind.UNDEFINED:
                return generateDynUndefined(module);
            case ValueTypeKind.UNION:
            case ValueTypeKind.ANY:
                return valueRef;
            default:
                throw Error(`boxBaseTypeToAny: error kind ${valueTypeKind}`);
        }
    }

    export function boxLiteralToAny(
        module: binaryen.Module,
        valueTypeKind: ValueTypeKind,
    ): binaryen.ExpressionRef {
        switch (valueTypeKind) {
            case ValueTypeKind.OBJECT:
                return generateDynObj(module);
            case ValueTypeKind.ARRAY:
                return generateDynArray(module);
            default:
                throw Error(`boxLiteralToAny: error kind ${valueTypeKind}`);
        }
    }

    export function boxNonLiteralToAny(
        module: binaryen.Module,
        valueRef: binaryen.ExpressionRef,
        valueTypeKind: ValueTypeKind,
        objDespType?: ObjectDescriptionType,
    ): binaryen.ExpressionRef {
        switch (valueTypeKind) {
            case ValueTypeKind.NUMBER:
            case ValueTypeKind.BOOLEAN:
            case ValueTypeKind.STRING:
            case ValueTypeKind.NULL:
                return boxBaseTypeToAny(module, valueRef, valueTypeKind);
            case ValueTypeKind.ANY:
                return valueRef;

            case ValueTypeKind.INTERFACE:
            case ValueTypeKind.ARRAY:
            case ValueTypeKind.OBJECT:
            case ValueTypeKind.FUNCTION: {
                let kind = valueTypeKind;
                if (objDespType === ObjectDescriptionType.INTERFACE) {
                    kind = ValueTypeKind.INTERFACE;
                }
                return generateDynExtref(module, valueRef, kind);
            }
            default:
                throw Error(`boxNonLiteralToAny: error kind  ${valueTypeKind}`);
        }
    }

    export function operateF64F64(
        module: binaryen.Module,
        leftValueRef: binaryen.ExpressionRef,
        rightValueRef: binaryen.ExpressionRef,
        opKind: ts.SyntaxKind,
    ) {
        switch (opKind) {
            case ts.SyntaxKind.PlusToken: {
                return module.f64.add(leftValueRef, rightValueRef);
            }
            case ts.SyntaxKind.MinusToken: {
                return module.f64.sub(leftValueRef, rightValueRef);
            }
            case ts.SyntaxKind.AsteriskToken: {
                return module.f64.mul(leftValueRef, rightValueRef);
            }
            case ts.SyntaxKind.SlashToken: {
                return module.f64.div(leftValueRef, rightValueRef);
            }
            case ts.SyntaxKind.GreaterThanToken: {
                return module.f64.gt(leftValueRef, rightValueRef);
            }
            case ts.SyntaxKind.GreaterThanEqualsToken: {
                return module.f64.ge(leftValueRef, rightValueRef);
            }
            case ts.SyntaxKind.LessThanToken: {
                return module.f64.lt(leftValueRef, rightValueRef);
            }
            case ts.SyntaxKind.LessThanEqualsToken: {
                return module.f64.le(leftValueRef, rightValueRef);
            }
            case ts.SyntaxKind.LessThanLessThanToken: {
                return convertTypeToF64(
                    module,
                    module.i64.shl(
                        convertTypeToI64(module, leftValueRef, binaryen.f64),
                        convertTypeToI64(module, rightValueRef, binaryen.f64),
                    ),
                    binaryen.i64,
                );
            }
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsEqualsToken: {
                return module.f64.eq(leftValueRef, rightValueRef);
            }
            case ts.SyntaxKind.ExclamationEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
                return module.f64.ne(leftValueRef, rightValueRef);
            }
            case ts.SyntaxKind.AmpersandAmpersandToken: {
                return module.select(
                    convertTypeToI32(module, leftValueRef, binaryen.f64),
                    rightValueRef,
                    leftValueRef,
                    binaryen.f64,
                );
            }
            case ts.SyntaxKind.BarBarToken: {
                return module.select(
                    convertTypeToI32(module, leftValueRef, binaryen.f64),
                    leftValueRef,
                    rightValueRef,
                    binaryen.f64,
                );
            }
            case ts.SyntaxKind.AmpersandToken: {
                return convertTypeToF64(
                    module,
                    module.i64.and(
                        convertTypeToI64(module, leftValueRef, binaryen.f64),
                        convertTypeToI64(module, rightValueRef, binaryen.f64),
                    ),
                    binaryen.i64,
                );
            }
            case ts.SyntaxKind.BarToken: {
                return convertTypeToF64(
                    module,
                    module.i64.or(
                        convertTypeToI64(module, leftValueRef, binaryen.f64),
                        convertTypeToI64(module, rightValueRef, binaryen.f64),
                    ),
                    binaryen.i64,
                );
            }
            default:
                throw new Error(`operateF64F64: ${opKind}`);
        }
    }

    export function operateStringString(
        module: binaryen.Module,
        leftValueRef: binaryen.ExpressionRef,
        rightValueRef: binaryen.ExpressionRef,
        opKind: ts.SyntaxKind,
    ) {
        let res: binaryen.ExpressionRef;

        switch (opKind) {
            case ts.SyntaxKind.ExclamationEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsEqualsToken: {
                res = module.call(
                    UtilFuncs.getFuncName(
                        BuiltinNames.builtinModuleName,
                        BuiltinNames.stringEQFuncName,
                    ),
                    [leftValueRef, rightValueRef],
                    dyntype.bool,
                );

                if (
                    opKind === ts.SyntaxKind.ExclamationEqualsToken ||
                    opKind === ts.SyntaxKind.ExclamationEqualsEqualsToken
                ) {
                    res = module.i32.eqz(res);
                }

                break;
            }
            case ts.SyntaxKind.PlusToken: {
                const statementArray: binaryen.ExpressionRef[] = [];
                const arrayValue = binaryenCAPI._BinaryenArrayNewFixed(
                    module.ptr,
                    stringArrayTypeInfo.heapTypeRef,
                    arrayToPtr([rightValueRef]).ptr,
                    1,
                );

                const arrayStruct = binaryenCAPI._BinaryenStructNew(
                    module.ptr,
                    arrayToPtr([arrayValue, module.i32.const(1)]).ptr,
                    2,
                    stringArrayStructTypeInfo.heapTypeRef,
                );

                statementArray.push(
                    module.call(
                        getBuiltInFuncName(BuiltinNames.stringConcatFuncName),
                        [
                            binaryenCAPI._BinaryenRefNull(
                                module.ptr,
                                emptyStructType.typeRef,
                            ),
                            leftValueRef,
                            arrayStruct,
                        ],
                        stringTypeInfo.typeRef,
                    ),
                );
                res = module.block(null, statementArray);
                break;
            }
            case ts.SyntaxKind.BarBarToken: {
                return module.select(
                    generateCondition2(
                        module,
                        leftValueRef,
                        ValueTypeKind.STRING,
                    ),
                    leftValueRef,
                    rightValueRef,
                    stringTypeInfo.typeRef,
                );
            }
            default:
                throw new Error(`operator doesn't support, ${opKind}`);
        }

        return res;
    }

    export function operateRefRef(
        module: binaryen.Module,
        leftExprRef: binaryen.ExpressionRef,
        leftExprType: ValueType,
        rightExprRef: binaryen.ExpressionRef,
        rightExprType: ValueType,
        operatorKind: ts.SyntaxKind,
    ) {
        if (leftExprType.kind === ValueTypeKind.INTERFACE) {
            leftExprRef = getInterfaceObj(module, leftExprRef);
        }
        if (rightExprType.kind === ValueTypeKind.INTERFACE) {
            rightExprRef = getInterfaceObj(module, rightExprRef);
        }
        switch (operatorKind) {
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsEqualsToken: {
                return binaryenCAPI._BinaryenRefEq(
                    module.ptr,
                    leftExprRef,
                    rightExprRef,
                );
            }
            default:
                throw new Error(`operator doesn't support, ${operatorKind}`);
        }
    }

    export function operateF64I32(
        module: binaryen.Module,
        leftValueRef: binaryen.ExpressionRef,
        rightValueRef: binaryen.ExpressionRef,
        opKind: ts.SyntaxKind,
    ) {
        switch (opKind) {
            case ts.SyntaxKind.AmpersandAmpersandToken: {
                return module.select(
                    convertTypeToI32(module, leftValueRef, binaryen.f64),
                    rightValueRef,
                    convertTypeToI32(module, leftValueRef, binaryen.f64),
                    binaryen.i32,
                );
            }
            case ts.SyntaxKind.BarBarToken: {
                return module.select(
                    convertTypeToI32(module, leftValueRef, binaryen.f64),
                    leftValueRef,
                    convertTypeToF64(module, rightValueRef, binaryen.i32),
                    binaryen.f64,
                );
            }
            default:
                throw new Error(`operator doesn't support, ${opKind}`);
        }
    }

    export function operateI32F64(
        module: binaryen.Module,
        leftValueRef: binaryen.ExpressionRef,
        rightValueRef: binaryen.ExpressionRef,
        opKind: ts.SyntaxKind,
    ) {
        switch (opKind) {
            case ts.SyntaxKind.AmpersandAmpersandToken: {
                const condition = Boolean(module.i32.eqz(leftValueRef));
                if (condition) {
                    return module.select(
                        leftValueRef,
                        convertTypeToI32(module, rightValueRef, binaryen.f64),
                        leftValueRef,
                        binaryen.i32,
                    );
                } else {
                    return rightValueRef;
                }
            }
            case ts.SyntaxKind.BarBarToken: {
                // if left is false, then condition is true
                const condition = Boolean(module.i32.eqz(leftValueRef));
                if (condition) {
                    return rightValueRef;
                } else {
                    return module.select(
                        leftValueRef,
                        convertTypeToF64(module, leftValueRef, binaryen.i32),
                        rightValueRef,
                        binaryen.f64,
                    );
                }
            }
            default:
                throw new Error(`operator doesn't support, ${opKind}`);
        }
    }

    export function operateI32I32(
        module: binaryen.Module,
        leftValueRef: binaryen.ExpressionRef,
        rightValueRef: binaryen.ExpressionRef,
        opKind: ts.SyntaxKind,
    ) {
        switch (opKind) {
            case ts.SyntaxKind.AmpersandAmpersandToken: {
                return module.select(
                    leftValueRef,
                    rightValueRef,
                    leftValueRef,
                    binaryen.i32,
                );
            }
            case ts.SyntaxKind.BarBarToken: {
                return module.select(
                    leftValueRef,
                    leftValueRef,
                    rightValueRef,
                    binaryen.i32,
                );
            }
            default:
                throw new Error(`operator doesn't support, ${opKind}`);
        }
    }

    export function treatAsAny(typeKind: ValueTypeKind) {
        if (
            typeKind === ValueTypeKind.ANY ||
            typeKind === ValueTypeKind.UNION
        ) {
            return true;
        }

        return false;
    }

    export function operateAnyAny(
        module: binaryen.Module,
        leftValueRef: binaryen.ExpressionRef,
        rightValueRef: binaryen.ExpressionRef,
        opKind: ts.SyntaxKind,
    ) {
        // TODO: not support ref type cmp
        let res: binaryen.ExpressionRef;
        switch (opKind) {
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
            case ts.SyntaxKind.LessThanEqualsToken:
            case ts.SyntaxKind.LessThanToken:
            case ts.SyntaxKind.GreaterThanEqualsToken:
            case ts.SyntaxKind.GreaterThanToken:
            case ts.SyntaxKind.ExclamationEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
                res = module.call(
                    dyntype.dyntype_cmp,
                    [
                        getDynContextRef(module),
                        leftValueRef,
                        rightValueRef,
                        module.i32.const(opKind),
                    ],
                    binaryen.i32,
                );
                break;
            }
            default: {
                res = operateStaticToDyn(
                    module,
                    leftValueRef,
                    rightValueRef,
                    opKind,
                );

                /** iff not compare or plus token, tsc will auto convert to number */
                if (
                    !(
                        opKind >= ts.SyntaxKind.LessThanToken &&
                        opKind <= ts.SyntaxKind.PlusToken
                    )
                ) {
                    res = unboxAnyToBase(module, res, ValueTypeKind.NUMBER);
                }
                break;
            }
        }
        return res;
    }

    export function operateStaticNullUndefined(
        module: binaryen.Module,
        leftValueType: ValueType,
        leftValueRef: binaryen.ExpressionRef,
        rightTypekind: ValueTypeKind,
        opKind: ts.SyntaxKind,
    ) {
        let res: binaryen.ExpressionRef;
        const isNotEqToken =
            opKind === ts.SyntaxKind.ExclamationEqualsToken ||
            opKind === ts.SyntaxKind.ExclamationEqualsEqualsToken
                ? true
                : false;
        if (leftValueType.kind === rightTypekind) {
            res = isNotEqToken ? 0 : 1;
        } else {
            res = isNotEqToken ? 1 : 0;
        }
        res = module.i32.const(res);
        // let xx: A | null === null;
        // xx === null
        if (
            !(leftValueType instanceof PrimitiveType) &&
            rightTypekind === ValueTypeKind.NULL
        ) {
            res = module.ref.is_null(leftValueRef);
            if (isNotEqToken) {
                res = module.i32.eqz(res);
            }
        }
        return res;
    }

    export function operatorAnyStatic(
        module: binaryen.Module,
        leftValueRef: binaryen.ExpressionRef,
        rightValueRef: binaryen.ExpressionRef,
        rightValueType: ValueType,
        opKind: ts.SyntaxKind,
    ) {
        let res: binaryen.ExpressionRef;
        const dynCtx = module.global.get(
            dyntype.dyntype_context,
            dyntype.dyn_ctx_t,
        );
        switch (opKind) {
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
                if (rightValueType.kind === ValueTypeKind.NULL) {
                    res = module.call(
                        dyntype.dyntype_is_null,
                        [dynCtx, leftValueRef],
                        binaryen.i32,
                    );
                    // TODO: ref.null need table.get support in native API
                } else if (rightValueType.kind === ValueTypeKind.UNDEFINED) {
                    res = module.call(
                        dyntype.dyntype_is_undefined,
                        [dynCtx, leftValueRef],
                        binaryen.i32,
                    );
                } else if (rightValueType.kind === ValueTypeKind.NUMBER) {
                    res = operateF64F64ToDyn(
                        module,
                        leftValueRef,
                        rightValueRef,
                        opKind,
                        true,
                    );
                } else if (rightValueType.kind === ValueTypeKind.STRING) {
                    res = operateStrStrToDyn(
                        module,
                        leftValueRef,
                        rightValueRef,
                        opKind,
                        true,
                    );
                } else {
                    throw new Error(
                        `operand type doesn't support on any static operation, static type is ${rightValueType}`,
                    );
                }
                if (
                    opKind === ts.SyntaxKind.ExclamationEqualsToken ||
                    opKind === ts.SyntaxKind.ExclamationEqualsEqualsToken
                ) {
                    res = module.i32.eqz(res);
                }
                break;
            }
            default:
                if (rightValueType.kind === ValueTypeKind.NUMBER) {
                    res = operateF64F64ToDyn(
                        module,
                        leftValueRef,
                        rightValueRef,
                        opKind,
                        true,
                    );
                } else if (rightValueType.kind === ValueTypeKind.STRING) {
                    res = operateStrStrToDyn(
                        module,
                        leftValueRef,
                        rightValueRef,
                        opKind,
                        true,
                    );
                } else {
                    throw new Error(
                        `operator doesn't support on any static operation, ${opKind}`,
                    );
                }
        }
        return res;
    }

    export function operateStaticToDyn(
        module: binaryen.Module,
        leftValueRef: binaryen.ExpressionRef,
        rightValueRef: binaryen.ExpressionRef,
        opKind: ts.SyntaxKind,
    ) {
        const dynTypeCtx = getDynContextRef(module);
        const typeEq = module.call(
            dyntype.dyntype_type_eq,
            [dynTypeCtx, leftValueRef, rightValueRef],
            binaryen.i32,
        );
        // const
        const ifFalse = module.unreachable();
        const ifNumber = module.call(
            dyntype.dyntype_is_number,
            [dynTypeCtx, leftValueRef],
            binaryen.i32,
        );
        const ifString = module.call(
            dyntype.dyntype_is_string,
            [dynTypeCtx, leftValueRef],
            binaryen.i32,
        );
        const ifStringTrue = operateStrStrToDyn(
            module,
            leftValueRef,
            rightValueRef,
            opKind,
        );
        const ifTypeEqTrue = module.if(
            ifNumber,
            operateF64F64ToDyn(module, leftValueRef, rightValueRef, opKind),
            module.if(ifString, ifStringTrue, ifFalse),
        );

        return module.if(typeEq, ifTypeEqTrue, ifFalse);
    }

    export function operateF64F64ToDyn(
        module: binaryen.Module,
        leftValueRef: binaryen.ExpressionRef,
        rightValueRef: binaryen.ExpressionRef,
        opKind: ts.SyntaxKind,
        isRightStatic = false,
    ) {
        const tmpLeftNumberRef = module.call(
            dyntype.dyntype_to_number,
            [getDynContextRef(module), leftValueRef],
            binaryen.f64,
        );
        const tmpRightNumberRef = isRightStatic
            ? rightValueRef
            : module.call(
                  dyntype.dyntype_to_number,
                  [getDynContextRef(module), rightValueRef],
                  binaryen.f64,
              );
        const operateNumber = operateF64F64(
            module,
            tmpLeftNumberRef,
            tmpRightNumberRef,
            opKind,
        );
        return generateDynNumber(module, operateNumber);
    }

    export function operateStrStrToDyn(
        module: binaryen.Module,
        leftValueRef: binaryen.ExpressionRef,
        rightValueRef: binaryen.ExpressionRef,
        opKind: ts.SyntaxKind,
        isRightStatic = false,
    ) {
        const tmpLeftStrRef = unboxAnyToBase(
            module,
            leftValueRef,
            ValueTypeKind.STRING,
        );
        const tmpRightStrRef = isRightStatic
            ? rightValueRef
            : unboxAnyToBase(module, rightValueRef, ValueTypeKind.STRING);
        // operate left expression and right expression
        const operateString = operateStringString(
            module,
            tmpLeftStrRef,
            tmpRightStrRef,
            opKind,
        );
        return generateDynString(module, operateString);
    }

    export function oprateF64F64ToDyn(
        module: binaryen.Module,
        leftNumberExpression: binaryen.ExpressionRef,
        rightNumberExpression: binaryen.ExpressionRef,
        operatorKind: ts.SyntaxKind,
    ) {
        // operate left expression and right expression
        const operateTotalNumber = operateF64F64(
            module,
            leftNumberExpression,
            rightNumberExpression,
            operatorKind,
        );
        // generate dynamic number
        if (
            operatorKind === ts.SyntaxKind.GreaterThanToken ||
            operatorKind === ts.SyntaxKind.GreaterThanEqualsToken ||
            operatorKind === ts.SyntaxKind.LessThanToken ||
            operatorKind === ts.SyntaxKind.LessThanEqualsToken ||
            operatorKind === ts.SyntaxKind.EqualsEqualsToken ||
            operatorKind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
            operatorKind === ts.SyntaxKind.ExclamationEqualsToken ||
            operatorKind === ts.SyntaxKind.ExclamationEqualsEqualsToken
        ) {
            return operateTotalNumber;
        }
        return generateDynNumber(module, operateTotalNumber);
    }

    export function getArrayRefLen(
        module: binaryen.Module,
        arrRef: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        const arrLenI32 = binaryenCAPI._BinaryenStructGet(
            module.ptr,
            1,
            arrRef,
            binaryen.getExpressionType(arrRef),
            false,
        );
        const arrLenF64 = convertTypeToF64(
            module,
            arrLenI32,
            binaryen.getExpressionType(arrLenI32),
        );
        return arrLenF64;
    }

    export function getStringRefLen(
        module: binaryen.Module,
        stringRef: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        const strArray = binaryenCAPI._BinaryenStructGet(
            module.ptr,
            1,
            stringRef,
            charArrayTypeInfo.typeRef,
            false,
        );
        const strLenI32 = binaryenCAPI._BinaryenArrayLen(module.ptr, strArray);
        const strLenF64 = convertTypeToF64(
            module,
            strLenI32,
            binaryen.getExpressionType(strLenI32),
        );
        return strLenF64;
    }

    export function getArrayElemByIdx(
        module: binaryen.Module,
        elemTypeRef: binaryen.Type,
        ownerRef: binaryen.ExpressionRef,
        ownerHeapTypeRef: binaryenCAPI.HeapTypeRef,
        idxRef: binaryen.ExpressionRef,
    ) {
        const arrayOriRef = binaryenCAPI._BinaryenStructGet(
            module.ptr,
            0,
            ownerRef,
            ownerHeapTypeRef,
            false,
        );
        return binaryenCAPI._BinaryenArrayGet(
            module.ptr,
            arrayOriRef,
            idxRef,
            elemTypeRef,
            false,
        );
    }

    export function getAnyElemByIdx(
        module: binaryen.Module,
        ownerRef: binaryen.ExpressionRef,
        idxRef: binaryen.ExpressionRef,
    ) {
        return module.call(
            dyntype.dyntype_get_elem,
            [getDynContextRef(module), ownerRef, idxRef],
            dyntype.dyn_value_t,
        );
    }
}

export const wasmStringMap = new Map<string, number>();
export function getCString(str: string) {
    if (wasmStringMap.has(str)) {
        return wasmStringMap.get(str) as number;
    }
    const wasmStr = binaryenCAPI._malloc(str.length + 1);
    let index = wasmStr;
    // consider UTF-8 only
    for (let i = 0; i < str.length; i++) {
        binaryenCAPI.__i32_store8(index++, str.codePointAt(i) as number);
    }
    binaryenCAPI.__i32_store8(index, 0);
    wasmStringMap.set(str, wasmStr);
    return wasmStr;
}

export function clearWasmStringMap() {
    wasmStringMap.clear();
}

/** Describe the meaning of each field index of the infc type  */
export const enum InfcFieldIndex {
    ITABLE_INDEX,
    TYPEID_INDEX,
    IMPLID_INDEX,
    DATA_INDEX,
}

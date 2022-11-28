import * as binaryenCAPI from './binaryen.js';

export const STRING_LENGTH_FUNC = 'lib-string-length';
export const STRING_CONCAT_FUNC = 'lib-string-concat';
export const STRING_SLICE_FUNC = 'lib-string-slice';

export interface ptrInfo {
    ptr: number;
    len: number;
}

export interface typeInfo {
    typeRef: binaryenCAPI.TypeRef;
    heapTypeRef: binaryenCAPI.HeapTypeRef;
}

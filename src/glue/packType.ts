import {
    charArrayTypeInformation,
    stringTypeInformation,
    numberArrayTypeInformation,
    stringArrayTypeInformation,
    boolArrayTypeInformation,
    anyArrayTypeInformation,
    objectStructTypeInformation,
    infcTypeInformation,
} from './transform.js';
import { typeInfo } from './utils.js';

export const charArrayTypeInfo: typeInfo = charArrayTypeInformation;
export const stringTypeInfo: typeInfo = stringTypeInformation;
export const numberArrayTypeInfo = numberArrayTypeInformation;
export const stringArrayTypeInfo = stringArrayTypeInformation;
export const boolArrayTypeInfo = boolArrayTypeInformation;
export const anyArrayTypeInfo = anyArrayTypeInformation;
export const objectStructTypeInfo = objectStructTypeInformation;
export const infcTypeInfo = infcTypeInformation;

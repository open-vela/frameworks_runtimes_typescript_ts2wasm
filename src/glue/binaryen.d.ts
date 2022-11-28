module 'binaryen';

export declare type bool = boolean;
export declare type i8 = number;
export declare type i16 = number;
export declare type i32 = number;
export declare type isize = number;
export declare type u8 = number;
export declare type u16 = number;
export declare type u32 = number;
export declare type usize = number;
export declare type f32 = number;
export declare type f64 = number;

type Ref = usize;

export type Index = u32;
export type ExpressionId = i32;
export type FeatureFlags = u32;
export type Op = i32;
export type ExternalKind = u32;
export type SideEffects = u32;
export type ExpressionRunnerFlags = u32;

export type StringRef = Ref;
export type Pointer<T> = Ref;
export type ArrayRef<T> = Ref;
export type TypeRef = Ref;
export type HeapTypeRef = Ref;
export type PackedType = u32;
export type ModuleRef = Ref;
export type LiteralRef = Ref;
export type ExpressionRef = Ref;
export type FunctionRef = Ref;
export type ImportRef = Ref;
export type ExportRef = Ref;
export type GlobalRef = Ref;
export type TagRef = Ref;
export type TableRef = Ref;
export type ElementSegmentRef = Ref;
export type RelooperRef = Ref;
export type RelooperBlockRef = Ref;
export type ExpressionRunnerRef = Ref;
export type BinaryenModuleAllocateAndWriteResultRef = Ref;
export type TypeBuilderRef = Ref;
export type TypeBuilderErrorReason = u32;
export type TypeSystem = u32;

export declare function _BinaryenTypeCreate(types: ArrayRef<TypeRef>, numTypes: u32): TypeRef;
export declare function _BinaryenTypeArity(type: TypeRef): u32;
export declare function _BinaryenTypeExpand(type: TypeRef, typesOut: ArrayRef<TypeRef>): void;
export declare function _BinaryenTypeGetHeapType(type: TypeRef): HeapTypeRef;
export declare function _BinaryenTypeFromHeapType(heapType: HeapTypeRef, nullable: bool): TypeRef;
export declare function _BinaryenTypeIsNullable(type: TypeRef): bool;

export declare function _BinaryenTypeInt32(): TypeRef;
export declare function _BinaryenTypeFuncref(): TypeRef;
export declare function _BinaryenTypeExternref(): TypeRef;
export declare function _BinaryenTypeAnyref(): TypeRef;
export declare function _BinaryenTypeEqref(): TypeRef;
export declare function _BinaryenTypeI31ref(): TypeRef;
export declare function _BinaryenTypeDataref(): TypeRef;
export declare function _BinaryenTypeArrayref(): TypeRef;
export declare function _BinaryenTypeStringref(): TypeRef;
export declare function _BinaryenTypeStringviewWTF8(): TypeRef;
export declare function _BinaryenTypeStringviewWTF16(): TypeRef;
export declare function _BinaryenTypeStringviewIter(): TypeRef;
export declare function _BinaryenTypeNullref(): TypeRef;
export declare function _BinaryenTypeNullExternref(): TypeRef;
export declare function _BinaryenTypeNullFuncref(): TypeRef;

export declare function _BinaryenPackedTypeNotPacked(): PackedType;
export declare function _BinaryenPackedTypeInt8(): PackedType;
export declare function _BinaryenPackedTypeInt16(): PackedType;

export declare function _BinaryenHeapTypeFunc(): HeapTypeRef;
export declare function _BinaryenHeapTypeExt(): HeapTypeRef;
export declare function _BinaryenHeapTypeAny(): HeapTypeRef;
export declare function _BinaryenHeapTypeEq(): HeapTypeRef;
export declare function _BinaryenHeapTypeI31(): HeapTypeRef;
export declare function _BinaryenHeapTypeData(): HeapTypeRef;
export declare function _BinaryenHeapTypeArray(): HeapTypeRef;
export declare function _BinaryenHeapTypeString(): HeapTypeRef;
export declare function _BinaryenHeapTypeStringviewWTF8(): HeapTypeRef;
export declare function _BinaryenHeapTypeStringviewWTF16(): HeapTypeRef;
export declare function _BinaryenHeapTypeStringviewIter(): HeapTypeRef;
export declare function _BinaryenHeapTypeNone(): HeapTypeRef;
export declare function _BinaryenHeapTypeNoext(): HeapTypeRef;
export declare function _BinaryenHeapTypeNofunc(): HeapTypeRef;

export declare function _BinaryenHeapTypeIsBottom(heapType: HeapTypeRef): bool;
export declare function _BinaryenHeapTypeGetBottom(heapType: HeapTypeRef): HeapTypeRef;
export declare function _BinaryenHeapTypeIsSubType(left: HeapTypeRef, right: HeapTypeRef): bool;
export declare function _BinaryenStructTypeGetNumFields(heapType: HeapTypeRef): Index;
export declare function _BinaryenStructTypeGetFieldType(heapType: HeapTypeRef, index: Index): TypeRef;
export declare function _BinaryenStructTypeGetFieldPackedType(heapType: HeapTypeRef, index: Index): PackedType;
export declare function _BinaryenStructTypeIsFieldMutable(heapType: HeapTypeRef, index: Index): bool;
export declare function _BinaryenArrayTypeGetElementType(heapType: HeapTypeRef): TypeRef;
export declare function _BinaryenArrayTypeGetElementPackedType(heapType: HeapTypeRef): PackedType;
export declare function _BinaryenArrayTypeIsElementMutable(heapType: HeapTypeRef): bool;
export declare function _BinaryenSignatureTypeGetParams(heapType: HeapTypeRef): TypeRef;
export declare function _BinaryenSignatureTypeGetResults(heapType: HeapTypeRef): TypeRef;

export declare function _BinaryenStructNew(module: ModuleRef, operands: ArrayRef<ExpressionRef>, numOperands: Index, type: HeapTypeRef): ExpressionRef;
export declare function _BinaryenStructNewGetNumOperands(expr: ExpressionRef): Index;
export declare function _BinaryenStructNewGetOperandAt(expr: ExpressionRef, index: Index): ExpressionRef;
export declare function _BinaryenStructNewSetOperandAt(expr: ExpressionRef, index: Index, operandExpr: ExpressionRef): void;
export declare function _BinaryenStructNewAppendOperand(expr: ExpressionRef, operandExpr: ExpressionRef): Index;
export declare function _BinaryenStructNewInsertOperandAt(expr: ExpressionRef, index: Index, operandExpr: ExpressionRef): void;
export declare function _BinaryenStructNewRemoveOperandAt(expr: ExpressionRef, index: Index): ExpressionRef;

export declare function _BinaryenStructGet(module: ModuleRef, index: Index, ref: ExpressionRef, type: TypeRef, signed: bool): ExpressionRef;
export declare function _BinaryenStructGetGetIndex(expr: ExpressionRef): Index;
export declare function _BinaryenStructGetSetIndex(expr: ExpressionRef, index: Index): void;
export declare function _BinaryenStructGetGetRef(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenStructGetSetRef(expr: ExpressionRef, refExpr: ExpressionRef): void;
export declare function _BinaryenStructGetIsSigned(expr: ExpressionRef): bool;
export declare function _BinaryenStructGetSetSigned(expr: ExpressionRef, signed: bool): void;

export declare function _BinaryenStructSet(module: ModuleRef, index: Index, ref: ExpressionRef, value: ExpressionRef): ExpressionRef;
export declare function _BinaryenStructSetGetIndex(expr: ExpressionRef): Index;
export declare function _BinaryenStructSetSetIndex(expr: ExpressionRef, index: Index): void;
export declare function _BinaryenStructSetGetRef(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenStructSetSetRef(expr: ExpressionRef, refExpr: ExpressionRef): void;
export declare function _BinaryenStructSetGetValue(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenStructSetSetValue(expr: ExpressionRef, valueExpr: ExpressionRef): void;

export declare function _BinaryenArrayNew(module: ModuleRef, type: HeapTypeRef, size: ExpressionRef, init: ExpressionRef): ExpressionRef;
export declare function _BinaryenArrayNewGetInit(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenArrayNewSetInit(expr: ExpressionRef, initExpr: ExpressionRef): void;
export declare function _BinaryenArrayNewGetSize(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenArrayNewSetSize(expr: ExpressionRef, sizeExpr: ExpressionRef): void;

export declare function _BinaryenArrayInit(module: ModuleRef, type: HeapTypeRef, values: ArrayRef<ExpressionRef>, numValues: Index): ExpressionRef;
export declare function _BinaryenArrayInitGetNumValues(expr: ExpressionRef): Index;
export declare function _BinaryenArrayInitGetValueAt(expr: ExpressionRef, index: Index): ExpressionRef;
export declare function _BinaryenArrayInitSetValueAt(expr: ExpressionRef, index: Index, valueExpr: ExpressionRef): void;
export declare function _BinaryenArrayInitAppendValue(expr: ExpressionRef, valueExpr: ExpressionRef): Index;
export declare function _BinaryenArrayInitInsertValueAt(expr: ExpressionRef, index: Index, valueExpr: ExpressionRef): void;
export declare function _BinaryenArrayInitRemoveValueAt(expr: ExpressionRef, index: Index): ExpressionRef;

export declare function _BinaryenArrayGet(module: ModuleRef, ref: ExpressionRef, index: ExpressionRef, type: TypeRef, signed: bool): ExpressionRef;
export declare function _BinaryenArrayGetGetRef(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenArrayGetSetRef(expr: ExpressionRef, refExpr: ExpressionRef): void;
export declare function _BinaryenArrayGetGetIndex(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenArrayGetSetIndex(expr: ExpressionRef, indexExpr: ExpressionRef): void;
export declare function _BinaryenArrayGetIsSigned(expr: ExpressionRef): bool;
export declare function _BinaryenArrayGetSetSigned(expr: ExpressionRef, signed: bool): void;

export declare function _BinaryenArraySet(module: ModuleRef, ref: ExpressionRef, index: ExpressionRef, value: ExpressionRef): ExpressionRef;
export declare function _BinaryenArraySetGetRef(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenArraySetSetRef(expr: ExpressionRef, refExpr: ExpressionRef): void;
export declare function _BinaryenArraySetGetIndex(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenArraySetSetIndex(expr: ExpressionRef, indexExpr: ExpressionRef): void;
export declare function _BinaryenArraySetGetValue(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenArraySetSetValue(expr: ExpressionRef, valueExpr: ExpressionRef): void;

export declare function _BinaryenArrayLen(module: ModuleRef, ref: ExpressionRef): ExpressionRef;
export declare function _BinaryenArrayLenGetRef(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenArrayLenSetRef(expr: ExpressionRef, refExpr: ExpressionRef): void;

export declare function _BinaryenArrayCopy(module: ModuleRef, destRef: ExpressionRef, destIndex: ExpressionRef, srcRef: ExpressionRef, srcIndex: ExpressionRef, length: ExpressionRef): ExpressionRef;
export declare function _BinaryenArrayCopyGetDestRef(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenArrayCopySetDestRef(expr: ExpressionRef, destRefExpr: ExpressionRef): void;
export declare function _BinaryenArrayCopyGetDestIndex(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenArrayCopySetDestIndex(expr: ExpressionRef, destIndexExpr: ExpressionRef): void;
export declare function _BinaryenArrayCopyGetSrcRef(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenArrayCopySetSrcRef(expr: ExpressionRef, srcRefExpr: ExpressionRef): void;
export declare function _BinaryenArrayCopyGetSrcIndex(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenArrayCopySetSrcIndex(expr: ExpressionRef, srcIndexExpr: ExpressionRef): void;
export declare function _BinaryenArrayCopyGetLength(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenArrayCopySetLength(expr: ExpressionRef, lengthExpr: ExpressionRef): void;

export declare function _TypeBuilderCreate(size: Index): TypeBuilderRef;
export declare function _TypeBuilderGrow(builder: TypeBuilderRef, count: Index): void;
export declare function _TypeBuilderGetSize(builder: TypeBuilderRef): Index;
export declare function _TypeBuilderSetBasicHeapType(builder: TypeBuilderRef, index: Index, basicHeapType: HeapTypeRef): void;
export declare function _TypeBuilderSetSignatureType(builder: TypeBuilderRef, index: Index, paramTypes: TypeRef, resultTypes: TypeRef): void;
export declare function _TypeBuilderSetStructType(builder: TypeBuilderRef, index: Index, fieldTypes: ArrayRef<TypeRef>, fieldPackedTypes: ArrayRef<PackedType>, fieldMutables: ArrayRef<bool>, numFields: i32): void;
export declare function _TypeBuilderSetArrayType(builder: TypeBuilderRef, index: Index, elementType: TypeRef, elementPackedTyype: PackedType, elementMutable: bool): void;
export declare function _TypeBuilderIsBasic(builder: TypeBuilderRef, index: Index): bool;
export declare function _TypeBuilderGetBasic(builder: TypeBuilderRef, index: Index): HeapTypeRef;
export declare function _TypeBuilderGetTempHeapType(builder: TypeBuilderRef, index: Index): HeapTypeRef;
export declare function _TypeBuilderGetTempTupleType(builder: TypeBuilderRef, types: ArrayRef<TypeRef>, numTypes: Index): TypeRef;
export declare function _TypeBuilderGetTempRefType(builder: TypeBuilderRef, heapType: HeapTypeRef, nullable: bool): TypeRef;
export declare function _TypeBuilderSetSubType(builder: TypeBuilderRef, index: Index, superType: HeapTypeRef): void;
export declare function _TypeBuilderCreateRecGroup(builder: TypeBuilderRef, index: Index, length: Index): void;
export declare function _TypeBuilderBuildAndDispose(builder: TypeBuilderRef, heapTypes: ArrayRef<HeapTypeRef>, errorIndex: Pointer<Index>, errorReason: Pointer<TypeBuilderErrorReason>): bool;
export declare function _BinaryenModuleSetTypeName(module: ModuleRef, heapType: HeapTypeRef, name: StringRef): void;
export declare function _BinaryenModuleSetFieldName(module: ModuleRef, heapType: HeapTypeRef, index: Index, name: StringRef): void;

export declare function _BinaryenRefEq(module: ModuleRef, leftExpr: ExpressionRef, rightExpr: ExpressionRef): ExpressionRef;
export declare function _BinaryenRefEqGetLeft(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenRefEqSetLeft(expr: ExpressionRef, leftExpr: ExpressionRef): void;
export declare function _BinaryenRefEqGetRight(expr: ExpressionRef): ExpressionRef;
export declare function _BinaryenRefEqSetRight(expr: ExpressionRef, rightExpr: ExpressionRef): void;

export declare function _malloc(size: usize): usize;
export declare function _free(ptr: usize): void;
export declare function __i32_store8(ptr: usize, value: number): void;
export declare function __i32_store16(ptr: usize, value: number): void;
export declare function __i32_store(ptr: usize, value: number): void;
export declare function __f32_store(ptr: usize, value: number): void;
export declare function __f64_store(ptr: usize, value: number): void;
export declare function __i32_load8_s(ptr: usize): i8;
export declare function __i32_load8_u(ptr: usize): u8;
export declare function __i32_load16_s(ptr: usize): i16;
export declare function __i32_load16_u(ptr: usize): u16;
export declare function __i32_load(ptr: usize): i32;
export declare function __f32_load(ptr: usize): f32;
export declare function __f64_load(ptr: usize): f64;

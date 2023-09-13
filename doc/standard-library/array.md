# Array API

The standard array APIs are implemented by `native`. Here we list the APIs supported by `Wasmnizer-ts`.

## API consistent with the standard library

+ [**`push(...items: T[]): number`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1313-L1317)

+ [**`join(separator?: string): string`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1330-L1334)

+ [**`reverse(): T[]`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1335-L1339)

+ [**`slice(start?: number, end?: number): T[]`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1345-L1354)

+ [**`unshift(...items: T[]): number`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1381-L1385)

+ [**`indexOf(searchElement: T, fromIndex?: number): number`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1386-L1391)

+ [**`lastIndexOf(searchElement: T, fromIndex?: number): number`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1392-L1397)

+ [**`reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1449-L1455)

+ [**`reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1462-L1468)

+ [**`fill(value: T, start?: number, end?: number): T[]`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es2015.core.d.ts#L25-L33)

+ [**`includes(searchElement: T, fromIndex?: number): boolean`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es2016.array.include.d.ts#L2-L7)

## API inconsistent with the standard library

+ [**`pop(): T`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1308-L1312)

    In `Wasmnizer-ts`, we will regard the union type `T | undefined` as any type, so we only define `T` as return type here.

+ [**`concat(...items: T[]): T[]`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1318-L1329)

    We simply set the `items`'s type to `T[]`.

+ [**`shift(): T`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1340-L1344)

    In `Wasmnizer-ts`, we will regard the union type `T | undefined` as any type, so we only define `T` as return type here.

+ [**`sort(compareFn: (a: T, b: T) => number): T[]`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1355-L1365)

    In `Wasmnizer-ts`, `this` represents class instance, so the return type is set to `T[]` not `this`.

+ [**`splice(start: number, deleteCount?: number, ...items: T[]): T[]`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1366-L1380)

    Combines two standard APIs: `splice(start: number, deleteCount?: number): T[];` and `splice(start: number, deleteCount: number, ...items: T[]): T[];`.

+ [**`every(predicate: (value: T, index: number, array: T[]) => boolean): boolean`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1407-L1415)

    We set the `predicate callback function`'s return type to boolean, and the second parameter `thisArg` in the standard library has been deleted.

+ [**`some(predicate: (value: T, index: number, array: T[]) => boolean): boolean`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1416-L1424)

    We set the `predicate callback function`'s return type to boolean, and the second parameter `thisArg` in the standard library has been deleted.

+ [**`forEach(callbackfn: (value: T, index: number, array: T[]) => void): void`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1425-L1430)

    The second parameter `thisArg` in the standard library has been deleted.

+ [**`map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[]`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1431-L1436)

    The second parameter `thisArg` in the standard library has been deleted.

+ [**`filter(predicate: (value: T, index: number, array: T[]) => boolean): T[]`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es5.d.ts#L1443-L1448)

    We set the `predicate callback function`'s return type to boolean, and the second parameter `thisArg` in the standard library has been deleted.

+ [**`find(predicate: (value: T, index: number, obj: T[]) => boolean): any`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es2015.core.d.ts#L2-L12)

    We set the `predicate callback function`'s return type to boolean, the second parameter `thisArg` in the standard library has been deleted, since `find` is always return `undefined`, so we set `any` type to represent `T | undefined`.

+ [**`findIndex(predicate: (value: T, index: number, obj: T[]) => boolean): number`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es2015.core.d.ts#L14-L23)

    We set the `predicate callback function`'s return type to boolean, and the second parameter `thisArg` in the standard library has been deleted.


+ [**`copyWithin(target: number, start: number, end?: number): T[]`**](https://github.com/microsoft/TypeScript/blob/eb374c28d6810e317b0c353d9b1330b0595458f4/src/lib/es2015.core.d.ts#L35-L44)

    In `Wasmnizer-ts`, `this` represents class instance, so the return type is set to `T[]` not `this`.

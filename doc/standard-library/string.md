# string API

The standard string APIs are implemented by `binaryen API`. Below are the string APIs supported by `Wasmnizer-ts`.

## API consistent with the standard library

+ **[`concat(...strings: string[]): string`](https://github.com/microsoft/TypeScript/blob/c532603633178c552b9747eef057784db2fc1e23/src/lib/es5.d.ts#L408C1-L412C42)**

+ **[`slice(start?: number, end?: number): string`](https://github.com/microsoft/TypeScript/blob/c532603633178c552b9747eef057784db2fc1e23/src/lib/es5.d.ts#L460C1-L466C49)**

+ **[`charAt(pos: number): string`](https://github.com/microsoft/TypeScript/blob/c532603633178c552b9747eef057784db2fc1e23/src/lib/es5.d.ts#L396C1-L400C33)**

+ **[`charCodeAt(index: number): number`](https://github.com/microsoft/TypeScript/blob/c532603633178c552b9747eef057784db2fc1e23/src/lib/es5.d.ts#L402C1-L406C39)**

+ **[`substring(start: number, end?: number): string`](https://github.com/microsoft/TypeScript/blob/c532603633178c552b9747eef057784db2fc1e23/src/lib/es5.d.ts#L475C1-L481C52)**

+ **[`trim(): string`](https://github.com/microsoft/TypeScript/blob/c532603633178c552b9747eef057784db2fc1e23/src/lib/es5.d.ts#L495C1-L496C20)**

+ **[`toLowerCase(): string`](https://github.com/microsoft/TypeScript/blob/c532603633178c552b9747eef057784db2fc1e23/src/lib/es5.d.ts#L483C1-L484C27)**

+ **[`toUpperCase(): string`](https://github.com/microsoft/TypeScript/blob/c532603633178c552b9747eef057784db2fc1e23/src/lib/es5.d.ts#L489C1-L490C27)**

## API inconsistent with the standard library

+ **`indexOf(searchString: string): number`**

    Searches for the first occurrence of a specified substring (`searchString`) within a string and returns the index at which it is found, otherwise, returns -1.

+ **`lastIndexOf(str: string): number`**

    Searches for the last occurrence of a specified substring (`str`) within a string and returns the index (position) at which it is found, otherwise, returns -1.

+ **`split(sep: string): string[]`**

    Splits a string into an array of substrings based on a specified separator (`sep`).

+ **`replace(from: string, to: string): string`**

    Replaces **the first** occurrence of a specified substring (`from`) within a string with another substring (`to`) and returns the resulting modified string.

+ **`match(pattern: string): string[]`**

    Searches for **the first** occurrence of a specified regular expression (`pattern`) within a string and returns an array containing the matched substring.

+ **`search(pattern: string): number`**

    Searches for a specified regular string (`pattern`) within a string and returns the index of the first occurrence of the matched substring or -1 if no match is found.

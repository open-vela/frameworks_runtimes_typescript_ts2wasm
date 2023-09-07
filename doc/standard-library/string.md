# string API

The standard string APIs are implemented by `binaryen API`. Below are the string APIs supported by `Wasmnizer-ts`.

+ **`concat(...strings: string[]): string`**

    Concatenates multiple strings together into a single string, and return the string.

+ **`slice(start?: number, end?: number): string`**

    Extracts a portion of a string, starting from the start index (inclusive) and ending at the end index (exclusive), and return the string.

+ **`charAt(pos: number): string`**

    Returns the character at a specified position (pos) within a string.

+ **`indexOf(searchString: string): number`**

    Searches for the first occurrence of a specified substring (`searchString`) within a string and returns the index at which it is found, otherwise, returns -1.

+ **`lastIndexOf(str: string): number`**

    Searches for the last occurrence of a specified substring (`str`) within a string and returns the index (position) at which it is found, otherwise, return -1.

+ **`charCodeAt(index: number): number`**

    Returns the Unicode value of the character at a specified position (`index`) within a string.

+ **`substring(start: number, end?: number): string`**

    Extracts a portion of a string, starting from the `start` index (inclusive) and ending at the `end`` index (exclusive).

+ **`trim(): string`**

    Removes leading and trailing whitespace from a string.

+ **`toLowerCase(): string`**

    Converts all the characters in a string to lowercase and returns the resulting string.

+ **`toUpperCase(): string`**

    Converts all the characters in a string to uppercase and returns the resulting string.

+ **`split(sep: string): string[]`**

    Splits a string into an array of substrings based on a specified separator (`sep`).

+ **`replace(from: string, to: string): string`**

    Replaces **the first** occurrences of a specified substring (`from`) within a string with another substring (`to`) and returns the resulting modified string.

+ **`match(pattern: string): string[]`**

    Searches for **the first** occurrences of a specified regular expression (`pattern``) within a string and returns an array containing the matched substring.

+ **`search(pattern: string): number`**

    Searches for a specified regular expression (`pattern`) within a string and returns the index of the first occurrence of the matched substring or -1 if no match is found.

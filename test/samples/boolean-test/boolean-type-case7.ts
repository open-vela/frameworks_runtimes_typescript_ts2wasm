export function booleanTestCase7(): number {
    const j9 = 123,
        j10 = 456;
    const i9 = j9 && j10; // not support const type, for its union type.
    return i9;
}

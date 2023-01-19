export function booleanTestCase8(): number {
    const j11 = 123,
        j12 = 456;
    let i10 = j11 > j12 ? 1 : 2; // not support const type, for its union type.
    return i10;
}

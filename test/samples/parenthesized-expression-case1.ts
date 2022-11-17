export function parenthesizedTest() {
    const a = 1;
    const b = 6;
    const c = b - a;
    const d = ((a + b) * c) / b;
    return d;
}

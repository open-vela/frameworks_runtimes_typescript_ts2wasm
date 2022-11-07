export function binaryExpressionTest() {
    let a = 10,
        b = 20;
    const condition = a || !b;
    if (condition) {
        return 1;
    }
    return 0;
}

// 1

export function switchCaseCase3(): number {
    // with default
    let i = 10;
    let j = 0;
    switch (i) {
        case 1: {
            j = 10;
            break;
        }
        case 11: {
            j = 11;
            break;
        }
        default: {
            j = 0;
            break;
        }
    }
    return j;
}

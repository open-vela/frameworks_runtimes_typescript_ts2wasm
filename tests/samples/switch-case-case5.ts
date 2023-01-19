export function switchCaseCase5(): number {
    // mutiple cases
    let i = 10;
    let j = 0;
    switch (i) {
        case 10:
        case 11: {
            j = 11;
            break;
        }
        default: {
            j = 12;
            break;
        }
    }
    return j;
}

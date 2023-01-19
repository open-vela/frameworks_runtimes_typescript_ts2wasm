export function switchCaseCase4(): number {
    // without default
    let i = 10;
    let j = 0;
    switch (i) {
        case 10: {
            j = 10;
            break;
        }
        case 11: {
            j = 11;
            break;
        }
    }
    return j;
}

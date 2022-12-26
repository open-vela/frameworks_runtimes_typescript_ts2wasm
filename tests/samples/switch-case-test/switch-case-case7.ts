export function switchCaseCase7(): number {
    // case witchout break
    let i = 10;
    let j = 0;
    switch (i) {
        case 10:
            j = 10;
        case 11:
            j = 11;
            break;
    }
    return j;
}

export function switchCaseCase10() {
    let i: number = 1;
    switch (i) {
        case 4: {
            i = 2;
            break;
        }
        case 2: {
            i = 3;
            break;
        }
        case 1: {
            j = 20;
            i = j;
            var j = 10;
            break;
        }
    }
    return i;
}
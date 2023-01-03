function scopeScannerCase7Func1(a: number) {
    let b = 2;
    switch (a) {
        case 1: {
            b++;
            break;
        }
        case 2: {
            b--;
            break;
        }
        default:
            a += 2;
    }
}

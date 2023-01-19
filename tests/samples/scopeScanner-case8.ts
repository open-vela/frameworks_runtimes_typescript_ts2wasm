function scopeScannerCase8Func1(a: number) {
    let b = 2;
    {
        const innerBlock = 1;
        if (a > b) {
            return 2;
        } else {
            for (let i = 0; i < a; i++) {
                b++;
            }
        }
    }
}

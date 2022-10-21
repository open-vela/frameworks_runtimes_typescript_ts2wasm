export function forTest(): number {
    let c = 100;
    for (let i = 1; i < 10; i++) {
        c++;
        for (let j = 1; j < 5; j++) {
            c++;
            if (c > 108) {
                break;
            }
        }
        break;
    }
    return c;
}

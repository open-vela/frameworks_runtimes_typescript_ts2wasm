export function blockTest() {
    let a: number;
    let b = 1;
    {
        let c = 9;
        a = 2;
        b = 1;
    }
    a = 8;
}

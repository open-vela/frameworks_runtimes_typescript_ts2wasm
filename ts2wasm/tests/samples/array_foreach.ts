export function array_foreach_number() {
    let arr: Array<number> = [123, 234, 456, 4, 453, 0, 456];
    let ret = arr.forEach((val, idx, arr) => {
        console.log(idx, ":", val);
    });
    console.log(ret); // undefine

}

export function array_foreach_string() {
    let arr: Array<string> = ["s123", "s234", "s456",
        "s4", "s453", "s0", "s456"];
    let ret = arr.forEach((val, idx, arr) => {
        console.log(idx, ":", val);
    });
    console.log(ret); // undefine
}

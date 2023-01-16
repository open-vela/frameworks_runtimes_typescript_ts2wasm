export function protoTest() {
    let prototypeObj: any = {
        height: 1,
    };
    let obj: any = { weight: 2 };
    obj.__proto__ = prototypeObj;
    return obj.height;
}

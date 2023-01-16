export function protoTest() {
    let prototypeObj: any = {
        height: 1,
    };
    let obj: any = { height: 2 };
    obj.__proto__ = prototypeObj;
    return obj.__proto__;
}

export class Array {
    @binaryen
    static isArray(x: any): boolean {
        return Array.isArray(x);
    }
}

function binaryen(target: any, propertyKey: string, descriptor: any) {
    // decorator logic here
}

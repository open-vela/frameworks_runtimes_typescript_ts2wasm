export class lib {
    @binaryen
    static string_length(x: string): number {
        return x.length;
    }

    @binaryen
    static string_slice(s: string, x: number, y: number): string {
        return s.slice(x, y);
    }

    @binaryen
    static string_concat(x: string, y: string): string {
        return x.concat(y);
    }
}

function binaryen(target: any, propertyKey: string, descriptor: any) {
    // decorator logic here
}

// There are some errors we must check

/**
 * error TS2588: Cannot assign to 'a' because it is a constant.
 const a = 1;
 a = 2;
 * 
 * 
 * error TS2322: Type 'number' is not assignable to type 'void'.
 function addNumber(a: number, b: number): void {
    const c = 1;
    const d = 5;
    return c + d;
 }
 * 
 * error TS7006: Parameter 'a' implicitly has an 'any' type.
 function addNumber(a, b: number): number {
    const c = 1;
    const d = 5;
    return c + d;
 }
 * error TS2391: Function implementation is missing or not immediately following the declaration.
  function addNumber(a: number, b: number): void

 * error TS1155: 'const' declarations must be initialized.
  const a;

 * error TS2300: Duplicate identifier 'a'.
   function addNumber(a = 1, b: number): number {
    const a = 2;
    return a + b;
 }

 * error TS2304: Cannot find name 'a'.
 function addNumber(): number {
    const e = 6;
    return a;
}
 * error TS2322: Type A is not assignable to type B.
 function addNumber(a: number): void {
    const e = 6;
    return a;
 }
 * error TS1109: Expression expected.
 if () {
     xxx
 } 

 * error TS2300: Duplicate identifier
 let a = 1;
 const a = 2;

 * error TS2356: An arithmetic operand must be of type 'any', 'number', 'bigint' or an enum type.
 let c: string = '0';
 c++;

 * error TS1109: Expression expected.
 while ()
 */

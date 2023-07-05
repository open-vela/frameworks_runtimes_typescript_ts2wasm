/*
 * Copyright (C) 2023 Xiaomi Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */
class Base {
  constructor() {
    console.log("constructor from Base");
  }
}

class A extends Base {
  x: number;

  constructor(x: number) {
    super()
    this.x = x;
    console.log("constructor from A");
  }
  
  log() {
    console.log('x: ', this.x);
  }
}

class B extends A {
  y: string;

  constructor(x: number, y: string) {
    super(x);
    this.y = y;
    console.log("constructor from B");
  }
  
  log() {
    console.log('y: ', this.y);
    super.log();
  }
}

export function test() {
  let b: B = new B(1, "hello");
  b.log();
}

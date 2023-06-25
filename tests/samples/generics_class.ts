/*
 * Copyright (C) 2023 Xiaomi Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

class MObject<T> {
    name: T;
    constructor(name: T) {
        this.name = name;
        console.log(name)
    }

    action<T>(say: T) {
        console.log(say)
    }
}
   
export function test() {
    let cat = new MObject('cat')
    cat.action('mimi')
    
    let robot = new MObject(12345)
    robot.action(54321)
}

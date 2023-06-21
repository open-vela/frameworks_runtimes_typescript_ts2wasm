/*
 * Copyright (C) 2023 Xiaomi Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import ts from 'typescript';

import {
    ValueType,
    ValueTypeKind,
    PredefinedTypeId,
} from '../../semantics/value_types.js';

import {
    GetPredefinedTypeById,
    GetPredefinedTypeByType,
} from './predefined_value_types.js';

import { IRModule } from '../../semantics/ir/irmodule.js';

export class CodeWriter {
    _prefix = '';
    _source = '';

    constructor(prefix = '') {
        this._prefix = prefix;
    }

    get source(): string {
        return this._source;
    }

    add(s: string) {
        if (s.length > 0) {
            this._source += this._prefix + s;
        }
        this._source += '\n';
    }

    shift() {
        this._prefix += '    ';
    }

    unshift() {
        this._prefix = this._prefix.slice(4);
    }

    newLines(count = 1) {
        let s = '\n';
        for (let i = 0; i < count; i++) s += '\n';
        this._source = this._source + s;
    }

    get prefix(): string {
        return this._prefix;
    }

    combine(writer: CodeWriter) {
        this._source = this._source + writer.source + '\n';
    }
}

export class GeneratorContext {
    public writers: CodeWriter[] = [];

    constructor(public readonly module: IRModule) {
        this.writers.push(new CodeWriter());
    }

    getCode(): string {
        const codes: string[] = [];
        this.writers.forEach((w) => codes.push(w.source));
        return codes.join('\n');
    }

    private top(): CodeWriter {
        return this.writers[this.writers.length - 1];
    }

    addSource(s: string) {
        this.top().add(s);
    }

    getShapeOffset(index: number): number {
        const runtime_data = this.module.runtimeData!;
        const shape = runtime_data.shapes[index];
        if (!shape) {
            throw Error(`Cannot found the shape by index ${index}`);
        }
        const shape_info = runtime_data.shapesMap.get(shape);
        if (!shape_info) {
            throw Error(
                `Cannot found the shape offset of ${shape.meta.name}@${index}`,
            );
        }

        return shape_info.offset;
    }

    getMetaOffset(index: number): number {
        const runtime_data = this.module.runtimeData!;
        const meta = runtime_data.metas[index];
        const meta_info = runtime_data.objectDescriptionsMap.get(meta);
        if (!meta_info) {
            throw Error(
                `Cannot found the objectDescription offset ${meta.name}`,
            );
        }
        return meta_info.offset;
    }

    newLines(count = 1) {
        this.top().newLines(count);
    }

    shift() {
        this.top().shift();
    }

    unshift() {
        this.top().unshift();
    }

    beginBlock() {
        const w = new CodeWriter(this.top().prefix);
        w.shift();
        this.writers.push(w);
    }

    endBlock() {
        const w = this.writers.pop();
        if (w) this.top().combine(w);
    }

    addAt(index: number, s: string) {
        if (index >= 0 && index < this.writers.length) {
            this.writers[index].add(s);
        } else if (index < 0 && -index <= this.writers.length) {
            this.writers[this.writers.length + index].add(s);
        }
    }

    ////
    onEnterFunction() {
        return;
    }

    onLeaveFunction() {
        return;
    }
}

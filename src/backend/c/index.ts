/*
 * Copyright (C) 2023 Xiaomi Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import ts from 'typescript';
import { FunctionKind, TSFunction, TSClass } from '../../type.js';
import { builtinTypes, Type, TypeKind } from '../../type.js';
import { Variable } from '../../variable.js';
import {
    FunctionScope,
    GlobalScope,
    ClassScope,
    ScopeKind,
    Scope,
    ClosureEnvironment,
    BlockScope,
    NamespaceScope,
} from '../../scope.js';
import { Stack } from '../../utils.js';
import { ArgNames, BuiltinNames } from '../../../lib/builtin/builtin_name.js';
import { Ts2wasmBackend, ParserContext, DataSegmentContext } from '../index.js';
import { Logger } from '../../log.js';
import { ModuleNode } from '../../semantics/semantics_nodes.js';
import { BuildModuleNode } from '../../semantics/index.js';
import { CreateDefaultDumpWriter } from '../../semantics/dump.js';
import { IRModule } from '../../semantics/ir/irmodule.js';
import { IRFunction } from '../../semantics/ir/function.js';
import { genHeader, genFooter, genInitFunc } from './code_framework.js';
import { GeneratorContext } from './gen_context.js';
import Names from './name_builder.js';
import { genFunction } from './gen_function.js';
import { genRuntime } from './gen_runtime.js';

export class CCodeGen extends Ts2wasmBackend {
    private dataSegmentContext = new DataSegmentContext();
    private module: ModuleNode | undefined;
    private vm: IRModule | undefined;
    private code = '';

    constructor(parserContext: ParserContext) {
        super(parserContext);
    }

    public codegen(options?: any): void {
        this.genModule();
        this.genVM();
        this.genCCode();
    }

    public emitBinary(options?: any): Uint8Array {
        return new Uint8Array(0);
    }
    public emitText(options?: any): string {
        return this.code;
    }
    public emitSourceMap(name: string): string {
        return '';
    }
    public dispose(): void {
        return;
    }

    genCCode() {
        const context = new GeneratorContext(this.vm!);
        const startFunctions: IRFunction[] = [];
        genHeader(context);
        for (const f of this.vm!.functions) {
            if (Names.isBuiltin(f.name)) continue;
            genFunction(context, f);
            if (f.isStartFunction) startFunctions.push(f);
        }
        genRuntime(context, this.vm!);
        genInitFunc(context, startFunctions);
        genFooter(context);
        this.code = context.getCode();
    }

    genModule() {
        this.module = BuildModuleNode(this.parserContext);
        this.module!.dump(CreateDefaultDumpWriter());
        this.module!.dumpCodeTrees(CreateDefaultDumpWriter());
    }

    genVM() {
        this.vm = new IRModule(this.module!);
    }
}

/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import { FlattenLoop, FunctionalFuncs } from './utils.js';
import { WASMGen } from './index.js';
import {
    BasicBlockNode,
    BlockNode,
    BreakNode,
    CaseClauseNode,
    DefaultClauseNode,
    ForNode,
    IfNode,
    ReturnNode,
    SemanticsKind,
    SemanticsNode,
    SwitchNode,
    VarDeclareNode,
    WhileNode,
} from '../../semantics/semantics_nodes.js';
import { ClosureContextType } from '../../semantics/value_types.js';
import ts from 'typescript';

export class WASMStatementGen {
    private currentFuncCtx;
    private module;

    constructor(private wasmCompiler: WASMGen) {
        this.currentFuncCtx = this.wasmCompiler.currentFuncCtx!;
        this.module = this.wasmCompiler.module;
    }

    WASMStmtGen(stmt: SemanticsNode): binaryen.ExpressionRef {
        let res: binaryen.ExpressionRef | null = null;

        this.currentFuncCtx = this.wasmCompiler.currentFuncCtx!;
        this.module = this.wasmCompiler.module;

        switch (stmt.kind) {
            case SemanticsKind.IF: {
                res = this.wasmIf(<IfNode>stmt);
                break;
            }
            case SemanticsKind.BLOCK: {
                res = this.wasmBlock(<BlockNode>stmt);
                break;
            }
            case SemanticsKind.RETURN: {
                res = this.wasmReturn(<ReturnNode>stmt);
                break;
            }
            case SemanticsKind.EMPTY: {
                res = this.wasmEmpty();
                break;
            }
            case SemanticsKind.WHILE:
            case SemanticsKind.DOWHILE: {
                res = this.wasmLoop(<WhileNode>stmt);
                break;
            }
            case SemanticsKind.FOR: {
                res = this.wasmFor(<ForNode>stmt);
                break;
            }
            case SemanticsKind.SWITCH: {
                res = this.wasmSwitch(<SwitchNode>stmt);
                break;
            }
            case SemanticsKind.BREAK: {
                res = this.wasmBreak(<BreakNode>stmt);
                break;
            }
            case SemanticsKind.BASIC_BLOCK: {
                res = this.wasmBasicExpr(<BasicBlockNode>stmt);
                break;
            }
            default:
                throw new Error('unexpected stmt kind ' + stmt.kind);
        }
        // this.wasmCompiler.addDebugInfoRef(stmt, res);
        return res;
    }

    wasmIf(stmt: IfNode): binaryen.ExpressionRef {
        let wasmCond: binaryen.ExpressionRef =
            this.wasmCompiler.wasmExprComp.wasmExprGen(stmt.condition);
        wasmCond = FunctionalFuncs.generateCondition2(
            this.module,
            wasmCond,
            stmt.condition.type.kind,
        );
        // this.WASMCompiler.addDebugInfoRef(stmt.ifCondition, wasmCond);
        const wasmIfTrue: binaryen.ExpressionRef = this.WASMStmtGen(
            stmt.trueNode,
        );
        const wasmIfFalse = stmt.falseNode
            ? this.WASMStmtGen(stmt.falseNode)
            : undefined;
        return this.module.if(wasmCond, wasmIfTrue, wasmIfFalse);
    }

    wasmBlock(stmt: BlockNode): binaryen.ExpressionRef {
        this.currentFuncCtx.enterScope();
        /* assign value for block's context variable */
        if (
            stmt.varList &&
            stmt.varList[0].type instanceof ClosureContextType &&
            stmt.varList[0].initCtx
        ) {
            const freeVars: VarDeclareNode[] = [];
            for (const v of stmt.varList) {
                if (v.closureIndex !== undefined) {
                    freeVars.push(v);
                }
            }
            this.wasmCompiler.assignCtxVar(stmt.varList[0], freeVars);
        }
        for (const child of stmt.statements) {
            const childRef = this.WASMStmtGen(child);
            this.currentFuncCtx.insert(childRef);
        }
        const statements = this.currentFuncCtx.exitScope();
        return this.module.block(null, statements);
    }

    wasmReturn(stmt: ReturnNode): binaryen.ExpressionRef {
        const brReturn = this.module.br('statements');
        if (stmt.expr === undefined) {
            return brReturn;
        }
        const returnExprRef = this.wasmCompiler.wasmExprComp.wasmExprGen(
            stmt.expr,
        );
        if (binaryen.getExpressionType(returnExprRef) !== binaryen.none) {
            const setReturnValue = this.module.local.set(
                this.currentFuncCtx.returnIdx,
                returnExprRef,
            );
            this.currentFuncCtx.insert(setReturnValue);
        }

        return brReturn;
    }

    wasmEmpty(): binaryen.ExpressionRef {
        return this.wasmCompiler.module.nop();
    }

    wasmLoop(stmt: WhileNode): binaryen.ExpressionRef {
        this.currentFuncCtx.enterScope();
        let WASMCond: binaryen.ExpressionRef =
            this.wasmCompiler.wasmExprComp.wasmExprGen(stmt.condition);
        const WASMStmts: binaryen.ExpressionRef = this.WASMStmtGen(stmt.body!);

        WASMCond = FunctionalFuncs.generateCondition2(
            this.module,
            WASMCond,
            stmt.condition.type.kind,
        );
        // this.WASMCompiler.addDebugInfoRef(stmt.loopCondtion, WASMCond);
        // (block $break
        //  (loop $loop_label
        //   ...
        //   (if cond
        //    ...
        //    (br $loop_label)
        //   )
        //  )
        // )
        const flattenLoop: FlattenLoop = {
            label: stmt.label,
            condition: WASMCond,
            statements: WASMStmts,
        };
        this.currentFuncCtx.insert(
            this.module.loop(
                stmt.label,
                FunctionalFuncs.flattenLoopStatement(
                    this.module,
                    flattenLoop,
                    stmt.kind,
                ),
            ),
        );

        const statements = this.currentFuncCtx.exitScope();
        return this.module.block(stmt.blockLabel, statements);
    }

    wasmFor(stmt: ForNode): binaryen.ExpressionRef {
        this.currentFuncCtx.enterScope();
        let WASMCond: binaryen.ExpressionRef | undefined;
        let WASMIncrementor: binaryen.ExpressionRef | undefined;
        let WASMStmts: binaryen.ExpressionRef = this.wasmCompiler.module.nop();
        if (stmt.initialize) {
            const init = this.WASMStmtGen(stmt.initialize);
            if (stmt.initialize.kind === SemanticsKind.BASIC_BLOCK) {
                this.currentFuncCtx.insert(init);
            }
        }
        if (stmt.condition) {
            WASMCond = this.wasmCompiler.wasmExprComp.wasmExprGen(
                stmt.condition,
            );
            // this.WASMCompiler.addDebugInfoRef(stmt.forLoopCondtion, WASMCond);
        }
        if (stmt.next) {
            WASMIncrementor = this.wasmCompiler.wasmExprComp.wasmExprGen(
                stmt.next,
            );
            // this.WASMCompiler.addDebugInfoRef(
            //     stmt.forLoopIncrementor,
            //     WASMIncrementor,
            // );
        }
        if (stmt.body) {
            WASMStmts = this.WASMStmtGen(stmt.body);
        }
        const flattenLoop: FlattenLoop = {
            label: stmt.label,
            condition: WASMCond,
            statements: WASMStmts,
            incrementor: WASMIncrementor,
        };

        this.currentFuncCtx.insert(
            this.module.loop(
                stmt.label,
                FunctionalFuncs.flattenLoopStatement(
                    this.module,
                    flattenLoop,
                    stmt.kind,
                ),
            ),
        );

        const statements = this.currentFuncCtx.exitScope();
        return this.module.block(stmt.blockLabel, statements);
    }

    wasmSwitch(stmt: SwitchNode): binaryen.ExpressionRef {
        const caseClause = stmt.caseClause;
        const condition = this.wasmCompiler.wasmExprComp.wasmExprGen(
            stmt.condition,
        );
        // this.WASMCompiler.addDebugInfoRef(stmt.switchCondition, WASMCond);
        if (caseClause.length === 0) {
            return this.wasmCompiler.module.nop();
        }
        const branches: binaryen.ExpressionRef[] = new Array(caseClause.length);
        let indexOfDefault = -1;
        let idx = 0;
        caseClause.forEach((clause, i) => {
            if (clause.kind === SemanticsKind.DEFAULT_CLAUSE) {
                indexOfDefault = i;
            } else {
                const caseCause = <CaseClauseNode>clause;
                const causeRef = this.wasmCompiler.wasmExprComp.wasmExprGen(
                    caseCause.caseVar,
                );

                // this.WASMCompiler.addDebugInfoRef(caseCause.caseExpr, causeRef);
                branches[idx++] = this.module.br(
                    'case' + i + stmt.label,
                    this.wasmCompiler.wasmExprComp.operateBinaryExpr(
                        stmt.condition,
                        caseCause.caseVar,
                        ts.SyntaxKind.EqualsEqualsEqualsToken,
                    ),
                );
            }
        });
        const default_label =
            indexOfDefault === -1
                ? stmt.breakLabel
                : 'case' + indexOfDefault + stmt.label;
        branches[idx] = this.module.br(default_label);

        let block = this.module.block('case0' + stmt.label, branches);
        for (let i = 0; i !== caseClause.length; ++i) {
            const clause = <CaseClauseNode | DefaultClauseNode>caseClause[i];
            const label =
                i === caseClause.length - 1
                    ? stmt.breakLabel
                    : 'case' + (i + 1) + stmt.label;
            block = this.module.block(
                label,
                [block].concat(this.WASMStmtGen(clause.body!)),
            );
        }
        return block;
    }

    wasmBreak(stmt: BreakNode): binaryen.ExpressionRef {
        return this.wasmCompiler.module.br(stmt.label);
    }

    wasmBasicExpr(stmt: BasicBlockNode): binaryen.ExpressionRef {
        const basicStmts: binaryen.ExpressionRef[] = [];
        for (const exprStmt of stmt.valueNodes) {
            const exprRef =
                this.wasmCompiler.wasmExprComp.wasmExprGen(exprStmt);
            basicStmts.push(exprRef);
        }
        return this.module.block(null, basicStmts);
    }
}
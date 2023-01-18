import ts from 'typescript';
import binaryen from 'binaryen';
import * as binaryenCAPI from './glue/binaryen.js';
import {
    Statement,
    IfStatement,
    ReturnStatement,
    BaseLoopStatement,
    ForStatement,
    SwitchStatement,
    CaseBlock,
    CaseClause,
    BreakStatement,
    DefaultClause,
    BlockStatement,
    ExpressionStatement,
    VariableStatement,
} from './statement.js';
import { FunctionScope, Scope, ScopeKind } from './scope.js';
import { FlattenLoop, IfStatementInfo, typeInfo } from './glue/utils.js';
import { WASMGen } from './wasmGen.js';
import { TSClass, TypeKind } from './type.js';
import { IdentifierExpression } from './expression.js';
import { arrayToPtr } from './glue/transform.js';
import { ModifierKind } from './variable.js';
export class WASMStatementGen {
    private scope2stmts: Map<Scope, binaryen.ExpressionRef[]>;

    constructor(private WASMCompiler: WASMGen) {
        this.scope2stmts = this.WASMCompiler.scopeStateMap;
    }

    WASMStmtGen(stmt: Statement): binaryen.ExpressionRef {
        switch (stmt.statementKind) {
            case ts.SyntaxKind.IfStatement: {
                const ifStmt = this.WASMIfStmt(<IfStatement>stmt);
                return ifStmt;
            }
            case ts.SyntaxKind.Block: {
                const blockStmt = this.WASMBlock(<BlockStatement>stmt);
                return blockStmt;
            }
            case ts.SyntaxKind.ReturnStatement: {
                const returnStmt = this.WASMReturnStmt(<ReturnStatement>stmt);
                return returnStmt;
            }
            case ts.SyntaxKind.EmptyStatement: {
                const emptyStmt = this.WASMEmptyStmt();
                return emptyStmt;
            }
            case ts.SyntaxKind.WhileStatement:
            case ts.SyntaxKind.DoStatement: {
                const loopStmt = this.WASMBaseLoopStmt(<BaseLoopStatement>stmt);
                return loopStmt;
            }
            case ts.SyntaxKind.ForStatement: {
                const forStmt = this.WASMForStmt(<ForStatement>stmt);
                return forStmt;
            }
            case ts.SyntaxKind.SwitchStatement: {
                const switchStmt = this.WASMSwitchStmt(<SwitchStatement>stmt);
                return switchStmt;
            }
            case ts.SyntaxKind.BreakStatement: {
                const breakStmt = this.WASMBreakStmt(<BreakStatement>stmt);
                return breakStmt;
            }
            case ts.SyntaxKind.ExpressionStatement: {
                const exprStmt = this.WASMExpressionStmt(
                    <ExpressionStatement>stmt,
                );
                return exprStmt;
            }
            case ts.SyntaxKind.VariableStatement: {
                const varStatement = this.WASMVarStmt(<VariableStatement>stmt);
                return varStatement;
            }
            default:
                throw new Error('unexpected expr kind ' + stmt.statementKind);
        }
    }

    WASMIfStmt(stmt: IfStatement): binaryen.ExpressionRef {
        const wasmCond: binaryen.ExpressionRef =
            this.WASMCompiler.wasmExpr.WASMExprGen(stmt.ifCondition);
        const wasmIfTrue: binaryen.ExpressionRef = this.WASMStmtGen(
            stmt.ifIfTrue,
        );
        if (stmt.ifIfFalse === null) {
            return this.WASMCompiler.module.if(wasmCond, wasmIfTrue);
        } else {
            const wasmIfFalse: binaryen.ExpressionRef = this.WASMStmtGen(
                stmt.ifIfFalse,
            );
            return this.WASMCompiler.module.if(
                wasmCond,
                wasmIfTrue,
                wasmIfFalse,
            );
        }
    }

    WASMBlock(stmt: BlockStatement): binaryen.ExpressionRef {
        const scope = stmt.getScope();
        if (scope === null) {
            throw new Error('BlockStatement corresponding scope is null');
        }
        const prevScope = this.WASMCompiler.curScope;
        this.WASMCompiler.setCurScope(scope);
        const binaryenExprRefs = new Array<binaryen.ExpressionRef>();
        this.scope2stmts.set(scope, binaryenExprRefs);

        for (const stmt of scope.statements) {
            const stmtRef = this.WASMStmtGen(stmt);
            if (stmt.statementKind === ts.SyntaxKind.VariableStatement) {
                continue;
            }
            binaryenExprRefs.push(stmtRef);
        }

        /* iff BlockStatement belongs to a function or member function, insertWASMCode !== [binaryen.none] */
        const insertWASMCode = [binaryen.none];
        if (prevScope !== null) {
            this.WASMCompiler.setCurScope(prevScope);
        }
        return this.WASMCompiler.module.block(
            null,
            insertWASMCode[0] === binaryen.none
                ? binaryenExprRefs
                : insertWASMCode.concat(binaryenExprRefs),
        );
    }

    WASMReturnStmt(stmt: ReturnStatement): binaryen.ExpressionRef {
        if (stmt.returnExpression === null) {
            return this.WASMCompiler.module.return();
        }
        const currentScope = <Scope>this.WASMCompiler.curScope;
        const nearestFuncScope = <FunctionScope>(
            currentScope.getNearestFunctionScope()
        );
        const type = nearestFuncScope.funcType;
        if (type.returnType.kind === TypeKind.FUNCTION) {
            const returnedFuncName =
                nearestFuncScope.funcName +
                '|' +
                (<IdentifierExpression>stmt.returnExpression).identifierName;

            const module = this.WASMCompiler.module;
            const array = [
                module.local.get(
                    nearestFuncScope.paramArray.length,
                    (<typeInfo>WASMGen.contextOfFunc.get(nearestFuncScope))
                        .typeRef,
                ),
                module.ref.func(
                    returnedFuncName,
                    this.WASMCompiler.wasmType.getWASMType(type.returnType),
                ),
            ];

            return module.return(
                binaryenCAPI._BinaryenStructNew(
                    module.ptr,
                    arrayToPtr(array).ptr,
                    2,
                    this.WASMCompiler.wasmType.getWASMFuncStructHeapType(
                        type.returnType,
                    ),
                ),
            );
        }

        const WASMReturnExpr: binaryen.ExpressionRef =
            this.WASMCompiler.wasmExpr.WASMExprGen(stmt.returnExpression);
        return this.WASMCompiler.module.return(WASMReturnExpr);
    }

    WASMEmptyStmt(): binaryen.ExpressionRef {
        return this.WASMCompiler.module.nop();
    }

    WASMBaseLoopStmt(stmt: BaseLoopStatement): binaryen.ExpressionRef {
        const prevScope = this.WASMCompiler.curScope;
        this.WASMCompiler.setCurScope(stmt.getScope() as Scope);
        const scope = stmt.getScope() as Scope;
        const binaryenExprRefs = new Array<binaryen.ExpressionRef>();
        this.scope2stmts.set(scope, binaryenExprRefs);
        const WASMCond: binaryen.ExpressionRef =
            this.WASMCompiler.wasmExpr.WASMExprGen(stmt.loopCondtion);
        const WASMStmts: binaryen.ExpressionRef = this.WASMStmtGen(
            stmt.loopBody,
        );
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
            label: stmt.loopLabel,
            condition: WASMCond,
            statements: WASMStmts,
        };
        if (prevScope !== null) {
            this.WASMCompiler.setCurScope(prevScope);
        }
        return this.WASMCompiler.module.block(stmt.loopBlockLabel, [
            this.WASMCompiler.module.loop(
                stmt.loopLabel,
                this.flattenLoopStatement(flattenLoop, stmt.statementKind),
            ),
        ]);
    }

    WASMForStmt(stmt: ForStatement): binaryen.ExpressionRef {
        const prevScope = this.WASMCompiler.curScope;
        this.WASMCompiler.setCurScope(stmt.getScope() as Scope);
        const scope = stmt.getScope() as Scope;
        const binaryenExprRefs = new Array<binaryen.ExpressionRef>();
        this.scope2stmts.set(scope, binaryenExprRefs);

        let WASMCond: binaryen.ExpressionRef = this.WASMCompiler.module.nop();
        let WASMIncrementor: binaryen.ExpressionRef =
            this.WASMCompiler.module.nop();
        let WASMStmts: binaryen.ExpressionRef = this.WASMCompiler.module.nop();
        if (stmt.forLoopInitializer !== null) {
            this.WASMStmtGen(stmt.forLoopInitializer);
        }
        if (stmt.forLoopCondtion !== null) {
            WASMCond = this.WASMCompiler.wasmExpr.WASMExprGen(
                stmt.forLoopCondtion,
            );
        }
        if (stmt.forLoopIncrementor !== null) {
            WASMIncrementor = this.WASMCompiler.wasmExpr.WASMExprGen(
                stmt.forLoopIncrementor,
            );
        }
        if (stmt.forLoopBody !== null) {
            WASMStmts = this.WASMStmtGen(stmt.forLoopBody);
        }
        const flattenLoop: FlattenLoop = {
            label: stmt.forLoopLabel,
            condition: WASMCond,
            statements: WASMStmts,
            incrementor: WASMIncrementor,
        };
        binaryenExprRefs.push(
            this.WASMCompiler.module.loop(
                stmt.forLoopLabel,
                this.flattenLoopStatement(flattenLoop, stmt.statementKind),
            ),
        );
        if (prevScope !== null) {
            this.WASMCompiler.setCurScope(prevScope);
        }
        return this.WASMCompiler.module.block(
            stmt.forLoopBlockLabel,
            binaryenExprRefs,
        );
    }

    WASMSwitchStmt(stmt: SwitchStatement): binaryen.ExpressionRef {
        const WASMCond: binaryen.ExpressionRef =
            this.WASMCompiler.wasmExpr.WASMExprGen(stmt.switchCondition);
        // switch
        //   |
        // CaseBlock
        //   |
        // [Clauses]
        return this.WASMCaseBlockStmt(
            <CaseBlock>stmt.switchCaseBlock,
            WASMCond,
        );
    }

    WASMCaseBlockStmt(
        stmt: CaseBlock,
        condtion: binaryen.ExpressionRef,
    ): binaryen.ExpressionRef {
        const prevScope = this.WASMCompiler.curScope;
        this.WASMCompiler.setCurScope(stmt.getScope() as Scope);
        const clauses = stmt.caseCauses;
        if (clauses.length === 0) {
            return this.WASMCompiler.module.nop();
        }
        const module = this.WASMCompiler.module;
        const branches: binaryen.ExpressionRef[] = new Array(clauses.length);
        let indexOfDefault = -1;
        let idx = 0;
        clauses.forEach((clause, i) => {
            if (clause.statementKind === ts.SyntaxKind.DefaultClause) {
                indexOfDefault = i;
            } else {
                const caseCause = <CaseClause>clause;
                branches[idx++] = module.br(
                    'case' + i + stmt.switchLabel,
                    module.f64.eq(
                        condtion,
                        this.WASMCompiler.wasmExpr.WASMExprGen(
                            caseCause.caseExpr,
                        ),
                    ),
                );
            }
        });
        const default_label =
            indexOfDefault === -1
                ? stmt.breakLabel
                : 'case' + indexOfDefault + stmt.switchLabel;
        branches[idx] = module.br(default_label);

        let block = module.block('case0' + stmt.switchLabel, branches);
        for (let i = 0; i !== clauses.length; ++i) {
            const clause = <CaseClause | DefaultClause>clauses[i];
            const label =
                i === clauses.length - 1
                    ? stmt.breakLabel
                    : 'case' + (i + 1) + stmt.switchLabel;
            block = module.block(
                label,
                [block].concat(this.WASMClauseStmt(clause)),
            );
        }
        if (prevScope !== null) {
            this.WASMCompiler.setCurScope(prevScope);
        }
        return block;
    }

    WASMClauseStmt(clause: CaseClause | DefaultClause): binaryen.ExpressionRef {
        const prevScope = this.WASMCompiler.curScope;
        this.WASMCompiler.setCurScope(clause.getScope() as Scope);
        const scope = clause.getScope() as Scope;
        const binaryenExprRefs = new Array<binaryen.ExpressionRef>();
        this.scope2stmts.set(scope, binaryenExprRefs);
        for (const statement of clause.caseStatements) {
            binaryenExprRefs.push(this.WASMStmtGen(statement));
        }
        if (prevScope !== null) {
            this.WASMCompiler.setCurScope(prevScope);
        }
        return this.WASMCompiler.module.block(null, binaryenExprRefs);
    }

    WASMBreakStmt(stmt: BreakStatement): binaryen.ExpressionRef {
        return this.WASMCompiler.module.br(stmt.breakLabel);
    }

    WASMExpressionStmt(stmt: ExpressionStatement): binaryen.ExpressionRef {
        const innerExpr = stmt.expression;
        return this.WASMCompiler.wasmExpr.WASMExprGen(innerExpr);
    }

    WASMVarStmt(stmt: VariableStatement): binaryen.ExpressionRef {
        const varArray = stmt.varArray;
        const module = this.WASMCompiler.module;
        const wasmType = this.WASMCompiler.wasmType;
        const getVariableInitValue = this.WASMCompiler.getVariableInitValue;
        const wasmExpr = this.WASMCompiler.wasmExpr;
        const wasmDynExpr = this.WASMCompiler.wasmDynExprCompiler;
        const currentScope = this.WASMCompiler.curScope;
        if (!currentScope) {
            throw new Error('current scope is null in WASMVarStmt');
        }
        // const binaryenExprRefs: binaryen.ExpressionRef[] = [];
        const binaryenExprRefs =
            this.WASMCompiler.scopeStateMap.get(currentScope);
        if (!binaryenExprRefs) {
            throw new Error('statementArray is undefined in WASMVarStmt');
        }
        if (currentScope.kind === ScopeKind.GlobalScope) {
            for (const globalVar of varArray) {
                const varTypeRef =
                    globalVar.varType.kind === TypeKind.FUNCTION
                        ? wasmType.getWASMFuncStructType(globalVar.varType)
                        : wasmType.getWASMType(globalVar.varType);
                const mutable =
                    globalVar.varModifier === ModifierKind.const ? false : true;
                if (globalVar.initExpression === null) {
                    module.addGlobal(
                        globalVar.varName,
                        varTypeRef,
                        mutable,
                        getVariableInitValue(globalVar.varType),
                    );
                } else {
                    const varInitExprRef = wasmExpr.WASMExprGen(
                        globalVar.initExpression,
                    );
                    if (globalVar.varType.kind === TypeKind.NUMBER) {
                        if (
                            globalVar.initExpression.expressionKind ===
                            ts.SyntaxKind.NumericLiteral
                        ) {
                            module.addGlobal(
                                globalVar.varName,
                                varTypeRef,
                                mutable,
                                varInitExprRef,
                            );
                        } else {
                            module.addGlobal(
                                globalVar.varName,
                                varTypeRef,
                                true,
                                module.f64.const(0),
                            );
                            binaryenExprRefs.push(
                                module.global.set(
                                    globalVar.varName,
                                    varInitExprRef,
                                ),
                            );
                        }
                    } else if (globalVar.varType.kind === TypeKind.BOOLEAN) {
                        module.addGlobal(
                            globalVar.varName,
                            varTypeRef,
                            mutable,
                            varInitExprRef,
                        );
                    } else {
                        module.addGlobal(
                            globalVar.varName,
                            varTypeRef,
                            true,
                            binaryenCAPI._BinaryenRefNull(
                                module.ptr,
                                varTypeRef,
                            ),
                        );
                        if (globalVar.varType.kind === TypeKind.ANY) {
                            const dynInitExprRef = wasmDynExpr.WASMDynExprGen(
                                globalVar.initExpression,
                            );
                            binaryenExprRefs.push(
                                module.global.set(
                                    globalVar.varName,
                                    dynInitExprRef,
                                ),
                            );
                        } else {
                            binaryenExprRefs.push(
                                module.global.set(
                                    globalVar.varName,
                                    varInitExprRef,
                                ),
                            );
                        }
                    }
                }
            }
        } else {
            // common variable assignment
            for (const localVar of varArray) {
                if (localVar.initExpression !== null) {
                    let varInitExprRef: binaryen.ExpressionRef;
                    if (localVar.varType.kind === TypeKind.ANY) {
                        varInitExprRef = wasmDynExpr.WASMDynExprGen(
                            localVar.initExpression,
                        );
                        binaryenExprRefs.push(
                            module.local.set(localVar.varIndex, varInitExprRef),
                        );
                    } else {
                        varInitExprRef = wasmExpr.WASMExprGen(
                            localVar.initExpression,
                        );
                        if (
                            localVar.varType.typeKind !== TypeKind.CLASS ||
                            (<TSClass>localVar.varType).className === 'Array' ||
                            (<TSClass>localVar.varType).className === ''
                        ) {
                            binaryenExprRefs.push(
                                module.local.set(
                                    localVar.varIndex,
                                    varInitExprRef,
                                ),
                            );
                        }
                    }
                }
            }
        }
        return module.unreachable();
    }

    flattenLoopStatement(
        loopStatementInfo: FlattenLoop,
        kind: ts.SyntaxKind,
    ): binaryen.ExpressionRef {
        const ifStatementInfo: IfStatementInfo = {
            condition: loopStatementInfo.condition,
            ifTrue: binaryen.none,
            ifFalse: binaryen.none,
        };
        if (kind !== ts.SyntaxKind.DoStatement) {
            const ifTrueBlockArray: binaryen.ExpressionRef[] = [];
            if (loopStatementInfo.statements !== binaryen.none) {
                ifTrueBlockArray.push(loopStatementInfo.statements);
            }
            if (kind === ts.SyntaxKind.ForStatement) {
                ifTrueBlockArray.push(
                    <binaryen.ExpressionRef>loopStatementInfo.incrementor,
                );
            }
            ifTrueBlockArray.push(
                this.WASMCompiler.module.br(loopStatementInfo.label),
            );
            const ifTrueBlock = this.WASMCompiler.module.block(
                null,
                ifTrueBlockArray,
            );
            ifStatementInfo.ifTrue = ifTrueBlock;
            return this.WASMCompiler.module.if(
                ifStatementInfo.condition,
                ifStatementInfo.ifTrue,
            );
        } else {
            ifStatementInfo.ifTrue = this.WASMCompiler.module.br(
                loopStatementInfo.label,
            );
            const blockArray: binaryen.ExpressionRef[] = [];
            if (loopStatementInfo.statements !== binaryen.none) {
                blockArray.push(loopStatementInfo.statements);
            }
            const ifExpression = this.WASMCompiler.module.if(
                ifStatementInfo.condition,
                ifStatementInfo.ifTrue,
            );
            blockArray.push(ifExpression);
            return this.WASMCompiler.module.block(null, blockArray);
        }
    }
}

import ts from 'typescript';
import 'mocha';
import { expect } from 'chai';
import {
    Expression,
    BinaryExpression,
    IdentifierExpression,
    NumberLiteralExpression,
    ObjectLiteralExpression,
    PropertyAccessExpression,
    StringLiteralExpression,
} from '../../src/expression.js';

describe('testExpression', function () {
    it('validateExpressionRelation', function () {
        const numberLiteralExpression = new NumberLiteralExpression(3);
        const stringLiteralExpression = new StringLiteralExpression('test');
        const identifierExpression = new IdentifierExpression('a');
        const objectLiteralExpression = new ObjectLiteralExpression(
            [identifierExpression],
            [numberLiteralExpression],
        );
        const binaryExpression = new BinaryExpression(
            ts.SyntaxKind.PlusToken,
            numberLiteralExpression,
            stringLiteralExpression,
        );
        const baseExpr = new Expression(ts.SyntaxKind.Unknown);
        const propertyAccessExpression = new PropertyAccessExpression(
            objectLiteralExpression,
            identifierExpression,
            baseExpr,
            false,
        );

        expect(identifierExpression.identifierName).eq('a');
        expect(binaryExpression.leftOperand).eq(numberLiteralExpression);
        expect(binaryExpression.rightOperand).eq(stringLiteralExpression);
        expect(propertyAccessExpression.propertyAccessExpr).eq(
            objectLiteralExpression,
        );
        expect(propertyAccessExpression.propertyExpr).eq(identifierExpression);
        expect(propertyAccessExpression.parentExpr).eq(baseExpr);
    });
});

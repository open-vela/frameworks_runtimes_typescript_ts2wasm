import 'mocha';
import { expect } from 'chai';
import { spy } from 'sinon';

// test function
const testFunc = function (callback: (num: number) => any): () => void {
    let localValue = 0;
    return () => callback(localValue++);
};

describe('testFunc', function () {
    it('works', function () {
        const mockCallback = spy();

        const work = testFunc(mockCallback);
        work();
        work();
        work();

        expect(mockCallback.callCount).to.be.equal(3);
        expect(mockCallback.args).to.be.deep.equal([[0], [1], [2]]);
    });
});

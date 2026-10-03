import { TransactionScope } from './transaction-scope.js';

describe('TransactionScope (ADR-0098, ADR-0150)', () => {
  it('runs the before-commit work in order, waiting for each, and the after-commit work in order', async () => {
    const scope = new TransactionScope();
    const runs: string[] = [];
    scope.beforeCommit(async () => {
      await Promise.resolve();
      runs.push('store first');
    });
    scope.afterCommit(() => runs.push('dispatch'));
    scope.beforeCommit(() => {
      runs.push('store second');
      return Promise.resolve();
    });

    await scope.runBeforeCommitCallbacks();
    scope.runAfterCommitCallbacks();

    expect(runs).toEqual(['store first', 'store second', 'dispatch']);
  });

  it('forgets both kinds of work a nested step added after the mark', async () => {
    const scope = new TransactionScope();
    const runs: string[] = [];
    scope.beforeCommit(() => {
      runs.push('kept before');
      return Promise.resolve();
    });
    scope.afterCommit(() => runs.push('kept after'));
    const mark = scope.mark();
    scope.beforeCommit(() => {
      runs.push('undone before');
      return Promise.resolve();
    });
    scope.afterCommit(() => runs.push('undone after'));

    scope.discardSince(mark);
    await scope.runBeforeCommitCallbacks();
    scope.runAfterCommitCallbacks();

    expect(mark).toEqual({ beforeCommit: 1, afterCommit: 1 });
    expect(runs).toEqual(['kept before', 'kept after']);
  });
});

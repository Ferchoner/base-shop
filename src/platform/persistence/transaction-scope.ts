import { ClsServiceManager } from 'nestjs-cls';

const TRANSACTION_SCOPE = Symbol('transaction-scope');

/** How many callbacks of each kind were registered at some point, to discard later the ones a nested step adds. */
export interface ScopeMark {
  readonly beforeCommit: number;
  readonly afterCommit: number;
}

/**
 * The outermost transaction opened by TransactionManager.run (ADR-0098). Platform code uses it to write within the
 * transaction once its work is done, such as storing domain events (ADR-0150), and to run work once the transaction
 * commits, such as dispatching them. On rollback the after-commit callbacks never run.
 */
export class TransactionScope {
  private readonly beforeCommitCallbacks: (() => Promise<void>)[] = [];
  private readonly afterCommitCallbacks: (() => void)[] = [];

  /**
   * Runs `callback` inside the transaction, after its work succeeded and before the commit, in registration order.
   * What it writes commits with the work, and if it fails, the transaction rolls back.
   */
  beforeCommit(callback: () => Promise<void>): void {
    this.beforeCommitCallbacks.push(callback);
  }

  /** Runs `callback` right after the commit, in registration order. */
  afterCommit(callback: () => void): void {
    this.afterCommitCallbacks.push(callback);
  }

  /** How many callbacks are registered now, to discard later the ones a nested step adds. */
  mark(): ScopeMark {
    return {
      beforeCommit: this.beforeCommitCallbacks.length,
      afterCommit: this.afterCommitCallbacks.length,
    };
  }

  /** Forgets the callbacks registered since `mark`, because the nested step that added them was undone. */
  discardSince(mark: ScopeMark): void {
    this.beforeCommitCallbacks.length = Math.min(
      mark.beforeCommit,
      this.beforeCommitCallbacks.length,
    );
    this.afterCommitCallbacks.length = Math.min(
      mark.afterCommit,
      this.afterCommitCallbacks.length,
    );
  }

  /** Called by the transaction manager inside the transaction, once its work succeeded. */
  async runBeforeCommitCallbacks(): Promise<void> {
    for (const callback of this.beforeCommitCallbacks) await callback();
  }

  /** Called by the transaction manager once the commit succeeded. */
  runAfterCommitCallbacks(): void {
    for (const callback of this.afterCommitCallbacks) callback();
  }
}

/** The scope of the transaction running now, or undefined outside TransactionManager.run. */
export function currentTransactionScope(): TransactionScope | undefined {
  const cls = ClsServiceManager.getClsService();
  return cls.isActive()
    ? cls.get<TransactionScope | undefined>(TRANSACTION_SCOPE)
    : undefined;
}

/**
 * Runs `work` with a new transaction scope in its own async context. The scope object is shared with the
 * nested contexts that nestjs-cls creates for the transaction, and it is gone once `work` settles.
 */
export async function withTransactionScope<T>(
  work: (scope: TransactionScope) => Promise<T>,
): Promise<T> {
  const cls = ClsServiceManager.getClsService();
  return cls.run({ ifNested: 'inherit' }, async () => {
    const scope = new TransactionScope();
    cls.set(TRANSACTION_SCOPE, scope);
    try {
      return await work(scope);
    } finally {
      cls.set(TRANSACTION_SCOPE, undefined);
    }
  });
}

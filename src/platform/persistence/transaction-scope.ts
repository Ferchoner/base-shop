import { ClsServiceManager } from 'nestjs-cls';

const TRANSACTION_SCOPE = Symbol('transaction-scope');

/**
 * The outermost transaction opened by TransactionManager.run (ADR-0098). Platform code uses it to run work
 * once the transaction commits, such as dispatching domain events. On rollback the callbacks never run.
 */
export class TransactionScope {
  private readonly callbacks: (() => void)[] = [];

  /** Runs `callback` right after the commit, in registration order. */
  afterCommit(callback: () => void): void {
    this.callbacks.push(callback);
  }

  /** Called by the transaction manager once the commit succeeded. */
  runAfterCommitCallbacks(): void {
    for (const callback of this.callbacks) callback();
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

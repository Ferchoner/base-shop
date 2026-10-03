import { Injectable, Logger } from '@nestjs/common';
import { Clock, deleteInBatches } from '../../../shared-kernel/index.js';

/**
 * Access links that no longer work, deleted in batches (ADR-0144, ADR-0148). Each call deletes at most `limit` rows in
 * one statement and answers how many it deleted. An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class SpentAccessTokens {
  /** Access links expired by `now`, used or replaced. */
  abstract delete(now: Date, limit: number): Promise<number>;
}

/**
 * The daily cleanup of Ordering (UC-SYS-01, ADR-0029, ADR-0144, ADR-0148): the access links expired, used or
 * replaced, with the email they keep. A system task: not audited.
 */
@Injectable()
export class AccessTokenCleanup {
  private readonly logger = new Logger(AccessTokenCleanup.name);

  constructor(
    private readonly tokens: SpentAccessTokens,
    private readonly clock: Clock,
  ) {}

  /** Answers how many links it deleted. */
  async run(): Promise<number> {
    const now = this.clock.now();
    const deleted = await deleteInBatches((limit) =>
      this.tokens.delete(now, limit),
    );
    this.logger.log(`Deleted ${deleted} spent order access tokens`);
    return deleted;
  }
}

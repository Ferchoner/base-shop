import { Injectable } from '@nestjs/common';
import { IdempotencyStore } from '../../../platform/http/idempotency/idempotency.store.js';
import { ReceptionResponses } from '../application/work-order-ports.js';

/** The route where the staff receives equipment, as `@Idempotent` keeps its responses. */
export const RECEPTION_ENDPOINT = 'POST /v1/admin/work-orders';

/**
 * The responses of `@Idempotent` (ADR-0099): the staff receives equipment in its own scope, beside other responses of
 * that member, so only the responses of these work orders go, by the `id` of the body they answered (ADR-0161).
 */
@Injectable()
export class IdempotencyReceptionResponses extends ReceptionResponses {
  constructor(private readonly store: IdempotencyStore) {
    super();
  }

  async forgetOf(workOrderIds: readonly string[]): Promise<void> {
    await this.store.forgetResponsesOf(RECEPTION_ENDPOINT, workOrderIds);
  }
}

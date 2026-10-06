import { Injectable } from '@nestjs/common';
import { PaymentsFacade } from '../../payments/index.js';
import { InStorePayments } from '../application/notice-orders.js';

/** Whether the store takes payments in person, from the facade of Payments (ADR-0162). */
@Injectable()
export class PaymentsFacadeInStorePayments extends InStorePayments {
  constructor(private readonly payments: PaymentsFacade) {
    super();
  }

  enabled(): Promise<boolean> {
    return this.payments.manualPaymentsEnabled();
  }
}

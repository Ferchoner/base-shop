import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../platform/config/environment.js';
import { MANUAL_PAYMENTS_ENABLED } from './application/manual-payments.js';
import {
  ProcessedWebhookEvents,
  WebhookEventCleanup,
} from './application/webhook-event-cleanup.js';
import { PrismaProcessedWebhookEvents } from './infrastructure/prisma-processed-webhook-events.js';
import { WebhookEventCleanupJob } from './infrastructure/webhook-event-cleanup.job.js';
import { PaymentsFacade } from './application/payments.facade.js';
import { PaymentsQueries } from './application/payments.queries.js';
import { PaymentRepository } from './domain/payment.repository.js';
import { PrismaPaymentRepository } from './infrastructure/prisma-payment.repository.js';
import { PrismaPaymentsQueries } from './infrastructure/prisma-payments.queries.js';
import { AdminPaymentsController } from './presentation/admin-payments.controller.js';

/**
 * Payments bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. Ordering uses its facade,
 * and Payments never uses Ordering: it tells Ordering what happened with events (ADR-0134).
 */
@Module({
  controllers: [AdminPaymentsController],
  providers: [
    {
      provide: MANUAL_PAYMENTS_ENABLED,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('MANUAL_PAYMENTS_ENABLED', { infer: true }),
    },
    PaymentsFacade,
    WebhookEventCleanup,
    WebhookEventCleanupJob,
    { provide: PaymentRepository, useClass: PrismaPaymentRepository },
    {
      provide: ProcessedWebhookEvents,
      useClass: PrismaProcessedWebhookEvents,
    },
    { provide: PaymentsQueries, useClass: PrismaPaymentsQueries },
  ],
  exports: [PaymentsFacade],
})
export class PaymentsModule {}

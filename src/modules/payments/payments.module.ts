import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../platform/config/environment.js';
import { ConfigurePaymentSettings } from './application/configure-payment-settings.use-case.js';
import {
  PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS,
  ProcessedWebhookEvents,
  WebhookEventCleanup,
} from './application/webhook-event-cleanup.js';
import { PrismaProcessedWebhookEvents } from './infrastructure/prisma-processed-webhook-events.js';
import { WebhookEventCleanupJob } from './infrastructure/webhook-event-cleanup.job.js';
import { PaymentsFacade } from './application/payments.facade.js';
import { PaymentsQueries } from './application/payments.queries.js';
import { PaymentSettingsRepository } from './domain/payment-settings.repository.js';
import { PaymentRepository } from './domain/payment.repository.js';
import { PrismaPaymentSettingsRepository } from './infrastructure/prisma-payment-settings.repository.js';
import { PrismaPaymentRepository } from './infrastructure/prisma-payment.repository.js';
import { PrismaPaymentsQueries } from './infrastructure/prisma-payments.queries.js';
import { AdminPaymentSettingsController } from './presentation/admin-payment-settings.controller.js';
import { AdminPaymentsController } from './presentation/admin-payments.controller.js';

/**
 * Payments bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. Ordering uses its facade,
 * and Payments never uses Ordering: it tells Ordering what happened with events (ADR-0134).
 */
@Module({
  controllers: [AdminPaymentsController, AdminPaymentSettingsController],
  providers: [
    PaymentsFacade,
    ConfigurePaymentSettings,
    WebhookEventCleanup,
    WebhookEventCleanupJob,
    {
      provide: PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('PROCESSED_WEBHOOK_EVENT_RETENTION_DAYS', { infer: true }),
    },
    { provide: PaymentRepository, useClass: PrismaPaymentRepository },
    {
      provide: PaymentSettingsRepository,
      useClass: PrismaPaymentSettingsRepository,
    },
    {
      provide: ProcessedWebhookEvents,
      useClass: PrismaProcessedWebhookEvents,
    },
    { provide: PaymentsQueries, useClass: PrismaPaymentsQueries },
  ],
  exports: [PaymentsFacade],
})
export class PaymentsModule {}

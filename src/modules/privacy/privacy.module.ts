import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../platform/config/environment.js';
import { RetentionPolicyModule } from '../../platform/config/retention-policy.js';
import { IdentityAccessModule } from '../identity-access/index.js';
import { OrderingModule } from '../ordering/index.js';
import { ShoppingModule } from '../shopping/index.js';
import {
  BuyerOrders,
  CustomerAccounts,
  CustomerCarts,
} from './application/anonymization-ports.js';
import { Anonymizations } from './application/anonymizations.js';
import {
  INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS,
  InactiveCustomerAnonymizations,
} from './application/inactive-customer-anonymizations.js';
import {
  IdentityFacadeCustomerAccounts,
  OrderingFacadeBuyerOrders,
  ShoppingFacadeCustomerCarts,
} from './infrastructure/facade-adapters.js';
import { InactiveCustomerAnonymizationJob } from './infrastructure/inactive-customer-anonymization.job.js';
import { AnonymizationsController } from './presentation/anonymizations.controller.js';
import { RetentionPolicyController } from './presentation/retention-policy.controller.js';

/**
 * Privacy (ADR-0004, ADR-0145): a cross-cutting capability without a domain of its own, like Notifications. It runs
 * the anonymizations of ADR-0067 across Identity & Access, Ordering and Shopping through their facades, because
 * Identity cannot use Ordering (ADR-0132), also those of inactive customers, and publishes the retention policy in
 * force (ADR-0152); no module uses it.
 */
@Module({
  imports: [
    IdentityAccessModule,
    OrderingModule,
    ShoppingModule,
    RetentionPolicyModule,
  ],
  controllers: [AnonymizationsController, RetentionPolicyController],
  providers: [
    {
      provide: INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS', { infer: true }) ??
        null,
    },
    Anonymizations,
    InactiveCustomerAnonymizations,
    InactiveCustomerAnonymizationJob,
    { provide: CustomerAccounts, useClass: IdentityFacadeCustomerAccounts },
    { provide: BuyerOrders, useClass: OrderingFacadeBuyerOrders },
    { provide: CustomerCarts, useClass: ShoppingFacadeCustomerCarts },
  ],
})
export class PrivacyModule {}

import { Module } from '@nestjs/common';
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
  IdentityFacadeCustomerAccounts,
  OrderingFacadeBuyerOrders,
  ShoppingFacadeCustomerCarts,
} from './infrastructure/facade-adapters.js';
import { AnonymizationsController } from './presentation/anonymizations.controller.js';

/**
 * Privacy (ADR-0004, ADR-0145): a cross-cutting capability without a domain of its own, like Notifications. It runs
 * the anonymizations of ADR-0067 across Identity & Access, Ordering and Shopping through their facades, because
 * Identity cannot use Ordering (ADR-0132); no module uses it.
 */
@Module({
  imports: [IdentityAccessModule, OrderingModule, ShoppingModule],
  controllers: [AnonymizationsController],
  providers: [
    Anonymizations,
    { provide: CustomerAccounts, useClass: IdentityFacadeCustomerAccounts },
    { provide: BuyerOrders, useClass: OrderingFacadeBuyerOrders },
    { provide: CustomerCarts, useClass: ShoppingFacadeCustomerCarts },
  ],
})
export class PrivacyModule {}

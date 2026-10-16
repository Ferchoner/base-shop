import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../platform/config/environment.js';
import { IdentityAccessModule } from '../identity-access/index.js';
import { InventoryModule } from '../inventory/index.js';
import { OrderingModule } from '../ordering/index.js';
import { ReceiveWorkOrder } from './application/receive-work-order.use-case.js';
import {
  SERVICE_NOTE_SETTINGS,
  type ServiceNoteSettings,
} from './application/service-note.js';
import { UpdateWorkOrder } from './application/update-work-order.use-case.js';
import { WorkOrderAnonymizations } from './application/work-order-anonymizations.js';
import {
  ReceptionResponses,
  StoreSales,
  WorkOrderAccounts,
  WorkOrderWarehouses,
} from './application/work-order-ports.js';
import {
  WORK_ORDER_RETENTION,
  WorkOrderRetention,
  type WorkOrderRetentionPolicy,
} from './application/work-order-retention.js';
import { WorkOrdersFacade } from './application/work-orders.facade.js';
import { WorkOrderLifecycle } from './application/work-order-lifecycle.use-case.js';
import { WorkOrderReader } from './application/work-order-reader.js';
import { WorkOrderSales } from './application/work-order-sales.use-case.js';
import { WorkOrderQueries } from './application/work-orders.queries.js';
import { WorkOrderRepository } from './domain/work-order.repository.js';
import {
  IdentityFacadeWorkOrderAccounts,
  InventoryFacadeWorkOrderWarehouses,
  OrderingFacadeStoreSales,
} from './infrastructure/facade-adapters.js';
import { PrismaWorkOrderRepository } from './infrastructure/prisma-work-order.repository.js';
import { IdempotencyReceptionResponses } from './infrastructure/idempotency-reception-responses.js';
import { PrismaWorkOrderQueries } from './infrastructure/prisma-work-orders.queries.js';
import { WorkOrderRetentionJob } from './infrastructure/work-order-retention.job.js';
import { AdminWorkOrdersController } from './presentation/admin-work-orders.controller.js';

/**
 * Work Orders (ADR-0165, ADR-0166, ADR-0167): the service notes of the equipment a customer leaves in the physical
 * store. It reads warehouses from Inventory, accounts from Identity and the counter sales that pay for a work order
 * from Ordering, through their facades (ADR-0005); none of them uses Work Orders. The data of the store on the note
 * come from the configuration, as on the ticket (ADR-0163). The data of the customer follow the retention cycle of the
 * orders, with the same variables (ADR-0151, ADR-0167), and Privacy anonymizes them through its facade.
 */
@Module({
  imports: [IdentityAccessModule, InventoryModule, OrderingModule],
  controllers: [AdminWorkOrdersController],
  providers: [
    ReceiveWorkOrder,
    UpdateWorkOrder,
    WorkOrderLifecycle,
    WorkOrderSales,
    WorkOrderReader,
    WorkOrderAnonymizations,
    WorkOrderRetention,
    WorkOrderRetentionJob,
    WorkOrdersFacade,
    { provide: WorkOrderRepository, useClass: PrismaWorkOrderRepository },
    { provide: WorkOrderQueries, useClass: PrismaWorkOrderQueries },
    {
      provide: WorkOrderWarehouses,
      useClass: InventoryFacadeWorkOrderWarehouses,
    },
    { provide: WorkOrderAccounts, useClass: IdentityFacadeWorkOrderAccounts },
    { provide: StoreSales, useClass: OrderingFacadeStoreSales },
    { provide: ReceptionResponses, useClass: IdempotencyReceptionResponses },
    {
      provide: WORK_ORDER_RETENTION,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
      ): WorkOrderRetentionPolicy => ({
        enabled: config.get('PERSONAL_DATA_RETENTION_ENABLED', { infer: true }),
        operationalMonths: config.get('PERSONAL_DATA_OPERATIONAL_MONTHS', {
          infer: true,
        }),
        blockedMonths: config.get('PERSONAL_DATA_BLOCKED_MONTHS', {
          infer: true,
        }),
      }),
    },
    {
      provide: SERVICE_NOTE_SETTINGS,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
      ): ServiceNoteSettings => ({
        store: {
          name: config.get('STORE_NAME', { infer: true }),
          address: config.get('STORE_ADDRESS', { infer: true }) ?? null,
          taxId: config.get('STORE_TAX_ID', { infer: true }) ?? null,
          phone: config.get('STORE_PHONE', { infer: true }) ?? null,
        },
        terms: config.get('WORK_ORDER_FOOTER', { infer: true }),
      }),
    },
  ],
  exports: [WorkOrdersFacade],
})
export class WorkOrdersModule {}

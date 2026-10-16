import { Module } from '@nestjs/common';
import { IdentityAccessModule } from '../identity-access/index.js';
import { InventoryModule } from '../inventory/index.js';
import { ReceiveWorkOrder } from './application/receive-work-order.use-case.js';
import { UpdateWorkOrder } from './application/update-work-order.use-case.js';
import {
  WorkOrderAccounts,
  WorkOrderWarehouses,
} from './application/work-order-ports.js';
import { WorkOrderLifecycle } from './application/work-order-lifecycle.use-case.js';
import { WorkOrderQueries } from './application/work-orders.queries.js';
import { WorkOrderRepository } from './domain/work-order.repository.js';
import {
  IdentityFacadeWorkOrderAccounts,
  InventoryFacadeWorkOrderWarehouses,
} from './infrastructure/facade-adapters.js';
import { PrismaWorkOrderRepository } from './infrastructure/prisma-work-order.repository.js';
import { PrismaWorkOrderQueries } from './infrastructure/prisma-work-orders.queries.js';
import { AdminWorkOrdersController } from './presentation/admin-work-orders.controller.js';

/**
 * Work Orders (ADR-0165, ADR-0166): the service notes of the equipment a customer leaves in the physical store. It
 * reads warehouses from Inventory and accounts from Identity, through their facades (ADR-0005).
 */
@Module({
  imports: [IdentityAccessModule, InventoryModule],
  controllers: [AdminWorkOrdersController],
  providers: [
    ReceiveWorkOrder,
    UpdateWorkOrder,
    WorkOrderLifecycle,
    { provide: WorkOrderRepository, useClass: PrismaWorkOrderRepository },
    { provide: WorkOrderQueries, useClass: PrismaWorkOrderQueries },
    {
      provide: WorkOrderWarehouses,
      useClass: InventoryFacadeWorkOrderWarehouses,
    },
    { provide: WorkOrderAccounts, useClass: IdentityFacadeWorkOrderAccounts },
  ],
})
export class WorkOrdersModule {}

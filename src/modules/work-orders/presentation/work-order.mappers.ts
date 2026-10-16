import { toMoneyDto } from '../../../platform/http/money.dto.js';
import type {
  WorkOrderSummaryView,
  WorkOrderView,
} from '../application/work-orders.queries.js';
import type { WorkOrderDto, WorkOrderSummaryDto } from './work-order.dto.js';

export function toWorkOrderSummaryDto(
  view: WorkOrderSummaryView,
): WorkOrderSummaryDto {
  return {
    id: view.id,
    folio: view.folio,
    status: view.status,
    customerName: view.customerName,
    customerPhone: view.customerPhone,
    equipmentType: view.equipmentType,
    equipmentBrand: view.equipmentBrand,
    equipmentModel: view.equipmentModel,
    serialNumber: view.serialNumber,
    warehouseId: view.warehouseId,
    technicianId: view.technicianId,
    receivedAt: view.receivedAt,
    closedAt: view.closedAt,
  };
}

export function toWorkOrderDto(view: WorkOrderView): WorkOrderDto {
  return {
    ...toWorkOrderSummaryDto(view),
    customerId: view.customerId,
    customerEmail: view.customerEmail,
    accessories: view.accessories,
    equipmentCondition: view.equipmentCondition,
    reportedFault: view.reportedFault,
    diagnosis: view.diagnosis,
    workPerformed: view.workPerformed,
    estimatedCost:
      view.estimatedCost === null ? null : toMoneyDto(view.estimatedCost),
    receivedBy: view.receivedBy,
    version: view.version,
    statusHistory: view.statusHistory.map((entry) => ({
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      actorId: entry.actorId,
      note: entry.note,
      occurredAt: entry.occurredAt,
    })),
  };
}

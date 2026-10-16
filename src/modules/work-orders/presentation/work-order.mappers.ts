import { toMoneyDto } from '../../../platform/http/money.dto.js';
import type {
  ServiceNote,
  WorkOrderDetail,
} from '../application/work-order-reader.js';
import type { WorkOrderSummaryView } from '../application/work-orders.queries.js';
import type {
  ServiceNoteDto,
  WorkOrderDto,
  WorkOrderSummaryDto,
} from './work-order.dto.js';

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

export function toWorkOrderDto(view: WorkOrderDetail): WorkOrderDto {
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
    blockedAt: view.blockedAt,
    anonymizedAt: view.anonymizedAt,
    version: view.version,
    statusHistory: view.statusHistory.map((entry) => ({
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      actorId: entry.actorId,
      note: entry.note,
      occurredAt: entry.occurredAt,
    })),
    sales: view.sales.map((sale) => ({
      orderId: sale.orderId,
      publicCode: sale.publicCode,
      orderNumber: sale.orderNumber,
      status: sale.status,
      paid: sale.payment === 'PAID',
      grandTotal: toMoneyDto(sale.grandTotal),
      placedAt: sale.placedAt,
      paidAt: sale.paidAt,
      linkedBy: sale.linkedBy,
      linkedAt: sale.linkedAt,
    })),
    paidTotal: toMoneyDto(view.paidTotal),
    unpaidTotal: toMoneyDto(view.unpaidTotal),
  };
}

export function toServiceNoteDto(note: ServiceNote): ServiceNoteDto {
  return {
    workOrder: toWorkOrderDto(note.workOrder),
    store: { ...note.store },
    terms: note.terms,
  };
}

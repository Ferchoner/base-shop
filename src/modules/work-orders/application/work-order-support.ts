import { NotFoundError } from '../../../shared-kernel/index.js';
import type { UserId, WorkOrder, WorkOrderId } from '../domain/work-order.js';
import type { WorkOrderRepository } from '../domain/work-order.repository.js';
import type { WorkOrderAccounts } from './work-order-ports.js';

/**
 * What the audit trail keeps of a work order (ADR-0100): its data. The email and the phone are always recorded
 * only as changed (ADR-0067); so are the fields of `PERSONAL_WORK_ORDER_FIELDS`.
 */
export function auditedWorkOrderFields(
  workOrder: WorkOrder,
): Record<string, unknown> {
  const { snapshot } = workOrder;
  return {
    customerId: snapshot.customerId,
    customerName: snapshot.customerName,
    customerPhone: snapshot.customerPhone,
    customerEmail: snapshot.customerEmail,
    equipmentType: snapshot.equipmentType,
    equipmentBrand: snapshot.equipmentBrand,
    equipmentModel: snapshot.equipmentModel,
    serialNumber: snapshot.serialNumber,
    accessories: snapshot.accessories,
    equipmentCondition: snapshot.equipmentCondition,
    reportedFault: snapshot.reportedFault,
    diagnosis: snapshot.diagnosis,
    workPerformed: snapshot.workPerformed,
    estimatedCost: snapshot.estimatedCost?.amount ?? null,
    technicianId: snapshot.technicianId,
  };
}

/**
 * Fields of `auditedWorkOrderFields` recorded only as changed: the name of the customer and the serial number of
 * their equipment identify them, and the texts are long and may hold personal data.
 */
export const PERSONAL_WORK_ORDER_FIELDS = [
  'customerName',
  'serialNumber',
  'accessories',
  'equipmentCondition',
  'reportedFault',
  'diagnosis',
  'workPerformed',
];

/** @throws NotFoundError when it does not exist. */
export async function findWorkOrder(
  workOrders: WorkOrderRepository,
  id: WorkOrderId,
): Promise<WorkOrder> {
  const workOrder = await workOrders.find(id);
  if (workOrder === null) throw new NotFoundError('WorkOrder', id);
  return workOrder;
}

/**
 * Checks the accounts a work order is linked to: a registered customer must be ACTIVE, and a technician an ACTIVE
 * staff member. `undefined` and `null` check nothing.
 *
 * @throws NotFoundError for either.
 */
export async function assertAccounts(
  accounts: WorkOrderAccounts,
  linked: { customerId?: UserId | null; technicianId?: UserId | null },
): Promise<void> {
  const { customerId, technicianId } = linked;
  if (
    customerId !== undefined &&
    customerId !== null &&
    !(await accounts.isActiveCustomer(customerId))
  ) {
    throw new NotFoundError('Customer', customerId);
  }
  if (
    technicianId !== undefined &&
    technicianId !== null &&
    !(await accounts.isActiveStaff(technicianId))
  ) {
    throw new NotFoundError('Staff', technicianId);
  }
}

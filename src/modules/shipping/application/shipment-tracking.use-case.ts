import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { ShipmentId } from '../domain/shipment.js';
import { ShipmentRepository } from '../domain/shipment.repository.js';

/** The carrier and tracking number to record, or `null` for both to remove them (ADR-0141). */
export type Tracking =
  | { readonly carrierName: string; readonly trackingNumber: string }
  | { readonly carrierName: null; readonly trackingNumber: null };

/**
 * The staff records the carrier and the tracking number of a shipment (UC-SHI-04, BR-SHP-04, ADR-0140), or removes
 * them while it is PENDING (ADR-0141): with the shipment locked and its `version` compared. Audited as
 * `shipments.update`; recording the values it has saves and audits nothing.
 */
@Injectable()
export class ShipmentTracking {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /**
   * @throws NotFoundError; VersionConflictError; InvalidStateTransitionError unless PENDING or DISPATCHED by a
   *   carrier, or unless PENDING to remove them.
   */
  record(
    input: Tracking & { shipmentId: ShipmentId; version: number },
  ): Promise<void> {
    return this.transactions.run(async () => {
      const shipment = await this.shipments.lock(input.shipmentId);
      if (shipment === null) {
        throw new NotFoundError('Shipment', input.shipmentId);
      }
      assertVersion(shipment.version, input.version);
      const { carrierName, trackingNumber } = shipment.snapshot;
      const changed =
        input.carrierName === null
          ? shipment.removeTracking()
          : shipment.recordTracking(input.carrierName, input.trackingNumber);
      if (!changed) return;
      await this.shipments.save(shipment, this.clock.now());
      await this.audit.record({
        action: 'shipments.update',
        resource: { type: 'shipment', id: shipment.id },
        changes: changesBetween(
          { carrierName, trackingNumber },
          {
            carrierName: input.carrierName,
            trackingNumber: input.trackingNumber,
          },
        ),
      });
    });
  }
}

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

/**
 * The staff records the carrier and the tracking number of a shipment (UC-SHI-04, BR-SHP-04, ADR-0140): with the
 * shipment locked and its `version` compared. Audited as `shipments.update`; recording the same values saves and
 * audits nothing.
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
   *   carrier.
   */
  record(input: {
    shipmentId: ShipmentId;
    carrierName: string;
    trackingNumber: string;
    version: number;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const shipment = await this.shipments.lock(input.shipmentId);
      if (shipment === null) {
        throw new NotFoundError('Shipment', input.shipmentId);
      }
      assertVersion(shipment.version, input.version);
      const { carrierName, trackingNumber } = shipment.snapshot;
      if (!shipment.recordTracking(input.carrierName, input.trackingNumber)) {
        return;
      }
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

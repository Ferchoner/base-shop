import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  type DomainEvent,
  DomainEventPublisher,
  eventMetadata,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { Shipment, ShipmentId } from '../domain/shipment.js';
import { ShipmentRepository } from '../domain/shipment.repository.js';
import type {
  ShipmentDelivered,
  ShipmentDispatched,
  ShipmentReturned,
} from './shipment-events.js';

/** A change of a shipment by the staff: which one, at the `version` they read. */
interface ShipmentChange {
  readonly shipmentId: ShipmentId;
  readonly version: number;
}

/**
 * The staff moves a shipment along its way (UC-SHI-05 to 07 and 09, BR-SHP-09, ADR-0141): dispatched, delivered, a
 * failed delivery and the return of its goods. Each change locks the shipment, compares its `version` and is
 * audited; dispatching and delivering publish the event Ordering follows, after the commit (ADR-0098).
 */
@Injectable()
export class ShipmentDelivery {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * @throws NotFoundError; VersionConflictError; InvalidStateTransitionError unless PENDING; DispatchTrackingError
   *   when its tracking does not fit the way it leaves (BR-SHP-04, ADR-0078).
   */
  dispatch(input: ShipmentChange & { ownDelivery: boolean }): Promise<void> {
    return this.change(input, 'shipments.dispatch', null, (shipment, now) => {
      shipment.dispatch(input.ownDelivery, now);
      const s = shipment.snapshot;
      const dispatched: ShipmentDispatched = {
        ...eventMetadata('ShipmentDispatched', now),
        shipmentId: s.id,
        orderId: s.orderId,
        carrierName: s.carrierName,
        trackingNumber: s.trackingNumber,
        ownDelivery: s.ownDelivery,
      };
      return dispatched;
    });
  }

  /** @throws NotFoundError; VersionConflictError; InvalidStateTransitionError unless DISPATCHED. */
  deliver(input: ShipmentChange): Promise<void> {
    return this.change(input, 'shipments.deliver', null, (shipment, now) => {
      shipment.deliver(now);
      const s = shipment.snapshot;
      const delivered: ShipmentDelivered = {
        ...eventMetadata('ShipmentDelivered', now),
        shipmentId: s.id,
        orderId: s.orderId,
        dispatchedAt: s.dispatchedAt!,
      };
      return delivered;
    });
  }

  /** @throws NotFoundError; VersionConflictError; InvalidStateTransitionError unless DISPATCHED. */
  failDelivery(input: ShipmentChange & { note: string | null }): Promise<void> {
    return this.change(
      input,
      'shipments.delivery-failure',
      input.note,
      (shipment, now) => {
        shipment.failDelivery(input.note, now);
        return null;
      },
    );
  }

  /** @throws NotFoundError; VersionConflictError; InvalidStateTransitionError unless DELIVERY_FAILED. */
  markReturned(input: ShipmentChange & { note: string | null }): Promise<void> {
    return this.change(
      input,
      'shipments.return',
      input.note,
      (shipment, now) => {
        shipment.markReturned(input.note, now);
        const s = shipment.snapshot;
        const returned: ShipmentReturned = {
          ...eventMetadata('ShipmentReturned', now),
          shipmentId: s.id,
          orderId: s.orderId,
        };
        return returned;
      },
    );
  }

  private change(
    input: ShipmentChange,
    action: string,
    reason: string | null,
    move: (shipment: Shipment, now: Date) => DomainEvent | null,
  ): Promise<void> {
    return this.transactions.run(async () => {
      const shipment = await this.shipments.lock(input.shipmentId);
      if (shipment === null) {
        throw new NotFoundError('Shipment', input.shipmentId);
      }
      assertVersion(shipment.version, input.version);
      const before = shipment.snapshot;
      const now = this.clock.now();
      const event = move(shipment, now);
      await this.shipments.save(shipment, now);
      const after = shipment.snapshot;
      await this.audit.record({
        action,
        resource: { type: 'shipment', id: shipment.id },
        changes: changesBetween(
          { status: before.status, ownDelivery: before.ownDelivery },
          { status: after.status, ownDelivery: after.ownDelivery },
        ),
        ...(reason === null ? {} : { reason }),
      });
      if (event !== null) this.events.publish(event);
    });
  }
}

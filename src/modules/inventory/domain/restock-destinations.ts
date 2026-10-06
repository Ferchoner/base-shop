import type { VariantId } from './stock.js';
import type { RestockOrigin } from './stock-ledger.repository.js';
import type { WarehouseId } from './warehouse.js';

/** Units of a line of an order that come back, and the warehouse they come back to. */
export interface RestockDestination {
  readonly orderLineId: string;
  readonly variantId: VariantId;
  readonly warehouseId: WarehouseId;
  readonly quantity: number;
}

/**
 * Sends the units of each line back to the warehouses its variant left from (ADR-0160), in the order of the
 * origins, each up to the units that can still come back there. A line that left one warehouse has one
 * destination; one that left several, as a split order would, has one per warehouse.
 *
 * @throws Error when the origins cannot take a line back, which the limit of what each line sold rules out.
 */
export function restockDestinations(
  lines: readonly {
    readonly orderLineId: string;
    readonly variantId: VariantId;
    readonly quantity: number;
  }[],
  origins: readonly RestockOrigin[],
): RestockDestination[] {
  const left = origins.map((origin) => ({ ...origin }));
  const destinations: RestockDestination[] = [];
  for (const { orderLineId, variantId, quantity } of lines) {
    let pending = quantity;
    for (const origin of left) {
      if (pending === 0) break;
      if (origin.variantId !== variantId || origin.units <= 0) continue;
      const units = Math.min(pending, origin.units);
      destinations.push({
        orderLineId,
        variantId,
        warehouseId: origin.warehouseId,
        quantity: units,
      });
      origin.units -= units;
      pending -= units;
    }
    if (pending > 0) {
      throw new Error(`Line ${orderLineId} has no warehouse to come back to`);
    }
  }
  return destinations;
}

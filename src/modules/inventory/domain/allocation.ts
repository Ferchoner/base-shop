import type { StockRequest } from './reservation.js';
import type { VariantId } from './stock.js';
import type { WarehouseId } from './warehouse.js';

/**
 * An active warehouse as the allocation sees it: the units it has available (`onHand - reserved`) of each
 * variant asked for. A variant it has no stock item of has none.
 */
export interface WarehouseStock {
  readonly warehouseId: WarehouseId;
  readonly available: ReadonlyMap<VariantId, number>;
}

/** Units of an order that one warehouse holds: a group of its allocation (ADR-0160). */
export interface Allocation {
  readonly warehouseId: WarehouseId;
  readonly lines: readonly StockRequest[];
}

/**
 * How the units of an order are spread over the active warehouses (ADR-0160). It answers the candidate plans
 * best first, each plan a group per warehouse; the reservation tries them in turn, because the stock it read
 * may be gone when it reserves. Splitting an order would be another policy with plans of several groups.
 */
export interface AllocationPolicy {
  plans(
    warehouses: readonly WarehouseStock[],
    requests: readonly StockRequest[],
  ): Allocation[][];
}

/** The requests a warehouse cannot fulfill with the units it has available, in the order asked. */
export function shortIn(
  warehouse: WarehouseStock,
  requests: readonly StockRequest[],
): VariantId[] {
  return requests
    .filter(
      ({ variantId, quantity }) =>
        (warehouse.available.get(variantId) ?? 0) < quantity,
    )
    .map(({ variantId }) => variantId);
}

/**
 * Every unit of an order from one warehouse (ADR-0160): the warehouses that hold all of it, in the order they
 * come, which is their priority.
 */
export const ONE_WAREHOUSE_PER_ORDER: AllocationPolicy = {
  plans: (warehouses, requests) =>
    warehouses
      .filter((warehouse) => shortIn(warehouse, requests).length === 0)
      .map(({ warehouseId }) => [{ warehouseId, lines: requests }]),
};

/**
 * Whether some warehouse alone fulfills each request: what a line can be, on its own (BR-INV-12).
 * Requests of one variant must come added up.
 */
export function fulfillableAlone(
  warehouses: readonly WarehouseStock[],
  requests: readonly StockRequest[],
): Map<VariantId, boolean> {
  return new Map(
    requests.map(({ variantId, quantity }) => [
      variantId,
      warehouses.some(
        ({ available }) => (available.get(variantId) ?? 0) >= quantity,
      ),
    ]),
  );
}

/**
 * The requests the closest warehouse leaves out (ADR-0160): the one that leaves out fewest, the first by priority
 * on a tie. Without them, the order fits in that warehouse. Every request when no warehouse is active.
 */
export function shortInClosest(
  warehouses: readonly WarehouseStock[],
  requests: readonly StockRequest[],
): VariantId[] {
  let closest = requests.map(({ variantId }) => variantId);
  for (const warehouse of warehouses) {
    const short = shortIn(warehouse, requests);
    if (short.length < closest.length) closest = short;
  }
  return closest;
}

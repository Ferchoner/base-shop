import { toMoneyDto } from '../../../platform/http/money.dto.js';
import type { CartView } from '../application/cart-views.js';
import type { CartDto } from './cart.dto.js';

/** `Cart` of API_SPEC.md §8.6: prices and availability as read now, never units in stock (ADR-0061). */
export function toCartDto(view: CartView): CartDto {
  return {
    id: view.id,
    status: view.status,
    lines: view.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      product: { ...line.product },
      sku: line.sku,
      options: { ...line.options },
      image: line.image === null ? null : { ...line.image },
      sellable: line.sellable,
      canFulfill: line.canFulfill,
      unitPrice: line.unitPrice === null ? null : toMoneyDto(line.unitPrice),
      lineTotal: line.lineTotal === null ? null : toMoneyDto(line.lineTotal),
    })),
    itemCount: view.itemCount,
    subtotal: toMoneyDto(view.subtotal),
    lastActivityAt: view.lastActivityAt,
  };
}

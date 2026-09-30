import { ApiProperty } from '@nestjs/swagger';
import type { Money } from '../../shared-kernel/index.js';

/** `Money` of API_SPEC.md §8.1: cents and currency (ADR-0007, ADR-0026). */
export class MoneyDto {
  /**
   * Centavos, entero.
   * @example 9900
   */
  amount: number;

  @ApiProperty({ enum: ['MXN'], example: 'MXN' })
  currency: string;
}

export function toMoneyDto(money: Money): MoneyDto {
  return { amount: money.amount, currency: money.currency };
}

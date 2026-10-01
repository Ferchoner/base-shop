import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { MoneyDto } from '../../../platform/http/money.dto.js';
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
} from '../application/payment-ports.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

/** Request of `POST /v1/me/orders/{publicCode}/payments` (UC-PAY-01, API_SPEC.md §16.2). */
export class StartCustomerPaymentDto {
  @ApiProperty({
    enum: PAYMENT_PROVIDERS,
    description:
      'Hoy solo `MANUAL`, y solo si el pago manual está habilitado; PayPal no está habilitado (ADR-0040).',
  })
  @IsIn(PAYMENT_PROVIDERS)
  provider: PaymentProvider;
}

/** Request of `POST /v1/orders/{publicCode}/payments` (UC-PAY-01, API_SPEC.md §16.2). */
export class StartGuestPaymentDto extends StartCustomerPaymentDto {
  /** El carrito de origen de la orden: prueba que quien paga es quien compró (ADR-0063). */
  @IsUUID('all')
  cartId: string;
}

/** What the customer must do to pay (API_SPEC.md §16.2). */
export class PaymentActionDto {
  @ApiProperty({
    enum: ['PAY_IN_STORE'],
    description: 'Extensible: `REDIRECT` llegará con PayPal.',
  })
  type: string;

  /** @example 'K7M4-Q9XA' */
  orderCode: string;

  @ApiProperty({ type: () => MoneyDto })
  amount: MoneyDto;

  /** @example 'Presenta este código en la tienda para pagar.' */
  instructions: string;
}

/** Response of starting a payment (API_SPEC.md §16.2). */
export class PaymentStartDto {
  paymentId: string;

  @ApiProperty({ enum: PAYMENT_PROVIDERS })
  provider: string;

  @ApiProperty({ enum: ['PENDING'] })
  status: string;

  @ApiProperty({ type: () => MoneyDto })
  amount: MoneyDto;

  @ApiProperty({ type: () => PaymentActionDto })
  action: PaymentActionDto;
}

/** Request of `POST /v1/admin/orders/{orderId}/manual-capture` (UC-PAY-02, ADR-0134). */
export class ManualCaptureDto {
  /**
   * Comprobante de la tienda, de 1 a 100 caracteres.
   * @example 'Ticket 00452'
   */
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  reference: string;

  /**
   * Nota de hasta 500 caracteres; queda en la auditoría: no escribas datos personales.
   * @example 'Pagó en efectivo'
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

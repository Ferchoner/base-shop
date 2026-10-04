import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import {
  PageMetaDto,
  PageQueryDto,
} from '../http/pagination/page-query.dto.js';
import { CommaSeparated, IsSortOf } from '../http/pagination/pagination.js';
import { DELIVERY_STATUSES, type DeliveryStatus } from './event-deliveries.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

/** An event type, such as `PaymentCaptured`. */
const EVENT_TYPE = /^[A-Z][A-Za-z]*$/;

/** A handler, such as `PaymentCapturedHandler.onPaymentCaptured`. */
const HANDLER = /^[A-Z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;

const NAME_MESSAGE = {
  context: { message: 'No es un nombre de evento o de manejador válido.' },
};

/** The filters a bulk retry and a listing share. */
class DeliveryTargetDto {
  /**
   * Tipo de evento, como `PaymentCaptured`.
   * @example 'PaymentCaptured'
   */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(EVENT_TYPE, NAME_MESSAGE)
  eventType?: string;

  /**
   * Manejador, como `PaymentCapturedHandler.onPaymentCaptured`.
   * @example 'PaymentCapturedHandler.onPaymentCaptured'
   */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Matches(HANDLER, NAME_MESSAGE)
  handler?: string;
}

/** Query of `GET /v1/admin/event-deliveries` (API_SPEC.md §22.1). */
export class EventDeliveryListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    type: String,
    description: `Uno o más estados separados por comas: ${DELIVERY_STATUSES.map((status) => `\`${status}\``).join(', ')}. Por defecto, \`FAILED\`.`,
    example: 'FAILED',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(DELIVERY_STATUSES, { each: true })
  status?: DeliveryStatus[];

  /**
   * Tipo de evento, como `PaymentCaptured`.
   * @example 'PaymentCaptured'
   */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(EVENT_TYPE, NAME_MESSAGE)
  eventType?: string;

  /**
   * Manejador, como `PaymentCapturedHandler.onPaymentCaptured`.
   * @example 'PaymentCapturedHandler.onPaymentCaptured'
   */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Matches(HANDLER, NAME_MESSAGE)
  handler?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Campos: `occurredAt` (fecha del evento) y `nextAttemptAt`, con `-` para orden descendente. Por defecto, `-occurredAt`.',
    example: '-occurredAt',
  })
  @IsOptional()
  @IsSortOf(['occurredAt', 'nextAttemptAt'])
  sort?: string;
}

/** Request of `POST /v1/admin/event-deliveries/retry` (API_SPEC.md §22.3): without filters, every failed delivery. */
export class RetryDeliveriesDto extends DeliveryTargetDto {}

/** Answer of a bulk retry. */
export class RetriedDeliveriesDto {
  /** Entregas fallidas que volvieron a quedar pendientes. */
  retried: number;
}

/** `EventDelivery` of API_SPEC.md §22.1: the delivery of a domain event to one handler (ADR-0150). */
export class EventDeliveryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** El evento que se entrega. */
  @ApiProperty({ format: 'uuid' })
  eventId: string;

  /**
   * El tipo del evento.
   * @example 'PaymentCaptured'
   */
  eventType: string;

  /** Cuándo ocurrió el evento. */
  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt: Date;

  /**
   * El manejador que lo recibe, como clase y método.
   * @example 'PaymentCapturedHandler.onPaymentCaptured'
   */
  handler: string;

  /** `PENDING` mientras le quedan intentos, `DELIVERED` al entregarse y `FAILED` al agotar los 8. */
  @ApiProperty({ enum: DELIVERY_STATUSES })
  status: DeliveryStatus;

  /** Intentos hechos; hasta 8. */
  attempts: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Cuándo se reintenta, si está pendiente.',
  })
  nextAttemptAt: Date;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Clase y mensaje del último fallo, redactados como los logs y de hasta 500 caracteres.',
  })
  lastError: string | null;

  /** Cuándo se entregó; `null` si no se ha entregado. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deliveredAt: Date | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'El evento completo, como lo recibe el manejador. Nunca lleva datos personales.',
  })
  event: Record<string, unknown>;
}

export class EventDeliveryListDto {
  @ApiProperty({ type: () => [EventDeliveryDto] })
  data: EventDeliveryDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

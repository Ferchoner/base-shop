import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  PageMetaDto,
  PageQueryDto,
} from '../../../platform/http/pagination/page-query.dto.js';
import {
  CommaSeparated,
  IsSortOf,
} from '../../../platform/http/pagination/pagination.js';
import {
  SHIPMENT_STATUSES,
  type ShipmentStatus,
} from '../application/shipment-values.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments;
// fields holding other DTOs, lists, dates, enums, objects or null declare their type with @ApiProperty
// (DEVELOPMENT_GUIDE.md).

const ANONYMIZED = {
  type: String,
  nullable: true,
  description: '`null` cuando la orden está anonimizada (ADR-0067).',
} as const;

/**
 * Where a shipment goes: the shipping address of its order (API_SPEC.md §8.2). Once the order is anonymized it keeps
 * only the state, the municipality, the postal code and the country, and the rest is `null` (ADR-0067).
 */
export class ShipmentAddressDto {
  @ApiProperty(ANONYMIZED)
  recipientName: string | null;

  @ApiProperty(ANONYMIZED)
  phone: string | null;

  @ApiProperty(ANONYMIZED)
  street: string | null;

  @ApiProperty(ANONYMIZED)
  exteriorNumber: string | null;

  /** `null` sin número interior, o con los datos bloqueados o anonimizados. */
  @ApiProperty({ type: String, nullable: true })
  interiorNumber: string | null;

  @ApiProperty(ANONYMIZED)
  neighborhood: string | null;

  postalCode: string;

  /** Clave del INEGI del estado. */
  stateCode: string;

  stateName: string;

  /** Clave del INEGI del municipio. */
  municipalityCode: string;

  municipalityName: string;

  /** `null` si no se dio, o con los datos bloqueados o anonimizados. */
  @ApiProperty({ type: String, nullable: true })
  city: string | null;

  /** `null` si no se dieron, o con los datos bloqueados o anonimizados. */
  @ApiProperty({ type: String, nullable: true })
  references: string | null;

  /**
   * Siempre `MX` (ADR-0026).
   * @example 'MX'
   */
  country: string;
}

/** A line of the order that the shipment carries (API_SPEC.md §17). */
export class ShipmentItemDto {
  /** La línea de la orden. */
  @ApiProperty({ format: 'uuid' })
  orderLineId: string;

  sku: string;

  /** El nombre del producto al colocar la orden. */
  productName: string;

  /** Unidades de la línea. */
  quantity: number;
}

/** `AdminShipment` of API_SPEC.md §17. */
export class AdminShipmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** La orden del envío. */
  @ApiProperty({ format: 'uuid' })
  orderId: string;

  /** Código público de la orden. @example 'K7M4-Q9XA' */
  orderCode: string;

  /** El almacén desde el que sale. */
  @ApiProperty({ format: 'uuid' })
  warehouseId: string;

  /**
   * `PENDING` hasta que sale; luego `DISPATCHED`, y `DELIVERED`, `DELIVERY_FAILED` o `RETURNED`. `CANCELLED` si se
   * canceló la orden antes de salir.
   */
  @ApiProperty({ enum: SHIPMENT_STATUSES })
  status: ShipmentStatus;

  @ApiProperty({
    type: () => ShipmentAddressDto,
    description:
      'Sin quién recibe ni dónde exactamente cuando los datos de la orden están bloqueados o anonimizados (ADR-0070).',
  })
  destination: ShipmentAddressDto;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Cuándo se bloquearon los datos personales de la orden, y con ellos el destino (ADR-0070).',
  })
  blockedAt: Date | null;

  @ApiProperty({
    type: () => [ShipmentItemDto],
    description: 'En el orden de las líneas de la orden.',
  })
  items: ShipmentItemDto[];

  /** La paquetería; `null` mientras no se capture o en una entrega de la tienda. */
  @ApiProperty({ type: String, nullable: true })
  carrierName: string | null;

  /** El número de guía; `null` mientras no se capture o en una entrega de la tienda. */
  @ApiProperty({ type: String, nullable: true })
  trackingNumber: string | null;

  /** Entrega propia de la tienda, sin paquetería ni guía (ADR-0078). */
  ownDelivery: boolean;

  /** Cuándo salió; `null` si no ha ocurrido. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  dispatchedAt: Date | null;

  /** Cuándo se entregó; `null` si no ha ocurrido. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deliveredAt: Date | null;

  /** Cuándo falló la entrega; `null` si no ha ocurrido. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  failedAt: Date | null;

  /** Cuándo regresó; `null` si no ha ocurrido. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  returnedAt: Date | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Cuando la orden se canceló antes de que el envío saliera (ADR-0140).',
  })
  cancelledAt: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Por qué falló la entrega, según el staff (ADR-0141).',
  })
  failureNote: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Qué regresó, según el staff (ADR-0141).',
  })
  returnNote: string | null;

  /** Versión para el bloqueo optimista. */
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class AdminShipmentListDto {
  @ApiProperty({ type: () => [AdminShipmentDto] })
  data: AdminShipmentDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

/** Query of `GET /v1/admin/shipping/shipments` (UC-SHI-08, API_SPEC.md §17). */
export class AdminShipmentListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    type: String,
    description: `Uno o más estados separados por comas: ${SHIPMENT_STATUSES.map((status) => `\`${status}\``).join(', ')}. Por defecto \`PENDING\`, los envíos por despachar.`,
    example: 'PENDING',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(SHIPMENT_STATUSES, { each: true })
  status?: ShipmentStatus[];

  /** El envío de una orden. */
  @IsOptional()
  @IsUUID('all')
  orderId?: string;

  /** Los envíos que salen de este almacén (ADR-0160). */
  @IsOptional()
  @IsUUID('all')
  warehouseId?: string;

  /**
   * El código público de la orden, con o sin guion, o el número de guía, sin distinguir mayúsculas y minúsculas.
   * @example 'K7M4-Q9XA'
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Fecha o fecha y hora ISO 8601; incluida. @example '2026-10-01' */
  @IsOptional()
  @IsISO8601({ strict: true })
  createdFrom?: string;

  /** Fecha o fecha y hora ISO 8601; incluida (una fecha sola incluye todo el día). @example '2026-10-31' */
  @IsOptional()
  @IsISO8601({ strict: true })
  createdTo?: string;

  /** `createdAt` o `dispatchedAt`, con `-` para orden descendente; por defecto `createdAt`, los más antiguos primero. */
  @IsOptional()
  @IsSortOf(['createdAt', 'dispatchedAt'])
  sort?: string;
}

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };

/** Request of `PATCH /v1/admin/shipping/shipments/{shipmentId}` (UC-SHI-04, API_SPEC.md §17). */
export class RecordTrackingDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Estafeta',
    description:
      'Paquetería, de 1 a 100 caracteres; `null`, junto con `trackingNumber`, para quitarlas de un envío pendiente (ADR-0141).',
  })
  @IsDefined()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  carrierName: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '8055123456',
    description:
      'Número de guía, de 1 a 100 caracteres; `null`, junto con `carrierName`, para quitarlas.',
  })
  @IsDefined()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  trackingNumber: string | null;

  /** Versión leída del envío (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

/** Request of the changes of a shipment that need only its `version` (API_SPEC.md §17). */
export class ShipmentVersionDto {
  /** Versión leída del envío (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

/** Request of `POST …/shipments/{shipmentId}/dispatch` (UC-SHI-05, ADR-0078). */
export class DispatchShipmentDto extends ShipmentVersionDto {
  /**
   * `true` si la tienda entrega el pedido, sin paquetería ni guía; por defecto `false`, por paquetería, con la
   * paquetería y la guía ya capturadas.
   */
  @IsOptional()
  @IsBoolean()
  ownDelivery?: boolean;
}

/** Request of `POST …/delivery-failure` and `POST …/return` (UC-SHI-07 and 09, ADR-0141). */
export class ShipmentNoteDto extends ShipmentVersionDto {
  /**
   * Nota de hasta 500 caracteres, que se muestra en el envío y queda en la auditoría: no escribas datos personales.
   * @example 'Nadie recibió el paquete'
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

import { ApiProperty } from '@nestjs/swagger';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments.
// Fields holding other DTOs, dates or null declare their type with @ApiProperty (DEVELOPMENT_GUIDE.md).

/** `StoreProfile` of API_SPEC.md §15.8 (ADR-0163). */
export class StoreProfileDto {
  /**
   * Nombre de la tienda (`STORE_NAME`).
   * @example 'Tienda Ejemplo'
   */
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Av. Madero Poniente 123, Centro, 58000 Morelia, Mich.',
    description:
      'Dirección de la tienda en una línea (`STORE_ADDRESS`); `null` si no se configuró.',
  })
  address: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'EJE260101AB1',
    description:
      'RFC de la tienda, en mayúsculas (`STORE_TAX_ID`); `null` si no se configuró.',
  })
  taxId: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '443 123 4567',
    description:
      'Teléfono de la tienda (`STORE_PHONE`); `null` si no se configuró.',
  })
  phone: string | null;

  /**
   * Leyenda al pie del ticket (`TICKET_FOOTER`); por defecto, que no es un comprobante fiscal.
   * @example 'Este ticket no es un comprobante fiscal.'
   */
  ticketFooter: string;
}

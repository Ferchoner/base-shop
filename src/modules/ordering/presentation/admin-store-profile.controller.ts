import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import {
  STORE_PROFILE,
  type StoreProfile,
} from '../application/store-profile.js';
import { StoreProfileDto } from './store-profile.dto.js';

/**
 * The data of the store for the ticket of an order (UC-ORD-15, API_SPEC.md §15.8, ADR-0163): the client prints the
 * ticket, and the API generates no PDF. Read with `orders.read`, like the orders.
 */
@ApiTags('Administración: órdenes')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/store-profile')
export class AdminStoreProfileController {
  constructor(@Inject(STORE_PROFILE) private readonly profile: StoreProfile) {}

  @ApiOperation({
    summary: 'Consultar los datos de la tienda para el ticket',
    description:
      'Nombre, dirección, RFC, teléfono y leyenda de la tienda, iguales para todas las tiendas, de las variables de configuración: cambiarlos exige reiniciar la API (ADR-0163). El ticket no es un comprobante fiscal, y su leyenda por defecto lo dice.',
  })
  @ApiOkResponse({ type: StoreProfileDto })
  @RequirePermissions('orders.read')
  @Get()
  get(): StoreProfileDto {
    return { ...this.profile };
  }
}

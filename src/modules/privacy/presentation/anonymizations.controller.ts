import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { Anonymizations } from '../application/anonymizations.js';
import {
  AnonymizeCustomerDto,
  AnonymizeGuestDto,
  CustomerAnonymizationDto,
  GuestAnonymizationDto,
} from './anonymization.dto.js';

/**
 * The anonymizations of UC-IAM-19 (API_SPEC.md §9.18, ADR-0067), under the routes of Identity & Access. Privacy serves
 * them because they reach the orders and carts too, which Identity cannot use (ADR-0132, ADR-0145).
 */
@ApiTags('Administración: identidad')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/identity')
export class AnonymizationsController {
  constructor(private readonly anonymizations: Anonymizations) {}

  @ApiOperation({
    summary: 'Anonimizar a un cliente',
    description:
      'Irreversible. Vacía el email, los nombres y la contraseña (estado ANONYMIZED, email libre); borra sus sesiones, enlaces, direcciones y carritos; y quita el email de contacto y los datos de quien recibe de sus órdenes y envíos, que conservan estado, municipio y código postal. Si tiene órdenes sin concluir, espera a que terminen (ADR-0067, ADR-0145). El cliente queda consultable en `GET /v1/admin/identity/customers/{userId}`.',
  })
  @ApiOkResponse({ type: CustomerAnonymizationDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
    'active-orders-exist',
  )
  @RequirePermissions('customers.manage')
  @HttpCode(200)
  @Post('customers/:userId/anonymize')
  async anonymizeCustomer(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() body: AnonymizeCustomerDto,
  ): Promise<CustomerAnonymizationDto> {
    const anonymization = await this.anonymizations.customer({
      actorId: actor.id,
      userId: pathId<'User'>(userId, 'Customer'),
      reason: body.reason,
      version: body.version,
    });
    return { ...anonymization };
  }

  @ApiOperation({
    summary: 'Anonimizar a un comprador invitado',
    description:
      'Irreversible. Con el email de contacto y el código de una de sus órdenes, como la consulta de invitado: el mismo 404 si no coinciden. Anonimiza todas las órdenes de invitado con ese email y sus envíos; las de una cuenta con el mismo email no cambian. Si alguna no concluyó, no anonimiza ninguna (ADR-0067, ADR-0145).',
  })
  @ApiOkResponse({ type: GuestAnonymizationDto })
  @ApiProblemResponses('not-found', 'active-orders-exist')
  @RequirePermissions('customers.manage')
  @HttpCode(200)
  @Post('guest-anonymizations')
  async anonymizeGuest(
    @Body() body: AnonymizeGuestDto,
  ): Promise<GuestAnonymizationDto> {
    const anonymizedOrderCount = await this.anonymizations.guest({
      contactEmail: body.contactEmail,
      publicCode: body.publicCode,
      reason: body.reason,
    });
    return { anonymizedOrderCount };
  }
}

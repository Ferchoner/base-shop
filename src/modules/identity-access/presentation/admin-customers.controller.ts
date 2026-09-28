import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import {
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import {
  type CustomerSortField,
  IdentityQueries,
} from '../application/identity.queries.js';
import { ReactivateCustomer } from '../application/reactivate-customer.use-case.js';
import { SuspendCustomer } from '../application/suspend-customer.use-case.js';
import {
  AdminCustomerDto,
  CustomerListDto,
  CustomerListQueryDto,
  ReasonDto,
} from './identity-admin.dto.js';
import { pathId, toAdminCustomerDto } from './identity-admin.mappers.js';

/** A date alone as the end of a range covers the whole day (API_SPEC.md §5.3, ADR-0112). */
function rangeEnd(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T23:59:59.999Z`);
  }
  return new Date(value);
}

/**
 * Customer accounts (UC-IAM-17 and 18, API_SPEC.md §9.18). Anonymization comes with T-132 (ADR-0111).
 */
@ApiTags('Administración: identidad')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/identity/customers')
export class AdminCustomersController {
  constructor(
    private readonly queries: IdentityQueries,
    private readonly suspendCustomer: SuspendCustomer,
    private readonly reactivateCustomer: ReactivateCustomer,
  ) {}

  @ApiOperation({ summary: 'Listar clientes' })
  @ApiOkResponse({ type: CustomerListDto })
  @RequirePermissions('customers.read')
  @Get()
  async list(@Query() query: CustomerListQueryDto): Promise<CustomerListDto> {
    const page = await this.queries.listCustomers(
      {
        q: query.q,
        status: query.status,
        emailVerified: query.emailVerified,
        createdFrom:
          query.createdFrom === undefined
            ? undefined
            : new Date(query.createdFrom),
        createdTo: rangeEnd(query.createdTo),
      },
      toSortOrders<CustomerSortField>(query.sort, '-createdAt'),
      query,
    );
    return toPageResponse(page, query, toAdminCustomerDto);
  }

  @ApiOperation({
    summary: 'Consultar un cliente, con sus direcciones',
    description: '`orderCount` es 0 hasta que existan los pedidos (T-180).',
  })
  @ApiOkResponse({ type: AdminCustomerDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('customers.read')
  @Get(':userId')
  get(@Param('userId') userId: string): Promise<AdminCustomerDto> {
    return this.read(userId);
  }

  @ApiOperation({
    summary: 'Suspender a un cliente',
    description: 'Solo desde ACTIVE. Ya no puede iniciar sesión.',
  })
  @ApiOkResponse({ type: AdminCustomerDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('customers.manage')
  @HttpCode(200)
  @Post(':userId/suspend')
  async suspend(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() body: ReasonDto,
  ): Promise<AdminCustomerDto> {
    const id = pathId<'User'>(userId, 'Customer');
    await this.suspendCustomer.execute({
      actorId: toId(actor.id),
      userId: id,
      reason: body.reason,
      version: body.version,
    });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Reactivar a un cliente suspendido',
    description:
      'Solo desde SUSPENDED. Conserva su contraseña y la verificación de su email; un cliente anonimizado no se reactiva.',
  })
  @ApiOkResponse({ type: AdminCustomerDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('customers.manage')
  @HttpCode(200)
  @Post(':userId/reactivate')
  async reactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() body: ReasonDto,
  ): Promise<AdminCustomerDto> {
    const id = pathId<'User'>(userId, 'Customer');
    await this.reactivateCustomer.execute({
      actorId: toId(actor.id),
      userId: id,
      reason: body.reason,
      version: body.version,
    });
    return this.read(id);
  }

  private async read(userId: string): Promise<AdminCustomerDto> {
    const id = pathId<'User'>(userId, 'Customer');
    const customer = await this.queries.findCustomer(id);
    if (customer === null) throw new NotFoundError('Customer', id);
    return toAdminCustomerDto(customer);
  }
}

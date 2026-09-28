import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
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
  IdentityQueries,
  type StaffSortField,
} from '../application/identity.queries.js';
import { ReplaceStaffRoles } from '../application/replace-staff-roles.use-case.js';
import { SuspendStaff } from '../application/suspend-staff.use-case.js';
import {
  ReasonDto,
  ReplaceRolesDto,
  StaffListDto,
  StaffListQueryDto,
  StaffUserDto,
} from './identity-admin.dto.js';
import { pathId, toStaffUserDto } from './identity-admin.mappers.js';

/**
 * Staff accounts (UC-IAM-14 and 16, API_SPEC.md §9.17). Creating staff and reactivating it issue a temporary
 * password, so they come with T-131.
 */
@ApiTags('Administración: identidad')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@RequirePermissions('staff.manage')
@Controller('admin/identity/staff')
export class AdminStaffController {
  constructor(
    private readonly queries: IdentityQueries,
    private readonly replaceStaffRoles: ReplaceStaffRoles,
    private readonly suspendStaff: SuspendStaff,
  ) {}

  @ApiOperation({ summary: 'Listar el staff' })
  @ApiOkResponse({ type: StaffListDto })
  @Get()
  async list(@Query() query: StaffListQueryDto): Promise<StaffListDto> {
    const page = await this.queries.listStaff(
      {
        q: query.q,
        status: query.status,
        roleId:
          query.roleId === undefined ? undefined : toId<'Role'>(query.roleId),
      },
      toSortOrders<StaffSortField>(query.sort, '-createdAt'),
      query,
    );
    return toPageResponse(page, query, toStaffUserDto);
  }

  @ApiOperation({ summary: 'Consultar un miembro del staff' })
  @ApiOkResponse({ type: StaffUserDto })
  @ApiProblemResponses('not-found')
  @Get(':userId')
  get(@Param('userId') userId: string): Promise<StaffUserDto> {
    return this.read(userId);
  }

  @ApiOperation({
    summary: 'Reemplazar los roles de un miembro del staff',
    description:
      'Al menos un rol. No se quita el rol al último superadministrador activo.',
  })
  @ApiOkResponse({ type: StaffUserDto })
  @ApiProblemResponses('not-found', 'version-conflict', 'last-superadmin')
  @Put(':userId/roles')
  async replaceRoles(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() body: ReplaceRolesDto,
  ): Promise<StaffUserDto> {
    const id = pathId<'User'>(userId, 'Staff member');
    await this.replaceStaffRoles.execute({
      actorId: toId(actor.id),
      userId: id,
      roleIds: body.roleIds.map((roleId) => toId<'Role'>(roleId)),
      version: body.version,
    });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Suspender a un miembro del staff',
    description:
      'Solo desde ACTIVE. Nadie se suspende a sí mismo ni se suspende al último superadministrador activo.',
  })
  @ApiOkResponse({ type: StaffUserDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
    'last-superadmin',
  )
  @HttpCode(200)
  @Post(':userId/suspend')
  async suspend(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() body: ReasonDto,
  ): Promise<StaffUserDto> {
    const id = pathId<'User'>(userId, 'Staff member');
    await this.suspendStaff.execute({
      actorId: toId(actor.id),
      userId: id,
      reason: body.reason,
      version: body.version,
    });
    return this.read(id);
  }

  private async read(userId: string): Promise<StaffUserDto> {
    const id = pathId<'User'>(userId, 'Staff member');
    const staff = await this.queries.findStaff(id);
    if (staff === null) throw new NotFoundError('Staff member', id);
    return toStaffUserDto(staff);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import {
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import {
  IdentityQueries,
  type StaffSortField,
} from '../application/identity.queries.js';
import { CreateStaff } from '../application/create-staff.use-case.js';
import { ReactivateStaff } from '../application/reactivate-staff.use-case.js';
import { ReplaceStaffRoles } from '../application/replace-staff-roles.use-case.js';
import { SuspendStaff } from '../application/suspend-staff.use-case.js';
import {
  CreateStaffDto,
  ReasonDto,
  ReplaceRolesDto,
  StaffListDto,
  StaffListQueryDto,
  StaffUserDto,
  StaffWithTemporaryPasswordDto,
} from './identity-admin.dto.js';
import { toStaffUserDto } from './identity-admin.mappers.js';

/**
 * Staff accounts (UC-IAM-13, 14 and 16, API_SPEC.md §9.17). Creating and reactivating a staff member answer
 * its temporary password once; every response here is `Cache-Control: no-store` (ADR-0112).
 */
@ApiTags('Administración: identidad')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@RequirePermissions('staff.manage')
@Controller('admin/identity/staff')
export class AdminStaffController {
  constructor(
    private readonly queries: IdentityQueries,
    private readonly createStaff: CreateStaff,
    private readonly replaceStaffRoles: ReplaceStaffRoles,
    private readonly suspendStaff: SuspendStaff,
    private readonly reactivateStaff: ReactivateStaff,
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

  @ApiOperation({
    summary: 'Dar de alta a un miembro del staff',
    description:
      'Genera una contraseña temporal que se muestra solo en esta respuesta y se cambia en el primer inicio de sesión. No se envía invitación por correo. Quien da de alta debe tener todos los permisos de los roles, y solo un superadministrador asigna el rol superadministrador: si no, 403 `forbidden`.',
  })
  @ApiCreatedResponse({ type: StaffWithTemporaryPasswordDto })
  @ApiProblemResponses('duplicate-value')
  @Post()
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateStaffDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<StaffWithTemporaryPasswordDto> {
    const { userId, temporaryPassword } = await this.createStaff.execute({
      actorId: toId(actor.id),
      email: body.email,
      firstNames: body.firstNames,
      lastNames: body.lastNames,
      roleIds: body.roleIds.map((roleId) => toId<'Role'>(roleId)),
    });
    response.setHeader('Location', `/v1/admin/identity/staff/${userId}`);
    return { user: await this.read(userId), temporaryPassword };
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
      'Al menos un rol. No se quita el rol al último superadministrador activo. Los roles que se agregan siguen la regla del alta: quien los asigna tiene todos sus permisos, y el rol superadministrador solo lo asigna otro superadministrador (403 `forbidden`).',
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

  @ApiOperation({
    summary: 'Reactivar a un miembro del staff',
    description:
      'Solo desde SUSPENDED. Conserva sus roles y recibe una contraseña temporal nueva, que se muestra solo en esta respuesta y se cambia en el siguiente inicio de sesión. Como quien reactiva recibe esa contraseña, debe poder asignar todos sus roles (403 `forbidden`).',
  })
  @ApiOkResponse({ type: StaffWithTemporaryPasswordDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @HttpCode(200)
  @Post(':userId/reactivate')
  async reactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() body: ReasonDto,
  ): Promise<StaffWithTemporaryPasswordDto> {
    const id = pathId<'User'>(userId, 'Staff member');
    const { temporaryPassword } = await this.reactivateStaff.execute({
      actorId: toId(actor.id),
      userId: id,
      reason: body.reason,
      version: body.version,
    });
    return { user: await this.read(id), temporaryPassword };
  }

  private async read(userId: string): Promise<StaffUserDto> {
    const id = pathId<'User'>(userId, 'Staff member');
    const staff = await this.queries.findStaff(id);
    if (staff === null) throw new NotFoundError('Staff member', id);
    return toStaffUserDto(staff);
  }
}

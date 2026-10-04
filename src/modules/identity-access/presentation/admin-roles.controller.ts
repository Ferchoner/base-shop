import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
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
import {
  NotFoundError,
  PERMISSION_CODES,
  PERMISSIONS,
  toId,
} from '../../../shared-kernel/index.js';
import { CreateRole } from '../application/create-role.use-case.js';
import { DeleteRole } from '../application/delete-role.use-case.js';
import {
  IdentityQueries,
  type RoleSortField,
} from '../application/identity.queries.js';
import { UpdateRole } from '../application/update-role.use-case.js';
import {
  CreateRoleDto,
  PermissionListDto,
  RoleDto,
  RoleListDto,
  RoleListQueryDto,
  UpdateRoleDto,
} from './identity-admin.dto.js';
import { toRoleDto } from './identity-admin.mappers.js';

/** Catalog of permissions in code (API_SPEC.md §9.15, ADR-0111). */
@ApiTags('Administración: identidad')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/identity/permissions')
export class AdminPermissionsController {
  @ApiOperation({ summary: 'Catálogo de permisos' })
  @ApiOkResponse({ type: PermissionListDto })
  @RequirePermissions('staff.manage')
  @Get()
  list(): PermissionListDto {
    return {
      data: PERMISSION_CODES.map((code) => ({
        code,
        description: PERMISSIONS[code],
      })),
    };
  }
}

/** Staff roles (UC-IAM-15, API_SPEC.md §9.16). */
@ApiTags('Administración: identidad')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@RequirePermissions('staff.manage')
@Controller('admin/identity/roles')
export class AdminRolesController {
  constructor(
    private readonly queries: IdentityQueries,
    private readonly createRole: CreateRole,
    private readonly updateRole: UpdateRole,
    private readonly deleteRole: DeleteRole,
  ) {}

  @ApiOperation({ summary: 'Listar roles' })
  @ApiOkResponse({ type: RoleListDto })
  @Get()
  async list(@Query() query: RoleListQueryDto): Promise<RoleListDto> {
    const page = await this.queries.listRoles(
      { q: query.q },
      toSortOrders<RoleSortField>(query.sort, 'name'),
      query,
    );
    return toPageResponse(page, query, toRoleDto);
  }

  @ApiOperation({
    summary: 'Crear un rol',
    description:
      'Solo con permisos que tiene quien lo crea: uno que no tiene responde 403 `forbidden`.',
  })
  @ApiCreatedResponse({ type: RoleDto })
  @ApiProblemResponses('duplicate-value')
  @Post()
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateRoleDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<RoleDto> {
    const id = await this.createRole.execute({
      actorId: toId(actor.id),
      name: body.name,
      description: body.description ?? null,
      permissions: body.permissions,
    });
    response.setHeader('Location', `/v1/admin/identity/roles/${id}`);
    return this.read(id);
  }

  @ApiOperation({ summary: 'Consultar un rol' })
  @ApiOkResponse({ type: RoleDto })
  @ApiProblemResponses('not-found')
  @Get(':roleId')
  get(@Param('roleId') roleId: string): Promise<RoleDto> {
    return this.read(roleId);
  }

  @ApiOperation({
    summary: 'Editar un rol',
    description:
      'Los permisos del rol superadministrador no cambian: siempre tiene todos. Solo se agregan permisos que tiene quien edita: uno que no tiene responde 403 `forbidden`; quitar permisos no tiene esa restricción.',
  })
  @ApiOkResponse({ type: RoleDto })
  @ApiProblemResponses('not-found', 'duplicate-value', 'version-conflict')
  @Patch(':roleId')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('roleId') roleId: string,
    @Body() body: UpdateRoleDto,
  ): Promise<RoleDto> {
    const id = pathId<'Role'>(roleId, 'Role');
    await this.updateRole.execute(id, { ...body, actorId: toId(actor.id) });
    return this.read(id);
  }

  @ApiOperation({ summary: 'Borrar un rol sin usuarios' })
  @ApiNoContentResponse()
  @ApiProblemResponses('not-found', 'resource-in-use', 'last-superadmin')
  @HttpCode(204)
  @Delete(':roleId')
  async remove(@Param('roleId') roleId: string): Promise<void> {
    await this.deleteRole.execute(pathId<'Role'>(roleId, 'Role'));
  }

  private async read(roleId: string): Promise<RoleDto> {
    const id = pathId<'Role'>(roleId, 'Role');
    const role = await this.queries.findRole(id);
    if (role === null) throw new NotFoundError('Role', id);
    return toRoleDto(role);
  }
}

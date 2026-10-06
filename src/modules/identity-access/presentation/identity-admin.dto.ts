import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
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
import { PERMISSION_CODES } from '../../../shared-kernel/index.js';
import { AddressDto } from './address.dto.js';

// Plain string, number and boolean fields are documented by the Swagger plugin from their types and comments.
// Fields holding other DTOs, lists, dates or null declare their type with @ApiProperty: the plugin resolves
// those only with the type checker of `nest build`, not in the tests (ADR-0109, ADR-0112).

const NOT_BLANK = { context: { message: 'No puede estar vacío.' } };
const DATE_TIME = { type: String, format: 'date-time' } as const;
const NULLABLE_DATE_TIME = { ...DATE_TIME, nullable: true } as const;
const NULLABLE_TEXT = { type: String, nullable: true } as const;
const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'ANONYMIZED'];

// --- Permissions (API_SPEC.md §9.15) ---

export class PermissionDto {
  /** @example 'catalog.write' */
  code: string;

  /** @example 'Gestionar productos, variantes, imágenes, categorías y marcas' */
  description: string;

  /**
   * Solo lo tiene el rol superadministrador (ADR-0162): ningún otro rol puede tenerlo, y agregarlo a uno responde
   * 400 `validation-error`.
   * @example false
   */
  superadminOnly: boolean;
}

export class PermissionListDto {
  @ApiProperty({ type: () => [PermissionDto] })
  data: PermissionDto[];
}

// --- Roles (API_SPEC.md §9.16) ---

export class RoleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** @example 'Operador' */
  name: string;

  /** `null` sin descripción. */
  @ApiProperty(NULLABLE_TEXT)
  description: string | null;

  /** El rol protegido por BR-USR-03; siempre tiene todos los permisos. */
  isSuperadmin: boolean;

  /** Permisos del rol, del catálogo; todos en el rol superadministrador. */
  @ApiProperty({
    type: [String],
    enum: PERMISSION_CODES,
    example: ['catalog.read', 'orders.read'],
  })
  permissions: string[];

  /** Staff con este rol. */
  userCount: number;

  /** Versión para el bloqueo optimista: se envía al cambiarlo. */
  version: number;

  @ApiProperty(DATE_TIME)
  createdAt: Date;

  @ApiProperty(DATE_TIME)
  updatedAt: Date;
}

export class RoleListDto {
  @ApiProperty({ type: () => [RoleDto] })
  data: RoleDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

export class RoleListQueryDto extends PageQueryDto {
  /** Parte del nombre, sin distinguir mayúsculas; hasta 100 caracteres. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** `name` (por defecto) o `createdAt`, con `-` para orden descendente; varios separados por comas. */
  @IsOptional()
  @IsSortOf(['name', 'createdAt'])
  sort?: string;
}

export class CreateRoleDto {
  /**
   * Nombre único, de 1 a 50 caracteres.
   * @example 'Soporte'
   */
  @IsString()
  @Length(1, 50)
  @Matches(/\S/, NOT_BLANK)
  name: string;

  /** De 1 a 250 caracteres; opcional. */
  @ApiPropertyOptional({
    ...NULLABLE_TEXT,
    example: 'Atiende a clientes y consulta pedidos',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(1, 250)
  description?: string | null;

  @ApiProperty({
    type: [String],
    enum: PERMISSION_CODES,
    description: 'Permisos del catálogo (BR-USR-04).',
    example: ['customers.read', 'orders.read'],
  })
  @IsArray()
  @IsIn(PERMISSION_CODES, { each: true })
  permissions: string[];
}

export class UpdateRoleDto {
  /** Nombre único, de 1 a 50 caracteres. */
  @IsOptional()
  @IsString()
  @Length(1, 50)
  @Matches(/\S/, NOT_BLANK)
  name?: string;

  @ApiPropertyOptional({
    ...NULLABLE_TEXT,
    description: '`null` borra la descripción.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(1, 250)
  description?: string | null;

  @ApiPropertyOptional({
    type: [String],
    enum: PERMISSION_CODES,
    description:
      'Reemplaza el conjunto. El rol superadministrador no cambia sus permisos.',
  })
  @IsOptional()
  @IsArray()
  @IsIn(PERMISSION_CODES, { each: true })
  permissions?: string[];

  /** Versión leída (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

// --- Staff (API_SPEC.md §9.17) ---

export class StaffRoleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** @example 'Operador' */
  name: string;
}

export class StaffUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** @example 'ana.perez@example.com' */
  email: string;

  firstNames: string;

  lastNames: string;

  /** `ACTIVE` o `SUSPENDED`; el staff suspendido no inicia sesión. */
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  status: string;

  /** Con contraseña temporal pendiente de cambiar. */
  mustChangePassword: boolean;

  @ApiProperty({ type: () => [StaffRoleDto] })
  roles: StaffRoleDto[];

  /** Último inicio de sesión; `null` si nunca entró. */
  @ApiProperty(NULLABLE_DATE_TIME)
  lastLoginAt: Date | null;

  /** Versión para el bloqueo optimista: se envía al cambiarlo. */
  version: number;

  @ApiProperty(DATE_TIME)
  createdAt: Date;
}

export class StaffListDto {
  @ApiProperty({ type: () => [StaffUserDto] })
  data: StaffUserDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

export class StaffListQueryDto extends PageQueryDto {
  /** Parte del email o de los nombres, sin distinguir mayúsculas; hasta 254 caracteres. */
  @IsOptional()
  @IsString()
  @MaxLength(254)
  q?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Uno o más estados separados por comas: `ACTIVE`, `SUSPENDED`.',
    example: 'ACTIVE,SUSPENDED',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(['ACTIVE', 'SUSPENDED'], { each: true })
  status?: ('ACTIVE' | 'SUSPENDED')[];

  /** Solo el staff con este rol. */
  @IsOptional()
  @IsUUID()
  roleId?: string;

  /** `createdAt` o `email`, con `-` para orden descendente; por defecto `-createdAt`. */
  @IsOptional()
  @IsSortOf(['createdAt', 'email'])
  sort?: string;
}

export class ReplaceRolesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'De 1 a 50 roles; reemplaza el conjunto.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  roleIds: string[];

  /** Versión leída (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

/** `POST /v1/admin/identity/staff` (API_SPEC.md §9.17, UC-IAM-13). */
export class CreateStaffDto {
  /**
   * Se guarda en minúsculas; no puede tenerlo otra cuenta, de cliente o de staff.
   * @example 'ana.perez@example.com'
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  /**
   * Nombres, de 1 a 100 caracteres.
   * @example 'Ana'
   */
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  firstNames: string;

  /**
   * Apellidos, de 1 a 100 caracteres.
   * @example 'Pérez Gómez'
   */
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, NOT_BLANK)
  lastNames: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'De 1 a 50 roles.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  roleIds: string[];
}

/**
 * A staff account with its temporary password (API_SPEC.md §9.17): shown only in this response, never
 * again (ADR-0043, ADR-0076).
 */
export class StaffWithTemporaryPasswordDto {
  @ApiProperty({ type: () => StaffUserDto })
  user: StaffUserDto;

  /**
   * Contraseña temporal: se muestra solo en esta respuesta y se cambia en el primer inicio de sesión.
   * @example 'k7qm-3xrt-9fzw-p4hd-2nvc'
   */
  temporaryPassword: string;
}

export class ReasonDto {
  /**
   * Motivo, de 1 a 500 caracteres. Queda en la auditoría: no escribas datos personales.
   * @example 'Acceso desde un equipo no autorizado'
   */
  @IsString()
  @Length(1, 500)
  @Matches(/\S/, NOT_BLANK)
  reason: string;

  /** Versión leída (bloqueo optimista). */
  @IsInt()
  @Min(1)
  version: number;
}

// --- Customers (API_SPEC.md §9.18) ---

export class AdminCustomerDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    ...NULLABLE_TEXT,
    description: '`null` en un cliente anonimizado.',
  })
  email: string | null;

  /** `null` en un cliente anonimizado. */
  @ApiProperty(NULLABLE_TEXT)
  firstNames: string | null;

  /** `null` en un cliente anonimizado. */
  @ApiProperty(NULLABLE_TEXT)
  lastNames: string | null;

  /** `ACTIVE`, `SUSPENDED` o `ANONYMIZED`. Un cliente anonimizado no vuelve a estar activo (ADR-0076). */
  @ApiProperty({ enum: USER_STATUSES })
  status: string;

  emailVerified: boolean;

  @ApiProperty(DATE_TIME)
  createdAt: Date;

  /** Último inicio de sesión; `null` si nunca entró. */
  @ApiProperty(NULLABLE_DATE_TIME)
  lastLoginAt: Date | null;

  /** Cuándo se anonimizó la cuenta; `null` si no se ha anonimizado. */
  @ApiProperty(NULLABLE_DATE_TIME)
  anonymizedAt: Date | null;

  /** Versión para el bloqueo optimista: se envía al cambiarlo. */
  version: number;

  @ApiPropertyOptional({
    type: () => [AddressDto],
    description: 'Solo en el detalle.',
  })
  addresses?: AddressDto[];
}

export class CustomerListDto {
  @ApiProperty({ type: () => [AdminCustomerDto] })
  data: AdminCustomerDto[];

  @ApiProperty({ type: () => PageMetaDto })
  meta: PageMetaDto;
}

export class CustomerListQueryDto extends PageQueryDto {
  /** Parte del email, los nombres o los apellidos, sin distinguir mayúsculas; hasta 254 caracteres. */
  @IsOptional()
  @IsString()
  @MaxLength(254)
  q?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Uno o más estados separados por comas: `ACTIVE`, `SUSPENDED`, `ANONYMIZED`.',
    example: 'ACTIVE,SUSPENDED',
  })
  @IsOptional()
  @CommaSeparated()
  @IsIn(USER_STATUSES, { each: true })
  status?: ('ACTIVE' | 'SUSPENDED' | 'ANONYMIZED')[];

  /** `true`, solo los clientes con el email verificado; `false`, solo los que no lo han verificado. */
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  emailVerified?: boolean;

  /** Fecha o fecha y hora ISO 8601; incluida. @example '2026-09-01' */
  @IsOptional()
  @IsISO8601({ strict: true })
  createdFrom?: string;

  /** Fecha o fecha y hora ISO 8601; incluida (una fecha sola incluye todo el día). @example '2026-09-30' */
  @IsOptional()
  @IsISO8601({ strict: true })
  createdTo?: string;

  /** `createdAt`, `email` o `lastLoginAt`, con `-` para orden descendente; por defecto `-createdAt`. */
  @IsOptional()
  @IsSortOf(['createdAt', 'email', 'lastLoginAt'])
  sort?: string;
}

import { ApiProperty } from '@nestjs/swagger';
import {
  PERMISSION_CODES,
  type PermissionCode,
} from '../../../shared-kernel/index.js';
import { StaffRoleDto } from './identity-admin.dto.js';

// Plain fields are documented by the Swagger plugin; enums, lists and dates declare their type with
// @ApiProperty (ADR-0109, ADR-0112).

/** The signed-in account (`Account`, API_SPEC.md §8.10). */
export class AccountDto {
  id: string;

  @ApiProperty({ enum: ['CUSTOMER', 'STAFF'] })
  type: 'CUSTOMER' | 'STAFF';

  /** @example 'cliente@example.com' */
  email: string;

  /** @example 'María' */
  firstNames: string;

  /** @example 'López Hernández' */
  lastNames: string;

  emailVerified: boolean;

  /** Staff with a temporary password, who may only change it. */
  mustChangePassword: boolean;

  /** Staff roles; always empty for customers. */
  @ApiProperty({ type: () => [StaffRoleDto] })
  roles: StaffRoleDto[];

  /** Permissions of the staff member's roles; always empty for customers. */
  @ApiProperty({ type: String, enum: PERMISSION_CODES, isArray: true })
  permissions: PermissionCode[];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

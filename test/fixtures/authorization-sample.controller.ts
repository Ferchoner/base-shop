import { Controller, Get, Query } from '@nestjs/common';
import {
  RequireAccount,
  RequirePermissions,
} from '../../src/platform/auth/authorization.decorators.js';
import {
  toPageResponse,
  toSortOrder,
} from '../../src/platform/http/pagination/pagination.js';
import { SampleListQueryDto } from './authorization-sample.dto.js';

const ITEMS = [
  { name: 'Beta', createdAt: '2026-09-02' },
  { name: 'Alfa', createdAt: '2026-09-03' },
  { name: 'Gamma', createdAt: '2026-09-01' },
];

/** Test-only administrative routes, to check authorization and pagination (ADR-0111, ADR-0036). */
@Controller('admin/test-authorization')
export class AdminAuthorizationSampleController {
  @Get()
  @RequirePermissions('customers.read')
  read(): { ok: true } {
    return { ok: true };
  }

  @Get('both')
  @RequirePermissions('customers.read', 'customers.manage')
  both(): { ok: true } {
    return { ok: true };
  }

  @Get('items')
  @RequirePermissions('customers.read')
  list(@Query() query: SampleListQueryDto) {
    const { field, direction } = toSortOrder(query.sort, 'name');
    const sorted = ITEMS.filter(
      (item) => query.q === undefined || item.name.includes(query.q),
    ).sort(
      (a, b) =>
        a[field as 'name'].localeCompare(b[field as 'name']) *
        (direction === 'asc' ? 1 : -1),
    );
    const start = (query.page - 1) * query.pageSize;
    return toPageResponse(
      {
        items: sorted.slice(start, start + query.pageSize),
        totalItems: sorted.length,
      },
      query,
      (item) => item,
    );
  }

  /** A mistake on purpose: an administrative route without a requirement. */
  @Get('forgotten')
  forgotten(): { ok: true } {
    return { ok: true };
  }
}

/** Test-only account routes (`/v1/me`). */
@Controller('me/test-authorization')
export class AccountAuthorizationSampleController {
  @Get()
  @RequireAccount()
  any(): { ok: true } {
    return { ok: true };
  }

  @Get('customer')
  @RequireAccount({ customerOnly: true })
  customer(): { ok: true } {
    return { ok: true };
  }

  @Get('password')
  @RequireAccount({ allowPendingPasswordChange: true })
  password(): { ok: true } {
    return { ok: true };
  }
}

/** A test-only public route. */
@Controller('test-authorization-public')
export class PublicAuthorizationSampleController {
  @Get()
  open(): { ok: true } {
    return { ok: true };
  }
}

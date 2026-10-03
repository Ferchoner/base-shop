import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import {
  decodeCursor,
  encodeCursor,
} from '../../../platform/http/pagination/cursor.js';
import { rangeEnd } from '../../../platform/http/pagination/pagination.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { toId } from '../../../shared-kernel/index.js';
import {
  type AuditFilter,
  AuditListing,
  type AuditPosition,
} from '../application/audit-entries.js';
import { AuditEntryListDto, AuditQueryDto } from './audit.dto.js';

/** The position of an audit cursor (API_SPEC.md §5.2): the time and ID of the last record of the page. */
function auditPosition(
  position: Readonly<Record<string, unknown>>,
): AuditPosition | null {
  const { occurredAt, id } = position;
  if (typeof occurredAt !== 'string' || typeof id !== 'string') return null;
  const at = new Date(occurredAt);
  try {
    return Number.isNaN(at.getTime()) ? null : { occurredAt: at, id: toId(id) };
  } catch {
    return null;
  }
}

/** `action` as a code, or as the prefix of every code before its `*`. */
function actionFilter(action: string | undefined): AuditFilter {
  if (action === undefined) return {};
  return action.endsWith('.*')
    ? { actionPrefix: action.slice(0, -1) }
    : { action };
}

/**
 * The audit trail for the staff (UC-AUD-02, API_SPEC.md §18, ADR-0037, ADR-0146): read only, with `audit.read`. No
 * endpoint changes or deletes records.
 */
@ApiTags('Administración: auditoría')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly listing: AuditListing) {}

  @ApiOperation({
    summary: 'Consultar la auditoría',
    description:
      'Paginación por cursor, del más reciente al más antiguo. La base guarda los últimos meses (3, configurable); los registros anteriores están en archivos fuera de la API (ADR-0037).',
  })
  @ApiOkResponse({ type: AuditEntryListDto })
  @RequirePermissions('audit.read')
  @Get()
  async list(@Query() query: AuditQueryDto): Promise<AuditEntryListDto> {
    const { entries, next } = await this.listing.page(
      {
        actorId: query.actorId,
        actorTypes: query.actorType,
        ...actionFilter(query.action),
        resourceType: query.resourceType,
        resourceId: query.resourceId,
        results: query.result,
        from: query.from === undefined ? undefined : new Date(query.from),
        to: rangeEnd(query.to),
      },
      query.cursor === undefined
        ? null
        : decodeCursor(query.cursor, auditPosition),
      query.limit,
    );
    return {
      data: entries.map((entry) => ({ ...entry })),
      meta: {
        limit: query.limit,
        nextCursor:
          next === null
            ? null
            : encodeCursor({
                occurredAt: next.occurredAt.toISOString(),
                id: next.id,
              }),
      },
    };
  }
}

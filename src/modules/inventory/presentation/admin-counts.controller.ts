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
import { userScope } from '../../../platform/http/idempotency/idempotency-scope.js';
import { Idempotent } from '../../../platform/http/idempotency/idempotent.decorator.js';
import { toPageResponse } from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { toId } from '../../../shared-kernel/index.js';
import {
  type CountSummaryView,
  type CountView,
  StockCounts,
} from '../application/stock-counts.use-case.js';
import {
  CountDto,
  CountLineDto,
  CountLineInputDto,
  CountListDto,
  CountListQueryDto,
  CountSummaryDto,
  CountVersionDto,
  CreateCountDto,
} from './stock-count.dto.js';

const countIdOf = (id: string) => pathId<'StockCount'>(id, 'StockCount');
const variantIdOf = (id: string) => pathId<'Variant'>(id, 'Variant');

/** Whoever cannot review a sheet counts it blind (ADR-0173). */
const isBlind = (actor: AuthenticatedUser) =>
  !actor.permissions.includes('inventory.write');

/**
 * Count sheets (T-166, API_SPEC.md §13, ADR-0173): the variants of one warehouse are counted blind, reviewed and
 * adjusted at once, with a folio.
 */
@ApiTags('Administración: inventario')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/inventory/counts')
export class AdminCountsController {
  constructor(private readonly counts: StockCounts) {}

  @ApiOperation({
    summary: 'Abrir una hoja de conteo',
    description:
      'ADR-0173. Con un almacén y un filtro: `location` (exacta o, con `*` al final, por prefijo), `categoryId` (los productos directamente en ella), `countClass` (`C` incluye a los productos sin clase), varios a la vez; o `variantIds`, solo (400 `variantIdsAlone`). Sin filtro, 400 `countFilter`. Con un filtro toma las variantes con existencia o con ubicación en ese almacén; con `variantIds`, exactamente esas. Ninguna línea es 400 `noLines`, y más de 1,000, 400 `tooManyLines`, en el primer filtro. Las líneas van por ubicación (sin ella al final) y SKU. Una variante va en una sola hoja abierta por almacén: si alguna ya está en otra, 409 `variant-in-open-count` con esas variantes y sus hojas. Un almacén o una variante de la lista que no existe es 404. Se audita como `inventory.count-open`.',
  })
  @ApiCreatedResponse({ type: CountDto })
  @ApiProblemResponses('not-found', 'variant-in-open-count')
  @RequirePermissions('inventory.write')
  @Post()
  async open(
    @Body() body: CreateCountDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<CountDto> {
    const count = await this.counts.open(
      {
        warehouseId: toId<'Warehouse'>(body.warehouseId),
        location: body.location,
        categoryId: body.categoryId,
        countClass: body.countClass,
        variantIds: body.variantIds?.map((id) => toId<'Variant'>(id)),
        note: body.note,
      },
      actor.id,
    );
    response.setHeader('Location', `/v1/admin/inventory/counts/${count.id}`);
    return toCountDto(count);
  }

  @ApiOperation({
    summary: 'Listar las hojas de conteo',
    description:
      'De la más reciente a la más antigua, sin sus líneas: cuántas tiene y cuántas están contadas. Por almacén y estado.',
  })
  @ApiOkResponse({ type: CountListDto })
  @RequirePermissions('inventory.read')
  @Get()
  async list(@Query() query: CountListQueryDto): Promise<CountListDto> {
    const page = { page: query.page, pageSize: query.pageSize };
    const found = await this.counts.list(
      {
        warehouseId:
          query.warehouseId === undefined
            ? undefined
            : toId<'Warehouse'>(query.warehouseId),
        status: query.status,
      },
      page,
    );
    return toPageResponse(found, page, toSummaryDto);
  }

  @ApiOperation({
    summary: 'Consultar una hoja de conteo',
    description:
      'Con sus líneas en orden. Sin `inventory.write` es a ciegas (`blind`): sin `expected` ni `difference`.',
  })
  @ApiOkResponse({ type: CountDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('inventory.read')
  @Get(':countId')
  async get(
    @Param('countId') countId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CountDto> {
    return toCountDto(
      await this.counts.find(countIdOf(countId), isBlind(actor)),
    );
  }

  @ApiOperation({
    summary: 'Capturar lo contado de una variante',
    description:
      'ADR-0173. De 0 a 100,000. Guarda también las físicas de ese momento, para comparar, así que lo vendido antes o después no sale como faltante. Una variante que no está en la hoja se agrega al final; si está en otra hoja abierta del almacén, 409 `variant-in-open-count`. Volver a capturar reemplaza lo anterior y quita la petición de recontar. Sin `version`: cada captura cuenta una versión de la hoja. Una hoja que no está abierta es 409 `invalid-state-transition`. Responde la línea, a ciegas sin `inventory.write`. No se audita.',
  })
  @ApiOkResponse({ type: CountLineDto })
  @ApiProblemResponses(
    'not-found',
    'invalid-state-transition',
    'variant-in-open-count',
  )
  @RequirePermissions('inventory.count')
  @Put(':countId/lines/:variantId')
  async capture(
    @Param('countId') countId: string,
    @Param('variantId') variantId: string,
    @Body() body: CountLineInputDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CountLineDto> {
    return this.counts.capture({
      id: countIdOf(countId),
      variantId: variantIdOf(variantId),
      counted: body.counted,
      staffId: actor.id,
      blind: isBlind(actor),
    });
  }

  @ApiOperation({
    summary: 'Pedir volver a contar una línea',
    description:
      'ADR-0173. Quita lo contado y marca la línea con `recount`. Exige la `version` leída. Una línea que no está en la hoja es 404, y una hoja que no está abierta, 409 `invalid-state-transition`.',
  })
  @ApiOkResponse({ type: CountDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('inventory.write')
  @HttpCode(200)
  @Post(':countId/lines/:variantId/recount')
  async recount(
    @Param('countId') countId: string,
    @Param('variantId') variantId: string,
    @Body() body: CountVersionDto,
  ): Promise<CountDto> {
    return toCountDto(
      await this.counts.recount({
        id: countIdOf(countId),
        variantId: variantIdOf(variantId),
        version: body.version,
      }),
    );
  }

  @ApiOperation({
    summary: 'Aplicar una hoja de conteo',
    description:
      'ADR-0173. Exige `Idempotency-Key` y la `version` leída. Cada línea contada con diferencia crea un ajuste `PHYSICAL_COUNT` ligado a la hoja (`countId` en el movimiento) por la diferencia, sobre las físicas de ahora; una sin diferencia queda `NO_DIFFERENCE`, y una sin contar, `NOT_COUNTED`, sin tocarse. Una línea que dejaría menos físicas que las apartadas no se aplica (`SKIPPED_RESERVED`) y las demás sí. La hoja queda `APPLIED` y sus variantes pueden ir en otra. Una hoja que no está abierta es 409 `invalid-state-transition`. Se audita como `inventory.count-apply`.',
  })
  @ApiOkResponse({ type: CountDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('inventory.write')
  @Idempotent(userScope)
  @HttpCode(200)
  @Post(':countId/apply')
  async apply(
    @Param('countId') countId: string,
    @Body() body: CountVersionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CountDto> {
    return toCountDto(
      await this.counts.apply({
        id: countIdOf(countId),
        version: body.version,
        staffId: actor.id,
      }),
    );
  }

  @ApiOperation({
    summary: 'Cancelar una hoja de conteo',
    description:
      'ADR-0173. Sin ajustar nada; sus variantes pueden ir en otra hoja. Exige la `version` leída. Una hoja que no está abierta es 409 `invalid-state-transition`. Se audita como `inventory.count-cancel`.',
  })
  @ApiOkResponse({ type: CountDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('inventory.write')
  @HttpCode(200)
  @Post(':countId/cancel')
  async cancel(
    @Param('countId') countId: string,
    @Body() body: CountVersionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CountDto> {
    return toCountDto(
      await this.counts.cancel({
        id: countIdOf(countId),
        version: body.version,
        staffId: actor.id,
      }),
    );
  }
}

function toSummaryDto(count: CountSummaryView): CountSummaryDto {
  const { variantIds, ...filter } = count.filter;
  return {
    ...count,
    filter: {
      ...filter,
      ...(variantIds === undefined ? {} : { variantIds: [...variantIds] }),
    },
  };
}

function toCountDto(count: CountView): CountDto {
  return {
    ...toSummaryDto(count),
    blind: count.blind,
    lines: [...count.lines],
  };
}

import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
  decodeCursor,
  encodeCursor,
} from '../../../platform/http/pagination/cursor.js';
import {
  rangeEnd,
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { toId } from '../../../shared-kernel/index.js';
import type {
  MovementPosition,
  StockSortField,
} from '../application/inventory.queries.js';
import { StockEntries } from '../application/stock-entries.use-case.js';
import { StockListing } from '../application/stock-listing.js';
import {
  AdjustmentDto,
  ReceiptDto,
  StockEntryDto,
  StockItemListDto,
  StockItemQueryDto,
  StockMovementListDto,
  StockMovementQueryDto,
} from './inventory.dto.js';

const stockItem = (id: string) => pathId<'StockItem'>(id, 'StockItem');

/** The position of a movement cursor (API_SPEC.md §5.2): its creation time and ID. */
function movementPosition(
  position: Readonly<Record<string, unknown>>,
): MovementPosition | null {
  const { createdAt, id } = position;
  if (typeof createdAt !== 'string' || typeof id !== 'string') return null;
  const at = new Date(createdAt);
  try {
    return Number.isNaN(at.getTime())
      ? null
      : { createdAt: at, id: toId<'StockMovement'>(id) };
  } catch {
    return null;
  }
}

/**
 * Stock of the staff (UC-INV-02 to 04, API_SPEC.md §13, ADR-0069, ADR-0127): the listing, the movements of a
 * stock item, receipts and adjustments. Reservations have no API: the checkout runs them (T-160 part b).
 */
@ApiTags('Administración: inventario')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/inventory')
export class AdminStockController {
  constructor(
    private readonly listing: StockListing,
    private readonly entries: StockEntries,
  ) {}

  @ApiOperation({
    summary: 'Listar el stock',
    description:
      'Las variantes que ya tuvieron una entrada o un ajuste, con su SKU y el título de su producto.',
  })
  @ApiOkResponse({ type: StockItemListDto })
  @RequirePermissions('inventory.read')
  @Get('stock-items')
  async list(@Query() query: StockItemQueryDto): Promise<StockItemListDto> {
    const page = { page: query.page, pageSize: query.pageSize };
    const found = await this.listing.list(
      {
        variantId:
          query.variantId === undefined
            ? undefined
            : toId<'Variant'>(query.variantId),
        sku: query.sku,
        q: query.q,
        warehouseId:
          query.warehouseId === undefined
            ? undefined
            : toId<'Warehouse'>(query.warehouseId),
        availableMax: query.availableMax,
      },
      toSortOrders<StockSortField>(query.sort, 'sku'),
      page,
    );
    return toPageResponse(found, page, (item) => ({ ...item }));
  }

  @ApiOperation({
    summary: 'Listar los movimientos de un stock item',
    description: 'Paginación por cursor, del más reciente al más antiguo.',
  })
  @ApiOkResponse({ type: StockMovementListDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('inventory.read')
  @Get('stock-items/:stockItemId/movements')
  async movements(
    @Param('stockItemId') stockItemId: string,
    @Query() query: StockMovementQueryDto,
  ): Promise<StockMovementListDto> {
    const { movements, next } = await this.listing.movements(
      stockItem(stockItemId),
      {
        types: query.type,
        from: query.from === undefined ? undefined : new Date(query.from),
        to: rangeEnd(query.to),
      },
      query.cursor === undefined
        ? null
        : decodeCursor(query.cursor, movementPosition),
      query.limit,
    );
    return {
      data: movements.map((movement) => ({ ...movement })),
      meta: {
        limit: query.limit,
        nextCursor:
          next === null
            ? null
            : encodeCursor({
                createdAt: next.createdAt.toISOString(),
                id: next.id,
              }),
      },
    };
  }

  @ApiOperation({
    summary: 'Registrar una entrada de mercancía',
    description: 'Crea el stock item de la variante en su primera entrada.',
  })
  @ApiCreatedResponse({ type: StockEntryDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('inventory.write')
  @Post('receipts')
  receive(
    @Body() body: ReceiptDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<StockEntryDto> {
    return this.entries.receive(
      {
        variantId: toId<'Variant'>(body.variantId),
        warehouseId: toId<'Warehouse'>(body.warehouseId),
        quantity: body.quantity,
        note: body.note,
      },
      actor.id,
    );
  }

  @ApiOperation({
    summary: 'Ajustar el stock con un motivo',
    description:
      'Rechaza un ajuste que deje las existencias por debajo de lo reservado o de cero.',
  })
  @ApiCreatedResponse({ type: StockEntryDto })
  @ApiProblemResponses('not-found', 'insufficient-stock')
  @RequirePermissions('inventory.write')
  @Post('adjustments')
  adjust(
    @Body() body: AdjustmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<StockEntryDto> {
    return this.entries.adjust(
      {
        variantId: toId<'Variant'>(body.variantId),
        warehouseId: toId<'Warehouse'>(body.warehouseId),
        quantity: body.quantity,
        reasonCode: body.reasonCode,
        note: body.note,
      },
      actor.id,
    );
  }
}

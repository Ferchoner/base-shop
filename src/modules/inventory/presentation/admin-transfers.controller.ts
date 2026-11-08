import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
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
import {
  rangeEnd,
  toPageResponse,
} from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { toId } from '../../../shared-kernel/index.js';
import { StockTransfers } from '../application/stock-transfers.use-case.js';
import {
  CancelTransferDto,
  CreateTransferDto,
  TransferDto,
  TransferListDto,
  TransferListQueryDto,
} from './stock-transfer.dto.js';

const transferIdOf = (id: string) =>
  pathId<'StockTransfer'>(id, 'StockTransfer');

/**
 * Transfers between warehouses (T-163, API_SPEC.md §13, ADR-0172): units leave one warehouse and enter another in
 * one step, with a folio, and a transfer is cancelled only in its first 10 minutes.
 */
@ApiTags('Administración: inventario')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/inventory/transfers')
export class AdminTransfersController {
  constructor(private readonly transfers: StockTransfers) {}

  @ApiOperation({
    summary: 'Trasladar existencias a otro almacén',
    description:
      'ADR-0172. Exige `Idempotency-Key`. Cada línea sale del origen y entra al destino en una sola transacción, o no pasa nada; el historial de existencias de los dos almacenes la registra como `TRANSFER`. Solo se trasladan unidades disponibles (`onHand − reserved`): si alguna línea no alcanza, 409 `insufficient-stock` con esas líneas. El destino debe ser un almacén activo y distinto del origen (400 `differentWarehouse` en `toWarehouseId`); el origen, cualquiera. Una variante va una vez por traslado (400 `duplicateVariant`). Un almacén o una variante que no existe, o un destino inactivo, es 404. Se audita como `inventory.transfer`.',
  })
  @ApiCreatedResponse({ type: TransferDto })
  @ApiProblemResponses('not-found', 'insufficient-stock')
  @RequirePermissions('inventory.transfer')
  @Idempotent(userScope)
  @Post()
  async create(
    @Body() body: CreateTransferDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<TransferDto> {
    const transfer = await this.transfers.record(
      {
        fromWarehouseId: toId<'Warehouse'>(body.fromWarehouseId),
        toWarehouseId: toId<'Warehouse'>(body.toWarehouseId),
        reason: body.reason,
        note: body.note,
        lines: body.lines.map(({ variantId, quantity }) => ({
          variantId: toId<'Variant'>(variantId),
          quantity,
        })),
      },
      actor.id,
    );
    response.setHeader(
      'Location',
      `/v1/admin/inventory/transfers/${transfer.id}`,
    );
    return { ...transfer, lines: [...transfer.lines] };
  }

  @ApiOperation({
    summary: 'Listar los traslados',
    description:
      'Del más reciente al más antiguo, con sus líneas. Por almacén, de origen o de destino, por variante, motivo, estado y fechas.',
  })
  @ApiOkResponse({ type: TransferListDto })
  @RequirePermissions('inventory.read')
  @Get()
  async list(@Query() query: TransferListQueryDto): Promise<TransferListDto> {
    const page = { page: query.page, pageSize: query.pageSize };
    const found = await this.transfers.list(
      {
        warehouseId:
          query.warehouseId === undefined
            ? undefined
            : toId<'Warehouse'>(query.warehouseId),
        variantId:
          query.variantId === undefined
            ? undefined
            : toId<'Variant'>(query.variantId),
        reason: query.reason,
        status: query.status,
        from: query.from === undefined ? undefined : new Date(query.from),
        to: rangeEnd(query.to),
      },
      page,
    );
    return toPageResponse(found, page, (transfer) => ({
      ...transfer,
      lines: [...transfer.lines],
    }));
  }

  @ApiOperation({
    summary: 'Consultar un traslado',
    description: 'Con sus líneas y hasta cuándo se puede cancelar.',
  })
  @ApiOkResponse({ type: TransferDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('inventory.read')
  @Get(':transferId')
  async get(@Param('transferId') transferId: string): Promise<TransferDto> {
    const transfer = await this.transfers.find(transferIdOf(transferId));
    return { ...transfer, lines: [...transfer.lines] };
  }

  @ApiOperation({
    summary: 'Cancelar un traslado',
    description:
      'ADR-0172. Solo en los 10 minutos que siguen a su registro (`cancellableUntil`); después, o si ya se canceló, 409 `invalid-state-transition`, con `reason: cancel-window-passed` en el primer caso. Regresa las unidades al origen con movimientos `TRANSFER` contrarios, porque el historial de existencias nunca se borra. Si el destino ya no tiene esas unidades disponibles, 409 `insufficient-stock`. Exige la `version` leída. Se audita como `inventory.transfer-cancel`.',
  })
  @ApiOkResponse({ type: TransferDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
    'insufficient-stock',
  )
  @RequirePermissions('inventory.transfer')
  @HttpCode(200)
  @Post(':transferId/cancel')
  async cancel(
    @Param('transferId') transferId: string,
    @Body() body: CancelTransferDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TransferDto> {
    const transfer = await this.transfers.cancel({
      id: transferIdOf(transferId),
      version: body.version,
      staffId: actor.id,
    });
    return { ...transfer, lines: [...transfer.lines] };
  }
}

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
  CloseLoanDto,
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
    summary: 'Trasladar o prestar existencias a otro almacén',
    description:
      'ADR-0172. Exige `Idempotency-Key`. Con `kind: LOAN` es un préstamo para mostrar (T-164): folio `P-`, motivo `SHOW` y `returnBy` de 5 minutos a 24 horas después (400 `loanRange`); queda `OPEN` hasta que se cierra. Un motivo que no va con el tipo es 400 `reasonKind`, y `returnBy` en un traslado, 400 `isEmpty`. Cada línea sale del origen y entra al destino en una sola transacción, o no pasa nada; el historial de existencias de los dos almacenes la registra como `TRANSFER`. Solo se trasladan unidades disponibles (`onHand − reserved`): si alguna línea no alcanza, 409 `insufficient-stock` con esas líneas. El destino debe ser un almacén activo y distinto del origen (400 `differentWarehouse` en `toWarehouseId`); el origen, cualquiera. Una variante va una vez por traslado (400 `duplicateVariant`). Un almacén o una variante que no existe, o un destino inactivo, es 404. Se audita como `inventory.transfer`.',
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
        kind: body.kind,
        returnBy:
          body.returnBy === undefined ? undefined : new Date(body.returnBy),
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
      'Del más reciente al más antiguo, con sus líneas. Por tipo, almacén, de origen o de destino, variante, motivo, estado, fechas y préstamos vencidos (`overdue`).',
  })
  @ApiOkResponse({ type: TransferListDto })
  @RequirePermissions('inventory.read')
  @Get()
  async list(@Query() query: TransferListQueryDto): Promise<TransferListDto> {
    const page = { page: query.page, pageSize: query.pageSize };
    const found = await this.transfers.list(
      {
        kind: query.kind,
        overdue: query.overdue,
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
      'ADR-0172. Un traslado, o un préstamo abierto, solo en los 10 minutos que siguen a su registro (`cancellableUntil`); después, si ya se canceló, si es un préstamo cerrado o el regreso de uno, 409 `invalid-state-transition`, con `reason: cancel-window-passed` en el primer caso. Regresa las unidades al origen con movimientos `TRANSFER` contrarios, porque el historial de existencias nunca se borra. Si el destino ya no tiene esas unidades disponibles, 409 `insufficient-stock`. Exige la `version` leída. Se audita como `inventory.transfer-cancel`.',
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

  @ApiOperation({
    summary: 'Cerrar un préstamo',
    description:
      'T-164, ADR-0172. Con la `version` leída y lo que regresó de cada línea del préstamo, todas una vez (400 `loanLines`), de 0 a lo prestado (400 `range` en `lines[i].returned`). Lo que regresó vuelve al origen con un traslado `LOAN_RETURN` ligado al préstamo (`returnTransferId`), que no se cancela, aunque el origen esté inactivo; lo demás se queda en el destino. Si el destino ya no tiene esas unidades disponibles, 409 `insufficient-stock`. Un préstamo que no está abierto, o un traslado, es 409 `invalid-state-transition`. Se audita como `inventory.loan-close`.',
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
  @Post(':transferId/close')
  async close(
    @Param('transferId') transferId: string,
    @Body() body: CloseLoanDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TransferDto> {
    const loan = await this.transfers.close({
      id: transferIdOf(transferId),
      version: body.version,
      lines: body.lines.map(({ variantId, returned }) => ({
        variantId: toId<'Variant'>(variantId),
        returned,
      })),
      staffId: actor.id,
    });
    return { ...loan, lines: [...loan.lines] };
  }
}

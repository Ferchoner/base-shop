import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import { toPageResponse } from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { toId } from '../../../shared-kernel/index.js';
import { CashClosings } from '../application/cash-closings.use-case.js';
import {
  CashClosingDto,
  CashClosingListDto,
  CashClosingListQueryDto,
  CashSummaryDto,
  CashSummaryQueryDto,
  CloseCashDto,
} from './cash-closing.dto.js';
import { toCashClosingDto, toCashSummaryDto } from './ordering.mappers.js';

const closingIdOf = (id: string) => pathId<'CashClosing'>(id, 'CashClosing');

/** How the day and its figures are taken, for the summary and the closing (ADR-0171). */
const DAY_RULES =
  'El día es el de la Ciudad de México, `AAAA-MM-DD`. Cuenta solo las órdenes de la tienda física de ese almacén: las colocadas ese día con su total y las que siguen sin pago, las canceladas ese día, los cobros capturados ese día por método (`CASH`, `CARD_TERMINAL`, `TRANSFER` y sin método), los reembolsos completados ese día, lo que registró cada cuenta de staff y las líneas de precio libre. Un cobro o reembolso cuenta el día en que se registró, aunque la orden sea de otro día. Las órdenes en línea pagadas en la tienda no tienen almacén y no entran. El efectivo esperado es lo cobrado en efectivo menos lo reembolsado de pagos en efectivo.';

/**
 * The cash closing of each store (UC-ORD-16 and 17, API_SPEC.md §15.10, ADR-0171): the summary of the day of a
 * warehouse, and its closing with the cash the staff counted.
 */
@ApiTags('Administración: corte de caja')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/cash-closings')
export class AdminCashClosingsController {
  constructor(private readonly closings: CashClosings) {}

  @ApiOperation({
    summary: 'Consultar el corte de caja de un local en un día',
    description: `${DAY_RULES} Con el cierre del día si lo tiene, y lo que llegó después de él (\`afterClosing\`), que ya va en los totales. Un almacén que no existe es 404.`,
  })
  @ApiOkResponse({ type: CashSummaryDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('cash-closings.read')
  @Get('summary')
  async summary(@Query() query: CashSummaryQueryDto): Promise<CashSummaryDto> {
    return toCashSummaryDto(
      await this.closings.summary(
        toId<'Warehouse'>(query.warehouseId),
        query.date,
      ),
    );
  }

  @ApiOperation({
    summary: 'Cerrar la caja de un local',
    description: `Guarda el resumen del día en ese momento, el efectivo esperado, el contado (\`countedCash\`, en centavos) y la diferencia, contado menos esperado. ${DAY_RULES} Si el contado no es el esperado, \`note\` es obligatoria (400 en \`note\` con \`requiredWithDifference\`). Hoy o un día anterior: un día por venir es 400 en \`date\` con \`notFuture\`. Un cierre por almacén y día, que nunca se edita ni se borra: el segundo es 409 \`duplicate-value\` en \`date\`. Lo que se cobre o reembolse después aparece en el resumen como posterior al cierre. Se audita como \`cash-closings.close\` con los montos, sin la nota.`,
  })
  @ApiCreatedResponse({ type: CashClosingDto })
  @ApiProblemResponses('not-found', 'duplicate-value')
  @RequirePermissions('cash-closings.manage')
  @Post()
  async close(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CloseCashDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<CashClosingDto> {
    const id = await this.closings.close({
      warehouseId: toId<'Warehouse'>(body.warehouseId),
      date: body.date,
      countedCash: body.countedCash,
      note: body.note ?? null,
      staffId: toId<'User'>(actor.id),
    });
    response.setHeader('Location', `/v1/admin/cash-closings/${id}`);
    return toCashClosingDto(await this.closings.find(id));
  }

  @ApiOperation({
    summary: 'Listar los cierres de caja',
    description:
      'Del día más reciente al más antiguo, de un almacén o de todos, entre dos días incluidos.',
  })
  @ApiOkResponse({ type: CashClosingListDto })
  @RequirePermissions('cash-closings.read')
  @Get()
  async list(
    @Query() query: CashClosingListQueryDto,
  ): Promise<CashClosingListDto> {
    const page = await this.closings.list(
      {
        warehouseId:
          query.warehouseId === undefined
            ? undefined
            : toId<'Warehouse'>(query.warehouseId),
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      query,
    );
    return toPageResponse(page, query, toCashClosingDto);
  }

  @ApiOperation({
    summary: 'Consultar un cierre de caja',
    description: 'Con el resumen del día como estaba al cerrar.',
  })
  @ApiOkResponse({ type: CashClosingDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('cash-closings.read')
  @Get(':closingId')
  async get(@Param('closingId') closingId: string): Promise<CashClosingDto> {
    return toCashClosingDto(await this.closings.find(closingIdOf(closingId)));
  }
}

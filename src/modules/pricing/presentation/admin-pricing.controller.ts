import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { toMoneyDto } from '../../../platform/http/money.dto.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import {
  type PricePeriodStateView,
  PricingQueries,
} from '../application/pricing.queries.js';
import { VariantPrices } from '../application/variant-prices.use-case.js';
import {
  PriceListListDto,
  PricePeriodDto,
  PricePeriodListDto,
  PricePeriodQueryDto,
  SetPriceDto,
} from './pricing.dto.js';

const priceList = (id: string) => pathId<'PriceList'>(id, 'PriceList');
const variant = (id: string) => pathId<'Variant'>(id, 'Variant');
const period = (id: string) => pathId<'PricePeriod'>(id, 'PricePeriod');

/**
 * Price lists and the prices of each variant (UC-PRC-01 to 04, API_SPEC.md §12, ADR-0039, ADR-0125). The MVP
 * has only the default list, so there are no endpoints to create or edit lists. The store sees new prices
 * when its cache expires (ADR-0028).
 */
@ApiTags('Administración: precios')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/pricing/price-lists')
export class AdminPricingController {
  constructor(
    private readonly queries: PricingQueries,
    private readonly prices: VariantPrices,
  ) {}

  @ApiOperation({ summary: 'Listar las listas de precios' })
  @ApiOkResponse({ type: PriceListListDto })
  @RequirePermissions('pricing.read')
  @Get()
  async list(): Promise<PriceListListDto> {
    return { data: await this.queries.listPriceLists() };
  }

  @ApiOperation({
    summary: 'Consultar los precios de una variante',
    description:
      'Todos los periodos, del inicio más reciente al más antiguo, y el vigente.',
  })
  @ApiOkResponse({ type: PricePeriodListDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('pricing.read')
  @Get(':priceListId/variants/:variantId/periods')
  async history(
    @Param('priceListId') priceListId: string,
    @Param('variantId') variantId: string,
    @Query() query: PricePeriodQueryDto,
  ): Promise<PricePeriodListDto> {
    const { periods, current } = await this.prices.history(
      priceList(priceListId),
      variant(variantId),
      query.state,
    );
    return {
      data: periods.map(toPricePeriodDto),
      current: current === null ? null : toPricePeriodDto(current),
    };
  }

  @ApiOperation({
    summary: 'Fijar o programar un precio',
    description:
      'Sin `effectiveFrom`, o con una fecha no posterior al momento actual, el precio rige desde ahora y cierra el vigente. Con una fecha futura, queda programado: termina donde empieza el periodo siguiente.',
  })
  @ApiCreatedResponse({ type: PricePeriodDto })
  @ApiOkResponse({
    type: PricePeriodDto,
    description:
      'El precio desde ahora es igual al vigente: no se abre un periodo y se responde el vigente.',
  })
  @ApiProblemResponses('not-found', 'price-period-conflict')
  @RequirePermissions('pricing.write')
  @Post(':priceListId/variants/:variantId/periods')
  async set(
    @Param('priceListId') priceListId: string,
    @Param('variantId') variantId: string,
    @Body() body: SetPriceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) response: { status(code: number): unknown },
  ): Promise<PricePeriodDto> {
    const { period: answered, created } = await this.prices.set(
      priceList(priceListId),
      variant(variantId),
      {
        amount: body.amount,
        compareAtAmount: body.compareAtAmount ?? null,
        effectiveFrom:
          body.effectiveFrom === undefined || body.effectiveFrom === null
            ? null
            : new Date(body.effectiveFrom),
      },
      actor.id,
    );
    if (!created) response.status(200);
    return toPricePeriodDto(answered);
  }

  @ApiOperation({
    summary: 'Cancelar un precio programado',
    description:
      'Solo antes de que empiece; el periodo anterior vuelve a durar hasta el siguiente.',
  })
  @ApiNoContentResponse()
  @ApiProblemResponses('not-found', 'price-period-conflict')
  @RequirePermissions('pricing.write')
  @HttpCode(204)
  @Delete(':priceListId/variants/:variantId/periods/:periodId')
  async cancel(
    @Param('priceListId') priceListId: string,
    @Param('variantId') variantId: string,
    @Param('periodId') periodId: string,
  ): Promise<void> {
    await this.prices.cancel(
      priceList(priceListId),
      variant(variantId),
      period(periodId),
    );
  }
}

function toPricePeriodDto(view: PricePeriodStateView): PricePeriodDto {
  return {
    ...view,
    amount: toMoneyDto(view.amount),
    compareAtAmount:
      view.compareAtAmount === null ? null : toMoneyDto(view.compareAtAmount),
  };
}

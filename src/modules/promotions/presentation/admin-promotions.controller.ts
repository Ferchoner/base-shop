import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
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
import {
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import { Money, NotFoundError, toId } from '../../../shared-kernel/index.js';
import { CreatePromotion } from '../application/create-promotion.use-case.js';
import { EndPromotion } from '../application/end-promotion.use-case.js';
import { PromotionReader } from '../application/promotion-reader.js';
import type {
  Discount,
  PromotionTarget,
} from '../application/promotion-values.js';
import type { PromotionSortField } from '../application/promotions.queries.js';
import { UpdatePromotion } from '../application/update-promotion.use-case.js';
import {
  CreatePromotionDto,
  EndPromotionDto,
  PromotionDto,
  PromotionListDto,
  PromotionListQueryDto,
  type PromotionTargetDto,
  UpdatePromotionDto,
} from './promotion.dto.js';
import { toPromotionDto, toPromotionSummaryDto } from './promotion.mappers.js';

const promotionIdOf = (id: string) => pathId<'Promotion'>(id, 'Promotion');

const moneyOf = (amount: number | null | undefined): Money | null =>
  amount === undefined || amount === null ? null : Money.of(amount, 'MXN');

const dateOf = (value: string | null | undefined): Date | null =>
  value === undefined || value === null ? null : new Date(value);

const targetsOf = (targets: readonly PromotionTargetDto[]): PromotionTarget[] =>
  targets.map(({ type, id }) => ({ type, id: id.toLowerCase() }));

/** `undefined` stays: the field keeps its value. */
const changed = <Value, Result>(
  value: Value | undefined,
  map: (value: Value) => Result,
): Result | undefined => (value === undefined ? undefined : map(value));

/**
 * Promotions (UC-PRM-01 to 03, API_SPEC.md §26, ADR-0168): a percentage or an amount off the whole purchase or certain
 * products, categories or brands, online, in the store or both. Changes send the `version` read (optimistic locking).
 */
@ApiTags('Administración: promociones')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/promotions')
export class AdminPromotionsController {
  constructor(
    private readonly reader: PromotionReader,
    private readonly createPromotion: CreatePromotion,
    private readonly updatePromotion: UpdatePromotion,
    private readonly endPromotion: EndPromotion,
  ) {}

  @ApiOperation({
    summary: 'Crear una promoción',
    description:
      'UC-PRM-01 (ADR-0168). Un porcentaje entero (`percentage`, de 1 a 100) o un monto fijo por orden (`amountOff`), exactamente uno; sobre toda la compra, o sobre los productos, categorías (con sus subcategorías) y marcas de `targets`, que deben existir y estar en uso: un producto archivado, o una categoría o marca inactiva, no. En línea, en la tienda física o en los dos; con compra mínima opcional. Sin `startsAt`, o con uno que ya pasó, empieza ahora. Se audita como `promotions.create`.',
  })
  @ApiCreatedResponse({ type: PromotionDto })
  @RequirePermissions('promotions.manage')
  @Post()
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreatePromotionDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<PromotionDto> {
    const id = await this.createPromotion.execute({
      staffId: toId<'User'>(actor.id),
      terms: {
        name: body.name,
        discount: discountOf(body)!,
        targets: targetsOf(body.targets ?? []),
        channels: body.channels ?? ['ONLINE', 'STORE'],
        minimumSubtotal: moneyOf(body.minimumSubtotal),
        startsAt: dateOf(body.startsAt),
        endsAt: dateOf(body.endsAt),
      },
    });
    response.setHeader('Location', `/v1/admin/promotions/${id}`);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Listar promociones',
    description:
      'UC-PRM-02. Sin sus productos, categorías y marcas, que da la consulta de cada una. El estado se calcula al momento de la consulta.',
  })
  @ApiOkResponse({ type: PromotionListDto })
  @RequirePermissions('promotions.read')
  @Get()
  async list(@Query() query: PromotionListQueryDto): Promise<PromotionListDto> {
    const page = await this.reader.list(
      {
        q: query.q,
        status: query.status,
        channel: query.channel,
        appliesTo: query.appliesTo,
      },
      toSortOrders<PromotionSortField>(query.sort, '-startsAt'),
      query,
    );
    return toPageResponse(page, query, toPromotionSummaryDto);
  }

  @ApiOperation({
    summary: 'Consultar una promoción',
    description:
      'UC-PRM-02. Con sus productos, categorías y marcas, cada uno con su nombre actual en el catálogo.',
  })
  @ApiOkResponse({ type: PromotionDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('promotions.read')
  @Get(':promotionId')
  get(@Param('promotionId') promotionId: string): Promise<PromotionDto> {
    return this.read(promotionIdOf(promotionId));
  }

  @ApiOperation({
    summary: 'Editar una promoción',
    description:
      'UC-PRM-03 (ADR-0168). Solo cambian los campos enviados; `percentage` o `amountOff` reemplazan el descuento, y `targets`, la lista completa. Antes de su inicio se cambia todo; ya iniciada, solo `name` y `endsAt`, que debe ser posterior al momento actual: otro cambio responde 409 `invalid-state-transition`, igual que editar una terminada. Un producto, categoría o marca nuevo debe existir y estar en uso; los que ya tenía se quedan aunque ya no lo estén. Sin cambios, no se guarda ni se audita. Se audita como `promotions.update`.',
  })
  @ApiOkResponse({ type: PromotionDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('promotions.manage')
  @Patch(':promotionId')
  async update(
    @Param('promotionId') promotionId: string,
    @Body() body: UpdatePromotionDto,
  ): Promise<PromotionDto> {
    const id = promotionIdOf(promotionId);
    await this.updatePromotion.execute(
      id,
      {
        name: body.name,
        discount: discountOf(body, { required: false }),
        targets: changed(body.targets, targetsOf),
        channels: body.channels,
        minimumSubtotal: changed(body.minimumSubtotal, moneyOf),
        startsAt: changed(body.startsAt, (value) => new Date(value)),
        endsAt: changed(body.endsAt, dateOf),
      },
      body.version,
    );
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Terminar una promoción',
    description:
      'UC-PRM-03 (ADR-0168). Una vigente deja de aplicar ahora, y una programada ya no empieza; se conserva, porque las órdenes guardan cuál recibieron. Una terminada responde 409 `invalid-state-transition`. Se audita como `promotions.end`.',
  })
  @ApiOkResponse({ type: PromotionDto })
  @ApiProblemResponses(
    'not-found',
    'version-conflict',
    'invalid-state-transition',
  )
  @RequirePermissions('promotions.manage')
  @HttpCode(200)
  @Post(':promotionId/end')
  async end(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('promotionId') promotionId: string,
    @Body() body: EndPromotionDto,
  ): Promise<PromotionDto> {
    const id = promotionIdOf(promotionId);
    await this.endPromotion.execute({
      id,
      staffId: toId<'User'>(actor.id),
      version: body.version,
    });
    return this.read(id);
  }

  private async read(id: ReturnType<typeof promotionIdOf>) {
    const detail = await this.reader.promotion(id);
    if (detail === null) throw new NotFoundError('Promotion', id);
    return toPromotionDto(detail);
  }
}

/**
 * The discount of a request: `percentage` or `amountOff`, exactly one of them in a new promotion, and at most one in
 * a change, where neither keeps the discount it had (API_SPEC.md §26.2).
 *
 * @throws ProblemException `validation-error` on `amountOff` with both, or on `percentage` with neither when it is
 *   required.
 */
function discountOf(
  body: { percentage?: number; amountOff?: number },
  options: { required: boolean } = { required: true },
): Discount | undefined {
  if (body.percentage !== undefined && body.amountOff !== undefined) {
    throw fieldProblem(
      'amountOff',
      'exclusive',
      'Exactamente uno de `percentage` y `amountOff`.',
    );
  }
  if (body.percentage !== undefined) {
    return { type: 'PERCENTAGE', percentage: body.percentage };
  }
  if (body.amountOff !== undefined) {
    return { type: 'AMOUNT', amount: Money.of(body.amountOff, 'MXN') };
  }
  if (options.required) {
    throw fieldProblem(
      'percentage',
      'required',
      'Exactamente uno de `percentage` y `amountOff`.',
    );
  }
  return undefined;
}

function fieldProblem(
  field: string,
  code: string,
  message: string,
): ProblemException {
  return new ProblemException('validation-error', {
    errors: [{ field, code, message }],
  });
}

import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { toMoneyDto } from '../../../platform/http/money.dto.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { NotFoundError } from '../../../shared-kernel/index.js';
import { ConfigureShippingMethod } from '../application/configure-shipping-method.use-case.js';
import {
  ShippingQueries,
  type ShippingMethodView,
} from '../application/shipping.queries.js';
import {
  ShippingMethodDto,
  UpdateShippingMethodDto,
} from './shipping-method.dto.js';

/**
 * The shipping method (UC-SHI-02, API_SPEC.md §17, ADR-0122): read with `shipping.manage`, configured only
 * with `shipping.configure` (ADR-0075). Changes never alter placed orders (ADR-0042).
 */
@ApiTags('Administración: envíos')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/shipping/method')
export class AdminShippingMethodController {
  constructor(
    private readonly queries: ShippingQueries,
    private readonly configureShippingMethod: ConfigureShippingMethod,
  ) {}

  @ApiOperation({ summary: 'Consultar el método de envío' })
  @ApiOkResponse({ type: ShippingMethodDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('shipping.manage')
  @Get()
  get(): Promise<ShippingMethodDto> {
    return this.read();
  }

  @ApiOperation({
    summary: 'Configurar el costo de envío, el envío gratis y el plazo',
    description:
      'Reemplaza todos los valores. Las órdenes ya colocadas conservan los que aplicaron.',
  })
  @ApiOkResponse({ type: ShippingMethodDto })
  @ApiProblemResponses('not-found', 'version-conflict')
  @RequirePermissions('shipping.configure')
  @Put()
  async update(
    @Body() body: UpdateShippingMethodDto,
  ): Promise<ShippingMethodDto> {
    await this.configureShippingMethod.execute(body);
    return this.read();
  }

  private async read(): Promise<ShippingMethodDto> {
    const method = await this.queries.findActiveMethod();
    if (method === null) throw new NotFoundError('ShippingMethod', 'active');
    return toShippingMethodDto(method);
  }
}

function toShippingMethodDto(view: ShippingMethodView): ShippingMethodDto {
  return {
    ...view,
    flatFee: toMoneyDto(view.flatFee),
    freeShippingThreshold:
      view.freeShippingThreshold === null
        ? null
        : toMoneyDto(view.freeShippingThreshold),
  };
}

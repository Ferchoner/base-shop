import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { RequireAccount } from '../../../platform/auth/authorization.decorators.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { toId } from '../../../shared-kernel/index.js';
import { CartViews } from '../application/cart-views.js';
import { Carts } from '../application/carts.use-case.js';
import {
  AddCartLineDto,
  CartDto,
  ChangeCartLineDto,
  MergeCartDto,
} from './cart.dto.js';
import { toCartDto } from './cart.mappers.js';
import { NoStaffPurchases } from '../../../platform/auth/no-staff-purchases.guard.js';

const customer = (user: AuthenticatedUser) => toId<'User'>(user.id);
const line = (id: string) => pathId<'Variant'>(id, 'Cart line');

/**
 * The cart of the signed-in customer (UC-CRT-01 to 06, API_SPEC.md §14): the customer comes from the token,
 * never from the URL, and has at most one active cart (BR-CRT-03). A staff account answers 403
 * `staff-cannot-purchase` (E-09).
 */
@ApiTags('Cuenta: carrito')
@ApiProblemResponses('unauthenticated', 'staff-cannot-purchase')
@RequireAccount()
@UseGuards(NoStaffPurchases)
@Controller('me/cart')
export class MeCartController {
  constructor(
    private readonly carts: Carts,
    private readonly views: CartViews,
  ) {}

  @ApiOperation({
    summary: 'Ver mi carrito',
    description:
      'Precios y disponibilidad calculados al leer (BR-CRT-04). Sin carrito activo, `id: null` y `lines: []`.',
  })
  @ApiOkResponse({ type: CartDto })
  @Get()
  async view(@CurrentUser() user: AuthenticatedUser): Promise<CartDto> {
    return toCartDto(await this.views.customerCart(customer(user)));
  }

  @ApiOperation({
    summary: 'Agregar un producto',
    description:
      'Crea el carrito si el cliente no tiene uno activo (201); si no, 200. Si la variante ya está, suma a su línea, que queda con 30 unidades como máximo.',
  })
  @ApiOkResponse({ type: CartDto })
  @ApiCreatedResponse({ type: CartDto })
  @ApiProblemResponses(
    'variant-not-sellable',
    'cart-not-active',
    'cart-line-limit-reached',
  )
  @Post('lines')
  async addLine(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AddCartLineDto,
    @Res({ passthrough: true }) response: { status(code: number): unknown },
  ): Promise<CartDto> {
    const { created } = await this.carts.addLine(
      { customerId: customer(user) },
      toId<'Variant'>(body.variantId),
      body.quantity,
    );
    if (!created) response.status(200);
    return toCartDto(await this.views.customerCart(customer(user)));
  }

  @ApiOperation({
    summary: 'Cambiar la cantidad de un producto',
    description:
      'Fija la cantidad de la línea, de 1 a 30 (BR-CRT-02); para quitarla se usa `DELETE`. Responde el carrito.',
  })
  @ApiOkResponse({ type: CartDto })
  @ApiProblemResponses('not-found', 'variant-not-sellable', 'cart-not-active')
  @Patch('lines/:variantId')
  async changeLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('variantId') variantId: string,
    @Body() body: ChangeCartLineDto,
  ): Promise<CartDto> {
    await this.carts.changeLine(
      { customerId: customer(user) },
      line(variantId),
      body.quantity,
    );
    return toCartDto(await this.views.customerCart(customer(user)));
  }

  @ApiOperation({
    summary: 'Quitar un producto',
    description:
      'Responde el carrito, no 204, para ahorrar una lectura (ADR-0071). Quitar uno que no está no cambia nada.',
  })
  @ApiOkResponse({ type: CartDto })
  @ApiProblemResponses('not-found', 'cart-not-active')
  @Delete('lines/:variantId')
  async removeLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('variantId') variantId: string,
  ): Promise<CartDto> {
    await this.carts.removeLine(
      { customerId: customer(user) },
      line(variantId),
    );
    return toCartDto(await this.views.customerCart(customer(user)));
  }

  @ApiOperation({
    summary: 'Fusionar el carrito de invitado',
    description:
      'Suma las cantidades con tope de 30 sin aviso; si el cliente no tiene carrito, el de invitado pasa a su cuenta. Repetirla no vuelve a sumar (ADR-0059).',
  })
  @ApiOkResponse({ type: CartDto })
  @ApiProblemResponses('not-found', 'cart-not-active')
  @HttpCode(200)
  @Post('merge')
  async merge(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: MergeCartDto,
  ): Promise<CartDto> {
    await this.carts.merge(customer(user), toId<'Cart'>(body.guestCartId));
    return toCartDto(await this.views.customerCart(customer(user)));
  }
}

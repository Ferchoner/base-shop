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
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { NoStore } from '../../../platform/http/no-store.js';
import { toId } from '../../../shared-kernel/index.js';
import { CartViews } from '../application/cart-views.js';
import { Carts } from '../application/carts.use-case.js';
import { AddCartLineDto, CartDto, ChangeCartLineDto } from './cart.dto.js';
import { toCartDto } from './cart.mappers.js';
import { NoStaffPurchases } from '../../../platform/auth/no-staff-purchases.guard.js';

const cart = (id: string) => pathId<'Cart'>(id, 'Cart');
const line = (id: string) => pathId<'Variant'>(id, 'Cart line');

/**
 * The cart of a guest (UC-CRT-01 to 05, API_SPEC.md §14): its random ID is its only credential (ADR-0059), and
 * a cart with an owner answers 404 here, so knowing its ID gives no access to a customer's cart. A staff token
 * cannot create or change one (ADR-0131).
 */
@ApiTags('Carrito')
@NoStore()
@Controller('carts')
export class CartsController {
  constructor(
    private readonly carts: Carts,
    private readonly views: CartViews,
  ) {}

  @ApiOperation({
    summary: 'Crear un carrito de invitado',
    description:
      'Sin cuerpo. El `id` es aleatorio y es la única credencial del carrito (ADR-0059).',
  })
  @ApiCreatedResponse({ type: CartDto })
  @ApiProblemResponses('staff-cannot-purchase')
  @UseGuards(NoStaffPurchases)
  @Post()
  async create(
    @Res({ passthrough: true })
    response: {
      setHeader(name: string, value: string): void;
    },
  ): Promise<CartDto> {
    const id = await this.carts.createGuestCart();
    response.setHeader('Location', `/v1/carts/${id}`);
    return toCartDto(await this.views.guestCart(id));
  }

  @ApiOperation({
    summary: 'Ver un carrito de invitado',
    description:
      'Precios y disponibilidad calculados al leer (BR-CRT-04). Un carrito fusionado o usado en una orden se devuelve con su `status`.',
  })
  @ApiOkResponse({ type: CartDto })
  @ApiProblemResponses('not-found')
  @Get(':cartId')
  async view(@Param('cartId') cartId: string): Promise<CartDto> {
    return toCartDto(await this.views.guestCart(cart(cartId)));
  }

  @ApiOperation({
    summary: 'Agregar un producto',
    description:
      'Si la variante ya está en el carrito, suma a su línea, que queda con 30 unidades como máximo.',
  })
  @ApiOkResponse({ type: CartDto })
  @ApiProblemResponses(
    'not-found',
    'variant-not-sellable',
    'cart-not-active',
    'cart-line-limit-reached',
    'staff-cannot-purchase',
  )
  @UseGuards(NoStaffPurchases)
  @HttpCode(200)
  @Post(':cartId/lines')
  async addLine(
    @Param('cartId') cartId: string,
    @Body() body: AddCartLineDto,
  ): Promise<CartDto> {
    const id = cart(cartId);
    await this.carts.addLine(
      { guestCartId: id },
      toId<'Variant'>(body.variantId),
      body.quantity,
    );
    return toCartDto(await this.views.guestCart(id));
  }

  @ApiOperation({ summary: 'Cambiar la cantidad de un producto' })
  @ApiOkResponse({ type: CartDto })
  @ApiProblemResponses(
    'not-found',
    'variant-not-sellable',
    'cart-not-active',
    'staff-cannot-purchase',
  )
  @UseGuards(NoStaffPurchases)
  @Patch(':cartId/lines/:variantId')
  async changeLine(
    @Param('cartId') cartId: string,
    @Param('variantId') variantId: string,
    @Body() body: ChangeCartLineDto,
  ): Promise<CartDto> {
    const id = cart(cartId);
    await this.carts.changeLine(
      { guestCartId: id },
      line(variantId),
      body.quantity,
    );
    return toCartDto(await this.views.guestCart(id));
  }

  @ApiOperation({
    summary: 'Quitar un producto',
    description:
      'Responde el carrito, no 204, para ahorrar una lectura (ADR-0071). Quitar uno que no está no cambia nada.',
  })
  @ApiOkResponse({ type: CartDto })
  @ApiProblemResponses('not-found', 'cart-not-active', 'staff-cannot-purchase')
  @UseGuards(NoStaffPurchases)
  @Delete(':cartId/lines/:variantId')
  async removeLine(
    @Param('cartId') cartId: string,
    @Param('variantId') variantId: string,
  ): Promise<CartDto> {
    const id = cart(cartId);
    await this.carts.removeLine({ guestCartId: id }, line(variantId));
    return toCartDto(await this.views.guestCart(id));
  }
}

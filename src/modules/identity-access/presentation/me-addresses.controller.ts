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
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { RequireAccount } from '../../../platform/auth/authorization.decorators.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import { AddAddress } from '../application/add-address.use-case.js';
import { IdentityQueries } from '../application/identity.queries.js';
import { RemoveAddress } from '../application/remove-address.use-case.js';
import { UpdateAddress } from '../application/update-address.use-case.js';
import {
  AddressDto,
  AddressListDto,
  CreateAddressDto,
  UpdateAddressDto,
} from './address.dto.js';
import { pathId, toAddressDto } from './identity-admin.mappers.js';

/**
 * The signed-in customer's address book (UC-IAM-11, API_SPEC.md §9.14). The customer comes from the token,
 * never from the URL; another customer's address is answered 404 (ADR-0036).
 */
@ApiTags('Cuenta: direcciones')
@ApiProblemResponses('unauthenticated', 'forbidden')
@RequireAccount({ customerOnly: true })
@Controller('me/addresses')
export class MeAddressesController {
  constructor(
    private readonly queries: IdentityQueries,
    private readonly addAddress: AddAddress,
    private readonly updateAddress: UpdateAddress,
    private readonly removeAddress: RemoveAddress,
  ) {}

  @ApiOperation({ summary: 'Listar mis direcciones' })
  @ApiOkResponse({ type: AddressListDto })
  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<AddressListDto> {
    const addresses = await this.queries.listAddresses(toId(user.id));
    return { data: addresses.map(toAddressDto) };
  }

  @ApiOperation({
    summary: 'Agregar una dirección',
    description:
      'La primera dirección queda como predeterminada. El municipio debe estar vigente y pertenecer al estado.',
  })
  @ApiCreatedResponse({ type: AddressDto })
  @ApiProblemResponses('address-limit-reached')
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateAddressDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<AddressDto> {
    const { isDefault, ...fields } = body;
    const id = await this.addAddress.execute({
      customerId: toId(user.id),
      fields: {
        ...fields,
        interiorNumber: fields.interiorNumber ?? null,
        city: fields.city ?? null,
        references: fields.references ?? null,
      },
      makeDefault: isDefault ?? false,
    });
    response.setHeader('Location', `/v1/me/addresses/${id}`);
    return this.read(user, id);
  }

  @ApiOperation({
    summary: 'Cambiar una dirección',
    description:
      'Solo cambian los campos enviados. `isDefault: true` desmarca la anterior; `false` deja al cliente sin predeterminada.',
  })
  @ApiOkResponse({ type: AddressDto })
  @ApiProblemResponses('not-found')
  @Patch(':addressId')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId') addressId: string,
    @Body() body: UpdateAddressDto,
  ): Promise<AddressDto> {
    const { isDefault, ...changes } = body;
    const id = pathId<'Address'>(addressId, 'Address');
    await this.updateAddress.execute({
      customerId: toId(user.id),
      addressId: id,
      changes,
      makeDefault: isDefault,
    });
    return this.read(user, id);
  }

  @ApiOperation({
    summary: 'Borrar una dirección',
    description: 'Si era la predeterminada, ninguna queda como predeterminada.',
  })
  @ApiNoContentResponse()
  @ApiProblemResponses('not-found')
  @HttpCode(204)
  @Delete(':addressId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId') addressId: string,
  ): Promise<void> {
    await this.removeAddress.execute({
      customerId: toId(user.id),
      addressId: pathId<'Address'>(addressId, 'Address'),
    });
  }

  private async read(
    user: AuthenticatedUser,
    addressId: string,
  ): Promise<AddressDto> {
    const address = await this.queries.findAddress(toId(user.id), addressId);
    if (address === null) throw new NotFoundError('Address', addressId);
    return toAddressDto(address);
  }
}

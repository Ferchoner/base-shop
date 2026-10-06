import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import type { AddressInputDto } from '../../../platform/http/address.dto.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { type Id, NotFoundError } from '../../../shared-kernel/index.js';
import {
  InventoryQueries,
  type WarehouseView,
} from '../application/inventory.queries.js';
import { CreateWarehouse } from '../application/create-warehouse.use-case.js';
import { DeactivateWarehouse } from '../application/deactivate-warehouse.use-case.js';
import {
  UpdateWarehouse,
  type WarehouseAddressInput,
} from '../application/update-warehouse.use-case.js';
import {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  WarehouseDto,
  WarehouseListDto,
} from './inventory.dto.js';

const warehouse = (id: string) => pathId<'Warehouse'>(id, 'Warehouse');

/**
 * The warehouses (UC-INV-01, UC-INV-10, UC-INV-11, API_SPEC.md §13, ADR-0127, ADR-0160): the first one comes from a
 * migration, and each order is reserved in one of the active ones by priority. The staff creates them, changes
 * their name, address and priority, and deactivates them for good.
 */
@ApiTags('Administración: inventario')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/inventory/warehouses')
export class AdminWarehousesController {
  constructor(
    private readonly queries: InventoryQueries,
    private readonly createWarehouse: CreateWarehouse,
    private readonly updateWarehouse: UpdateWarehouse,
    private readonly deactivateWarehouse: DeactivateWarehouse,
  ) {}

  @ApiOperation({
    summary: 'Listar los almacenes',
    description:
      'Sin paginar, por prioridad y luego por código. Cada pedido se reserva completo en el primer almacén activo que lo tiene todo (ADR-0160).',
  })
  @ApiOkResponse({ type: WarehouseListDto })
  @RequirePermissions('inventory.read')
  @Get()
  async list(): Promise<WarehouseListDto> {
    return { data: (await this.queries.listWarehouses()).map(toWarehouseDto) };
  }

  @ApiOperation({
    summary: 'Crear un almacén',
    description:
      'Activo. Desde ese momento recibe mercancía y reserva los pedidos según su prioridad (ADR-0160). El código no se repite entre almacenes. El estado y el municipio de la dirección se validan contra el catálogo del INEGI. Se audita como `warehouses.create`.',
  })
  @ApiCreatedResponse({ type: WarehouseDto })
  @ApiProblemResponses('duplicate-value')
  @RequirePermissions('inventory.write')
  @Post()
  async create(
    @Body() body: CreateWarehouseDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<WarehouseDto> {
    const id = await this.createWarehouse.execute({
      code: body.code,
      name: body.name,
      address:
        body.address === undefined || body.address === null
          ? null
          : addressInput(body.address),
      priority: body.priority,
    });
    response.setHeader('Location', `/v1/admin/inventory/warehouses/${id}`);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Editar el nombre, la dirección o la prioridad de un almacén',
    description:
      'Solo cambian los campos enviados; `address: null` quita la dirección. El estado y el municipio se validan contra el catálogo del INEGI. La prioridad ordena en qué almacén se reservan los pedidos (ADR-0160). Se audita como `warehouses.update`.',
  })
  @ApiOkResponse({ type: WarehouseDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('inventory.write')
  @Patch(':warehouseId')
  async update(
    @Param('warehouseId') warehouseId: string,
    @Body() body: UpdateWarehouseDto,
  ): Promise<WarehouseDto> {
    const id = warehouse(warehouseId);
    await this.updateWarehouse.execute(id, {
      name: body.name,
      address:
        body.address === undefined || body.address === null
          ? body.address
          : addressInput(body.address),
      priority: body.priority,
    });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Desactivar un almacén',
    description:
      'Para siempre (ADR-0076): deja de vender, reservar y recibir mercancía, y conserva su stock, que los ajustes pueden mover. 409 `resource-in-use` si tiene unidades reservadas para pedidos, e `invalid-state-transition` si ya está inactivo o es el último activo (`reason: last-active-warehouse`). Se audita como `warehouses.deactivate`.',
  })
  @ApiOkResponse({ type: WarehouseDto })
  @ApiProblemResponses(
    'not-found',
    'invalid-state-transition',
    'resource-in-use',
  )
  @RequirePermissions('inventory.write')
  @HttpCode(200)
  @Post(':warehouseId/deactivate')
  async deactivate(
    @Param('warehouseId') warehouseId: string,
  ): Promise<WarehouseDto> {
    const id = warehouse(warehouseId);
    await this.deactivateWarehouse.execute(id);
    return this.read(id);
  }

  private async read(id: Id<'Warehouse'>): Promise<WarehouseDto> {
    const found = await this.queries.findWarehouse(id);
    if (found === null) throw new NotFoundError('Warehouse', id);
    return toWarehouseDto(found);
  }
}

/** The optional fields of an address as `null` when not sent. */
function addressInput(address: AddressInputDto): WarehouseAddressInput {
  return {
    ...address,
    interiorNumber: address.interiorNumber ?? null,
    city: address.city ?? null,
    references: address.references ?? null,
  };
}

function toWarehouseDto(view: WarehouseView): WarehouseDto {
  return { ...view };
}

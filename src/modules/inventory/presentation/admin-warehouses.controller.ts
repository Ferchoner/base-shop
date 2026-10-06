import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { NotFoundError } from '../../../shared-kernel/index.js';
import {
  InventoryQueries,
  type WarehouseView,
} from '../application/inventory.queries.js';
import { UpdateWarehouse } from '../application/update-warehouse.use-case.js';
import {
  UpdateWarehouseDto,
  WarehouseDto,
  WarehouseListDto,
} from './inventory.dto.js';

const warehouse = (id: string) => pathId<'Warehouse'>(id, 'Warehouse');

/**
 * The warehouses (UC-INV-01, API_SPEC.md §13, ADR-0127, ADR-0160): the first one comes from a migration, and each
 * order is reserved in one of the active ones by priority. The API reads them and changes their name and address.
 */
@ApiTags('Administración: inventario')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/inventory/warehouses')
export class AdminWarehousesController {
  constructor(
    private readonly queries: InventoryQueries,
    private readonly updateWarehouse: UpdateWarehouse,
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
    summary: 'Editar el nombre o la dirección del almacén',
    description:
      'Solo cambian los campos enviados; `address: null` quita la dirección. El estado y el municipio se validan contra el catálogo del INEGI.',
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
          : {
              ...body.address,
              interiorNumber: body.address.interiorNumber ?? null,
              city: body.address.city ?? null,
              references: body.address.references ?? null,
            },
    });
    const updated = await this.queries.findWarehouse(id);
    if (updated === null) throw new NotFoundError('Warehouse', id);
    return toWarehouseDto(updated);
  }
}

function toWarehouseDto(view: WarehouseView): WarehouseDto {
  return { ...view };
}

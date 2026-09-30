import {
  Body,
  Controller,
  Delete,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import {
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { NotFoundError } from '../../../shared-kernel/index.js';
import type { CatalogStatus } from '../application/catalog-limits.js';
import {
  type BrandSortField,
  CatalogQueries,
} from '../application/catalog.queries.js';
import { ChangeBrandStatus } from '../application/change-brand-status.use-case.js';
import { CreateBrand } from '../application/create-brand.use-case.js';
import { DeleteBrand } from '../application/delete-brand.use-case.js';
import { UpdateBrand } from '../application/update-brand.use-case.js';
import {
  AdminBrandDto,
  AdminBrandListDto,
  AdminBrandListQueryDto,
  CreateBrandDto,
  UpdateBrandDto,
} from './catalog-admin.dto.js';
import { toAdminBrandDto } from './catalog.mappers.js';

const brand = (id: string) => pathId<'Brand'>(id, 'Brand');

/**
 * Brands of the catalog (UC-CAT-13, API_SPEC.md §11.9, ADR-0120). Brands have no `version`: the last change
 * wins.
 */
@ApiTags('Administración: catálogo')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/catalog/brands')
export class AdminBrandsController {
  constructor(
    private readonly queries: CatalogQueries,
    private readonly createBrand: CreateBrand,
    private readonly updateBrand: UpdateBrand,
    private readonly changeBrandStatus: ChangeBrandStatus,
    private readonly deleteBrand: DeleteBrand,
  ) {}

  @ApiOperation({ summary: 'Listar marcas' })
  @ApiOkResponse({ type: AdminBrandListDto })
  @RequirePermissions('catalog.read')
  @Get()
  async list(
    @Query() query: AdminBrandListQueryDto,
  ): Promise<AdminBrandListDto> {
    const page = await this.queries.listBrands(
      { q: query.q, statuses: query.status as CatalogStatus[] | undefined },
      toSortOrders<BrandSortField>(query.sort, 'name'),
      query,
    );
    return toPageResponse(page, query, toAdminBrandDto);
  }

  @ApiOperation({ summary: 'Crear una marca' })
  @ApiCreatedResponse({ type: AdminBrandDto })
  @ApiProblemResponses('duplicate-value')
  @RequirePermissions('catalog.write')
  @Post()
  async create(
    @Body() body: CreateBrandDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<AdminBrandDto> {
    const id = await this.createBrand.execute(body);
    response.setHeader('Location', `/v1/admin/catalog/brands/${id}`);
    return this.read(id);
  }

  @ApiOperation({ summary: 'Editar una marca' })
  @ApiOkResponse({ type: AdminBrandDto })
  @ApiProblemResponses('not-found', 'duplicate-value')
  @RequirePermissions('catalog.write')
  @Patch(':brandId')
  async update(
    @Param('brandId') brandId: string,
    @Body() body: UpdateBrandDto,
  ): Promise<AdminBrandDto> {
    const id = brand(brandId);
    await this.updateBrand.execute(id, body);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Desactivar una marca',
    description:
      'Deja de aparecer en el listado público de marcas; sus productos siguen visibles con ella (ADR-0080).',
  })
  @ApiOkResponse({ type: AdminBrandDto })
  @ApiProblemResponses('not-found', 'invalid-state-transition')
  @RequirePermissions('catalog.write')
  @HttpCode(200)
  @Post(':brandId/deactivate')
  async deactivate(@Param('brandId') brandId: string): Promise<AdminBrandDto> {
    const id = brand(brandId);
    await this.changeBrandStatus.deactivate(id);
    return this.read(id);
  }

  @ApiOperation({ summary: 'Reactivar una marca' })
  @ApiOkResponse({ type: AdminBrandDto })
  @ApiProblemResponses('not-found', 'invalid-state-transition')
  @RequirePermissions('catalog.write')
  @HttpCode(200)
  @Post(':brandId/reactivate')
  async reactivate(@Param('brandId') brandId: string): Promise<AdminBrandDto> {
    const id = brand(brandId);
    await this.changeBrandStatus.reactivate(id);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Borrar una marca sin productos',
    description: 'Si tiene productos, se desactiva en su lugar (BR-PRD-10).',
  })
  @ApiNoContentResponse()
  @ApiProblemResponses('not-found', 'resource-in-use')
  @RequirePermissions('catalog.write')
  @HttpCode(204)
  @Delete(':brandId')
  async remove(@Param('brandId') brandId: string): Promise<void> {
    await this.deleteBrand.execute(brand(brandId));
  }

  private async read(id: string): Promise<AdminBrandDto> {
    const view = await this.queries.findBrand(brand(id));
    if (view === null) throw new NotFoundError('Brand', id);
    return toAdminBrandDto(view);
  }
}

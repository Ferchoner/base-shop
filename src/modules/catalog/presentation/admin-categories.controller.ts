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
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { type Id, NotFoundError, toId } from '../../../shared-kernel/index.js';
import type { CatalogStatus } from '../application/catalog-limits.js';
import { CatalogQueries } from '../application/catalog.queries.js';
import { adminCategoryTree } from '../application/category-trees.js';
import { CreateCategory } from '../application/create-category.use-case.js';
import { DeactivateCategory } from '../application/deactivate-category.use-case.js';
import { DeleteCategory } from '../application/delete-category.use-case.js';
import { ReactivateCategory } from '../application/reactivate-category.use-case.js';
import { UpdateCategory } from '../application/update-category.use-case.js';
import {
  AdminCategoryDto,
  AdminCategoryTreeDto,
  AdminCategoryTreeQueryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './catalog-admin.dto.js';
import {
  toAdminCategoryDto,
  toAdminCategoryNodeDto,
} from './catalog.mappers.js';

const category = (id: string) => pathId<'Category'>(id, 'Category');

/**
 * Categories of the catalog (UC-CAT-12, API_SPEC.md §11.9, ADR-0120). Categories have no `version`: the
 * last change wins. The store sees changes when its cache expires (ADR-0076).
 */
@ApiTags('Administración: catálogo')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/catalog/categories')
export class AdminCategoriesController {
  constructor(
    private readonly queries: CatalogQueries,
    private readonly createCategory: CreateCategory,
    private readonly updateCategory: UpdateCategory,
    private readonly deactivateCategory: DeactivateCategory,
    private readonly reactivateCategory: ReactivateCategory,
    private readonly deleteCategory: DeleteCategory,
  ) {}

  @ApiOperation({ summary: 'Árbol completo de categorías, con inactivas' })
  @ApiOkResponse({ type: AdminCategoryTreeDto })
  @RequirePermissions('catalog.read')
  @Get()
  async tree(
    @Query() query: AdminCategoryTreeQueryDto,
  ): Promise<AdminCategoryTreeDto> {
    const categories = await this.queries.listCategories();
    return {
      data: adminCategoryTree(
        categories,
        query.status as CatalogStatus[] | undefined,
      ).map(toAdminCategoryNodeDto),
    };
  }

  @ApiOperation({ summary: 'Crear una categoría' })
  @ApiCreatedResponse({ type: AdminCategoryDto })
  @ApiProblemResponses('duplicate-value')
  @RequirePermissions('catalog.write')
  @Post()
  async create(
    @Body() body: CreateCategoryDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<AdminCategoryDto> {
    const id = await this.createCategory.execute({
      name: body.name,
      slug: body.slug,
      parentId: parentIdOf(body.parentId ?? null),
      position: body.position,
    });
    response.setHeader('Location', `/v1/admin/catalog/categories/${id}`);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Editar o mover una categoría',
    description:
      'Mover no puede crear ciclos: 409 `invalid-state-transition` con `reason: category-cycle`.',
  })
  @ApiOkResponse({ type: AdminCategoryDto })
  @ApiProblemResponses(
    'not-found',
    'duplicate-value',
    'invalid-state-transition',
  )
  @RequirePermissions('catalog.write')
  @Patch(':categoryId')
  async update(
    @Param('categoryId') categoryId: string,
    @Body() body: UpdateCategoryDto,
  ): Promise<AdminCategoryDto> {
    const id = category(categoryId);
    await this.updateCategory.execute(id, {
      name: body.name,
      slug: body.slug,
      parentId:
        body.parentId === undefined ? undefined : parentIdOf(body.parentId),
      position: body.position,
    });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Desactivar una categoría',
    description:
      'Deja de verse en la tienda junto con sus subcategorías; sus productos siguen visibles (ADR-0080).',
  })
  @ApiOkResponse({ type: AdminCategoryDto })
  @ApiProblemResponses('not-found', 'invalid-state-transition')
  @RequirePermissions('catalog.write')
  @HttpCode(200)
  @Post(':categoryId/deactivate')
  async deactivate(
    @Param('categoryId') categoryId: string,
  ): Promise<AdminCategoryDto> {
    const id = category(categoryId);
    await this.deactivateCategory.execute(id);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Reactivar una categoría',
    description:
      'Solo si su padre está activa o es raíz; no reactiva sus subcategorías. Con el padre inactivo: 409 `invalid-state-transition` con `reason: inactive-parent`.',
  })
  @ApiOkResponse({ type: AdminCategoryDto })
  @ApiProblemResponses('not-found', 'invalid-state-transition')
  @RequirePermissions('catalog.write')
  @HttpCode(200)
  @Post(':categoryId/reactivate')
  async reactivate(
    @Param('categoryId') categoryId: string,
  ): Promise<AdminCategoryDto> {
    const id = category(categoryId);
    await this.reactivateCategory.execute(id);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Borrar una categoría sin subcategorías ni productos',
    description: 'Si los tiene, se desactiva en su lugar (BR-PRD-10).',
  })
  @ApiNoContentResponse()
  @ApiProblemResponses('not-found', 'resource-in-use')
  @RequirePermissions('catalog.write')
  @HttpCode(204)
  @Delete(':categoryId')
  async remove(@Param('categoryId') categoryId: string): Promise<void> {
    await this.deleteCategory.execute(category(categoryId));
  }

  private async read(id: string): Promise<AdminCategoryDto> {
    const view = await this.queries.findCategory(category(id));
    if (view === null) throw new NotFoundError('Category', id);
    return toAdminCategoryDto(view);
  }
}

/**
 * The parent from the body, already checked as a UUID by the DTO; `null` is the root. An unknown parent is a
 * validation error of the body (400), not a missing resource of the URL (404).
 */
function parentIdOf(id: string | null): Id<'Category'> | null {
  return id === null ? null : toId<'Category'>(id);
}

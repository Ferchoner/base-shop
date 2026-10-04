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
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import {
  toPageResponse,
  toSortOrders,
} from '../../../platform/http/pagination/pagination.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { type Id, NotFoundError, toId } from '../../../shared-kernel/index.js';
import type { ProductStatus } from '../application/catalog-limits.js';
import {
  CatalogQueries,
  type ProductSortField,
} from '../application/catalog.queries.js';
import { CreateProduct } from '../application/create-product.use-case.js';
import { ProductImageStorage } from '../application/product-image-storage.js';
import { ProductLifecycle } from '../application/product-lifecycle.use-case.js';
import { ProductVariants } from '../application/product-variants.use-case.js';
import { Storefront } from '../application/storefront.js';
import { UpdateProduct } from '../application/update-product.use-case.js';
import {
  AdminProductDto,
  AdminProductListDto,
  AdminProductListQueryDto,
  CreateProductDto,
  CreateVariantDto,
  ProductVersionDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './catalog-product.dto.js';
import { toAdminProductDto } from './catalog.mappers.js';

const product = (id: string) => pathId<'Product'>(id, 'Product');
const variant = (id: string) => pathId<'Variant'>(id, 'Variant');

/** IDs from the body, already checked as UUIDs by the DTO; unknown ones are validation errors (400). */
const brandIdOf = (
  id: string | null | undefined,
): Id<'Brand'> | null | undefined =>
  id === undefined || id === null ? id : toId<'Brand'>(id);
const categoryIdsOf = (ids: string[] | undefined) =>
  ids?.map((id) => toId<'Category'>(id));

const LIFECYCLE_PROBLEMS = [
  'not-found',
  'invalid-state-transition',
  'version-conflict',
] as const;

/**
 * Products and their variants (UC-CAT-04 to 10 and 14, API_SPEC.md §11.6 and §11.7, ADR-0123). Every change
 * carries the product `version`. `storeVisibility` comes from the store's own reads, so the staff sees what the
 * store shows (ADR-0129).
 */
@ApiTags('Administración: catálogo')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/catalog/products')
export class AdminProductsController {
  constructor(
    private readonly queries: CatalogQueries,
    private readonly images: ProductImageStorage,
    private readonly createProduct: CreateProduct,
    private readonly updateProduct: UpdateProduct,
    private readonly lifecycle: ProductLifecycle,
    private readonly variants: ProductVariants,
    private readonly storefront: Storefront,
  ) {}

  @ApiOperation({
    summary: 'Listar productos, con borradores y archivados',
    description:
      'Paginado, sin la descripción de cada producto. Filtros por parte del título o del SKU, por estado, marca y categoría; orden por última modificación, la más reciente primero por defecto, título, alta o publicación.',
  })
  @ApiOkResponse({ type: AdminProductListDto })
  @RequirePermissions('catalog.read')
  @Get()
  async list(
    @Query() query: AdminProductListQueryDto,
  ): Promise<AdminProductListDto> {
    const page = await this.queries.listProducts(
      {
        q: query.q,
        statuses: query.status as ProductStatus[] | undefined,
        brandId:
          query.brandId === undefined
            ? undefined
            : toId<'Brand'>(query.brandId),
        categoryId:
          query.categoryId === undefined
            ? undefined
            : toId<'Category'>(query.categoryId),
      },
      toSortOrders<ProductSortField>(query.sort, '-updatedAt'),
      query,
    );
    const visibilities = await this.storefront.visibilities(
      page.items.map(({ id }) => id),
    );
    return toPageResponse(page, query, (view, index) =>
      toAdminProductDto(view, this.urlOf, visibilities[index]),
    );
  }

  @ApiOperation({
    summary: 'Crear un producto en borrador',
    description:
      'En `DRAFT` y sin variantes: se publica después de agregarle al menos una. Sin `slug`, se genera del título.',
  })
  @ApiCreatedResponse({ type: AdminProductDto })
  @ApiProblemResponses('duplicate-value')
  @RequirePermissions('catalog.write')
  @Post()
  async create(
    @Body() body: CreateProductDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<AdminProductDto> {
    const id = await this.createProduct.execute({
      title: body.title,
      slug: body.slug,
      description: body.description ?? null,
      brandId: brandIdOf(body.brandId) ?? null,
      categoryIds: categoryIdsOf(body.categoryIds) ?? [],
    });
    response.setHeader('Location', `/v1/admin/catalog/products/${id}`);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Consultar un producto',
    description:
      'En cualquier estado, con sus variantes, imágenes, categorías y `storeVisibility`, que dice si la tienda lo muestra.',
  })
  @ApiOkResponse({ type: AdminProductDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('catalog.read')
  @Get(':productId')
  get(@Param('productId') productId: string): Promise<AdminProductDto> {
    return this.read(productId);
  }

  @ApiOperation({
    summary: 'Editar los datos de un producto',
    description:
      'El slug queda fijo desde la primera publicación: 409 `field-locked`. Un producto archivado no se edita.',
  })
  @ApiOkResponse({ type: AdminProductDto })
  @ApiProblemResponses(
    'not-found',
    'duplicate-value',
    'field-locked',
    'invalid-state-transition',
    'version-conflict',
  )
  @RequirePermissions('catalog.write')
  @Patch(':productId')
  async update(
    @Param('productId') productId: string,
    @Body() body: UpdateProductDto,
  ): Promise<AdminProductDto> {
    const id = product(productId);
    await this.updateProduct.execute(id, {
      title: body.title,
      slug: body.slug,
      description: body.description,
      brandId: brandIdOf(body.brandId),
      categoryIds: categoryIdsOf(body.categoryIds),
      version: body.version,
    });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Publicar un producto',
    description:
      'Requiere al menos una variante activa (`reason: no-active-variant`); no exige precio ni imagen.',
  })
  @ApiOkResponse({ type: AdminProductDto })
  @ApiProblemResponses(...LIFECYCLE_PROBLEMS)
  @RequirePermissions('catalog.write')
  @HttpCode(200)
  @Post(':productId/publish')
  async publish(
    @Param('productId') productId: string,
    @Body() body: ProductVersionDto,
  ): Promise<AdminProductDto> {
    const id = product(productId);
    await this.lifecycle.publish(id, body.version);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Archivar un producto',
    description: 'Desde borrador o publicado; el slug sigue reservado.',
  })
  @ApiOkResponse({ type: AdminProductDto })
  @ApiProblemResponses(...LIFECYCLE_PROBLEMS)
  @RequirePermissions('catalog.write')
  @HttpCode(200)
  @Post(':productId/archive')
  async archive(
    @Param('productId') productId: string,
    @Body() body: ProductVersionDto,
  ): Promise<AdminProductDto> {
    const id = product(productId);
    await this.lifecycle.archive(id, body.version);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Reactivar un producto archivado',
    description:
      'Vuelve a borrador; conserva el slug y la primera publicación.',
  })
  @ApiOkResponse({ type: AdminProductDto })
  @ApiProblemResponses(...LIFECYCLE_PROBLEMS)
  @RequirePermissions('catalog.write')
  @HttpCode(200)
  @Post(':productId/reactivate')
  async reactivate(
    @Param('productId') productId: string,
    @Body() body: ProductVersionDto,
  ): Promise<AdminProductDto> {
    const id = product(productId);
    await this.lifecycle.reactivate(id, body.version);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Agregar una variante',
    description:
      'Con la `version` del producto. El SKU no se repite ni se reutiliza (BR-PRD-09), y la combinación de opciones tampoco (BR-PRD-02). Responde el producto con la variante.',
  })
  @ApiCreatedResponse({ type: AdminProductDto })
  @ApiProblemResponses(
    'not-found',
    'duplicate-value',
    'field-locked',
    'invalid-state-transition',
    'version-conflict',
  )
  @RequirePermissions('catalog.write')
  @Post(':productId/variants')
  async addVariant(
    @Param('productId') productId: string,
    @Body() body: CreateVariantDto,
  ): Promise<AdminProductDto> {
    const id = product(productId);
    await this.variants.add(id, {
      sku: body.sku,
      options: body.options ?? {},
      weightGrams: body.weightGrams ?? null,
      lengthCm: body.lengthCm ?? null,
      widthCm: body.widthCm ?? null,
      heightCm: body.heightCm ?? null,
      version: body.version,
    });
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Editar una variante',
    description:
      'SKU y opciones solo mientras el producto nunca se ha publicado (409 `field-locked`); peso y medidas siempre.',
  })
  @ApiOkResponse({ type: AdminProductDto })
  @ApiProblemResponses(
    'not-found',
    'duplicate-value',
    'field-locked',
    'invalid-state-transition',
    'version-conflict',
  )
  @RequirePermissions('catalog.write')
  @Patch(':productId/variants/:variantId')
  async updateVariant(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() body: UpdateVariantDto,
  ): Promise<AdminProductDto> {
    const id = product(productId);
    await this.variants.update(id, variant(variantId), body);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Descontinuar una variante',
    description:
      'De `ACTIVE` a `DISCONTINUED`: deja de venderse y sale de la tienda. Su SKU queda reservado.',
  })
  @ApiOkResponse({ type: AdminProductDto })
  @ApiProblemResponses(...LIFECYCLE_PROBLEMS)
  @RequirePermissions('catalog.write')
  @HttpCode(200)
  @Post(':productId/variants/:variantId/discontinue')
  async discontinueVariant(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() body: ProductVersionDto,
  ): Promise<AdminProductDto> {
    const id = product(productId);
    await this.variants.discontinue(id, variant(variantId), body.version);
    return this.read(id);
  }

  @ApiOperation({
    summary: 'Reactivar una variante descontinuada',
    description:
      'Con el mismo SKU y opciones; 409 `duplicate-value` si otra variante activa tiene su combinación.',
  })
  @ApiOkResponse({ type: AdminProductDto })
  @ApiProblemResponses(...LIFECYCLE_PROBLEMS, 'duplicate-value')
  @RequirePermissions('catalog.write')
  @HttpCode(200)
  @Post(':productId/variants/:variantId/reactivate')
  async reactivateVariant(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() body: ProductVersionDto,
  ): Promise<AdminProductDto> {
    const id = product(productId);
    await this.variants.reactivate(id, variant(variantId), body.version);
    return this.read(id);
  }

  private async read(id: string): Promise<AdminProductDto> {
    const view = await this.queries.findProduct(product(id));
    if (view === null) throw new NotFoundError('Product', id);
    const [visibility] = await this.storefront.visibilities([view.id]);
    return toAdminProductDto(view, this.urlOf, visibility);
  }

  private readonly urlOf = (key: string) => this.images.urlOf(key);
}

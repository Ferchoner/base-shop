import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { pathId } from '../../../platform/http/path-id.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { toId } from '../../../shared-kernel/index.js';
import type { ProductImageView } from '../application/catalog.queries.js';
import { ProductImageStorage } from '../application/product-image-storage.js';
import { ProductImages } from '../application/product-images.use-case.js';
import {
  ImageDto,
  ImageListDto,
  ImageOrderDto,
  ImageUploadFieldsDto,
  UpdateImageDto,
} from './catalog-product.dto.js';
import {
  ImageUpload,
  requireImage,
  type UploadedImage,
} from './image-upload.js';

const product = (id: string) => pathId<'Product'>(id, 'Product');
const image = (id: string) => pathId<'ProductImage'>(id, 'ProductImage');

/** A variant from the body, already checked as a UUID by the DTO; `null` takes it away. */
const variantIdOf = (id: string | null | undefined) =>
  id === undefined || id === null ? id : toId<'Variant'>(id);

/**
 * Images of a product (UC-CAT-11, API_SPEC.md §11.8, ADR-0124), on the base of T-141 (ADR-0121). They do not
 * carry the product `version`; changes lock the product row instead. The store sees them when its cache
 * expires (ADR-0028).
 */
@ApiTags('Administración: catálogo')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@RequirePermissions('catalog.write')
@Controller('admin/catalog/products/:productId/images')
export class AdminProductImagesController {
  constructor(
    private readonly images: ProductImages,
    private readonly storage: ProductImageStorage,
  ) {}

  @ApiOperation({
    summary: 'Subir una imagen',
    description:
      'JPEG, PNG o WebP reconocido por su contenido; se agrega al final. Hasta 20 imágenes por producto.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        altText: { type: 'string', maxLength: 200 },
        variantId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiCreatedResponse({ type: ImageDto })
  @ApiProblemResponses(
    'not-found',
    'image-limit-reached',
    'invalid-state-transition',
    'payload-too-large',
    'unsupported-media-type',
  )
  @ImageUpload()
  @Post()
  async upload(
    @Param('productId') productId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Body() fields: ImageUploadFieldsDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ): Promise<ImageDto> {
    const id = product(productId);
    const uploaded = await this.images.upload(id, {
      bytes: requireImage(file).buffer,
      altText: fields.altText ?? null,
      variantId: variantIdOf(fields.variantId) ?? null,
    });
    response.setHeader(
      'Location',
      `/v1/admin/catalog/products/${id}/images/${uploaded.id}`,
    );
    return this.toDto(uploaded);
  }

  @ApiOperation({
    summary: 'Editar el texto alternativo o la variante de una imagen',
    description:
      'Cambian solo los campos enviados; `null` quita el texto alternativo o la variante, y la imagen queda del producto. Un producto archivado responde 409.',
  })
  @ApiOkResponse({ type: ImageDto })
  @ApiProblemResponses('not-found', 'invalid-state-transition')
  @Patch(':imageId')
  async describe(
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
    @Body() body: UpdateImageDto,
  ): Promise<ImageDto> {
    return this.toDto(
      await this.images.describe(product(productId), image(imageId), {
        altText: body.altText,
        variantId: variantIdOf(body.variantId),
      }),
    );
  }

  @ApiOperation({
    summary: 'Reordenar las imágenes',
    description: 'Con todas las imágenes del producto, cada una una vez.',
  })
  @ApiOkResponse({ type: ImageListDto })
  @ApiProblemResponses('not-found', 'invalid-state-transition')
  @Put('order')
  async reorder(
    @Param('productId') productId: string,
    @Body() body: ImageOrderDto,
  ): Promise<ImageListDto> {
    const ordered = await this.images.reorder(
      product(productId),
      body.imageIds.map((id) => toId<'ProductImage'>(id)),
    );
    return { data: ordered.map((view) => this.toDto(view)) };
  }

  @ApiOperation({
    summary: 'Borrar una imagen',
    description: 'Borra la fila y el archivo.',
  })
  @ApiNoContentResponse()
  @ApiProblemResponses('not-found', 'invalid-state-transition')
  @HttpCode(204)
  @Delete(':imageId')
  async remove(
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ): Promise<void> {
    await this.images.remove(product(productId), image(imageId));
  }

  private toDto({ storageKey, ...view }: ProductImageView): ImageDto {
    return { ...view, url: this.storage.urlOf(storageKey) };
  }
}

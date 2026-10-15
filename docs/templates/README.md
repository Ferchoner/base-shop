# Plantillas de carga masiva

Ejemplos de los archivos que reciben las cargas masivas de la API (ADR-0126, ADR-0164). Las pruebas end-to-end los importan, así que siempre son válidos: sirven de punto de partida para armar los de una tienda.

## Orden para dar de alta un catálogo

1. **Marcas y categorías:** desde el backoffice, una por una. La carga de productos las busca por su slug y no las crea.
2. **Productos con sus variantes:** [`products.csv`](products.csv), con `POST /v1/admin/catalog/product-imports` (`API_SPEC.md` §11.11).
3. **Precios:** [`prices.csv`](prices.csv), con `POST /v1/admin/pricing/price-lists/{priceListId}/imports` (`API_SPEC.md` §12).
4. **Existencias:** su carga llega en la parte b de T-146 (ADR-0164).
5. **Imágenes y publicación:** desde el backoffice, producto por producto. Los productos cargados quedan en borrador.

Cada carga acepta `?dryRun=true`, que revisa el archivo completo sin guardar nada. Es todo o nada: con un error en cualquier fila no se carga ninguna, y la respuesta trae los primeros 100 errores con su línea y su columna.

## Cómo guardar el archivo

- Un CSV en UTF-8, separado por comas y con encabezado. En Excel: "Guardar como" → "CSV UTF-8 (delimitado por comas)".
- Los encabezados van en inglés, en cualquier orden y sin distinguir mayúsculas.
- Un valor con comas, comillas o saltos de línea va entre comillas dobles, y una comilla dentro de él se escribe doble (`""`). Excel lo hace solo.
- Hasta 5,000 filas por archivo: 5 MB el de productos y 1 MB el de precios.

## `products.csv`: una fila por variante

Las filas con el mismo `slug` forman un producto. Sus datos (`title`, `description`, `brand` y `categories`) van en su primera fila; las siguientes los dejan vacíos o los repiten iguales.

| Columna | Obligatoria | Valor |
|---|---|---|
| `slug` | Sí | Minúsculas, dígitos y guiones, como `camisa-lino`; no debe existir. |
| `title` | En la primera fila del producto | De 1 a 200 caracteres. |
| `description` | No | Hasta 10,000 caracteres. |
| `brand` | No | El slug de una marca activa. |
| `categories` | No | Slugs de categorías activas separados por `\|`, hasta 10. |
| `sku` | Sí | De 1 a 64 letras, dígitos, `-`, `_` y `.`; se guarda en mayúsculas y no debe haberse usado nunca. |
| `gtin` | No | El código de barras del fabricante: 8, 12, 13 o 14 dígitos, con su dígito verificador. |
| `option:<nombre>` | No | Una columna por opción, como `option:talla`, hasta 3 por producto. Todas las variantes de un producto llenan las mismas, con combinaciones distintas; un producto sin opciones lleva una sola variante. |
| `weightGrams` | No | Gramos enteros, mayores que 0. |
| `lengthCm`, `widthCm`, `heightCm` | No | Centímetros con punto decimal y hasta un decimal, como `30.5`. |

## `prices.csv`

| Columna | Obligatoria | Valor |
|---|---|---|
| `sku` | Sí | El de una variante existente. |
| `amount` | Sí | Pesos con punto decimal y hasta 2 decimales, sin `$` ni separador de miles: `599.00`. |
| `compareAtAmount` | No | El precio de comparación, mayor que `amount`. |
| `effectiveFrom` | No | Vacía: desde ahora. Una fecha y hora de México, como `2026-11-14 00:00`, programa el precio. |

# API SPECIFICATION

**Estado:** aprobado (ADR-0071, T-005, 2026-09-25). Aún no hay endpoints implementados. Los contratos se derivan de `REQUIREMENTS.md` (casos de uso UC-xxx y errores E-xx), `DATABASE.md` (ADR-0066), `SECURITY.md` y las decisiones de `DECISIONS.md`. Lo no decidido se marca como PENDIENTE DE DECISIÓN con su P-xx.

Índice:

1. Principios
2. Convenciones generales
3. Autenticación y autorización
4. Idempotencia
5. Listados: paginación, filtros y ordenamiento
6. Formato de errores
7. Rate limiting
8. Representaciones compartidas
9. Endpoints — Identity & Access
10. Endpoints — Catálogo geográfico
11. Endpoints — Catalog
12. Endpoints — Pricing
13. Endpoints — Inventory
14. Endpoints — Shopping
15. Endpoints — Checkout y Ordering
16. Endpoints — Payments
17. Endpoints — Shipping
18. Endpoints — Auditoría
19. Webhooks
20. Pendientes que afectan a los contratos
21. Cobertura de casos de uso

---

## 1. Principios

- La API es independiente del frontend: no usa cookies, sesiones de navegador ni supuestos de un framework cliente (ADR-0010, ADR-0023).
- Versionado por prefijo: todo vive bajo `/v1`; dentro de `v1` solo hay cambios compatibles (ADR-0034).
- Los DTOs HTTP pertenecen a Presentation y no se usan como objetos de dominio (ADR-0003).
- Ningún dato calculado se acepta del cliente: precios, totales, impuestos y montos de pago los calcula el servidor (BR-ORD-02, BR-PAY-02).
- El servidor nunca confía en identificadores que definen al propietario: en `/v1/me` el cliente se toma del token (ADR-0036).

---

## 2. Convenciones generales

### 2.1 Formato

| Tema | Convención | Fuente |
|---|---|---|
| Base | `/v1` | ADR-0034 |
| Cuerpo | JSON UTF-8 (`application/json`); subida de imágenes con `multipart/form-data`; errores con `application/problem+json` | ADR-0035 |
| Recursos | Plural, en inglés y separados por guion: `/v1/admin/pricing/price-lists` | ADR-0036 |
| Campos | camelCase | ADR-0036 |
| Identificadores | `uuid` en rutas y cuerpos. Excepciones: producto público por `slug`; orden de cliente por código público (`publicCode`) | ADR-0049, ADR-0066 |
| Código público de orden | Se devuelve como `K7M4-Q9XA`; se acepta con o sin guion y sin distinguir mayúsculas | ADR-0049 |
| Fechas | ISO 8601 en UTC con milisegundos: `2026-09-25T18:30:00.000Z` | ADR-0036 |
| Dinero | Objeto `Money` (sección 8.1) en respuestas; en solicitudes, enteros en centavos donde se indique | ADR-0007 |
| Enumeraciones | Texto en MAYÚSCULAS (`PENDING_PAYMENT`). Los clientes deben tolerar valores desconocidos | ADR-0050 |
| Colecciones | Siempre arreglo, nunca `null` | ADR-0016 |
| Opcionales | Un campo opcional sin valor se devuelve como `null` (no se omite) | ADR-0071 |
| Campos desconocidos | Un cuerpo con campos no declarados se rechaza con 400 | ADR-0071 |
| Idioma | `title` y `detail` de los errores y los mensajes de validación en español | ADR-0071 |

### 2.2 Métodos y códigos de éxito

| Operación | Método | Éxito |
|---|---|---|
| Consultar | `GET` | 200 |
| Crear | `POST` sobre la colección | 201 con encabezado `Location` y el recurso creado |
| Actualizar parcialmente | `PATCH` (campo ausente = sin cambio; `null` borra un campo opcional) | 200 con el recurso actualizado |
| Reemplazar un conjunto | `PUT` (por ejemplo, roles de un usuario u orden de imágenes) | 200 |
| Borrar | `DELETE` | 204 sin cuerpo |
| Transición de estado | `POST` sobre una subruta de acción: `/publish`, `/cancel`, `/dispatch` | 200 con el recurso actualizado |
| Operación aceptada sin resultado visible (correos) | `POST` | 202 sin revelar si el email existe |

Las transiciones de estado nunca se hacen con `PATCH` del campo `status`: cada una tiene su acción, su permiso y sus validaciones (ADR-0071).

### 2.3 Concurrencia optimista

Los recursos con columna `version` (`products`, `roles`, `users` de staff, `orders`, `shipments`, `shipping_methods`, `price_lists`) devuelven `version` en su representación. Toda modificación administrativa de esos recursos (PATCH y acciones) exige `version` en el cuerpo:

- `version` ausente → 400 `validation-error`.
- `version` distinta de la actual → 409 `version-conflict` (E-05); el cliente vuelve a leer y reintenta.

Las operaciones del cliente sobre su carrito no exigen `version`; el servidor resuelve la concurrencia internamente (ADR-0071).

### 2.4 Encabezados

| Encabezado | Dirección | Uso |
|---|---|---|
| `Authorization: Bearer <accessToken>` | Solicitud | Rutas `/v1/me` y `/v1/admin`, y cierre de sesión |
| `Idempotency-Key` | Solicitud | Obligatorio donde se indica (sección 4) |
| `Content-Type` | Solicitud | `application/json` o `multipart/form-data`; otro → 415 |
| `X-Correlation-Id` | Respuesta | En todas las respuestas; mismo valor que `correlationId` de los errores (ADR-0033) |
| `Location` | Respuesta | En 201 cuando el recurso tiene ruta propia |
| `Retry-After` | Respuesta | En 429 y en 409 `idempotency-request-in-progress` |
| `Cache-Control: no-store` | Respuesta | En toda respuesta autenticada y en las que contienen datos personales o tokens (ADR-0071) |

---

## 3. Autenticación y autorización

### 3.1 Mecanismo (ADR-0022, ADR-0023, ADR-0047, ADR-0048)

- Login con email y contraseña → token de acceso JWT (15 minutos) y refresh token opaco (7 días, rotado en cada uso).
- Token de acceso en `Authorization: Bearer`; refresh token en el cuerpo JSON de `/v1/auth/refresh` y `/v1/auth/logout`.
- Presentar un refresh token ya rotado revoca toda la sesión.

### 3.2 Grupos de rutas (ADR-0036)

| Grupo | Prefijo | Requisito | Guard |
|---|---|---|---|
| Público | `/v1/auth`, `/v1/geo`, `/v1/catalog`, `/v1/carts`, `/v1/checkout`, `/v1/orders` | Ninguno | Rate limiting |
| Cuenta | `/v1/me` | Token de acceso válido de una cuenta ACTIVE | Autenticación; algunas rutas solo para clientes (se indica con "Solo cliente") |
| Administración | `/v1/admin/{contexto}` | Token de staff ACTIVE y el permiso indicado | Autenticación + tipo STAFF + permiso |
| Webhooks | `/v1/webhooks/{proveedor}` | Firma del proveedor | Verificación de firma |

Reglas:

- Un token de cliente en `/v1/admin` → 403 `forbidden`.
- Un token de staff en rutas "Solo cliente" de `/v1/me` → 403 `staff-cannot-purchase` (E-09) en carrito y checkout, 403 `forbidden` en el resto.
- **Cambio de contraseña obligatorio:** mientras un staff tenga `mustChangePassword`, cualquier ruta excepto `GET /v1/me`, `POST /v1/me/password` y `POST /v1/auth/logout` responde 403 `password-change-required` (E-18) (ADR-0071).
- Un recurso de otro propietario se responde como inexistente (404), nunca como 403, para no revelar su existencia.

### 3.3 Permisos

Catálogo de ADR-0043 y ADR-0075 (`catalog.read`, `catalog.write`, `pricing.read`, `pricing.write`, `inventory.read`, `inventory.write`, `orders.read`, `orders.manage`, `payments.manage`, `shipping.manage`, `shipping.configure`, `customers.read`, `customers.manage`, `staff.manage`, `audit.read`). Cada endpoint administrativo indica el permiso requerido; cuando requiere dos, se indican ambos.

---

## 4. Idempotencia (ADR-0063)

Obligatoria en:

- `POST /v1/orders` y `POST /v1/me/orders` (colocar orden).
- `POST /v1/orders/{publicCode}/payments` y `POST /v1/me/orders/{publicCode}/payments` (iniciar pago).

| Situación | Respuesta |
|---|---|
| Sin `Idempotency-Key` | 400 `idempotency-key-missing` |
| Misma llave y mismo contenido | La respuesta guardada, con el mismo código |
| Misma llave y contenido distinto | 422 `idempotency-key-mismatch` |
| Misma llave con la solicitud original en proceso | 409 `idempotency-request-in-progress` con `Retry-After` |

- Formato: 1 a 255 caracteres; se recomienda UUID.
- Alcance: usuario autenticado o, para invitados, el `cartId` del cuerpo; y el endpoint.
- Se guardan éxitos y errores de negocio; no 5xx, 401 ni 429. Retención de 24 horas.

---

## 5. Listados: paginación, filtros y ordenamiento

### 5.1 Paginación por página (ADR-0036)

- Parámetros: `page` (entero ≥ 1, por defecto 1) y `pageSize` (1 a 100, por defecto 20).
- Respuesta:

```json
{
  "data": [],
  "meta": { "page": 1, "pageSize": 20, "totalItems": 0, "totalPages": 0 }
}
```

- `page` mayor que `totalPages` devuelve `data` vacío (no es error).

### 5.2 Paginación por cursor

Solo en auditoría y movimientos de stock (ADR-0036, ADR-0037).

- Parámetros: `cursor` (opaco, devuelto por la respuesta anterior) y `limit` (1 a 100, por defecto 50).
- Respuesta: `{ "data": [], "meta": { "limit": 50, "nextCursor": "…" | null } }`.
- Un cursor inválido → 400 `validation-error`.

### 5.3 Ordenamiento y filtros

- `sort=campo` o `sort=-campo`; varios campos separados por coma (`sort=-placedAt,grandTotal`). Solo los campos declarados por el endpoint; el servidor agrega el ID como desempate.
- Filtros: parámetros de consulta declarados por el endpoint. Listas de valores separadas por coma (`status=PAID,SHIPPED`). Rangos con sufijos `From`/`To` (fechas) o `min`/`max` (montos, en centavos).
- Parámetro, campo o valor no declarado → 400 `validation-error` (E-01).

---

## 6. Formato de errores

### 6.1 Estructura (RFC 9457, ADR-0035, ADR-0064)

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json
X-Correlation-Id: 0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b
```

```json
{
  "type": "/problems/insufficient-stock",
  "title": "Stock insuficiente",
  "status": 409,
  "detail": "Algunos productos no tienen existencias suficientes para la cantidad solicitada.",
  "instance": "/v1/me/orders",
  "correlationId": "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b",
  "lines": [ { "variantId": "0192…", "canFulfill": false } ]
}
```

- `type`: URI relativa estable; los clientes deciden por `type`, no por el texto.
- `title`: resumen fijo por tipo. `detail`: explicación del caso, sin datos internos ni stack traces.
- `instance`: ruta de la solicitud.
- Extensiones: `correlationId` (siempre); `errors` (validación); `lines` (stock); las demás se indican en el catálogo.

Error de validación:

```json
{
  "type": "/problems/validation-error",
  "title": "Solicitud inválida",
  "status": 400,
  "detail": "Uno o más campos no son válidos.",
  "instance": "/v1/me/addresses",
  "correlationId": "…",
  "errors": [
    { "field": "postalCode", "code": "pattern", "message": "Debe tener 5 dígitos." },
    { "field": "municipalityCode", "code": "not_in_state", "message": "El municipio no pertenece al estado elegido." }
  ]
}
```

`errors[].field` usa notación de ruta para campos anidados (`shippingAddress.phone`, `lines[2].quantity`).

### 6.2 Catálogo de tipos

| `type` (`/problems/…`) | HTTP | E-xx | Cuándo | Extensiones |
|---|---|---|---|---|
| `validation-error` | 400 | E-01, E-11 | Campos, parámetros, cantidades o filtros inválidos | `errors` |
| `password-policy-violation` | 400 | E-21 | Contraseña fuera de 15–64 caracteres o común | `errors` |
| `invalid-or-expired-token` | 400 | E-20 | Enlace de verificación o recuperación usado, vencido o invalidado | — |
| `idempotency-key-missing` | 400 | E-25 | Falta `Idempotency-Key` | — |
| `unauthenticated` | 401 | E-02 | Sin token, token inválido o vencido | — |
| `invalid-credentials` | 401 | E-16 | Login fallido (incluye cuenta suspendida, ADR-0062) | — |
| `invalid-refresh-token` | 401 | E-17, E-19 | Refresh token inválido, vencido, revocado o reutilizado; cuenta suspendida | — |
| `invalid-webhook-signature` | 401 | E-24 | Firma de webhook inválida | — |
| `forbidden` | 403 | E-03 | Falta el permiso o el tipo de cuenta no corresponde | — |
| `email-not-verified` | 403 | E-08 | Cliente sin email verificado coloca una orden | — |
| `staff-cannot-purchase` | 403 | E-09 | Cuenta de staff en carrito o checkout | — |
| `password-change-required` | 403 | E-18 | Staff con cambio de contraseña pendiente | — |
| `manual-payments-disabled` | 403 | E-23 | Pago o reembolso manual con la función deshabilitada | — |
| `not-found` | 404 | E-04 | Recurso inexistente, ajeno o consulta de invitado sin coincidencia | — |
| `version-conflict` | 409 | E-05 | `version` desactualizada | `currentVersion` |
| `total-mismatch` | 409 | E-06 | Total recalculado distinto de `expectedTotal` | `currentTotal` (Money) |
| `insufficient-stock` | 409 | E-07 | No se puede reservar alguna línea | `lines` (`variantId`, `canFulfill`) |
| `variant-not-sellable` | 409 | E-10 | Variante no publicada, descontinuada o sin precio | `variantIds` |
| `invalid-state-transition` | 409 | E-12 | Acción no permitida en el estado actual | `currentStatus` |
| `duplicate-value` | 409 | E-13 | Email, SKU, slug, código o nombre ya usado | `field` |
| `resource-in-use` | 409 | E-14 | Borrado de entidad con referencias | — |
| `price-period-conflict` | 409 | E-15 | Periodo superpuesto o ya iniciado | — |
| `idempotency-request-in-progress` | 409 | E-25 | Solicitud original aún en proceso | — |
| `cart-not-active` | 409 | E-27 | Modificar un carrito CHECKED_OUT o MERGED | `cartStatus` |
| `address-limit-reached` | 409 | E-28 | Más de 10 direcciones (BR-ADR-04) | `limit` |
| `last-superadmin` | 409 | E-29 | Dejar el sistema sin superadministrador (BR-USR-03) | — |
| `restock-not-allowed` | 409 | E-30 | Reintegro que supera lo vendido o con reintegro previo (ADR-0052) | `lines` |
| `active-orders-exist` | 409 | E-31 | Anonimizar con órdenes sin concluir (ADR-0067) | — |
| `field-locked` | 409 | E-32 | Editar SKU, opciones o slug después de la primera publicación (ADR-0068) | `fields` |
| `empty-cart` | 409 | E-33 | Cotizar o colocar orden con carrito vacío (BR-ORD-01) | — |
| `idempotency-key-mismatch` | 422 | E-25 | Llave reutilizada con otro contenido | — |
| `payload-too-large` | 413 | E-22 | Imagen de más de 5 MB | `maxBytes` |
| `unsupported-media-type` | 415 | E-22 | Formato de imagen o `Content-Type` no admitido | — |
| `rate-limit-exceeded` | 429 | E-26 | Límite de frecuencia excedido | — |
| `internal-error` | 500 | — | Error no controlado; solo `correlationId`, sin detalles | — |

E-27 a E-33 son derivados de reglas existentes y se agregan al catálogo de `REQUIREMENTS.md`.

### 6.3 Errores comunes (no se repiten en cada endpoint)

- Todos: 400 `validation-error`, 429 `rate-limit-exceeded`, 500 `internal-error`.
- `/v1/me` y `/v1/admin`: 401 `unauthenticated`, 403 `password-change-required`.
- `/v1/admin`: 403 `forbidden`.
- Rutas con identificador: 404 `not-found`.
- PATCH y acciones sobre recursos versionados: 409 `version-conflict`.

Cada endpoint lista solo sus errores específicos.

---

## 7. Rate limiting (ADR-0065)

| Límite | Endpoints |
|---|---|
| 5 intentos fallidos por email en 15 minutos, y 20 por IP | `POST /v1/auth/login` |
| 5 por IP por hora | `POST /v1/auth/register` |
| 3 por email y 10 por IP por hora | `POST /v1/auth/password-reset/request` |
| 3 por email por hora | `POST /v1/auth/email-verification/resend`, `POST /v1/me/email` |
| 10 por IP en 15 minutos | `POST /v1/orders/lookup`, `POST /v1/orders/reorder` |
| 10 por usuario o carrito en 10 minutos | `POST /v1/orders`, `POST /v1/me/orders` |
| 100 por minuto por IP | Resto de endpoints |

Todos configurables por variables de entorno. Al exceder: 429 con `Retry-After`. Los webhooks quedan fuera del límite general (ADR-0071): los protege la verificación de firma.

---

## 8. Representaciones compartidas

Los esquemas se escriben como ejemplos JSON; en OpenAPI se generan desde los DTOs de Presentation.

### 8.1 `Money`

```json
{ "amount": 129900, "currency": "MXN" }
```

`amount` en centavos (entero). `currency` siempre `MXN` (ADR-0026).

### 8.2 `AddressInput` (solicitudes) y `Address` (respuestas) — ADR-0057

```json
{
  "recipientName": "María López Hernández",
  "phone": "4431234567",
  "street": "Av. Madero Poniente",
  "exteriorNumber": "123",
  "interiorNumber": "4B",
  "neighborhood": "Centro",
  "postalCode": "58000",
  "stateCode": "16",
  "municipalityCode": "16053",
  "city": "Morelia",
  "references": "Entre Galeana e Hidalgo"
}
```

| Campo | Requerido | Validación |
|---|---|---|
| `recipientName` | Sí | 1–120 caracteres |
| `phone` | Sí | Exactamente 10 dígitos |
| `street` | Sí | 1–150 caracteres |
| `exteriorNumber` | Sí | 1–20 caracteres (admite "S/N" y letras) |
| `interiorNumber` | No | 1–20 caracteres |
| `neighborhood` | Sí | 1–120 caracteres |
| `postalCode` | Sí | 5 dígitos (solo formato, BR-ADR-05) |
| `stateCode` | Sí | Clave de estado existente |
| `municipalityCode` | Sí | Municipio activo y perteneciente a `stateCode` (BR-ADR-02) |
| `city` | No | 1–120 caracteres |
| `references` | No | 1–250 caracteres |

Los límites de longitud se fijan en ADR-0071. `Address` agrega `stateName`, `municipalityName` y `country: "MX"`; en la libreta también `id`, `isDefault`, `createdAt` y `updatedAt`.

### 8.3 `Image`

```json
{ "id": "0192…", "url": "https://…/products/0192…/a1b2.webp", "altText": "Vista frontal", "position": 1, "variantId": null }
```

`url` absoluta, construida al responder (ADR-0024).

### 8.4 `ProductSummary` (catálogo público)

```json
{
  "id": "0192…",
  "slug": "camisa-lino-azul",
  "title": "Camisa de lino",
  "brand": { "id": "0192…", "name": "Marca", "slug": "marca" },
  "fromPrice": { "amount": 59900, "currency": "MXN" },
  "compareAtPrice": { "amount": 79900, "currency": "MXN" },
  "available": true,
  "image": { "…": "Image" },
  "publishedAt": "2026-09-01T00:00:00.000Z"
}
```

- `fromPrice`: precio más bajo entre variantes vendibles (BR-PRD-15). `compareAtPrice`: el de esa misma variante, o `null`.
- `available`: alguna variante vendible disponible (ADR-0061). `image`: primera imagen o `null`.

### 8.5 `ProductDetail` (catálogo público)

`ProductSummary` más:

```json
{
  "description": "…",
  "categories": [ { "id": "…", "name": "Camisas", "slug": "camisas" } ],
  "images": [],
  "optionNames": ["talla", "color"],
  "variants": [
    {
      "id": "0192…",
      "sku": "CAM-LIN-AZ-M",
      "options": { "talla": "M", "color": "Azul" },
      "price": { "amount": 59900, "currency": "MXN" },
      "compareAtPrice": null,
      "available": true
    }
  ]
}
```

Solo variantes vendibles (BR-PRD-11). Nunca incluye cantidades en stock (ADR-0061).

### 8.6 `Cart`

```json
{
  "id": "5f0c…",
  "status": "ACTIVE",
  "lines": [
    {
      "variantId": "0192…",
      "quantity": 2,
      "product": { "id": "…", "slug": "camisa-lino-azul", "title": "Camisa de lino" },
      "sku": "CAM-LIN-AZ-M",
      "options": { "talla": "M" },
      "image": null,
      "sellable": true,
      "canFulfill": true,
      "unitPrice": { "amount": 59900, "currency": "MXN" },
      "lineTotal": { "amount": 119800, "currency": "MXN" }
    }
  ],
  "itemCount": 2,
  "subtotal": { "amount": 119800, "currency": "MXN" },
  "lastActivityAt": "…"
}
```

- Precios calculados al leer (BR-CRT-04).
- Una línea con variante no vendible se conserva con `sellable: false`, `unitPrice` y `lineTotal` en `null`, y no suma al subtotal.
- `canFulfill` indica si la cantidad pedida puede surtirse, sin revelar existencias (ADR-0061).
- `id` es `null` en `GET /v1/me/cart` cuando el cliente aún no tiene carrito.

### 8.7 `CheckoutQuote`

```json
{
  "lines": [ { "variantId": "…", "quantity": 2, "sku": "…", "productTitle": "…", "options": {}, "unitPrice": {}, "lineTotal": {}, "taxRateBp": 1600, "taxAmount": {}, "sellable": true, "canFulfill": true } ],
  "subtotal": { "amount": 119800, "currency": "MXN" },
  "taxTotal": { "amount": 16524, "currency": "MXN" },
  "shippingCost": { "amount": 9900, "currency": "MXN" },
  "discountTotal": { "amount": 0, "currency": "MXN" },
  "grandTotal": { "amount": 129700, "currency": "MXN" },
  "freeShippingThreshold": { "amount": 150000, "currency": "MXN" },
  "readyToPlace": true
}
```

- `taxTotal` informativo: el IVA está contenido en el subtotal (ADR-0008, BR-ORD-16).
- `readyToPlace`: todas las líneas vendibles y surtibles.
- `grandTotal.amount` es el valor que el cliente envía como `expectedTotal`.
- IVA del envío y base del umbral: PENDIENTE (P-58); no cambian la forma de la respuesta.

### 8.8 `Order` (vista de cliente)

```json
{
  "publicCode": "K7M4-Q9XA",
  "status": "PENDING_PAYMENT",
  "contactEmail": "cliente@example.com",
  "lines": [ { "lineNumber": 1, "sku": "…", "productName": "…", "variantOptions": {}, "unitPrice": {}, "quantity": 2, "taxRateBp": 1600, "taxAmount": {}, "lineTotal": {} } ],
  "subtotal": {}, "taxTotal": {}, "shippingCost": {}, "discountTotal": {}, "grandTotal": {},
  "shippingAddress": { "…": "Address" },
  "payment": { "provider": "MANUAL", "status": "PENDING" },
  "shipment": { "status": "DISPATCHED", "carrierName": "…", "trackingNumber": "…", "dispatchedAt": "…", "deliveredAt": null },
  "placedAt": "…",
  "paymentDueAt": "…",
  "paidAt": null, "shippedAt": null, "deliveredAt": null, "cancelledAt": null, "expiredAt": null, "refundedAt": null
}
```

- Nunca incluye `orderNumber` interno ni `id` (ADR-0049).
- `payment` y `shipment` son `null` si no existen.
- `paymentDueAt`: vencimiento de la reserva mientras la orden está en PENDING_PAYMENT; `null` en otros estados.

### 8.9 `AdminOrder`

`Order` más `id`, `orderNumber`, `customerId` (o `null` si es invitado), `version`, `anonymizedAt`, `payment` completo (`id`, `amount`, `capturedAmount`, `refundedAmount`, `status`, `refunds[]`), `shipment` completo (`id`, `status`, `version`) y `statusHistory[]` (`fromStatus`, `toStatus`, `actorId`, `reason`, `occurredAt`).

### 8.10 `Account` (`GET /v1/me`)

```json
{
  "id": "0192…",
  "type": "CUSTOMER",
  "email": "cliente@example.com",
  "firstNames": "María",
  "lastNames": "López Hernández",
  "emailVerified": true,
  "mustChangePassword": false,
  "roles": [],
  "permissions": [],
  "createdAt": "…"
}
```

`roles` y `permissions` solo tienen contenido en cuentas de staff, para que un cliente administrativo muestre lo que corresponde.

### 8.11 `AuthResult`

```json
{
  "outcome": "AUTHENTICATED",
  "accessToken": "eyJ…",
  "accessTokenExpiresIn": 900,
  "refreshToken": "rt_…",
  "refreshTokenExpiresIn": 604800,
  "tokenType": "Bearer",
  "mustChangePassword": false
}
```

`outcome` permite agregar desenlaces futuros (por ejemplo, segundo factor) como cambio compatible (ADR-0048).

---

## 9. Endpoints — Identity & Access

### 9.1 Resumen

| Método | Ruta | Acceso | UC |
|---|---|---|---|
| POST | `/v1/auth/register` | Público | UC-IAM-01 |
| POST | `/v1/auth/email-verification/confirm` | Público | UC-IAM-02 |
| POST | `/v1/auth/email-verification/resend` | Público | UC-IAM-03 |
| POST | `/v1/auth/login` | Público | UC-IAM-04 |
| POST | `/v1/auth/refresh` | Público (refresh token) | UC-IAM-05 |
| POST | `/v1/auth/logout` | Cuenta | UC-IAM-06 |
| POST | `/v1/auth/password-reset/request` | Público | UC-IAM-07 |
| POST | `/v1/auth/password-reset/confirm` | Público (token) | UC-IAM-08 |
| GET | `/v1/me` | Cuenta | — |
| PATCH | `/v1/me` | Solo cliente | Rectificación (ADR-0067) |
| POST | `/v1/me/password` | Cuenta | UC-IAM-09 |
| POST | `/v1/me/email` | Solo cliente | UC-IAM-10 |
| GET, POST | `/v1/me/addresses` | Solo cliente | UC-IAM-11 |
| PATCH, DELETE | `/v1/me/addresses/{addressId}` | Solo cliente | UC-IAM-11 |
| GET | `/v1/admin/identity/permissions` | `staff.manage` | UC-IAM-15 |
| GET, POST | `/v1/admin/identity/roles` | `staff.manage` | UC-IAM-15 |
| GET, PATCH, DELETE | `/v1/admin/identity/roles/{roleId}` | `staff.manage` | UC-IAM-15 |
| GET, POST | `/v1/admin/identity/staff` | `staff.manage` | UC-IAM-13 |
| GET | `/v1/admin/identity/staff/{userId}` | `staff.manage` | — |
| PUT | `/v1/admin/identity/staff/{userId}/roles` | `staff.manage` | UC-IAM-14 |
| POST | `/v1/admin/identity/staff/{userId}/suspend` | `staff.manage` | UC-IAM-16 |
| POST | `/v1/admin/identity/staff/{userId}/reactivate` | `staff.manage` | UC-IAM-16 |
| GET | `/v1/admin/identity/customers` | `customers.read` | UC-IAM-17 |
| GET | `/v1/admin/identity/customers/{userId}` | `customers.read` | UC-IAM-17 |
| POST | `/v1/admin/identity/customers/{userId}/suspend` | `customers.manage` | UC-IAM-18 |
| POST | `/v1/admin/identity/customers/{userId}/reactivate` | `customers.manage` | UC-IAM-18 |
| POST | `/v1/admin/identity/customers/{userId}/anonymize` | `customers.manage` | UC-IAM-19 |
| POST | `/v1/admin/identity/guest-anonymizations` | `customers.manage` | UC-IAM-19 |

UC-IAM-12 (solicitudes ARCO), UC-IAM-20 y UC-IAM-21 no tienen API (ADR-0043, ADR-0057, ADR-0067). Las cuentas anonimizadas no se reactivan (ADR-0076).

### 9.2 `POST /v1/auth/register` — Registrar cliente (UC-IAM-01)

- **Autenticación:** ninguna. **Rate limit:** 5 por IP por hora.
- **Request:**

```json
{ "email": "cliente@example.com", "password": "una frase larga y segura", "firstNames": "María", "lastNames": "López Hernández", "privacyNoticeVersion": "2026-09" }
```

- **Validaciones:** `email` con formato válido, máximo 254 caracteres, se normaliza a minúsculas; `password` según ADR-0047; `firstNames` y `lastNames` de 1 a 100 caracteres; `privacyNoticeVersion` de 1 a 50 caracteres (ADR-0067).
- **Response 201:** `Account`. Se envía el correo de verificación (ADR-0046). No inicia sesión: el cliente llama a login.
- **Errores:** 400 `password-policy-violation`; 409 `duplicate-value` con `field: "email"` (el registro sí revela que el email existe, ADR-0062).

### 9.3 `POST /v1/auth/email-verification/confirm` — Verificar email (UC-IAM-02)

- **Autenticación:** ninguna.
- **Request:** `{ "token": "…" }` (el token del enlace; ADR-0056).
- **Response 200:** `{ "emailVerified": true }`.
- **Errores:** 400 `invalid-or-expired-token`.

### 9.4 `POST /v1/auth/email-verification/resend` — Reenviar verificación (UC-IAM-03)

- **Autenticación:** ninguna. **Rate limit:** 3 por email por hora.
- **Request:** `{ "email": "cliente@example.com" }`.
- **Response 202** sin cuerpo, exista o no el email y esté o no verificado (BR-USR-12). Invalida el enlace anterior.

### 9.5 `POST /v1/auth/login` — Iniciar sesión (UC-IAM-04)

- **Autenticación:** ninguna. **Rate limit:** 5 fallidos por email en 15 minutos y 20 por IP.
- **Request:** `{ "email": "…", "password": "…" }`.
- **Response 200:** `AuthResult`. Si `mustChangePassword` es `true` (staff con contraseña temporal), el token solo permite las rutas de la sección 3.2.
- **Errores:** 401 `invalid-credentials` para email inexistente, contraseña incorrecta o cuenta suspendida o anonimizada (ADR-0062).
- **Auditoría:** éxito y fallo (ADR-0037).

### 9.6 `POST /v1/auth/refresh` — Renovar sesión (UC-IAM-05)

- **Autenticación:** ninguna; el refresh token va en el cuerpo.
- **Request:** `{ "refreshToken": "rt_…" }`.
- **Response 200:** `AuthResult` con un par nuevo; el refresh token anterior queda invalidado.
- **Errores:** 401 `invalid-refresh-token` (inválido, vencido, revocado, cuenta suspendida o reutilizado; en este último caso se revoca toda la sesión).

### 9.7 `POST /v1/auth/logout` — Cerrar sesión (UC-IAM-06)

- **Autenticación:** token de acceso. **Request:** `{ "refreshToken": "rt_…" }`.
- **Response 204.** Revoca la sesión del refresh token si pertenece al usuario autenticado; si no pertenece o ya estaba revocado, responde igual (idempotente). El token de acceso vigente expira solo.

### 9.8 `POST /v1/auth/password-reset/request` — Solicitar recuperación (UC-IAM-07)

- **Autenticación:** ninguna. **Rate limit:** 3 por email y 10 por IP por hora.
- **Request:** `{ "email": "…" }`.
- **Response 202** sin cuerpo, exista o no el email. No envía correo a cuentas suspendidas. Invalida enlaces anteriores (ADR-0056).

### 9.9 `POST /v1/auth/password-reset/confirm` — Restablecer contraseña (UC-IAM-08)

- **Autenticación:** ninguna.
- **Request:** `{ "token": "…", "newPassword": "…" }`.
- **Response 204.** Revoca todas las sesiones del usuario y envía aviso por correo.
- **Errores:** 400 `invalid-or-expired-token`; 400 `password-policy-violation`.

### 9.10 `GET /v1/me` — Consultar la cuenta

- **Autenticación:** token de acceso (cliente o staff).
- **Response 200:** `Account`.

### 9.11 `PATCH /v1/me` — Rectificar datos del cliente

- **Autenticación:** token de cliente.
- **Request:** `{ "firstNames": "…", "lastNames": "…" }` (ambos opcionales, 1–100 caracteres). El email se cambia con `POST /v1/me/email`.
- **Response 200:** `Account`. Se audita sin valores personales (ADR-0067).

### 9.12 `POST /v1/me/password` — Cambiar contraseña (UC-IAM-09)

- **Autenticación:** token de acceso (cliente o staff; permitido con `mustChangePassword`).
- **Request:** `{ "currentPassword": "…", "newPassword": "…" }`. Para el cambio obligatorio del staff, `currentPassword` es la contraseña temporal (ADR-0056).
- **Validaciones:** `newPassword` según ADR-0047 y distinta de la actual.
- **Response 204.** Quita `mustChangePassword`. Revoca todas las demás sesiones del usuario y conserva la actual; envía un correo avisando del cambio (ADR-0072).
- **Errores:** 401 `invalid-credentials` si `currentPassword` no coincide; 400 `password-policy-violation`.

### 9.13 `POST /v1/me/email` — Cambiar email (UC-IAM-10)

- **Autenticación:** token de cliente. **Rate limit:** 3 por hora.
- **Request:** `{ "newEmail": "…", "currentPassword": "…" }`.
- **Response 200:** `Account` con `emailVerified: false`. Se envía verificación al nuevo email; el cliente no puede comprar hasta verificarlo (BR-USR-11).
- **Errores:** 401 `invalid-credentials`; 409 `duplicate-value` (`field: "email"`).

### 9.14 Direcciones (UC-IAM-11)

**`GET /v1/me/addresses`** — token de cliente. Response 200: `{ "data": [Address] }` (sin paginación: máximo 10). Orden: predeterminada primero, después `createdAt` descendente.

**`POST /v1/me/addresses`** — Request: `AddressInput` más `isDefault` (opcional, boolean). La primera dirección es predeterminada automáticamente. Response 201: `Address`. Errores: 409 `address-limit-reached`.

**`PATCH /v1/me/addresses/{addressId}`** — Request: campos de `AddressInput` e `isDefault`. Marcar `isDefault: true` desmarca la anterior. Si se cambia `stateCode`, `municipalityCode` es obligatorio. Response 200: `Address`.

**`DELETE /v1/me/addresses/{addressId}`** — Response 204. Si era la predeterminada, ninguna queda como predeterminada (ADR-0071).

### 9.15 `GET /v1/admin/identity/permissions` — Catálogo de permisos

- **Permiso:** `staff.manage`. **Response 200:** `{ "data": [ { "code": "catalog.write", "description": "…" } ] }` (catálogo en código, ADR-0017).

### 9.16 Roles (UC-IAM-15)

Representación `Role`: `{ "id", "name", "description", "isSuperadmin", "permissions": ["…"], "userCount", "version", "createdAt", "updatedAt" }`.

| Endpoint | Detalle |
|---|---|
| `GET /v1/admin/identity/roles` | Paginado. Filtros: `q` (nombre). Orden: `name` (defecto), `createdAt` |
| `POST /v1/admin/identity/roles` | Request `{ "name", "description", "permissions": [] }`. `name` 1–50 caracteres, único; permisos del catálogo (BR-USR-04). 201 `Role`. Errores: 409 `duplicate-value` |
| `GET /v1/admin/identity/roles/{roleId}` | 200 `Role` |
| `PATCH /v1/admin/identity/roles/{roleId}` | Request `{ "name", "description", "permissions", "version" }` (`permissions` reemplaza el conjunto). El rol superadministrador no cambia sus permisos (siempre todos). 200 `Role`. Errores: 409 `duplicate-value` |
| `DELETE /v1/admin/identity/roles/{roleId}` | 204. Errores: 409 `resource-in-use` (tiene usuarios, BR-USR-07); 409 `last-superadmin` si es el rol superadministrador |

### 9.17 Staff (UC-IAM-13, 14, 16)

Representación `StaffUser`: `{ "id", "email", "firstNames", "lastNames", "status", "mustChangePassword", "roles": [{ "id", "name" }], "lastLoginAt", "version", "createdAt" }`.

| Endpoint | Detalle |
|---|---|
| `GET /v1/admin/identity/staff` | Paginado. Filtros: `q` (email o nombre), `status`, `roleId`. Orden: `createdAt` (defecto `-createdAt`), `email` |
| `POST /v1/admin/identity/staff` | Request `{ "email", "firstNames", "lastNames", "roleIds": [] }`. Genera contraseña temporal de al menos 15 caracteres (BR-USR-13). 201 `{ "user": StaffUser, "temporaryPassword": "…" }`; la contraseña temporal se muestra solo en esta respuesta, con `Cache-Control: no-store`. Errores: 409 `duplicate-value` |
| `GET /v1/admin/identity/staff/{userId}` | 200 `StaffUser` |
| `PUT /v1/admin/identity/staff/{userId}/roles` | Request `{ "roleIds": [], "version" }` (reemplaza el conjunto; mínimo uno). 200 `StaffUser`. Errores: 409 `last-superadmin` |
| `POST /v1/admin/identity/staff/{userId}/suspend` | Request `{ "reason", "version" }`. Revoca sus sesiones. 200 `StaffUser`. Errores: 409 `last-superadmin`; 409 `invalid-state-transition` si no está ACTIVE; un staff no puede suspenderse a sí mismo (409 `invalid-state-transition`) |
| `POST /v1/admin/identity/staff/{userId}/reactivate` | Request `{ "reason", "version" }`. Desde SUSPENDED. Genera una contraseña temporal nueva (BR-USR-13) y marca `mustChangePassword`; conserva los roles (ADR-0076). 200 `{ "user": StaffUser, "temporaryPassword": "…" }`; la contraseña temporal se muestra solo en esta respuesta, con `Cache-Control: no-store`. Errores: 409 `invalid-state-transition` si no está SUSPENDED |

La contraseña temporal se entrega en la respuesta (ADR-0071): no hay invitación por correo (ADR-0043).

### 9.18 Clientes (UC-IAM-17, 18, 19)

Representación `AdminCustomer`: `{ "id", "email", "firstNames", "lastNames", "status", "emailVerified", "addresses": [Address], "orderCount", "createdAt", "lastLoginAt", "anonymizedAt", "version" }` (`addresses` y `orderCount` solo en el detalle).

| Endpoint | Detalle |
|---|---|
| `GET /v1/admin/identity/customers` | `customers.read`. Paginado. Filtros: `q` (email, nombres o apellidos), `status`, `emailVerified`, `createdFrom`, `createdTo`. Orden: `createdAt` (defecto `-createdAt`), `email`, `lastLoginAt` |
| `GET /v1/admin/identity/customers/{userId}` | `customers.read`. 200 `AdminCustomer` |
| `POST /v1/admin/identity/customers/{userId}/suspend` | `customers.manage`. Request `{ "reason", "version" }`. Revoca sesiones. 200. Errores: 409 `invalid-state-transition` |
| `POST /v1/admin/identity/customers/{userId}/reactivate` | `customers.manage`. Request `{ "reason", "version" }`. Desde SUSPENDED; conserva contraseña y verificación de email (ADR-0076). 200 `AdminCustomer`. Errores: 409 `invalid-state-transition` (no está SUSPENDED, incluido un cliente anonimizado) |
| `POST /v1/admin/identity/customers/{userId}/anonymize` | `customers.manage`. Request `{ "reason", "version" }` (`reason`: referencia de la solicitud ARCO, 1–250 caracteres). 200 `AdminCustomer` anonimizado. Irreversible. Errores: 409 `active-orders-exist`; 409 `invalid-state-transition` si ya está anonimizado |
| `POST /v1/admin/identity/guest-anonymizations` | `customers.manage`. Request `{ "contactEmail", "publicCode", "reason" }`. Anonimiza todas las órdenes de invitado con ese email (ADR-0067). 200 `{ "anonymizedOrderCount": 3 }`. Errores: 404 `not-found` si el par email–código no coincide; 409 `active-orders-exist` |

---

## 10. Endpoints — Catálogo geográfico (UC-IAM-22)

| Endpoint | Detalle |
|---|---|
| `GET /v1/geo/states` | Público. 200 `{ "data": [ { "code": "16", "name": "Michoacán de Ocampo" } ] }`. Sin paginación (32 registros). Orden por nombre |
| `GET /v1/geo/states/{stateCode}/municipalities` | Público. 200 `{ "data": [ { "code": "16053", "name": "Morelia" } ] }`. Solo municipios activos. Sin paginación. Orden por nombre. 404 si el estado no existe |

Datos de referencia; se pueden cachear con el TTL de ADR-0028 (ADR-0071).

---

## 11. Endpoints — Catalog

### 11.1 Resumen

| Método | Ruta | Acceso | UC |
|---|---|---|---|
| GET | `/v1/catalog/products` | Público | UC-CAT-01 |
| GET | `/v1/catalog/products/{slug}` | Público | UC-CAT-02 |
| GET | `/v1/catalog/categories` | Público | UC-CAT-03 |
| GET | `/v1/catalog/brands` | Público | Filtro de marca (ADR-0060) |
| GET, POST | `/v1/admin/catalog/products` | `catalog.read` / `catalog.write` | UC-CAT-14, UC-CAT-04 |
| GET, PATCH | `/v1/admin/catalog/products/{productId}` | `catalog.read` / `catalog.write` | UC-CAT-05 |
| POST | `/v1/admin/catalog/products/{productId}/publish` | `catalog.write` | UC-CAT-09 |
| POST | `/v1/admin/catalog/products/{productId}/archive` | `catalog.write` | UC-CAT-10 |
| POST | `/v1/admin/catalog/products/{productId}/reactivate` | `catalog.write` | UC-CAT-10 |
| POST | `/v1/admin/catalog/products/{productId}/variants` | `catalog.write` | UC-CAT-06 |
| PATCH | `/v1/admin/catalog/products/{productId}/variants/{variantId}` | `catalog.write` | UC-CAT-07 |
| POST | `/v1/admin/catalog/products/{productId}/variants/{variantId}/discontinue` | `catalog.write` | UC-CAT-08 |
| POST | `/v1/admin/catalog/products/{productId}/variants/{variantId}/reactivate` | `catalog.write` | UC-CAT-08 |
| POST | `/v1/admin/catalog/products/{productId}/images` | `catalog.write` | UC-CAT-11 |
| PATCH, DELETE | `/v1/admin/catalog/products/{productId}/images/{imageId}` | `catalog.write` | UC-CAT-11 |
| PUT | `/v1/admin/catalog/products/{productId}/images/order` | `catalog.write` | UC-CAT-11 |
| GET, POST | `/v1/admin/catalog/categories` | `catalog.read` / `catalog.write` | UC-CAT-12 |
| PATCH, DELETE | `/v1/admin/catalog/categories/{categoryId}` | `catalog.write` | UC-CAT-12 |
| POST | `/v1/admin/catalog/categories/{categoryId}/deactivate` | `catalog.write` | UC-CAT-12 |
| POST | `/v1/admin/catalog/categories/{categoryId}/reactivate` | `catalog.write` | UC-CAT-12 |
| GET, POST | `/v1/admin/catalog/brands` | `catalog.read` / `catalog.write` | UC-CAT-13 |
| PATCH, DELETE | `/v1/admin/catalog/brands/{brandId}` | `catalog.write` | UC-CAT-13 |
| POST | `/v1/admin/catalog/brands/{brandId}/deactivate` | `catalog.write` | UC-CAT-13 |
| POST | `/v1/admin/catalog/brands/{brandId}/reactivate` | `catalog.write` | UC-CAT-13 |

Las reactivaciones siguen ADR-0076. No emiten eventos: la tienda las refleja al vencer el TTL de la cache (ADR-0028).

### 11.2 `GET /v1/catalog/products` — Listar y buscar (UC-CAT-01, ADR-0060)

- **Autenticación:** ninguna.
- **Parámetros:**

| Parámetro | Tipo | Validación |
|---|---|---|
| `q` | texto | 2–100 caracteres; búsqueda en español, sin acentos y por prefijo sobre título, marca y categorías |
| `category` | slug | Categoría activa; incluye subcategorías |
| `brand` | slugs separados por coma | Hasta 20 |
| `minPrice`, `maxPrice` | enteros (centavos, IVA incluido) | ≥ 0; `minPrice ≤ maxPrice` |
| `available` | boolean | `true` = solo disponibles |
| `sort` | `relevance`, `-publishedAt`, `price`, `-price`, `title`, `-title` | `relevance` solo con `q`. Defecto: `relevance` con `q`, `-publishedAt` sin `q` |
| `page`, `pageSize` | — | Sección 5.1 |

- **Response 200:** página de `ProductSummary`. Solo productos publicados con al menos una variante vendible (BR-PRD-06).
- **Cache:** solo sin `q` (ADR-0060), TTL de 120 s.

### 11.3 `GET /v1/catalog/products/{slug}` — Detalle (UC-CAT-02)

- **Response 200:** `ProductDetail`. 404 si no existe, no está publicado o no tiene variantes vendibles. Cache con TTL de 120 s.

### 11.4 `GET /v1/catalog/categories` — Árbol de categorías (UC-CAT-03)

- **Response 200:** `{ "data": [ { "id", "name", "slug", "position", "children": [ … ] } ] }`. Solo categorías activas, ordenadas por `position` y nombre. Sin paginación. Cache con TTL de 120 s.

### 11.5 `GET /v1/catalog/brands` — Marcas

- **Response 200:** `{ "data": [ { "id", "name", "slug" } ] }`. Marcas activas con al menos un producto visible. Sin paginación. Orden por nombre.

### 11.6 Productos administrativos

Representación `AdminProduct`:

```json
{
  "id": "…", "title": "…", "slug": "…", "description": "…",
  "brand": { "id": "…", "name": "…" },
  "categories": [ { "id": "…", "name": "…" } ],
  "status": "PUBLISHED",
  "storeVisibility": "VISIBLE",
  "variants": [ { "id": "…", "sku": "…", "options": {}, "status": "ACTIVE", "weightGrams": 350, "lengthCm": 30.0, "widthCm": 20.0, "heightCm": 3.0, "editableIdentity": false } ],
  "images": [],
  "publishedAt": "…", "firstPublishedAt": "…", "archivedAt": null,
  "version": 7, "createdAt": "…", "updatedAt": "…"
}
```

- `storeVisibility` (ADR-0016, UC-CAT-14): `VISIBLE`, `HIDDEN_NO_PRICE` (publicado sin variantes con precio vigente), `NOT_PUBLISHED`. Se calcula por página con la fachada de Pricing (ADR-0005); no se ofrece como filtro, porque filtrar por él requeriría extender la excepción de ADR-0060.
- `editableIdentity`: `true` mientras el producto no tiene `firstPublishedAt` (ADR-0068).

| Endpoint | Detalle |
|---|---|
| `GET /v1/admin/catalog/products` | `catalog.read`. Paginado. Filtros: `q` (título o SKU), `status`, `brandId`, `categoryId`. Orden: `updatedAt` (defecto `-updatedAt`), `title`, `createdAt`, `publishedAt`. Devuelve `AdminProduct` sin `description` |
| `POST /v1/admin/catalog/products` | `catalog.write`. Request `{ "title", "slug", "description", "brandId", "categoryIds": [] }`. `title` 1–200; `slug` opcional (se genera del título), minúsculas, dígitos y guiones, 1–200; `description` hasta 10,000; `brandId` y `categoryIds` activos. Crea en DRAFT. 201 `AdminProduct`. Errores: 409 `duplicate-value` (`slug`) |
| `GET /v1/admin/catalog/products/{productId}` | `catalog.read`. 200 `AdminProduct` |
| `PATCH /v1/admin/catalog/products/{productId}` | `catalog.write`. Request: `title`, `slug`, `description`, `brandId`, `categoryIds`, `version`. `slug` editable solo sin `firstPublishedAt`. 200. Errores: 409 `field-locked`; 409 `duplicate-value`; 409 `invalid-state-transition` si está ARCHIVED |
| `POST …/{productId}/publish` | `catalog.write`. Request `{ "version" }`. Requiere al menos una variante activa (BR-PRD-04); no exige precio ni imagen (BR-PRD-05). Fija `firstPublishedAt` la primera vez. Invalida cache (ADR-0028). 200. Errores: 409 `invalid-state-transition` (ya publicado, archivado —se reactiva primero a DRAFT— o sin variante activa, con `detail` que lo explica) |
| `POST …/{productId}/archive` | `catalog.write`. Request `{ "version" }`. Desde DRAFT o PUBLISHED. Invalida cache. 200. Errores: 409 `invalid-state-transition` |
| `POST …/{productId}/reactivate` | `catalog.write`. Request `{ "version" }`. De ARCHIVED a DRAFT; conserva slug y `firstPublishedAt` (ADR-0076). 200 `AdminProduct`. Errores: 409 `invalid-state-transition` |

La generación automática del slug y su bloqueo tras la primera publicación se fijan en ADR-0071, por analogía con ADR-0068.

### 11.7 Variantes (UC-CAT-06 a 08)

| Endpoint | Detalle |
|---|---|
| `POST …/products/{productId}/variants` | `catalog.write`. Request `{ "sku", "options": {}, "weightGrams", "lengthCm", "widthCm", "heightCm", "version" }` (`version` del producto). `sku` 1–64 caracteres, letras, dígitos, `-`, `_` y `.`, se normaliza a mayúsculas, único y nunca reutilizado (BR-PRD-09); `options`: hasta 3 atributos, nombres 1–30 y valores 1–50 caracteres; mismas claves que las demás variantes del producto; combinación única (BR-PRD-02). Peso en gramos (entero > 0) y dimensiones en cm (> 0, un decimal), opcionales (ADR-0058). No se agregan dimensiones de opciones a un producto con `firstPublishedAt` (ADR-0068). 201 `AdminProduct` con la variante. Errores: 409 `duplicate-value` (`sku` u `options`); 409 `field-locked` |
| `PATCH …/variants/{variantId}` | `catalog.write`. Request: `sku`, `options`, `weightGrams`, `lengthCm`, `widthCm`, `heightCm`, `version` (del producto). `sku` y `options` solo si el producto no tiene `firstPublishedAt`; al corregir el SKU, el anterior se libera (ADR-0068). 200 `AdminProduct`. Errores: 409 `field-locked`; 409 `duplicate-value` |
| `POST …/variants/{variantId}/discontinue` | `catalog.write`. Request `{ "version" }`. Invalida cache. 200 `AdminProduct`. Errores: 409 `invalid-state-transition` |
| `POST …/variants/{variantId}/reactivate` | `catalog.write`. Request `{ "version" }` (del producto). De DISCONTINUED a ACTIVE; SKU y opciones no cambian (ADR-0076). 200 `AdminProduct`. Errores: 409 `invalid-state-transition`; 409 `duplicate-value` (`options`) si otra variante activa tiene la misma combinación |

La cantidad máxima de atributos y las longitudes se fijan en ADR-0071.

### 11.8 Imágenes (UC-CAT-11, ADR-0024)

| Endpoint | Detalle |
|---|---|
| `POST …/products/{productId}/images` | `catalog.write`. `multipart/form-data` con `file` (obligatorio) y campos `altText` (0–200) y `variantId` (opcional, variante del mismo producto). Tipo validado por contenido: JPEG, PNG o WebP; máximo 5 MB, rechazado antes de leer el archivo completo. Se agrega al final. 201 `Image`. Errores: 413 `payload-too-large`; 415 `unsupported-media-type` |
| `PATCH …/images/{imageId}` | `catalog.write`. Request `{ "altText", "variantId" }`. 200 `Image` |
| `PUT …/images/order` | `catalog.write`. Request `{ "imageIds": [] }` con todas las imágenes del producto en el nuevo orden. 200 `{ "data": [Image] }`. Errores: 400 si falta o sobra alguna |
| `DELETE …/images/{imageId}` | `catalog.write`. Borra registro y archivo (ADR-0038). 204 |

Los cambios de imágenes no exigen `version` del producto (ADR-0071): no alteran reglas del aggregate más allá del orden.

### 11.9 Categorías y marcas (UC-CAT-12, 13)

Representaciones: `AdminCategory { id, parentId, name, slug, status, position, productCount, childCount, createdAt, updatedAt }`; `AdminBrand { id, name, slug, status, productCount, createdAt, updatedAt }`.

| Endpoint | Detalle |
|---|---|
| `GET /v1/admin/catalog/categories` | `catalog.read`. Árbol completo con inactivas: `{ "data": [ … "children" ] }`. Filtro `status` |
| `POST /v1/admin/catalog/categories` | `catalog.write`. Request `{ "name", "slug", "parentId", "position" }`. `name` 1–100; `slug` opcional y único; `parentId` activa. 201. Errores: 409 `duplicate-value` |
| `PATCH /v1/admin/catalog/categories/{categoryId}` | `catalog.write`. Request `{ "name", "slug", "parentId", "position" }`. Mover no puede crear ciclos (BR-PRD-03) → 409 `invalid-state-transition` con `detail`. 200 |
| `POST …/categories/{categoryId}/deactivate` | `catalog.write`. 200 |
| `POST …/categories/{categoryId}/reactivate` | `catalog.write`. Solo si su padre está activa o es raíz; no reactiva subcategorías (ADR-0076). 200. Errores: 409 `invalid-state-transition` (ya activa o padre inactiva, con `detail`) |
| `DELETE /v1/admin/catalog/categories/{categoryId}` | `catalog.write`. 204. Errores: 409 `resource-in-use` (productos o subcategorías, BR-PRD-10) |
| `GET /v1/admin/catalog/brands` | `catalog.read`. Paginado. Filtros `q`, `status`. Orden `name` |
| `POST /v1/admin/catalog/brands` | `catalog.write`. Request `{ "name", "slug" }`. 201. Errores: 409 `duplicate-value` |
| `PATCH /v1/admin/catalog/brands/{brandId}` | `catalog.write`. Request `{ "name", "slug" }`. 200 |
| `POST …/brands/{brandId}/deactivate` | `catalog.write`. 200 |
| `POST …/brands/{brandId}/reactivate` | `catalog.write`. 200. Errores: 409 `invalid-state-transition` si ya está activa |
| `DELETE /v1/admin/catalog/brands/{brandId}` | `catalog.write`. 204. Errores: 409 `resource-in-use` |

Categorías y marcas no tienen columna `version` en el modelo; se actualizan sin concurrencia optimista (último en escribir gana). Su slug se puede cambiar: el anterior deja de funcionar (404) y queda libre, con el riesgo aceptado de romper enlaces públicos anteriores (ADR-0072).

---

## 12. Endpoints — Pricing

| Método | Ruta | Permiso | UC |
|---|---|---|---|
| GET | `/v1/admin/pricing/price-lists` | `pricing.read` | UC-PRC-01 |
| GET | `/v1/admin/pricing/price-lists/{priceListId}/variants/{variantId}/periods` | `pricing.read` | UC-PRC-01 |
| POST | `/v1/admin/pricing/price-lists/{priceListId}/variants/{variantId}/periods` | `pricing.write` | UC-PRC-02, 03 |
| DELETE | `/v1/admin/pricing/price-lists/{priceListId}/variants/{variantId}/periods/{periodId}` | `pricing.write` | UC-PRC-04 |
| POST | `/v1/admin/pricing/price-lists/{priceListId}/imports` | `pricing.write` | UC-PRC-05 |

En el MVP existe solo la lista predeterminada (ADR-0039); no hay endpoints para crear o editar listas.

**`GET …/price-lists`** — 200 `{ "data": [ { "id", "code", "name", "currency", "priority", "isDefault", "taxesIncluded", "status" } ] }`.

**`GET …/variants/{variantId}/periods`** — 200 `{ "data": [PricePeriod], "current": PricePeriod | null }`, con `PricePeriod { id, amount: Money, compareAtAmount: Money | null, effectiveFrom, effectiveTo, state: "PAST" | "CURRENT" | "SCHEDULED", createdBy, createdAt }`. Orden `-effectiveFrom`. Sin paginación. Filtro `state`.

**`POST …/variants/{variantId}/periods`** — Establece o programa un precio.

- Request: `{ "amount": 59900, "compareAtAmount": 79900, "effectiveFrom": "2026-10-01T06:00:00.000Z" }`.
- `amount` entero ≥ 0 en centavos; `compareAtAmount` opcional y mayor que `amount`; `effectiveFrom` opcional: ausente o no posterior al momento actual = precio inmediato (cierra el periodo vigente, UC-PRC-02); futuro = programado (UC-PRC-03). `effectiveTo` no se envía: un periodo termina cuando empieza el siguiente.
- La variante debe existir en Catalog (fachada).
- Response 201: `PricePeriod`.
- Errores: 409 `price-period-conflict` (superposición con un periodo programado, BR-PRC-01).

**`DELETE …/periods/{periodId}`** — Cancela un precio programado. 204. Errores: 409 `price-period-conflict` si ya inició (BR-PRC-04).

**`POST …/imports`** — Carga masiva. Formato del archivo, validación parcial o total y respuesta: PENDIENTE (T-145).

---

## 13. Endpoints — Inventory

| Método | Ruta | Permiso | UC |
|---|---|---|---|
| GET, POST | `/v1/admin/inventory/warehouses` | `inventory.read` / `inventory.write` | UC-INV-01 |
| PATCH | `/v1/admin/inventory/warehouses/{warehouseId}` | `inventory.write` | UC-INV-01 |
| POST | `/v1/admin/inventory/warehouses/{warehouseId}/deactivate` | `inventory.write` | UC-INV-01 |
| GET | `/v1/admin/inventory/stock-items` | `inventory.read` | UC-INV-04 |
| GET | `/v1/admin/inventory/stock-items/{stockItemId}/movements` | `inventory.read` | UC-INV-04 |
| POST | `/v1/admin/inventory/receipts` | `inventory.write` | UC-INV-02 |
| POST | `/v1/admin/inventory/adjustments` | `inventory.write` | UC-INV-03 |
| POST | `/v1/admin/inventory/restocks` | `inventory.write` | UC-INV-09 |

**Almacenes.** `Warehouse { id, code, name, address: Address | null, status, createdAt, updatedAt }`. POST `{ "code", "name", "address" }` (`code` 1–20, único); PATCH `{ "name", "address" }`. Desactivar el único almacén activo → 409 `invalid-state-transition` (BR-INV-08). Errores de creación: 409 `duplicate-value`.

**`GET …/stock-items`** — Paginado. `StockItem { id, variantId, sku, productTitle, warehouseId, onHand, reserved, available, updatedAt }` (`available = onHand − reserved`). Filtros: `variantId`, `sku`, `warehouseId`, `q` (SKU o título), `availableMax` (entero, para detectar existencias bajas). Orden: `sku` (defecto), `available`, `updatedAt`.

**`GET …/stock-items/{stockItemId}/movements`** — Paginación por cursor. `StockMovement { id, type, quantity, onHandAfter, reasonCode, note, orderId, orderLineId, actorId, createdAt }`. Filtros: `type`, `from`, `to`. Orden fijo: más reciente primero.

**`POST …/receipts`** — Entrada de mercancía.

- Request: `{ "variantId", "warehouseId", "quantity": 25, "note": "Remisión 1234" }`.
- `quantity` entero de 1 a 100,000 (tope de ADR-0071); `note` 0–500. Crea el stock item si no existe.
- 201 `{ "stockItem": StockItem, "movement": StockMovement }`.

**`POST …/adjustments`** — Ajuste (ADR-0069).

- Request: `{ "variantId", "warehouseId", "quantity": -2, "reasonCode": "DAMAGED", "note": "…" }`.
- `quantity` entero distinto de 0 con signo; `reasonCode` del catálogo de ajustes; DAMAGED, LOSS_OR_THEFT e INTERNAL_USE solo con cantidad negativa; `note` obligatoria con OTHER.
- 201 `{ "stockItem", "movement" }`.
- Errores: 409 `insufficient-stock` si dejaría `onHand` por debajo de `reserved` o de cero (BR-INV-01).

**`POST …/restocks`** — Reintegro de una orden (ADR-0052, ADR-0053).

- Request: `{ "orderId", "reasonCode": "ORDER_CANCELLED" | "SHIPMENT_RETURNED", "lines": [ { "orderLineId", "quantity" } ], "note" }`.
- La orden debe estar cancelada o reembolsada con stock confirmado, o tener el envío en RETURNED, según el motivo. La suma por línea no supera lo vendido.
- 201 `{ "movements": [StockMovement] }`.
- Errores: 409 `restock-not-allowed` (con `lines`); 409 `invalid-state-transition` si la orden no admite reintegro.

UC-INV-05 a 08 no tienen API: los ejecutan el checkout, los eventos y los jobs.

---

## 14. Endpoints — Shopping

### 14.1 Resumen

| Método | Ruta | Acceso | UC |
|---|---|---|---|
| POST | `/v1/carts` | Público | UC-CRT-01 |
| GET | `/v1/carts/{cartId}` | Público (el `cartId` es la credencial) | UC-CRT-05 |
| POST | `/v1/carts/{cartId}/lines` | Público | UC-CRT-02 |
| PATCH, DELETE | `/v1/carts/{cartId}/lines/{variantId}` | Público | UC-CRT-03, 04 |
| GET | `/v1/me/cart` | Solo cliente | UC-CRT-05 |
| POST | `/v1/me/cart/lines` | Solo cliente | UC-CRT-01, 02 |
| PATCH, DELETE | `/v1/me/cart/lines/{variantId}` | Solo cliente | UC-CRT-03, 04 |
| POST | `/v1/me/cart/merge` | Solo cliente | UC-CRT-06 |

Las rutas `/v1/carts/{cartId}` solo operan sobre carritos de invitado (sin dueño). Un `cartId` de un carrito con dueño responde 404 (ADR-0071), para que conocer el identificador no dé acceso al carrito de una cuenta.

### 14.2 Operaciones

| Endpoint | Detalle |
|---|---|
| `POST /v1/carts` | Sin cuerpo. 201 `Cart` vacío con `id` UUIDv4 (ADR-0059) y `Location: /v1/carts/{id}` |
| `GET /v1/carts/{cartId}` y `GET /v1/me/cart` | 200 `Cart`. Un carrito CHECKED_OUT o MERGED se devuelve con su `status` (el cliente sabe que debe usar otro). `/v1/me/cart` devuelve `id: null` y `lines: []` si no hay carrito activo |
| `POST …/lines` | Request `{ "variantId", "quantity": 1 }`. Si la variante ya está, suma. La cantidad resultante debe quedar entre 1 y 30 → si no, 400 `validation-error`. En `/v1/me/cart` crea el carrito activo si no existe. 200 `Cart` (201 si se creó el carrito). Errores: 409 `variant-not-sellable`; 409 `cart-not-active` |
| `PATCH …/lines/{variantId}` | Request `{ "quantity" }` (1–30). 200 `Cart`. Errores: 404 si la línea no existe; 409 `cart-not-active` |
| `DELETE …/lines/{variantId}` | 200 `Cart` (devuelve el carrito, no 204, para ahorrar una lectura; ADR-0071). Errores: 409 `cart-not-active` |
| `POST /v1/me/cart/merge` | Request `{ "guestCartId" }`. Fusiona sumando con tope de 30 sin aviso; si el cliente no tiene carrito, el de invitado pasa a su cuenta; idempotente (ADR-0059). 200 `Cart` resultante. Errores: 404 si el carrito no existe o tiene dueño; 409 `cart-not-active` si ya se fusionó en otra cuenta o se usó en una orden |

Una cuenta de staff en `/v1/me/cart` → 403 `staff-cannot-purchase` (E-09). Las variantes no vendibles se conservan con `sellable: false` (ADR-0059); no se pueden agregar nuevas.

### 14.3 Recompra de órdenes canceladas (UC-CRT-09, ADR-0055)

| Endpoint | Acceso | Detalle |
|---|---|---|
| `POST /v1/me/orders/{publicCode}/reorder` | Solo cliente | Copia las líneas a su carrito activo (lo crea si no existe). 200 `{ "cart": Cart, "skippedVariantIds": [] }` |
| `POST /v1/orders/reorder` | Público | Request `{ "contactEmail", "publicCode", "cartId" }` (`cartId` opcional: carrito de invitado activo destino; si falta, se crea uno). 200 `{ "cart", "skippedVariantIds" }`. Rate limit de 10 por IP en 15 minutos |
| `POST /v1/admin/orders/{orderId}/reorder` | `orders.manage` | Cliente registrado: a su carrito activo. Invitado: se reactiva el carrito original de la orden (ADR-0054). 200 `{ "cartId", "skippedVariantIds" }`. Auditado |

Reglas comunes: solo órdenes CANCELLED o REFUNDED (409 `invalid-state-transition` en otro caso); suma con tope de 30; `skippedVariantIds` lista variantes no vendibles omitidas; la orden no cambia. Para invitados, 404 genérico si el par email–código no coincide.

---

## 15. Endpoints — Checkout y Ordering

### 15.1 Resumen

| Método | Ruta | Acceso | UC |
|---|---|---|---|
| POST | `/v1/checkout/quote` | Público | UC-ORD-01 |
| POST | `/v1/me/checkout/quote` | Solo cliente | UC-ORD-01 |
| POST | `/v1/orders` | Público + `Idempotency-Key` | UC-ORD-02 |
| POST | `/v1/me/orders` | Solo cliente + `Idempotency-Key` | UC-ORD-02 |
| GET | `/v1/me/orders` | Solo cliente | UC-ORD-03 |
| GET | `/v1/me/orders/{publicCode}` | Solo cliente | UC-ORD-03 |
| POST | `/v1/orders/lookup` | Público | UC-ORD-04 |
| GET | `/v1/admin/orders` | `orders.read` | UC-ORD-06 |
| GET | `/v1/admin/orders/{orderId}` | `orders.read` | UC-ORD-06 |
| POST | `/v1/admin/orders/{orderId}/cancel` | `orders.manage` (+ `inventory.write` con reintegro) | UC-ORD-07 |
| POST | `/v1/admin/orders/{orderId}/retry-fulfillment` | `orders.manage` | UC-ORD-08 |

Las rutas de Orders viven en `/v1/admin/orders` (sin segmento de contexto adicional, porque "orders" ya lo es).

### 15.2 Cotizar (UC-ORD-01)

- **`POST /v1/checkout/quote`** — Request `{ "cartId" }` (carrito de invitado activo).
- **`POST /v1/me/checkout/quote`** — Sin cuerpo; usa el carrito activo del cliente.
- Sin efectos secundarios y sin cache. Response 200: `CheckoutQuote`.
- Errores: 404 (carrito inexistente o con dueño); 409 `cart-not-active`; 409 `empty-cart`; 403 `staff-cannot-purchase`.

Las líneas no vendibles o no surtibles no provocan error: se marcan en la cotización y `readyToPlace` queda en `false`.

### 15.3 Colocar orden (UC-ORD-02, ADR-0019)

**`POST /v1/orders`** (invitado)

```http
POST /v1/orders
Idempotency-Key: 5b1e9c2a-7d7f-4f55-9c6e-2f0e8a1d3b44
```

```json
{
  "cartId": "5f0c…",
  "contactEmail": "cliente@example.com",
  "shippingAddress": { "…": "AddressInput" },
  "expectedTotal": 129700,
  "privacyNoticeVersion": "2026-09"
}
```

**`POST /v1/me/orders`** (cliente registrado)

```json
{ "addressId": "0192…", "expectedTotal": 129700 }
```

o bien `{ "shippingAddress": { … }, "expectedTotal": 129700 }` (una dirección sin guardarla; exactamente uno de `addressId` o `shippingAddress`).

- **Validaciones:** `expectedTotal` entero ≥ 0; `contactEmail` con formato válido; `shippingAddress` según 8.2; `addressId` del propio cliente; `privacyNoticeVersion` obligatorio para invitados (ADR-0067). El cliente registrado debe tener email verificado (BR-USR-05) y el contacto de su orden es su email de cuenta.
- **Proceso:** recalcula todo sin cache; si el total difiere de `expectedTotal` → 409; reserva todo el stock o nada; crea la orden en PENDING_PAYMENT con snapshots; marca el carrito CHECKED_OUT (una sola transacción).
- **Response 201:** `Order` (vista de cliente) con `publicCode` y `paymentDueAt`. `Location: /v1/me/orders/{publicCode}` solo en la ruta de cliente.
- **Errores:** 400 `idempotency-key-missing`; 403 `email-not-verified`; 403 `staff-cannot-purchase`; 404 (carrito o dirección); 409 `total-mismatch` (con `currentTotal`); 409 `insufficient-stock` (con `lines`); 409 `variant-not-sellable`; 409 `cart-not-active`; 409 `empty-cart`; 409 `idempotency-request-in-progress`; 422 `idempotency-key-mismatch`.
- **Rate limit:** 10 por usuario o carrito en 10 minutos.

### 15.4 Consultas del cliente (UC-ORD-03)

- **`GET /v1/me/orders`** — Paginado. Filtros: `status`, `placedFrom`, `placedTo`. Orden: `placedAt` (defecto `-placedAt`), `grandTotal`. Response: página de `Order` sin `lines` ni `shippingAddress` (resumen con `itemCount`).
- **`GET /v1/me/orders/{publicCode}`** — 200 `Order`. 404 si no existe o es de otro cliente.

### 15.5 Consulta de pedido de invitado (UC-ORD-04, ADR-0020)

- **`POST /v1/orders/lookup`** — Request `{ "contactEmail", "publicCode" }`. Los datos van en el cuerpo, no en la URL, para no dejarlos en logs ni historiales (ADR-0071).
- Response 200: `Order`. Solo órdenes de invitado; una orden de cliente registrado se consulta en `/v1/me/orders`.
- Errores: 404 `not-found` idéntico si la orden no existe, el email no coincide o la orden pertenece a una cuenta (BR-ORD-11).
- Rate limit obligatorio: 10 por IP en 15 minutos.

### 15.6 Enlace de acceso por correo (UC-ORD-05) — fuera del MVP

No se implementa en el MVP (ADR-0077). El invitado consulta su pedido con email y código público (15.5); si perdió el código, lo atiende el staff por un canal externo. El diseño previsto para implementarlo después (recuperación solo con email) está en ADR-0077.

### 15.7 Administración de órdenes (UC-ORD-06 a 08)

**`GET /v1/admin/orders`** — `orders.read`. Paginado.

| Filtro | Detalle |
|---|---|
| `q` | Número interno, código público (con o sin guion) o email de contacto |
| `status` | Uno o varios |
| `customerId` | Órdenes de un cliente |
| `guest` | `true` = solo invitados |
| `placedFrom`, `placedTo` | Fechas |
| `hasPendingRefund` | `true` = Cancelled con pago capturado y sin reembolso completado (ADR-0051) |

Orden: `placedAt` (defecto `-placedAt`), `orderNumber`, `grandTotal`. Response: página de `AdminOrder` resumido (sin líneas ni historial).

**`GET /v1/admin/orders/{orderId}`** — `orders.read`. 200 `AdminOrder`.

**`POST /v1/admin/orders/{orderId}/cancel`** — `orders.manage`.

- Request: `{ "reason": "…", "restock": false, "version": 12 }`. `reason` 1–500 caracteres; `restock` opcional, solo en estado PAID y requiere además `inventory.write` (ADR-0052).
- Desde PENDING_PAYMENT: Cancelled y libera la reserva. Desde PAID o AWAITING_MANUAL_FULFILLMENT: Cancelled e inicia el reembolso total (ADR-0051).
- 200 `AdminOrder`. Auditado.
- Errores: 409 `invalid-state-transition` (Shipped o posterior, ya cancelada); 403 `forbidden` si pide `restock` sin `inventory.write`; 409 `restock-not-allowed`.

**`POST /v1/admin/orders/{orderId}/retry-fulfillment`** — `orders.manage`.

- Request: `{ "version" }`. Solo en AWAITING_MANUAL_FULFILLMENT: intenta reservar y confirmar el stock; si lo logra, pasa a PAID (ADR-0012). Si se decide no surtir, se usa `/cancel`.
- 200 `AdminOrder`. Errores: 409 `insufficient-stock` (con `lines`); 409 `invalid-state-transition`.

UC-ORD-09 y UC-ORD-10 no tienen API: los ejecutan eventos y jobs.

---

## 16. Endpoints — Payments

### 16.1 Resumen

| Método | Ruta | Acceso | UC |
|---|---|---|---|
| POST | `/v1/orders/{publicCode}/payments` | Público + `Idempotency-Key` | UC-PAY-01 |
| POST | `/v1/me/orders/{publicCode}/payments` | Solo cliente + `Idempotency-Key` | UC-PAY-01 |
| GET | `/v1/admin/payments` | `orders.read` | Consulta |
| GET | `/v1/admin/payments/{paymentId}` | `orders.read` | Consulta |
| POST | `/v1/admin/payments/manual-captures` | `payments.manage` | UC-PAY-02 |
| POST | `/v1/admin/payments/{paymentId}/refunds/manual` | `payments.manage` (+ `inventory.write` con reintegro) | UC-PAY-06 |
| POST | `/v1/admin/payments/{paymentId}/refunds/retry` | `payments.manage` (+ `inventory.write` con reintegro) | UC-PAY-07 |
| POST | `/v1/webhooks/paypal` | Firma de PayPal | UC-PAY-04 |

La lectura de pagos usa `orders.read`, porque el catálogo de permisos no tiene uno de lectura de pagos y el pago forma parte de la vista de la orden (ADR-0071).

### 16.2 Iniciar pago (UC-PAY-01)

- **`POST /v1/orders/{publicCode}/payments`** (invitado) — Request `{ "cartId", "provider": "MANUAL" }`. El `cartId` debe ser el carrito de origen de la orden: prueba que quien paga es quien compró, y es el alcance de la llave de idempotencia (ADR-0063).
- **`POST /v1/me/orders/{publicCode}/payments`** (cliente) — Request `{ "provider": "MANUAL" }`.
- **Validaciones:** `provider` entre los habilitados (hoy solo `MANUAL`, y solo si la variable de entorno lo habilita; PayPal no habilitado, ADR-0040) → otro valor, 400 `validation-error`. La orden debe estar en PENDING_PAYMENT. El monto se toma de la orden (BR-PAY-02).
- **Response 201:**

```json
{
  "paymentId": "0192…",
  "provider": "MANUAL",
  "status": "PENDING",
  "amount": { "amount": 129700, "currency": "MXN" },
  "action": {
    "type": "PAY_IN_STORE",
    "orderCode": "K7M4-Q9XA",
    "amount": { "amount": 129700, "currency": "MXN" },
    "instructions": "Presenta este código en la tienda para pagar."
  }
}
```

  `action.type` es extensible: `PAY_IN_STORE` (manual, ADR-0055) y, cuando se habilite PayPal, `REDIRECT` con `url`. Si el pago ya se inició con el mismo proveedor, 200 con la misma acción.
- **Errores:** 400 `idempotency-key-missing`; 404 (orden inexistente, ajena o `cartId` que no corresponde); 409 `invalid-state-transition` (orden no pendiente o pago ya iniciado con otro proveedor); 422 `idempotency-key-mismatch`.

### 16.3 Consulta administrativa

`AdminPayment { id, orderId, orderCode, provider, status, amount, capturedAmount, refundedAmount, currency, providerPaymentId, capturedAt, attempts: [ { status, providerReference, failureCode, registeredBy, createdAt } ], refunds: [ { id, amount, status, providerRefundId, registeredBy, createdAt, completedAt } ], createdAt, updatedAt, version }`.

- **`GET /v1/admin/payments`** — Paginado. Filtros: `status`, `provider`, `orderId`, `capturedFrom`, `capturedTo`. Orden: `createdAt` (defecto `-createdAt`), `amount`.
- **`GET /v1/admin/payments/{paymentId}`** — 200 `AdminPayment`.

### 16.4 Registrar pago manual (UC-PAY-02, ADR-0040, ADR-0055)

- **`POST /v1/admin/payments/manual-captures`** — `payments.manage`.
- Request: `{ "orderId", "reference": "Ticket 00452", "note": "…" }`. `reference` 1–100 (comprobante de la tienda); `note` 0–500.
- Registra el cobro por el total de la orden (crea el Payment si no existe) y produce `PaymentCaptured`; la orden sigue el flujo normal o el de pago tardío (ADR-0012).
- Solo órdenes en PENDING_PAYMENT o EXPIRED.
- 201 `AdminPayment`. Auditado.
- Errores: 403 `manual-payments-disabled`; 409 `invalid-state-transition` (otro estado de la orden o pago ya capturado).

### 16.5 Reembolsos (UC-PAY-06, UC-PAY-07, ADR-0051, ADR-0052)

- **`POST /v1/admin/payments/{paymentId}/refunds/manual`** — Registrar un reembolso hecho fuera del sistema. Request `{ "reference", "note", "restock": false, "version" }` (`version` del pago). Solo pagos MANUAL con reembolso pendiente o fallido de una orden cancelada. Completa el reembolso: la orden pasa a REFUNDED. `restock` reintegra todas las líneas si la orden no tiene reintegros previos. 200 `AdminPayment`. Errores: 403 `manual-payments-disabled`; 403 `forbidden` (reintegro sin `inventory.write`); 409 `invalid-state-transition`; 409 `restock-not-allowed`.
- **`POST /v1/admin/payments/{paymentId}/refunds/retry`** — Reintentar un reembolso fallido con el proveedor. Request `{ "restock": false, "version" }`. 200 `AdminPayment`. Errores: 409 `invalid-state-transition` (no hay reembolso fallido); 409 `restock-not-allowed`.

UC-PAY-03 (inicio del reembolso al cancelar) ocurre dentro de `POST /v1/admin/orders/{orderId}/cancel`. UC-PAY-05 (conciliación) es un job.

---

## 17. Endpoints — Shipping

| Método | Ruta | Permiso | UC |
|---|---|---|---|
| GET | `/v1/admin/shipping/method` | `shipping.manage` | UC-SHI-02 |
| PUT | `/v1/admin/shipping/method` | `shipping.configure` | UC-SHI-02 |
| GET | `/v1/admin/shipping/shipments` | `shipping.manage` | UC-SHI-08 |
| GET | `/v1/admin/shipping/shipments/{shipmentId}` | `shipping.manage` | UC-SHI-08 |
| PATCH | `/v1/admin/shipping/shipments/{shipmentId}` | `shipping.manage` | UC-SHI-04 |
| POST | `/v1/admin/shipping/shipments/{shipmentId}/dispatch` | `shipping.manage` | UC-SHI-05 |
| POST | `/v1/admin/shipping/shipments/{shipmentId}/deliver` | `shipping.manage` | UC-SHI-06 |
| POST | `/v1/admin/shipping/shipments/{shipmentId}/delivery-failure` | `shipping.manage` | UC-SHI-07 |
| POST | `/v1/admin/shipping/shipments/{shipmentId}/return` | `shipping.manage` | UC-SHI-09 |

**Método de envío** (`ShippingMethod { id, name, flatFee: Money, freeShippingThreshold: Money | null, isActive, version, updatedAt }`).

- `GET` — 200 el método activo.
- `PUT` — Request `{ "name", "flatFee": 9900, "freeShippingThreshold": 150000, "version" }`; `flatFee` ≥ 0; umbral `null` (sin envío gratis) o > 0. Los cambios no afectan órdenes colocadas (ADR-0042). 200. Permiso `shipping.configure` (ADR-0075).

**Envíos** (`AdminShipment { id, orderId, orderCode, warehouseId, status, destination: Address, items: [ { orderLineId, sku, productName, quantity } ], carrierName, trackingNumber, dispatchedAt, deliveredAt, failedAt, returnedAt, version, createdAt }`).

| Endpoint | Detalle |
|---|---|
| `GET …/shipments` | Paginado. Filtros: `status` (defecto PENDING, UC-SHI-08), `orderId`, `q` (código de orden o guía), `createdFrom`, `createdTo`. Orden: `createdAt` (defecto `createdAt` ascendente: primero los más antiguos), `dispatchedAt` |
| `GET …/shipments/{shipmentId}` | 200 `AdminShipment` |
| `PATCH …/shipments/{shipmentId}` | Request `{ "carrierName", "trackingNumber", "version" }` (1–100 y 1–100). Permitido en PENDING y DISPATCHED. 200. Errores: 409 `invalid-state-transition` |
| `POST …/dispatch` | Request `{ "version" }`. Desde PENDING. Si hay `carrierName`, exige `trackingNumber` (BR-SHP-04). La orden pasa a SHIPPED. 200. Errores: 409 `invalid-state-transition`; 400 `validation-error` (falta guía). Envíos sin paquetería: PENDIENTE (P-57) |
| `POST …/deliver` | Request `{ "version" }`. Desde DISPATCHED. La orden pasa a DELIVERED. 200 |
| `POST …/delivery-failure` | Request `{ "note", "version" }`. Desde DISPATCHED. La orden no cambia (ADR-0053). 200 |
| `POST …/return` | Request `{ "note", "version" }`. Desde DELIVERY_FAILED. El reintegro de stock se hace con `POST /v1/admin/inventory/restocks`. 200 |

UC-SHI-01 (costo) ocurre dentro de la cotización; UC-SHI-03 (crear envío) es una reacción a `OrderPaid`.

---

## 18. Endpoints — Auditoría (UC-AUD-02, ADR-0037)

**`GET /v1/admin/audit`** — `audit.read`.

- Paginación por cursor (sección 5.2); orden fijo, más reciente primero.
- Filtros: `actorId`, `actorType`, `action` (código exacto o prefijo con `*`, por ejemplo `orders.*`), `resourceType`, `resourceId`, `result`, `from`, `to` (máximo 3 meses atrás; los registros anteriores están en archivos fuera de la API).
- `AuditEntry { id, occurredAt, actorType, actorId, action, resourceType, resourceId, result, correlationId, ip, userAgent, changes }`. `changes` nunca contiene valores sensibles ni personales (ADR-0067).
- No existen endpoints para modificar ni borrar registros.

---

## 19. Webhooks

**`POST /v1/webhooks/paypal`** (UC-PAY-04)

- **Estado:** el adaptador de PayPal no está habilitado (ADR-0040); mientras tanto, la ruta responde 404.
- **Autenticación:** verificación de la firma de PayPal; sin token ni rate limit general.
- **Request:** el evento del proveedor, sin transformar.
- **Response:** 200 al procesarlo o si ya se había procesado (deduplicación por ID de evento, BR-PAY-06); un evento tardío no revierte estados posteriores (BR-PAY-05).
- **Errores:** 401 `invalid-webhook-signature`; ante un error interno, 500 para que el proveedor reintente.
- Los detalles de verificación y eventos admitidos se definen al verificar el adaptador (T-191, P-31).

---

## 20. Pendientes que afectan a los contratos

| ID | Tema | Endpoints afectados |
|---|---|---|
| P-57 | Envíos sin paquetería | `POST …/shipments/{id}/dispatch` |
| P-58 | IVA del envío y base del umbral | Valores de `CheckoutQuote` (no su forma) |
| T-145 | Formato de la carga masiva de precios | `POST …/price-lists/{id}/imports` |

---

## 21. Cobertura de casos de uso

| Caso de uso | Endpoint o mecanismo |
|---|---|
| UC-IAM-01 a 11 | Sección 9 |
| UC-IAM-12 | Sin API: canal externo (ADR-0067); lo ejecutan UC-IAM-18 y 19 |
| UC-IAM-13 a 19 | Sección 9 |
| UC-IAM-20, 21 | Sin API: scripts (ADR-0043, ADR-0057) |
| UC-IAM-22 | Sección 10 |
| UC-CAT-01 a 14 | Sección 11 |
| UC-PRC-01 a 05 | Sección 12 |
| UC-PRC-06 | Sin API pública: fachada interna del módulo |
| UC-INV-01 a 04, 09 | Sección 13 |
| UC-INV-05 a 08 | Sin API: checkout, eventos y jobs |
| UC-CRT-01 a 06, 09 | Sección 14 |
| UC-CRT-07, 08 | Sin API: job y evento `OrderExpired` |
| UC-ORD-01 a 08 | Sección 15 |
| UC-ORD-09, 10 | Sin API: evento `PaymentCaptured` y job |
| UC-PAY-01, 02, 04, 06, 07 | Secciones 16 y 19 |
| UC-PAY-03 | Dentro de la cancelación de órdenes |
| UC-PAY-05 | Sin API: job |
| UC-SHI-02, 04 a 09 | Sección 17 |
| UC-SHI-01, 03 | Dentro de la cotización; evento `OrderPaid` |
| UC-AUD-02 | Sección 18 |
| UC-AUD-01, 03, UC-NTF-01, UC-SYS-01 | Sin API: transversales y jobs |

---

## OpenAPI

Swagger/OpenAPI generado desde NestJS (ADR-0002) a partir de los DTOs de Presentation; documenta cada endpoint de este documento, sus esquemas y sus `type` de error. Se expone solo en el entorno local (ADR-0031). Este documento es la especificación de referencia hasta que exista la implementación; después, la especificación generada debe coincidir con él.

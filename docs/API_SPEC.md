# API SPECIFICATION

**Estado:** aprobado (ADR-0071, T-005, 2026-09-25). Implementados: autenticación, cuenta propia y direcciones, administración de Identity & Access y catálogo geográfico (Sprint 2); categorías y marcas (T-150), productos, imágenes y tienda pública (T-140), precios (T-145), inventario (T-160) y método de envío (T-196); cada endpoint implementado indica su tarea y su ADR, y Swagger (`/docs/v1`, solo en local) muestra solo los implementados. Los contratos se derivan de `REQUIREMENTS.md` (casos de uso UC-xxx y errores E-xx), `DATABASE.md` (ADR-0066), `SECURITY.md` y las decisiones de `DECISIONS.md`. Lo no decidido se marca como PENDIENTE DE DECISIÓN con su P-xx.

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
| Cuerpo | JSON UTF-8 (`application/json`) de hasta 100 kB y 32 niveles de anidación (más: 400 `validation-error`, ADR-0153); subida de imágenes con `multipart/form-data`; errores con `application/problem+json` | ADR-0035 |
| Recursos | Plural, en inglés y separados por guion: `/v1/admin/pricing/price-lists` | ADR-0036 |
| Campos | camelCase | ADR-0036 |
| Identificadores | `uuid` en rutas y cuerpos; un ID de la ruta que no es UUID responde 404 (ADR-0112). Excepciones: producto público por `slug`; orden de cliente por código público (`publicCode`) | ADR-0049, ADR-0066 |
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

Los recursos con columna `version` (`users`, `roles`, `products`, `price_lists`, `orders`, `payments`, `shipments`, `shipping_methods`) devuelven `version` en su representación. `variant_prices`, `reservations` y `carts` también la tienen, pero solo para la concurrencia interna (`DATABASE.md`, sección 12). Toda modificación administrativa de esos recursos (PATCH y acciones) exige `version` en el cuerpo:

- `version` ausente → 400 `validation-error`.
- `version` distinta de la actual → 409 `version-conflict` (E-05); el cliente vuelve a leer y reintenta.

Las operaciones del cliente sobre su carrito no exigen `version`; el servidor resuelve la concurrencia internamente (ADR-0071).

### 2.4 Encabezados

| Encabezado | Dirección | Uso |
|---|---|---|
| `Authorization: Bearer <accessToken>` | Solicitud | Rutas `/v1/me` y `/v1/admin`, y cierre de sesión |
| `Idempotency-Key` | Solicitud | Obligatorio donde se indica (sección 4) |
| `Content-Type` | Solicitud | `application/json` o `multipart/form-data`; otro → 415 |
| `X-Correlation-Id` | Respuesta | En todas las respuestas; mismo valor que `correlationId` de los errores. Lo genera siempre el servidor (UUIDv7); uno enviado por el cliente se ignora (ADR-0033, ADR-0095) |
| `Location` | Respuesta | En 201 cuando el recurso tiene ruta propia |
| `Retry-After` | Respuesta | En 429 y en 409 `idempotency-request-in-progress` |
| `Cache-Control: no-store` | Respuesta | En toda respuesta autenticada y en las que contienen datos personales o tokens (ADR-0071), como las públicas de carritos, cotización y órdenes de invitado, también en sus errores (ADR-0153) |

CORS (ADR-0085): solo los orígenes de `CORS_ALLOWED_ORIGINS` (vacía por defecto, sin comodín ni credenciales). Un navegador puede enviar `Authorization`, `Content-Type` e `Idempotency-Key`, y leer `Location`, `Retry-After` y `X-Correlation-Id`. Un encabezado nuevo de solicitud o de respuesta obliga a revisar esta lista.

### 2.5 Efectos en segundo plano (consistencia eventual)

Algunos efectos de una operación ocurren en otro contexto, por medio de un evento de dominio que se procesa en segundo plano después de confirmar la operación (ADR-0098, ADR-0150). **La respuesta llega antes de que esos efectos ocurran.** Normalmente tardan fracciones de segundo, pero no hay un tiempo garantizado. El cliente debe advertir al usuario de la posible demora (por ejemplo, "El estado de la orden puede tardar unos segundos en actualizarse") y volver a consultar el recurso en lugar de suponer el estado.

| Operación que lo origina | Evento | Efecto en segundo plano | Dónde se nota |
|---|---|---|---|
| Registrar un pago manual (`POST /v1/admin/orders/{orderId}/manual-capture`, ADR-0134); en el futuro, el webhook o la conciliación de PayPal | `PaymentCaptured` | La orden pasa a PAID, se confirma su reserva y se crea su envío en PENDING, todo en una transacción (UC-SHI-03, ADR-0140); si la reserva ya expiró, sigue el flujo de pago tardío y puede quedar en AWAITING_MANUAL_FULFILLMENT, sin envío (UC-ORD-09, ADR-0012). Una orden cancelada sigue cancelada con `hasPendingRefund`, y se inicia su reembolso (ADR-0133, ADR-0135) | Estado de la orden para el staff, el cliente y el invitado: puede seguir en PENDING_PAYMENT o EXPIRED unos instantes; lista de envíos pendientes del staff |
| La orden quedó pagada (efecto anterior) | `OrderPaid` | Se envía el correo "Pago confirmado" (ADR-0074, ADR-0143). Se publica también al reintentar el surtido, y no cuando la orden queda esperando stock | Correo del cliente |
| Despachar el envío (`POST /v1/admin/shipping/shipments/{shipmentId}/dispatch`) | `ShipmentDispatched` | La orden pasa a SHIPPED, con `shippedAt` igual al despacho (ADR-0141), y se envía el correo "Orden enviada" (ADR-0143) | Estado de la orden; correo del cliente |
| Marcar el envío como entregado (`POST …/deliver`) | `ShipmentDelivered` | La orden pasa a DELIVERED, con `deliveredAt` igual a la entrega; si seguía en PAID, pasa antes por SHIPPED (ADR-0141) | Estado de la orden |
| Completar un reembolso (`POST /v1/admin/payments/{paymentId}/refunds/manual`; en el futuro, el proveedor) | `RefundCompleted` | La orden pasa a REFUNDED, con `refundedAt` igual a la fecha del reembolso, y deja de tener `hasPendingRefund` (ADR-0051, ADR-0135), y se envía el correo "Reembolso completado" (ADR-0143) | Estado de la orden; correo del cliente |
| Colocar la orden (`POST /v1/orders`, `POST /v1/me/orders`) | `OrderPlaced` | Se envía el correo "Orden recibida", con las instrucciones de pago en tienda si el pago manual está habilitado (ADR-0143) | Correo del cliente |
| Cancelar la orden (`POST /v1/admin/orders/{orderId}/cancel`) | `OrderCancelled` | Se envía el correo "Orden cancelada", que dice si el reembolso está en proceso (ADR-0143) | Correo del cliente |
| Pedir un enlace de acceso a los pedidos de invitado (`POST /v1/orders/access-links`, ADR-0148) | `OrderAccessRequested` | Si el email tiene órdenes de invitado, se emite el enlace, que invalida los anteriores del email, y se envía el correo "Consulta tus pedidos"; si no, nada | Correo del invitado |
| Pedir un enlace de recuperación (`POST /v1/auth/password-reset/request`, ADR-0154) | `PasswordResetRequested` | Si el email es de una cuenta que puede iniciar sesión, se emite el enlace, que invalida los anteriores, y se envía el correo "Restablece tu contraseña"; si no, nada | Correo de la cuenta |
| Pedir otro enlace de verificación (`POST /v1/auth/email-verification/resend`, ADR-0154) | `EmailVerificationRequested` | Si el email es de un cliente activo sin verificar, se emite el enlace, que invalida los anteriores, y se envía el correo "Confirma tu correo"; si no, nada | Correo del cliente |
| Expirar una orden impaga (job cada minuto, ADR-0136) | `OrderExpired` | Las líneas vuelven al carrito (UC-CRT-08, ADR-0054, ADR-0137): el invitado, o el cliente sin carrito activo, recupera el carrito de la orden activo otra vez; el cliente con carrito activo recibe en él las líneas | Carrito del cliente o del invitado |
| Publicar o archivar un producto, o descontinuar una variante | `ProductPublished`, `ProductArchived`, `VariantDiscontinued` | Se invalida el cache del catálogo público (ADR-0028) | Catálogo público |

- Ocurren dentro de la operación, y por eso ya están en la respuesta, los cambios del propio recurso (el pago capturado, el envío despachado) y lo que la operación hace en una sola transacción: en el checkout, la reserva, la orden y el carrito (ADR-0019); al cancelar, la liberación de la reserva, el inicio del reembolso y la cancelación del envío (ADR-0140).
- Si el procesamiento de un evento falla, o la API se detiene después de confirmar, el efecto se reintenta hasta 8 veces en unas 22 horas, así que puede tardar más (ADR-0150). Un efecto puede ocurrir dos veces en un caso raro; los cambios de estado lo toleran, y un correo podría llegar duplicado. Lo que agota sus intentos lo consulta y lo reintenta el staff (sección 22).
- La solicitud de un enlace de acceso a los pedidos (`OrderAccessRequested`), de recuperación (`PasswordResetRequested`) o de verificación (`EmailVerificationRequested`) no se reintenta, porque lleva el email: si se pierde, se pide otro enlace.
- Todo efecto nuevo en segundo plano se agrega a esta tabla.

Encabezados de seguridad (ADR-0086): toda respuesta lleva `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY` y `Referrer-Policy: no-referrer`, y no lleva `X-Powered-By`. Swagger UI, solo en local, tiene una CSP más permisiva en su ruta.

---

## 3. Autenticación y autorización

### 3.1 Mecanismo (ADR-0022, ADR-0023, ADR-0047, ADR-0048)

- Login con email y contraseña → token de acceso JWT (15 minutos) y refresh token opaco (7 días, rotado en cada uso).
- Token de acceso en `Authorization: Bearer`; refresh token en el cuerpo JSON de `/v1/auth/refresh` y `/v1/auth/logout`.
- Presentar un refresh token ya rotado revoca toda la sesión.
- Implementado en T-120 (ADR-0114):
  - El token de acceso es un JWT HS256 que solo lleva el usuario (`sub`) y la sesión (`sid`).
  - Cada solicitud autenticada comprueba que la cuenta siga activa y la sesión abierta, y lee los permisos actuales. Suspender una cuenta, cerrar sesión o cambiar roles aplica desde la siguiente solicitud, sin esperar a que venza el token.
  - Un token ausente, inválido o vencido deja la solicitud sin usuario: las rutas que lo exigen responden 401 `unauthenticated`, y las públicas lo ignoran.
  - Duraciones configurables con `ACCESS_TOKEN_TTL` y `REFRESH_TOKEN_TTL`.

### 3.2 Grupos de rutas (ADR-0036)

| Grupo | Prefijo | Requisito | Guard |
|---|---|---|---|
| Público | `/v1/auth`, `/v1/geo`, `/v1/catalog`, `/v1/carts`, `/v1/checkout`, `/v1/orders`, `/v1/privacy` | Ninguno | Rate limiting |
| Cuenta | `/v1/me` | Token de acceso válido de una cuenta ACTIVE | Autenticación; algunas rutas solo para clientes (se indica con "Solo cliente") |
| Administración | `/v1/admin/{contexto}` | Token de staff ACTIVE y el permiso indicado | Autenticación + tipo STAFF + permiso |
| Webhooks | `/v1/webhooks/{proveedor}` | Firma del proveedor | Verificación de firma |

Reglas:

- Un token de cliente en `/v1/admin` → 403 `forbidden`.
- Un token de staff en rutas "Solo cliente" de `/v1/me` → 403 `staff-cannot-purchase` (E-09) en carrito y checkout, 403 `forbidden` en el resto.
- **Cambio de contraseña obligatorio:** mientras un staff tenga `mustChangePassword`, cualquier ruta excepto `GET /v1/me`, `POST /v1/me/password` y `POST /v1/auth/logout` responde 403 `password-change-required` (E-18) (ADR-0071).
- Un recurso de otro propietario se responde como inexistente (404), nunca como 403, para no revelar su existencia.

### 3.3 Permisos

Catálogo de ADR-0043 y ADR-0075 (`catalog.read`, `catalog.write`, `pricing.read`, `pricing.write`, `inventory.read`, `inventory.write`, `orders.read`, `orders.manage`, `payments.manage`, `shipping.manage`, `shipping.configure`, `customers.read`, `customers.manage`, `staff.manage`, `audit.read`, `events.manage` de ADR-0150 y `orders.read-blocked` de ADR-0152). Cada endpoint administrativo indica el permiso requerido; cuando requiere dos, se indican ambos.

---

## 4. Idempotencia (ADR-0063)

Obligatoria en:

- `POST /v1/orders` y `POST /v1/me/orders` (colocar orden).
- `POST /v1/orders/{publicCode}/payments` y `POST /v1/me/orders/{publicCode}/payments` (iniciar pago).
- `POST /v1/admin/orders/{orderId}/restocks` (reintegrar stock, ADR-0142).

| Situación | Respuesta |
|---|---|
| Sin `Idempotency-Key` | 400 `idempotency-key-missing` |
| Misma llave y mismo contenido | La respuesta guardada, con el mismo código |
| Misma llave y contenido distinto | 422 `idempotency-key-mismatch` |
| Misma llave con la solicitud original en proceso | 409 `idempotency-request-in-progress` con `Retry-After` |

- Formato: 1 a 255 caracteres; se recomienda UUID. Una llave vacía responde 400 `idempotency-key-missing`; una de más de 255 caracteres, 400 `validation-error`.
- Alcance: usuario autenticado o, para invitados, el `cartId` del cuerpo; y el endpoint, identificado por su ruta declarada (por ejemplo, `POST /v1/orders/{publicCode}/payments`).
- "Mismo contenido" compara los parámetros de la ruta y el cuerpo, sin importar el orden de los campos. Usar la misma llave para pagar otra orden responde 422 (ADR-0099).
- Se guardan éxitos (estado, cuerpo y `Location`) y errores de negocio; no errores de validación (tampoco los que encuentra el dominio, como un estado que no existe, ADR-0132), 5xx, 401 ni 429, así que tras ellos se puede reintentar con la misma llave. Un error de negocio repetido lleva un `correlationId` nuevo. Retención de 24 horas.
- El 409 `idempotency-request-in-progress` lleva `Retry-After: 2`. Si la solicitud original quedó abandonada (por ejemplo, porque el servidor se reinició) y sigue "en proceso" después de 60 segundos, la siguiente solicitud con la misma llave y el mismo contenido se ejecuta de nuevo; las reglas del dominio impiden duplicar la orden o el pago (ADR-0099).

---

## 5. Listados: paginación, filtros y ordenamiento

### 5.1 Paginación por página (ADR-0036)

- Parámetros: `page` (entero de 1 a 1,000,000, por defecto 1; ADR-0153) y `pageSize` (1 a 100, por defecto 20).
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
- Un cursor inválido → 400 `validation-error` en `cursor`, con código `cursor` (ADR-0127).

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
- `title`: resumen fijo por tipo. `detail`: explicación fija por tipo, sin datos internos ni stack traces en ningún entorno (ADR-0095).
- `instance`: ruta de la solicitud, sin la cadena de consulta.
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
    { "field": "postalCode", "code": "matches", "message": "Debe tener 5 dígitos." },
    { "field": "municipalityCode", "code": "isMunicipalityOfState", "message": "El municipio no pertenece al estado elegido." }
  ]
}
```

`errors[].field` usa notación de ruta para campos anidados (`shippingAddress.phone`, `lines[2].quantity`). `errors[].code` es el nombre de la regla de validación que falló (por ejemplo, `isInt`, `matches` o `whitelistValidation` para un campo no declarado); se informa una sola regla por campo: la de presencia (`isDefined`, `isNotEmpty`) o la de tipo (`isString`, `isInt`…) si fallan, y si no, la primera que falla (ADR-0130). `errors[].message` está en español y nunca repite el valor rechazado (ADR-0095).

### 6.2 Catálogo de tipos

| `type` (`/problems/…`) | HTTP | E-xx | Cuándo | Extensiones |
|---|---|---|---|---|
| `validation-error` | 400 | E-01, E-11 | Campos, parámetros, cantidades o filtros inválidos | `errors` |
| `password-policy-violation` | 400 | E-21 | Contraseña fuera de 15–64 caracteres, con caracteres no permitidos, común o igual a la actual; `errors[].code` dice cuál (ADR-0115) | `errors` |
| `invalid-or-expired-token` | 400 | E-20 | Enlace de verificación, recuperación o acceso a los pedidos usado, vencido o invalidado | — |
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
| `insufficient-stock` | 409 | E-07 | No se puede reservar alguna línea | `lines` (`variantId`, `canFulfill`): las que le faltan al almacén más cercano (ADR-0160) |
| `variant-not-sellable` | 409 | E-10 | Variante no publicada, descontinuada o sin precio | `variantIds` |
| `invalid-state-transition` | 409 | E-12 | Acción no permitida en el estado actual | `currentStatus`; `reason` cuando hace falta distinguir el caso (ADR-0120, ADR-0123) |
| `duplicate-value` | 409 | E-13 | Email, SKU, slug, código o nombre ya usado | `field` |
| `resource-in-use` | 409 | E-14 | Borrado de entidad con referencias | — |
| `price-period-conflict` | 409 | E-15 | Periodo superpuesto o ya iniciado | `reason`: `overlap` u `already-started` (ADR-0125) |
| `idempotency-request-in-progress` | 409 | E-25 | Solicitud original aún en proceso | — |
| `cart-not-active` | 409 | E-27 | Modificar un carrito CHECKED_OUT o MERGED | `cartStatus` |
| `cart-line-limit-reached` | 409 | E-36 | Más de 100 variantes distintas en un carrito (ADR-0131) | `limit` |
| `address-limit-reached` | 409 | E-28 | Más de 10 direcciones (BR-ADR-04) | `limit` |
| `image-limit-reached` | 409 | E-35 | Más de 20 imágenes en un producto (ADR-0124) | `limit` |
| `last-superadmin` | 409 | E-29 | Dejar el sistema sin superadministrador (BR-USR-03) | — |
| `restock-not-allowed` | 409 | E-30 | Reintegro que supera lo vendido o con reintegro previo (ADR-0052) | `lines` |
| `active-orders-exist` | 409 | E-31 | Anonimizar con órdenes sin concluir (ADR-0067) | — |
| `field-locked` | 409 | E-32 | Editar SKU, opciones o slug después de la primera publicación (ADR-0068) | `fields` |
| `empty-cart` | 409 | E-33 | Cotizar o colocar orden con carrito vacío (BR-ORD-01) | — |
| `source-cart-unavailable` | 409 | E-34 | Recompra del staff para un invitado cuyo carrito original ya no existe (ADR-0082) | — |
| `idempotency-key-mismatch` | 422 | E-25 | Llave reutilizada con otro contenido | — |
| `payload-too-large` | 413 | E-22 | Imagen de más de 5 MB | `maxBytes` |
| `unsupported-media-type` | 415 | E-22 | Formato de imagen o `Content-Type` no admitido | — |
| `rate-limit-exceeded` | 429 | E-26 | Límite de frecuencia excedido | — |
| `internal-error` | 500 | — | Error no controlado; solo `correlationId`, sin detalles | — |

E-27 a E-36 son derivados de reglas existentes y están en el catálogo de `REQUIREMENTS.md`.

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
| 20 intentos fallidos por IP en 15 minutos | `POST /v1/auth/login` |
| 5 contraseñas actuales incorrectas por usuario en 15 minutos | `POST /v1/me/password` |
| 5 por IP por hora | `POST /v1/auth/register` |
| 3 por email y 10 por IP por hora | `POST /v1/auth/password-reset/request` |
| 3 por email por hora | `POST /v1/auth/email-verification/resend`, `POST /v1/me/email` |
| 3 por email y 10 por IP por hora | `POST /v1/orders/access-links` |
| 10 por IP en 15 minutos | `POST /v1/orders/lookup`, `POST /v1/orders/reorder`, `POST /v1/orders/access` |
| 10 por usuario o carrito en 10 minutos | `POST /v1/orders`, `POST /v1/me/orders` |
| 5 por email de contacto por hora | `POST /v1/orders` (ADR-0154) |
| 100 por minuto por IP | Todos los endpoints, también los anteriores (ADR-0154) |

Todos configurables por variables de entorno. Al exceder: 429 con `Retry-After`. Los webhooks quedan fuera del límite general (ADR-0071): los protege la verificación de firma.

Detalles del mecanismo (ADR-0102):

- En el login solo cuentan los intentos **fallidos**, por IP; un login correcto no gasta el límite. No hay límite por email: dejaría a cualquiera impedir que el titular entre (ADR-0154). En el cambio de contraseña cuentan solo las contraseñas actuales incorrectas, por usuario.
- Los límites propios se suman al general por IP, porque cuentan por claves que elige el cliente (ADR-0154).
- Cada límite es un presupuesto por clave compartido por los endpoints que lo usan: la consulta, la recompra de invitado y el uso del enlace de acceso comparten el mismo contador por IP.
- Claves: IP; correo (por su huella, nunca el correo: el `email` del cuerpo, o el `contactEmail` al pedir el enlace de acceso); usuario autenticado o, si no hay, el correo (reenvío de verificación y cambio de email); usuario autenticado o carrito (colocar orden); `contactEmail` (órdenes de invitado por email).
- El 429 es `rate-limit-exceeded` con `Retry-After` en segundos, sin encabezados `X-RateLimit-*`.
- Una ruta inexistente responde 404 sin gastar el límite general.
- Variables: `RATE_LIMIT_DEFAULT`, `RATE_LIMIT_LOGIN_IP`, `RATE_LIMIT_PASSWORD_CHANGE`, `RATE_LIMIT_REGISTER`, `RATE_LIMIT_PASSWORD_RESET_EMAIL`, `RATE_LIMIT_PASSWORD_RESET_IP`, `RATE_LIMIT_EMAIL_VERIFICATION`, `RATE_LIMIT_GUEST_ORDER`, `RATE_LIMIT_ORDER_ACCESS_EMAIL`, `RATE_LIMIT_ORDER_ACCESS_IP`, `RATE_LIMIT_PLACE_ORDER` y `RATE_LIMIT_PLACE_ORDER_EMAIL`, con el formato `<cantidad>/<duración>` (por ejemplo, `5/15m`).

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

La dirección de una orden anonimizada, y el destino de su envío, conservan `postalCode`, `stateCode`, `stateName`, `municipalityCode`, `municipalityName` y `country`; los demás campos son `null` (ADR-0067, ADR-0145). Solo el staff ve órdenes anonimizadas: en `AdminOrder` y en `AdminShipment`. Una orden bloqueada (ADR-0070, ADR-0151) y su envío se muestran igual, aunque la base conserva los datos.

### 8.3 `Image`

```json
{ "id": "0192…", "url": "https://…/products/0192…/a1b2.webp", "altText": "Vista frontal", "position": 1, "variantId": null }
```

`url` absoluta, construida al responder (ADR-0024): `IMAGE_BASE_URL` más la clave, como `http://localhost:3000/media/products/<productId>/<imageId>.webp` en local (ADR-0121).

La imagen en posición 1 es la principal del producto, y la primera de una variante es la suya; el staff las elige reordenando la galería (ADR-0124, ADR-0131).

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
- Implementado en T-140 parte c (ADR-0129): si dos variantes empatan en el precio más bajo, `compareAtPrice` es el de la más antigua. `image` es la primera imagen que la tienda puede mostrar: nunca la de una variante que no se vende.

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

Solo variantes vendibles (BR-PRD-11). Nunca incluye cantidades en stock (ADR-0061). `categories` lista solo categorías visibles; `brand` se muestra aunque la marca esté inactiva (ADR-0080).

Implementado en T-140 parte c (ADR-0129): variantes de la más antigua a la más nueva, `optionNames` en orden alfabético y `categories` por nombre. `images` deja fuera las de variantes que no se venden.

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
- `canFulfill` indica si algún almacén puede surtir la cantidad pedida de la línea, sin revelar existencias (ADR-0061, ADR-0160).
- `id` es `null` en `GET /v1/me/cart` cuando el cliente aún no tiene carrito.

### 8.7 `CheckoutQuote`

```json
{
  "lines": [ { "variantId": "…", "quantity": 2, "sku": "…", "productTitle": "…", "options": {}, "unitPrice": {}, "lineTotal": {}, "taxRateBp": 1600, "taxAmount": {}, "sellable": true, "canFulfill": true } ],
  "subtotal": { "amount": 119800, "currency": "MXN" },
  "taxTotal": { "amount": 17890, "currency": "MXN" },
  "shippingCost": { "amount": 9900, "currency": "MXN" },
  "shippingTaxAmount": { "amount": 1366, "currency": "MXN" },
  "discountTotal": { "amount": 0, "currency": "MXN" },
  "grandTotal": { "amount": 129700, "currency": "MXN" },
  "freeShippingThreshold": { "amount": 150000, "currency": "MXN" },
  "estimatedDelivery": { "minBusinessDays": 3, "maxBusinessDays": 7 },
  "readyToPlace": true
}
```

- `taxTotal` informativo: IVA contenido en el subtotal y en el costo de envío; `shippingTaxAmount` es la parte del envío (ADR-0008, ADR-0079, BR-ORD-16).
- `readyToPlace`: todas las líneas vendibles y surtibles.
- `canFulfill` de cada línea indica si cabe en el pedido junto con las demás: cada orden sale completa de un almacén, y se marcan las líneas que le faltan al almacén más cercano, el que deja menos fuera, o el primero por prioridad si empatan. Son las mismas que lista el 409 `insufficient-stock` al colocar la orden (ADR-0160).
- `grandTotal.amount` es el valor que el cliente envía como `expectedTotal`.
- `estimatedDelivery`: plazo de entrega estimado en días hábiles, contado desde la confirmación del pago; es un estimado, no una fecha comprometida (ADR-0083).
- `shippingCost` incluye IVA; es 0 si el subtotal menos `discountTotal` es mayor o igual a `freeShippingThreshold` (ADR-0079).
- Una línea no vendible lleva `unitPrice`, `lineTotal`, `taxRateBp` y `taxAmount` en `null` y `canFulfill: false`; los totales suman solo las líneas vendibles (ADR-0132).
- `freeShippingThreshold` es `null` si el envío nunca es gratis (ADR-0092).

### 8.8 `Order` (vista de cliente)

```json
{
  "publicCode": "K7M4-Q9XA",
  "status": "PENDING_PAYMENT",
  "contactEmail": "cliente@example.com",
  "lines": [ { "lineNumber": 1, "sku": "…", "productName": "…", "variantOptions": {}, "unitPrice": {}, "quantity": 2, "taxRateBp": 1600, "taxAmount": {}, "lineTotal": {} } ],
  "subtotal": {}, "taxTotal": {}, "shippingCost": {}, "shippingTaxAmount": {}, "discountTotal": {}, "grandTotal": {},
  "shippingAddress": { "…": "Address" },
  "estimatedDelivery": { "minBusinessDays": 3, "maxBusinessDays": 7 },
  "payment": { "provider": "MANUAL", "status": "PENDING" },
  "shipment": { "status": "DISPATCHED", "carrierName": "…", "trackingNumber": "…", "ownDelivery": false, "dispatchedAt": "…", "deliveredAt": null },
  "placedAt": "…",
  "paymentDueAt": "…",
  "paidAt": null, "shippedAt": null, "deliveredAt": null, "cancelledAt": null, "expiredAt": null, "refundedAt": null
}
```

- Nunca incluye `orderNumber` interno ni `id` (ADR-0049).
- `payment` y `shipment` son `null` si no existen.
- `contactEmail` es `null` solo en órdenes anonimizadas (ADR-0067), que el comprador ya no ve: solo el staff, en `AdminOrder` (ADR-0145).
- Una orden bloqueada (ADR-0151) tampoco la ve el comprador: no aparece en `GET /v1/me/orders` ni en el enlace de acceso, y su detalle, la consulta de invitado y la recompra responden 404, como una orden que no existe.
- `publicCode` se muestra con guion; las rutas lo aceptan con o sin guion y en mayúsculas o minúsculas (ADR-0132).
- `paymentDueAt`: vencimiento de la reserva mientras la orden está en PENDING_PAYMENT; `null` en otros estados.

### 8.9 `AdminOrder`

`Order` más `id`, `orderNumber`, `customerId` (o `null` si es invitado), `version`, `anonymizedAt`, `payment` completo (`id`, `amount`, `capturedAmount`, `refundedAmount`, `status`, `refunds[]`), `shipment` completo (`id`, `status`, `version`, y `warehouseId`, el almacén del que sale, ADR-0160) y `statusHistory[]` (`fromStatus`, `toStatus`, `actorId`, `reason`, `occurredAt`). Cada línea lleva además su `id`, que nombra el reintegro (ADR-0142). En una orden anonimizada, `contactEmail` es `null` y `shippingAddress` sigue §8.2 (ADR-0145).

`blockedAt` dice cuándo se bloquearon los datos personales de la orden (ADR-0151). Desde entonces, `contactEmail` es `null` y `shippingAddress` sigue §8.2, como en una anonimizada, también en el listado.

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
- **Implementado en T-121 (ADR-0117):** la respuesta lleva `Cache-Control: no-store`. `password-policy-violation` indica la regla en el campo `password`. El enlace es `FRONTEND_BASE_URL/verify-email?token=…` y vence según `EMAIL_VERIFICATION_TTL` (24 horas por defecto).
- **Errores:** 400 `password-policy-violation`; 409 `duplicate-value` con `field: "email"` (el registro sí revela que el email existe, ADR-0062).

### 9.3 `POST /v1/auth/email-verification/confirm` — Verificar email (UC-IAM-02)

- **Autenticación:** ninguna.
- **Request:** `{ "token": "…" }` (el token del enlace; ADR-0056).
- **Response 200:** `{ "emailVerified": true }`. Implementado en T-121 (ADR-0117): el enlace verifica solo la dirección a la que se envió, y solo si la cuenta sigue teniéndola y está activa.
- **Errores:** 400 `invalid-or-expired-token`.

### 9.4 `POST /v1/auth/email-verification/resend` — Reenviar verificación (UC-IAM-03)

- **Autenticación:** ninguna. **Rate limit:** 3 por email por hora.
- **Request:** `{ "email": "cliente@example.com" }`.
- **Response 202** sin cuerpo, exista o no el email y esté o no verificado (BR-USR-12). Invalida el enlace anterior. Implementado en T-121 (ADR-0117): solo envía a un cliente activo sin verificar; a cuentas verificadas, suspendidas o de staff no envía nada.
- **Desde T-310 (ADR-0154):** responde en cuanto recibe la solicitud; el enlace se emite y se envía en segundo plano, así que tampoco el tiempo de la respuesta dice si el email existe o está verificado. El correo puede tardar unos segundos (sección 2.5).

### 9.5 `POST /v1/auth/login` — Iniciar sesión (UC-IAM-04)

- **Autenticación:** ninguna. **Rate limit:** 20 fallidos por IP en 15 minutos; ninguno por email (ADR-0154).
- **Request:** `{ "email": "…", "password": "…" }`.
- **Response 200:** `AuthResult`. Si `mustChangePassword` es `true` (staff con contraseña temporal), el token solo permite las rutas de la sección 3.2.
- **Errores:** 401 `invalid-credentials` para email inexistente, contraseña incorrecta o cuenta suspendida o anonimizada (ADR-0062).
- **Auditoría:** éxito y fallo (ADR-0037).
- **Implementado en T-120 (ADR-0114):** 400 `validation-error` ante un email mal formado, una contraseña de más de 256 caracteres tal como se escribe (la política cuenta 64 tras NFKC, ADR-0153) o un campo desconocido. La respuesta lleva `Cache-Control: no-store`. Al agotar el límite de intentos fallidos de una IP, 429 `rate-limit-exceeded` con `Retry-After`, también con la contraseña correcta. Los fallos de un email no impiden que entre quien da la contraseña correcta desde otra IP (ADR-0154).

### 9.6 `POST /v1/auth/refresh` — Renovar sesión (UC-IAM-05)

- **Autenticación:** ninguna; el refresh token va en el cuerpo.
- **Request:** `{ "refreshToken": "rt_…" }`.
- **Response 200:** `AuthResult` con un par nuevo; el refresh token anterior queda invalidado.
- **Errores:** 401 `invalid-refresh-token` (inválido, vencido, revocado, cuenta suspendida o reutilizado; en este último caso se revoca toda la sesión).
- **Implementado en T-120 (ADR-0114):** la renovación conserva la sesión (`sid`). Dos renovaciones simultáneas con el mismo refresh token cuentan como reutilización, así que el cliente debe renovar de una en una. La respuesta lleva `Cache-Control: no-store`.

### 9.7 `POST /v1/auth/logout` — Cerrar sesión (UC-IAM-06)

- **Autenticación:** token de acceso. **Request:** `{ "refreshToken": "rt_…" }`.
- **Response 204.** Revoca la sesión del refresh token si pertenece al usuario autenticado; si no pertenece o ya estaba revocado, responde igual (idempotente). Desde T-120, los tokens de acceso de esa sesión dejan de servir de inmediato (ADR-0114). Se permite con un cambio de contraseña pendiente.

### 9.8 `POST /v1/auth/password-reset/request` — Solicitar recuperación (UC-IAM-07)

- **Autenticación:** ninguna. **Rate limit:** 3 por email y 10 por IP por hora.
- **Request:** `{ "email": "…" }`.
- **Response 202** sin cuerpo, exista o no el email. No envía correo a cuentas suspendidas. Invalida enlaces anteriores (ADR-0056).
- **Implementado en T-123 (ADR-0118):** el enlace es `FRONTEND_BASE_URL/reset-password?token=…` y vence según `PASSWORD_RESET_TTL` (30 minutos por defecto). Lo reciben clientes y staff activos. Cambiar el email invalida los enlaces pendientes.
- **Desde T-310 (ADR-0154):** responde en cuanto recibe la solicitud; el enlace se emite y se envía en segundo plano, así que tampoco el tiempo de la respuesta dice si la cuenta existe. El correo puede tardar unos segundos (sección 2.5).

### 9.9 `POST /v1/auth/password-reset/confirm` — Restablecer contraseña (UC-IAM-08)

- **Autenticación:** ninguna.
- **Request:** `{ "token": "…", "newPassword": "…" }`.
- **Response 204.** Revoca todas las sesiones del usuario y envía aviso por correo.
- **Errores:** 400 `invalid-or-expired-token`; 400 `password-policy-violation`.
- **Implementado en T-123 (ADR-0118):** `password-policy-violation` indica la regla en `newPassword`, y el enlace sigue sirviendo para corregirla. Restablecer quita `mustChangePassword`, verifica el email si no lo estaba y se audita.

### 9.10 `GET /v1/me` — Consultar la cuenta

- **Autenticación:** token de acceso (cliente o staff; permitido con `mustChangePassword`).
- **Response 200:** `Account`. `roles` lleva `id` y `name` de cada rol. Implementado en T-120 (ADR-0114).

### 9.11 `PATCH /v1/me` — Rectificar datos del cliente

- **Autenticación:** token de cliente.
- **Request:** `{ "firstNames": "…", "lastNames": "…" }` (ambos opcionales, 1–100 caracteres). El email se cambia con `POST /v1/me/email`.
- **Response 200:** `Account`. Se audita sin valores personales (ADR-0067). Implementado en T-121 (ADR-0117): no acepta `null`; si nada cambia, no se guarda ni se audita.

### 9.12 `POST /v1/me/password` — Cambiar contraseña (UC-IAM-09)

- **Autenticación:** token de acceso (cliente o staff; permitido con `mustChangePassword`).
- **Request:** `{ "currentPassword": "…", "newPassword": "…" }`. Para el cambio obligatorio del staff, `currentPassword` es la contraseña temporal (ADR-0056).
- **Validaciones:** `newPassword` según ADR-0047 y distinta de la actual.
- **Response 204.** Quita `mustChangePassword`. Revoca todas las demás sesiones del usuario y conserva la actual; envía un correo avisando del cambio (ADR-0072).
- **Errores:** 401 `invalid-credentials` si `currentPassword` no coincide; 400 `password-policy-violation`; 429 `rate-limit-exceeded` tras 5 contraseñas actuales incorrectas del usuario en 15 minutos, también con la correcta (ADR-0154). Las contraseñas nuevas que no cumplen la política no cuentan.
- **Implementado en T-120 (ADR-0115):**
  - `currentPassword` se comprueba antes que la política. Un 401 no cambia nada y se audita.
  - `password-policy-violation` lleva en `errors` una entrada en `newPassword` con `code` `passwordLength`, `passwordCharacters`, `commonPassword` o `samePassword`.
  - La sesión de la solicitud sigue funcionando con el mismo token de acceso, ya sin `mustChangePassword`.
  - El correo de aviso se envía después del cambio; si falla, la respuesta no cambia.

### 9.13 `POST /v1/me/email` — Cambiar email (UC-IAM-10)

- **Autenticación:** token de cliente. **Rate limit:** 3 por hora.
- **Request:** `{ "newEmail": "…", "currentPassword": "…" }`.
- **Response 200:** `Account` con `emailVerified: false`. Se envía verificación al nuevo email; el cliente no puede comprar hasta verificarlo (BR-USR-11).
- **Implementado en T-121 (ADR-0117):** el email anterior recibe el aviso "Tu correo cambió", sin la dirección nueva, y sus enlaces pendientes dejan de servir. El mismo email que ya se tiene responde 400 `validation-error` con `sameEmail`. El límite cuenta también los intentos con contraseña incorrecta, que se auditan.
- **Errores:** 401 `invalid-credentials`; 409 `duplicate-value` (`field: "email"`).

### 9.14 Direcciones (UC-IAM-11)

**`GET /v1/me/addresses`** — token de cliente. Response 200: `{ "data": [Address] }` (sin paginación: máximo 10). Orden: predeterminada primero, después `createdAt` descendente.

**`POST /v1/me/addresses`** — Request: `AddressInput` más `isDefault` (opcional, boolean). La primera dirección es predeterminada automáticamente. Response 201: `Address`. Errores: 409 `address-limit-reached`.

**`PATCH /v1/me/addresses/{addressId}`** — Request: campos de `AddressInput` e `isDefault`. Marcar `isDefault: true` desmarca la anterior. Si se cambia `stateCode`, `municipalityCode` es obligatorio. Response 200: `Address`.

**`DELETE /v1/me/addresses/{addressId}`** — Response 204. Si era la predeterminada, ninguna queda como predeterminada (ADR-0071).

Implementado en T-130 (ADR-0113):

- **Alta:** `POST` responde con `Location: /v1/me/addresses/{id}`. El máximo se configura con `MAX_ADDRESSES_PER_CUSTOMER` (10 por defecto), y 409 `address-limit-reached` lleva `limit`.
- **Cambios:** `isDefault: false` sobre la predeterminada deja al cliente sin predeterminada. En `PATCH`, los campos opcionales se borran con `null` y los obligatorios no lo aceptan.
- **Ubicación inválida:** 400 `validation-error` en el campo, con `code` `isState` (el estado no existe), `isMunicipalityOfState` o `isActiveMunicipality` (municipio retirado del catálogo). Una dirección que conserva su municipio lo mantiene aunque se haya retirado.
- **Validación en dos pasos:** primero los formatos del DTO y después el catálogo, así que un error de cada tipo llega en respuestas 400 sucesivas.
- **Recurso ajeno:** la dirección de otro cliente responde 404.

### 9.15 `GET /v1/admin/identity/permissions` — Catálogo de permisos

- **Permiso:** `staff.manage`. **Response 200:** `{ "data": [ { "code": "catalog.write", "description": "…" } ] }` (catálogo en código, ADR-0017).

### 9.16 Roles (UC-IAM-15)

La descripción de un rol tiene de 1 a 250 caracteres (`null` la borra). Un `PATCH` al rol superadministrador con `permissions` responde 400 `validation-error` en ese campo (ADR-0112). Crear un rol, o agregarle permisos, exige tener esos permisos; si no, 403 `forbidden`, auditado. Quitar permisos no tiene esa restricción (BR-USR-20, ADR-0154).

Representación `Role`: `{ "id", "name", "description", "isSuperadmin", "permissions": ["…"], "userCount", "version", "createdAt", "updatedAt" }`.

| Endpoint | Detalle |
|---|---|
| `GET /v1/admin/identity/roles` | Paginado. Filtros: `q` (nombre, hasta 100 caracteres). Orden: `name` (defecto), `createdAt` |
| `POST /v1/admin/identity/roles` | Request `{ "name", "description", "permissions": [] }`. `name` 1–50 caracteres, único; permisos del catálogo (BR-USR-04). 201 `Role`. Errores: 409 `duplicate-value` |
| `GET /v1/admin/identity/roles/{roleId}` | 200 `Role` |
| `PATCH /v1/admin/identity/roles/{roleId}` | Request `{ "name", "description", "permissions", "version" }` (`permissions` reemplaza el conjunto). El rol superadministrador no cambia sus permisos (siempre todos). 200 `Role`. Errores: 409 `duplicate-value` |
| `DELETE /v1/admin/identity/roles/{roleId}` | 204. Errores: 409 `resource-in-use` (tiene usuarios, BR-USR-07); 409 `last-superadmin` si es el rol superadministrador |

### 9.17 Staff (UC-IAM-13, 14, 16)

Representación `StaffUser`: `{ "id", "email", "firstNames", "lastNames", "status", "mustChangePassword", "roles": [{ "id", "name" }], "lastLoginAt", "version", "createdAt" }`.

| Endpoint | Detalle |
|---|---|
| `GET /v1/admin/identity/staff` | Paginado. Filtros: `q` (email o nombre, hasta 254 caracteres), `status`, `roleId`. Orden: `createdAt` (defecto `-createdAt`), `email` |
| `POST /v1/admin/identity/staff` | Request `{ "email", "firstNames", "lastNames", "roleIds": [] }`. Genera contraseña temporal de al menos 15 caracteres (BR-USR-13). 201 `{ "user": StaffUser, "temporaryPassword": "…" }`; la contraseña temporal se muestra solo en esta respuesta, con `Cache-Control: no-store`. Errores: 409 `duplicate-value` |
| `GET /v1/admin/identity/staff/{userId}` | 200 `StaffUser` |
| `PUT /v1/admin/identity/staff/{userId}/roles` | Request `{ "roleIds": [], "version" }` (reemplaza el conjunto; de 1 a 50 roles). 200 `StaffUser`. Errores: 409 `last-superadmin` |
| `POST /v1/admin/identity/staff/{userId}/suspend` | Request `{ "reason", "version" }`. Revoca sus sesiones. 200 `StaffUser`. Errores: 409 `last-superadmin`; 409 `invalid-state-transition` si no está ACTIVE; un staff no puede suspenderse a sí mismo (409 `invalid-state-transition`) |
| `POST /v1/admin/identity/staff/{userId}/reactivate` | Request `{ "reason", "version" }`. Desde SUSPENDED. Genera una contraseña temporal nueva (BR-USR-13) y marca `mustChangePassword`; conserva los roles (ADR-0076). 200 `{ "user": StaffUser, "temporaryPassword": "…" }`; la contraseña temporal se muestra solo en esta respuesta, con `Cache-Control: no-store`. Errores: 409 `invalid-state-transition` si no está SUSPENDED |

La contraseña temporal se entrega en la respuesta (ADR-0071): no hay invitación por correo (ADR-0043).

Nadie da lo que no tiene (BR-USR-20, ADR-0154): el alta, los roles que agrega un `PUT …/roles` y la reactivación exigen que quien actúa tenga todos los permisos de esos roles, y el rol superadministrador solo lo asigna otro superadministrador. La reactivación cuenta los roles que ya tiene el reactivado, porque quien reactiva recibe su contraseña temporal. Si no, 403 `forbidden`, auditado, sin cambios. Quitar roles y suspender no tienen esta restricción.

`reason` tiene de 1 a 500 caracteres y no puede estar en blanco. Se guarda en la auditoría (`audit_logs.reason`), así que no debe llevar datos personales (ADR-0112). Implementados en T-130: listado, detalle, `PUT …/roles` y `POST …/suspend`. En T-131 (ADR-0116):

- **Alta:** responde 201 con `Location: /v1/admin/identity/staff/{id}`. Nombres y apellidos tienen de 1 a 100 caracteres y no pueden estar en blanco. Un rol inexistente responde 400 `validation-error` con `code` `unknownRoles` en `roleIds`.
- **Reactivación:** la contraseña anterior deja de servir.
- **Contraseña temporal:** 20 caracteres en cinco grupos de cuatro separados por guiones (`k7qm-3xrt-9fzw-p4hd-2nvc`), sin caracteres que se confundan.
- **Email:** el staff se crea con `emailVerified: false`, sin efecto (la verificación es de clientes).

### 9.18 Clientes (UC-IAM-17, 18, 19)

`reason` sigue las mismas reglas que en §9.17. En `createdTo`, una fecha sola (`2026-09-30`) incluye todo el día.

Representación `AdminCustomer`: `{ "id", "email", "firstNames", "lastNames", "status", "emailVerified", "addresses": [Address], "createdAt", "lastLoginAt", "anonymizedAt", "version" }` (`addresses` solo en el detalle). Sus pedidos están en `GET /v1/admin/orders?customerId=…`, y `meta.totalItems` dice cuántos son: `orderCount` se quitó en T-180 parte b, porque Ordering usa a Identity y Identity no puede contar órdenes (ADR-0132, ADR-0133).

| Endpoint | Detalle |
|---|---|
| `GET /v1/admin/identity/customers` | `customers.read`. Paginado. Filtros: `q` (email, nombres o apellidos, hasta 254 caracteres), `status`, `emailVerified`, `createdFrom`, `createdTo`. Orden: `createdAt` (defecto `-createdAt`), `email`, `lastLoginAt` |
| `GET /v1/admin/identity/customers/{userId}` | `customers.read`. 200 `AdminCustomer` |
| `POST /v1/admin/identity/customers/{userId}/suspend` | `customers.manage`. Request `{ "reason", "version" }`. Revoca sesiones. 200. Errores: 409 `invalid-state-transition` |
| `POST /v1/admin/identity/customers/{userId}/reactivate` | `customers.manage`. Request `{ "reason", "version" }`. Desde SUSPENDED; conserva contraseña y verificación de email (ADR-0076). 200 `AdminCustomer`. Errores: 409 `invalid-state-transition` (no está SUSPENDED, incluido un cliente anonimizado) |
| `POST /v1/admin/identity/customers/{userId}/anonymize` | `customers.manage`. Request `{ "reason", "version" }` (`reason`: referencia de la solicitud ARCO, 1–250 caracteres). 200 `{ "userId", "anonymizedAt", "anonymizedOrderCount": 3 }` (ADR-0145). Irreversible. Errores, en este orden: 404 `not-found` si no es un cliente; 409 `version-conflict`; 409 `invalid-state-transition` si ya está anonimizado; 409 `active-orders-exist` |
| `POST /v1/admin/identity/guest-anonymizations` | `customers.manage`. Request `{ "contactEmail", "publicCode", "reason" }`. Anonimiza todas las órdenes de invitado con ese email (ADR-0067); las de una cuenta con el mismo email no cambian. 200 `{ "anonymizedOrderCount": 3 }`. Errores: 404 `not-found` si el par email–código no coincide, igual que la consulta de invitado, también una vez anonimizadas; 409 `active-orders-exist` |

Implementado en T-132 (ADR-0145):

- **Quién atiende:** el módulo `privacy`, porque la anonimización llega a las órdenes, los envíos y los carritos, e Identity no puede usar a Ordering (ADR-0132). Todo ocurre en una transacción.
- **Cliente:**
  - la cuenta queda sin email, nombres, apellidos, contraseña ni verificación de email, en ANONYMIZED, y su email queda libre para otra cuenta;
  - se borran sus sesiones, sus enlaces de verificación y de recuperación, sus direcciones y sus carritos;
  - el staff la sigue consultando en `GET /v1/admin/identity/customers/{userId}`.
- **Órdenes y envíos:** pierden el email de contacto y los datos de quien recibe (§8.2), y suman una versión. Los montos, líneas, estados y pagos no cambian. También se borran las respuestas guardadas por idempotencia de quien las colocó.
- **Orden concluida:** DELIVERED, EXPIRED, REFUNDED, CANCELLED sin pago, o SHIPPED con su envío RETURNED. Una CANCELLED con pago espera su reembolso.
- **Checkout simultáneo del mismo cliente:** se esperan. Si la orden se coloca primero, la anonimización responde 409 `active-orders-exist`; si la anonimización va primero, el checkout responde 404.
- **Auditoría:** `customers.anonymize` y un `orders.anonymize` por orden, con la referencia como motivo y sin los valores (BR-PRIV-04).

---

## 10. Endpoints — Catálogo geográfico (UC-IAM-22)

| Método | Ruta | Acceso | UC |
|---|---|---|---|
| GET | `/v1/geo/states` | Público | UC-IAM-22 |
| GET | `/v1/geo/states/{stateCode}/municipalities` | Público | UC-IAM-22 |

| Endpoint | Detalle |
|---|---|
| `GET /v1/geo/states` | Público. 200 `{ "data": [ { "code": "16", "name": "Michoacán de Ocampo" } ] }`. Sin paginación (32 registros). Orden por nombre |
| `GET /v1/geo/states/{stateCode}/municipalities` | Público. 200 `{ "data": [ { "code": "16053", "name": "Morelia" } ] }`. Solo municipios activos. Sin paginación. Orden por nombre. 404 si el estado no existe |

Datos de referencia; se pueden cachear con el TTL de ADR-0028 (ADR-0071). Implementados en T-124 (ADR-0109):

- Las respuestas se cachean durante `CACHE_TTL_SECONDS`. El catálogo se carga con un script en otro proceso, así que un catálogo nuevo se ve a más tardar en ese tiempo.
- Una clave de estado mal formada (por ejemplo, `ab`) también responde 404 `not-found`.

---

## 11. Endpoints — Catalog

### 11.1 Resumen

| Método | Ruta | Acceso | UC |
|---|---|---|---|
| GET | `/v1/catalog/products` | Público | UC-CAT-01 |
| GET | `/v1/catalog/products/{slug}` | Público | UC-CAT-02 |
| GET | `/v1/catalog/categories` | Público | UC-CAT-03 |
| GET | `/v1/catalog/brands` | Público | Filtro de marca (ADR-0060); llega con T-140 (ADR-0120) |
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
| `category` | slug | Categoría visible (activa y con todos sus ancestros activos, ADR-0080); incluye sus subcategorías visibles |
| `brand` | slugs separados por coma | Hasta 20; solo marcas activas (ADR-0080) |
| `minPrice`, `maxPrice` | enteros (centavos, IVA incluido) | ≥ 0; `minPrice ≤ maxPrice` |
| `available` | boolean | `true` = solo disponibles |
| `sort` | `relevance`, `-publishedAt`, `price`, `-price`, `title`, `-title` | `relevance` solo con `q`. Defecto: `relevance` con `q`, `-publishedAt` sin `q` |
| `page`, `pageSize` | — | Sección 5.1 |

- **Response 200:** página de `ProductSummary`. Solo productos publicados con al menos una variante vendible (BR-PRD-06).
- **Errores:** 400 `validation-error` si `category` no existe o está oculta, o si alguna `brand` no existe o está inactiva (ADR-0080). Los productos de categorías ocultas o marcas inactivas siguen apareciendo en los demás listados.
- **Cache:** solo sin `q` (ADR-0060), TTL de 120 s.
- **Implementado en T-140 parte c (ADR-0129):**
  - **Búsqueda:** cada palabra de `q` cuenta como inicio de palabra y todas son obligatorias. Un `q` sin letras ni dígitos, o hecho solo de palabras vacías ("de"), responde una página vacía.
  - **Errores 400 `validation-error`:**
    - `unknownCategory` en `category` y `unknownBrands` en `brand`, iguales para lo que no existe y lo oculto o inactivo;
    - `relevanceNeedsQ` en `sort` sin `q`;
    - `priceRange` en `maxPrice` menor que `minPrice`.
  - **`sort`:** acepta un solo valor de los seis.
  - **Filtros:** `brand` ignora los slugs repetidos, el rango de precio incluye sus extremos y `available=false` no filtra.
  - **Orden:** `title` ordena como en español (la ñ después de la n). El ID desempata en todos los órdenes.
  - **Cache:** la clave sale de los parámetros ya validados, así que `brand=a,b` y `brand=b,a` comparten entrada. Los errores no se cachean.

### 11.3 `GET /v1/catalog/products/{slug}` — Detalle (UC-CAT-02)

- **Response 200:** `ProductDetail`. 404 si no existe, no está publicado o no tiene variantes vendibles. Cache con TTL de 120 s.
- **Implementado en T-140 parte c (ADR-0129):** un slug con formato inválido responde 404 sin consultarse. Los 404 no se cachean.

### 11.4 `GET /v1/catalog/categories` — Árbol de categorías (UC-CAT-03)

- **Response 200:** `{ "data": [ { "id", "name", "slug", "position", "children": [ … ] } ] }`. Solo categorías visibles (activas y con todos sus ancestros activos, ADR-0080), ordenadas por `position` y nombre. Sin paginación. Cache con TTL de 120 s.
- **Implementado en T-150 (ADR-0120):** cada nodo lleva solo `id`, `name`, `slug`, `position` y `children`. El nombre se ordena como en español (la ñ después de la n, sin distinguir mayúsculas ni acentos) y el empate, por ID. Los cambios del staff se ven al vencer el TTL.

### 11.5 `GET /v1/catalog/brands` — Marcas

- **Response 200:** `{ "data": [ { "id", "name", "slug" } ] }`. Marcas activas con al menos un producto visible. Sin paginación. Orden por nombre.
- **Implementado en T-140 parte c (ADR-0129):** un producto es visible si está publicado y tiene una variante vendible. El nombre se ordena como en español. Cache con TTL de 120 s, que se vacía con los eventos de Catalog.

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

- `storeVisibility` (ADR-0016, UC-CAT-14): `VISIBLE`, `HIDDEN_NO_PRICE` (publicado sin variantes vendibles: ninguna activa con precio vigente), `NOT_PUBLISHED` (borrador o archivado). No se ofrece como filtro, porque filtrar por él requeriría extender la excepción de ADR-0060. Se calcula con el servicio de consultas de la tienda y la misma definición de variante vendible, no con la fachada de Pricing, que formaría un ciclo (ADR-0125, ADR-0129).
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

Implementado en T-140 parte a (ADR-0123):

- **`storeVisibility`:** llegó con T-140 parte c (ADR-0129) y lo llevan todas las respuestas `AdminProduct`.
- **Slug:** sin él, se genera del título y se numera si ya existe (`camisa-lino-2`); un slug enviado y repetido responde 409 `duplicate-value`.
- **Marca y categorías:** una nueva debe estar activa. Si no, 400 `validation-error` con `unknownBrand` o `inactiveBrand` en `brandId`, o con `unknownCategories` o `inactiveCategories` en `categoryIds`. Una que el producto ya tenía se conserva aunque se haya desactivado. Hasta 10 categorías; `null` en `brandId` quita la marca.
- **Publicar sin variante activa:** 409 `invalid-state-transition` con `reason: no-active-variant`.
- **Producto archivado:** no se edita ni cambia sus variantes: 409 `invalid-state-transition` con `currentStatus: ARCHIVED`.
- **Campos fijos:** `field-locked` lleva `fields` (`slug`, `sku`, `options`).
- **Listado:** no incluye `description`; `q` busca en el título y en los SKU; con `sort=publishedAt`, los nunca publicados van al final.
- **Alta:** responde 201 con `Location: /v1/admin/catalog/products/{id}`.
- **Auditoría:** cada cambio se audita (`products.*`); uno sin efecto no se guarda ni se audita.

### 11.7 Variantes (UC-CAT-06 a 08)

| Endpoint | Detalle |
|---|---|
| `POST …/products/{productId}/variants` | `catalog.write`. Request `{ "sku", "options": {}, "weightGrams", "lengthCm", "widthCm", "heightCm", "version" }` (`version` del producto). `sku` 1–64 caracteres, letras, dígitos, `-`, `_` y `.`, se normaliza a mayúsculas, único y nunca reutilizado (BR-PRD-09); `options`: hasta 3 atributos, nombres 1–30 y valores 1–50 caracteres; mismas claves que las demás variantes del producto; combinación única (BR-PRD-02). Peso en gramos (entero > 0) y dimensiones en cm (> 0, un decimal), opcionales (ADR-0058). No se agregan dimensiones de opciones a un producto con `firstPublishedAt` (ADR-0068). 201 `AdminProduct` con la variante. Errores: 409 `duplicate-value` (`sku` u `options`); 409 `field-locked` |
| `PATCH …/variants/{variantId}` | `catalog.write`. Request: `sku`, `options`, `weightGrams`, `lengthCm`, `widthCm`, `heightCm`, `version` (del producto). `sku` y `options` solo si el producto no tiene `firstPublishedAt`; al corregir el SKU, el anterior se libera (ADR-0068). 200 `AdminProduct`. Errores: 409 `field-locked`; 409 `duplicate-value` |
| `POST …/variants/{variantId}/discontinue` | `catalog.write`. Request `{ "version" }`. Invalida cache. 200 `AdminProduct`. Errores: 409 `invalid-state-transition` |
| `POST …/variants/{variantId}/reactivate` | `catalog.write`. Request `{ "version" }` (del producto). De DISCONTINUED a ACTIVE; SKU y opciones no cambian (ADR-0076). 200 `AdminProduct`. Errores: 409 `invalid-state-transition`; 409 `duplicate-value` (`options`) si otra variante activa tiene la misma combinación |

La cantidad máxima de atributos y las longitudes se fijan en ADR-0071.

Implementado en T-140 parte a (ADR-0123):

- **Nombres de opción:** se guardan sin espacios alrededor y en minúsculas (`Talla` → `talla`); los valores, solo sin espacios alrededor.
- **Mismos nombres en todas las variantes:** si no coinciden, 400 `validation-error` con `optionNames` en `options`; después de la primera publicación, 409 `field-locked`. La única variante de un producto sin publicar puede cambiarlos.
- **Medidas:** `lengthCm`, `widthCm` y `heightCm` con un decimal; `null` en el `PATCH` borra un valor.
- **Variante de otro producto:** 404.
- **Descontinuar:** publica `VariantDiscontinued`, que vacía la cache pública.

### 11.8 Imágenes (UC-CAT-11, ADR-0024)

| Endpoint | Detalle |
|---|---|
| `POST …/products/{productId}/images` | `catalog.write`. `multipart/form-data` con `file` (obligatorio) y campos `altText` (0–200) y `variantId` (opcional, variante del mismo producto). Tipo validado por contenido: JPEG, PNG o WebP; máximo 5 MB, rechazado antes de leer el archivo completo. Se agrega al final. 201 `Image`. Errores: 413 `payload-too-large`; 415 `unsupported-media-type` |
| `PATCH …/images/{imageId}` | `catalog.write`. Request `{ "altText", "variantId" }`. 200 `Image` |
| `PUT …/images/order` | `catalog.write`. Request `{ "imageIds": [] }` con todas las imágenes del producto en el nuevo orden. 200 `{ "data": [Image] }`. Errores: 400 si falta o sobra alguna |
| `DELETE …/images/{imageId}` | `catalog.write`. Borra registro y archivo (ADR-0038). 204 |

Los cambios de imágenes no exigen `version` del producto (ADR-0071): no alteran reglas del aggregate más allá del orden.

Base implementada en T-141 (ADR-0121); los endpoints llegan con T-140:

- **Formato:** se reconoce por los primeros bytes; el nombre del archivo y su tipo declarado se ignoran. Cualquier otro contenido, incluidos SVG, GIF o un archivo vacío, responde 415 `unsupported-media-type`.
- **Tamaño:** la subida se corta al pasar `IMAGE_MAX_BYTES` (5 MB por defecto) y responde 413 `payload-too-large`.
- **Campos:** un solo archivo, en el campo `file`. Sin él, 400 `validation-error` con `isDefined` en `file`; con dos archivos o en otro campo, 400.
- **Nombre en disco:** lo elige el servidor: `products/<productId>/<imageId>.<jpg|png|webp>`.
- **Servidas en `/media/<clave>`:** fuera de `/v1`, públicas y con `Cache-Control: public, max-age=31536000, immutable`, porque una clave nunca cambia de contenido. Una clave inexistente responde 404 `not-found`.

Implementado en T-140 parte b (ADR-0124):

- **Límite:** hasta 20 imágenes por producto; la siguiente responde 409 `image-limit-reached` con `limit`.
- **Tamaño:** el 413 lleva `maxBytes`, también cuando la subida se corta antes de leer el archivo.
- **Posiciones:** consecutivas desde 1. Una imagen nueva va al final, y borrar una renumera las demás.
- **Validación:**
  - `variantId` debe ser de una variante del mismo producto (400 `unknownVariant`);
  - un reorden trae cada imagen una vez (400 `imageOrder` en `imageIds`);
  - `altText` vacío se guarda como `null`, y en el `PATCH` `null` lo quita.
- **Producto archivado:** no cambia sus imágenes: 409 `invalid-state-transition`.
- **Respuestas:** `POST` responde con `Location: /v1/admin/catalog/products/{productId}/images/{imageId}`, que identifica la imagen para `PATCH` y `DELETE`; no tiene `GET`, porque la imagen viene en el detalle del producto. Cada cambio actualiza `updatedAt` del producto, no su `version`.
- **Auditoría:** `products.image-add`, `image-update`, `image-reorder` e `image-delete`.

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

Implementado en T-150 (ADR-0120):

- **Campos:** `name` de 1 a 100 caracteres, sin quedar en blanco; `slug` de 1 a 100, con minúsculas, dígitos y guiones sencillos entre ellos; `position` entero de 0 a 10 000, 0 por defecto. En `PATCH`, `parentId: null` mueve la categoría a la raíz.
- **Slug generado:** sin `slug`, se genera del nombre (`Camisas de Vestir` → `camisas-de-vestir`) y, si ya existe, se numera con el primer número libre (`camisas-2`). Un `slug` enviado que ya existe responde 409 `duplicate-value` con `field: slug`. Un nombre sin letras ni dígitos y sin `slug` responde 400 `validation-error` con `slugRequired` en `slug`.
- **Nombre repetido:** 409 `duplicate-value` con `field: name`, sin distinguir mayúsculas: entre categorías hermanas (también entre raíces) y entre todas las marcas.
- **Padre:** al crear o mover, uno inexistente o inactivo responde 400 `validation-error` con `unknownParent` o `inactiveParent` en `parentId`.
- **Conflictos de estado:** 409 `invalid-state-transition` con `currentStatus`. Mover bajo sí misma o bajo una subcategoría lleva `reason: category-cycle`; reactivar bajo un padre inactivo, `reason: inactive-parent`. Dos movimientos simultáneos se ordenan, así que nunca forman un ciclo.
- **Árbol administrativo:** con `status` (uno o más, separados por comas) incluye las categorías de esos estados y los ancestros que llevan a ellas, cada uno con su estado. `productCount` cuenta productos en cualquier estado; `childCount`, subcategorías directas.
- **Respuestas:** el alta responde 201 con `Location: /v1/admin/catalog/categories/{id}` (o `…/brands/{id}`); editar, desactivar y reactivar responden 200 con `AdminCategory` o `AdminBrand`. Un ID que no es UUID responde 404.
- **Marcas:** `q` busca parte del nombre sin distinguir mayúsculas; `status` acepta uno o más estados; `sort` solo `name` o `-name`.
- **Auditoría:** cada cambio se audita con los campos que cambiaron (`categories.*` y `brands.*`); un `PATCH` sin cambios no se guarda ni se audita.

---

## 12. Endpoints — Pricing

| Método | Ruta | Permiso | UC |
|---|---|---|---|
| GET | `/v1/admin/pricing/price-lists` | `pricing.read` | UC-PRC-01 |
| GET | `/v1/admin/pricing/price-lists/{priceListId}/variants/{variantId}/periods` | `pricing.read` | UC-PRC-01 |
| POST | `/v1/admin/pricing/price-lists/{priceListId}/variants/{variantId}/periods` | `pricing.write` | UC-PRC-02, 03 |
| DELETE | `/v1/admin/pricing/price-lists/{priceListId}/variants/{variantId}/periods/{periodId}` | `pricing.write` | UC-PRC-04 |
| POST | `/v1/admin/pricing/price-lists/{priceListId}/imports` | `pricing.write` | UC-PRC-05 |

En el MVP existe solo la lista predeterminada (ADR-0039); no hay endpoints para crear o editar listas. La crea una migración: código `GENERAL`, "Lista general" y prioridad 0 (ADR-0125).

**`GET …/price-lists`** — 200 `{ "data": [ { "id", "code", "name", "currency", "priority", "isDefault", "taxesIncluded", "status" } ] }`.

**`GET …/variants/{variantId}/periods`** — 200 `{ "data": [PricePeriod], "current": PricePeriod | null }`, con `PricePeriod { id, amount: Money, compareAtAmount: Money | null, effectiveFrom, effectiveTo, state: "PAST" | "CURRENT" | "SCHEDULED", createdBy, createdAt }`. Orden `-effectiveFrom`. Sin paginación. Filtro `state`, con uno o más estados separados por comas. `current` es siempre el periodo vigente, aunque el filtro lo deje fuera de `data`.

**`POST …/variants/{variantId}/periods`** — Establece o programa un precio.

- Request: `{ "amount": 59900, "compareAtAmount": 79900, "effectiveFrom": "2026-10-01T06:00:00.000Z" }`.
- `amount` entero ≥ 0 en centavos; `compareAtAmount` opcional y mayor que `amount`; `effectiveFrom` opcional: ausente o no posterior al momento actual = precio inmediato (cierra el periodo vigente, UC-PRC-02); futuro = programado (UC-PRC-03). `effectiveTo` no se envía: un periodo termina cuando empieza el siguiente.
- `effectiveFrom` lleva fecha, hora y zona horaria (`Z` u `±hh:mm`).
- **Línea de periodos (ADR-0125):** un periodo nuevo cierra en su inicio el periodo en el que cae, vigente o programado, y termina donde empieza el siguiente. Así se puede programar entre otros precios, por ejemplo una oferta de varios días.
- La variante debe existir en Catalog (fachada), en cualquier estado.
- Response 201: `PricePeriod`. No abren un periodo, y responden 200 con el existente:
  - un precio inmediato igual al vigente (mismo monto y mismo precio de comparación);
  - un precio programado idéntico al que ya existe en el mismo instante (ADR-0126).
- Errores:
  - 409 `price-period-conflict` con `reason: overlap` si otro periodo, con otro precio, empieza en el mismo instante (BR-PRC-01);
  - 400 `validation-error` con `compareAtAmount` en `compareAtAmount` si el precio de comparación no es mayor que el monto.

**`DELETE …/periods/{periodId}`** — Cancela un precio programado. 204; el periodo anterior vuelve a durar hasta el siguiente (ADR-0125). Errores: 409 `price-period-conflict` con `reason: already-started` si ya inició (BR-PRC-04); 404 si el periodo no es de esa variante en esa lista.

**`POST …/imports`** — Carga masiva (UC-PRC-05, ADR-0126). Recibe `multipart/form-data` con el archivo en `file`. Con `?dryRun=true` revisa todo y responde sin guardar nada.

- **Archivo:** CSV en UTF-8 (con o sin BOM), separado por comas y con encabezado; hasta 5,000 filas y 1 MB. Columnas `sku`, `amount`, `compareAtAmount` y `effectiveFrom`, cada una una vez, en cualquier orden y sin distinguir mayúsculas.

  ```
  sku,amount,compareAtAmount,effectiveFrom
  CAM-LINO-M,599.00,799.00,
  CAM-LINO-M,499.00,799.00,2026-11-14 00:00
  GORRA-AZUL,199,,
  ```

- **Valores:**
  - `sku`: de una variante existente, sin distinguir mayúsculas;
  - `amount` y `compareAtAmount` (opcional): pesos con punto decimal y hasta 2 decimales, sin `$` ni separador de miles;
  - `effectiveFrom`: vacía (desde ahora), fecha y hora en hora de México (`2026-11-14 00:00`) o ISO 8601 con zona.
- **Reglas:**
  - cada fila es un `POST …/periods`, y las filas "desde ahora" empiezan en el instante de la carga;
  - un SKU puede repetirse con inicios distintos, pero el mismo SKU con el mismo inicio es error de la fila;
  - una fila igual al precio vigente, o a uno ya programado en el mismo instante, cuenta como sin cambio.
- **Todo o nada:** con cualquier error no se importa nada. Responde 400 `validation-error` con los primeros 100 errores ordenados por línea, en `rows[<línea>].<columna>`; el encabezado es la línea 1, y `rows[<línea>]` sola indica que faltan o sobran valores.
  - Códigos de fila: `isNotEmpty`, `unknownSku`, `pesos`, `compareAtAmount`, `dateTime`, `repeatedStart`, `overlap` y `columnCount`.
  - Errores del archivo, en `file`: `isDefined`, `utf8`, `csv`, `columns`, `emptyFile` y `tooManyRows`.
- **Response 200:** `{ "rows": 3, "created": 3, "unchanged": 0, "dryRun": false }`.
- **Errores:** 413 `payload-too-large` con `maxBytes` para un archivo de más de 1 MB; 404 si la lista no existe.
- **Auditoría:** una entrada `prices.import` con los conteos. Una carga que no crea periodos no se audita.

Implementado en T-145 (ADR-0125, ADR-0126):

- **No encontrado:** una lista, variante o periodo inexistentes responden 404, también si el ID no es un UUID.
- **Cambios simultáneos:** dos cambios de una variante se aplican uno tras otro.
- **Auditoría:** `prices.set`, `prices.schedule` y `prices.cancel`.

---

## 13. Endpoints — Inventory

| Método | Ruta | Permiso | UC |
|---|---|---|---|
| GET | `/v1/admin/inventory/warehouses` | `inventory.read` | UC-INV-01 |
| POST | `/v1/admin/inventory/warehouses` | `inventory.write` | UC-INV-10 |
| PATCH | `/v1/admin/inventory/warehouses/{warehouseId}` | `inventory.write` | UC-INV-01 |
| POST | `/v1/admin/inventory/warehouses/{warehouseId}/deactivate` | `inventory.write` | UC-INV-11 |
| GET | `/v1/admin/inventory/stock-items` | `inventory.read` | UC-INV-04 |
| GET | `/v1/admin/inventory/stock-items/{stockItemId}/movements` | `inventory.read` | UC-INV-04 |
| POST | `/v1/admin/inventory/receipts` | `inventory.write` | UC-INV-02 |
| POST | `/v1/admin/inventory/adjustments` | `inventory.write` | UC-INV-03 |

El reintegro de stock de una orden (UC-INV-09) está en la sección 15.7: lo atiende Ordering, que conoce la orden y sus líneas (P-73, ADR-0132).

**Almacenes.** `Warehouse { id, code, name, address: Address | null, status, priority, createdAt, updatedAt }`. `priority` va de 1 a 1000 (1 es la primera): cada orden se reserva completa en el primer almacén activo que la tiene toda; si empatan, por `code` (ADR-0160). `GET` devuelve `{ "data": [Warehouse] }` sin paginación, por prioridad y luego por código, y `PATCH` acepta `{ "name", "address", "priority" }`. En entradas, `warehouseId` debe ser un almacén activo; en ajustes, cualquier almacén, también uno inactivo; otro valor → 404.

**`POST …/warehouses`** (UC-INV-10, ADR-0160) — Request `{ "code", "name", "address", "priority" }`: `code` de 2 a 20 mayúsculas, dígitos y guiones, único; `name` de 1 a 100 caracteres; `address` opcional en formato `AddressInput`; `priority` de 1 a 1000, obligatoria. 201 `Warehouse`, activo, con `Location`. Errores: 409 `duplicate-value` (`code`). Se audita como `warehouses.create`.

**`POST …/warehouses/{warehouseId}/deactivate`** (UC-INV-11, ADR-0076, ADR-0160) — Sin cuerpo. Para siempre: el almacén deja de vender, reservar y recibir mercancía, y conserva su stock. 200 `Warehouse`. Errores: 404; 409 `resource-in-use` si tiene unidades reservadas; 409 `invalid-state-transition` si ya está inactivo, o si es el último activo, con `reason: last-active-warehouse`. Se audita como `warehouses.deactivate`.

**`GET …/stock-items`** — Paginado. `StockItem { id, variantId, sku, productTitle, warehouseId, onHand, reserved, available, updatedAt }` (`available = onHand − reserved`). Filtros: `variantId`, `sku` (hasta 64 caracteres), `warehouseId`, `q` (SKU o título, hasta 100 caracteres), `availableMax` (entero de 0 a 2,147,483,647, para detectar existencias bajas). Orden: `sku` (defecto), `available`, `updatedAt`.

**`GET …/stock-items/{stockItemId}/movements`** — Paginación por cursor. `StockMovement { id, type, quantity, onHandAfter, reasonCode, note, orderId, orderLineId, actorId, createdAt }`. Filtros: `type`, `from`, `to`. Orden fijo: más reciente primero.

**`POST …/receipts`** — Entrada de mercancía.

- Request: `{ "variantId", "warehouseId", "quantity": 25, "note": "Remisión 1234" }`.
- `quantity` entero de 1 a 100,000 (tope de ADR-0071); `note` 0–500. Crea el stock item si no existe.
- 201 `{ "stockItem": StockItem, "movement": StockMovement }`.

**`POST …/adjustments`** — Ajuste (ADR-0069).

- Request: `{ "variantId", "warehouseId", "quantity": -2, "reasonCode": "DAMAGED", "note": "…" }`.
- `quantity` entero distinto de 0 con signo; `reasonCode` del catálogo de ajustes; DAMAGED, LOSS_OR_THEFT e INTERNAL_USE solo con cantidad negativa; `note` obligatoria con OTHER. WAREHOUSE_TRANSFER mueve unidades entre almacenes: un ajuste negativo en uno y uno positivo en el otro (ADR-0160).
- 201 `{ "stockItem", "movement" }`.
- Errores: 409 `insufficient-stock` si dejaría `onHand` por debajo de `reserved` o de cero (BR-INV-01).

Implementado en T-160 parte a (ADR-0127), salvo los reintegros (T-161, sección 15.7):

- **Almacén:**
  - lo crea una migración: "Almacén principal", código `PRINCIPAL`, sin dirección;
  - `PATCH` cambia solo lo enviado: `name` de 1 a 100 caracteres y `address` en formato `AddressInput` (§8.2), validada contra el catálogo del INEGI; `null` la quita;
  - la respuesta lleva `Address` con los nombres del estado y del municipio;
  - sin `version`.
- **Listado de stock:**
  - muestra las variantes que ya tuvieron una entrada o un ajuste;
  - `sku` es exacto y `q` busca parte del SKU o del título, ambos sin distinguir mayúsculas;
  - `sort` acepta `sku`, `available` y `updatedAt`, con `-` y combinados;
  - SKU y título salen de Catalog en cada página.
- **Movimientos:** `type` acepta uno o más tipos separados por comas. `from` y `to` aceptan fecha o fecha y hora ISO 8601, ambos incluidos; una fecha sola en `to` incluye todo el día.
- **Entradas y ajustes:**
  - la variante debe existir, en cualquier estado; si no, 404. `warehouseId` debe ser un almacén activo en una entrada, y uno existente en un ajuste (ADR-0160); si no, 404;
  - un ajuste lleva de ±1 a ±100,000 unidades;
  - errores en el ajuste: 400 `validation-error` con `reasonDirection` en `quantity` si el motivo solo resta y la cantidad suma, e `isNotEmpty` en `note` con `OTHER` sin nota;
  - el 409 `insufficient-stock` lleva `lines: [{ variantId, canFulfill: false }]`;
  - las notas se guardan sin espacios alrededor.
- **Auditoría:** `inventory.receipt`, `inventory.adjustment`, `warehouses.update`, y desde T-162 `warehouses.create` y `warehouses.deactivate`.

UC-INV-05 a 08 no tienen API: los ejecutan el checkout, los eventos y los jobs.

Implementado en T-160 parte b (ADR-0128): la fachada `InventoryFacade` reserva todo o nada (`reserve`), confirma (`commit`) y libera (`release`) por orden, y responde por línea si una cantidad puede surtirse (`canFulfill`), sin revelar existencias. Desde T-162 parte a (ADR-0160), `reserve` usa un solo almacén por orden, el primero por prioridad que la tiene toda; `canFulfillTogether` responde si cada línea cabe junto con las demás, y `allocationOf` da los almacenes de la reserva confirmada. Una reserva dura `RESERVATION_TTL` (20 minutos por defecto). Se puede confirmar mientras esté activa, hasta que el job de T-230 la venza.

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
| POST | `/v1/me/orders/{publicCode}/reorder` | Solo cliente | UC-CRT-09 (14.3) |
| POST | `/v1/orders/reorder` | Público | UC-CRT-09 (14.3) |
| POST | `/v1/admin/orders/{orderId}/reorder` | `orders.manage` | UC-CRT-09 (14.3) |

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

Implementado en T-170 (ADR-0131):

- **Staff:** un token de staff también responde 403 `staff-cannot-purchase` al crear un carrito de invitado o cambiar sus líneas; leerlo sí se puede.
- **Variante no vendible:** 409 `variant-not-sellable` con `variantIds`, igual para una que no existe, una sin publicar o archivada, una descontinuada o una sin precio. Cambiar la cantidad de una línea que dejó de ser vendible también responde 409; quitarla siempre se puede.
- **Cantidades:** si una suma deja la línea con más de 30 unidades, responde 400 `validation-error` con `lineQuantity` en `quantity`. Un carrito tiene como máximo 100 variantes distintas; la siguiente responde 409 `cart-line-limit-reached` con `limit`.
- **Quitar:** quitar una línea que no está no cambia nada y responde el carrito.
- **Línea:** lleva la primera imagen de su variante o, si no tiene, la primera imagen general del producto. Las líneas van de la más antigua a la más nueva; `itemCount` cuenta las unidades de todas, y `subtotal`, solo las vendibles.
- **Carrito sin activo:** `GET /v1/me/cart` sin carrito activo responde `status: ACTIVE` y `lastActivityAt: null`. Solo los cambios actualizan `lastActivityAt`.
- **Fusión:** si el carrito ya se fusionó o se adoptó en la misma cuenta, responde 200 con el carrito actual sin volver a sumar.

### 14.3 Recompra de órdenes canceladas (UC-CRT-09, ADR-0055)

| Endpoint | Acceso | Detalle |
|---|---|---|
| `POST /v1/me/orders/{publicCode}/reorder` | Solo cliente | Copia las líneas a su carrito activo (lo crea si no existe). 200 `{ "cartId", "skippedVariantIds": [] }` (ADR-0139) |
| `POST /v1/orders/reorder` | Público | Request `{ "contactEmail", "publicCode", "cartId" }` (`cartId` opcional: carrito de invitado activo destino; si falta, se crea uno). 200 `{ "cartId", "skippedVariantIds" }` (ADR-0139). Rate limit de 10 por IP en 15 minutos |
| `POST /v1/admin/orders/{orderId}/reorder` | `orders.manage` | Cliente registrado: a su carrito activo. Invitado: se reactiva el carrito original de la orden (ADR-0054); si ya no existe, 409 `source-cart-unavailable` y no se crea otro (ADR-0082). 200 `{ "cartId", "skippedVariantIds" }`. Auditado |

Reglas comunes: solo órdenes CANCELLED o REFUNDED (409 `invalid-state-transition` en otro caso); suma con tope de 30; `skippedVariantIds` lista variantes no vendibles omitidas; la orden no cambia. Para invitados, 404 genérico si el par email–código no coincide.

Implementado en T-181 parte b (ADR-0139):

- **Respuesta:** las tres rutas responden `{ cartId, skippedVariantIds }`; el carrito se lee con `GET /v1/me/cart` o `GET /v1/carts/{cartId}`, con precios y disponibilidad actuales.
- **Lo que se copia:** solo variantes publicadas, activas y con precio; el carrito puede pasar de 100 líneas, como en la fusión. Repetir la recompra vuelve a sumar con el tope, sin `Idempotency-Key`.
- **Cliente:** otra orden que no sea suya responde 404; una cuenta de staff, 403 `staff-cannot-purchase`.
- **Invitado:** el mismo 404 de la consulta (§15.5). Un `cartId` que no existe o tiene dueño responde 404, y uno que no está activo, 409 `cart-not-active`. Una cuenta de staff recibe 403 `staff-cannot-purchase`.
- **Staff:**
  - la orden de un cliente va a su carrito activo, o a uno nuevo;
  - la de un invitado, a su carrito original: si sigue CHECKED_OUT vuelve a ACTIVE solo con las líneas que se siguen vendiendo, y si ya está ACTIVE se le suman;
  - un carrito original que no existe, tiene dueño o quedó MERGED responde 409 `source-cart-unavailable`;
  - se audita `orders.reorder`.
- **Orden de las validaciones:** la orden (404), su estado (409) y el carrito (404 o 409).

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
| POST | `/v1/orders/access-links` | Público | UC-ORD-05 |
| POST | `/v1/orders/access` | Público | UC-ORD-05 |
| GET | `/v1/admin/orders` | `orders.read` | UC-ORD-06 |
| GET | `/v1/admin/orders/{orderId}` | `orders.read` | UC-ORD-06 |
| POST | `/v1/admin/orders/{orderId}/cancel` | `orders.manage` (+ `inventory.write` con reintegro) | UC-ORD-07 |
| POST | `/v1/admin/orders/{orderId}/retry-fulfillment` | `orders.manage` | UC-ORD-08 |
| POST | `/v1/admin/orders/{orderId}/restocks` | `inventory.write` + `Idempotency-Key` | UC-INV-09 (ADR-0132, ADR-0142) |
| POST | `/v1/admin/orders/{orderId}/manual-capture` | `payments.manage` | UC-PAY-02 (ADR-0134) |
| POST | `/v1/admin/orders/{orderId}/blocked-data` | `orders.read-blocked` | UC-ORD-11 (ADR-0152) |

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
- **Rate limit:** 10 por usuario o carrito en 10 minutos; en `POST /v1/orders`, además, 5 por email de contacto por hora (ADR-0154).

### 15.4 Consultas del cliente (UC-ORD-03)

- **`GET /v1/me/orders`** — Paginado. Filtros: `status`, `placedFrom`, `placedTo`. Orden: `placedAt` (defecto `-placedAt`), `grandTotal`. Response: página de `Order` sin `lines` ni `shippingAddress` (resumen con `itemCount`).
- **`GET /v1/me/orders/{publicCode}`** — 200 `Order`. 404 si no existe o es de otro cliente.

Implementado en T-180 parte a (ADR-0132):

- **Cotización:** las líneas no vendibles se marcan y no suman (§8.7). Un cliente sin carrito activo recibe 409 `empty-cart`, y el staff, 403 `staff-cannot-purchase` en las dos rutas.
- **Orden de las validaciones al colocar:**
  1. cuenta de staff (403);
  2. email sin verificar (403);
  3. carrito (404, 409 `cart-not-active` o 409 `empty-cart`);
  4. dirección (404 si la guardada no es del cliente);
  5. líneas no vendibles (409, con todas);
  6. total (409 `total-mismatch`);
  7. stock (409 `insufficient-stock`).
- **Dirección:** sin `addressId` ni `shippingAddress`, o con los dos, 400 `validation-error` con `exactlyOneAddress` en `addressId`. La dirección escrita se valida contra el catálogo del INEGI: 400 `validation-error` en `shippingAddress.stateCode` o `shippingAddress.municipalityCode`.
- **Invitado con sesión:** un cliente con sesión puede usar `/v1/orders` con un carrito de invitado, y la orden queda como de invitado.
- **Respuesta:** `Order` sin `id` ni `orderNumber`, con `contactEmail` en minúsculas, `paymentDueAt` igual al vencimiento de la reserva, y `payment` y `shipment` en `null`: el pago se inicia después, y el envío nace con la orden pagada (ADR-0140).
- **Mis pedidos:** el staff recibe 403 `forbidden`. El orden predeterminado es `-placedAt`, con desempate por ID. Un código que no puede existir responde 404.
- **Parte b:** la administración (§15.7) y UC-ORD-09 se implementaron en ADR-0133.

### 15.5 Consulta de pedido de invitado (UC-ORD-04, ADR-0020)

- **`POST /v1/orders/lookup`** — Request `{ "contactEmail", "publicCode" }`. Los datos van en el cuerpo, no en la URL, para no dejarlos en logs ni historiales (ADR-0071).
- Response 200: `Order`. Solo órdenes de invitado; una orden de cliente registrado se consulta en `/v1/me/orders`.
- Errores: 404 `not-found` idéntico si la orden no existe, el email no coincide o la orden pertenece a una cuenta (BR-ORD-11).
- Rate limit obligatorio: 10 por IP en 15 minutos.
- **Implementado en T-185 (ADR-0138):**
  - el email no distingue mayúsculas, minúsculas ni espacios alrededor, y el código acepta minúsculas y la falta de guion;
  - un código que no puede existir también responde el mismo 404, que no lleva el email ni el código;
  - 400 `validation-error` solo por campos faltantes, un email mal formado o un código vacío, de otro tipo o de más de 100 caracteres;
  - una cuenta de staff puede consultar, pero no colocar ni pagar una orden de invitado;
  - cada consulta gasta el límite, encuentre o no la orden.

### 15.6 Enlace de acceso por correo (UC-ORD-05, ADR-0148)

Para el invitado que perdió el código de su pedido (ADR-0077). Implementado en T-186.

**`POST /v1/orders/access-links`** — Request `{ "contactEmail" }`, en el cuerpo (ADR-0071).

- Response 202 sin cuerpo, siempre, en cuanto se recibe la solicitud: el enlace se emite y se envía después (§2.5). Ni la respuesta ni su tiempo dicen si el email tiene órdenes.
- Solo se envía si el email, sin distinguir mayúsculas, minúsculas ni espacios alrededor, tiene órdenes de invitado. Una orden de cliente con ese email no cuenta.
- El correo "Consulta tus pedidos" lleva `FRONTEND_BASE_URL/order-access?token=…`. El token vence según `ORDER_ACCESS_LINK_TTL` (30 minutos por defecto), sirve una vez, y pedir otro invalida los anteriores.
- Errores: 400 `validation-error` sin email o con uno mal formado; 429 `rate-limit-exceeded`.
- Rate limit: 3 por email y 10 por IP por hora.

**`POST /v1/orders/access`** — Request `{ "token" }`.

- Response 200:

  ```json
  {
    "contactEmail": "cliente@example.com",
    "orders": [{ "publicCode": "K7M4-Q9XA", "status": "DELIVERED", "…": "OrderSummary" }]
  }
  ```

- `orders`: las 50 órdenes de invitado más recientes del email, de la más nueva a la más antigua, con la forma de `GET /v1/me/orders` (sin líneas ni dirección; con pago y envío). El detalle de cada una se consulta con el email y su código (§15.5).
- Errores: 400 `invalid-or-expired-token` si el enlace no existe, ya se usó, venció o se pidió otro; 400 `validation-error` sin token o con uno de más de 256 caracteres; 429 `rate-limit-exceeded`.
- Rate limit: comparte con la consulta y la recompra de invitado 10 por IP en 15 minutos.
- El staff puede usar las dos rutas, como la consulta.

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
- Errores: 409 `invalid-state-transition` (Shipped o posterior, ya cancelada, o con el envío ya despachado, ADR-0140); 403 `forbidden` si pide `restock` sin `inventory.write`; 409 `restock-not-allowed`.

**`POST /v1/admin/orders/{orderId}/restocks`** — `inventory.write`. Reintegro independiente de una orden (UC-INV-09, ADR-0052, ADR-0053). Lo atiende Ordering, que le pasa a Inventory cada línea con lo vendido; Inventory verifica con sus movimientos que no se reintegre de más (P-73, ADR-0132). Exige `Idempotency-Key` (ADR-0142).

- Request: `{ "reasonCode": "ORDER_CANCELLED" | "SHIPMENT_RETURNED", "lines": [ { "orderLineId", "quantity" } ], "note", "warehouseId" }`.
- Las unidades regresan al almacén del que salió cada línea, aunque esté inactivo, o al almacén activo `warehouseId`, opcional; otro valor → 404 (ADR-0160).
- La orden debe estar cancelada o reembolsada con stock confirmado, o tener el envío en RETURNED, según el motivo. La suma por línea no supera lo vendido.
- 201 `{ "movements": [StockMovement] }`.
- Errores: 409 `restock-not-allowed` (con `lines`); 409 `invalid-state-transition` si la orden no admite reintegro.
- **Implementado en T-161 (ADR-0142):**
  - `lines` de 1 a 100, cada `orderLineId` una sola vez y de la orden, con `quantity` entera de 1 a 100,000; `note` 0–500, sin los espacios de los extremos. Una línea que no es de la orden responde 400 `validation-error` con `orderLine` en `lines[i].orderLineId`;
  - `invalid-state-transition` lleva el estado de la orden o, para `SHIPMENT_RETURNED`, el de su envío;
  - lo vendido cuenta solo si el stock de la orden se confirmó; cada línea de `lines` del 409 trae `orderLineId`, `sold`, `restocked` y `requested`, y no se reintegra nada;
  - cada movimiento lleva motivo, orden, línea, nota y actor; se audita como `orders.restock`, con la nota como motivo. La orden no cambia;
  - los reintegros de una orden se esperan entre sí, porque cada uno la bloquea.

**`POST /v1/admin/orders/{orderId}/manual-capture`** — `payments.manage`. Registra el pago en tienda de la orden (UC-PAY-02); ver la sección 16.4 (ADR-0134).

**`POST /v1/admin/orders/{orderId}/retry-fulfillment`** — `orders.manage`.

- Request: `{ "version" }`. Solo en AWAITING_MANUAL_FULFILLMENT: intenta reservar y confirmar el stock; si lo logra, pasa a PAID (ADR-0012). Si se decide no surtir, se usa `/cancel`.
- 200 `AdminOrder`. Errores: 409 `insufficient-stock` (con `lines`); 409 `invalid-state-transition`, también en una orden anonimizada, que no tiene dirección y solo se cancela (ADR-0145).

UC-ORD-09 y UC-ORD-10 no tienen API: los ejecutan eventos y jobs.

Implementado en T-230 (ADR-0136): cada minuto vencen, por lotes de 100, las órdenes PENDING_PAYMENT con `paymentDueAt` vencido, junto con su reserva. La orden muestra EXPIRED con `expiredAt` y `paymentDueAt` en `null`; su historial suma el cambio sin actor. El pago iniciado sigue PENDING: el comprador ya no puede iniciarlo (409), pero el staff todavía puede registrar su pago en tienda (pago tardío, ADR-0012). Una orden vencida no se cancela (409).

Implementado en T-180 parte b (ADR-0133):

- **Listado:** `q` busca el número interno o el código público exactos (con o sin guion, sin distinguir mayúsculas) o una parte del email de contacto, que no encuentra órdenes bloqueadas (ADR-0151); `guest=false` deja solo las órdenes de clientes; `hasPendingRefund=true` son las CANCELLED con `paidAt`. Cada orden va sin líneas ni historial, pero con la dirección.
- **Detalle:** `AdminOrder` con `statusHistory` del más antiguo al más reciente. `payment` llegó con T-190 y `shipment` con T-195 (ADR-0140).
- **Cancelar:** `restock: true` sin `inventory.write` responde 403, y en un estado que no es PAID, 409 `restock-not-allowed` con `currentStatus`. Se audita `orders.cancel` con el motivo. Desde T-190 parte b (ADR-0135):
  - desde PAID o AWAITING_MANUAL_FULFILLMENT, inicia en la misma operación el reembolso total, que aparece PENDING en `payment.refunds`; el pago sigue CAPTURED y el stock no cambia;
  - desde PENDING_PAYMENT, además de liberar la reserva, cancela el pago iniciado: `payment.status` pasa a CANCELLED;
  - `restock: true` en una orden PAID reintegra todas las líneas completas en la misma operación, con el motivo de la cancelación como nota, y se audita aparte como `orders.restock` (ADR-0142).
- **Envío de la orden** (T-195 parte a, ADR-0140):
  - la orden nace con su envío PENDING al pasar a PAID: con el pago capturado, con el pago tardío que consigue stock y al reintentar el surtido; en AWAITING_MANUAL_FULFILLMENT no tiene envío;
  - cancelar una orden PAID cancela su envío en la misma operación. Si el envío ya salió, responde 409 `invalid-state-transition` con el estado del envío en `currentStatus`, y no cambia nada;
  - `Order.shipment` y `AdminOrder.shipment` lo muestran en el detalle y en los listados, con `id` y `version` solo para el staff.
- **Reintentar el surtido:** el estado se revisa antes de reservar; se audita `orders.retry-fulfillment`.
- **Pago capturado (UC-ORD-09):** escucha `PaymentCaptured { orderId, paymentId, amount }`. Un monto distinto del total no cambia la orden y queda en el log como error; el pago de una orden cancelada le deja `paidAt` y la orden sigue CANCELLED; desde T-190 parte b se inicia además su reembolso (ADR-0135). `paidAt` es el momento de la captura. El pago tardío de una orden anonimizada la deja en AWAITING_MANUAL_FULFILLMENT sin reservar (ADR-0145).
- **Concurrencia:** cada cambio bloquea la orden; una `version` desactualizada responde 409 `version-conflict` con `currentVersion`.

**`POST /v1/admin/orders/{orderId}/blocked-data`** — `orders.read-blocked`. Los datos personales de una orden bloqueada (UC-ORD-11, ADR-0070, ADR-0152).

- Request `{ "reason" }`: la reclamación o el requerimiento que se atiende, de 1 a 500 caracteres, sin datos personales. Va en el cuerpo para no quedar en logs ni historiales (ADR-0071).
- Response 200 `{ "contactEmail", "shippingAddress": Address, "shipmentDestination": Address }`, como se guardaron; `shipmentDestination` es `null` si la orden no tiene envío.
- Errores: 400 `validation-error` sin motivo o con uno vacío o de más de 500 caracteres; 404 `not-found`; 409 `invalid-state-transition` con `currentStatus` si la orden no está bloqueada (sus datos ya se ven en `AdminOrder`) o se anonimizó (ya no los tiene).
- Se audita `orders.read-blocked-data` con el motivo y sin los datos, en la misma transacción: si la auditoría falla, no se responde nada.

---

## 16. Endpoints — Payments

### 16.1 Resumen

| Método | Ruta | Acceso | UC |
|---|---|---|---|
| POST | `/v1/orders/{publicCode}/payments` | Público + `Idempotency-Key` | UC-PAY-01 |
| POST | `/v1/me/orders/{publicCode}/payments` | Solo cliente + `Idempotency-Key` | UC-PAY-01 |
| GET | `/v1/admin/payments` | `orders.read` | Consulta |
| GET | `/v1/admin/payments/{paymentId}` | `orders.read` | Consulta |
| POST | `/v1/admin/orders/{orderId}/manual-capture` | `payments.manage` | UC-PAY-02 (ADR-0134) |
| POST | `/v1/admin/payments/{paymentId}/refunds/manual` | `payments.manage` | UC-PAY-06 |
| POST | `/v1/admin/payments/{paymentId}/refunds/retry` | `payments.manage` | UC-PAY-07 (pendiente: T-192) |
| POST | `/v1/webhooks/paypal` | Firma de PayPal | UC-PAY-04 (pendiente: responde 404 mientras PayPal no esté habilitado, §19) |

La lectura de pagos usa `orders.read`, porque el catálogo de permisos no tiene uno de lectura de pagos y el pago forma parte de la vista de la orden (ADR-0071).

Ordering usa a Payments y Payments nunca usa a Ordering (ADR-0134): las rutas que necesitan la orden (iniciar el pago y registrar el pago manual) las atiende Ordering, que le pasa a Payments el total.

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
- **Implementado en T-190 parte a (ADR-0134):** el proveedor se valida antes que la orden: `MANUAL` con el pago manual deshabilitado, o `PAYPAL`, responde 400 `validation-error` con `isEnabledProvider` en `provider`. Un código público que no puede existir responde 404. El staff recibe 403 `staff-cannot-purchase`. Repetir con la misma llave devuelve el código original (201 o 200).

### 16.3 Consulta administrativa

`AdminPayment { id, orderId, orderCode, provider, status, amount, capturedAmount, refundedAmount, currency, providerPaymentId, capturedAt, attempts: [ { status, providerReference, failureCode, registeredBy, createdAt } ], refunds: [ { id, amount, status, providerRefundId, registeredBy, createdAt, completedAt } ], createdAt, updatedAt, version }`.

- **`GET /v1/admin/payments`** — Paginado. Filtros: `status`, `provider`, `orderId`, `capturedFrom`, `capturedTo`. Orden: `createdAt` (defecto `-createdAt`), `amount`.
- **`GET /v1/admin/payments/{paymentId}`** — 200 `AdminPayment`.
- **Implementado en T-190 parte a (ADR-0134):** `orderCode` con guion; `attempts` del más antiguo al más reciente (iniciar el pago guarda uno PENDING, y registrarlo, uno CAPTURED con el comprobante y el staff); `refunds` vacío hasta la parte b; filtros de varios valores separados por comas.

### 16.4 Registrar pago manual (UC-PAY-02, ADR-0040, ADR-0055)

- **`POST /v1/admin/orders/{orderId}/manual-capture`** — `payments.manage`. Antes era `POST /v1/admin/payments/manual-captures` con `orderId` en el cuerpo; la atiende Ordering, que conoce la orden (ADR-0134).
- Request: `{ "reference": "Ticket 00452", "note": "…" }`. `reference` 1–100 (comprobante de la tienda); `note` 0–500, que queda como motivo de la auditoría.
- Registra el cobro por el total de la orden (crea el Payment si no existe) y produce `PaymentCaptured`; la orden sigue el flujo normal o el de pago tardío (ADR-0012), en segundo plano (sección 2.5): la respuesta trae el pago capturado, y la orden puede seguir unos instantes en su estado anterior.
- Solo órdenes en PENDING_PAYMENT o EXPIRED.
- 200 `AdminOrder` con su pago capturado, como las demás acciones sobre la orden (ADR-0134). Auditado como `payments.manual-capture`.
- Errores: 403 `manual-payments-disabled`, antes que cualquier otro; 404 (orden inexistente); 409 `invalid-state-transition` (otro estado de la orden o pago ya capturado).

### 16.5 Reembolsos (UC-PAY-06, UC-PAY-07, ADR-0051, ADR-0052)

- **`POST /v1/admin/payments/{paymentId}/refunds/manual`** — Registrar un reembolso hecho fuera del sistema. Request `{ "reference", "note", "version" }` (`version` del pago). Solo pagos MANUAL con reembolso pendiente o fallido de una orden cancelada. Completa el reembolso: la orden pasa a REFUNDED en segundo plano (sección 2.5). El stock se reintegra aparte, con `POST /v1/admin/orders/{orderId}/restocks` (ADR-0142). 200 `AdminPayment`. Errores: 403 `manual-payments-disabled`; 409 `invalid-state-transition`.
- **`POST /v1/admin/payments/{paymentId}/refunds/retry`** — Reintentar un reembolso fallido con el proveedor. Request `{ "version" }`. 200 `AdminPayment`. Errores: 409 `invalid-state-transition` (no hay reembolso fallido).

UC-PAY-03 (inicio del reembolso al cancelar) ocurre dentro de `POST /v1/admin/orders/{orderId}/cancel`. UC-PAY-05 (conciliación) es un job.

Implementado en T-190 parte b (ADR-0135):

- **Reembolso manual:** `reference` 1–100 caracteres sin quedar en blanco, que queda como `providerRefundId`; `note` 0–500, motivo de la auditoría `payments.manual-refund`; `version` entero ≥ 1. Solo un reembolso PENDING de un pago MANUAL: uno manual nunca falla, y los fallidos llegan con un proveedor (T-192). Responde el pago REFUNDED, con `refundedAmount` igual a lo capturado y el reembolso COMPLETED con `registeredBy` y `completedAt`.
- **Orden de las validaciones:** 403 `manual-payments-disabled`, 404, 409 `version-conflict` y 409 `invalid-state-transition`. Desde T-161, `restock` ya no es un campo del registro y responde 400 `validation-error` (ADR-0142).
- **La orden:** pasa a REFUNDED en segundo plano (sección 2.5).
- **Reintentar:** UC-PAY-07 pasa a T-192 (ADR-0134).

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

**Método de envío** (`ShippingMethod { id, name, flatFee: Money, freeShippingThreshold: Money | null, deliveryMinBusinessDays, deliveryMaxBusinessDays, isActive, version, updatedAt }`).

- `GET` — 200 el método activo.
- `PUT` — Request `{ "name", "flatFee": 9900, "freeShippingThreshold": 150000, "deliveryMinBusinessDays": 3, "deliveryMaxBusinessDays": 7, "version" }`; `flatFee` ≥ 0, con IVA incluido (ADR-0079); umbral `null` (sin envío gratis) o > 0; plazo en días hábiles, enteros con mínimo ≥ 1 y máximo ≥ mínimo (ADR-0083). Los cambios no afectan órdenes colocadas (ADR-0042). 200. Permiso `shipping.configure` (ADR-0075).
- **Implementado en T-196 (ADR-0122):**
  - `name` de 1 a 100 caracteres, sin quedar en blanco;
  - `flatFee` entero de 0 a 2147483647 centavos;
  - `freeShippingThreshold` obligatorio en el cuerpo, `null` o de 1 al mismo tope;
  - el plazo, enteros de 1 a 30. Un máximo menor que el mínimo responde 400 `validation-error` con `deliveryRange` en `deliveryMaxBusinessDays`.
  - Una `version` anterior responde 409 `version-conflict` con `currentVersion`.
  - Cada cambio se audita como `shipping-method.update`; sin cambios no se guarda ni se audita.
  - El método inicial lo crea una migración con los valores de ADR-0092.

**Envíos** (`AdminShipment { id, orderId, orderCode, warehouseId, status, destination: Address, items: [ { orderLineId, sku, productName, quantity } ], carrierName, trackingNumber, ownDelivery, dispatchedAt, deliveredAt, failedAt, returnedAt, cancelledAt, failureNote, returnNote, blockedAt, version, createdAt }`). `status`: PENDING, DISPATCHED, DELIVERED, DELIVERY_FAILED, RETURNED o CANCELLED (ADR-0140). El destino del envío de una orden anonimizada sigue §8.2 (ADR-0145), y también el de una bloqueada desde `blockedAt` (ADR-0151).

| Endpoint | Detalle |
|---|---|
| `GET …/shipments` | Paginado. Filtros: `status` (defecto PENDING, UC-SHI-08), `orderId`, `warehouseId` (ADR-0160), `q` (código de orden o guía), `createdFrom`, `createdTo`. Orden: `createdAt` (defecto `createdAt` ascendente: primero los más antiguos), `dispatchedAt` |
| `GET …/shipments/{shipmentId}` | 200 `AdminShipment` |
| `PATCH …/shipments/{shipmentId}` | Request `{ "carrierName", "trackingNumber", "version" }` (1–100 y 1–100, o las dos en `null` para quitarlas de un envío PENDING, ADR-0141). Permitido en PENDING y DISPATCHED, salvo en envíos despachados como entrega propia. 200. Errores: 409 `invalid-state-transition` |
| `POST …/dispatch` | Request `{ "ownDelivery", "version" }` (`ownDelivery` booleano, por defecto `false`). Desde PENDING. Con `ownDelivery: false` exige `carrierName` y `trackingNumber` ya capturados (BR-SHP-04); con `ownDelivery: true`, el envío no debe tener paquetería ni guía (ADR-0078). La orden pasa a SHIPPED en segundo plano (sección 2.5). 200. Errores: 409 `invalid-state-transition`; 400 `validation-error` (falta paquetería o guía, o hay paquetería o guía en una entrega propia) |
| `POST …/deliver` | Request `{ "version" }`. Desde DISPATCHED. La orden pasa a DELIVERED en segundo plano (sección 2.5). 200 |
| `POST …/delivery-failure` | Request `{ "note", "version" }` (`note` opcional, 0–500, ADR-0141). Desde DISPATCHED. La orden no cambia (ADR-0053). 200 |
| `POST …/return` | Request `{ "note", "version" }` (`note` opcional, 0–500). Desde DELIVERY_FAILED. El reintegro de stock se hace con `POST /v1/admin/orders/{orderId}/restocks` (ADR-0132). 200 |

UC-SHI-01 (costo) ocurre dentro de la cotización; UC-SHI-03 (crear envío), dentro de la operación que deja pagada la orden (ADR-0140).

Implementado en T-195 parte a (ADR-0140):

- **Creación:** Ordering crea el envío en la transacción en que la orden pasa a PAID, desde el almacén de su reserva confirmada (`warehouseId`, ADR-0160), con la dirección de envío y una partida por línea. `orderCode`, `sku` y `productName` se copian de la orden; `orderCode` se muestra con guion.
- **Cancelación:** el envío pasa de PENDING a CANCELLED, con `cancelledAt`, cuando se cancela su orden pagada (§15.7). No hay ruta para cancelar un envío por separado.
- **Listado:** sin `status`, solo los PENDING. `q` busca el código de la orden exacto (con o sin guion, sin distinguir mayúsculas) o la guía exacta, sin distinguir mayúsculas. `createdTo` con solo la fecha incluye todo ese día (§5.3). Desempate por ID.
- **Paquetería y guía:**
  - `carrierName` y `trackingNumber` obligatorios, de 1 a 100 caracteres, sin quedar en blanco; se guardan sin los espacios de los extremos;
  - un envío CANCELLED, o despachado como entrega propia, responde 409 `invalid-state-transition` con `currentStatus`;
  - una `version` anterior responde 409 `version-conflict` con `currentVersion`;
  - se audita como `shipments.update` con los cambios; sin cambios no se guarda ni se audita, y la `version` no sube.

Implementado en T-195 parte b (ADR-0141):

- **Despachar:** sin `ownDelivery`, por paquetería. Un envío que no está en PENDING responde 409 `invalid-state-transition` antes de revisar la guía; la guía que no corresponde responde 400 `validation-error` en `ownDelivery`, con `trackingRequired` (falta paquetería o guía) o `trackingNotAllowed` (una entrega propia con paquetería o guía).
- **Entregar, entrega fallida y devolución:** desde DISPATCHED, DISPATCHED y DELIVERY_FAILED; en otro estado, 409 `invalid-state-transition` con `currentStatus`. DELIVERED y RETURNED son definitivos.
- **Notas:** `note` se guarda sin los espacios de los extremos, en `failureNote` o `returnNote`; vacía o ausente queda en `null`. Es también el motivo de la auditoría.
- **Quitar la guía:** `carrierName` y `trackingNumber` en `null`, juntos, en un envío PENDING; se audita como `shipments.update`. Solo una en `null` responde 400 `validation-error` con `trackingPair` en esa; en un envío que ya no está en PENDING, 409 `invalid-state-transition`.
- **Auditoría:** `shipments.dispatch`, `shipments.deliver`, `shipments.delivery-failure` y `shipments.return`, con el cambio de estado.
- **La orden:** pasa a SHIPPED y a DELIVERED en segundo plano (sección 2.5), sin actor en su historial. Desde SHIPPED ya no se cancela (§15.7). Con la entrega fallida o la devolución sigue en SHIPPED.
- **A la vez:** despachar y cancelar la orden se esperan, y solo una de las dos ocurre; la otra responde 409.

---

## 18. Endpoints — Auditoría (UC-AUD-02, ADR-0037)

| Método | Ruta | Acceso | UC |
|---|---|---|---|
| GET | `/v1/admin/audit` | `audit.read` | UC-AUD-02 |

**`GET /v1/admin/audit`** — `audit.read`.

- Paginación por cursor (sección 5.2); orden fijo, más reciente primero.
- Filtros: `actorId`, `actorType`, `action` (código exacto o prefijo con `*`, por ejemplo `orders.*`), `resourceType`, `resourceId`, `result`, `from`, `to` (máximo 3 meses atrás; los registros anteriores están en archivos fuera de la API).
- `AuditEntry { id, occurredAt, actorType, actorId, action, resourceType, resourceId, result, correlationId, ip, userAgent, changes, reason }`. `changes` nunca contiene valores sensibles ni personales (ADR-0067).
- No existen endpoints para modificar ni borrar registros.

Implementado en T-220 (ADR-0146):

- **Filtros:**
  - `actorType` y `result` aceptan varios valores separados por comas;
  - `action` es un código exacto o un prefijo terminado en `.*`; otra forma responde 400;
  - `from` y `to` incluyen sus extremos, y un `to` con solo fecha incluye todo el día;
  - un `from` anterior a la retención no se rechaza: no hay registros tan antiguos.
- **`reason`:** el motivo que dio el staff, cuando la acción lo pide (ADR-0112); `null` si no.
- **Retención:** la base guarda `AUDIT_RETENTION_MONTHS` meses (3 por defecto). Después, el job diario `audit.archive` los pasa a archivos comprimidos, un archivo o más por día UTC, que se leen a mano.
- Leer la auditoría no se audita.

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

Ninguno: el último, el cálculo de `storeVisibility`, se resolvió en ADR-0129.

---

## 21. Cobertura de casos de uso

| Caso de uso | Endpoint o mecanismo |
|---|---|
| UC-IAM-01 a 11 | Sección 9 |
| UC-IAM-12 | Sin API: canal externo (ADR-0067); lo ejecutan UC-IAM-18 y 19 |
| UC-IAM-13 a 19 | Sección 9 |
| UC-IAM-20, 21 | Sin API: scripts (ADR-0043, ADR-0057) |
| UC-IAM-22 | Sección 10 |
| UC-IAM-23 | Sección 23 |
| UC-CAT-01 a 14 | Sección 11 |
| UC-PRC-01 a 05 | Sección 12 |
| UC-PRC-06 | Sin API pública: fachada interna del módulo |
| UC-INV-01 a 04 | Sección 13 |
| UC-INV-09 | Sección 15.7 (ADR-0132) |
| UC-INV-10 y 11 | Sección 13 (ADR-0160) |
| UC-INV-05 a 08 | Sin API: checkout, eventos y jobs |
| UC-CRT-01 a 06, 09 | Sección 14 |
| UC-CRT-07, 08 | Sin API: job y evento `OrderExpired` |
| UC-ORD-01 a 08, 11 | Sección 15 |
| UC-ORD-09, 10 | Sin API: evento `PaymentCaptured` y job |
| UC-PAY-01, 02, 04, 06, 07 | Secciones 15.7, 16 y 19 |
| UC-PAY-03 | Dentro de la cancelación de órdenes |
| UC-PAY-05 | Sin API: job |
| UC-SHI-02, 04 a 09 | Sección 17 |
| UC-SHI-01, 03 | Dentro de la cotización; dentro del pago de la orden (ADR-0140) |
| UC-AUD-02 | Sección 18 |
| UC-AUD-01, 03, UC-NTF-01, UC-SYS-01 a 03 | Sin API: transversales y jobs |

Las entregas de eventos (sección 22) son una herramienta de operación, sin caso de uso propio.

---

## 22. Endpoints — Entregas de eventos (ADR-0150)

Las entregas de los eventos de dominio a sus manejadores (sección 2.5), para diagnosticar y reintentar las que agotaron sus 8 intentos. Implementado en T-109 parte b.

| Método | Ruta | Acceso | UC |
|---|---|---|---|
| GET | `/v1/admin/event-deliveries` | `events.manage` | Operación |
| POST | `/v1/admin/event-deliveries/{deliveryId}/retry` | `events.manage` | Operación |
| POST | `/v1/admin/event-deliveries/retry` | `events.manage` | Operación |

### 22.1 `GET /v1/admin/event-deliveries` — `events.manage`

Paginado (ADR-0036). Filtros: `status` (uno o más de `PENDING`, `DELIVERED` y `FAILED`; por defecto, `FAILED`), `eventType` (como `PaymentCaptured`) y `handler` (como `PaymentCapturedHandler.onPaymentCaptured`). Orden: `occurredAt` (defecto `-occurredAt`) o `nextAttemptAt`, con desempate por ID.

Representación `EventDelivery`:

```json
{
  "id": "0192…",
  "eventId": "0192…",
  "eventType": "OrderPaid",
  "occurredAt": "2026-10-03T11:00:00.000Z",
  "handler": "OrderEmails.onOrderPaid",
  "status": "FAILED",
  "attempts": 8,
  "nextAttemptAt": "2026-10-03T23:21:00.000Z",
  "lastError": "EmailDeliveryError: connection refused",
  "deliveredAt": null,
  "event": { "eventId": "0192…", "eventType": "OrderPaid", "occurredAt": "2026-10-03T11:00:00.000Z", "orderId": "0192…" }
}
```

- `event` es el evento completo, como lo recibe el manejador; nunca lleva datos personales.
- `lastError`: clase y mensaje del último fallo, redactados como los logs, hasta 500 caracteres.
- Errores: 400 `validation-error` con un estado, un orden, un tipo de evento o un manejador que no pueden existir.

### 22.2 `POST /v1/admin/event-deliveries/{deliveryId}/retry` — `events.manage`

- Una entrega `FAILED` vuelve a `PENDING` con 0 intentos, así que tiene otros 8, y el job la toma en el siguiente minuto. Response 202 sin cuerpo.
- Errores: 404 `not-found`; 409 `invalid-state-transition` (con `currentStatus`) si no está en `FAILED`.
- Se audita `events.retry-delivery`.

### 22.3 `POST /v1/admin/event-deliveries/retry` — `events.manage`

- Request `{ "eventType"?, "handler"? }`: reintenta todas las `FAILED` de ese tipo de evento o de ese manejador, o todas si no se da ninguno, después de corregir lo que las hizo fallar.
- Response 200 `{ "retried": 3 }`.
- Se audita una vez `events.retry-deliveries`, con el filtro y cuántas reactivó; si fueron cero, no se audita.

---

## 23. Endpoints — Privacidad (ADR-0152)

| Método | Ruta | Acceso | UC |
|---|---|---|---|
| GET | `/v1/privacy/retention-policy` | Público | UC-IAM-23 |

### 23.1 `GET /v1/privacy/retention-policy` — Política de conservación vigente (UC-IAM-23)

Pública, para que el frontend muestre los plazos reales en el aviso de privacidad (ADR-0149). Implementado en T-232 parte b.

- Response 200, con `Cache-Control: public, max-age=3600`, porque los plazos cambian solo con un despliegue:

  ```json
  {
    "personalData": { "enabled": true, "operationalMonths": 12, "blockedMonths": 60 },
    "inactiveCustomerMonths": null,
    "auditTrail": { "databaseMonths": 3, "archiveMonths": 24 },
    "spentRefreshTokenDays": 30,
    "inactiveGuestCartDays": 30,
    "processedWebhookEventDays": 30
  }
  ```

- `personalData`: el ciclo de los datos personales de órdenes y envíos (ADR-0151); con `enabled` en `false`, se conservan.
- `inactiveCustomerMonths`: meses sin actividad tras los que se anonimiza la cuenta de un cliente; `null` si nunca (el valor por defecto).
- Los eventos de dominio no aparecen: no llevan datos personales (ADR-0150).

---

## 24. OpenAPI

Swagger/OpenAPI generado desde NestJS (ADR-0002) a partir de los DTOs de Presentation; documenta cada endpoint de este documento, sus esquemas y sus `type` de error. Se expone solo en el entorno local (ADR-0031). Este documento es la especificación de referencia, y el documento generado debe coincidir con él: la prueba de contrato lo comprueba en cada corrida de la CI (ADR-0155).

- Swagger UI en `/docs/v1` y el documento OpenAPI de `v1` en `/docs/v1/openapi.json`, fuera del prefijo `/v1`. Solo se sirven con `NODE_ENV=development` (ADR-0096); con `NODE_ENV=test` el documento se construye y se revisa sin servirlo, para que un DTO que lo rompa falle en cualquier suite (paso 0 del Sprint 6).
- Los errores de cada endpoint usan el esquema común `ProblemDetails`, cuyo `type` admite solo los tipos de la sección 6.2. Cada respuesta de error lista sus tipos; los de un controlador se suman a los de cada ruta (ADR-0155).
- Autenticación declarada como `bearer` en toda ruta protegida, y solo en ellas.
- **Documento versionado (ADR-0155):** `docs/openapi/v1.json` guarda el documento de `v1`, con las claves ordenadas. Una prueba lo compara con el generado, así que todo cambio del contrato se ve en el diff; `npm run openapi:update` lo regenera.
- **Lista de rutas:** las tablas de resumen de cada sección (`| Método | Ruta | Acceso | UC |`) son la lista de rutas de este documento. La prueba de contrato comprueba que coincidan con las de la aplicación, con el mismo acceso y la misma exigencia de `Idempotency-Key`; una fila marcada "pendiente" es una ruta por construir.
- **Descripciones:** toda operación, todo parámetro y cada campo de los cuerpos que envía el cliente tienen descripción en español; en las respuestas, los campos cuyo significado no se deduce del nombre. Los IDs que son UUID declaran `format: uuid`, y los formatos que no se deducen del esquema, como el código público o los tokens de los enlaces, tienen ejemplo.

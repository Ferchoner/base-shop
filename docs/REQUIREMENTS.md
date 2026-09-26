# REQUIREMENTS — Especificación técnica

Especificación funcional del MVP derivada de las decisiones registradas (`DECISIONS.md`, ADR-0001 a ADR-0048), el modelo de dominio (`DOMAIN_MODEL.md`) y las reglas de negocio (`BUSINESS_RULES.md`).

Convenciones:

- **UC-xxx:** caso de uso. **BR-xxx:** regla de negocio. **E-xx:** error. **P-xx:** decisión pendiente (`PROGRESS.md`).
- Lo que no está decidido se marca como PENDIENTE DE DECISIÓN con su P-xx. Nada de este documento agrega requisitos que no provengan de una decisión registrada.
- Grupos de rutas (ADR-0036): público `/v1/...`, cliente `/v1/me/...`, administración `/v1/admin/{contexto}/...`, webhooks `/v1/webhooks/{proveedor}`. Las rutas concretas se definen en T-005.

---

## 1. Actores

| Actor | Descripción | Autenticación | Fuente |
|---|---|---|---|
| Visitante | Cualquier persona sin sesión | Ninguna | ADR-0036 |
| Cliente invitado | Compra sin cuenta con email de contacto; no verifica email | Ninguna | ADR-0010, ADR-0044 |
| Cliente registrado | Cuenta de tipo cliente; necesita email verificado para comprar | JWT | ADR-0023, ADR-0044 |
| Staff — Superadministrador | Todos los permisos; único que gestiona staff y roles | JWT | ADR-0043 |
| Staff — Administrador | Todos los permisos excepto `staff.manage` | JWT | ADR-0043 |
| Staff — Operador | Catálogo, precios, inventario, envíos; lectura de pedidos y clientes | JWT | ADR-0043 |
| Proveedor de pago | Envía webhooks (PayPal semiimplementado y no habilitado) | Firma del proveedor | ADR-0040 |
| Sistema | Jobs programados y reacciones a eventos | — | ADR-0029 |
| Operador técnico | Ejecuta el script de creación del primer superadministrador | Acceso al servidor | ADR-0043 |

Reglas transversales: las cuentas son de tipo cliente o staff (BR-USR-08); el staff no compra; los clientes no tienen roles.

---

## 2. Módulos

| Módulo | Responsabilidad en el MVP | Fuera del MVP |
|---|---|---|
| Identity & Access | Registro, autenticación, verificación de email, cuentas de staff, roles, permisos, direcciones | 2FA (preparado, ADR-0048) |
| Catalog | Productos, variantes, imágenes, categorías, marcas, publicación | — |
| Pricing | Una lista predeterminada, precios inmediatos y programados | Listas adicionales (modelo preparado, ADR-0039) |
| Inventory | Un almacén, stock, reservas, movimientos | Varios almacenes operando (modelo preparado) |
| Shopping | Carrito de invitado y de cliente registrado | — |
| Ordering | Checkout, órdenes, consulta de invitado, cancelación | Promociones, devoluciones |
| Payments | Pago manual (solo pruebas), PayPal semiimplementado | Mercado Pago, Stripe, métodos asíncronos |
| Shipping | Envíos manuales, costo fijo con envío gratis por monto | Integración con paqueterías, envíos parciales |
| Transversales | Auditoría técnica, notificaciones, jobs | Facturación electrónica (CFDI) |

---

## 3. Entidades y estados

Detalle de atributos en `DOMAIN_MODEL.md` y `DATABASE.md`. Aquí se fijan los ciclos de vida.

### 3.1 Order (ADR-0009, ADR-0012, ADR-0021)

Estados: PendingPayment, Paid, AwaitingManualFulfillment, Shipped, Delivered, Cancelled, Expired, Refunded.

| Desde | Hacia | Disparador | Fuente |
|---|---|---|---|
| — | PendingPayment | UC-ORD-02 colocar orden | ADR-0019 |
| PendingPayment | Paid | Pago capturado con reserva vigente | ADR-0011 |
| PendingPayment | Expired | Vence la reserva (job) | BR-ORD-07 |
| PendingPayment | Cancelled | Cancelación por staff | ADR-0021 |
| Expired | Paid | Pago tardío y hay stock para reservar | ADR-0012 |
| Expired | AwaitingManualFulfillment | Pago tardío sin stock | ADR-0012 |
| Paid | Shipped | Envío marcado como despachado | ADR-0041 |
| Paid | Cancelled | Cancelación por staff; inicia el reembolso total | ADR-0051 |
| AwaitingManualFulfillment | Paid | Staff consigue stock y resuelve | ADR-0012 |
| AwaitingManualFulfillment | Cancelled | Cancelación por staff; inicia el reembolso total | ADR-0051 |
| Cancelled (con pago capturado) | Refunded | Reembolso confirmado (proveedor o registro manual) | ADR-0051 |
| Shipped | Delivered | Envío marcado como entregado | ADR-0041 |
| Shipped | Shipped (sin cambio) | Entrega fallida o devolución del envío | ADR-0053 |

Estados terminales: Delivered, Refunded, y Cancelled cuando no hubo pago capturado. Una orden Cancelled con pago capturado espera la confirmación del reembolso. Expired no es terminal (puede recibir un pago tardío).

### 3.2 Payment (ADR-0013, ADR-0040)

Estados: Pending, RequiresAction, Authorized, Captured, Failed, Cancelled, PartiallyRefunded, Refunded. Un Payment por orden; transiciones monótonas (BR-PAY-05). Con el método manual, el registro del staff lleva el Payment a Captured. PartiallyRefunded no se usa en el MVP (reembolsos parciales fuera de alcance, ADR-0018).

### 3.3 Reservation (ADR-0011)

Estados: Active → Committed (pago confirmado) | Released (orden cancelada) | Expired (TTL de 20 minutos).

### 3.4 Shipment (ADR-0041)

Estados (ADR-0050, ADR-0053): Pending → Dispatched → Delivered | DeliveryFailed; DeliveryFailed → Returned (manual, cuando la mercancía regresa). Delivered y Returned son terminales. Ninguno de estos cambios modifica el estado de la orden, que permanece en Shipped. Los estados de paquetería (guía generada, en tránsito) están previstos pero no se implementan en el MVP.

### 3.5 Otras entidades

| Entidad | Estados | Fuente |
|---|---|---|
| User | Active, Suspended, PendingVerification (clientes); indicador de cambio de contraseña obligatorio (staff); cliente anonimizado | ADR-0038, ADR-0043, ADR-0044 |
| Product | Draft, Published, Archived | DOMAIN_MODEL |
| ProductVariant | Activa, Descontinuada | ADR-0038 |
| Category, Brand | Activa, Desactivada (o borrada si está vacía) | ADR-0038 |
| Cart | Active, CheckedOut, Merged | DOMAIN_MODEL |
| PriceList | Activa (la predeterminada no se desactiva) | ADR-0039 |
| Warehouse | Activo, Inactivo | ADR-0038 |

Reactivación de entidades suspendidas, archivadas o desactivadas: PENDIENTE DE DECISIÓN (P-49).

---

## 4. Permisos

Catálogo y roles de ADR-0043.

| Permiso | Superadministrador | Administrador | Operador |
|---|---|---|---|
| `catalog.read`, `catalog.write` | ✓ | ✓ | ✓ |
| `pricing.read`, `pricing.write` | ✓ | ✓ | ✓ |
| `inventory.read`, `inventory.write` | ✓ | ✓ | ✓ |
| `orders.read` | ✓ | ✓ | ✓ |
| `orders.manage` | ✓ | ✓ | — |
| `payments.manage` | ✓ | ✓ | — |
| `shipping.manage` | ✓ | ✓ | ✓ |
| `customers.read` | ✓ | ✓ | ✓ |
| `customers.manage` | ✓ | ✓ | — |
| `staff.manage` | ✓ | — | — |
| `audit.read` | ✓ | ✓ | — |

Ambigüedad (P-48): la configuración del costo de envío y del umbral de envío gratis no tiene permiso asignado. Si se asigna a `shipping.manage`, el Operador podría cambiar un valor monetario.

---

## 5. Casos de uso

Columna **Acceso**: Público, Cliente (registrado autenticado), Staff (`permiso`), Sistema.

### 5.1 Identity & Access

| ID | Caso de uso | Acceso | Reglas |
|---|---|---|---|
| UC-IAM-01 | Registrar cliente | Público | BR-USR-01, BR-USR-10, BR-USR-15 |
| UC-IAM-02 | Verificar email con enlace | Público | BR-USR-11, ADR-0046 |
| UC-IAM-03 | Reenviar verificación | Público | ADR-0046; respuesta no revela si el email existe |
| UC-IAM-04 | Iniciar sesión | Público | BR-USR-02, ADR-0023, ADR-0048 |
| UC-IAM-05 | Renovar sesión | Público (refresh token) | ADR-0023 |
| UC-IAM-06 | Cerrar sesión | Cliente o Staff | ADR-0023 |
| UC-IAM-07 | Solicitar recuperación de contraseña | Público | BR-USR-16, ADR-0056 |
| UC-IAM-08 | Restablecer contraseña | Público (token) | BR-USR-10, BR-USR-16, ADR-0056 |
| UC-IAM-09 | Cambiar contraseña (incluido el cambio obligatorio del staff) | Cliente o Staff | BR-USR-09, BR-USR-10 |
| UC-IAM-10 | Cambiar email | Cliente | BR-USR-11 |
| UC-IAM-11 | Gestionar direcciones | Cliente | BR-ADR-01 a BR-ADR-04, ADR-0057 |
| UC-IAM-12 | Solicitar eliminación de cuenta u otro derecho ARCO | Canal externo (sin API); lo ejecuta el staff | BR-USR-06, ADR-0067 |
| UC-IAM-13 | Crear cuenta de staff con contraseña temporal | Staff (`staff.manage`) | BR-USR-09 |
| UC-IAM-14 | Asignar roles a staff | Staff (`staff.manage`) | BR-USR-03 |
| UC-IAM-15 | Crear, editar y borrar roles | Staff (`staff.manage`) | BR-USR-04, BR-USR-07 |
| UC-IAM-16 | Suspender staff | Staff (`staff.manage`) | BR-USR-03, BR-USR-06 |
| UC-IAM-17 | Consultar clientes | Staff (`customers.read`) | — |
| UC-IAM-18 | Suspender cliente | Staff (`customers.manage`) | BR-USR-02 |
| UC-IAM-19 | Anonimizar cliente o comprador invitado | Staff (`customers.manage`) | BR-USR-06, BR-PRIV-03, ADR-0067 |
| UC-IAM-20 | Crear el primer superadministrador | Operador técnico (script, sin API) | ADR-0043 |
| UC-IAM-21 | Cargar o actualizar el catálogo de estados y municipios | Operador técnico (script, sin API) | BR-ADR-03, ADR-0057 |
| UC-IAM-22 | Consultar estados y municipios | Público | ADR-0057 |

Criterios de aceptación:

- **UC-IAM-01:** pide email, contraseña, nombres, apellidos y la versión del aviso de privacidad presentada; se rechaza una contraseña fuera de 15–64 caracteres o presente en la lista de contraseñas comunes; se rechaza un email ya registrado; la cuenta queda de tipo cliente y sin verificar; se envía el enlace de verificación. Si el email ya está registrado, la respuesta lo indica para que el usuario inicie sesión o recupere su cuenta (ADR-0062); el registro tiene rate limiting.
- **UC-IAM-02:** el enlace usa la URL base del frontend configurada (ADR-0056); un enlace válido marca el email como verificado; un enlace usado, vencido o invalidado por un reenvío se rechaza.
- **UC-IAM-03:** la respuesta es idéntica exista o no el email; el reenvío invalida el enlace anterior; aplica límite de frecuencia.
- **UC-IAM-04:** credenciales válidas devuelven token de acceso y refresh token en un objeto con campos nombrados; un usuario suspendido no obtiene tokens; un staff con contraseña temporal recibe el desenlace "cambio de contraseña obligatorio"; los intentos fallidos se auditan y tienen rate limiting. Email inexistente, contraseña incorrecta y cuenta suspendida producen la misma respuesta de credenciales no válidas (ADR-0062).
- **UC-IAM-05:** cada renovación rota el refresh token; presentar uno ya rotado revoca toda la sesión; un refresh token vencido (7 días) o revocado se rechaza.
- **UC-IAM-06:** el refresh token queda revocado; el token de acceso sigue válido hasta vencer (15 minutos).
- **UC-IAM-07:** respuesta idéntica exista o no el email; no envía correo a cuentas suspendidas; límite de frecuencia por email y por IP; el nuevo enlace invalida los anteriores; el enlace usa la URL base del frontend configurada.
- **UC-IAM-08:** token de un solo uso, vigente 30 minutos; la nueva contraseña cumple ADR-0047; revoca todas las sesiones del usuario; envía un correo avisando del cambio; se audita.
- **UC-IAM-09:** exige la contraseña actual (la temporal, en el cambio obligatorio del staff); aplica la política de ADR-0047; se audita. Revoca las demás sesiones del usuario, conserva la actual y envía un aviso por correo (ADR-0072).
- **UC-IAM-10:** el nuevo email queda sin verificar y el cliente no puede comprar hasta verificarlo.
- **UC-IAM-11:** valida el formato de dirección de ADR-0057 (código postal de 5 dígitos, teléfono de 10 dígitos, estado y municipio de la lista cerrada y municipio perteneciente al estado); máximo 10 direcciones; solo municipios activos para direcciones nuevas.
- **UC-IAM-13:** solo `staff.manage`; la contraseña temporal la genera el sistema con al menos 15 caracteres; la cuenta exige cambio de contraseña en el primer inicio de sesión; se audita.
- **UC-IAM-14 / 16:** no se puede dejar al sistema sin superadministrador; se audita.
- **UC-IAM-15:** solo permisos del catálogo en código; no se borra un rol con usuarios.
- **UC-IAM-18:** el cliente suspendido no puede iniciar sesión ni renovar tokens.
- **UC-IAM-19:** si hay órdenes sin concluir, no se ejecuta hasta que terminen; vacía email, nombres, apellidos y hash de contraseña (estado ANONYMIZED, email liberado); revoca y borra tokens; borra direcciones y carritos; elimina email de contacto y datos de identificación de las direcciones de órdenes y envíos, conservando estado, municipio y código postal; se audita sin valores personales.
- **UC-IAM-20:** crea un superadministrador con datos de variables de entorno; no existe ningún usuario predeterminado en el repositorio ni en migraciones.
- **UC-IAM-21:** importa el catálogo del INEGI desde un archivo descargado; es idempotente; los municipios que ya no aparecen se marcan inactivos, sin borrarse.

### 5.2 Catalog

| ID | Caso de uso | Acceso | Reglas |
|---|---|---|---|
| UC-CAT-01 | Listar y buscar productos de la tienda | Público | BR-PRD-06, BR-PRD-15, ADR-0028, ADR-0036, ADR-0060 |
| UC-CAT-02 | Ver detalle de producto por slug | Público | BR-PRD-06, ADR-0028 |
| UC-CAT-03 | Consultar árbol de categorías | Público | ADR-0028 |
| UC-CAT-04 | Crear producto (borrador) | Staff (`catalog.write`) | BR-PRD-09 |
| UC-CAT-05 | Editar datos del producto | Staff (`catalog.write`) | — |
| UC-CAT-06 | Agregar variante | Staff (`catalog.write`) | BR-PRD-01, BR-PRD-02, BR-PRD-14 |
| UC-CAT-07 | Editar variante | Staff (`catalog.write`) | BR-PRD-12, ADR-0068 |
| UC-CAT-08 | Descontinuar variante | Staff (`catalog.write`) | BR-PRD-07 |
| UC-CAT-09 | Publicar producto | Staff (`catalog.write`) | BR-PRD-04, BR-PRD-05 |
| UC-CAT-10 | Archivar producto | Staff (`catalog.write`) | BR-PRD-07, BR-PRD-09 |
| UC-CAT-11 | Subir, reordenar y borrar imágenes | Staff (`catalog.write`) | BR-PRD-08, ADR-0024, ADR-0038 |
| UC-CAT-12 | Gestionar categorías | Staff (`catalog.write`) | BR-PRD-03, BR-PRD-10 |
| UC-CAT-13 | Gestionar marcas | Staff (`catalog.write`) | BR-PRD-10 |
| UC-CAT-14 | Listado administrativo del catálogo | Staff (`catalog.read`) | ADR-0016 |

Criterios de aceptación:

- **UC-CAT-01 / 02:** solo productos publicados y variantes activas con precio vigente; un producto sin variantes con precio no aparece; imágenes siempre como arreglo (vacío si no hay) con URL absoluta; paginación, `sort` y filtros no declarados se rechazan; listados sin texto de búsqueda cacheados con TTL de 120 s e invalidada por `ProductPublished`, `ProductArchived` y `VariantDiscontinued`. Cada variante se muestra como disponible o agotada, sin cantidades (ADR-0061).
- **UC-CAT-01 (búsqueda y filtros):** búsqueda por texto en español, sin acentos y por prefijo, sobre título, marca y categorías; filtros por categoría (con subcategorías), marcas, rango de precio y solo disponibles; órdenes por relevancia, más recientes, precio y nombre; el precio de un producto es el más bajo entre sus variantes vendibles; los totales de paginación son exactos porque el filtrado ocurre en la base.
- **UC-CAT-06:** SKU duplicado o reutilizado se rechaza; combinación de opciones repetida en el producto se rechaza. Peso (gramos) y dimensiones (centímetros) son opcionales y, si se capturan, deben ser positivos.
- **UC-CAT-07:** SKU y opciones solo se editan si el producto nunca se ha publicado (el SKU anterior se libera); después se rechazan; no se agregan dimensiones de opciones a productos publicados; peso, dimensiones y estado se editan siempre.
- **UC-CAT-09:** se rechaza sin al menos una variante activa; se permite sin precio y sin imagen.
- **UC-CAT-10:** el slug sigue reservado; el producto deja de mostrarse en la tienda.
- **UC-CAT-11:** se aceptan JPEG, PNG y WebP validados por contenido, de hasta 5 MB; el nombre en disco lo genera el servidor; borrar una imagen borra registro y archivo.
- **UC-CAT-12 / 13:** mover una categoría no crea ciclos; una categoría o marca con productos o subcategorías se desactiva en lugar de borrarse.
- **UC-CAT-14:** indica qué productos publicados no son visibles por falta de precio vigente.

### 5.3 Pricing

| ID | Caso de uso | Acceso | Reglas |
|---|---|---|---|
| UC-PRC-01 | Consultar precios y periodos | Staff (`pricing.read`) | — |
| UC-PRC-02 | Establecer precio inmediato | Staff (`pricing.write`) | BR-PRC-01 a BR-PRC-05 |
| UC-PRC-03 | Programar precio futuro | Staff (`pricing.write`) | BR-PRC-01, BR-PRC-05 |
| UC-PRC-04 | Cancelar precio programado no iniciado | Staff (`pricing.write`) | BR-PRC-04, ADR-0038 |
| UC-PRC-05 | Carga masiva de precios | Staff (`pricing.write`) | Formato PENDIENTE (T-145) |
| UC-PRC-06 | Resolver precio vigente | Sistema (API pública del módulo) | ADR-0039 |

Criterios de aceptación:

- **UC-PRC-02:** cierra el periodo vigente y abre uno nuevo; el monto es ≥ 0; el precio de comparación, si existe, es mayor que el monto; todo en MXN.
- **UC-PRC-03:** se rechaza un periodo que se superpone con otro de la misma variante.
- **UC-PRC-04:** un periodo ya iniciado no se puede cancelar.
- **UC-PRC-06:** devuelve el precio de la lista predeterminada vigente en el instante indicado.

### 5.4 Inventory

| ID | Caso de uso | Acceso | Reglas |
|---|---|---|---|
| UC-INV-01 | Gestionar almacén | Staff (`inventory.write`) | BR-INV-08, ADR-0038 |
| UC-INV-02 | Registrar entrada de stock | Staff (`inventory.write`) | BR-INV-05 |
| UC-INV-03 | Ajustar stock con motivo | Staff (`inventory.write`) | BR-INV-01, BR-INV-05, BR-INV-11, ADR-0069 |
| UC-INV-04 | Consultar stock y movimientos | Staff (`inventory.read`) | — |
| UC-INV-05 | Reservar stock | Sistema (checkout) | BR-INV-01 a BR-INV-04, BR-INV-07 |
| UC-INV-06 | Confirmar reserva | Sistema (pago confirmado) | BR-INV-06 |
| UC-INV-07 | Liberar reserva | Sistema (cancelación) | BR-INV-03 |
| UC-INV-08 | Expirar reservas | Sistema (job cada minuto) | BR-INV-07, ADR-0029 |
| UC-INV-09 | Reintegrar stock de una orden cancelada o con envío devuelto | Staff (`inventory.write`) | BR-INV-10, ADR-0052, ADR-0053 |

Criterios de aceptación:

- **UC-INV-03:** un ajuste que deje `onHand` por debajo de `reserved` o de cero se rechaza; todo ajuste registra movimiento y motivo, y se audita. El motivo se elige del catálogo de ADR-0069 y su dirección se valida (por ejemplo, Dañado solo resta); con "Otro", la nota es obligatoria.
- **UC-INV-05:** todo o nada; con N solicitudes concurrentes sobre el mismo stock nunca se reserva más que lo disponible (prueba de concurrencia contra PostgreSQL real); a lo sumo una reserva activa por orden.
- **UC-INV-06:** `onHand` y `reserved` disminuyen en la cantidad reservada; la reserva pasa a Committed.
- **UC-INV-08:** las reservas vencidas se liberan en el minuto siguiente a su vencimiento, por lotes e idempotente.
- **UC-INV-09:** solo para órdenes canceladas cuyo stock se había confirmado o con envío en Returned; admite cantidades parciales; la suma reintegrada por línea no supera lo vendido; genera movimiento con motivo y referencia a la orden; se audita. El motivo es Orden cancelada o Envío devuelto, según el caso.

### 5.5 Shopping

| ID | Caso de uso | Acceso | Reglas |
|---|---|---|---|
| UC-CRT-01 | Crear carrito | Público o Cliente | ADR-0010 |
| UC-CRT-02 | Agregar ítem | Público o Cliente | BR-CRT-01, BR-CRT-02 |
| UC-CRT-03 | Cambiar cantidad | Público o Cliente | BR-CRT-02 |
| UC-CRT-04 | Quitar ítem | Público o Cliente | — |
| UC-CRT-05 | Ver carrito con precios y disponibilidad | Público o Cliente | BR-CRT-04 |
| UC-CRT-06 | Fusionar carrito de invitado después de iniciar sesión | Cliente | BR-CRT-05, BR-CRT-09, ADR-0059 |
| UC-CRT-07 | Eliminar carritos de invitado inactivos | Sistema (job diario) | BR-CRT-06 |
| UC-CRT-08 | Restaurar el carrito al expirar una orden | Sistema (`OrderExpired`) | BR-CRT-10, ADR-0054 |
| UC-CRT-09 | Copiar una orden cancelada a un carrito | Cliente o invitado dueño de la orden; Staff (`orders.manage`) como apoyo | BR-CRT-11, ADR-0055 |

Criterios de aceptación:

- **UC-CRT-01:** el carrito de invitado se identifica con un `cartId` opaco, aleatorio y no adivinable devuelto por la API, sin cookies; un cliente registrado tiene a lo sumo un carrito activo; una cuenta de staff no puede tener carrito (BR-USR-08).
- **UC-CRT-02 / 03:** cantidad entre 1 y 30; agregar una variante existente suma a su línea; se rechaza una variante inexistente o no vendible.
- **UC-CRT-05:** precios calculados al leer desde Pricing; nunca se toman del carrito. Cada línea indica si la cantidad pedida puede surtirse, sin revelar la cantidad disponible (ADR-0061).
- **UC-CRT-06:** endpoint explícito que recibe el `cartId` del invitado; suma cantidades y limita cada línea a 30 sin aviso; si el cliente no tiene carrito activo, el carrito de invitado pasa a su cuenta; el carrito fusionado queda en Merged y ya no se puede modificar; repetir la fusión no vuelve a sumar; se rechaza un carrito con dueño o una cuenta de staff.
- **UC-CRT-08:** las líneas de la orden expirada se suman al carrito activo del cliente registrado o reactivan el carrito original (invitados, o registrados sin carrito activo); tope de 30 por línea sin aviso; idempotente ante eventos duplicados.
- **UC-CRT-09:** solo para órdenes Cancelled o Refunded; la orden no cambia; las líneas se suman al carrito con tope de 30; precios y disponibilidad son los actuales; variantes no vendibles se omiten; cuando lo hace el staff, las líneas van al carrito del cliente y la acción se audita.

### 5.6 Ordering

| ID | Caso de uso | Acceso | Reglas |
|---|---|---|---|
| UC-ORD-01 | Cotizar checkout | Público o Cliente | ADR-0019, BR-SHP-06, BR-TAX-02 |
| UC-ORD-02 | Colocar orden | Público o Cliente | BR-ORD-01 a BR-ORD-06, BR-USR-05, BR-USR-08 |
| UC-ORD-03 | Consultar mis pedidos | Cliente | ADR-0036 |
| UC-ORD-04 | Consultar pedido de invitado | Público | BR-ORD-10, ADR-0020 |
| UC-ORD-05 | Acceder al pedido con enlace por correo | Público | ADR-0020; implementación PENDIENTE (P-56) |
| UC-ORD-06 | Listar y ver pedidos | Staff (`orders.read`) | — |
| UC-ORD-07 | Cancelar pedido | Staff (`orders.manage`) | BR-CAN-01 a BR-CAN-03, ADR-0051 |
| UC-ORD-08 | Resolver pedido en AwaitingManualFulfillment | Staff (`orders.manage`) | ADR-0012 |
| UC-ORD-09 | Marcar orden pagada | Sistema (`PaymentCaptured`) | BR-ORD-08, BR-ORD-09 |
| UC-ORD-10 | Expirar órdenes impagas | Sistema (job cada minuto) | BR-ORD-07 |

Criterios de aceptación:

- **UC-ORD-01:** sin efectos secundarios; devuelve subtotal, IVA por línea, costo de envío (0 si se alcanza el umbral), total y disponibilidad; no usa cache.
- **UC-ORD-02:**
  - Exige el encabezado `Idempotency-Key` (ADR-0063): sin él responde 400; un reintento con la misma llave y el mismo contenido devuelve la misma respuesta sin crear otra orden; con contenido distinto responde 422; si la solicitud original sigue en proceso responde 409.
  - Recalcula todo sin cache; si el total difiere de `expectedTotal` responde 409 y no crea la orden.
  - Rechaza la orden de un cliente registrado sin email verificado, de una cuenta de staff, o con variantes no vendibles.
  - Reserva todo el stock o falla sin reservar nada.
  - En una sola transacción: reserva, crea la orden en PendingPayment con snapshots (SKU, nombre, opciones, precio, tasa e importe de IVA, dirección, costo de envío, descuento en 0) y marca el carrito como CheckedOut.
  - Un invitado debe indicar email de contacto, una dirección con el formato de ADR-0057 y la versión del aviso de privacidad presentada (ADR-0067).
  - La orden recibe un número interno consecutivo y un código público aleatorio único; la respuesta al cliente incluye solo el código público (ADR-0049).
- **UC-ORD-04:** requiere email y código público de la orden (ADR-0049); acepta el código sin distinguir mayúsculas y minúsculas; el error es idéntico si la orden no existe o el email no coincide; tiene rate limiting obligatorio.
- **UC-ORD-07:** rechazada desde Shipped o posterior; en PendingPayment pasa a Cancelled (terminal) y libera la reserva; en Paid o AwaitingManualFulfillment pasa a Cancelled e inicia el reembolso total (UC-PAY-03); en Paid, el staff con `inventory.write` puede elegir reintegrar el stock completo en la misma operación (ADR-0052); se audita.
- **UC-ORD-08:** si hay stock, reserva, confirma y pasa a Paid; si se decide no surtir, se cancela según UC-ORD-07.
- **UC-ORD-09:** con reserva vigente, la confirma y pasa a Paid; si la orden está Expired, aplica BR-ORD-09; idempotente ante eventos duplicados.
- **UC-ORD-10:** una orden en PendingPayment pasa a Expired junto con su reserva, y sus líneas regresan al carrito del cliente (UC-CRT-08).

### 5.7 Payments

| ID | Caso de uso | Acceso | Reglas |
|---|---|---|---|
| UC-PAY-01 | Iniciar pago | Público o Cliente | BR-PAY-01, BR-PAY-02, BR-PAY-12 |
| UC-PAY-02 | Registrar pago manual | Staff (`payments.manage`) | BR-PAY-09, BR-PAY-10, BR-PAY-12 |
| UC-PAY-03 | Iniciar reembolso total al cancelar | Sistema (cancelación de orden pagada) | BR-PAY-04, BR-CAN-02, ADR-0051 |
| UC-PAY-06 | Registrar reembolso manual | Staff (`payments.manage`) | BR-PAY-11, ADR-0051 |
| UC-PAY-07 | Reintentar reembolso fallido | Staff (`payments.manage`) | ADR-0051 |
| UC-PAY-04 | Procesar webhook de PayPal | Proveedor de pago | BR-PAY-05, BR-PAY-06; no habilitado (ADR-0040) |
| UC-PAY-05 | Conciliar pagos | Sistema (job cada 5 minutos) | ADR-0014, ADR-0029 |

Criterios de aceptación:

- **UC-PAY-01:** el monto se toma de la orden; exige `Idempotency-Key` con el mismo comportamiento que UC-ORD-02 (ADR-0063); devuelve una "acción requerida" genérica. Con el método manual, la acción requerida indica pago en tienda con el código público y el total (ADR-0055).
- **UC-PAY-02:** disponible solo si la variable de entorno lo habilita; produce `PaymentCaptured` y sigue el mismo flujo que un pago de proveedor; se audita. Solo sobre órdenes en PendingPayment o Expired; en cualquier otro estado se rechaza (ADR-0055).
- **UC-PAY-04:** firma inválida se rechaza; un evento repetido no produce efectos; un evento tardío no revierte un estado posterior.
- **UC-PAY-03 / 06 / 07:** el reembolso es por el total capturado; al confirmarse (webhook, conciliación o registro manual) la orden pasa a Refunded y el Payment a Refunded; si falla, la orden permanece en Cancelled y el staff puede reintentarlo; el registro manual solo está disponible con el pago manual habilitado y se audita; no existen reembolsos sin cancelación. Al registrar o reintentar el reembolso, el staff con `inventory.write` puede reintegrar el stock completo solo si la orden no tiene ningún reintegro previo (ADR-0052).
- **UC-PAY-05:** reejecuta la confirmación de pagos capturados cuya orden sigue en PendingPayment con más de 10 minutos.

### 5.8 Shipping

| ID | Caso de uso | Acceso | Reglas |
|---|---|---|---|
| UC-SHI-01 | Calcular costo de envío | Sistema (checkout) | BR-SHP-06, BR-SHP-07; base del umbral e IVA del envío PENDIENTE (P-58) |
| UC-SHI-02 | Configurar costo fijo y umbral de envío gratis | Staff (permiso PENDIENTE, P-48) | ADR-0042 |
| UC-SHI-03 | Crear envío en Pending | Sistema (`OrderPaid`) | BR-SHP-01, BR-SHP-02 |
| UC-SHI-04 | Registrar paquetería y guía | Staff (`shipping.manage`) | BR-SHP-04; envío sin paquetería PENDIENTE (P-57) |
| UC-SHI-05 | Marcar despachado | Staff (`shipping.manage`) | BR-SHP-04 |
| UC-SHI-06 | Marcar entregado | Staff (`shipping.manage`) | BR-SHP-03 |
| UC-SHI-07 | Marcar entrega fallida | Staff (`shipping.manage`) | ADR-0053 |
| UC-SHI-09 | Marcar envío como devuelto | Staff (`shipping.manage`) | ADR-0053 |
| UC-SHI-08 | Listar envíos pendientes | Staff (`shipping.manage`) | — |

Criterios de aceptación:

- **UC-SHI-01:** el costo es el fijo configurado, o 0 si se alcanza el umbral; queda como snapshot en la orden.
- **UC-SHI-03:** un solo envío por orden, creado de forma idempotente al recibir `OrderPaid`.
- **UC-SHI-05:** sin guía no se despacha cuando hay paquetería; la orden pasa a Shipped.
- **UC-SHI-06:** la orden pasa a Delivered; el envío queda en estado terminal.
- **UC-SHI-07 / 09:** solo desde Dispatched (fallida) y desde DeliveryFailed (devuelto); la orden permanece en Shipped; sin reintento, cancelación ni reembolso automáticos; el stock que regresa se reintegra con UC-INV-09.

### 5.9 Transversales

| ID | Caso de uso | Acceso | Reglas |
|---|---|---|---|
| UC-AUD-01 | Registrar evento de auditoría | Sistema | ADR-0037 |
| UC-AUD-02 | Consultar auditoría (últimos 3 meses) | Staff (`audit.read`) | ADR-0037 |
| UC-AUD-03 | Exportar y depurar auditoría | Sistema (job diario) | ADR-0037 |
| UC-NTF-01 | Enviar notificaciones por correo | Sistema | ADR-0045; qué eventos notifican PENDIENTE (P-45) |
| UC-SYS-01 | Limpieza diaria | Sistema (3:00, hora de México) | ADR-0029 |

Criterios de aceptación:

- **UC-AUD-01:** toda modificación del staff y todo evento de seguridad genera un registro en la misma transacción que el cambio; los valores de campos sensibles nunca se guardan.
- **UC-AUD-02:** paginación por cursor; ningún endpoint modifica ni borra registros.
- **UC-AUD-03:** los registros con más de 3 meses se exportan a JSON Lines con gzip (un archivo por día) y solo se borran si la exportación se verificó; los archivos con más de 2 años se borran.
- **UC-SYS-01:** borra refresh tokens vencidos o revocados (30 días), llaves de idempotencia (24 horas), eventos de webhooks (30 días) y carritos de invitado inactivos (30 días).

---

## 6. Flujos principales

### 6.1 Compra con pago manual (entorno de pruebas)

1. El cliente cotiza (UC-ORD-01) y coloca la orden (UC-ORD-02): reserva de 20 minutos, orden en PendingPayment.
2. El cliente recibe la indicación de pagar en tienda, con el código público y el total, y paga físicamente en la tienda (ADR-0055).
3. Un administrador registra el pago (UC-PAY-02) → `PaymentCaptured`.
4. Si la reserva sigue vigente: se confirma y la orden pasa a Paid. Si ya expiró: aplica ADR-0012 (reservar de nuevo o AwaitingManualFulfillment).
5. `OrderPaid` crea el envío en Pending (UC-SHI-03).
6. El staff registra guía, despacha y marca entregado (UC-SHI-04 a 06).

### 6.2 Compra con PayPal (futuro, no habilitado)

Igual que 6.1, pero el paso 2 lo inicia UC-PAY-01 y el paso 3 lo produce el webhook (UC-PAY-04) o la conciliación (UC-PAY-05).

### 6.3 Expiración

Cada minuto, las reservas vencidas pasan a Expired y sus órdenes en PendingPayment también (UC-INV-08, UC-ORD-10). Las líneas de la orden regresan al carrito del cliente (UC-CRT-08). Una orden cancelada nunca se reactiva; solo puede copiarse a un carrito (UC-CRT-09).

### 6.4 Cancelación

El staff con `orders.manage` cancela (UC-ORD-07). En PendingPayment la orden pasa a Cancelled y se libera la reserva. En Paid o AwaitingManualFulfillment pasa a Cancelled y se inicia el reembolso total; cuando se confirma (proveedor o registro manual, UC-PAY-06), la orden pasa a Refunded (ADR-0051). El stock se reintegra de forma opcional al cancelar una orden en Paid, o después con el proceso independiente de Inventory (UC-INV-09, ADR-0052).

### 6.5 Registro y verificación

Registro (UC-IAM-01) → correo con enlace de 24 horas → verificación (UC-IAM-02). Sin verificar, el cliente usa el carrito pero no coloca órdenes.

### 6.6 Alta de staff

Script para el primer superadministrador (UC-IAM-20) → el superadministrador crea cuentas con contraseña temporal (UC-IAM-13) → cambio obligatorio en el primer inicio de sesión (UC-IAM-09).

---

## 7. Catálogo de errores

Todas las respuestas de error usan RFC 9457 con `application/problem+json` (ADR-0035). Códigos según el criterio de ADR-0064; cada tipo de error tiene un `type` estable (URI relativa, por ejemplo `/problems/insufficient-stock`) cuyo slug exacto se fija en T-005. Todas incluyen `correlationId`; los errores de validación incluyen `errors` y el de stock insuficiente, `lines`.

| ID | Condición | HTTP | Casos de uso |
|---|---|---|---|
| E-01 | Entrada inválida (campos, `pageSize` > 100, `sort` o filtro no permitido) | 400 | Todos |
| E-02 | No autenticado o token vencido | 401 | Rutas `/v1/me` y `/v1/admin` |
| E-03 | Sin permiso para la acción | 403 | Rutas `/v1/admin` |
| E-04 | Recurso inexistente (incluida la consulta de invitado con datos que no coinciden) | 404 | Varios |
| E-05 | Conflicto de versión (bloqueo optimista) | 409 | Edición de aggregates |
| E-06 | Total recalculado distinto de `expectedTotal` | 409 (ADR-0019) | UC-ORD-02 |
| E-07 | Stock insuficiente al reservar | 409, con extensión `lines` | UC-ORD-02, UC-ORD-08 |
| E-08 | Email no verificado al colocar orden | 403 | UC-ORD-02 |
| E-09 | Cuenta de staff intenta comprar | 403 | UC-CRT-01, UC-ORD-02 |
| E-10 | Variante no vendible (no publicada, descontinuada o sin precio) | 409 | UC-CRT-02, UC-ORD-02 |
| E-11 | Cantidad fuera de 1–30 | 400 | UC-CRT-02, UC-CRT-03 |
| E-12 | Transición de estado inválida (por ejemplo, cancelar una orden enviada) | 409 | UC-ORD-07, UC-SHI-05 a 07 |
| E-13 | Valor único duplicado (email en el registro, SKU, slug) | 409 | UC-IAM-01, UC-CAT-04, UC-CAT-06 |
| E-14 | Borrado de entidad con referencias (rol con usuarios, categoría con productos) | 409 | UC-IAM-15, UC-CAT-12 |
| E-15 | Periodo de precio superpuesto o ya iniciado | 409 | UC-PRC-02 a 04 |
| E-16 | Credenciales inválidas | 401 | UC-IAM-04 |
| E-17 | Cuenta suspendida al renovar sesión | 401, igual que E-19 (en el login se responde como E-16, ADR-0062) | UC-IAM-05 |
| E-18 | Cambio de contraseña obligatorio | 403 | UC-IAM-04 |
| E-19 | Refresh token inválido, vencido o reutilizado | 401 | UC-IAM-05 |
| E-20 | Enlace de verificación o de recuperación usado, vencido o invalidado | 400 | UC-IAM-02, UC-IAM-08 |
| E-21 | Contraseña fuera de política o común | 400 | UC-IAM-01, 08, 09 |
| E-22 | Imagen con formato o tamaño no permitido | 413 (tamaño) / 415 (formato) | UC-CAT-11 |
| E-23 | Pago manual deshabilitado | 403 | UC-PAY-02 |
| E-24 | Firma de webhook inválida | 401 | UC-PAY-04 |
| E-25 | `Idempotency-Key` ausente (400), reutilizada con otro contenido (422) o con la solicitud original en proceso (409) | 400, 422, 409 (ADR-0063) | UC-ORD-02, UC-PAY-01 |
| E-26 | Límite de frecuencia excedido | 429, con `Retry-After` (ADR-0065) | UC-IAM-03, 04, UC-ORD-04 y otros |
| E-27 | Modificar un carrito que ya no está activo (CHECKED_OUT o MERGED) | 409 (ADR-0071) | UC-CRT-02 a 04, UC-CRT-06, UC-ORD-01, 02 |
| E-28 | Más de 10 direcciones (BR-ADR-04) | 409 (ADR-0071) | UC-IAM-11 |
| E-29 | Dejar el sistema sin superadministrador (BR-USR-03) | 409 (ADR-0071) | UC-IAM-14 a 16 |
| E-30 | Reintegro que supera lo vendido o con reintegro previo (ADR-0052) | 409 (ADR-0071) | UC-INV-09, UC-ORD-07, UC-PAY-06, 07 |
| E-31 | Anonimizar con órdenes sin concluir (ADR-0067) | 409 (ADR-0071) | UC-IAM-19 |
| E-32 | Editar SKU, opciones o slug después de la primera publicación (ADR-0068) | 409 (ADR-0071) | UC-CAT-05, 07 |
| E-33 | Cotizar o colocar orden con carrito vacío (BR-ORD-01) | 409 (ADR-0071) | UC-ORD-01, 02 |

---

## 8. Dependencias externas

| Dependencia | Uso | Estado | Fuente |
|---|---|---|---|
| PostgreSQL 18 | Persistencia | Definida | ADR-0025 |
| Disco del servidor | Imágenes y archivos de auditoría | Definida | ADR-0024, ADR-0037 |
| Capturador de correos local (por ejemplo, Mailpit) | Correos en desarrollo | Definida | ADR-0045 |
| Proveedor de correo real | Correos en producción | PENDIENTE (P-24) | — |
| PayPal | Pagos | Semiimplementado, no habilitado; verificación PENDIENTE (P-31) | ADR-0040 |
| Mercado Pago, Stripe | Pagos | Pospuestos | ADR-0040 |
| Paqueterías | Envíos | Sin integración | ADR-0041 |
| GitHub Actions, Dependabot | CI y dependencias | Definida | ADR-0030 |
| Hosting | Despliegue | Solo local; PENDIENTE (P-06) | ADR-0031 |

---

## 9. Requisitos no funcionales

### 9.1 Parámetros definidos

| Área | Requisito | Fuente |
|---|---|---|
| Consistencia | Sin sobreventa; reservas con actualización condicional y `CHECK` en base de datos; pruebas de concurrencia contra PostgreSQL real | ADR-0011, ADR-0033 |
| Idempotencia | `Idempotency-Key` en colocar orden e iniciar pago (retención 24 horas); webhooks deduplicados (30 días); jobs y handlers idempotentes | ADR-0014, ADR-0029 |
| Seguridad de autenticación | Token de acceso 15 minutos; refresh token 7 días con rotación y detección de reutilización; Argon2id; contraseñas de 15 a 64 caracteres con lista de comunes | ADR-0023, ADR-0047 |
| Rate limiting | Límites por endpoint de ADR-0065, configurables; 429 con `Retry-After`; sin bloqueo de cuentas | ADR-0065 |
| Autorización | RBAC contexto.acción; ID del cliente tomado del token en `/v1/me` | ADR-0017, ADR-0036, ADR-0043 |
| Rendimiento del catálogo | Cache en memoria de lecturas públicas con TTL de 120 s | ADR-0028 |
| Listados | Paginación por página, 20 por defecto, máximo 100 | ADR-0036 |
| Tiempos de negocio | Reserva de 20 minutos; expiración cada minuto; conciliación cada 5 minutos | ADR-0011, ADR-0029 |
| Retención | Auditoría 3 meses en base y 2 años en archivos; carritos de invitado 30 días; refresh tokens 30 días tras vencer | ADR-0029, ADR-0037 |
| Datos personales | Aviso de privacidad versionado; derechos ARCO por canal externo; anonimización definida; auditoría sin valores personales | ADR-0067 |
| Archivos | Imágenes JPEG, PNG, WebP de hasta 5 MB | ADR-0024 |
| Mantenibilidad | Monolito modular con límites verificados en CI | ADR-0003, ADR-0005, ADR-0030 |
| Testabilidad | Dominio sin dependencias de framework; reloj inyectable | ADR-0003 |
| Observabilidad | Logs en consola con nivel configurable e identificador de correlación | ADR-0032, ADR-0033 |
| Compatibilidad | Solo cambios compatibles dentro de `v1` | ADR-0034 |
| Independencia del frontend | Sin cookies ni supuestos de cliente | ADR-0010, ADR-0023 |
| Escalado | Una sola instancia (disco local, cache y jobs en proceso) | ADR-0024, ADR-0028, ADR-0029 |

### 9.2 Pendientes

- Disponibilidad, tiempos de respuesta y volumen esperado: PENDIENTE DE DECISIÓN (P-14).
- Métricas, trazas y seguimiento de errores: PENDIENTE DE DECISIÓN (P-07).
- CORS: PENDIENTE DE DECISIÓN (depende de clientes que aún no existen).
- Ciclo de conservación de datos personales en órdenes y envíos (operativa, bloqueo, anonimización): diseñado en ADR-0070, fuera del MVP; plazos PENDIENTES DE VALIDACIÓN LEGAL (P-61).

---

## 10. Contradicciones y ambigüedades detectadas

Cada punto está registrado en `PROGRESS.md` con lo que bloquea.

### Contradicciones

| ID | Descripción |
|---|---|
| ~~P-34~~ | Resuelta en ADR-0050: estados Pending, Dispatched, Delivered y DeliveryFailed; estados de paquetería previstos sin implementar |
| ~~P-35~~ | Resuelta en ADR-0049: número interno consecutivo y código público aleatorio |
| ~~P-36~~ | Resuelta en ADR-0051: Cancelled y, al confirmarse el reembolso, Refunded |
| ~~P-37~~ | Resuelta en ADR-0051: sin reembolsos independientes; el reembolso manual lo registra `payments.manage` |

### Ambigüedades

| ID | Descripción |
|---|---|
| ~~P-38~~ | Resuelta en ADR-0052: reintegro independiente, con opción de reintegro completo al cancelar |
| ~~P-39~~ | Resuelta en ADR-0053: la orden sigue en Shipped; devolución manual del envío y reintegro independiente |
| ~~P-40~~ | Resuelta en ADR-0054: las líneas regresan al carrito, sumando con tope de 30 |
| ~~P-41~~ | Resuelta en ADR-0055: pago físico en tienda; solo en PendingPayment o Expired; las órdenes canceladas no se reactivan |
| ~~P-42~~ | Resuelta en ADR-0056: enlace por correo de 30 minutos; URL base del frontend configurable; el cambio obligatorio del staff pide la contraseña temporal |
| ~~P-43~~ | Resuelta en ADR-0057: nombres y apellidos; formato de dirección con estado y municipio de lista cerrada del INEGI |
| ~~P-44~~ | Resuelta en ADR-0059: endpoint explícito después del login; `cartId` aleatorio |
| P-45 | Notificaciones: ¿qué eventos envían correo (orden colocada, pagada, enviada, entregada, cancelada)? |
| ~~P-46~~ | Resuelta en ADR-0061: disponible o agotado, sin cantidades |
| ~~P-47~~ | Resuelta en ADR-0060: búsqueda de texto completo, filtros y órdenes; excepción de solo lectura para el catálogo público |
| P-48 | Permiso para configurar el costo de envío y el umbral |
| P-49 | Reactivación de staff o clientes suspendidos, productos archivados, variantes descontinuadas y categorías desactivadas |
| ~~P-50~~ | Resuelta en ADR-0068: SKU y opciones editables solo antes de la primera publicación |
| ~~P-51~~ | Resuelta en ADR-0069: lista cerrada en código, con nota opcional (obligatoria con "Otro") |
| ~~P-52~~ | Resuelta en ADR-0063: obligatoria en colocar orden e iniciar pago; 400, 422 y 409 |
| ~~P-53~~ | Resuelta en ADR-0064 (códigos, `type` y extensiones) y ADR-0065 (rate limiting) |
| ~~P-54~~ | Resuelta en ADR-0062: el login solo indica credenciales no válidas |
| ~~P-55~~ | Resuelta en ADR-0062: el registro indica que el email ya existe |
| P-56 | Enlace de acceso al pedido por correo: ¿se implementa? Con el capturador local su costo de desarrollo es bajo |
| P-57 | ¿Existen envíos sin paquetería (entrega local, recoger en tienda)? BR-SHP-04 lo sugiere |
| P-58 | ¿El costo de envío lleva IVA? ¿El umbral de envío gratis se compara contra el subtotal con IVA? |
| ~~P-59~~ | Resuelta en ADR-0058: opcionales, en gramos y centímetros |
| ~~P-60~~ | Resuelta en ADR-0067: solicitud por canal externo, ejecutada por el staff |
| ~~P-62~~ | Resuelta en ADR-0072: se revocan las demás sesiones y se conserva la actual |
| ~~P-63~~ | Resuelta en ADR-0072: se permite, con riesgo aceptado de romper enlaces anteriores |

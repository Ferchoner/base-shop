# ARCHITECTURAL DECISION RECORDS

## Formato

Cada decisión importante debe registrar:

- ID
- Fecha
- Contexto
- Decisión
- Alternativas consideradas
- Consecuencias
- Estado

Estados posibles: Propuesta, Aceptada, Reemplazada, Rechazada.

## Índice

| ID | Título | Estado |
|---|---|---|
| ADR-0001 | Estado inicial | Reemplazada parcialmente por ADR-0002 |
| ADR-0002 | Stack tecnológico | Aceptada |
| ADR-0003 | Monolito modular con DDD pragmático | Aceptada |
| ADR-0004 | Mapa de bounded contexts | Aceptada |
| ADR-0005 | Integración entre contextos | Aceptada |
| ADR-0006 | Persistencia: una base de datos, un esquema | Aceptada |
| ADR-0007 | Dinero en centavos y una sola moneda | Aceptada |
| ADR-0008 | Tratamiento de impuestos | Aceptada |
| ADR-0009 | Estado único de la orden | Aceptada |
| ADR-0010 | Compra como invitado | Aceptada |
| ADR-0011 | Inventario: almacén, reservas y concurrencia | Aceptada |
| ADR-0012 | Pago recibido después de expirar la orden | Aceptada |
| ADR-0013 | Pagos: proveedores y modo de captura | Aceptada |
| ADR-0014 | Eventos de dominio sin outbox | Aceptada |
| ADR-0015 | Reglas del carrito | Aceptada |
| ADR-0016 | Publicación de productos | Aceptada |
| ADR-0017 | Granularidad de permisos | Aceptada |
| ADR-0018 | Alcance del MVP | Aceptada |
| ADR-0019 | Protocolo de checkout | Aceptada |
| ADR-0020 | Acceso de invitados a su pedido | Aceptada |
| ADR-0021 | Cancelación de órdenes | Aceptada |
| ADR-0022 | Integración de autenticación con Passport | Aceptada |
| ADR-0023 | Mecanismo de autenticación | Aceptada |
| ADR-0024 | Almacenamiento de imágenes | Aceptada |
| ADR-0025 | Versiones de runtime, base de datos y gestor de paquetes | Aceptada |
| ADR-0026 | País de operación y moneda | Aceptada |
| ADR-0027 | Tasa de IVA y facturación | Aceptada |
| ADR-0028 | Integración de cache | Aceptada |
| ADR-0029 | Jobs programados | Aceptada |
| ADR-0030 | Integración continua y estrategia de ramas | Aceptada |
| ADR-0031 | Hosting: solo entorno local por ahora | Aceptada |
| ADR-0032 | Configuración, secretos y observabilidad en entorno local | Aceptada |
| ADR-0033 | Herramientas de persistencia, transacciones, tests y trazabilidad | Aceptada |
| ADR-0034 | Versionado de la API | Aceptada |
| ADR-0035 | Formato de errores | Aceptada |
| ADR-0036 | Paginación, ordenamiento, filtros y organización de rutas | Aceptada |
| ADR-0037 | Auditoría técnica | Aceptada |
| ADR-0038 | Eliminación lógica | Aceptada |
| ADR-0039 | Listas de precios en el MVP | Aceptada |
| ADR-0040 | Pagos: método manual y preparación de PayPal | Aceptada |
| ADR-0041 | Envíos manuales | Aceptada |
| ADR-0042 | Costo de envío | Aceptada |
| ADR-0043 | Permisos, roles y cuentas del staff | Aceptada |
| ADR-0044 | Verificación de email para comprar | Aceptada |
| ADR-0045 | Envío de correos en desarrollo | Aceptada |
| ADR-0046 | Mecanismo de verificación de email | Aceptada |
| ADR-0047 | Política de contraseñas | Aceptada |
| ADR-0048 | Preparación para segundo factor (2FA) | Aceptada |
| ADR-0049 | Identificadores de la orden: consecutivo interno y código público | Aceptada |
| ADR-0050 | Estados del envío | Aceptada |
| ADR-0051 | Cancelación y reembolso de órdenes pagadas | Aceptada |
| ADR-0052 | Reintegro de stock de órdenes canceladas y devueltas | Aceptada |
| ADR-0053 | Entrega fallida y devolución | Aceptada |
| ADR-0054 | Restauración del carrito al expirar una orden | Aceptada |
| ADR-0055 | Pago manual en tienda y recompra de órdenes canceladas | Aceptada |
| ADR-0056 | Recuperación de contraseña y enlaces hacia el frontend | Aceptada |
| ADR-0057 | Datos del cliente y formato de dirección | Aceptada |
| ADR-0058 | Peso y dimensiones de variantes | Aceptada |
| ADR-0059 | Fusión de carritos e identificador del carrito de invitado | Aceptada |
| ADR-0060 | Búsqueda, filtros y consulta del catálogo público | Aceptada |
| ADR-0061 | Disponibilidad pública | Aceptada |
| ADR-0062 | Mensajes de login y registro | Aceptada |
| ADR-0063 | Comportamiento de `Idempotency-Key` | Aceptada |
| ADR-0064 | Códigos HTTP y tipos de error | Aceptada |
| ADR-0065 | Rate limiting | Aceptada |
| ADR-0066 | Modelo de datos y convenciones de persistencia | Aceptada |
| ADR-0067 | Datos personales: aviso de privacidad, derechos ARCO y anonimización | Aceptada |
| ADR-0068 | Edición de variantes | Aceptada |
| ADR-0069 | Motivos de movimientos de stock | Aceptada |
| ADR-0070 | Ciclo de conservación de datos personales en órdenes | Aceptada |
| ADR-0071 | Contratos REST y convenciones de la API | Aceptada |
| ADR-0072 | Sesiones al cambiar la contraseña y slugs de categorías y marcas | Aceptada |
| ADR-0073 | Herramienta de lint | Aceptada |
| ADR-0074 | Notificaciones por correo del ciclo de la orden | Propuesta |

---

## ADR-0001 — Estado inicial

### Contexto

El proyecto aún no tiene decisiones tecnológicas definitivas.

### Decisión

No asumir stack, proveedor de pagos, infraestructura o estrategia de autenticación hasta ser aprobado.

### Estado

Reemplazada parcialmente por ADR-0002 y ADR-0013 (2026-09-24). Sigue vigente para todo lo que continúa como PENDIENTE DE DECISIÓN (ver `PROGRESS.md`).

---

## ADR-0002 — Stack tecnológico

- **Fecha:** 2026-09-24
- **Contexto:** Se requiere un stack aprobado para iniciar el desarrollo.
- **Decisión:** Node.js, TypeScript, NestJS, PostgreSQL, Prisma ORM, API REST, Swagger/OpenAPI, Docker y Jest.
- **Alternativas consideradas:** No registradas; el stack fue definido por el equipo.
- **Consecuencias:** Autenticación, storage, cache, colas, CI/CD, hosting y observabilidad siguen pendientes (ver `PROJECT.md`). La versión de Node.js, la de PostgreSQL y el gestor de paquetes se definen en ADR-0025.
- **Estado:** Aceptada.

---

## ADR-0003 — Monolito modular con DDD pragmático

- **Fecha:** 2026-09-24
- **Contexto:** Se busca mantenibilidad sin complejidad prematura.
- **Decisión:**
  - Monolito modular. Cada bounded context se organiza en `domain`, `application`, `infrastructure` y `presentation`.
  - El dominio no depende de NestJS ni de Prisma. `@prisma/client` solo se usa en Infrastructure.
  - Las interfaces de repositories se definen en Domain; sus implementaciones, en Infrastructure.
  - Los puertos hacia servicios externos (pasarelas de pago, paqueterías, almacenamiento, reloj) se definen en Application.
  - Los DTOs HTTP pertenecen a Presentation y no se usan como objetos de dominio.
  - Los casos de uso pertenecen a Application; las reglas de negocio, a Domain.
  - Sin abstracciones genéricas innecesarias (no `BaseRepository<T>` ni `BaseEntity` con lógica).
  - Value Objects solo cuando existe una razón de negocio.
  - Sin Event Sourcing, microservicios ni CQRS complejo. Se permite "CQRS ligero": consultas de lectura que usan Prisma directamente en Infrastructure sin pasar por aggregates.
  - Shared kernel mínimo: `Money`, tipos de ID (branded types), error de dominio base y forma común de domain event.
  - Nivel de rigor por subdominio: core (Ordering, Inventory, Pricing) con modelado rico; supporting (Catalog, Shopping, Shipping) moderado; generic (Identity & Access, Payments) delgado.
- **Alternativas consideradas:** Microservicios; arquitectura en capas sin contextos.
- **Consecuencias:** Los límites entre módulos deben verificarse con herramientas en CI (ver ADR-0005).
- **Estado:** Aceptada.

---

## ADR-0004 — Mapa de bounded contexts

- **Fecha:** 2026-09-24
- **Contexto:** La propuesta inicial incluía Identity, Catalog, Pricing, Inventory, Shopping, Ordering, Payments, Shipping y Administration. La documentación previa listaba Auth, Users, Catalog, Inventory, Cart, Orders, Payments, Promotions y Admin.
- **Decisión:** Contextos: Identity & Access, Catalog, Pricing, Inventory, Shopping, Ordering, Payments y Shipping.
  - Administration no es un bounded context: cada contexto expone sus operaciones administrativas en su capa de presentación, protegidas por permisos.
  - La auditoría técnica es una capacidad transversal de infraestructura, no un contexto. La historia de negocio (historial de estados, movimientos de stock, periodos de precio) pertenece a cada contexto.
  - Auth y Users se unen en Identity & Access. Cart se llama Shopping; Orders, Ordering.
  - Promotions queda fuera del MVP (ADR-0018).
  - Notificaciones: módulo que solo reacciona a eventos, sin dominio propio.
  - Ordering es dueño del checkout.
- **Alternativas consideradas:** Mantener Administration como contexto (descartado: duplicaría reglas o accedería a repositorios ajenos).
- **Consecuencias:** El detalle de cada contexto está en `DOMAIN_MODEL.md`.
- **Estado:** Aceptada (aprobación formal 2026-09-24).

---

## ADR-0005 — Integración entre contextos

- **Fecha:** 2026-09-24
- **Contexto:** Se requiere que los módulos sean independientes y extraíbles.
- **Decisión:**
  - Cada módulo expone una fachada pública de aplicación con sus propios tipos. Nunca exporta entidades, aggregates ni repositorios.
  - El contexto consumidor define un puerto con lo que necesita, y un adaptador en su infraestructura llama a la fachada del otro contexto (capa anticorrupción ligera).
  - Entre contextos solo se comparten IDs, snapshots inmutables y eventos.
  - Sin relaciones de Prisma ni llaves foráneas entre contextos.
  - Los límites se verifican automáticamente (por ejemplo, `dependency-cruiser` o `eslint-plugin-boundaries`).
  - Excepción: la consulta del catálogo público puede leer tablas de Catalog, Pricing e Inventory, solo para lectura (ADR-0060).
- **Alternativas consideradas:** Acceso directo a repositorios de otros contextos; joins entre tablas de contextos distintos.
- **Consecuencias:** Los listados que combinan Catalog, Pricing e Inventory requieren fachadas con operaciones por lotes para evitar N+1.
- **Estado:** Aceptada (aprobación formal 2026-09-24).

---

## ADR-0006 — Persistencia: una base de datos, un esquema

- **Fecha:** 2026-09-24
- **Contexto:** Se evaluó usar esquemas de PostgreSQL separados por contexto.
- **Decisión:** Una sola base de datos PostgreSQL y un solo esquema. El esquema de Prisma se divide en archivos por contexto. Prisma Migrate para migraciones; las restricciones `CHECK` se añaden como SQL dentro de las migraciones porque el esquema de Prisma no las expresa.
- **Alternativas consideradas:** Un esquema de PostgreSQL por contexto.
- **Consecuencias:** El cliente de Prisma expone todas las tablas a cualquier infraestructura; la separación depende de las reglas de ADR-0005. Prisma no hace seguimiento de cambios: los repositorios necesitan mapeadores y comparación de colecciones hijas, lo que refuerza mantener los aggregates pequeños.
- **Estado:** Aceptada.

---

## ADR-0007 — Dinero en centavos y una sola moneda

- **Fecha:** 2026-09-24
- **Decisión:** Los montos se representan como enteros en la unidad mínima (centavos) mediante el Value Object `Money`, que incluye la moneda. Una sola moneda en operación, pero la moneda se guarda en `Money` y en cada lista de precios.
- **Alternativas consideradas:** `Decimal` de PostgreSQL; multimoneda desde el inicio.
- **Consecuencias:** Aritmética sin errores de redondeo en el almacenamiento. Pasar a multimoneda no requiere cambiar la estructura de datos. La moneda es MXN (ADR-0026).
- **Estado:** Aceptada.

---

## ADR-0008 — Tratamiento de impuestos

- **Fecha:** 2026-09-24
- **Decisión:** Cada lista de precios indica si sus precios incluyen impuesto; el valor por defecto es "incluido". El impuesto se calcula y redondea por línea de orden.
- **Alternativas consideradas:** Precios siempre sin impuesto; redondeo sobre el total.
- **Consecuencias:** El desglose por línea es consistente con el total. Tasas aplicables y reglas por producto: PENDIENTE DE DECISIÓN.
- **Estado:** Aceptada.

---

## ADR-0009 — Estado único de la orden

- **Fecha:** 2026-09-24
- **Decisión:** La orden tiene un solo campo `status`, en lugar de separar estado de pago y de surtido.
- **Estados:** PendingPayment, Paid, AwaitingManualFulfillment, Shipped, Delivered, Cancelled, Expired, Refunded. Los reembolsos parciales no cambian el estado de la orden; su detalle vive en Payment.
- **Alternativas consideradas:** Tres dimensiones (status, paymentStatus, fulfillmentStatus).
- **Consecuencias:** Viable porque no hay envíos parciales ni promociones en el MVP. Si se habilitan envíos parciales o devoluciones, revisar esta decisión.
- **Estado:** Aceptada, incluida la lista de estados (aprobación formal 2026-09-24).

---

## ADR-0010 — Compra como invitado

- **Fecha:** 2026-09-24
- **Decisión:** Se permite comprar sin cuenta. La orden tiene `customerId` opcional y email de contacto obligatorio. El carrito de invitado se identifica con un `cartId` opaco que devuelve la API; no se asumen cookies.
- **Estado:** Aceptada.

---

## ADR-0011 — Inventario: almacén, reservas y concurrencia

- **Fecha:** 2026-09-24
- **Decisión:**
  - Opera un solo almacén. La asignación se implementa como domain service para permitir múltiples almacenes en el futuro.
  - `onHand` disminuye al confirmarse el pago (commit de la reserva). El despacho solo se refleja como estado en Shipping.
  - El carrito no reserva stock; se reserva en el checkout.
  - La reserva usa actualización condicional atómica (solo incrementa `reserved` si `onHand − reserved ≥ cantidad`), más una restricción `CHECK (reserved >= 0 AND reserved <= on_hand)` en la base de datos.
  - TTL de reserva fijo, configurable, con valor inicial de 20 minutos.
- **Alternativas consideradas:** `SELECT … FOR UPDATE`; división entre almacenes; descuento de stock al despachar; TTL por método de pago.
- **Consecuencias:** Requiere pruebas de concurrencia contra PostgreSQL real. El TTL corto obliga a no ofrecer métodos de pago asíncronos (ADR-0013).
- **Estado:** Aceptada.

---

## ADR-0012 — Pago recibido después de expirar la orden

- **Fecha:** 2026-09-24
- **Decisión:** Si llega un pago capturado para una orden expirada, se intenta reservar stock y procesar la orden. Si no hay stock, la orden pasa a AwaitingManualFulfillment para resolución manual por el staff (conseguir stock y pasar a Paid, o cancelar con reembolso).
- **Alternativas consideradas:** Reembolso automático; reembolso siempre.
- **Consecuencias:** Requiere una vista administrativa de órdenes en AwaitingManualFulfillment. Con captura inmediata (ADR-0013), una cancelación en este estado implica reembolso.
- **Estado:** Aceptada.

---

## ADR-0013 — Pagos: proveedores y modo de captura

- **Fecha:** 2026-09-24
- **Decisión:**
  - Proveedores previstos: PayPal, Mercado Pago y Stripe. Un adaptador por proveedor detrás del puerto `PaymentGateway`; cada uno traduce los estados del proveedor a los estados del dominio.
  - Captura inmediata. El modelo conserva el estado `Authorized` para poder pasar después a "autorizar y capturar tras validar internamente".
  - El puerto no incluye todavía operaciones de captura ni anulación; se agregan cuando se active ese modo.
  - Sin métodos de pago asíncronos en el lanzamiento. En Mercado Pago se excluyen explícitamente los pagos en efectivo y por transferencia.
  - Un `Payment` por orden, con intentos y reembolsos como entidades internas.
  - Nunca se almacenan datos de tarjeta; solo referencias y tokens del proveedor.
- **Alternativas consideradas:** Autorizar al pagar y capturar al despachar; autorizar y capturar tras validar.
- **Revisar si:** los casos de AwaitingManualFulfillment dejan de ser raros, hay muchas cancelaciones de órdenes pagadas antes del envío, o se habilitan métodos asíncronos.
- **Pendiente:** orden de integración de los proveedores y cuáles entran en el MVP; verificar ventanas de autorización y devolución de comisiones de cada proveedor.
- **Estado:** Aceptada.

---

## ADR-0014 — Eventos de dominio sin outbox

- **Fecha:** 2026-09-24
- **Decisión:** Los eventos se despachan en proceso después del commit, sin transactional outbox. Mitigaciones obligatorias:
  - Job de conciliación que detecta Payments capturados cuyas órdenes siguen en PendingPayment y reejecuta la confirmación.
  - Handlers idempotentes.
  - Registro en logs de cada fallo o interrupción de handlers.
- **Alternativas consideradas:** Outbox para todos los eventos; outbox solo para la cadena pago → orden → inventario.
- **Riesgo aceptado:** Una notificación (por ejemplo, un correo) puede perderse si la aplicación se cae justo después del commit.
- **Revisar si:** los logs muestran fallos frecuentes de handlers, o el negocio pasa a depender de una notificación (por ejemplo, la confirmación como comprobante).
- **Estado:** Aceptada.

---

## ADR-0015 — Reglas del carrito

- **Fecha:** 2026-09-24
- **Decisión:**
  - El carrito no guarda el precio como verdad; se calcula al leer consultando Pricing.
  - Máximo 30 unidades por línea.
  - Al iniciar sesión, el carrito de invitado se fusiona con el de la cuenta sumando cantidades; cada línea se limita a 30 sin enviar aviso al cliente. El carrito devuelto refleja las cantidades finales.
- **Estado:** Aceptada.

---

## ADR-0016 — Publicación de productos

- **Fecha:** 2026-09-24
- **Decisión:**
  - Se puede publicar un producto sin precio vigente. La consulta de la tienda oculta las variantes sin precio vigente, y el producto completo si ninguna tiene precio. El checkout vuelve a validar.
  - Publicar no exige imagen. La API siempre devuelve un arreglo de imágenes, vacío si no hay, nunca `null`.
  - Las imágenes se almacenan detrás de un puerto; el dominio solo guarda la referencia.
- **Consecuencias:** El listado de administración debe indicar qué productos publicados no son visibles por falta de precio.
- **Estado:** Aceptada.

---

## ADR-0017 — Granularidad de permisos

- **Fecha:** 2026-09-24
- **Decisión:** Permisos por contexto y acción (por ejemplo, `catalog.write`, `orders.manage`). El catálogo de permisos se define en código, declarado por cada módulo. Los roles se editan en base de datos. Identity guarda las asignaciones sin conocer el significado de cada permiso.
- **Alternativas consideradas:** Permisos por recurso y acción.
- **Estado:** Aceptada.

---

## ADR-0018 — Alcance del MVP

- **Fecha:** 2026-09-24
- **Decisión:**
  - Promociones y cupones fuera del MVP; la orden guarda un campo de descuento desde el inicio.
  - Devoluciones fuera del MVP; `Refund` se modela dentro de `Payment`.
  - Notificaciones como módulo que reacciona a eventos.
  - Libreta de direcciones en Identity & Access como aggregate separado; se extrae si crece.
  - Sin envíos parciales: una orden genera un envío, con el modelo Shipment → ítems preparado para envíos parciales.
- **Estado:** Aceptada.

---

## ADR-0019 — Protocolo de checkout

- **Fecha:** 2026-09-24
- **Decisión:**
  - `QuoteCheckout`: sin efectos secundarios; devuelve totales, opciones de envío y disponibilidad.
  - `PlaceOrder`: recibe cartId, dirección, opción de envío, `expectedTotal` e `Idempotency-Key`. Si el total recalculado no coincide con `expectedTotal`, responde 409.
  - Una transacción cubre: validar carrito, cotizar precios, reservar stock, crear la orden en PendingPayment y marcar el carrito. La llamada al proveedor de pagos ocurre fuera de la transacción.
  - Esta transacción toca Ordering, Inventory y Shopping: es un acoplamiento transaccional consciente, aceptable en el monolito. Si se separa Inventory, se convierte en saga.
- **Estado:** Aceptada (aprobación formal 2026-09-24).

---

## ADR-0020 — Acceso de invitados a su pedido

- **Fecha:** 2026-09-24
- **Contexto:** Se permite compra como invitado (ADR-0010) y el invitado necesita consultar su pedido sin cuenta.
- **Decisión:**
  - Mecanismo base (MVP): el invitado consulta su pedido con email de contacto y el código público de la orden (ADR-0049).
  - Mecanismo adicional, si su costo es bajo: enlace de acceso enviado por correo, con token firmado y fecha de expiración.
- **Alternativas consideradas:** Solo enlace por correo; obligar a crear cuenta.
- **Consecuencias:**
  - El identificador que usa el invitado no es adivinable (código aleatorio, ADR-0049); junto con el email y el rate limiting, impide la enumeración.
  - La respuesta de error no debe revelar si existe una orden con ese número o ese email.
  - El enlace por correo depende del proveedor de correo (P-24).
- **Estado:** Aceptada. El enlace por correo queda condicionado a su costo.

---

## ADR-0021 — Cancelación de órdenes

- **Fecha:** 2026-09-24
- **Contexto:** Faltaba definir quién puede cancelar una orden.
- **Decisión:**
  - Solo el personal con permiso de gestión de órdenes (`orders.manage`) puede cancelar. Ese permiso se asigna a administradores y roles de nivel alto.
  - El cliente no puede cancelar desde la API.
  - Se puede cancelar en PendingPayment, Paid y AwaitingManualFulfillment. No se cancela una orden en Shipped o posterior (BR-CAN-01).
  - Cancelar una orden pagada implica reembolso total.
- **Consecuencias:** Cualquier solicitud de cancelación del cliente se atiende por un canal externo a la API. Los roles con `orders.manage` son Administrador y Superadministrador (ADR-0043).
- **Estado:** Aceptada.

---

## ADR-0022 — Integración de autenticación con Passport

- **Fecha:** 2026-09-24
- **Contexto:** P-01 requería definir cómo se implementa la autenticación.
- **Decisión:** Se usa Passport mediante su integración oficial para NestJS (`@nestjs/passport`).
- **Ubicación en la arquitectura:**
  - Las estrategias de Passport viven en Infrastructure de Identity & Access; los guards, en Presentation.
  - Las estrategias delegan en casos de uso de Application (por ejemplo, Authenticate). La validación de credenciales y las reglas (usuario suspendido, BR-USR-02) no se implementan dentro de la estrategia.
  - El dominio no depende de Passport (ADR-0003).
- **Consecuencias:** Passport define cómo se conectan las estrategias, no el mecanismo de sesión. El mecanismo concreto se define en ADR-0023. Los guards de autorización por permiso (ADR-0017) son independientes de Passport.
- **Estado:** Aceptada.

---

## ADR-0023 — Mecanismo de autenticación

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-01 sobre la integración de Passport (ADR-0022).
- **Decisión:**
  - Login con estrategia local de Passport (email y contraseña), usada solo en el endpoint de login.
  - Solicitudes autenticadas con estrategia JWT: token de acceso de corta duración, unos 15 minutos, configurable.
  - Transporte en el encabezado `Authorization: Bearer`. La API no usa cookies para autenticación.
  - Renovación con refresh token opaco, guardado con hash en base de datos y rotado en cada uso. Duración: 7 días, configurable.
  - Detección de reutilización: si se presenta un refresh token ya rotado, se revocan todos los tokens de esa sesión y el usuario debe volver a iniciar sesión.
  - Hash de contraseñas con Argon2id.
- **Alternativas consideradas:** Sesiones del lado del servidor; JWT de larga duración sin refresh token; tokens en cookies.
- **Consecuencias:**
  - Revocación: suspender un usuario (`UserSuspended`) o cerrar sesión revoca sus refresh tokens. El token de acceso sigue siendo válido hasta que vence, así que el margen de acceso tras una revocación es la duración del token de acceso.
  - Al no usar cookies, CSRF no aplica a la autenticación de la API.
  - Se agrega la tabla de refresh tokens en Identity & Access.
  - La clave de firma de los JWT es un secreto y se gestiona según ADR-0032.
  - Cada refresh token pertenece a una sesión (familia de tokens), para poder revocarla completa al detectar reutilización.
  - Con 7 días sin renovar, el usuario debe volver a iniciar sesión.
- **Estado:** Aceptada.

---

## ADR-0024 — Almacenamiento de imágenes

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-02. Las imágenes de productos necesitan almacenamiento y enlaces públicos.
- **Decisión:**
  - Por ahora, las imágenes se guardan en el disco del servidor.
  - A futuro se busca migrar a un CDN para el almacenamiento y la generación de enlaces.
  - Para que esa migración no toque el dominio ni los datos:
    - El puerto de almacenamiento (Application) tiene un adaptador de disco local (Infrastructure). El CDN será otro adaptador.
    - La base de datos guarda la clave de almacenamiento (ruta relativa), nunca la URL completa.
    - La URL pública se construye al responder, a partir de la clave y una URL base configurable.
- **Alternativas consideradas:** Almacenamiento de objetos o CDN desde el inicio.
- **Consecuencias:**
  - Si la API corre en Docker, la carpeta de imágenes debe ser un volumen persistente; si no, las imágenes se pierden al recrear el contenedor.
  - Con varias instancias de la API, el disco local no se comparte. Mientras se use disco, la API corre en una sola instancia o sobre un volumen compartido.
  - Las imágenes deben incluirse en los respaldos del servidor.
  - Quién sirve las imágenes (la propia API o un servidor web delante) depende del hosting (P-06).
  - Formatos permitidos: JPEG, PNG y WebP. Tamaño máximo: 5 MB por imagen, configurable. Un archivo fuera de estos límites se rechaza.
- **Revisar si:** se necesita más de una instancia de la API, el volumen de imágenes crece o se requieren varios tamaños de imagen.
- **Estado:** Aceptada.

---

## ADR-0025 — Versiones de runtime, base de datos y gestor de paquetes

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-20. Estado de las versiones a esta fecha:
  - Node.js: 22 en Maintenance LTS (fin de soporte en abril de 2027), 24 en Active LTS (fin de soporte en abril de 2028), 26 en Current (entra a LTS en octubre de 2026).
  - PostgreSQL: 18 es la versión estable actual; 19 está en beta, con versión final planeada para octubre de 2026.
  - Prisma soporta oficialmente Node.js ^20.19, ^22.12 y ^24, y PostgreSQL hasta la versión 18.
- **Decisión:**
  - Node.js 24 (Active LTS).
  - PostgreSQL 18.
  - npm como gestor de paquetes.
  - Se fija la versión mayor y se usa siempre la última actualización menor (imágenes de Docker `node:24` y `postgres:18`).
- **Alternativas consideradas:** Node.js 26 (un año más de soporte, pero sin soporte oficial de Prisma a la fecha); PostgreSQL 19 (sin versión final ni soporte listado en Prisma); pnpm.
- **Consecuencias:**
  - La versión de Node.js se declara en el proyecto (campo `engines` de `package.json` y archivo de versión para el entorno local) para que todos usen la misma.
  - El archivo de bloqueo de npm (`package-lock.json`) se versiona en Git.
  - Subir a Node.js 26 es un cambio menor (Dockerfile, CI y pruebas); cambiar de versión mayor de PostgreSQL con datos requiere una migración de la base.
- **Revisar si:** Prisma y NestJS soportan oficialmente Node.js 26 (candidato a actualización planeada), o si se acerca el fin de soporte de Node.js 24 (abril de 2028).
- **Estado:** Aceptada.

---

## ADR-0026 — País de operación y moneda

- **Fecha:** 2026-09-24
- **Contexto:** Cierra parcialmente P-10 (se completa en ADR-0027).
- **Decisión:**
  - País de operación: México.
  - Moneda: peso mexicano (MXN), por ahora la única moneda (ADR-0007). Los montos se guardan en centavos.
- **Consecuencias:**
  - El impuesto aplicable es el IVA (ver ADR-0027).
  - Formato de direcciones (ADR-0057) y datos personales (ADR-0067) se definen con base en México.
- **Estado:** Aceptada.

---

## ADR-0027 — Tasa de IVA y facturación

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-10 y P-30.
- **Decisión:**
  - Todos los productos se venden con IVA del 16%. No hay productos a tasa 0% ni exentos, y no se aplica el estímulo de la región fronteriza.
  - La tasa es un valor de configuración, no una constante en el código.
  - No habrá emisión de facturas electrónicas (CFDI) por ahora; no se guardan datos fiscales del cliente.
- **Alternativas consideradas:** Clase de impuesto por producto (propuesta, no adoptada mientras no existan excepciones).
- **Consecuencias:**
  - Cada línea de orden guarda como snapshot la tasa aplicada y el monto de impuesto, para que un cambio futuro de tasa no altere órdenes existentes.
  - Si aparece un producto con otra tasa, se agrega una clase de impuesto por producto con valor por defecto del 16%, sin afectar las órdenes históricas.
  - Los clientes que requieran factura no pueden obtenerla desde la API.
- **Revisar si:** se venden productos a tasa 0% o exentos, el negocio obtiene el estímulo fronterizo, o se requiere emitir facturas.
- **Estado:** Aceptada.

---

## ADR-0028 — Integración de cache

- **Fecha:** 2026-09-24
- **Contexto:** P-03 requería definir la cache.
- **Decisión:** Se usa la integración oficial de NestJS para cache (`@nestjs/cache-manager`).
- **Ubicación en la arquitectura:**
  - La cache vive en Infrastructure o Presentation; Domain y Application no dependen de ella.
  - Si un caso de uso necesita cache explícita, lo hace a través de un puerto propio, no de la librería directamente.
- **Reglas:**
  - Nunca se usa cache para decisiones que requieren consistencia: disponibilidad de stock en el checkout, precios al colocar una orden, estado de pagos, carrito, permisos de autorización y tokens.
  - Todo valor en cache tiene TTL.
- **Almacén y uso:**
  - Almacén en memoria del proceso, coherente con operar una sola instancia (ADR-0024).
  - Se cachean solo lecturas públicas del catálogo: árbol de categorías, detalle de producto y listados de la tienda sin texto de búsqueda (ADR-0060).
  - TTL de 120 segundos, configurable.
  - Invalidación inmediata por eventos de Catalog (`ProductPublished`, `ProductArchived`, `VariantDiscontinued`); el resto de cambios (precios, disponibilidad, precios programados que entran en vigor) se reflejan al vencer el TTL.
- **Consecuencias:**
  - Un listado puede mostrar hasta 120 segundos un precio o una disponibilidad desactualizados. El checkout no usa cache y valida el total con `expectedTotal` (ADR-0019).
  - La cache se pierde al reiniciar la API; solo afecta el rendimiento de las primeras solicitudes.
  - Si la API se escala a varias instancias, se cambia a un almacén compartido (por ejemplo, Redis) sin tocar el código que usa la cache.
- **Estado:** Aceptada.

---

## ADR-0029 — Jobs programados

- **Fecha:** 2026-09-24
- **Contexto:** P-04 requería un mecanismo para jobs periódicos (ADR-0011, ADR-0014).
- **Decisión:**
  - Se usa la integración oficial de NestJS para tareas programadas (`@nestjs/schedule`), ejecutada dentro del proceso de la API. No se usa una cola de mensajes por ahora.
  - Jobs y frecuencias:
    - Expiración de reservas y de órdenes impagas: cada minuto.
    - Conciliación de pagos: cada 5 minutos, revisando solo pagos con más de 10 minutos sin resolver. Consulta al proveedor los pagos cuyo webhook no llegó y reejecuta la confirmación de pagos capturados cuya orden sigue en PendingPayment.
    - Limpieza diaria a las 3:00 (hora de México):
      - Refresh tokens vencidos o revocados: se borran después de 30 días.
      - Llaves de idempotencia: se borran después de 24 horas.
      - Eventos de webhooks procesados: se borran después de 30 días.
      - Carritos de invitado sin actividad: se borran después de 30 días. Los carritos de usuarios registrados se conservan.
  - No requieren job: los precios programados (se resuelven al consultar) y la cache (expira por TTL).
- **Reglas para todos los jobs:**
  - El job es solo un punto de entrada en Infrastructure: llama a un caso de uso de Application, igual que un controlador.
  - Si la ejecución anterior sigue en curso, la siguiente se omite (sin ejecuciones superpuestas).
  - Procesa por lotes con un límite por ejecución; cada elemento en su propia transacción, para que un fallo no revierta el lote.
  - Es idempotente: procesar dos veces el mismo elemento no produce efectos duplicados.
  - Cada fallo se registra en los logs.
  - Los horarios de los jobs diarios usan la zona horaria de México (America/Mexico_City).
- **Consecuencias:**
  - Con el TTL de 20 minutos y ejecución cada minuto, una reserva vencida puede seguir ocupando stock hasta un minuto extra.
  - Los jobs corren en el mismo proceso que la API, lo cual es coherente con operar una sola instancia (ADR-0024). Si se escala a varias instancias, cada una ejecutaría los jobs: habrá que agregar un bloqueo en PostgreSQL (advisory lock) o mover los jobs a un proceso separado.
- **Estado:** Aceptada.

---

## ADR-0030 — Integración continua y estrategia de ramas

- **Fecha:** 2026-09-24
- **Contexto:** Cierra la parte de CI de P-05. La parte de despliegue (CD) depende del hosting (P-06).
- **Decisión:**
  - El repositorio está en GitHub; la CI usa GitHub Actions.
  - El pipeline corre en cada pull request y en cada cambio a la rama principal, en este orden:
    1. Instalación con `npm ci`.
    2. Lint y formato.
    3. Verificación de límites entre módulos (ADR-0003, ADR-0005).
    4. Compilación de TypeScript.
    5. Tests unitarios.
    6. Tests de integración contra PostgreSQL 18 real.
    7. Verificación de migraciones: se aplican desde cero y el esquema de Prisma no difiere de ellas.
    8. Auditoría de dependencias: falla con vulnerabilidades altas y críticas; las demás solo se reportan.
    9. Detección de secretos.
    10. Construcción de la imagen de Docker.
  - La rama principal está protegida: solo se fusiona mediante pull request con el pipeline en verde.
  - Estrategia de ramas: rama principal siempre desplegable y ramas cortas por tarea (GitHub Flow).
  - Sin porcentaje mínimo de cobertura al inicio. Los tests de dominio y de concurrencia se exigen por la Definition of Done.
  - Dependabot abre pull requests de actualización de dependencias agrupados semanalmente; cada uno pasa por el pipeline.
- **Alternativas consideradas:** GitFlow; porcentaje mínimo de cobertura; fallar con cualquier vulnerabilidad.
- **Consecuencias:**
  - La protección de la rama principal y la activación de Dependabot se configuran en GitHub; requieren permisos de administrador del repositorio.
  - Herramientas concretas de lint, formato, límites y detección de secretos se eligen en las tareas correspondientes (T-103, T-104, T-106).
  - Despliegue continuo: pospuesto mientras no haya hosting (ADR-0031).
- **Estado:** Aceptada.

---

## ADR-0031 — Hosting: solo entorno local por ahora

- **Fecha:** 2026-09-24
- **Contexto:** P-06. Requisitos del hosting según decisiones previas: proceso siempre encendido (jobs y cache en memoria, ADR-0028, ADR-0029), disco persistente para imágenes (ADR-0024), PostgreSQL 18 y Docker.
- **Decisión:**
  - Por ahora no hay hosting: el proyecto corre solo en el entorno local de desarrollo con Docker Compose.
  - Candidatos para cuando se necesite un entorno compartido (desarrollo del frontend, demos, pruebas de pago de punta a punta): Oracle Cloud Always Free (costo cero, condiciones sujetas a cambios sin aviso) o un VPS de bajo costo (estable, pocos dólares al mes). En ambos casos, Docker Compose en un servidor propio.
- **Alternativas descartadas:**
  - GitHub Pages: solo publica sitios estáticos; no ejecuta Node.js ni PostgreSQL.
  - Nivel gratuito de Render: los servicios se apagan por inactividad (rompe jobs y cache), el sistema de archivos es efímero (pierde imágenes) y la base de datos gratuita expira a los 30 días.
- **Consecuencias:**
  - El despliegue continuo (CD, P-05) queda pospuesto. La CI en GitHub Actions funciona igual.
  - Quién sirve las imágenes en producción se decide al elegir hosting.
  - Las pruebas de webhooks de pago quedan pendientes (P-31): los proveedores no pueden llamar a un entorno local sin un túnel.
- **Revisar cuando:** se necesite un entorno compartido o se prepare el lanzamiento.
- **Estado:** Aceptada.

---

## ADR-0032 — Configuración, secretos y observabilidad en entorno local

- **Fecha:** 2026-09-24
- **Contexto:** P-13 y P-07, condicionadas por ADR-0031 (solo entorno local).
- **Decisión:**
  - Toda la configuración y los secretos se leen de variables de entorno. En local, desde un archivo `.env` que nunca se versiona.
  - El repositorio incluye un archivo `.env.example` con todas las variables que usa el proyecto (configuración, secretos y observabilidad), cada una con una descripción y un valor de ejemplo no real. Al desplegar, sirve como base: se copia y se completan los valores reales.
  - Toda variable nueva se agrega a `.env.example` en el mismo cambio que la introduce (parte de la Definition of Done).
  - La configuración se valida al arrancar: si falta una variable obligatoria, la API no inicia.
  - Observabilidad en local: logs en consola con nivel configurable por variable de entorno. Herramientas de métricas, trazas y seguimiento de errores se deciden junto con el hosting.
- **Consecuencias:**
  - El archivo `.env` debe estar en `.gitignore`; la detección de secretos de la CI (ADR-0030) es la segunda barrera.
  - Al elegir hosting se decidirá dónde viven los secretos en el servidor (P-13) y las herramientas de observabilidad (P-07).
- **Estado:** Aceptada.

---

## ADR-0033 — Herramientas de persistencia, transacciones, tests y trazabilidad

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-26: propuestas que estaban pendientes de confirmación.
- **Decisión:**
  - Migraciones con Prisma Migrate; las restricciones `CHECK` se agregan como SQL en la migración correspondiente (ADR-0006).
  - Contexto transaccional con `nestjs-cls` y su plugin transaccional para Prisma. Los repositorios obtienen la transacción activa sin que Application ni Domain dependan de Prisma.
  - Tests de integración contra PostgreSQL 18 real en Docker, localmente y en la CI (ADR-0030). No se usan mocks de base de datos para repositorios, transacciones ni concurrencia.
  - Identificador de correlación por solicitud HTTP, incluido en todos los logs que esa solicitud genera.
- **Consecuencias:** Las pruebas de concurrencia de inventario y checkout (ADR-0011) se ejecutan contra la base real, que es la única forma de detectar sobreventa.
- **Estado:** Aceptada.

---

## ADR-0034 — Versionado de la API

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-08.
- **Decisión:** Versionado por prefijo en la ruta. Todos los endpoints viven bajo `/v1` (por ejemplo, `/v1/catalog/products`), incluidos los endpoints administrativos y los webhooks de pago.
- **Alternativas consideradas:** Versionado por encabezado o por tipo de contenido.
- **Consecuencias:**
  - Dentro de `v1` solo se hacen cambios compatibles con clientes existentes (agregar campos o endpoints). Un cambio incompatible requiere una nueva versión.
  - La especificación OpenAPI se genera para `v1`.
  - Política para retirar versiones antiguas: se define cuando exista una segunda versión.
- **Estado:** Aceptada.

---

## ADR-0035 — Formato de errores

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-09.
- **Decisión:** Todas las respuestas de error siguen el estándar RFC 9457 (Problem Details for HTTP APIs), con tipo de contenido `application/problem+json` y los campos del estándar: `type`, `title`, `status`, `detail` e `instance`.
- **Alternativas consideradas:** Formato propio.
- **Consecuencias:**
  - Los errores de dominio se traducen a Problem Details en la capa de presentación; Domain no conoce HTTP.
  - Nunca se incluyen stack traces ni detalles internos en producción (`SECURITY.md`).
  - Campos adicionales (extensiones): definidos en ADR-0064.
- **Estado:** Aceptada.

---

## ADR-0036 — Paginación, ordenamiento, filtros y organización de rutas

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-27.
- **Decisión:**
  - **Paginación por página:** parámetros `page` (desde 1) y `pageSize` (20 por defecto, máximo 100; un valor mayor es error de validación). Respuesta con `data` (resultados) y `meta` (`page`, `pageSize`, `totalItems`, `totalPages`).
  - **Ordenamiento:** parámetro `sort` con el nombre del campo y prefijo `-` para orden descendente (`?sort=-createdAt`). Cada endpoint declara los campos ordenables; cualquier otro es error de validación. El orden por defecto de cada endpoint termina en el ID para que sea estable entre páginas.
  - **Filtros:** parámetros de consulta declarados y documentados por endpoint; un filtro no permitido es error de validación.
  - **Grupos de rutas:**
    - Público, sin autenticación: `/v1/...` (catálogo, carrito, checkout, consulta de pedido de invitado).
    - Cliente autenticado: `/v1/me/...` (pedidos, direcciones). El ID del cliente se toma del token, nunca de la URL.
    - Administración: `/v1/admin/{contexto}/...`, con token de staff y permiso del contexto.
    - Webhooks: `/v1/webhooks/{proveedor}`, con verificación de firma.
  - **Convenciones de nombres:** recursos en plural, en inglés y separados por guion (`/v1/price-lists`); campos JSON en camelCase; fechas en ISO 8601, en UTC.
- **Alternativas consideradas:** Paginación por cursor; endpoints administrativos en las mismas rutas públicas con guards por método.
- **Consecuencias:**
  - Un listado que crezca mucho (por ejemplo, auditoría o movimientos de stock) puede usar paginación por cursor sin afectar a los demás.
  - Algunos recursos tienen vista pública y vista administrativa con respuestas distintas.
  - El envoltorio `data` / `meta` permite agregar información a los listados sin romper clientes de `v1`.
- **Estado:** Aceptada.

---

## ADR-0037 — Auditoría técnica

- **Fecha:** 2026-09-24
- **Contexto:** Cierra la parte de auditoría de P-18. La historia de negocio vive en cada contexto (ADR-0004); la auditoría técnica registra quién hizo qué, cuándo y desde dónde.
- **Decisión:**
  - **Qué se audita:**
    - Toda modificación del staff en `/v1/admin`.
    - Eventos de seguridad: inicio de sesión exitoso y fallido, cierre de sesión, cambio y recuperación de contraseña, reutilización de refresh token detectada, suspensión de usuarios, cambios de roles y permisos, y accesos denegados a rutas administrativas.
    - No se auditan acciones de clientes en carrito y checkout, ni jobs ni webhooks: sus efectos quedan en la historia de negocio.
  - **Contenido de cada registro:** actor (ID de usuario o "system"), código de acción estable (por ejemplo, `orders.cancel`), recurso (tipo e ID), fecha y hora en UTC, resultado (éxito o denegado), identificador de correlación, IP, agente de usuario y campos modificados con valor anterior y nuevo.
  - **Campos sensibles y personales:** hashes de contraseña, tokens, datos de pago y datos personales (nombres, email, teléfono y dirección) nunca se guardan con su valor; se registra que cambiaron (ADR-0067).
  - **Escritura:** en la misma transacción que el cambio auditado. Los intentos denegados y los inicios de sesión fallidos se registran por separado.
  - **Retención en dos niveles:**
    - Registros recientes en `audit_logs`: 3 meses, configurable.
    - Registros más antiguos: el job de limpieza diaria (ADR-0029) los exporta a archivos comprimidos (JSON Lines con gzip, un archivo por día) y después los borra de la base. Si la escritura del archivo falla o su conteo no coincide, los registros no se borran.
    - Los archivos se guardan en el disco del servidor, en un directorio privado distinto del de imágenes y nunca servido públicamente; su ruta se configura por variable de entorno (`.env.example`).
    - Archivos con más de 2 años de antigüedad (configurable): se borran.
  - **Acceso:** solo lectura en `/v1/admin/audit`, con el permiso `audit.read` reservado a administradores; paginación por cursor. Los archivos comprimidos no se consultan desde la API; su lectura es manual. Ningún endpoint modifica ni borra registros.
- **Alternativas consideradas:**
  - Particionamiento mensual de PostgreSQL: requiere SQL manual en las migraciones porque Prisma no administra tablas particionadas.
  - Tabla de archivo en la misma base de datos: consultable, pero no reduce el espacio en disco.
  - Retención única de 2 años sin archivo.
- **Consecuencias:**
  - La base de datos conserva solo 3 meses de auditoría; los registros anteriores dejan de ocupar espacio en ella.
  - Consultar registros con más de 3 meses requiere descomprimir los archivos manualmente (aceptado).
  - Los archivos deben incluirse en los respaldos del servidor, igual que las imágenes (ADR-0024).
  - Si se adopta un almacenamiento externo (por ejemplo, junto con el CDN), los archivos pueden moverse ahí.
  - Plazos sujetos a validación legal (P-61).
- **Estado:** Aceptada.

---

## ADR-0038 — Eliminación lógica

- **Fecha:** 2026-09-24
- **Contexto:** Cierra la parte de eliminación lógica de P-18.
- **Decisión:** No hay borrado lógico genérico (columna `deletedAt` en todas las tablas). Las entidades con valor histórico usan estados de negocio; las demás se borran físicamente cuando nada las referencia.

| Entidad | Política |
|---|---|
| Productos | Archivar |
| Variantes | Descontinuar |
| Categorías y marcas | Borrar solo sin productos ni subcategorías; si no, desactivar |
| Imágenes | Borrar registro y archivo en disco |
| Almacenes | Desactivar |
| Listas de precios | Desactivar |
| Periodos de precio futuros | Borrar mientras no hayan iniciado |
| Staff | Suspender, nunca borrar |
| Clientes | Suspender; si piden eliminar su cuenta, anonimizar (detalle en ADR-0067) |
| Direcciones del cliente | Borrar |
| Roles | Borrar solo sin usuarios asignados |
| Órdenes, pagos, envíos, movimientos de stock, auditoría | Nunca se borran (la auditoría, solo por retención, ADR-0037) |
| Carritos, refresh tokens, llaves de idempotencia, eventos de webhooks | Borrado físico por retención (ADR-0029) |

- **Identificadores únicos:**
  - Un SKU nunca se reutiliza, aunque la variante esté descontinuada.
  - El slug de un producto archivado sigue reservado.
  - El email de un usuario suspendido sigue ocupado; el de un cliente anonimizado se libera.
- **Alternativas consideradas:** Borrado lógico universal con `deletedAt` (cada consulta debe filtrar; complica restricciones únicas); borrado físico siempre.
- **Consecuencias:** Las consultas filtran por estado de forma explícita. El detalle de la anonimización está en ADR-0067.
- **Estado:** Aceptada.

---

## ADR-0039 — Listas de precios en el MVP

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-25.
- **Decisión:**
  - El MVP usa una sola lista de precios general. El modelo (`PriceList`, `VariantPrice`, `PriceResolver`) queda preparado para más listas sin cambios estructurales.
  - Reglas vigentes desde ahora:
    - Existe una lista predeterminada que no se puede desactivar.
    - Si una lista más específica no tiene precio para una variante, se usa el de la predeterminada.
    - La prioridad es única entre listas activas.
    - Nunca se elige automáticamente el precio más bajo entre listas; manda la prioridad.
    - Todas las listas en MXN; la predeterminada con impuesto incluido.
  - El formato de la carga masiva de precios se define al implementar Pricing (T-145).
- **Alternativas consideradas:** Listas por grupo de clientes; listas por canal o temporada.
- **Consecuencias:**
  - Las ofertas simples se cubren con el precio de comparación y los precios programados.
  - Los listados del catálogo son iguales para todos los visitantes, lo que mantiene válida la cache de ADR-0028. Si se agregan listas por cliente, habrá que revisar esa cache.
- **Estado:** Aceptada.

---

## ADR-0040 — Pagos: método manual y preparación de PayPal

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-12. Todavía no hay cuentas ni entornos de prueba de los proveedores.
- **Decisión:**
  - **Método manual, solo para pruebas:** el pago se hace fuera del sistema y un administrador lo registra marcando la orden como pagada.
    - Se modela como un proveedor más ("manual") detrás del puerto `PaymentGateway`. Registrar el pago produce `PaymentCaptured`, así que el resto del flujo (orden pagada, confirmación de la reserva) es el mismo que con un proveedor real.
    - Requiere un permiso de pagos y queda en la auditoría técnica.
    - Se habilita con una variable de entorno declarada en `.env.example`, desactivada por defecto. Habilitarlo en un entorno con clientes reales requiere una decisión explícita.
  - **PayPal, semiimplementado:** adaptador lo más completo posible (creación del pago, traducción de estados, verificación de firma de webhooks), sin probar hasta contar con cuenta y sandbox. Se marca como no verificado y no se habilita.
  - **Mercado Pago y Stripe:** se posponen. Se revisa que el puerto `PaymentGateway` admita sus flujos (redirección a su página de pago o confirmación con un secreto de cliente), sin escribir sus adaptadores.
- **Alternativas consideradas:** Semiimplementar los tres proveedores. Se descartó porque el costo real no está en escribir el adaptador sino en verificarlo; tres adaptadores sin probar se desactualizan (SDK, versiones de API) antes de poder validarlos, y el valor de preparar el segundo y el tercero es bajo mientras no se pruebe el primero.
- **Consecuencias:**
  - El pago manual suele registrarse después del TTL de la reserva (20 minutos). En ese caso aplica ADR-0012: se intenta reservar de nuevo y, si no hay stock, la orden pasa a AwaitingManualFulfillment. Para pruebas, el TTL puede ampliarse por configuración.
  - El adaptador de PayPal requiere verificación completa (T-191, P-31) antes de habilitarse.
- **Revisar cuando:** se tenga la cuenta y el sandbox de PayPal, o se decida integrar Mercado Pago o Stripe.
- **Estado:** Aceptada.

---

## ADR-0041 — Envíos manuales

- **Fecha:** 2026-09-24
- **Contexto:** Cierra la parte operativa de P-11. No se contemplan envíos automatizados a corto plazo.
- **Decisión:**
  - Sin integración con paqueterías: no se implementa el puerto `CarrierGateway` hasta que exista una integración real.
  - Al pagarse la orden (`OrderPaid`) se crea el envío en estado Pending, como lista de trabajo para el staff.
  - Todo lo demás lo hace el administrador manualmente: captura la paquetería y el número de guía, marca el envío como despachado y después como entregado (o fallido).
  - Los cambios de estado del envío actualizan la orden (Shipped, Delivered) mediante los eventos ya definidos.
- **Consecuencias:**
  - No hay generación de guías ni rastreo automático.
  - El costo de envío en el checkout se define en ADR-0042.
- **Estado:** Aceptada.

---

## ADR-0042 — Costo de envío

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-11. Con envíos manuales (ADR-0041), la orden debe conocer el costo de envío antes del pago.
- **Decisión:**
  - Costo fijo por orden, configurable por el administrador.
  - Envío gratis a partir de un monto mínimo de compra, configurable por el administrador.
  - El costo se calcula al cotizar el checkout y queda como snapshot en la orden.
- **Alternativas consideradas:** Solo costo fijo; solo envío gratis por monto; tarifas por zona o por peso.
- **Consecuencias:**
  - No se usan peso, dimensiones ni zona del destino para calcular el costo.
  - Un cambio de tarifa no afecta a órdenes ya colocadas.
  - Si se requiere cobrar según zona o peso, se amplía `ShippingRateCalculator` sin cambiar el contrato del checkout.
- **Estado:** Aceptada.

---

## ADR-0043 — Permisos, roles y cuentas del staff

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-15.
- **Decisión:**
  - **Catálogo de permisos** (contexto.acción, ADR-0017):

| Permiso | Permite |
|---|---|
| `catalog.read` | Ver el catálogo administrativo, incluidos borradores y archivados |
| `catalog.write` | Gestionar productos, variantes, imágenes, categorías y marcas |
| `pricing.read` / `pricing.write` | Ver / gestionar listas y precios |
| `inventory.read` / `inventory.write` | Ver / registrar entradas y ajustes, gestionar almacenes |
| `orders.read` | Ver pedidos |
| `orders.manage` | Cancelar pedidos y resolver AwaitingManualFulfillment |
| `payments.manage` | Registrar pagos manuales y emitir reembolsos |
| `shipping.manage` | Gestionar envíos (guías y estados) |
| `customers.read` | Ver datos de clientes |
| `customers.manage` | Suspender y anonimizar clientes |
| `staff.manage` | Gestionar cuentas del staff y roles |
| `audit.read` | Consultar la auditoría |

  - **Roles iniciales:**
    - Superadministrador: todos los permisos. No se puede quitar el último (BR-USR-03).
    - Administrador: todos excepto `staff.manage`. Es el rol "de nivel alto" de ADR-0021.
    - Operador: `catalog.*`, `pricing.*`, `inventory.*`, `orders.read`, `shipping.manage`, `customers.read`.
  - **Tipo de cuenta explícito:** cliente o staff. Las cuentas de staff no compran y los clientes nunca tienen roles.
  - **Primer superadministrador:** se crea con un script de línea de comandos ejecutado manualmente, con los datos en variables de entorno. No hay usuarios predeterminados en el repositorio ni en las migraciones.
  - **Alta del staff:** la hace un superadministrador desde `/v1/admin`, con contraseña temporal que se cambia obligatoriamente en el primer inicio de sesión. No existe registro público de staff.
  - **Autenticación del staff:** solo con contraseña (ADR-0023), sin segundo factor por ahora.
- **Alternativas consideradas:** Invitación por correo; roles adicionales desde el inicio; segundo factor desde el inicio.
- **Consecuencias:**
  - Dinero (pagos manuales, reembolsos), cancelaciones y auditoría quedan en Administrador y Superadministrador.
  - Los roles se editan en base de datos, así que pueden crearse otros sin cambiar código.
  - Sin segundo factor, una contraseña del staff filtrada da acceso completo a sus permisos; el rate limiting del login y la auditoría de inicios de sesión son las mitigaciones actuales.
- **Revisar:** segundo factor (2FA) para el staff como mejora de seguridad a mediano o largo plazo, idealmente antes de operar con clientes reales.
- **Estado:** Aceptada.

---

## ADR-0044 — Verificación de email para comprar

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-23.
- **Decisión:**
  - Un cliente registrado debe tener su email verificado para colocar una orden. Sin verificar puede iniciar sesión, navegar y usar el carrito.
  - Las compras como invitado no requieren verificación. Se asume que el invitado controla el email que usa y es responsable de él, para mantener un checkout ágil.
- **Consecuencias:**
  - PlaceOrder rechaza la orden de un cliente registrado sin email verificado, con un error RFC 9457 específico para que el cliente pueda solicitar la verificación.
  - Riesgo aceptado: un cliente registrado sin verificar puede comprar como invitado y evitar la verificación; el email de contacto de un invitado puede ser incorrecto.
  - La verificación requiere enviar correos; en desarrollo se usa un capturador local (ADR-0045).
  - Mecanismo de verificación: ADR-0046.
- **Estado:** Aceptada.

---

## ADR-0045 — Envío de correos en desarrollo

- **Fecha:** 2026-09-24
- **Contexto:** La verificación de email (ADR-0044), las notificaciones y el enlace de acceso al pedido requieren enviar correos, pero no hay proveedor de correo (P-24) ni hosting (ADR-0031).
- **Decisión:**
  - El envío de correos va detrás de un puerto en Application; el dominio no conoce el mecanismo de envío.
  - En desarrollo, el adaptador envía a un capturador de correos local en Docker Compose (por ejemplo, Mailpit): los correos no salen a internet y se revisan en una bandeja web local.
  - La configuración del envío se declara en `.env.example` (ADR-0032).
  - El proveedor real se elige cuando haya hosting (P-24) y se agrega como otro adaptador.
- **Consecuencias:**
  - La verificación de email, las notificaciones y el enlace de acceso al pedido pueden desarrollarse y probarse en local.
  - P-24 deja de bloquear el desarrollo; solo bloquea operar con clientes reales.
- **Estado:** Aceptada.

---

## ADR-0046 — Mecanismo de verificación de email

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-32.
- **Decisión:**
  - Se envía un enlace con un token firmado de un solo uso, vigente 24 horas (configurable).
  - El cliente puede solicitar el reenvío, con límite de frecuencia; un reenvío invalida el enlace anterior.
  - Si el cliente cambia su email, debe verificarlo de nuevo antes de volver a comprar.
  - El enlace apunta a la URL base del frontend configurada por variable de entorno (ADR-0056).
- **Consecuencias:** La respuesta a una solicitud de reenvío no revela si el email existe.
- **Estado:** Aceptada.

---

## ADR-0047 — Política de contraseñas

- **Fecha:** 2026-09-24
- **Contexto:** Sin segundo factor (ADR-0043), la contraseña es la única barrera de autenticación. Aplica a clientes y staff, incluidas las contraseñas temporales.
- **Decisión:**
  - Longitud: mínimo 15 y máximo 64 caracteres.
  - Sin reglas de composición: no se exigen mayúsculas, dígitos ni caracteres especiales.
  - Caracteres aceptados: letras (incluidas las acentuadas y la ñ), dígitos, el espacio y todos los símbolos imprimibles, entre ellos `. , ! ? _ - @ # $ % & * + = / \ ( ) [ ] { } : ; " ' < > ~ ^ | `` ` ``.
  - Se rechazan las contraseñas que aparezcan en una lista local de contraseñas comunes (comparación sin distinguir mayúsculas y minúsculas), sin consultar servicios externos. La lista concreta se elige al implementar (T-120).
- **Referencia:** Alineada con NIST SP 800-63B revisión 4 (2025): mínimo de 15 caracteres cuando la contraseña es el único factor, aceptación de al menos 64 caracteres, sin reglas de composición y con verificación contra contraseñas comunes.
- **Alternativas consideradas:** Política inicial de 8 a 50 caracteres con mayúscula, dígito y carácter especial de una lista cerrada (reemplazada el mismo día, P-33).
- **Consecuencias:**
  - Las contraseñas temporales del staff las genera el sistema con al menos 15 caracteres.
  - Los gestores de contraseñas y las frases de contraseña funcionan sin restricciones.
  - Mitigaciones adicionales: Argon2id, rate limiting del login y auditoría de inicios de sesión.
- **Revisar:** si se incorpora el segundo factor (ADR-0048), la longitud mínima puede mantenerse; no es necesario reducirla.
- **Estado:** Aceptada.

---

## ADR-0048 — Preparación para segundo factor (2FA)

- **Fecha:** 2026-09-24
- **Contexto:** El 2FA se pospone a mediano o largo plazo (ADR-0043), pero debe poder incorporarse sin rediseñar la autenticación.
- **Decisión:** Se prepara el diseño, sin implementar código ni tablas del segundo factor:
  - El caso de uso de autenticación devuelve un resultado que distingue "autenticado" de otros desenlaces (credenciales inválidas, cuenta suspendida, cambio de contraseña obligatorio). Un futuro "se requiere segundo factor" será otro desenlace, no un cambio de flujo.
  - La respuesta del login es un objeto con campos nombrados (no solo los tokens sueltos), de modo que agregar un paso de desafío para usuarios con 2FA sea un cambio compatible dentro de `v1` (ADR-0034).
  - Las estrategias de Passport delegan en casos de uso (ADR-0022), así que una estrategia o paso adicional no toca el dominio.
  - La auditoría ya registra los eventos de autenticación, a los que se sumarán los del segundo factor.
- **Alternativas consideradas:** Crear desde ahora columnas y endpoints de 2FA sin usarlos (descartado por la regla de evitar abstracciones sin uso).
- **Consecuencias:** El tipo de segundo factor (aplicación de autenticación, correo u otro) y si será obligatorio para el staff se deciden al implementarlo.
- **Estado:** Aceptada.

---

## ADR-0049 — Identificadores de la orden: consecutivo interno y código público

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-35. ADR-0020 exige que el identificador que usa un invitado no sea adivinable, y se quiere conservar un número consecutivo.
- **Decisión:** Cada orden tiene dos identificadores:
  - **Número interno consecutivo**, generado desde una secuencia de PostgreSQL. Lo usa el staff para la operación interna y no se expone a los clientes.
  - **Código público aleatorio** de 8 caracteres en Base32 Crockford (sin I, L, O ni U; sin distinguir mayúsculas y minúsculas), mostrado como `XXXX-XXXX`. Es el que ve el cliente, aparece en los correos y se usa en la consulta de pedido de invitado.
  - El código público tiene restricción `UNIQUE`; ante una repetición, se genera otro.
- **Alternativas consideradas:** Solo consecutivo (adivinable); consecutivo ofuscado con Sqids o Hashids (reversible, no es medida de seguridad); solo código aleatorio.
- **Consecuencias:**
  - La secuencia no garantiza números continuos: una transacción revertida deja huecos. El consecutivo sirve para ordenar e identificar, no como conteo exacto.
  - Las respuestas a clientes (`/v1/me`, consulta de invitado, correos) muestran solo el código público; las administrativas muestran ambos, y el staff puede buscar por cualquiera de los dos.
- **Estado:** Aceptada.

---

## ADR-0050 — Estados del envío

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-34. El diseño inicial del dominio (previo a ADR-0041) contemplaba estados ligados a paqueterías (LabelCreated, InTransit, Returned) que no se alcanzan con envíos manuales.
- **Decisión:**
  - Estados implementados en el MVP: Pending, Dispatched, Delivered, DeliveryFailed y Returned (este último agregado por ADR-0053).
  - Transiciones: Pending → Dispatched → Delivered | DeliveryFailed; DeliveryFailed → Returned (ADR-0053).
  - Los estados ligados a paqueterías (guía generada, en tránsito) se documentan como previstos en `DOMAIN_MODEL.md`, pero no se implementan hasta que exista una integración real, igual que el puerto `CarrierGateway` (ADR-0041).
  - Los clientes de la API deben tolerar valores de estado que no conocen, de modo que agregar estados en el futuro sea un cambio compatible dentro de `v1` (ADR-0034).
- **Alternativas consideradas:** Implementar desde ahora los estados de paquetería sin usarlos.
- **Motivo:** Un estado inalcanzable no es inofensivo en el código: aparece en validaciones, filtros, documentación de la API y pruebas sin que ningún flujo lo produzca. Agregarlo después cuesta poco, y documentarlo como previsto conserva la preparación.
- **Estado:** Aceptada.

---

## ADR-0051 — Cancelación y reembolso de órdenes pagadas

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-36 y P-37. "Cancelada" y "reembolsada" describen hechos distintos que ocurren en momentos distintos: la decisión de no surtir y la devolución efectiva del dinero.
- **Decisión:**
  - Cancelar una orden en PendingPayment la lleva a Cancelled, estado terminal, y libera su reserva.
  - Cancelar una orden en Paid o AwaitingManualFulfillment la lleva a Cancelled e inicia el reembolso total.
  - Cuando el reembolso se confirma, la orden pasa de Cancelled a Refunded, estado terminal.
  - Si el reembolso falla, la orden sigue en Cancelled y el staff puede reintentarlo.
  - Confirmación del reembolso:
    - Con proveedor (PayPal, cuando se habilite): webhook o conciliación.
    - Con pago manual: el reembolso se hace fuera del sistema y lo registra un administrador con `payments.manage`. Queda auditado y solo está disponible cuando el pago manual está habilitado (ADR-0040).
  - En el MVP no hay reembolsos independientes de la cancelación; un pedido entregado no se reembolsa desde el sistema (ADR-0018).
- **Alternativas consideradas:** Pasar directamente a Refunded al cancelar (la orden diría "reembolsada" antes de devolver el dinero); solo Cancelled, con el avance del reembolso únicamente en Payment.
- **Consecuencias:**
  - Cancelled es terminal solo cuando no hubo pago capturado.
  - Las órdenes en Cancelled con pago capturado son la lista de reembolsos pendientes del staff.
  - El reintegro de stock se define en ADR-0052.
- **Estado:** Aceptada.

---

## ADR-0052 — Reintegro de stock de órdenes canceladas y devueltas

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-38. Al confirmarse el pago, `onHand` ya disminuyó (ADR-0011). Una orden se cancela por motivos variados, y la mercancía puede estar intacta, dañada o ya fuera del almacén, así que reintegrar siempre o nunca sería incorrecto.
- **Decisión:**
  - El reintegro de stock es un proceso de Inventory independiente de la cancelación: una entrada de stock con motivo que puede hacer referencia a la orden cancelada, con las cantidades que realmente regresan (total o parcial).
  - Como funcionalidad opcional, al cancelar una orden en Paid el staff puede indicar que se reintegre el stock en la misma operación. En ese caso se reintegran todas las líneas por su cantidad completa; un reintegro parcial se hace con el proceso independiente.
  - La misma opción existe al registrar o reintentar el reembolso de la orden: solo está disponible si la orden no tiene ningún reintegro previo (ni al cancelar ni por el proceso independiente), para evitar reintegros dobles. Si ya hubo alguno, lo que falte se reintegra con el proceso independiente. Cuando el reembolso lo confirma el proveedor de forma automática, no hay intervención del staff y el reintegro se hace con el proceso independiente.
  - Las opciones de reintegro requieren, además del permiso de la operación (`orders.manage` o `payments.manage`), el permiso `inventory.write`.
  - El proceso independiente también aplica a órdenes con envío devuelto (ADR-0053).
  - No aplica a órdenes en PendingPayment (su reserva simplemente se libera) ni en AwaitingManualFulfillment (su stock nunca se confirmó).
  - La cantidad total reintegrada de cada línea de una orden no puede superar la cantidad vendida, sumando la opción al cancelar y el proceso independiente.
  - Cada reintegro genera un movimiento de stock con motivo y referencia a la orden, y se audita.
- **Alternativas consideradas:** Reintegro automático siempre; nunca reintegrar desde el sistema.
- **Consecuencias:** Una orden cancelada puede quedar sin reintegro; el inventario refleja solo lo que el staff confirma que regresó.
- **Estado:** Aceptada.

---

## ADR-0053 — Entrega fallida y devolución

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-39. Sin envíos automatizados, una entrega fallida no desencadena ningún proceso del sistema.
- **Decisión:**
  - Marcar un envío como DeliveryFailed no cambia el estado de la orden, que permanece en Shipped.
  - Si la mercancía regresa, el staff marca manualmente el envío como Returned y reintegra el stock con el proceso independiente de Inventory (ADR-0052), por las cantidades que realmente regresan.
  - No hay reintento de entrega, cancelación ni reembolso automáticos a partir de una entrega fallida o una devolución. Una orden en Shipped no se cancela (BR-CAN-01), así que cualquier arreglo con el cliente se gestiona fuera del sistema.
- **Alternativas consideradas:** Cancelar o reembolsar automáticamente; permitir reintentar la entrega.
- **Consecuencias:**
  - Returned pasa de estado previsto a implementado en el envío (ADR-0050).
  - Una orden con envío devuelto queda en Shipped; su reembolso, si lo hay, ocurre fuera del sistema.
- **Revisar si:** se integra un proceso de envío automatizado; entonces se definirán cancelación, reembolso o reintento a partir de entregas fallidas.
- **Estado:** Aceptada.

---

## ADR-0054 — Restauración del carrito al expirar una orden

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-40. Al colocar la orden, el carrito pasa a CheckedOut; si la orden expira por falta de pago, el cliente perdería sus productos.
- **Decisión:**
  - Cuando una orden pasa a Expired, todas sus líneas regresan al carrito del cliente.
  - Si el carrito ya tiene productos, se suman las cantidades, con el mismo tope de 30 por línea y sin aviso que en la fusión de carritos (ADR-0015).
  - Cliente registrado: se usa su carrito activo; si no tiene, se reactiva el carrito original de la orden.
  - Invitado: se reactiva el carrito original de la orden (el mismo `cartId` que conoce el cliente).
  - Los precios no se restauran: el carrito los calcula al leer (BR-CRT-04).
- **Consecuencias:**
  - Una orden expirada puede recibir un pago tardío (ADR-0012) después de que sus productos regresaron al carrito; si el cliente vuelve a comprar, podría pagar dos veces. Riesgo aceptado mientras el único método sea el pago manual de pruebas; se revisa al habilitar pagos reales.
  - Shopping reacciona al evento `OrderExpired`.
- **Estado:** Aceptada.

---

## ADR-0055 — Pago manual en tienda y recompra de órdenes canceladas

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-41.
- **Decisión:**
  - El pago manual se realiza de forma física en la tienda. Al iniciar el pago con este método, la API devuelve una "acción requerida" que indica pago en tienda, con el código público de la orden y el total a pagar.
  - Un pago manual solo se registra sobre órdenes en PendingPayment o Expired (esta última con el flujo de pago tardío de ADR-0012). No se registra sobre órdenes Cancelled, Refunded ni en ningún otro estado.
  - Una orden cancelada nunca se reactiva. Como máximo, sus líneas se pueden copiar a un carrito para volver a comprarlas en una orden nueva, con precios y disponibilidad actuales y el mismo criterio de suma y tope de ADR-0054. Las variantes que ya no se venden se omiten.
  - Pueden copiarla el cliente dueño de la orden (registrado, o invitado identificado con email y código público) y, como apoyo al cliente, el staff con `orders.manage` (Administrador y Superadministrador). El staff copia las líneas al carrito del cliente con el mismo criterio de ADR-0054, nunca a un carrito propio (BR-USR-08), y la acción se audita.
- **Consecuencias:**
  - Si un cliente paga en tienda una orden ya cancelada, el caso se atiende fuera del sistema.
  - Riesgo aceptado: con el TTL de 20 minutos (se mantiene), un pago en tienda casi siempre llegará después de expirar la orden y seguirá el flujo de pago tardío; como las líneas ya habrán regresado al carrito (ADR-0054), el cliente podría comprar dos veces. Se revisa si el pago en tienda llega a ofrecerse a clientes reales (ADR-0013).
- **Estado:** Aceptada.

---

## ADR-0056 — Recuperación de contraseña y enlaces hacia el frontend

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-42.
- **Decisión:**
  - **Recuperación por enlace enviado al email**, para clientes y staff:
    - Token aleatorio de un solo uso, guardado con hash en la base de datos.
    - Vigencia de 30 minutos (configurable).
    - La respuesta a la solicitud es idéntica exista o no el email; para cuentas suspendidas se responde igual, pero no se envía el correo.
    - Límite de frecuencia por email y por IP.
    - Solicitar un enlace nuevo invalida los anteriores.
    - La nueva contraseña cumple ADR-0047.
    - Al restablecer, se revocan todas las sesiones (refresh tokens) del usuario y se envía un correo avisando del cambio.
  - **Enlaces hacia el frontend:** los enlaces de recuperación y de verificación de email (ADR-0046) se arman con la URL base del frontend, configurada por variable de entorno y declarada en `.env.example`, más el token. El frontend envía el token a la API. Mientras no exista frontend, el token se toma del correo en el capturador local (ADR-0045) y se usa directamente contra la API.
  - **Cambio obligatorio del staff:** pide la contraseña temporal, igual que un cambio normal pide la contraseña actual.
- **Alternativas consideradas:** Código de 6 dígitos por correo (más independiente del frontend, pero expuesto a fuerza bruta y menos cómodo); passkeys (más seguras, pero un cambio mayor; candidatas junto con el 2FA, ADR-0048).
- **Consecuencias:** Los tokens de recuperación se guardan en su propia tabla; los vencidos o usados se eliminan en la limpieza diaria (ADR-0029).
- **Estado:** Aceptada.

---

## ADR-0057 — Datos del cliente y formato de dirección

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-43. País de operación: México (ADR-0026).
- **Decisión:**
  - **Registro de cliente:** email, contraseña, nombres y apellidos (dos campos). El teléfono no se pide en el registro.
  - **Formato de dirección** (libreta de direcciones, checkout de invitado y snapshots de órdenes y envíos):

| Campo | Obligatorio | Validación |
|---|---|---|
| Nombre de quien recibe | Sí | Texto; un solo campo con el nombre completo, informativo para la paquetería |
| Teléfono de contacto | Sí | 10 dígitos (formato nacional) |
| Calle | Sí | Texto |
| Número exterior | Sí | Texto (admite "S/N" y letras) |
| Número interior | No | Texto |
| Colonia | Sí | Texto |
| Código postal | Sí | 5 dígitos (solo formato) |
| Municipio o alcaldía | Sí | Lista cerrada; debe pertenecer al estado elegido |
| Ciudad o localidad | No | Texto |
| Estado | Sí | Lista cerrada de las 32 entidades federativas |
| Referencias o entre calles | No | Texto |
| País | Fijo | México |

  - **Catálogo de estados y municipios:** se toma del Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades del INEGI, que se actualiza mensualmente. Se guarda en la base de datos con las claves oficiales (2 dígitos por estado, 5 por municipio) y se carga con un script manual e idempotente a partir del archivo descargado; la API no descarga nada por sí misma. Un municipio que desaparece del catálogo se marca como inactivo, nunca se borra (ADR-0038), porque puede estar en direcciones existentes.
  - Las direcciones guardan la clave y el nombre del estado y del municipio; los snapshots de órdenes y envíos conservan los nombres vigentes al momento de la compra.
  - Máximo 10 direcciones por cliente (configurable).
- **Alternativas consideradas:** Nombre completo en un solo campo; municipio como texto libre; validar el código postal contra el catálogo de Correos de México (mejora futura, junto con autocompletar la dirección).
- **Consecuencias:**
  - El catálogo geográfico es dato de referencia compartido: lo consultan Identity & Access (direcciones) y Ordering (checkout de invitado) mediante una fachada de solo lectura.
  - Periodicidad de revisión del catálogo: los cambios de municipios son poco frecuentes; se recomienda revisarlo al menos cada trimestre.
- **Estado:** Aceptada.

---

## ADR-0058 — Peso y dimensiones de variantes

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-59. Con costo de envío fijo (ADR-0042) y sin paqueterías (ADR-0041), el peso y las dimensiones no intervienen en ningún cálculo.
- **Decisión:** Peso y dimensiones (largo, ancho y alto) de cada variante son opcionales. Unidades: gramos y centímetros.
- **Consecuencias:**
  - Se pueden capturar como información para el staff al preparar envíos.
  - Si en el futuro el costo de envío depende del peso o se integra una paquetería, habrá que volverlos obligatorios y completar los datos faltantes.
- **Estado:** Aceptada.

---

## ADR-0059 — Fusión de carritos e identificador del carrito de invitado

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-44. El servidor no conoce el carrito de invitado de un cliente hasta que el cliente envía su `cartId`.
- **Decisión:**
  - La fusión se dispara con un endpoint explícito bajo `/v1/me`, que el cliente llama después de iniciar sesión enviando el `cartId` del invitado. El login no fusiona carritos.
  - Reglas:
    - Es idempotente: fusionar un carrito que ya se fusionó en la misma cuenta devuelve el carrito actual sin volver a sumar.
    - Si el cliente no tiene carrito activo, el carrito de invitado pasa a ser de la cuenta, sin copiar líneas.
    - El carrito fusionado queda en Merged y su `cartId` ya no permite modificarlo.
    - Solo se fusionan carritos de invitado (sin dueño); cualquier otro se rechaza.
    - El staff no fusiona carritos (BR-USR-08).
    - Las variantes no vendibles se conservan; la vista del carrito muestra la disponibilidad y el checkout vuelve a validar.
  - El `cartId` de todo carrito de invitado es aleatorio y no adivinable, porque es la única credencial de ese carrito.
- **Alternativas consideradas:** Fusionar dentro del login; fusionar de forma implícita mediante un encabezado.
- **Consecuencias:** Si el frontend no llama a la fusión, el carrito de invitado queda sin dueño y se elimina a los 30 días de inactividad (ADR-0029).
- **Estado:** Aceptada.

---

## ADR-0060 — Búsqueda, filtros y consulta del catálogo público

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-47. El listado público debe ocultar productos sin precio vigente (BR-PRD-06) y permitir filtrar y ordenar por precio y disponibilidad, datos que viven en Pricing e Inventory. Con ADR-0005, un listado paginado desde Catalog no puede filtrar por esos datos sin producir páginas incompletas y totales incorrectos.
- **Decisión:**
  - **Excepción de solo lectura a ADR-0005:** la consulta del catálogo público lee en una misma consulta SQL tablas de Catalog, Pricing e Inventory. Vive en un servicio de consultas identificado, solo lee, y la verificación de límites de la CI permite esa excepción únicamente a ese servicio. El precio vigente se calcula con la fecha actual dentro de la consulta, así que los precios programados no necesitan jobs.
  - **Búsqueda por texto:** búsqueda de texto completo de PostgreSQL con configuración en español, sin acentos (extensión `unaccent`) y con coincidencia por prefijo, sobre el título del producto, el nombre de la marca y el de sus categorías. La descripción no se incluye.
  - **Filtros:** categoría (incluye subcategorías), una o varias marcas, rango de precio (mínimo y máximo en centavos, IVA incluido) y solo disponibles.
  - **Ordenamiento:** relevancia (por defecto con texto de búsqueda), más recientes por fecha de publicación (por defecto sin texto), precio ascendente y descendente, y nombre. El precio de un producto para filtrar y ordenar es el más bajo entre sus variantes vendibles.
  - **Cache:** solo los listados sin texto de búsqueda; las búsquedas van directo a la base.
- **Alternativas consideradas:** Proyección de lectura actualizada por eventos (respeta ADR-0005, pero necesita un job para precios programados y puede desfasarse); filtrar después de paginar (páginas incompletas); motor de búsqueda externo; coincidencia parcial con trigramas; filtros por opciones de variante (fuera del MVP).
- **Consecuencias:**
  - La extensión `unaccent` y los índices de búsqueda se crean en una migración con SQL.
  - Si el catálogo crece o la consulta se vuelve lenta, se puede migrar a una proyección de lectura sin cambiar el contrato de la API.
  - El filtro "solo disponibles" usa la disponibilidad de ADR-0061.
- **Estado:** Aceptada.

---

## ADR-0061 — Disponibilidad pública

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-46.
- **Decisión:**
  - El catálogo público muestra solo "disponible" o "agotado" por variante, nunca la cantidad en stock. Disponible significa que la cantidad disponible (`onHand − reserved`) es mayor que cero.
  - Un producto está disponible si al menos una de sus variantes vendibles lo está; el filtro "solo disponibles" (ADR-0060) usa esta definición.
  - Las cantidades exactas solo se ven en las rutas administrativas (`inventory.read`).
- **Consecuencias:** En la vista del carrito y en la cotización del checkout, cada línea indica si la cantidad pedida puede surtirse (sí o no), sin revelar la cantidad disponible; así el cliente sabe qué ajustar antes de colocar la orden.
- **Estado:** Aceptada.

---

## ADR-0062 — Mensajes de login y registro

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-54 y P-55.
- **Decisión:**
  - **Login:** ante un email inexistente, una contraseña incorrecta o una cuenta suspendida, la respuesta es la misma: credenciales no válidas. No se revela el motivo.
  - **Registro:** si el email ya está registrado, la respuesta lo indica, para que el usuario pueda iniciar sesión o recuperar su cuenta.
- **Consecuencias:**
  - Riesgo aceptado: el registro permite comprobar si un email está registrado. Por eso, que la recuperación de contraseña y el reenvío de verificación no lo revelen (ADR-0046, ADR-0056) deja de ser una protección completa contra la enumeración de cuentas; se mantienen igual porque no agregan riesgo.
  - Mitigación: rate limiting obligatorio en el registro, igual que en el login.
  - Un usuario suspendido no sabe desde la API que su cuenta está suspendida; lo sabrá por el canal de soporte de la tienda.
- **Estado:** Aceptada.

---

## ADR-0063 — Comportamiento de `Idempotency-Key`

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-52. Referencia: borrador de la IETF que estandariza el encabezado `Idempotency-Key`.
- **Decisión:**
  - Obligatorio en colocar orden (UC-ORD-02) e iniciar pago (UC-PAY-01); si falta, la solicitud se rechaza con 400. No se usa en otros endpoints: las operaciones del staff sobre pagos y reembolsos ya están protegidas por invariantes del dominio.
  - La llave queda ligada a quien la envía (el usuario autenticado o, para invitados, el `cartId`) y al endpoint.
  - Misma llave y mismo contenido: se devuelve la respuesta guardada sin volver a ejecutar la operación.
  - Misma llave y contenido distinto: se rechaza con 422.
  - Misma llave mientras la solicitud original sigue en proceso: se rechaza con 409.
  - Se guardan las respuestas de operaciones que se ejecutaron (éxitos y errores de negocio). No se guardan errores de servidor (5xx), de autenticación ni de rate limiting, para que el cliente pueda reintentar.
  - Formato: texto de hasta 255 caracteres; se recomienda un UUID.
  - Retención: 24 horas (ADR-0029).
- **Consecuencias:** Tras un 409 por `expectedTotal`, el cliente vuelve a cotizar y debe usar una llave nueva, porque el contenido cambió.
- **Estado:** Aceptada.

---

## ADR-0064 — Códigos HTTP y tipos de error

- **Fecha:** 2026-09-24
- **Contexto:** Cierra la parte de errores de P-53.
- **Decisión:**
  - **Criterio de códigos:**
    - 400: la solicitud es inválida por sí misma (validación de campos, parámetros no permitidos, `Idempotency-Key` ausente, enlace inválido o vencido). La validación usa 400, no 422.
    - 401: no se sabe quién es (sin token, token vencido, credenciales no válidas, firma de webhook inválida).
    - 403: se sabe quién es, pero no puede hacerlo (permiso faltante, email sin verificar, staff que intenta comprar, cambio de contraseña obligatorio, pago manual deshabilitado).
    - 404: no existe o no se revela que existe.
    - 409: solicitud válida que choca con el estado actual (versión, total distinto, stock insuficiente, transición inválida, valor duplicado, borrado con referencias, periodo de precio superpuesto o iniciado).
    - 413 y 415: archivo demasiado grande o de formato no admitido.
    - 422: solo para `Idempotency-Key` reutilizada con otro contenido (ADR-0063).
    - 429: límite de frecuencia excedido, con encabezado `Retry-After`.
  - **Campo `type`:** URI relativa estable por tipo de error (por ejemplo, `/problems/insufficient-stock`), documentada en OpenAPI. Los clientes deciden según `type`; `title` y `detail` son para personas.
  - **Extensiones de Problem Details:**
    - `correlationId` en todas las respuestas de error (ADR-0033).
    - `errors` en los errores de validación: lista de campo y mensaje.
    - `lines` en el error de stock insuficiente: variantes que no pueden surtirse, sin cantidades (ADR-0061).
- **Alternativas consideradas:** 422 para la validación; 400 genérico para errores de negocio.
- **Consecuencias:** El catálogo de errores de `REQUIREMENTS.md` (E-01 a E-26) queda con código asignado; los slugs de `type` se fijan en T-005.
- **Estado:** Aceptada.

---

## ADR-0065 — Rate limiting

- **Fecha:** 2026-09-24
- **Contexto:** Cierra la parte de rate limiting de P-53.
- **Decisión:**
  - Se usa el módulo oficial de NestJS para limitar la frecuencia (`@nestjs/throttler`), con contadores en memoria, coherente con operar una sola instancia.
  - Límites, configurables por variables de entorno (`.env.example`):

| Endpoint | Límite |
|---|---|
| Login | 5 intentos fallidos por email en 15 minutos, y 20 por IP |
| Registro | 5 por IP por hora |
| Recuperación de contraseña | 3 por email y 10 por IP por hora |
| Reenvío de verificación | 3 por email por hora |
| Consulta de pedido de invitado | 10 por IP en 15 minutos |
| Colocar orden | 10 por usuario o carrito en 10 minutos |
| Resto de endpoints | 100 solicitudes por minuto por IP |

  - Se frena por tiempo; nunca se bloquean cuentas por intentos fallidos.
  - Al exceder un límite se responde 429 con `Retry-After`.
- **Alternativas consideradas:** Bloqueo de cuentas tras intentos fallidos (permite bloquear cuentas ajenas a propósito); almacén compartido desde el inicio.
- **Consecuencias:**
  - Los contadores se reinician al reiniciar la API (aceptado).
  - Si la API se escala a varias instancias, los contadores deben pasar a un almacén compartido.
  - Si la API queda detrás de un proxy, habrá que configurar qué IP se toma (depende del hosting, P-06).
- **Estado:** Aceptada.

---

## ADR-0066 — Modelo de datos y convenciones de persistencia

- **Fecha:** 2026-09-24
- **Contexto:** T-004. El detalle de cada tabla está en `DATABASE.md`.
- **Decisión:**
  - **Tablas por contexto:** 38 tablas, sin FK entre contextos (ADR-0005). Única excepción: FK hacia el catálogo geográfico del INEGI, que es dato de referencia y nunca se borra (ADR-0057).
  - **Nombres:** tablas y columnas en `snake_case`, tablas en plural; modelos de Prisma en `camelCase` con `@map`.
  - **Identificadores:** `uuid` generado por la aplicación. UUIDv7 por defecto (ordenable por tiempo, mejor para índices); UUIDv4 cuando el identificador actúa como credencial (`carts.id`, ADR-0059). Las tablas append-only (`audit_logs`, `stock_movements`) también usan UUIDv7, cuyo orden temporal sirve para la paginación por cursor.
  - **Dinero:** `integer` en centavos con moneda `MXN` (máximo 21,474,836.47 por campo). **Tasas:** `integer` en puntos base (16% = 1600).
  - **Fechas:** `timestamptz(3)` en UTC; `created_at` y `updated_at` en tablas mutables; solo `created_at` u `occurred_at` en tablas append-only.
  - **Estados:** tipos `enum` de PostgreSQL gestionados por Prisma. Agregar un valor es una migración aditiva (ADR-0050).
  - **Snapshots:** `jsonb` validado por el dominio (direcciones de órdenes y envíos, opciones de variante).
  - **Integridad en la base, además del dominio:** `CHECK` de montos, cantidades, stock y formatos; restricción de exclusión con `btree_gist` que impide periodos de precio superpuestos; índices únicos parciales (una reserva activa por orden, un reembolso activo por pago, un carrito activo por cliente, una lista y un método de envío predeterminados); trigger que impide modificar `audit_logs`.
  - **Tablas no creadas:** `permissions` (catálogo en código, ADR-0017) y `promotions` (fuera del MVP, ADR-0018; `orders.discount_total` existe desde el inicio).
  - **Tokens de un solo uso** (verificación, recuperación, refresh) guardados solo como hash.
- **Alternativas consideradas:** IDs `bigint` secuenciales (exponen volumen y son adivinables); `bigint` o `numeric` para dinero (`integer` basta para una tienda y evita conversiones de `BigInt` en JavaScript); texto con `CHECK` en lugar de `enum`; columnas planas en lugar de `jsonb` para los snapshots.
- **Consecuencias:**
  - Varias protecciones requieren SQL manual en las migraciones (extensiones, `CHECK`, exclusión, índices parciales y de expresión, secuencia, trigger). En T-110 hay que comprobar que la verificación de migraciones de la CI no los detecte como diferencias.
  - Si algún monto pudiera superar 21.4 millones de pesos, habrá que migrar ese campo a `bigint`.
- **Pendientes que afectan al modelo, sin bloquearlo:** P-57 (envíos sin paquetería), P-58 (IVA del envío). Los ajustes por datos personales ya se incorporaron (ADR-0067).
- **Estado:** Aceptada (aprobación formal 2026-09-25). Los pendientes P-57 y P-58 no la bloquean.

---

## ADR-0067 — Datos personales: aviso de privacidad, derechos ARCO y anonimización

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-19 y P-60. Marco legal: Ley Federal de Protección de Datos Personales en Posesión de los Particulares, publicada el 20 de marzo de 2025 (con reforma de noviembre de 2025); autoridad: Secretaría Anticorrupción y Buen Gobierno. Este ADR cubre lo que el sistema debe soportar; el cumplimiento legal completo requiere validación de un especialista.
- **Decisión:**
  - **Aviso de privacidad:** su texto vive fuera de la API. La API guarda la versión del aviso presentada al registrarse (`users`) y al comprar como invitado (`orders`), y la exige en ambas operaciones.
  - **Derechos ARCO:** acceso y rectificación se cubren con `/v1/me` para clientes registrados. Las solicitudes formales, incluida la cancelación (eliminación de cuenta), se reciben por un canal externo publicado en el aviso de privacidad, y el staff las ejecuta en el sistema (`customers.read`, `customers.manage`). El seguimiento de plazos queda fuera del sistema en el MVP. No hay autoservicio de eliminación de cuenta por ahora.
  - **Anonimización de un cliente:**
    - Cuenta: email, nombres, apellidos y hash de contraseña quedan en `NULL`; estado ANONYMIZED; el email queda libre.
    - Se revocan y borran refresh tokens y tokens de verificación y recuperación; se borran direcciones y carritos.
    - Órdenes y envíos: se conservan montos, líneas y estados; se eliminan el email de contacto y, en las direcciones snapshot, nombre, teléfono, calle, números y referencias. Se conservan estado, municipio y código postal.
    - Pagos: sin cambios (no guardan datos personales).
    - Si hay órdenes sin concluir, la anonimización espera a que terminen.
    - Los compradores invitados pueden solicitarla por el mismo canal, identificándose con email y código de pedido; se anonimizan sus órdenes.
  - **Auditoría:** los cambios de campos personales se registran sin sus valores, igual que los datos sensibles (ADR-0037). Así, anonimizar no requiere modificar registros de auditoría ni archivos.
  - **Retención de datos personales en órdenes:** se conservan mientras sean necesarios y después se anonimizan con el mismo procedimiento. El plazo queda pendiente de validación legal (P-61); el mecanismo (job con plazo configurable) se prevé, pero no se implementa en el MVP.
- **Alternativas consideradas:** Autoservicio de eliminación de cuenta; borrado físico de órdenes; conservar indefinidamente los datos personales en órdenes.
- **Consecuencias:** Ajustes en el modelo de datos propuesto (ADR-0066): versión del aviso en `users` y `orders`; marca de anonimización en `orders` y `shipments`; email de contacto de `orders` vacío solo en órdenes anonimizadas.
- **Estado:** Aceptada.

---

## ADR-0068 — Edición de variantes

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-50. Stock, precios, carritos y órdenes hacen referencia a la variante por su identificador interno, y las órdenes guardan el SKU como snapshot, así que cambiar un SKU no rompe referencias; el riesgo es de significado (por ejemplo, stock contado como talla M registrado después como L).
- **Decisión:**
  - El SKU y las opciones de una variante son editables solo mientras su producto nunca se ha publicado. Al corregir el SKU en ese periodo, el valor anterior se libera, porque nunca estuvo en carritos ni órdenes.
  - Después de la primera publicación, SKU y opciones quedan fijos; una corrección se hace descontinuando la variante y creando otra. Aplica la regla de no reutilizar SKU (BR-PRD-09).
  - No se agregan nuevas dimensiones de opciones a un producto ya publicado.
  - Peso, dimensiones y estado se pueden editar en cualquier momento.
- **Alternativas consideradas:** SKU nunca editable; SKU siempre editable con historial de valores anteriores.
- **Consecuencias:** `products` guarda la fecha de la primera publicación (`first_published_at`), que no cambia aunque el producto se archive o se vuelva a publicar.
- **Estado:** Aceptada.

---

## ADR-0069 — Motivos de movimientos de stock

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-51.
- **Decisión:**
  - Los ajustes y reintegros llevan un motivo obligatorio de una lista cerrada y una nota opcional; con el motivo "Otro", la nota es obligatoria. Las entradas de mercancía no llevan motivo, solo nota opcional.
  - Catálogo:

| Tipo de movimiento | Motivo (código) | Dirección |
|---|---|---|
| Ajuste | Conteo físico (`PHYSICAL_COUNT`) | Suma o resta |
| Ajuste | Dañado (`DAMAGED`) | Resta |
| Ajuste | Pérdida o robo (`LOSS_OR_THEFT`) | Resta |
| Ajuste | Uso interno o muestra (`INTERNAL_USE`) | Resta |
| Ajuste | Error de captura (`DATA_ENTRY_ERROR`) | Suma o resta |
| Ajuste | Otro (`OTHER`), con nota obligatoria | Suma o resta |
| Reintegro | Orden cancelada (`ORDER_CANCELLED`) | Suma |
| Reintegro | Envío devuelto (`SHIPMENT_RETURNED`) | Suma |

  - El catálogo vive en el código como `enum`, igual que los permisos (ADR-0017). Agregar un motivo es un cambio de código con una migración aditiva.
  - El dominio valida que la dirección del movimiento corresponda al motivo; la base de datos lo verifica también con `CHECK`.
- **Alternativas consideradas:** Texto libre (no analizable); lista cerrada sin nota; catálogo editable por el staff en una tabla.
- **Consecuencias:** En `stock_movements`, el campo `reason` se reemplaza por `reason_code` y `note`.
- **Estado:** Aceptada.

---

## ADR-0070 — Ciclo de conservación de datos personales en órdenes

- **Fecha:** 2026-09-25
- **Contexto:** Desarrolla P-61 sobre ADR-0067. La ley de datos personales de 2025 formaliza el plazo de conservación: los datos se suprimen cuando dejan de ser necesarios, previo bloqueo, y el bloqueo dura hasta la prescripción de las acciones derivadas de la relación con el titular. Por separado, el Código Fiscal de la Federación (art. 30) exige conservar la contabilidad y su documentación cinco años, y el Código de Comercio (art. 38) los comprobantes de las operaciones al menos diez años. El reglamento de la nueva ley aún está pendiente.
- **Decisión:**
  - Los datos personales de una orden y su envío pasan por tres fases, con plazos configurables:
    1. **Operativa:** desde la creación de la orden; datos visibles para el cliente y el staff.
    2. **Bloqueo:** al vencer el plazo operativo contado desde que la orden concluye (Delivered, Cancelled, Refunded o Expired). Los datos personales se ocultan en las respuestas normales de la API; solo se consultan con un permiso específico, reservado a administradores, para atender reclamaciones o requerimientos, y cada consulta se audita.
    3. **Anonimización:** al vencer el plazo de bloqueo, con el procedimiento de ADR-0067; los datos de la operación (montos, líneas, impuestos, fechas, estados) se conservan.
  - Los plazos no tienen valor por defecto hasta su validación legal.
  - **Fuera del MVP:** el diseño queda registrado, pero no se implementan el permiso de consulta de datos bloqueados, el ocultamiento en la API ni el job de transición. Mientras tanto no se ejecuta ninguna anonimización automática; las solicitudes de los titulares se atienden por el canal de ADR-0067.
- **Preguntas para la validación legal con un especialista:**
  1. ¿Las obligaciones fiscales y mercantiles exigen conservar los datos personales del comprador, o basta con los datos de la operación, considerando que no se emiten facturas (ADR-0027)?
  2. ¿Cuánto debe durar la fase operativa, considerando aclaraciones, garantías y reclamaciones de consumidores?
  3. ¿Qué plazo de prescripción aplica para el bloqueo en una venta en línea al consumidor?
  4. ¿Qué debe decir el aviso de privacidad sobre estos plazos?
  5. ¿Qué tratamiento deben recibir las cuentas de clientes inactivas por largo tiempo?
  - Además: validar los plazos de retención de la auditoría técnica (ADR-0037) y revisar este ADR cuando se publique el reglamento de la nueva ley.
- **Alternativas consideradas:** Anonimizar directamente sin fase de bloqueo; conservar indefinidamente; implementar el ciclo en el MVP con plazos provisionales.
- **Consecuencias:** P-61 queda abierta solo para los valores de los plazos y las respuestas del especialista. Cuando se validen, se implementa el ciclo (tarea T-232) y se actualiza el aviso de privacidad.
- **Estado:** Aceptada.

---

## ADR-0071 — Contratos REST y convenciones de la API

- **Fecha:** 2026-09-25
- **Contexto:** T-005. El detalle de cada endpoint está en `API_SPEC.md`; aquí se registran las convenciones que no estaban decididas en ADR anteriores.
- **Decisión:**
  - **Transiciones de estado** como `POST` sobre subrutas de acción (`/publish`, `/cancel`, `/dispatch`), nunca como `PATCH` del estado.
  - **`PATCH`** con semántica de fusión: campo ausente no cambia, `null` borra un opcional. **`PUT`** solo para reemplazar conjuntos (roles, orden de imágenes, método de envío).
  - **Concurrencia optimista:** los recursos versionados devuelven `version` y toda modificación administrativa la exige en el cuerpo (400 si falta, 409 `version-conflict` si difiere). El carrito del cliente no la exige.
  - **Rutas separadas para invitados y clientes registrados** en carrito, cotización, colocación de orden, pago y recompra (`/v1/carts`, `/v1/checkout`, `/v1/orders` frente a `/v1/me/...`). Las rutas públicas de carrito solo operan sobre carritos sin dueño; un carrito con dueño responde 404.
  - **Identificadores:** UUID en rutas; excepciones: `slug` del producto público y código público de la orden (aceptado con o sin guion y sin distinguir mayúsculas).
  - **Datos personales fuera de la URL:** la consulta de pedido de invitado y la recompra de invitado envían email y código en el cuerpo (`POST /v1/orders/lookup`).
  - **Recursos ajenos como inexistentes:** 404, nunca 403.
  - **Pago de invitado** atado al `cartId` de origen de la orden, que prueba la compra y es el alcance de la llave de idempotencia (ADR-0063).
  - **Representaciones:** dinero como objeto `Money` (`amount` en centavos y `currency`); opcionales sin valor como `null`; cuerpos con campos no declarados rechazados con 400; textos de error en español.
  - **Encabezados:** `X-Correlation-Id` en todas las respuestas; `Cache-Control: no-store` en respuestas autenticadas o con datos personales o tokens.
  - **Staff con cambio de contraseña pendiente:** solo puede usar `GET /v1/me`, `POST /v1/me/password` y `POST /v1/auth/logout`; el resto responde 403 `password-change-required`.
  - **Contraseña temporal del staff** devuelta una sola vez en la respuesta de creación.
  - **Lectura de pagos** con `orders.read` (no hay permiso de lectura de pagos).
  - **Paginación por cursor** en auditoría y movimientos de stock; por página en el resto.
  - **Nuevos tipos de error derivados de reglas existentes** (E-27 a E-33): `cart-not-active`, `address-limit-reached`, `last-superadmin`, `restock-not-allowed`, `active-orders-exist`, `field-locked`, `empty-cart`, todos 409 según ADR-0064.
  - **Webhooks** fuera del rate limiting general; la ruta de PayPal responde 404 mientras el adaptador no esté habilitado.
  - **Valores derivados sin decisión previa**, referenciados en `API_SPEC.md` a este ADR: longitudes máximas de campos, máximo de 3 atributos de opciones por variante, tope de 100,000 unidades por entrada de stock, rate limit de 3 por hora en el cambio de email, slug generado del título y bloqueado tras la primera publicación, sin dirección predeterminada al borrar la predeterminada, y que un staff no pueda suspenderse a sí mismo.
- **Alternativas consideradas:** `PATCH` del campo `status`; `ETag` con `If-Match` para la concurrencia (requeriría el código 428, fuera del criterio de ADR-0064); rutas únicas de checkout con autenticación opcional; consulta de invitado con datos en la URL.
- **Consecuencias:**
  - Decisiones derivadas P-62 y P-63, resueltas en ADR-0072.
  - `storeVisibility` del catálogo administrativo se calcula con la fachada de Pricing y no se ofrece como filtro.
- **Estado:** Aceptada (aprobación formal 2026-09-25), incluidos los valores derivados. Los pendientes P-48, P-49, P-56 a P-58 y el formato de carga masiva (T-145) no la bloquean.

---

## ADR-0072 — Sesiones al cambiar la contraseña y slugs de categorías y marcas

- **Fecha:** 2026-09-25
- **Contexto:** Cierra P-62 y P-63, detectadas al diseñar los contratos (ADR-0071).
- **Decisión:**
  - **Cambio de contraseña:** al cambiar la contraseña desde la cuenta (incluido el cambio obligatorio del staff), se revocan todas las demás sesiones del usuario; la sesión desde la que se hizo el cambio se conserva. Se envía un correo avisando del cambio, igual que en el restablecimiento (ADR-0056).
  - **Slugs de categorías y marcas:** se pueden cambiar. El slug anterior deja de funcionar y queda libre para reutilizarse.
- **Riesgo aceptado:** cambiar el slug de una categoría o marca rompe los enlaces públicos que usaban el anterior (responden 404), y si el slug liberado se reutiliza, un enlace antiguo puede llevar a otra categoría o marca. No se implementan redirecciones.
- **Alternativas consideradas:** Conservar las demás sesiones; revocar todas, incluida la actual; slugs inmutables; historial de slugs con redirección.
- **Consecuencias:** La regla de slugs de productos no cambia: el slug de un producto se bloquea tras su primera publicación y nunca se reutiliza (BR-PRD-09, ADR-0071).
- **Estado:** Aceptada.

---

## ADR-0073 — Herramienta de lint

- **Fecha:** 2026-09-25
- **Contexto:** ADR-0030 dejó la herramienta de lint para T-104. El proyecto inicial de NestJS ya trae oxlint configurado (`oxlint.json`, script `npm run lint`).
- **Decisión:** oxlint como herramienta de lint.
- **Alternativas consideradas:** ESLint con `typescript-eslint`.
- **Consecuencias:**
  - El paso "lint y formato" de la CI (ADR-0030) ejecuta oxlint.
  - oxlint no admite `eslint-plugin-boundaries`, así que la verificación de límites entre módulos (ADR-0005, T-103) se hace con otra herramienta, por ejemplo `dependency-cruiser`.
  - La herramienta de formato sigue pendiente de confirmar en T-104 (el proyecto trae una configuración de Prettier).
- **Estado:** Aceptada.

---

## ADR-0074 — Notificaciones por correo del ciclo de la orden

- **Fecha:** 2026-09-25
- **Contexto:** Cierra P-45 (UC-NTF-01, T-215). Las notificaciones son un módulo que reacciona a eventos, sin dominio propio (ADR-0004). Condiciones que ya están decididas:
  - El cliente no puede cancelar desde la API; solo el staff (ADR-0021). Sin correo, el cliente no se entera de una cancelación.
  - Con el pago manual en tienda y un TTL de 20 minutos, el pago casi siempre llega después de que la orden expiró (ADR-0055).
  - Los eventos se despachan después del commit y sin outbox; un correo puede perderse (riesgo aceptado en ADR-0014).
  - Las órdenes anonimizadas no tienen email de contacto (ADR-0067).
  - Los correos de cuenta (verificación, recuperación y aviso de cambio de contraseña) ya están decididos en ADR-0046, ADR-0056 y ADR-0072, y no forman parte de esta decisión.
- **Decisión propuesta:**
  - **Criterio:** se notifica al cliente todo cambio de su orden que él no provocó directamente y que le afecta, además de la confirmación de la compra.
  - **Correos que se envían:**

    | Correo | Evento | Contenido mínimo |
    |---|---|---|
    | Orden recibida | `OrderPlaced` | Código público, líneas, totales, dirección de envío resumida, instrucciones de pago en tienda y plazo de la reserva |
    | Pago confirmado | `OrderPaid` | Código público y total pagado |
    | Orden enviada | `ShipmentDispatched` | Código público; paquetería y guía, si existen |
    | Orden entregada | `OrderDelivered` | Código público y fecha; invita a contactar a la tienda si no recibió el pedido |
    | Orden cancelada | `OrderCancelled` | Código público; si hubo pago capturado, indica que el reembolso está en proceso |
    | Reembolso completado | `RefundCompleted` | Código público y monto reembolsado |

  - **Correos que no se envían en el MVP:**
    - Orden expirada (`OrderExpired`): con el pago en tienda llegaría en casi toda compra seguida de "pago confirmado", lo que confunde. Se revisa al habilitar pagos en línea.
    - Pago tardío sin stock (AwaitingManualFulfillment): con el pago en tienda el cliente está presente cuando el staff lo registra; la resolución posterior genera "pago confirmado" o "orden cancelada". No hay evento para este estado y no se crea uno.
    - Entrega fallida y devolución (`DeliveryFailed`, `ShipmentReturned`): se gestionan fuera del sistema (ADR-0053).
    - Pago fallido (`PaymentFailed`): el pago manual no falla y PayPal no está habilitado (ADR-0040).
    - Notificaciones al staff: el staff trabaja con las vistas administrativas (órdenes en AwaitingManualFulfillment y canceladas con reembolso pendiente).
  - **Destinatario:** el email de contacto de la orden (en clientes registrados es el email de la cuenta al colocarla). Si la orden está anonimizada, no se envía.
  - **Contenido:** en español; solo el código público, nunca el número interno (ADR-0049); sin datos de pago, tokens ni enlaces a la orden mientras P-56 esté abierta. Son correos transaccionales, sin opción de baja ni contenido promocional.
  - **Entrega:** asíncrona, al recibir el evento después del commit (ADR-0014). Como máximo un envío por evento; sin reintentos; los fallos se registran en logs sin el email del destinatario. No se agrega tabla de notificaciones: el modelo de datos aprobado (ADR-0066) no cambia.
- **Alternativas consideradas:** Solo confirmación de compra y de envío (el cliente no se entera de cancelaciones ni reembolsos); notificar todo cambio de estado, incluidos expiración y entrega fallida; registro de notificaciones enviadas con reintentos (requiere tabla nueva y un job).
- **Consecuencias:**
  - T-215 queda desbloqueada. El módulo de notificaciones consume eventos de Ordering, Payments y Shipping, y obtiene el email de contacto y los datos de la orden mediante la fachada de Ordering (ADR-0005).
  - El correo de orden recibida no es comprobante: el código público también se entrega en la respuesta de la API. Si el negocio llega a depender de él, se revisa ADR-0014.
  - La mención de estos correos en el aviso de privacidad se valida junto con P-61.
- **Revisar si:** se habilitan pagos en línea (expiración y pago fallido), se integra una paquetería (entrega fallida) o se decide P-56 (enlaces en los correos).
- **Estado:** Propuesta.

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
| ADR-0074 | Notificaciones por correo del ciclo de la orden | Aceptada |
| ADR-0075 | Permiso para configurar el costo de envío | Aceptada |
| ADR-0076 | Reactivación de entidades suspendidas, archivadas o desactivadas | Aceptada |
| ADR-0077 | Enlace de acceso al pedido por correo | Aceptada |
| ADR-0078 | Envíos sin paquetería | Aceptada |
| ADR-0079 | IVA del costo de envío y base del umbral de envío gratis | Aceptada |
| ADR-0080 | Efecto de desactivar categorías y marcas en la tienda | Aceptada |
| ADR-0081 | Un solo almacén en el MVP | Aceptada |
| ADR-0082 | Recompra del staff cuando el carrito original ya no existe | Aceptada |
| ADR-0083 | Plazo de entrega estimado | Aceptada |
| ADR-0084 | Formato de código, ramas y mensajes de commit | Aceptada |
| ADR-0085 | CORS | Aceptada |
| ADR-0086 | Encabezados de seguridad de las respuestas HTTP | Aceptada |
| ADR-0087 | Validación de entrada y de configuración con class-validator | Aceptada |
| ADR-0088 | Estructura de carpetas y convenciones de nombres | Aceptada |
| ADR-0089 | Uso de Docker: desarrollo local e imagen de producción | Aceptada |
| ADR-0090 | Base de datos de los tests de integración con Testcontainers | Aceptada |
| ADR-0091 | Prisma: configuración, esquema por contexto y primera migración | Aceptada |
| ADR-0092 | Valores iniciales del método de envío | Aceptada |
| ADR-0093 | Contexto transaccional con `nestjs-cls` | Aceptada |
| ADR-0094 | Shared kernel: dinero, IVA contenido, identificadores, errores, eventos y reloj | Aceptada |
| ADR-0095 | Respuestas de error, validación de entrada e identificador de correlación | Aceptada |
| ADR-0096 | Versionado por ruta y documentación OpenAPI en local | Aceptada |
| ADR-0097 | Logs de la aplicación | Aceptada |
| ADR-0098 | Bus de eventos en proceso con despacho en segundo plano | Aceptada |
| ADR-0099 | Mecanismo de idempotencia HTTP | Aceptada |
| ADR-0100 | Mecanismo de registro de auditoría | Aceptada |
| ADR-0101 | Base de los jobs programados | Aceptada |
| ADR-0102 | Mecanismo de rate limiting | Aceptada |
| ADR-0103 | Verificación automática de límites entre módulos y capas | Aceptada |
| ADR-0104 | Base del cache con espacios de nombres | Aceptada |
| ADR-0105 | Pipeline de CI en GitHub Actions | Aceptada |
| ADR-0106 | Protección de la rama principal y Dependabot | Aceptada |
| ADR-0107 | TypeScript se mantiene en 6.x | Aceptada |
| ADR-0108 | Scripts de instalación de las dependencias | Aceptada |
| ADR-0109 | Catálogo geográfico del INEGI y scripts de operación | Aceptada |
| ADR-0110 | Envío de correos y enlaces al frontend | Aceptada |
| ADR-0111 | Autorización, catálogo de permisos y base de Identity & Access | Aceptada |

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
- **Estado:** Aceptada. El puerto del reloj es uno solo para todos los contextos y va en el shared kernel, igual que `TransactionManager` (ADR-0093, ADR-0094).

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
- **Estado:** Aceptada (aprobación formal 2026-09-24). Los límites se verifican con `dependency-cruiser` (ADR-0103).

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
- **Consecuencias:** El desglose por línea es consistente con el total. Tasas aplicables y reglas por producto: resueltas en ADR-0027.
- **Estado:** Aceptada. El modo de redondeo (al centavo, con las mitades hacia arriba) está en ADR-0094.

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
- **Estado:** Aceptada. Implementada en ADR-0098, con despacho en segundo plano.

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
- **Estado:** Aceptada. ADR-0111 precisa la ubicación del catálogo: un único archivo en el shared kernel, agrupado por contexto.

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
- **Nota de la revisión del 2026-09-26:** en el MVP hay un solo método de envío (ADR-0042), así que la cotización no ofrece opciones de envío y la colocación de la orden no recibe una.
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
- **Estado:** Aceptada. El enlace por correo queda fuera del MVP (ADR-0077).

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
- **Estado:** Aceptada. Implementada en ADR-0104.

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
      - Tokens de verificación de email y de recuperación de contraseña vencidos o usados (ADR-0056; agregado en la revisión del 2026-09-26).
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
- **Estado:** Aceptada. La base común de los jobs se detalla en ADR-0101.

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
- **Estado:** Aceptada. El pipeline se implementó en ADR-0105; la protección de la rama principal y Dependabot, en ADR-0106.

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
- **Estado:** Aceptada. Los logs en consola se detallan en ADR-0097.

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
- **Estado:** Aceptada. El contexto transaccional se detalla en ADR-0093; el identificador de correlación, en ADR-0095.

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
- **Estado:** Aceptada. Implementada con el versionado por ruta de NestJS (ADR-0096).

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
- **Estado:** Aceptada. Implementada en ADR-0111.

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
- **Estado:** Aceptada. El registro (UC-AUD-01) se implementa en ADR-0100.

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
- **Estado:** Aceptada. Valores iniciales en ADR-0092.

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
| `shipping.configure` | Configurar el costo de envío y el umbral de envío gratis (agregado por ADR-0075) |
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
- **Estado:** Aceptada. Roles iniciales creados por migración y superadministrador con permisos implícitos en ADR-0111.

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
- **Estado:** Aceptada. Implementada en ADR-0110 (T-122).

---

## ADR-0046 — Mecanismo de verificación de email

- **Fecha:** 2026-09-24
- **Contexto:** Cierra P-32.
- **Decisión:**
  - Se envía un enlace con un token firmado de un solo uso, vigente 24 horas (configurable). *Nota de la revisión del 2026-09-26: el modelo de datos (ADR-0066) guarda un token aleatorio con hash, igual que ADR-0056; no se usa un token firmado.*
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
- **Estado:** Aceptada. La URL base del frontend y el armado de los enlaces se implementaron en ADR-0110 (T-122).

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
- **Estado:** Aceptada. Implementada en ADR-0109 (T-124).

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
- **Estado:** Aceptada. Implementada en ADR-0099.

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
- **Estado:** Aceptada. Implementada en ADR-0102.

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
  - Varias protecciones requieren SQL manual en las migraciones (extensiones, `CHECK`, exclusión, índices parciales y de expresión, secuencia, trigger). En T-110 hay que comprobar que la verificación de migraciones de la CI no los detecte como diferencias. Comprobado en T-110: Prisma no los detecta (ADR-0091).
  - Si algún monto pudiera superar 21.4 millones de pesos, habrá que migrar ese campo a `bigint`.
- **Pendientes que afectan al modelo, sin bloquearlo:** P-57 (envíos sin paquetería), P-58 (IVA del envío). Los ajustes por datos personales ya se incorporaron (ADR-0067).
- **Estado:** Aceptada (aprobación formal 2026-09-25). Los pendientes P-57 y P-58 no la bloquean. Modificada por ADR-0076 (la unicidad de opciones de `product_variants` cuenta solo variantes activas), ADR-0078 (columna `own_delivery` en `shipments`), ADR-0079 (IVA del envío en `orders`), ADR-0081 (a lo sumo un almacén activo) y ADR-0083 (plazo de entrega estimado en `shipping_methods` y `orders`). Implementada en T-110 con los detalles de ADR-0091 (`order_number` como `BIGSERIAL`, forma del índice de almacén activo y borrado de carritos fusionados).

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
  - La herramienta de formato sigue pendiente de confirmar en T-104 (el proyecto trae una configuración de Prettier). Resuelta en ADR-0084: Prettier.
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
- **Decisión:**
  - **Criterio:** se notifican la confirmación de la compra y los cambios de la orden que el cliente no provocó y de los que no se enteraría de otra forma: pago registrado por el staff, envío, cancelación y reembolso.
  - **Correos que se envían:**

    | Correo | Evento | Contenido mínimo |
    |---|---|---|
    | Orden recibida | `OrderPlaced` | Código público, líneas, totales, dirección de envío resumida, instrucciones de pago en tienda, plazo de la reserva y plazo de entrega estimado (agregado por ADR-0083) |
    | Pago confirmado | `OrderPaid` | Código público y total pagado |
    | Orden enviada | `ShipmentDispatched` | Código público; paquetería y guía, o "entrega de la tienda" (ADR-0078) |
    | Orden cancelada | `OrderCancelled` | Código público; si hubo pago capturado, indica que el reembolso está en proceso |
    | Reembolso completado | `RefundCompleted` | Código público y monto reembolsado |

  - **Correos que no se envían en el MVP:**
    - Orden entregada (`OrderDelivered`): por decisión del equipo (2026-09-25).
    - Orden expirada (`OrderExpired`): con el pago en tienda llegaría en casi toda compra seguida de "pago confirmado", lo que confunde. Se revisa al habilitar pagos en línea.
    - Pago tardío sin stock (AwaitingManualFulfillment): con el pago en tienda el cliente está presente cuando el staff lo registra; la resolución posterior genera "pago confirmado" o "orden cancelada". No hay evento para este estado y no se crea uno.
    - Entrega fallida y devolución (`DeliveryFailed`, `ShipmentReturned`): se gestionan fuera del sistema (ADR-0053).
    - Pago fallido (`PaymentFailed`): el pago manual no falla y PayPal no está habilitado (ADR-0040).
    - Notificaciones al staff: el staff trabaja con las vistas administrativas (órdenes en AwaitingManualFulfillment y canceladas con reembolso pendiente).
  - **Destinatario:** el email de contacto de la orden (en clientes registrados es el email de la cuenta al colocarla). Si la orden está anonimizada, no se envía.
  - **Contenido:** en español; solo el código público, nunca el número interno (ADR-0049); sin datos de pago, tokens ni enlaces a la orden (ADR-0077). Son correos transaccionales, sin opción de baja ni contenido promocional.
  - **Entrega:** asíncrona, al recibir el evento después del commit (ADR-0014). Como máximo un envío por evento; sin reintentos; los fallos se registran en logs sin el email del destinatario. No se agrega tabla de notificaciones: el modelo de datos aprobado (ADR-0066) no cambia.
- **Alternativas consideradas:** Solo confirmación de compra y de envío (el cliente no se entera de cancelaciones ni reembolsos); notificar todo cambio de estado, incluidos expiración y entrega fallida; registro de notificaciones enviadas con reintentos (requiere tabla nueva y un job).
- **Consecuencias:**
  - T-215 queda desbloqueada. El módulo de notificaciones consume eventos de Ordering, Payments y Shipping, y obtiene el email de contacto y los datos de la orden mediante la fachada de Ordering (ADR-0005).
  - El correo de orden recibida no es comprobante: el código público también se entrega en la respuesta de la API. Si el negocio llega a depender de él, se revisa ADR-0014.
  - La mención de estos correos en el aviso de privacidad se valida junto con P-61.
- **Revisar si:** se habilitan pagos en línea (expiración y pago fallido), se integra una paquetería (entrega fallida) o se implementa el enlace de acceso al pedido (ADR-0077).
- **Estado:** Aceptada (aprobación formal 2026-09-25).

---

## ADR-0075 — Permiso para configurar el costo de envío

- **Fecha:** 2026-09-25
- **Contexto:** Cierra P-48. El costo fijo y el umbral de envío gratis (ADR-0042) son valores monetarios que se aplican a cada orden. `shipping.manage` lo tiene también el Operador (ADR-0043), mientras que las operaciones con dinero (pagos manuales, reembolsos) y las cancelaciones quedan en Administrador y Superadministrador.
- **Decisión:**
  - Solo los usuarios administrativos (Superadministrador y Administrador) configuran el costo de envío y el umbral de envío gratis.
  - Se implementa con un permiso nuevo en el catálogo de ADR-0043: `shipping.configure`. Los roles iniciales Superadministrador y Administrador lo incluyen; el Operador no.
  - Como la autorización se basa en permisos (ADR-0017), no se comprueba el nombre del rol.
  - Consultar el método de envío sigue con `shipping.manage`.
- **Alternativas consideradas:** Usar `shipping.manage` (el Operador podría cambiar un valor monetario); reutilizar `payments.manage` u `orders.manage` (mezcla contextos, en contra de ADR-0017); comprobar el nombre del rol (los roles son editables y la autorización es por permisos).
- **Consecuencias:**
  - El catálogo de permisos pasa de 14 a 15.
  - Como los roles se editan en base de datos, un rol creado después puede recibir `shipping.configure`; el cambio de permisos de un rol se audita (ADR-0037).
- **Estado:** Aceptada.

---

## ADR-0076 — Reactivación de entidades suspendidas, archivadas o desactivadas

- **Fecha:** 2026-09-25
- **Contexto:** Cierra P-49. ADR-0038 define suspender, archivar, descontinuar y desactivar como alternativas al borrado, pero no el camino de regreso; hoy esas operaciones son irreversibles. Condiciones:
  - Un error de operación (archivar el producto equivocado, suspender a otra persona) no tiene corrección, y la única salida es crear duplicados.
  - El email de un usuario suspendido, el slug de un producto archivado y el SKU de una variante descontinuada siguen reservados (ADR-0038), así que reactivar no choca con otros registros por esos valores.
  - Una cuenta de staff puede suspenderse por sospecha de que su contraseña está comprometida.
  - La anonimización es irreversible (ADR-0067) y queda fuera de esta decisión.
  - La restricción `UNIQUE (product_id, options)` de `product_variants` (ADR-0066) incluye las variantes descontinuadas. Con ella, la corrección que prevé ADR-0068 (descontinuar una variante y crear otra con las mismas opciones y el SKU correcto) es imposible.
- **Decisión:**
  - **Criterio general:** cada desactivación de P-49 se revierte con una acción explícita `POST …/reactivate`, con el mismo permiso que la desactivación. Se audita. No se emiten eventos nuevos (no tienen consumidor) y la cache refleja la reactivación al vencer su TTL (ADR-0028).

    | Entidad | Transición | Permiso | Reglas |
    |---|---|---|---|
    | Staff | SUSPENDED → ACTIVE | `staff.manage` | Requiere motivo. Se genera una contraseña temporal nueva, devuelta una sola vez como en el alta, con cambio obligatorio en el siguiente inicio de sesión. Conserva sus roles |
    | Cliente | SUSPENDED → ACTIVE | `customers.manage` | Requiere motivo. Conserva su contraseña y el estado de verificación del email; si no la recuerda, usa la recuperación. Un cliente anonimizado no se reactiva |
    | Producto | ARCHIVED → DRAFT | `catalog.write` | No vuelve directo a la tienda: se publica con el flujo normal (BR-PRD-04). Conserva slug y `firstPublishedAt`, y con ello el bloqueo de SKU y opciones (ADR-0068) |
    | Variante | DISCONTINUED → ACTIVE | `catalog.write` | Solo si ninguna variante activa del producto tiene la misma combinación de opciones. Vuelve a ser vendible cuando cumple BR-PRD-11 |
    | Categoría | INACTIVE → ACTIVE | `catalog.write` | Solo si su categoría padre está activa o es raíz. No reactiva subcategorías |
    | Marca | INACTIVE → ACTIVE | `catalog.write` | — |

  - **Modelo de datos:** la restricción `UNIQUE (product_id, options)` pasa a índice único parcial `(product_id, options) WHERE status = 'ACTIVE'`. La combinación de opciones es única entre variantes activas (BR-PRD-02), lo que permite la corrección de ADR-0068 y hace que la base garantice la regla de reactivación de variantes.
- **Alternativas consideradas:** Mantener las operaciones irreversibles; reactivar al staff con su contraseña anterior (riesgoso si la suspensión fue por compromiso); reactivar el producto directamente en PUBLISHED; permitir la reactivación solo al Superadministrador.
- **Consecuencias:**
  - Modifica el modelo de datos aprobado (ADR-0066) en un índice de `product_variants`; T-110 aún no crea migraciones, así que no hay datos que migrar.
  - Nuevos endpoints, todos `POST` y con respuesta 200: `/v1/admin/identity/staff/{userId}/reactivate` (devuelve la contraseña temporal con `Cache-Control: no-store`), `/v1/admin/identity/customers/{userId}/reactivate`, `/v1/admin/catalog/products/{productId}/reactivate`, `…/variants/{variantId}/reactivate`, `/v1/admin/catalog/categories/{categoryId}/reactivate` y `/v1/admin/catalog/brands/{brandId}/reactivate`. Errores: 409 `invalid-state-transition` (estado de origen incorrecto o categoría padre inactiva) y 409 `duplicate-value` (combinación de opciones ocupada).
  - Se retiran las notas "irreversible mientras P-49 esté abierta" (descontinuar variante) y "archivado mientras P-49 esté abierta" (publicar producto): un producto archivado primero se reactiva a DRAFT y luego se publica.
  - La reactivación de staff y clientes es un evento de seguridad auditado, igual que la suspensión (ADR-0037).
  - Fuera de alcance: almacenes y listas de precios desactivados (ADR-0038) tampoco tienen reactivación, pero no forman parte de P-49.
- **Estado:** Aceptada (aprobación formal 2026-09-25), incluido el cambio del índice de `product_variants`.

---

## ADR-0077 — Enlace de acceso al pedido por correo

- **Fecha:** 2026-09-25
- **Contexto:** Cierra P-56 (UC-ORD-05, T-186). ADR-0020 dejó el enlace por correo como mecanismo adicional "si su costo es bajo". Hechos relevantes:
  - El invitado ya consulta su pedido con email y código público (UC-ORD-04, `POST /v1/orders/lookup`), con rate limiting.
  - El código público se entrega en la respuesta de la API al colocar la orden y en el correo de orden recibida (ADR-0074).
  - El contrato provisional de `API_SPEC.md` pide para solicitar el enlace **los mismos datos** que la consulta directa (email y código). Quien puede pedir el enlace ya puede consultar el pedido, así que el enlace solo agrega la prueba de que el solicitante controla el buzón.
  - El caso que la consulta directa no resuelve es el invitado que perdió el código (borró o no recibió el correo de orden recibida, que puede perderse según ADR-0014).
  - El staff puede buscar órdenes por email de contacto (ADR-0049) y atender ese caso por un canal externo.
  - No hay frontend todavía: el enlace se armaría con la URL base del frontend, como la recuperación de contraseña (ADR-0056).
- **Decisión:**
  - No se implementa el enlace de acceso en el MVP. UC-ORD-05 y T-186 pasan a DEFERRED.
  - Se retira del contrato el diseño provisional (`POST /v1/orders/access-links` y `POST /v1/orders/access`), porque duplica la consulta directa.
  - Los correos de la orden no llevan enlaces a la orden; muestran el código público (ADR-0074).
  - Un invitado que perdió su código se atiende por un canal externo: el staff busca la orden por email con `orders.read`.
  - **Diseño previsto si se implementa después** (recuperación por email):
    - `POST /v1/orders/access-links` con solo `{ "contactEmail" }`; responde 202 sin cuerpo exista o no una orden, y envía al buzón un enlace que da acceso a las órdenes de invitado de ese email.
    - Token aleatorio de un solo uso, guardado como hash, vigente 30 minutos, con límite por email y por IP (como ADR-0056). Requiere una tabla nueva en Ordering.
    - Lo usaría también un comprador que perdió el correo de orden recibida.
- **Alternativas consideradas:**
  - Implementar el contrato provisional (email y código): costo de tabla, token, correo y endpoints sin resolver el código perdido.
  - Implementar ya la recuperación por email: resuelve el código perdido, pero agrega una tabla al modelo de datos aprobado, un tipo de token, un correo y dos endpoints, sin frontend para probar el flujo completo.
  - Token firmado sin estado (lo que menciona ADR-0020): evita la tabla, pero no se puede invalidar ni usar una sola vez, a diferencia de los demás tokens del sistema.
- **Consecuencias:**
  - T-186 deja de estar bloqueada y pasa a DEFERRED; el MVP no depende de la entrega de correos para que un invitado consulte su pedido.
  - Se actualizan ADR-0020 (el enlace queda fuera del MVP), BR-ORD-10 y ADR-0074 (sin enlaces en los correos).
  - El modelo de datos aprobado (ADR-0066) no cambia.
- **Revisar si:** el staff recibe solicitudes frecuentes de invitados que perdieron su código, o existe frontend y proveedor de correo real (P-24).
- **Estado:** Aceptada (aprobación formal 2026-09-25).

---

## ADR-0078 — Envíos sin paquetería

- **Fecha:** 2026-09-25
- **Contexto:** Cierra P-57 (T-195). BR-SHP-04 exige guía "cuando interviene una paquetería", lo que sugiere envíos sin ella. Son dos casos distintos:
  - **Entrega propia:** la tienda lleva el pedido con su personal o un mensajero, a la dirección de la orden. Solo cambia quién entrega; el flujo de pago, envío y estados es el mismo.
  - **Recoger en tienda:** el cliente elige no recibir envío. Cambia el checkout (dirección opcional, costo 0, elección del método), los estados (listo para recoger, recogido), la identificación de quien recoge y los correos.
  - El modelo actual ya permite despachar sin paquetería: `carrier_name` y `tracking_number` son opcionales y la guía solo se exige si hay paquetería. Pero no distingue "entrega propia" de "olvidé capturar la paquetería", así que un envío por paquetería puede despacharse sin guía por error.
  - Hay un solo método de envío activo (ADR-0042, índice único parcial en `shipping_methods`), y la dirección de envío es obligatoria en el checkout.
- **Decisión:**
  - **Entrega propia: sí en el MVP.** Es una decisión operativa del staff al despachar, no una opción del cliente. Aplican el mismo costo de envío (ADR-0042), los mismos estados (ADR-0050, ADR-0053) y la misma dirección de la orden.
  - Al despachar, el staff indica una de dos formas:
    - Paquetería: `carrierName` y `trackingNumber` obligatorios (BR-SHP-04).
    - Entrega propia: `ownDelivery: true`, sin paquetería ni guía.
  - Nueva columna `shipments.own_delivery boolean NOT NULL DEFAULT false`, con `CHECK (status = 'PENDING' OR own_delivery OR (carrier_name IS NOT NULL AND tracking_number IS NOT NULL))` y `CHECK (NOT own_delivery OR (carrier_name IS NULL AND tracking_number IS NULL))`. La base garantiza que no se despacha por paquetería sin guía, validación que hoy solo hace la aplicación.
  - Las vistas de envío (`AdminShipment` y `shipment` de la orden del cliente) incluyen `ownDelivery`. El correo de orden enviada (ADR-0074) indica "entrega de la tienda" en lugar de paquetería y guía.
  - **Recoger en tienda: fuera del MVP.** Se agrega a la lista de alcance excluido. Requiere su propia decisión: elección en el checkout, dirección opcional, costo, estados, identificación al recoger y correo de "listo para recoger".
- **Alternativas consideradas:**
  - Mantener la regla actual (sin paquetería no se exige guía): no requiere cambios, pero no distingue la entrega propia de un olvido.
  - Registrar la entrega propia como texto en `carrierName` (por ejemplo, "Entrega propia"): evita la columna, pero no se puede validar ni distinguir de forma fiable.
  - Implementar también recoger en tienda en el MVP: cambia checkout, órdenes, envíos, estados y correos.
- **Consecuencias:**
  - Modifica el modelo de datos aprobado (ADR-0066) en una columna y una restricción de `shipments`; aún no hay migraciones.
  - Cambia el contrato de `POST …/shipments/{id}/dispatch` (acepta `ownDelivery`) y agrega `ownDelivery` a `AdminShipment` y a `shipment` de `Order`.
  - `PATCH …/shipments/{id}` no puede capturar paquetería ni guía en un envío despachado como entrega propia.
- **Revisar si:** el negocio quiere ofrecer recoger en tienda, o se integra una paquetería (ADR-0041).
- **Estado:** Aceptada (aprobación formal 2026-09-26).

---

## ADR-0079 — IVA del costo de envío y base del umbral de envío gratis

- **Fecha:** 2026-09-26
- **Contexto:** Cierra P-58 (UC-SHI-01, T-196). Los precios incluyen IVA (ADR-0008), todo lleva IVA del 16% configurable (ADR-0027) y el total es subtotal + envío − descuento (BR-ORD-16). ADR-0042 no decía si el costo de envío incluye IVA ni contra qué monto se compara el umbral de envío gratis. Cuando el vendedor cobra el envío junto con la venta, ese cobro suele gravarse con el mismo IVA que la mercancía; el tratamiento fiscal lo confirma el contador del negocio.
- **Decisión:**
  - **IVA del envío:** el costo de envío configurado incluye IVA, igual que los precios de productos; el cliente paga el monto configurado.
    - El IVA contenido en el envío se calcula con la misma tasa configurada (ADR-0027) y con la misma regla de redondeo por línea (ADR-0008), y se guarda como snapshot en la orden junto con la tasa aplicada.
    - `taxTotal` de la orden es el IVA de las líneas más el del envío. La fórmula del total no cambia.
  - **Umbral de envío gratis:** el envío es gratis cuando subtotal con IVA − descuento ≥ umbral. El costo de envío no cuenta para alcanzarlo. En el MVP el descuento siempre es 0 (ADR-0018).
  - Con envío gratis, el costo de envío y su IVA son 0.
  - **Ejemplo:** productos por $1,198.00 (IVA $165.24) y envío de $99.00 (IVA $13.66): total $1,297.00 e IVA total $178.90. Con un umbral de $1,500, un carrito de $1,600 con IVA tiene envío gratis.
- **Alternativas consideradas:** Sumar el IVA al costo configurado ($99 + $15.84); envío sin IVA; comparar el umbral contra el subtotal sin IVA (un cliente que ve $1,600 en su carrito pagaría envío con un umbral anunciado de $1,500).
- **Consecuencias:**
  - Modifica el modelo de datos aprobado (ADR-0066): columnas `shipping_tax_amount` y `shipping_tax_rate_bp` en `orders`; la restricción `tax_total <= subtotal` pasa a `tax_total <= subtotal + shipping_cost`, y se agrega `shipping_tax_amount <= shipping_cost`.
  - `CheckoutQuote` y `Order` agregan `shippingTaxAmount`, un cambio compatible dentro de `v1`.
  - El tratamiento del IVA del envío se valida con el contador antes de operar con clientes reales (P-69).
- **Revisar si:** el contador indica otro tratamiento, se emiten facturas (ADR-0027) o se habilitan promociones (ADR-0018).
- **Estado:** Aceptada (aprobación formal 2026-09-26).

---

## ADR-0080 — Efecto de desactivar categorías y marcas en la tienda

- **Fecha:** 2026-09-26
- **Contexto:** Cierra P-66, detectada en la revisión integral de la documentación. ADR-0038 permite desactivar categorías y marcas con productos, y ADR-0076 permite reactivarlas, pero no se definía qué pasa en el catálogo público mientras están inactivas.
- **Decisión:**
  - **Categoría visible:** activa y con todos sus ancestros activos. Solo las categorías visibles aparecen en el árbol público.
  - **Desactivar una categoría** la oculta junto con todas sus subcategorías, aunque estas sigan activas. Al reactivarla (ADR-0076), sus subcategorías activas vuelven a verse.
  - **Los productos de una categoría oculta siguen publicados y visibles** en listados, búsqueda y detalle, pero dejan de mostrarse como parte de esa categoría: el detalle del producto solo lista categorías visibles y la búsqueda por texto no usa el nombre de categorías ocultas.
  - **Desactivar una marca** la quita del listado público de marcas; sus productos siguen visibles y siguen mostrando la marca.
  - **Filtros:** filtrar el catálogo público por una categoría oculta o por una marca inactiva responde 400 `validation-error`.
- **Alternativas consideradas:** Ocultar los productos de categorías o marcas inactivas; mantener visibles las subcategorías activas de una categoría desactivada.
- **Consecuencias:**
  - La aplicación recalcula el `search_vector` de los productos afectados al desactivar o reactivar una categoría.
  - Nueva regla BR-PRD-17.
- **Estado:** Aceptada (aprobación formal 2026-09-26).

---

## ADR-0081 — Un solo almacén en el MVP

- **Fecha:** 2026-09-26
- **Contexto:** Cierra P-67, detectada en la revisión integral de la documentación. Operar varios almacenes ya está fuera del MVP (BR-INV-08, ADR-0011, `PROJECT.md`), y el seed crea un almacén predeterminado (`DATABASE.md`, sección 13). Sin embargo, la API permite crear y desactivar almacenes (UC-INV-01), el modelo no marca cuál es el predeterminado y no se define qué almacén usa una reserva si hay varios activos.
- **Decisión:**
  - En el MVP existe exactamente un almacén, creado por el seed. Es el predeterminado y el único que usan las reservas, las entradas, los ajustes y los envíos.
  - La API de almacenes queda en consulta y edición: `GET /v1/admin/inventory/warehouses` y `PATCH …/{warehouseId}` (nombre y dirección). Se retiran del MVP la creación (`POST /v1/admin/inventory/warehouses`) y la desactivación (`POST …/{warehouseId}/deactivate`).
  - La base garantiza a lo sumo un almacén activo con un índice único parcial `((true)) WHERE status = 'ACTIVE'`.
  - Las entradas y los ajustes conservan `warehouseId` en la solicitud, para no cambiar el contrato cuando haya varios almacenes; en el MVP solo se acepta el almacén activo.
  - La asignación de almacén sigue como domain service (ADR-0011). Al habilitar varios almacenes se definirán el almacén predeterminado o la prioridad y las reglas de asignación.
- **Alternativas consideradas:** Mantener la creación de almacenes con un indicador de predeterminado; permitir almacenes inactivos adicionales sin uso.
- **Consecuencias:** Modifica los contratos aprobados (ADR-0071) en dos endpoints y el modelo de datos (ADR-0066) en un índice; aún no hay implementación ni migraciones.
- **Revisar si:** se decide operar más de un almacén.
- **Estado:** Aceptada (aprobación formal 2026-09-26).

---

## ADR-0082 — Recompra del staff cuando el carrito original ya no existe

- **Fecha:** 2026-09-26
- **Contexto:** Cierra P-68, detectada en la revisión integral de la documentación. Cuando el staff copia una orden cancelada de un invitado, las líneas van al carrito original de la orden (ADR-0054, ADR-0055). Los carritos de invitado sin actividad se borran a los 30 días (BR-CRT-06), así que ese carrito puede ya no existir.
- **Decisión:**
  - Si el carrito original ya no existe, la recompra no se realiza: responde 409 `source-cart-unavailable`, con un `detail` que indica que el carrito de la orden ya no existe. No se crea un carrito nuevo.
  - El invitado conserva la recompra por su cuenta (`POST /v1/orders/reorder`), que crea un carrito si no envía uno.
- **Alternativas consideradas:** Crear un carrito nuevo y devolver su `cartId` al staff para que lo comunique al cliente.
- **Consecuencias:** Nuevo error E-34 (`source-cart-unavailable`, 409 según ADR-0064).
- **Estado:** Aceptada (aprobación formal 2026-09-26).

---

## ADR-0083 — Plazo de entrega estimado

- **Fecha:** 2026-09-26
- **Contexto:** Cierra P-64 (BR-SHP-08). El sistema no informaba al cliente cuándo recibiría su pedido. La Ley Federal de Protección al Consumidor obliga al proveedor a informar y respetar los plazos de entrega que ofrece (art. 7) y a informar las condiciones antes de la compra en el comercio electrónico (art. 76 BIS), así que el plazo que se muestra funciona como compromiso. Los envíos son manuales (ADR-0041, ADR-0078), con un solo método de envío y costo fijo para todo México (ADR-0042).
- **Decisión:**
  - Se informa al cliente un **plazo de entrega estimado**, no una fecha comprometida: un rango en días hábiles (mínimo y máximo), contado desde la confirmación del pago.
  - El rango se configura en el método de envío, con el permiso `shipping.configure` (ADR-0075). Valor inicial: 3 a 7 días hábiles.
  - Se muestra en la cotización del checkout y en el correo de orden recibida (ADR-0074), y la orden lo guarda como snapshot al colocarse; un cambio posterior del rango no afecta a órdenes colocadas.
  - No se calcula una fecha: al ser un rango en días hábiles, no se necesita calendario de festivos ni hora de corte.
  - Un retraso no dispara acciones automáticas, igual que una entrega fallida (ADR-0053).
  - Sin plazo interno de despacho para el staff ni indicador de envíos atrasados en el MVP: la lista de envíos pendientes ya muestra primero los más antiguos.
- **Alternativas consideradas:** Texto informativo fuera de la API (la orden no guardaría lo prometido); fecha comprometida calculada con calendario de festivos y hora de corte; plazo interno de despacho con indicador de atrasados.
- **Consecuencias:**
  - Modifica el modelo de datos aprobado (ADR-0066): columnas `delivery_min_business_days` y `delivery_max_business_days` en `shipping_methods` y en `orders`.
  - `ShippingMethod`, `CheckoutQuote` y `Order` agregan el rango, un cambio compatible dentro de `v1`.
  - La forma de presentar el plazo al cliente se valida con el especialista legal junto con P-61.
- **Revisar si:** se integra una paquetería (plazos por servicio o zona), se ofrecen varios métodos de envío o se requiere una fecha comprometida.
- **Estado:** Aceptada (aprobación formal 2026-09-26).

---

## ADR-0084 — Formato de código, ramas y mensajes de commit

- **Fecha:** 2026-09-26
- **Contexto:** Cierra P-70. ADR-0030 exige "lint y formato" en la CI y ADR-0073 eligió oxlint para el lint, pero faltaban la herramienta de formato y las convenciones de ramas y commits. El proyecto ya traía Prettier configurado, y el historial mezclaba mensajes en inglés y en español.
- **Decisión:**
  - **Formato:** Prettier, con la configuración existente (comillas simples y coma final) y fin de línea LF.
    - Alcance: código y configuración (`.ts`, `.js`, `.json`, `.yml`). La documentación Markdown queda fuera mediante `.prettierignore`, porque alinear columnas reescribiría tablas completas en cada cambio.
    - Scripts: `npm run format` (escribe) y `npm run format:check` (verifica; es el que usa la CI).
  - **Ramas:** `tipo/T-xxx-descripcion-corta`, en minúsculas y con guiones, con los mismos tipos que los commits. Se incluye el ID de la tarea cuando existe; si el cambio resuelve una decisión, su ID (`p-xx`).
  - **Commits:** Conventional Commits: `tipo: descripción` en imperativo, en una línea corta, con cuerpo opcional y pie opcional con referencias (`Refs: T-100, ADR-0084`). Tipos: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` y `ci`.
  - **Idioma:** ramas, commits y pull requests (título y descripción) en inglés a partir del 2026-09-26. El historial anterior no se reescribe. La documentación del proyecto sigue en español.
  - **Verificación automática:** sin hooks de Git por ahora; la convención queda documentada y se revisa al configurar la CI (T-106), donde se puede agregar una comprobación de los mensajes.
- **Alternativas consideradas:** Biome (formatea y hace lint, pero se solapa con oxlint); oxfmt (más reciente); Prettier también sobre Markdown; commits en español; hooks con husky y commitlint desde el inicio.
- **Consecuencias:**
  - T-104 queda sin decisiones pendientes; `.prettierignore` y los scripts de formato ya existen.
  - El paso "lint y formato" de la CI ejecuta `npm run lint` y `npm run format:check`.
- **Estado:** Aceptada (aprobación formal 2026-09-26). La CI comprueba los mensajes de commit y el título del pull request desde ADR-0105.

---

## ADR-0085 — CORS

- **Fecha:** 2026-09-26
- **Contexto:** Cierra P-65. CORS solo aplica a clientes que corren en un navegador desde otro origen (un frontend web); las aplicaciones móviles, los servicios y los webhooks no pasan por él. Hechos relevantes:
  - La API no usa cookies: el token de acceso viaja en `Authorization: Bearer` (ADR-0023). Por eso no se necesita `Access-Control-Allow-Credentials`, que es la configuración más riesgosa de CORS, y otro sitio no puede usar la sesión de un usuario.
  - El frontend aún no existe y el proyecto solo corre en local (ADR-0031), así que los orígenes concretos no se conocen.
  - CORS no es control de acceso: un origen no permitido no recibe los encabezados CORS y el navegador bloquea la respuesta, pero la autorización sigue dependiendo del token y de los permisos.
  - El navegador solo deja leer al código del frontend los encabezados de respuesta básicos; `Location`, `Retry-After` y `X-Correlation-Id` (sección 2.4 de `API_SPEC.md`) deben exponerse explícitamente.
- **Decisión:**
  - **Lista de orígenes permitidos** en una variable de entorno (`CORS_ALLOWED_ORIGINS`), con orígenes exactos separados por coma (esquema, host y puerto; por ejemplo, `http://localhost:5173`), declarada en `.env.example` con un valor de ejemplo no real.
  - **Vacía por defecto:** sin orígenes configurados, la API no permite acceso desde navegadores de otros orígenes.
  - **Sin comodín:** la validación de configuración al arrancar rechaza `*` y los orígenes mal formados, y la API no inicia (ADR-0032).
  - **Una sola lista** para todos los grupos de rutas (público, cuenta y administración); los webhooks no dependen de CORS.
  - **Configuración fija:**

    | Parámetro | Valor |
    |---|---|
    | Credenciales | No (`Access-Control-Allow-Credentials` ausente) |
    | Métodos | `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
    | Encabezados de solicitud | `Authorization`, `Content-Type`, `Idempotency-Key` |
    | Encabezados expuestos | `Location`, `Retry-After`, `X-Correlation-Id` |
    | Caché de la solicitud previa (preflight) | 600 segundos |

  - La URL base del frontend para los enlaces de correo (ADR-0056) es otra variable; su origen normalmente también estará en la lista, pero no se deriva automáticamente.
- **Alternativas consideradas:** Comodín `*` (aceptable sin cookies, pero deja el acceso abierto a cualquier sitio y no se puede combinar con credenciales si algún día se usan); listas separadas para rutas públicas y administrativas (más configuración sin ganancia real mientras la autorización sea por token); posponer la decisión hasta tener frontend (el mecanismo no depende de los orígenes concretos).
- **Consecuencias:**
  - La implementación forma parte de T-100 (configuración validada al arrancar).
  - Cuando exista el frontend, habilitarlo es un cambio de configuración, no de código.
  - Si algún día se usan cookies, hay que revisar este ADR y la protección contra CSRF (`SECURITY.md`).
- **Revisar si:** se usan cookies, se agrega un encabezado de solicitud o de respuesta nuevo, o el panel de administración necesita una lista propia.
- **Estado:** Aceptada (aprobación formal 2026-09-26).

---

## ADR-0086 — Encabezados de seguridad de las respuestas HTTP

- **Fecha:** 2026-09-26
- **Contexto:** Cierra P-71. Solo estaba decidido `Cache-Control: no-store` en respuestas autenticadas o con datos personales (ADR-0071). La API responde casi siempre JSON; las excepciones son Swagger UI, que solo se sirve en local (ADR-0031), y las imágenes de productos si las sirve la API (ADR-0024, P-06). HTTPS lo termina quien se elija con el hosting.
- **Decisión:**
  - **Encabezados que pone la API en todas sus respuestas:**

    | Encabezado | Valor |
    |---|---|
    | `X-Content-Type-Options` | `nosniff` |
    | `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` |
    | `X-Frame-Options` | `DENY` |
    | `Referrer-Policy` | `no-referrer` |
    | `X-Powered-By` | Se elimina |
    | `Cache-Control` | `no-store` donde lo exige ADR-0071 |

  - **A cargo de quien termine HTTPS**, definido con el hosting (P-06): HSTS, configuración TLS y redirección de HTTP a HTTPS. La API no envía HSTS.
  - **Swagger UI:** política CSP más permisiva solo en su ruta, que existe únicamente en local.
  - **Implementación:** `helmet` con configuración explícita, no la de fábrica. En particular, no se envía `Cross-Origin-Resource-Policy: same-origin`, porque bloquearía las imágenes que la tienda cargue desde otro origen, ni HSTS, que corresponde al proxy.
- **Alternativas consideradas:** `helmet` con su configuración de fábrica (bloquea imágenes entre orígenes y duplica HSTS); middleware propio (menos dependencias, pero hay que mantener lo que `helmet` ya resuelve); HSTS desde la API.
- **Consecuencias:**
  - Los encabezados se configuran en T-100; la política de Swagger UI, en T-114.
  - Al elegir hosting (P-06) se configuran HSTS, TLS y la redirección a HTTPS, y se revisa que las imágenes lleven `X-Content-Type-Options: nosniff` las sirva quien las sirva.
- **Revisar si:** la API empieza a servir HTML, se usan cookies o cambia quién sirve las imágenes.
- **Estado:** Aceptada (aprobación formal 2026-09-26).

---

## ADR-0087 — Validación de entrada y de configuración con class-validator

- **Fecha:** 2026-09-26
- **Contexto:** T-100 necesita validar las variables de entorno al arrancar (ADR-0032), y los endpoints necesitarán validar sus DTOs de entrada (T-113), incluido el rechazo de campos no declarados (ADR-0071). Faltaba elegir la librería, que afecta a todo el proyecto.
- **Decisión:**
  - `class-validator` con `class-transformer` para validar y transformar tanto la configuración como los DTOs de Presentation.
  - Configuración: `@nestjs/config` con una función de validación. Si una variable obligatoria falta o una variable es inválida, la API no arranca; el mensaje nombra la variable y la regla, nunca el valor, para no exponer secretos en los logs. El resto del código lee la configuración tipada con `ConfigService`, nunca `process.env`.
  - DTOs: `ValidationPipe` de NestJS con rechazo de campos no declarados (se configura en T-113).
- **Alternativas consideradas:** zod (esquemas con tipos inferidos, pero requiere adaptadores de terceros para NestJS y Swagger); Joi (sin tipos de TypeScript, y habría que usar otra librería para los DTOs).
- **Consecuencias:**
  - El plugin de Swagger de NestJS puede leer los decoradores de los DTOs (T-114). Se usa desde T-114 (ADR-0096).
  - Domain no depende de estas librerías: los DTOs y la configuración viven fuera del dominio (ADR-0003).
- **Estado:** Aceptada (aprobación formal 2026-09-26).

---

## ADR-0088 — Estructura de carpetas y convenciones de nombres

- **Fecha:** 2026-09-26
- **Contexto:** T-101. ADR-0003 fija un módulo de NestJS por bounded context con cuatro capas, pero la estructura concreta de carpetas quedaba pendiente (`ARCHITECTURE.md`). T-100 había dejado `src/config/` y `src/http/` en ubicaciones provisionales, y el proyecto conservaba el ejemplo "Hello World" de NestJS.
- **Decisión:**
  - **Carpetas de primer nivel en `src/`:**
    - `platform/`: infraestructura técnica transversal, sin reglas de negocio (configuración, políticas HTTP y, después, persistencia, eventos, jobs, logs y cache).
    - `shared-kernel/`: `Money`, tipos de ID, error de dominio, forma de los eventos y puerto `Clock` (T-112), y los puertos `TransactionManager` (T-111, ADR-0093), `DomainEventPublisher` (T-116, ADR-0098), `AuditTrail` (T-127, ADR-0100), `EmailSender` y `FrontendLinks` (T-122, ADR-0110). TypeScript puro, sin NestJS.
    - `modules/<contexto>/`: un módulo por bounded context, con nombre en inglés y kebab-case: `identity-access`, `catalog`, `pricing`, `inventory`, `shopping`, `ordering`, `payments` y `shipping`.
  - **Cada contexto** tiene las carpetas `domain/`, `application/`, `infrastructure/` y `presentation/`, un `<contexto>.module.ts` que conecta las capas y un `index.ts` que es su API pública: solo exporta el módulo de NestJS, la fachada y sus tipos públicos (ADR-0005).
  - **Capacidades transversales** (auditoría, notificaciones y catálogo geográfico): módulos bajo `modules/` con solo las capas que necesiten, creados en sus tareas (T-127, T-215 y T-124).
  - **Imports relativos**, sin alias de rutas: con ESM y `nodenext`, TypeScript no reescribe los alias y habría que agregar otra herramienta de compilación.
  - **Nombres de archivo** en kebab-case con sufijo de rol: `order.ts` (aggregate o entidad), `order.repository.ts` (interfaz en `domain`), `prisma-order.repository.ts` (implementación en `infrastructure`), `place-order.use-case.ts`, `ordering.facade.ts`, `order.controller.ts`, `place-order.dto.ts`. Los tests unitarios van junto al código como `*.spec.ts`.
  - Se retira el ejemplo "Hello World" (`AppController` y `AppService`), que no forma parte de la API.
- **Alternativas consideradas:** Carpetas por capa en la raíz con subcarpetas por contexto (dispersa cada contexto); alias de rutas (`@modules/...`); crear desde ahora los módulos transversales vacíos.
- **Consecuencias:**
  - T-103 verifica automáticamente las dependencias entre capas y que un módulo solo importe de otro a través de su `index.ts`. Hecho en ADR-0103.
  - Las carpetas de capa vacías se conservan en Git con un archivo `.gitkeep` hasta tener código.
- **Estado:** Aceptada (aprobación formal 2026-09-26).

---

## ADR-0089 — Uso de Docker: desarrollo local e imagen de producción

- **Fecha:** 2026-09-26
- **Contexto:** T-102. ADR-0002 incluye Docker en el stack, pero su uso concreto estaba pendiente (`PROJECT.md`). El entorno local necesita PostgreSQL 18 y un capturador de correos (ADR-0045), y la CI construirá una imagen (ADR-0030, paso 10).
- **Decisión:**
  - **`Dockerfile` con dos etapas** sobre `node:24-bookworm-slim` (ADR-0025):
    - `development`: la usa Docker Compose; el proyecto se monta en el contenedor y la API corre con `npm run start:dev` (recarga automática).
    - `production`: solo el código compilado, las dependencias de producción y `package.json`; corre como usuario `node` con `NODE_ENV=production`. La construye la CI (T-106).
  - **`docker-compose.yml` para desarrollo local** con tres servicios:
    - `postgres`: `postgres:18`, datos en un volumen con nombre y chequeo de salud con `pg_isready`.
    - `mailpit`: `axllent/mailpit:v1`, bandeja web en el puerto 8025 y SMTP en el 1025.
    - `api`: etapa `development`; arranca cuando PostgreSQL está sano.
  - **Versiones:** se fija la versión mayor de cada imagen y se usa la última menor, igual que en ADR-0025.
  - **Alternativa documentada:** la API puede correr en el equipo (`npm run start:dev`) con solo PostgreSQL y Mailpit en contenedores.
  - **Credenciales:** `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB` en `.env`, con valores de ejemplo en `.env.example`. `docker-compose.yml` no tiene valores por defecto para ellas: si faltan, Compose se detiene con un mensaje.
  - **Recarga automática en el contenedor:** detección de cambios por sondeo (`TSC_WATCHFILE` y `TSC_WATCHDIRECTORY`) solo dentro del contenedor, porque los cambios hechos desde Windows o macOS no siempre se detectan.
  - **`node_modules` del contenedor** en un volumen anónimo, separado del `node_modules` del equipo, para que `docker compose up --build -V` lo regenere tras cambiar dependencias.
- **Alternativas consideradas:** `Dockerfile` solo de desarrollo (la CI necesitaría otro después); la API solo en el equipo (no cumple T-102); imágenes Alpine (musl puede dar problemas con módulos nativos); `node_modules` en un volumen con nombre (no se actualiza al cambiar dependencias).
- **Consecuencias:**
  - T-106 construye la etapa `production`; pesaba unos 400 MB, con el cliente de Prisma pesó unos 510 MB (ADR-0091) y con el CLI de Prisma pesa unos 880 MB (ADR-0093). Se puede reducir más adelante.
  - La API todavía no usa Mailpit: la configuración SMTP llega con T-122. PostgreSQL se usa desde T-110 (`DATABASE_URL`, ADR-0091).
  - `docker compose down -v` borra los datos locales de PostgreSQL.
- **Estado:** Aceptada (aprobación formal 2026-09-26).

---

## ADR-0090 — Base de datos de los tests de integración con Testcontainers

- **Fecha:** 2026-09-27
- **Contexto:** T-105. ADR-0033 exige tests de integración contra PostgreSQL 18 real en Docker, localmente y en la CI, sin mocks de base de datos. Faltaba decidir de dónde sale esa base: un contenedor temporal por ejecución o una base de pruebas dentro del PostgreSQL de Docker Compose (ADR-0089).
- **Decisión:**
  - Los tests de integración levantan un contenedor `postgres:18` temporal con Testcontainers (`@testcontainers/postgresql`) al iniciar la ejecución, y lo destruyen al terminar. La URL de conexión se expone en `DATABASE_URL`.
  - Cada ejecución empieza con una base vacía. Cuando exista el esquema (T-110), las migraciones se aplican al inicio y cada archivo de test limpia sus tablas. Desde T-110 (ADR-0091), el inicio aplica todas las migraciones y cada test deja la base como la encontró (por ejemplo, dentro de una transacción que se revierte).
  - **Tres tipos de test**, con su propio comando:

    | Tipo | Archivos | Comando | Docker |
    |---|---|---|---|
    | Unitarios | `*.spec.ts`, junto al código | `npm test` | No |
    | Integración | `*.int-spec.ts`, junto al código de `infrastructure` (la infraestructura común vive en `test/integration/`) | `npm run test:int` | Sí |
    | End-to-end | `test/*.e2e-spec.ts` | `npm run test:e2e` | Sí, desde T-110 (ADR-0091) |

  - Los tests de integración corren en serie (`--runInBand`), porque comparten una base; así también quedan controladas las pruebas de concurrencia (ADR-0011).
  - Driver `pg` para las conexiones directas de los tests.
- **Alternativas consideradas:** Una base `_test` en el PostgreSQL de Docker Compose (hay que crearla y mantener la URL en cada equipo, los datos persisten entre ejecuciones y la CI necesita otra configuración); servicio de PostgreSQL en GitHub Actions (configuración distinta de la local).
- **Consecuencias:**
  - `npm run test:int` necesita Docker en marcha; si no lo está, falla con un mensaje que lo indica. `npm test` no necesita Docker. Desde T-110, `npm run test:e2e` también necesita Docker: la aplicación completa requiere una base (ADR-0091).
  - Cambia el criterio de T-106: los runners de GitHub Actions ya traen Docker, así que la CI no declara un servicio de PostgreSQL.
  - Levantar el contenedor suma unos segundos a cada ejecución de integración.
- **Revisar si:** los tests de integración se vuelven lentos (base por worker o por archivo) o la CI no puede ejecutar Docker.
- **Estado:** Aceptada (aprobación formal 2026-09-27). Modificada por ADR-0091 (los tests end-to-end también usan Testcontainers).

---

## ADR-0091 — Prisma: configuración, esquema por contexto y primera migración

- **Fecha:** 2026-09-27
- **Contexto:** T-110. ADR-0033 eligió Prisma Migrate y ADR-0066 aprobó el modelo de datos (`DATABASE.md`), que incluye objetos que el esquema de Prisma no expresa. `DATABASE.md` (sección 13) dejaba como riesgo que Prisma detectara esos objetos como diferencias e intentara borrarlos. Faltaban la versión de Prisma, la organización de archivos, la conexión de la aplicación y la forma de probar las migraciones.
- **Decisión:**
  - **Versión:** Prisma 7.10 (`prisma`, `@prisma/client` y `@prisma/adapter-pg`), limitado a la versión mayor 7 (`^7.10.0`). La versión 8 todavía es candidata y se evaluará cuando sea estable. La aplicación se conecta con el driver adapter `@prisma/adapter-pg`, sobre el driver `pg`, como requiere Prisma 7.
  - **Archivos:**
    - `prisma.config.ts`: ubicación del esquema y de las migraciones, y URL de la base (`DATABASE_URL`). Prisma 7 no lee `.env`; este archivo lo carga para usar el CLI en local, sin sobrescribir las variables que ya tenga el proceso (CI, tests).
    - `prisma/schema/`: `schema.prisma` (generador, datasource y el enum compartido `catalog_status`), un archivo por contexto (`identity-access`, `catalog`, `pricing`, `inventory`, `shopping`, `ordering`, `payments`, `shipping`) y `transversal.prisma` (auditoría, idempotencia y catálogo geográfico).
    - `prisma/migrations/`: migraciones versionadas.
    - Cliente generado (generador `prisma-client`, ESM) en `src/platform/persistence/prisma/generated/`. No se versiona; se genera al instalar dependencias (`postinstall`) o con `npm run db:generate`.
    - `PrismaService` y `PersistenceModule` (global) en `src/platform/persistence/`. Solo los usa la infraestructura (ADR-0003); la verificación automática llega con T-103.
  - **Índices parciales en el esquema**, con la función en vista previa `partialIndexes`, para que Prisma los conozca. El índice GIN de búsqueda (`products.search_vector`) también está en el esquema.
  - **SQL manual en la migración**, solo para lo que el esquema no expresa: extensiones `unaccent` y `btree_gist` (al inicio), 57 restricciones `CHECK`, la restricción de exclusión de `price_periods`, los índices únicos de expresión sobre `lower(name)` de marcas y categorías, y el trigger que impide modificar `audit_logs` (al final).
  - **Riesgo de `DATABASE.md` validado:** `prisma migrate diff` entre la base migrada y el esquema responde "No difference detected". Prisma no detecta los objetos manuales como diferencias ni intenta borrarlos. Lo comprueban un test de integración y el script `npm run db:diff`.
  - **Primera migración `20260927000000_init`:** el modelo aprobado completo (38 tablas y 18 enums), con los cambios de ADR-0076, ADR-0078, ADR-0079, ADR-0081 y ADR-0083.
  - **Detalles derivados del modelo:**
    - `orders.order_number` es `BIGSERIAL` (`@default(autoincrement())`): Prisma crea y conoce la secuencia. La secuencia manual `order_number_seq` aparecía como diferencia en cada verificación. El comportamiento es el mismo: consecutivo, sin reutilizar números (ADR-0049).
    - El índice único de almacén activo es `(status) WHERE status = 'ACTIVE'` en lugar de `((true)) WHERE …`: el efecto es el mismo (a lo sumo un almacén activo, ADR-0081) y se puede expresar en el esquema.
    - `carts.merged_into_cart_id` con `ON DELETE CASCADE`: al borrar un carrito se borran los carritos fusionados en él, que ya no tienen uso. Con `SET NULL` se violaría el `CHECK` del estado `MERGED`, y con `RESTRICT` la limpieza de carritos quedaría bloqueada.
  - **Configuración:** `DATABASE_URL` es obligatoria; la API no arranca sin ella ni con una URL que no sea de PostgreSQL, y el error no muestra el valor (ADR-0087). En Docker Compose, el contenedor de la API recibe su propia URL con host `postgres`.
  - **Arranque:** `PrismaService` ejecuta `SELECT 1` al iniciar, con 5 segundos de espera de conexión, así que la API no arranca si la base no responde. Con el driver adapter, `$connect()` no abre ninguna conexión.
  - **Scripts:** `db:generate`, `db:migrate:dev` (crear migraciones en desarrollo), `db:migrate:deploy` (aplicar las pendientes) y `db:diff` (verificar que base y esquema coinciden).
  - **Tests:** el inicio de los tests de integración y end-to-end aplica todas las migraciones con `prisma migrate deploy` al contenedor de Testcontainers. Los end-to-end también usan Testcontainers, porque la aplicación completa necesita una base (modifica ADR-0090).
  - **Imagen de producción sin el CLI de Prisma:** `prisma` es dependencia opcional de `@prisma/client`, así que `npm prune` omite también las dependencias opcionales. Ninguna dependencia de ejecución es opcional; la única, `pg-cloudflare`, es para Cloudflare Workers. La imagen pasa de unos 400 MB a unos 510 MB por el cliente de Prisma y el driver; con el CLI pesaría unos 880 MB. **Reemplazado por ADR-0093:** desde T-111 la imagen incluye el CLI (unos 880 MB).
  - **Dependencias vulnerables del CLI:** `overrides` de npm para `deepmerge-ts` y `mysql2`, dependencias transitivas del CLI de Prisma con vulnerabilidades altas. Con ellos, `npm audit` queda sin vulnerabilidades. Se quitan cuando Prisma actualice sus dependencias.
  - **Sin datos iniciales (seed) en T-110:** cada tarea crea los suyos: roles en T-130, lista de precios en T-145, almacén en T-160 y método de envío en T-196.
- **Alternativas consideradas:**
  - Prisma 8: todavía no es estable.
  - Un solo archivo `schema.prisma`: con 38 tablas es difícil de revisar, y el modelo está organizado por contexto (ADR-0006).
  - Índices parciales como SQL manual: sin la función `partialIndexes`, Prisma no puede representarlos en el esquema y los compararía como índices distintos.
  - Secuencia manual `order_number_seq`: aparece como diferencia en cada verificación.
  - Conectar solo con `$connect()`: la API arrancaba sin base y fallaba en la primera petición.
  - Tests end-to-end sin base: la aplicación completa no arranca sin PostgreSQL.
  - CLI de Prisma en la imagen de producción: suma unos 370 MB; cómo se aplican las migraciones al desplegar se decide con P-05.
- **Consecuencias:**
  - Los objetos manuales se mantienen a mano: cambiarlos o quitarlos requiere SQL en una migración nueva, porque Prisma no lo genera. El flujo está en `DEVELOPMENT_GUIDE.md`.
  - `partialIndexes` está en vista previa y puede cambiar entre versiones menores; hay que revisarlo al actualizar Prisma.
  - Instalar dependencias necesita el esquema (`postinstall`). Una instalación solo de producción (`--omit=dev`) debe usar `--ignore-scripts`, porque no incluye el CLI.
  - `npm run test:e2e` necesita Docker en marcha.
  - La imagen de producción no puede aplicar migraciones; se resuelve con P-05 (T-330). Desde ADR-0093 incluye el CLI, así que podrá aplicarlas como paso aparte (`DATABASE.md`, sección 13).
  - La base local de Docker Compose se migra con `npm run db:migrate:deploy` cada vez que llegan migraciones nuevas.
  - T-106 puede usar `npm run db:diff` en el paso de verificación de migraciones (ADR-0030).
  - Queda pendiente P-72: los valores iniciales del costo fijo de envío y del monto mínimo para envío gratis, necesarios para el método de envío de T-196. Cerrada por ADR-0092.
- **Estado:** Aceptada (plan de T-110 aprobado el 2026-09-27; los detalles derivados del modelo se revisan en el pull request). Modificada por ADR-0093 (la imagen de producción incluye el CLI de Prisma).

---

## ADR-0092 — Valores iniciales del método de envío

- **Fecha:** 2026-09-27
- **Contexto:** Cierra P-72 (T-196). ADR-0042 define un costo fijo por orden y envío gratis a partir de un monto mínimo, ambos configurables por el administrador (ADR-0075), pero no sus valores. El único método de envío se crea con los datos iniciales (seed) de T-196 y necesita valores desde el primer arranque. Todavía no hay costos reales de paquetería (los envíos son manuales, ADR-0041) ni ticket promedio.
- **Decisión:**
  - Valores iniciales **provisionales** del método de envío:
    - Nombre: "Envío Estándar". Solo lo ve el staff.
    - Costo fijo: $99.00 (9900 centavos), con IVA incluido; el IVA contenido es $13.66 (ADR-0079).
    - Umbral de envío gratis: $1,500.00 (150000 centavos), comparado con el subtotal con IVA menos el descuento (ADR-0079).
    - Plazo de entrega estimado: 3 a 7 días hábiles (ADR-0083).
    - Activo.
  - Son los valores que ya usan los ejemplos de `API_SPEC.md` y de ADR-0079.
  - Antes de operar con clientes reales, el administrador confirma o ajusta los valores con costos reales de paquetería y el ticket promedio. Se sigue junto con la validación fiscal del envío, en P-69.
  - El seed crea el método solo si no existe: nunca sobrescribe los valores que configure el administrador con `PUT /v1/admin/shipping/method` (`shipping.configure`).
- **Alternativas consideradas:** Sin envío gratis al inicio (nunca regala el envío por accidente, pero en desarrollo no se prueba el envío gratis sin configurarlo antes); valores definitivos desde ahora (no hay costos reales de paquetería ni ticket promedio); valores en variables de entorno (repite una configuración que ya existe en la API).
- **Consecuencias:**
  - T-196 deja de depender de P-72.
  - Mientras nadie los cambie, la tienda cobra $99.00 por envío y lo da gratis desde $1,500.00. El umbral se muestra al cliente en la cotización (`freeShippingThreshold`); un cambio posterior solo afecta a cotizaciones y órdenes nuevas (ADR-0042).
  - Los tests no dependen de estos valores: cada test crea sus propios datos.
- **Revisar si:** se contrata una paquetería con tarifas conocidas, se conoce el ticket promedio o se habilitan promociones (ADR-0018).
- **Estado:** Aceptada (aprobación formal 2026-09-27).

---

## ADR-0093 — Contexto transaccional con `nestjs-cls`

- **Fecha:** 2026-09-27
- **Contexto:** T-111. ADR-0033 eligió `nestjs-cls` con su plugin transaccional para Prisma, para que los repositorios obtengan la transacción activa sin que Application ni Domain dependan de Prisma. Faltaban el adaptador de Prisma, cómo delimita Application una transacción, el anidamiento y los límites de tiempo.
- **Decisión:**
  - **Librerías:** `nestjs-cls` 7, `@nestjs-cls/transactional` 4 y el adaptador oficial `@nestjs-cls/transactional-adapter-prisma` 2.
  - **Adaptador oficial:** declara el CLI de Prisma (`prisma`) como dependencia obligatoria, así que `prisma` pasa a dependencia de producción y la imagen de producción lo incluye. Pesa unos 880 MB en lugar de 510 MB (modifica ADR-0091). A cambio, la imagen puede ejecutar `prisma migrate deploy` como paso aparte, que es la opción candidata para P-05 (`DATABASE.md`, sección 13).
  - **Puerto `TransactionManager`** en `src/shared-kernel/`: clase abstracta en TypeScript puro con `run(work)`. Confirma la transacción si `work` termina bien, la revierte si falla y propaga el error. Application la usa para delimitar transacciones, sin importar Prisma ni `nestjs-cls`; su implementación, `ClsTransactionManager`, está en `src/platform/persistence/`. Se agrega al shared kernel de ADR-0088.
  - **Repositories:** inyectan `TransactionHost<PrismaTransactionAdapter>` y usan su propiedad `tx`, que es el cliente de la transacción activa o, fuera de una transacción, el `PrismaService` normal. No reciben la transacción como parámetro.
  - **Anidamiento:** un `run` dentro de otro se une a la transacción externa (propagación `Required`). Sin savepoints: se agregan si algún caso los necesita.
  - **Opciones de cada transacción:** aislamiento Read Committed, declarado explícitamente (ARCHITECTURE.md); espera máxima de 2 s para iniciar y límite de 5 s, los valores por defecto de Prisma. Una transacción que pasa el límite se revierte y `run` falla.
  - **Registro:** `ClsModule.forRoot` una sola vez en el módulo raíz, sin middleware HTTP: `run` crea su propio contexto. `PersistenceModule` registra el plugin. T-118 agregará el identificador de correlación al mismo contexto.
- **Alternativas consideradas:**
  - Adaptador propio de unas 30 líneas: mantenía la imagen en 510 MB y sin el CLI, pero era código propio que mantener.
  - Decorador `@Transactional()` en los casos de uso: exige el plugin inicializado incluso en los tests unitarios.
  - Pasar la transacción como parámetro a los repositories: expone Prisma a Application.
  - Savepoints para transacciones anidadas: ningún caso los necesita todavía.
- **Consecuencias:**
  - Los tests unitarios de casos de uso reemplazan `TransactionManager` por un doble que solo ejecuta el trabajo.
  - Todo repository debe usar `txHost.tx`; si usara `PrismaService` directamente, quedaría fuera de la transacción. La revisión de código lo vigila y T-103 puede agregar una regla.
  - Una transacción no puede incluir llamadas externas ni trabajo de más de 5 s.
  - T-116 (despacho de eventos después del commit) amplía este mecanismo. Hecho en ADR-0098: la transacción más externa ejecuta acciones después de confirmar.
  - La imagen de producción pesa unos 880 MB e incluye el CLI de Prisma y sus dependencias; `npm audit` sigue sin vulnerabilidades gracias a los `overrides` de ADR-0091.
- **Revisar si:** el adaptador deja de exigir el CLI (la imagen podría volver a 510 MB), un caso necesita savepoints o el límite de 5 s resulta corto.
- **Estado:** Aceptada (aprobación formal 2026-09-27).

---

## ADR-0094 — Shared kernel: dinero, IVA contenido, identificadores, errores, eventos y reloj

- **Fecha:** 2026-09-27
- **Contexto:** T-112. ADR-0003 definió un shared kernel mínimo (`Money`, tipos de ID con marca de tipo, error de dominio base y forma común de domain event) y ADR-0088 le sumó el puerto `Clock`. Faltaba su diseño concreto, y el modo de redondeo del IVA (ADR-0008 y ADR-0079 dicen que se redondea por línea, pero no cómo).
- **Decisión:**
  - **`Money`**, value object inmutable:
    - Centavos enteros de 0 a 2,147,483,647, el máximo de una columna `integer` (ADR-0066). Sin negativos, porque ningún monto del modelo lo es; un monto fuera de rango falla en el dominio con `InvalidValueError` en lugar de fallar al guardar.
    - Moneda como tipo con un solo valor, `'MXN'` (ADR-0026). Combinar monedas distintas es un error de programación.
    - Operaciones `add`, `subtract` (falla si el resultado queda negativo), `multiply(cantidad)` y comparaciones. `toJSON()` produce `{ amount, currency }` (`API_SPEC.md`, sección 8.1).
  - **IVA contenido:** `containedTax(tasaEnPuntosBase)` calcula `monto × tasa / (10000 + tasa)` con aritmética entera exacta y redondea al centavo **con las mitades hacia arriba**. Lo usan Ordering (líneas) y Shipping (envío), una vez por línea (ADR-0008, ADR-0079). Con la tasa del 16% nunca resulta una mitad exacta, así que el modo solo importa con otras tasas. La validación con el contador se suma a P-69.
  - **Identificadores:** `Id<'Entidad'>`, un texto con marca de tipo para que el compilador no confunda identificadores de entidades distintas; cada contexto declara los suyos.
    - `newId()` crea UUIDv7 con el paquete `uuid`, que garantiza orden creciente incluso dentro del mismo milisegundo. `crypto.randomUUIDv7()` de Node no lo garantiza, y el orden importa en `stock_movements` y `audit_logs`.
    - `newCredentialId()` crea UUIDv4 para identificadores que funcionan como credencial (ADR-0059).
    - `toId()` valida y normaliza a minúsculas un UUID recibido de fuera.
  - **`DomainError`**, clase base abstracta:
    - `code` es el `type` estable del catálogo de `API_SPEC.md` (sección 6.2).
    - `category` es `invalid`, `forbidden`, `not-found` o `conflict`; T-113 la traduce a 400, 403, 404 o 409 y el dominio no conoce HTTP (ADR-0035). Todos los errores de negocio del catálogo caen en esas cuatro; los 401, 413, 415, 422 y 429 vienen de autenticación, archivos, idempotencia y rate limiting.
    - `details` opcionales, que se convierten en extensiones de Problem Details (ADR-0064) y nunca llevan datos sensibles ni personales.
    - `InvalidValueError` (`validation-error`, categoría `invalid`) para valores que rompen las reglas de un value object.
  - **`DomainEvent`**: interfaz con `eventId` (UUIDv7, para que los handlers ignoren repeticiones, ADR-0014), `eventType` (el nombre de `DOMAIN_MODEL.md`) y `occurredAt`. Cada evento la extiende con sus datos; `eventMetadata()` crea los campos comunes. El despacho es de T-116.
  - **`Clock`**: clase abstracta con `now()`, en el shared kernel porque es un solo puerto para todos los contextos, igual que `TransactionManager` (ADR-0093). Aclara ADR-0003, que ubicaba el puerto del reloj en Application. Su implementación, `SystemClock`, está en `src/platform/clock/` y se registra de forma global.
  - Todo se importa desde `src/shared-kernel/index.ts`.
- **Alternativas consideradas:**
  - Montos negativos en `Money`: ningún campo del modelo los admite.
  - Calcular el IVA en cada contexto: duplica una regla fiscal.
  - Redondeo bancario (mitad al par): reduce el sesgo acumulado, pero es menos intuitivo.
  - `crypto.randomUUIDv7()` de Node: sin dependencias, pero sin orden garantizado dentro del mismo milisegundo.
  - Un mapa de código a estado HTTP en T-113 sin categorías: cada error nuevo obligaría a tocar la presentación.
  - Un puerto de reloj por contexto: duplicación sin beneficio.
- **Consecuencias:**
  - Nueva dependencia de producción: `uuid`.
  - Los contextos declaran sus tipos de ID y sus errores de dominio como subclases de `DomainError`.
  - Ningún código llama a `new Date()` para la hora actual; los tests unitarios usan un reloj fijo.
  - BR-TAX-02 queda con el modo de redondeo; P-69 suma su validación.
- **Revisar si:** se opera con otra moneda, un monto necesita superar el máximo de `integer`, el contador indica otro redondeo o se ejecuta más de una instancia (el orden de UUIDv7 solo se garantiza dentro de cada proceso).
- **Estado:** Aceptada (aprobación formal 2026-09-27).

---

## ADR-0095 — Respuestas de error, validación de entrada e identificador de correlación

- **Fecha:** 2026-09-27
- **Contexto:** T-113. ADR-0035 y ADR-0064 fijaron Problem Details, los códigos HTTP y el catálogo de tipos (`API_SPEC.md`, sección 6); ADR-0071 pidió textos de error en español y `X-Correlation-Id` en todas las respuestas; ADR-0094 dio a `DomainError` un código y una categoría. Faltaba cómo se construyen las respuestas, cómo se validan las entradas y de dónde sale el identificador de correlación.
- **Decisión:**
  - **Filtro global** (`src/platform/http/problem-details/`), registrado como provider para que también aplique en los tests, que convierte todo error en Problem Details con `application/problem+json`:
    - `DomainError`: estado según su categoría (400, 403, 404 o 409), `type` `/problems/{code}` y sus `details` como extensiones.
    - `ProblemException(code, extensiones, encabezados)`: para errores que no son de dominio (autenticación, idempotencia, rate limiting, validación); el estado sale del catálogo.
    - Errores HTTP del framework y del lector del cuerpo: ruta inexistente → 404 `not-found`; JSON mal formado → 400 `validation-error`; cuerpo demasiado grande → 413; codificación no admitida → 415.
    - Cualquier otro error, o un estado HTTP fuera del catálogo: 500 `internal-error`, solo con el identificador de correlación. El error se registra en el log con su stack trace y el identificador.
    - Las extensiones no pueden reemplazar `type`, `title`, `status`, `detail`, `instance` ni `correlationId`. `instance` es la ruta sin la cadena de consulta.
  - **Catálogo** de los 36 tipos de `API_SPEC.md` (sección 6.2), cada uno con estado, `title` y `detail` fijos en español. Un test compara el catálogo con `API_SPEC.md`.
  - **Mensajes internos fuera de las respuestas:** el mensaje de un error de dominio (en inglés, para desarrolladores) va al log; el cliente recibe el `detail` del catálogo. Un código de dominio que falte en el catálogo responde con los textos de su categoría y deja una advertencia en el log.
  - **Sin stack traces en ninguna respuesta, en ningún entorno**, no solo en producción.
  - **Validación de entrada:** `ValidationPipe` global con `whitelist`, `forbidNonWhitelisted`, `transform` y solo la primera regla que falla por campo. Un campo o parámetro no declarado responde 400 (`API_SPEC.md`, sección 5.3).
    - `errors` es una lista de `{ field, code, message }`: `field` en notación de ruta (`lines[2].quantity`), `code` con el nombre de la regla de class-validator (`isInt`, `matches`, `whitelistValidation`) y `message` en español.
    - Los mensajes salen de una tabla por regla; un DTO puede dar un texto propio con `context: { message }`; si no hay ninguno, "El valor no es válido.". Los mensajes en inglés de class-validator y los valores rechazados nunca llegan a la respuesta.
  - **Identificador de correlación:** lo genera siempre el servidor por solicitud (UUIDv7) en un middleware de `nestjs-cls` montado antes del lector del cuerpo; se guarda en el contexto y se devuelve en `X-Correlation-Id` de todas las respuestas. Uno enviado por el cliente se ignora. T-118 lo agrega a los logs.
  - **Tipo de contenido:** un cuerpo que no es `application/json` ni `multipart/form-data` responde 415 `unsupported-media-type`, como pide `API_SPEC.md` (sección 2). Las solicitudes sin cuerpo pasan con cualquier `Content-Type`.
- **Alternativas consideradas:**
  - Exponer el mensaje del error de dominio en `detail`: mezcla idiomas y podría revelar datos internos.
  - Códigos de validación propios en lugar de los de class-validator: requieren una tabla de traducción sin beneficio para el cliente.
  - Traducir los mensajes decorador por decorador: repetitivo y fácil de olvidar.
  - Aceptar el identificador de correlación del cliente: permite falsificarlo e inyectar texto en los logs.
  - Stack traces en desarrollo: una configuración más que puede llegar a producción por error.
  - Registrar el filtro en `main.ts`: los tests que construyen `AppModule` no lo tendrían.
- **Consecuencias:**
  - Los controladores no construyen respuestas de error; lanzan `DomainError` o `ProblemException`.
  - Un tipo de error nuevo se agrega a la vez al catálogo y a `API_SPEC.md`.
  - El identificador de correlación y el rechazo por tipo de contenido se montan en `configureHttp`; una aplicación de test que no lo llame no los tiene, y el filtro genera un identificador para la respuesta de error.
  - `API_SPEC.md` actualiza el ejemplo de `errors[].code`, `instance` sin la cadena de consulta y el origen de `X-Correlation-Id`.
- **Estado:** Aceptada (aprobación formal 2026-09-27).

---

## ADR-0096 — Versionado por ruta y documentación OpenAPI en local

- **Fecha:** 2026-09-27
- **Contexto:** T-114. ADR-0034 fijó el prefijo `/v1` en todas las rutas y la especificación OpenAPI de `v1`; ADR-0031 limita Swagger al entorno local; ADR-0086 pidió una CSP más permisiva solo en la ruta de Swagger UI; ADR-0087 anticipó el plugin de Swagger para los DTOs, y `API_SPEC.md` pide documentar los `type` de error de cada endpoint.
- **Decisión:**
  - **Versionado por ruta de NestJS** con versión por defecto `1`, activado en `configureHttp`: todos los controladores quedan bajo `/v1` sin declararlo, y una versión futura convive declarando `@Version('2')` en el controlador o la ruta.
  - **Swagger solo con `NODE_ENV=development`**, sin variable propia, para que en producción no pueda activarse por error:
    - Swagger UI en `/docs/v1` y el documento OpenAPI en `/docs/v1/openapi.json`, fuera del prefijo de la API. Una futura `v2` tendría `/docs/v2`.
    - El documento declara el título, la versión `1` y la autenticación `bearer`.
  - **CSP propia de Swagger UI**, solo bajo `/docs/v1` (ADR-0086): scripts, estilos, imágenes, fuentes y conexiones del mismo origen, estilos en línea (Swagger UI los aplica), imágenes y fuentes `data:`, y `frame-ancestors 'none'`. El resto de la API conserva `default-src 'none'`. Verificado en el navegador: Swagger UI carga sin errores de CSP.
  - **Plugin de Swagger** (`@nestjs/swagger`, con `classValidatorShim` e `introspectComments`) en `nest build` y en los tests end-to-end (`test/swagger-plugin.cjs`): documenta los DTOs de los archivos `*.dto.ts` a partir de sus tipos, sus reglas de class-validator y sus comentarios. Genera `import` en lugar de `require`, compatible con ESM.
  - **Comentarios de las propiedades de los DTOs en español:** se publican como descripciones en OpenAPI, como `API_SPEC.md`. El resto de los comentarios del código sigue en inglés.
  - **Errores en OpenAPI:** esquema común `ProblemDetails` (con `FieldError`) cuyo `type` admite solo los tipos del catálogo de ADR-0095, y decorador `@ApiProblemResponses(...códigos)` que agrupa por estado HTTP los errores del endpoint más los comunes (`validation-error`, `rate-limit-exceeded`, `internal-error`).
- **Alternativas consideradas:**
  - Prefijo global `/v1`: obligaría a reorganizar rutas al llegar `v2`.
  - Variable propia para activar Swagger: más flexible, pero puede quedar encendida en producción.
  - `@ApiProperty` en cada campo: explícito, pero repetitivo y fácil de desalinear de las reglas de validación.
  - Documentar los errores endpoint por endpoint sin esquema común.
- **Consecuencias:**
  - `@nestjs/swagger` y `swagger-ui-dist` son dependencias de producción, aunque Swagger UI no se sirve ahí: el plugin agrega metadatos a los DTOs que se leen al cargar.
  - Las opciones del plugin se repiten en `nest-cli.json` y en `test/swagger-plugin.cjs`; cambian juntas.
  - Una aplicación de test que no llama a `configureHttp` no tiene el prefijo `/v1`.
  - Cuando existan endpoints, el documento generado debe coincidir con `API_SPEC.md` (sección OpenAPI).
- **Estado:** Aceptada (aprobación formal 2026-09-27). ADR-0109 agrega una convención: la respuesta de éxito y los campos que contienen otros DTO se declaran de forma explícita.

---

## ADR-0097 — Logs de la aplicación

- **Fecha:** 2026-09-27
- **Contexto:** T-118. ADR-0032 fijó logs en consola con nivel configurable por variable de entorno; ADR-0033 y ADR-0095, el identificador de correlación de cada solicitud; `SECURITY.md` prohíbe registrar secretos y datos personales. Las herramientas de métricas, trazas y seguimiento de errores siguen pendientes (P-07).
- **Decisión:**
  - **`AppLogger`**, una extensión del `ConsoleLogger` de NestJS, sin dependencias nuevas. `main.ts` la instala con `bufferLogs`, así que también los logs del arranque salen con su formato, y todo `new Logger(Contexto)` la usa.
  - **Nivel:** variable opcional `LOG_LEVEL` (`fatal`, `error`, `warn`, `log`, `debug` o `verbose`; por defecto `log`), validada al arrancar y declarada en `.env.example`. Activa su nivel y todos los más graves.
  - **Formato según `NODE_ENV`**, sin variable nueva: texto con colores en desarrollo y tests; una línea JSON por evento en producción, lista para la herramienta que se elija en P-07.
  - **Identificador de correlación** en cada log escrito durante una solicitud, tomado del contexto de `nestjs-cls`: en texto como `[id]` después del contexto; en JSON, como el campo `correlationId`. Los logs fuera de una solicitud (arranque, jobs) no lo llevan.
  - **Línea por solicitud** de nivel `log` al terminar la respuesta: método, ruta sin la cadena de consulta, estado y duración en milisegundos. Nunca cuerpos, encabezados ni cadenas de consulta.
  - **Red de seguridad contra datos sensibles:** el logger reemplaza por `[redacted]` los correos, los JWT y los tokens `Bearer` que aparezcan en mensajes y stack traces. En formato texto escapa los saltos de línea, para que un mensaje no pueda simular otras entradas del log.
- **Alternativas consideradas:**
  - `nestjs-pino`: más rápido y con redacción y log de solicitudes integrados, pero agrega tres dependencias sin necesidad de ese rendimiento.
  - Una variable propia para el formato: `NODE_ENV` ya distingue producción.
  - Registrar cuerpos o encabezados con campos ocultos: cualquier campo nuevo con datos personales quedaría expuesto hasta que alguien lo agregue a la lista.
- **Consecuencias:**
  - El código registra con `new Logger(Clase.name)` y nunca con `console.log`; la guía de desarrollo indica qué nivel usar y qué nunca registrar.
  - La redacción solo reconoce correos, JWT y tokens `Bearer`: no sustituye la regla de no registrar datos personales.
  - Una aplicación de test que no instala `AppLogger` escribe con el logger de NestJS, sin identificador ni redacción.
  - T-116 y T-117 registran sus fallos con este logger.
- **Revisar si:** se elige una herramienta de observabilidad (P-07) o el volumen de logs afecta el rendimiento.
- **Estado:** Aceptada (aprobación formal 2026-09-27). Modificada por ADR-0101: cada ejecución de un job tiene su propio identificador, que sus logs llevan igual que los de una solicitud.

---

## ADR-0098 — Bus de eventos en proceso con despacho en segundo plano

- **Fecha:** 2026-09-27
- **Contexto:** T-116. ADR-0014 decidió despachar los eventos en proceso después del commit, sin outbox, con handlers idempotentes, fallos en el log y conciliación como red de seguridad; ADR-0093 dejó a T-116 ampliar el contexto transaccional, y ADR-0094 fijó la forma de los eventos. Faltaban el mecanismo, cuándo corren los handlers respecto de la respuesta y dónde viven.
- **Decisión:**
  - **Bus propio** en `src/platform/events/`, sin `@nestjs/event-emitter`: el despacho después del commit, el aislamiento de cada handler y el registro de cuál falló habría que construirlos encima de todas formas.
  - **Publicación:** puerto `DomainEventPublisher` en el shared kernel, con `publish(...eventos)`. Dentro de `TransactionManager.run`, los eventos se acumulan en una cola por transacción y se despachan cuando confirma la más externa; con rollback se descartan. Fuera de una transacción se despachan de inmediato. Para lograrlo, `ClsTransactionManager` abre un `TransactionScope` en la transacción más externa, con acciones que corren después del commit; Application no lo ve.
  - **Despacho en segundo plano:** `run` y `publish` no esperan a los handlers. Se acepta que otros contextos se actualicen con una demora breve, sin tiempo garantizado. `API_SPEC.md` (sección 2.5) lista esos efectos para que el cliente advierta la demora, y cada endpoint afectado lo indica.
  - **Orden y aislamiento:** los eventos de una transacción se despachan en el orden de publicación, y los handlers de cada evento corren uno tras otro, en el orden en que se registraron. El error de un handler no llega a quien publicó ni detiene a los demás: se registra en el log con el tipo de evento, el `eventId`, el handler, el stack y el identificador de correlación, que se conserva porque el despacho ocurre en el contexto asíncrono de la solicitud.
  - **Sin reintentos automáticos** (ADR-0014): la conciliación de pagos es la red de seguridad de `PaymentCaptured`; los demás fallos requieren revisión. Los handlers son idempotentes por el estado de su dominio.
  - **Handlers:** adaptadores de entrada en la capa `infrastructure` del contexto que consume, como los controladores. Son métodos de un provider marcados con `@OnDomainEvent('Evento')`, en archivos `*.event-handler.ts`, que el despachador descubre al arrancar. Cada uno llama a un caso de uso de su contexto con su propia transacción; los eventos que ese caso de uso publique se despachan igual, así que las cadenas funcionan. Los tipos de los eventos los exporta el contexto productor desde su `index.ts` (ADR-0005).
  - **Cierre ordenado:** `main.ts` activa `enableShutdownHooks`; al cerrar, el despachador espera a los handlers en curso (`beforeApplicationShutdown`) y Prisma se desconecta al final (`onApplicationShutdown`).
- **Alternativas consideradas:**
  - `@nestjs/event-emitter`: si un handler falla, su despacho asíncrono rechaza la promesa completa sin decir cuál.
  - Esperar a los handlers antes de responder: el cliente vería el estado final, pero cada respuesta esperaría a todos los handlers, incluidos los correos.
  - Handlers en Application con un decorador del shared kernel: el shared kernel no depende de NestJS.
  - Reintentos automáticos o outbox: descartados en ADR-0014.
- **Consecuencias:**
  - Consistencia eventual entre contextos: el cliente debe volver a consultar el recurso en lugar de suponer su estado. Requisito no funcional agregado en `REQUIREMENTS.md`.
  - Riesgo aceptado, ampliado respecto de ADR-0014: si la aplicación se cae antes de que un handler termine, o si un handler falla, el efecto no ocurre. Solo `PaymentCaptured` tiene conciliación automática; por ejemplo, un envío que no se creó tras `OrderPaid` hay que detectarlo en los logs.
  - Todo efecto nuevo en segundo plano se agrega a `API_SPEC.md` (sección 2.5).
  - Los tests de integración esperan a los handlers con `DomainEventDispatcher.whenIdle()`.
  - Corregido `DOMAIN_MODEL.md`: Shopping no reacciona a `OrderPlaced`; el checkout marca el carrito dentro de su transacción (ADR-0019).
- **Revisar si:** los logs muestran fallos frecuentes de handlers, un efecto en segundo plano necesita garantía de entrega, o se ejecuta más de una instancia.
- **Estado:** Aceptada (aprobación formal 2026-09-27).

---

## ADR-0099 — Mecanismo de idempotencia HTTP

- **Fecha:** 2026-09-27
- **Contexto:** T-115. ADR-0063 fijó el comportamiento de `Idempotency-Key` en colocar orden e iniciar pago: llave ligada a quien la envía y al endpoint, 400, 422 y 409, respuestas guardadas 24 horas, sin guardar 5xx, 401 ni 429. La tabla `idempotency_keys` existe desde T-110 (`DATABASE.md`, sección 11.2). Faltaban el mecanismo, qué significa "mismo contenido" y qué pasa con una solicitud que quedó a medias.
- **Decisión:**
  - **Uso:** decorador `@Idempotent(alcance)` en el controlador, con un interceptor en `src/platform/http/idempotency/`. `cartScope` toma el `cartId` del cuerpo (rutas de invitado); `userScope`, el usuario autenticado, que T-120 dejará en `request.user.id`. Si el alcance no se puede resolver, la solicitud es inválida y la rechazan la validación o la autenticación.
  - **Identidad de la solicitud:** el endpoint es la ruta declarada (por ejemplo, `POST /v1/orders/:publicCode/payments`), no la URL concreta. La huella es un SHA-256 de los parámetros de la ruta y el cuerpo, con las claves ordenadas: el orden de los campos no importa, y reutilizar la llave para pagar otra orden responde 422 en lugar de devolver la respuesta de la primera.
  - **Registro atómico:** la llave se reclama con `INSERT … ON CONFLICT` sobre la llave primaria, fuera de la transacción del caso de uso, que corre después. De dos solicitudes simultáneas, solo una se ejecuta; la otra recibe 409 `idempotency-request-in-progress` con `Retry-After: 2`.
  - **Qué se guarda:** los éxitos (estado, cuerpo y `Location`) y los errores de negocio (`DomainError` del catálogo), que se repiten con un identificador de correlación nuevo. Los errores de validación, porque la operación no llegó a ejecutarse, y los errores inesperados liberan la llave: el cliente puede reintentar con la misma. Los 401 y 429 los rechazan los guards antes del interceptor.
  - **Sin cambios en la base:** `response_body` guarda un sobre con el tipo de respuesta (`success` o `problem`), que incluye `Location`.
  - **Llaves vencidas y abandonadas:** una llave con más de 24 horas se reutiliza como nueva; la borra el job diario de limpieza (T-231). Una llave que sigue "en proceso" después de **60 segundos** se considera abandonada (por ejemplo, porque el servidor se reinició) y la toma la siguiente solicitud con la misma huella; con otra huella sigue respondiendo 422.
  - **Validación de la llave:** ausente o vacía, 400 `idempotency-key-missing`; más de 255 caracteres, 400 `validation-error` con el campo `Idempotency-Key`.
- **Alternativas consideradas:**
  - Endpoint como URL concreta: los mismos datos con otro formato de la ruta contarían como otro endpoint.
  - Huella solo del cuerpo: la misma llave para pagar dos órdenes devolvería la respuesta de la primera.
  - Guardar también los errores de validación: el cliente no podría corregir y reintentar con la misma llave.
  - Nunca retomar una llave abandonada: el cliente recibiría 409 durante 24 horas.
  - Registrar la respuesta en la transacción del caso de uso: iniciar un pago llama al proveedor fuera de la transacción (ADR-0019).
  - Una columna nueva para `Location`: el sobre en `response_body` evita la migración.
- **Consecuencias:**
  - Las reglas del dominio deben impedir duplicados por sí mismas (carrito ya marcado, un pago por orden), porque una llave abandonada puede volver a ejecutarse.
  - T-120 debe dejar el usuario autenticado en `request.user.id` para `userScope`.
  - La limpieza de llaves vencidas queda en el job diario (T-231).
- **Estado:** Aceptada (aprobación formal 2026-09-27).

---

## ADR-0100 — Mecanismo de registro de auditoría

- **Fecha:** 2026-09-27
- **Contexto:** T-127. ADR-0037 fijó qué se audita (toda modificación del staff y los eventos de seguridad), qué guarda cada registro y que se escribe en la misma transacción que el cambio, salvo los intentos denegados y los inicios de sesión fallidos. ADR-0067 prohíbe guardar datos personales. La tabla `audit_logs` y su trigger existen desde T-110. Faltaba el mecanismo reutilizable; la consulta y el archivo son de T-220.
- **Decisión:**
  - **Puerto `AuditTrail` en el shared kernel**, implementado en el módulo transversal `src/modules/audit/` (ADR-0088). Es la única integración con un puerto compartido en lugar de un puerto por contexto (ADR-0005): los ocho contextos lo necesitan con la misma forma.
  - **Transacción:** `record()` se une a la transacción activa y se revierte con el cambio. `recordIndependently()` confirma por su cuenta, para los intentos denegados y los inicios de sesión fallidos que ocurren dentro de una transacción que se revierte.
  - **Contexto de la solicitud:** quien registra indica la acción, el recurso, el resultado y los cambios. El resto sale de la solicitud guardada en el contexto de `nestjs-cls`: identificador de correlación, IP (solo si es una dirección válida), agente de usuario (hasta 512 caracteres) y usuario autenticado (el contrato de T-120, `request.user.id`).
  - **Actor:** el indicado por quien registra (por ejemplo, ANONYMOUS en un login fallido); si no, el usuario autenticado; ANONYMOUS en una solicitud sin usuario; SYSTEM fuera de una solicitud, como en un job.
  - **Cambios sin datos personales ni sensibles:**
    - `changesBetween(antes, después, { personal })` guarda solo los campos modificados, como `{ "status": { "from": "PAID", "to": "CANCELLED" } }`, con los valores como los enviaría JSON.
    - Los campos declarados en `personal` quedan como `{ "changed": true }`.
    - Red de seguridad: una lista fija de nombres (contraseña, hash, token, secreto, correo, teléfono, nombres, apellidos, dirección) se oculta aunque no se declare, también dentro de valores anidados.
  - **Código de acción** con el formato `<área>.<acción>` en minúsculas (por ejemplo, `orders.cancel`); otro formato es un error de programación.
  - **Accesos denegados automáticos:** el filtro de errores (ADR-0095) registra todo 403 en `/v1/admin` como `http.access-denied`, resultado DENIED, con la ruta declarada como recurso. Si esa escritura falla, se registra en el log y la respuesta no cambia. Los 401 no se auditan: no hay un actor conocido y los cubren el rate limiting y los logs.
- **Alternativas consideradas:**
  - Un puerto de auditoría por contexto (ADR-0005): ocho puertos y adaptadores idénticos.
  - Que cada caso de uso pase la IP, el agente y el actor: mete datos de HTTP en Application.
  - Solo la lista fija, sin declaración por caso de uso: no reconoce todos los datos personales, como los nombres de contacto.
  - Auditar también los 401: llenaría la tabla con intentos anónimos.
- **Consecuencias:**
  - Los casos de uso del staff y los eventos de seguridad de T-120 en adelante registran con `AuditTrail`.
  - La IP es la de la conexión directa; detrás de un proxy (P-06) habrá que configurar Express para confiar en él.
  - La lista fija puede ocultar de más (por ejemplo, `addressId`); se acepta a cambio de no filtrar datos personales.
  - La consulta con `audit.read` y el archivo de registros antiguos quedan en T-220.
- **Estado:** Aceptada (aprobación formal 2026-09-27).

---

## ADR-0101 — Base de los jobs programados

- **Fecha:** 2026-09-27
- **Contexto:** T-117. ADR-0029 eligió `@nestjs/schedule` en el proceso de la API y fijó reglas para todos los jobs: son puntos de entrada que llaman a un caso de uso, no se superponen, procesan por lotes con una transacción por elemento, son idempotentes, registran sus fallos y usan la hora de México en los jobs diarios. Faltaba la base común; los jobs concretos llegan con sus tareas.
- **Decisión:**
  - **Decorador `@ScheduledJob(nombre, expresiónCron)`** en `src/platform/jobs/`, que envuelve el `@Cron` de NestJS y garantiza para todo job:
    - **Sin superposición:** si la ejecución anterior sigue en curso, la nueva se omite con un aviso (`warn`) en el log.
    - **Fallos en el log:** un error se registra con el nombre del job y el stack, y nunca detiene el scheduler.
    - **Contexto propio:** cada ejecución corre en su contexto asíncrono con un identificador nuevo (UUIDv7) que llevan todos sus logs. Las transacciones y los eventos funcionan igual que en una solicitud, y la auditoría registra el actor SYSTEM. Modifica ADR-0097, que dejaba sin identificador los logs de los jobs.
    - **Hora de México:** toda expresión cron se interpreta en America/Mexico_City, sin importar la zona horaria del servidor o del contenedor.
  - **`JOBS_ENABLED`:** variable opcional, `true` por defecto y validada al arrancar. Con `false` no se registra el scheduler. Los tests la ponen en `false` para que ningún job toque sus datos; el test del scheduler la activa. `JobsModule.forRoot()` la lee cada vez que arranca una aplicación.
  - **Cierre ordenado:** al cerrar la aplicación se dejan de aceptar ejecuciones y se espera a las que están en curso antes de desconectar la base (`beforeApplicationShutdown`, igual que ADR-0098).
  - **Lotes y transacción por elemento:** quedan como regla de la guía para el caso de uso de cada job, sin una utilidad genérica por ahora.
- **Alternativas consideradas:**
  - `@Cron` directo con su opción `waitForCompletion`: omite la superposición, pero cada job tendría que atrapar sus errores y crear su contexto.
  - Correr siempre el scheduler: un job de cada minuto podría tocar los datos de los tests end-to-end.
  - Una utilidad genérica de procesamiento por lotes: se agrega si varios jobs repiten el mismo patrón.
- **Consecuencias:**
  - Los jobs concretos (expiración de reservas y órdenes y conciliación de pagos en T-230, limpieza diaria en T-231, archivo de auditoría en T-220) usan `@ScheduledJob`.
  - El registro de ejecuciones en curso es del proceso completo, coherente con una sola instancia (ADR-0029); con varias instancias harán falta bloqueos en PostgreSQL.
  - Un test de un job llama a su método directamente, porque el scheduler está apagado.
- **Estado:** Aceptada (aprobación formal 2026-09-27).

---

## ADR-0102 — Mecanismo de rate limiting

- **Fecha:** 2026-09-27
- **Contexto:** T-126. ADR-0065 eligió `@nestjs/throttler` con contadores en memoria, fijó los límites por endpoint (configurables por variables de entorno), pidió frenar por tiempo sin bloquear cuentas y responder 429 con `Retry-After`; ADR-0071 dejó fuera los webhooks. Los endpoints todavía no existen, así que faltaba el mecanismo y su configuración.
- **Decisión:**
  - **Guard global** sobre `@nestjs/throttler` (`RateLimitGuard`):
    - excluye las rutas `/v{n}/webhooks`;
    - al exceder un límite responde `rate-limit-exceeded` (Problem Details) con `Retry-After` en segundos, sin encabezados `X-RateLimit-*`, que `API_SPEC.md` no contempla y CORS no expone.
  - **Límite general** por IP en todo endpoint sin límite específico. **Límites específicos** con `@RateLimit(...)` en el endpoint, que reemplazan al general. Cada límite es un presupuesto por clave compartido por los endpoints que lo usan: por ejemplo, la consulta y la recompra de invitado comparten el contador por IP.

    | Límite | Clave |
    |---|---|
    | `register`, `password-reset-ip`, `guest-order` | IP |
    | `password-reset-email` | huella SHA-256 del correo del cuerpo |
    | `email-verification` | usuario autenticado o, si no hay, huella del correo |
    | `place-order` | usuario autenticado o, si no hay, el `cartId` |

    Si falta el campo de la clave, se cuenta por IP; la validación rechaza la solicitud de todas formas.
  - **Login: solo intentos fallidos.** `FailedAttemptLimiter`, también en memoria, cuenta fallos por correo y por IP en una ventana deslizante. Autenticación (T-120) llama a `assertAllowed` antes de validar las credenciales y a `recordFailure` cuando no son válidas. Un login correcto no gasta el límite, y nunca se bloquean cuentas. Las claves se guardan como huella y las vencidas se barren para que la memoria no crezca sin límite.
  - **Configuración:** nueve variables opcionales `RATE_LIMIT_*`, una por límite, con el formato `<cantidad>/<duración>` (`s`, `m` o `h`), los valores de ADR-0065 por defecto y validación al arrancar.
  - **Orden de los guards:** la autenticación debe ejecutarse antes del guard de rate limiting, para que los límites por usuario vean quién llama (requisito para T-120).
  - **Jest:** `@nestjs/throttler` se publica como CommonJS y requiere los módulos ESM de NestJS. Jest rechaza ese ciclo al enlazar el grafo de un test, así que un archivo de preparación (`test/setup-esm-interop.ts`) carga `@nestjs/common` y `@nestjs/core` antes de cada test. Node no tiene el problema: la aplicación compilada funciona sin cambios.
- **Alternativas consideradas:**
  - Contar todos los intentos de login con el throttler: frenaría también los logins correctos.
  - Dos variables por límite (cantidad y segundos): 18 variables en lugar de 9.
  - Contar por endpoint: los endpoints que comparten un límite en `API_SPEC.md` tendrían presupuestos separados.
  - Implementar el limitador sin `@nestjs/throttler`: contradice ADR-0065 para los límites por solicitud.
- **Consecuencias:**
  - Los contadores se reinician con la API y no se comparten entre instancias (ADR-0065).
  - Una ruta inexistente responde 404 antes de los guards, así que no gasta el límite general.
  - La IP es la de la conexión directa; detrás de un proxy (P-06) habrá que configurar Express para confiar en él.
  - Los endpoints de T-120, T-130, T-180 y siguientes declaran su límite con `@RateLimit`, y el login usa `FailedAttemptLimiter`.
- **Estado:** Aceptada (aprobación formal 2026-09-27).

---

## ADR-0103 — Verificación automática de límites entre módulos y capas

- **Fecha:** 2026-09-27
- **Contexto:** T-103. ADR-0003 y ADR-0005 piden verificar automáticamente los límites entre módulos (por ejemplo, con `dependency-cruiser` o `eslint-plugin-boundaries`); ADR-0088 fijó qué capa puede depender de cuál, y `ARCHITECTURE.md` agregó que `platform` solo lo usan `infrastructure` y `presentation`, y el shared kernel, todas las capas. El proyecto usa oxlint, no ESLint (ADR-0073).
- **Decisión:**
  - **Herramienta:** `dependency-cruiser`, que funciona sin ESLint, entiende TypeScript ESM con imports `.js` a través del `tsconfig` y detecta dependencias circulares. Reglas en `.dependency-cruiser.cjs`.
  - **Reglas estrictas según la tabla de ADR-0088:**

    | Desde | Solo puede importar | Regla |
    |---|---|---|
    | `domain` | su propio `domain`, el shared kernel y módulos nativos de Node | `domain-depends-only-on-shared-kernel` |
    | `application` | su `domain` y su `application`, el shared kernel y `@nestjs/common` | `application-depends-on-domain-and-shared-kernel` |
    | `infrastructure` | cualquier cosa salvo `presentation` | `infrastructure-not-presentation` |
    | `presentation` | cualquier cosa salvo `domain` e `infrastructure` | `presentation-not-domain-or-infrastructure` |
    | un módulo | otro módulo solo por su `index.ts` | `modules-only-through-public-api` |
    | todo el código | Prisma y su cliente generado solo desde `platform` e `infrastructure` | `prisma-only-in-infrastructure` |
    | `shared-kernel` | nada de `src` fuera de sí mismo, ni NestJS, Prisma o `nestjs-cls` | `shared-kernel-stays-pure` |
    | `platform` | nada de `modules` | `platform-not-modules` |
    | todo el código | sin dependencias circulares | `no-circular` |

  - **Prisma también en `platform`:** `platform` es infraestructura técnica transversal. El almacén de idempotencia (ADR-0099) accede a la base desde `platform/http`, además de `platform/persistence`.
  - **Tests fuera de las reglas:** los tests de integración combinan capas a propósito. También se incluyen los imports de solo tipos, porque acoplan igual.
  - **Ejecución:** `npm run lint` corre oxlint (`lint:code`) y los límites (`lint:boundaries`); la CI (T-106) puede llamarlos como pasos separados, igual que los enumera ADR-0030.
  - **Prueba de las reglas:** `test/boundaries/` contiene un proyecto de ejemplo con una violación por regla junto a imports permitidos. Un test comprueba que se detectan exactamente esas violaciones y que `src` no tiene ninguna.
  - **Excepción de ADR-0060:** que el servicio de consultas del catálogo público lea tablas de Pricing e Inventory no se ve en los imports, porque todos los contextos usan el mismo cliente de Prisma. Queda como convención revisada en el code review.
- **Alternativas consideradas:**
  - `eslint-plugin-boundaries`: obliga a instalar y mantener ESLint junto a oxlint.
  - Reglas menos estrictas (presentation con acceso a domain, domain con paquetes npm): se apartan de la tabla de ADR-0088.
  - Prisma solo en `platform/persistence`: obligaría a mover el almacén de idempotencia a persistencia, mezclando HTTP con la base.
  - Verificar la excepción de ADR-0060 con análisis de los modelos de Prisma: fuera del alcance de una herramienta de imports.
- **Consecuencias:**
  - Una violación hace fallar `npm run lint` y, desde T-106, la CI. La solución es mover el código, no relajar la regla; cambiar una regla requiere un ADR.
  - T-119 agrega a estas reglas la que impide usar el cache desde Domain y Application.
  - La regla de ADR-0093 (usar `txHost.tx` y no `PrismaService` en los repositories) sigue en el code review: los dos se importan desde `platform/persistence`.
- **Estado:** Aceptada (aprobación formal 2026-09-27).

---

## ADR-0104 — Base del cache con espacios de nombres

- **Fecha:** 2026-09-27
- **Contexto:** T-119. ADR-0028 eligió `@nestjs/cache-manager` con almacén en memoria del proceso y TTL de 120 s configurable. El cache solo vive en Infrastructure o Presentation, nunca para decisiones que requieren consistencia, y cachea solo lecturas públicas del catálogo, con invalidación inmediata por `ProductPublished`, `ProductArchived` y `VariantDiscontinued`. Los endpoints del catálogo llegan con T-140.
- **Decisión:**
  - **`@nestjs/cache-manager`** registrado global con el TTL configurado, para cachear respuestas con su interceptor cuando no haya nada que invalidar.
  - **`AppCache`** en `src/platform/cache/`, con espacios de nombres. Cada espacio (`catalog`, `geo`…) tiene su propio almacén en memoria (`cache-manager` con Keyv), así que se vacía por separado. Ofrece `getOrLoad(clave, carga)`, `delete(clave)` y `clear()`, y todo valor vence con el TTL.
  - **`CACHE_TTL_SECONDS`:** variable opcional, 120 por defecto, entero de 1 a 86400, validada al arrancar.
  - **Invalidación del catálogo:** `PublicCatalogCacheInvalidation`, en la infraestructura de Catalog (adaptador de entrada, ADR-0098), vacía **todo** el espacio `catalog` con cualquiera de los tres eventos. Un producto aparece en muchos listados, filtros y páginas, así que borrar claves sueltas sería frágil. Los casos de uso de T-140 publicarán esos eventos.
  - **Regla de límites:** las reglas de ADR-0103 ya impiden usar el cache desde Domain (solo shared kernel) y desde Application (sin `platform` ni paquetes fuera de `@nestjs/common`). El proyecto de ejemplo de `test/boundaries/` suma una violación de cada una, para probarlo.
- **Alternativas consideradas:**
  - Un solo almacén con prefijos de clave: vaciar un espacio exigiría seguir sus claves a mano.
  - Invalidar solo las claves del producto afectado: frágil, porque es fácil olvidar un listado o un filtro.
  - Solo el interceptor de NestJS: cachea por URL y no permite invalidar el catálogo por eventos.
  - Una regla de límites nueva para el cache: repetiría lo que ya impiden las reglas de ADR-0103.
- **Consecuencias:**
  - Tras publicar o archivar un producto, las siguientes consultas del catálogo vuelven a leer de la base hasta llenar el cache otra vez.
  - Con despacho en segundo plano (ADR-0098), la invalidación ocurre un instante después del cambio.
  - El cache se pierde al reiniciar y no se comparte entre instancias (ADR-0028).
  - T-140 cachea el árbol de categorías, el detalle de producto y los listados sin `q` en el espacio `catalog`; T-124 puede cachear el catálogo geográfico en su propio espacio.
- **Estado:** Aceptada (aprobación formal 2026-09-27).

---

## ADR-0105 — Pipeline de CI en GitHub Actions

- **Fecha:** 2026-09-28
- **Contexto:** T-106. ADR-0030 fijó los 10 pasos del pipeline y su orden, y dejó para T-106 la herramienta de detección de secretos. ADR-0084 dejó aquí la posible comprobación de los mensajes de commit, y ADR-0090 pide Testcontainers con el Docker del runner, sin servicio de PostgreSQL. El repositorio es público y ya tiene activos el secret scanning y la protección de push de GitHub.
- **Decisión:**
  - **Workflow** `.github/workflows/ci.yml` ("CI"): corre en cada pull request hacia `main`, en cada push a `main` y a mano (`workflow_dispatch`).
  - **Job `Pipeline`:** un solo job en `ubuntu-24.04` con los 10 pasos en el orden de ADR-0030; se detiene en el primero que falle. Node.js sale de `.nvmrc`, siempre la última 24.x (ADR-0025), con caché de npm.
    1. `npm ci`.
    2. `npm run lint:code` y `npm run format:check`.
    3. `npm run lint:boundaries` (ADR-0103).
    4. `npx tsc --noEmit`: compila el código y los tests.
    5. `npm test`.
    6. `npm run test:int` y `npm run test:e2e`, contra `postgres:18` con Testcontainers. ADR-0030 no nombra las e2e, pero también usan PostgreSQL real.
    7. Sin paso aparte: la preparación de `npm run test:int` aplica todas las migraciones desde cero, y `database-schema.int-spec.ts` comprueba que el esquema de Prisma no difiere de ellas (`prisma migrate diff --exit-code`, T-110). El nombre del paso 6 lo indica.
    8. `npm audit --audit-level=high`: falla con vulnerabilidades altas y críticas; las demás solo se reportan.
    9. Detección de secretos con gitleaks.
    10. `docker build --target production`. La imagen no se publica, porque el despliegue continuo está pospuesto (ADR-0031).
  - **Detección de secretos:** gitleaks 8.30.1 con su imagen oficial de Docker, fijada por digest. Revisa todo el historial sin conexión, así que no envía nada a terceros, y usa `--redact` para que un hallazgo no aparezca en el log público.
    - Los falsos positivos revisados van en `.gitleaksignore`, cada uno con su huella y un comentario. Al crearlo se registraron tres: el token de ejemplo del README inicial de NestJS, una `Idempotency-Key` de ejemplo en `API_SPEC.md` y el JWT inventado del test de redacción de logs.
    - Un secreto real nunca se ignora: se rota y se saca del historial.
    - El secret scanning y la protección de push de GitHub siguen activos como primera barrera.
  - **Job `Commit messages`,** solo en pull requests: comprueba el título del pull request y los commits de la rama, sin contar merges, contra `tipo: descripción` con los tipos de ADR-0084.
    - Lo hace `.github/scripts/check-commit-messages.sh`, en bash y sin dependencias; sus pruebas (`check-commit-messages.test.sh`) corren antes en el mismo job.
    - El título llega por variable de entorno, nunca interpolado en el script, para evitar inyección de comandos.
    - El historial anterior a la convención no se revisa.
  - **Seguridad del workflow:**
    - Permisos de solo lectura (`contents: read`).
    - Actions de terceros fijadas por SHA, con la versión en un comentario.
    - Checkout sin credenciales persistidas.
    - Un push nuevo a un pull request cancela su ejecución anterior; las de `main` siempre terminan.
    - Límite de 20 minutos para `Pipeline` y 5 para `Commit messages`.
  - Los nombres de los jobs (`Pipeline` y `Commit messages`) son los checks obligatorios de la rama principal (ADR-0106); cambiarlos exige actualizar la protección.
- **Alternativas consideradas:**
  - Jobs en paralelo: más rápidos, pero repiten `npm ci` en cada job y suman checks obligatorios.
  - TruffleHog: para verificar un hallazgo lo prueba contra el servicio correspondiente, así que envía lo encontrado a terceros.
  - Solo el secret scanning de GitHub: no es un paso del pipeline y en repositorios privados es de pago.
  - La action oficial de gitleaks: pide licencia si el repositorio pasa a una organización.
  - Un paso de migraciones aparte: repetiría la comprobación de T-110 con otro contenedor.
  - commitlint: suma dependencias para una comprobación de una línea.
  - Servicio de PostgreSQL en el workflow: descartado por ADR-0090.
- **Consecuencias:**
  - Todo pull request pasa por la CI antes de fusionarse. Desde T-107, la rama principal lo exige.
  - Cada paso se puede repetir en local con el mismo comando (`DEVELOPMENT_GUIDE.md`).
  - Una vulnerabilidad alta publicada en una dependencia hace fallar la CI aunque el pull request no la toque. Se actualiza la dependencia, o se registra la decisión si no hay arreglo.
  - Un commit con otro formato hace fallar `Commit messages`: se corrige reescribiendo los commits de la rama antes de fusionar. Dependabot (T-107) debe usar el prefijo `chore`.
  - Dependabot puede actualizar las actions fijadas por SHA. La imagen de gitleaks, por estar en una variable del workflow, se actualiza a mano.
- **Estado:** Aceptada (plan de T-106 aprobado el 2026-09-28).

---

## ADR-0106 — Protección de la rama principal y Dependabot

- **Fecha:** 2026-09-28
- **Contexto:** T-107. ADR-0030 exige que la rama principal solo reciba pull requests con el pipeline en verde y que Dependabot proponga actualizaciones agrupadas cada semana. ADR-0105 dejó los checks `Pipeline` y `Commit messages`. Hasta ahora `main` no tenía protección y Dependabot estaba desactivado. La cuenta dueña del repositorio es administradora.
- **Decisión:**
  - **Ruleset `main`**, definido en `.github/rulesets/main.json` y aplicado con la API de GitHub. Se aplica a la rama por defecto:
    - Pull request obligatorio: no se puede hacer push directo.
    - 0 aprobaciones, porque GitHub no permite que el autor apruebe su propio pull request.
    - Checks obligatorios `Pipeline` y `Commit messages`, solo si los publica GitHub Actions (aplicación 15368).
    - La rama debe estar al día con `main` antes de fusionar.
    - Ni force push ni borrado de `main`.
    - Sin excepciones, ni para administradores.
  - **Dependabot** (`.github/dependabot.yml`), con revisión semanal los lunes a las 06:00 (America/Mexico_City):
    - **npm:** un pull request agrupa las versiones menores y los parches, y cada versión mayor va en su propio pull request. Las versiones mayores de `@types/node` se ignoran, porque debe seguir a Node.js 24 (ADR-0025). Prefijo `chore`.
    - **GitHub Actions:** todas en un solo pull request, con prefijo `ci`.
    - **Espera de 7 días** (`cooldown`) antes de proponer una versión recién publicada, contra paquetes comprometidos. No aplica a las actualizaciones de seguridad.
    - **Sin imágenes de Docker:** siguen su versión mayor (`node:24`, `postgres:18`) y toman la última al construir.
  - **Otros ajustes del repositorio:**
    - Se activan las alertas de Dependabot y las actualizaciones de seguridad automáticas, que abren un pull request en cuanto se publica una vulnerabilidad, sin esperar al lunes.
    - Las ramas se borran automáticamente al fusionar.
    - Se mantienen el secret scanning y la protección de push.
  - `test/repository/github-settings.spec.ts` comprueba varias cosas:
    - que los checks obligatorios del ruleset son exactamente los jobs de `ci.yml`;
    - que el ruleset no tiene excepciones y exige rama al día;
    - que los prefijos de Dependabot pasan la comprobación de `Commit messages`.
- **Alternativas consideradas:**
  - Protección clásica de rama: equivalente, pero más difícil de exportar y versionar.
  - Exigir una aprobación: bloquearía todos los merges de un único desarrollador.
  - Excepción para administradores: permitiría saltarse la CI.
  - No exigir rama al día: se fusionaría código probado contra un `main` anterior.
  - Dependabot sin grupos: demasiados pull requests.
  - Dependabot sin espera: propondría versiones recién publicadas.
  - Dependabot con Docker: no hay versiones fijas que actualizar.
- **Consecuencias:**
  - Nada llega a `main` sin la CI en verde, ni siquiera de los administradores. En una emergencia se desactiva el ruleset a mano; queda registrado en GitHub y hay que volver a activarlo.
  - Si `main` avanzó mientras un pull request estaba abierto, hay que actualizar la rama ("Update branch") y esperar a la CI.
  - Renombrar un job de la CI exige actualizar `.github/rulesets/main.json` y volver a aplicarlo; el test lo detecta antes.
  - El archivo del ruleset no se sincroniza solo: un cambio hecho en la interfaz de GitHub debe copiarse al archivo, y un cambio en el archivo se aplica con `gh api` (`DEVELOPMENT_GUIDE.md`).
  - Los pull requests de Dependabot pasan por la CI como cualquier otro; los de versión mayor pueden requerir cambios de código.
- **Estado:** Aceptada (plan de T-107 aprobado el 2026-09-28; ruleset y ajustes aplicados ese mismo día). ADR-0107 suma `typescript` a las versiones mayores ignoradas.

---

## ADR-0107 — TypeScript se mantiene en 6.x

- **Fecha:** 2026-09-28
- **Contexto:** Dependabot propuso actualizar TypeScript de 6.0.3 a 7.0.2 (pull request #31), y la CI falló en `npm ci` por un conflicto de dependencias. La última versión de ts-jest (29.4.14) solo admite `typescript` menor que 7, y ninguna versión de ts-jest, ni siquiera en prueba, admite la 7. Además, TypeScript 7 es el compilador reescrito en Go: su paquete de npm ya no expone la API de compilador para JavaScript, solo el número de versión y APIs marcadas como inestables. De esa API dependen ts-jest, la CLI de Nest (el build) y el plugin de Swagger (ADR-0096), así que forzar la instalación tampoco serviría.
- **Decisión:**
  - El proyecto se queda en TypeScript 6.x. Dependabot sigue proponiendo sus versiones menores y parches.
  - `.github/dependabot.yml` ignora las versiones mayores de `typescript`, igual que las de `@types/node` (ADR-0106).
  - El test de configuración del repositorio comprueba que solo se ignoran las versiones mayores con un motivo registrado.
  - El pull request #31 se cierra con un comentario que explica el motivo.
- **Alternativas consideradas:**
  - Instalar TypeScript 7 con `--legacy-peer-deps`: rompería los tests, el build y el plugin de Swagger.
  - Cambiar ts-jest por otro transformador (SWC o esbuild): no resuelve el build de Nest ni el plugin de Swagger, y cambia cómo corren los tests.
  - Ignorar la versión con un comentario a Dependabot en el pull request: la regla quedaría fuera del repositorio y no se vería en la revisión.
- **Consecuencias:**
  - Seguimos recibiendo correcciones de TypeScript 6.x, pero no las mejoras de rendimiento del compilador nuevo.
  - Hay que revisar de vez en cuando si las herramientas ya lo admiten.
- **Revisar si:** ts-jest, la CLI de Nest y el plugin de Swagger admiten TypeScript 7 (o TypeScript 7 publica una API estable que ellos usen). Entonces se quita la regla de `dependabot.yml` y se prueba la actualización con la CI completa.
- **Estado:** Aceptada (aprobada el 2026-09-28).

---

## ADR-0108 — Scripts de instalación de las dependencias

- **Fecha:** 2026-09-28
- **Contexto:** Paso 0 del Sprint 2. npm 11.19 avisa que 8 dependencias tienen scripts de instalación sin revisar en `allowScripts`, pero todavía los ejecuta: durante un `npm ci`, el de `cpu-features` compiló código nativo en el equipo local. Los scripts de instalación son la vía más común del malware en npm, y uno de ellos, el de `@scarf/scarf` (a través de `@nestjs/swagger` y `swagger-ui-dist`), envía estadísticas de uso a un servicio externo en cada instalación. Ninguno hace falta:
  - `prisma` y `protobufjs` solo comprueban versiones.
  - `@prisma/engines` descarga el motor de migraciones, que el `prisma generate` del propio proyecto también descarga.
  - `@parcel/watcher` y `unrs-resolver` (de Jest) compilan o revisan binarios que ya llegan precompilados.
  - `cpu-features` y `ssh2` (de Testcontainers) compilan aceleraciones opcionales para conexiones SSH a Docker, que el proyecto no usa.
  - `@scarf/scarf` es telemetría.
- **Decisión:**
  - `package.json` declara `allowScripts` y **niega los 8 scripts**, con entradas por nombre, sin versión fija. Así una versión nueva de un paquete ya revisado conserva la decisión y los pull requests de Dependabot no fallan por eso.
  - `.npmrc` activa `strict-allow-scripts=true`: una dependencia nueva con scripts sin revisar **hace fallar la instalación**, en local, en la CI y en Docker, en vez de ejecutarse con un aviso.
  - El `Dockerfile` copia `.npmrc` antes de cada `npm ci`.
  - Los scripts del propio proyecto, como el `postinstall` que ejecuta `prisma generate`, no se ven afectados.
  - Aprobar un script requiere revisarlo, registrar el motivo en este ADR o en uno nuevo y actualizar `test/repository/install-scripts.spec.ts`, que hoy exige que no haya ninguno aprobado.
- **Alternativas consideradas:**
  - Aprobar todos los scripts (`npm install-scripts approve --all`): silencia el aviso, pero sigue ejecutando código que no hace falta, incluida la telemetría.
  - Negar los scripts sin modo estricto: una dependencia nueva con scripts se ejecutaría con solo un aviso.
  - `--ignore-scripts` en cada instalación: también bloquea el `prisma generate` del proyecto, y hay que recordarlo en cada comando.
  - Entradas con versión fija (el comportamiento por defecto de npm): cada actualización del paquete obligaría a revisarlo otra vez y haría fallar los pull requests de Dependabot.
  - Desactivar solo la telemetría con `SCARF_ANALYTICS=false`: no cubre el resto.
- **Consecuencias:**
  - Ninguna dependencia ejecuta código al instalarse, y la telemetría de scarf deja de enviarse. Las instalaciones no compilan código nativo, así que son más rápidas.
  - Si una actualización (por ejemplo, de Dependabot) trae un paquete nuevo con scripts, `npm ci` falla con `ESTRICTALLOWSCRIPTS` hasta decidir si se aprueba o se niega (`DEVELOPMENT_GUIDE.md`).
  - Con una versión de npm anterior a 11.19, `allowScripts` se ignora y los scripts vuelven a ejecutarse; el proyecto usa la que trae Node.js 24 (ADR-0025).
  - Verificado con instalaciones limpias en Windows y Linux: tests unitarios, de integración (con las migraciones) y end-to-end, build, e imágenes de Docker de desarrollo y producción. La imagen de producción queda igual que antes, de 913 MB y con el mismo motor de Prisma.
- **Estado:** Aceptada (aprobada el 2026-09-28).

---

## ADR-0109 — Catálogo geográfico del INEGI y scripts de operación

- **Fecha:** 2026-09-28
- **Contexto:** T-124 (UC-IAM-21 y UC-IAM-22). ADR-0057 decidió cargar el catálogo de estados y municipios del INEGI con un script manual e idempotente a partir del archivo descargado, sin que la API descargue nada. `ARCHITECTURE.md` lo define como capacidad transversal. El proyecto no tenía todavía ningún script de operación, y T-131 necesitará otro para crear el primer superadministrador.
- **Decisión:**
  - **Módulo transversal `src/modules/geo/`**, con dominio, aplicación, infraestructura y presentación:
    - `GeoCatalogSnapshot` valida el archivo completo antes de escribir nada.
    - `planGeoCatalogImport` calcula qué se crea, se renombra, se desactiva o se reactiva.
    - `ImportGeoCatalog` es el caso de uso de importación.
    - `GeoCatalog` es la fachada de solo lectura que exporta su `index.ts`, para las direcciones (T-130) y el checkout de invitados.
    - `PrismaGeoCatalogRepository` escribe con una sentencia SQL por tabla (`INSERT … SELECT unnest(…) ON CONFLICT DO UPDATE`), porque 2,478 escrituras una a una podrían pasar del límite de 5 s por transacción (ADR-0093).
  - **Archivo de entrada:** el CSV en UTF-8 del "Catálogo de Municipios Nacional" (`AGEEML_…_utf8.csv` dentro de `catun_municipio.zip`). Trae el nombre de cada estado, así que no hace falta el catálogo de entidades. Se lee con un lector CSV (RFC 4180) propio, sin dependencias. Un archivo que no es UTF-8, como el CSV sin sufijo del mismo ZIP, o que no tiene las columnas `CVE_ENT`, `NOM_ENT`, `CVE_MUN` y `NOM_MUN`, se rechaza.
  - **Reglas de la importación:**
    - Aborta sin cambiar nada si el archivo no trae exactamente 32 estados, si tiene claves mal formadas, municipios repetidos o un estado con dos nombres.
    - Todo va en una transacción.
    - Los municipios que faltan en el archivo se desactivan, nunca se borran, y los que vuelven se reactivan.
    - Importar dos veces el mismo archivo no cambia nada.
    - `--dry-run` informa los cambios sin escribir.
    - Cada importación real deja una entrada de auditoría `geo.catalog-imported`, a nombre de SYSTEM, con los conteos de antes y después.
  - **Catálogo versionado:** el archivo del INEGI se guarda sin cambios en `data/inegi/municipios-2026-06.csv`, con su fecha de corte (2026/06), procedencia, checksum y el crédito que piden los términos de libre uso del INEGI (`data/inegi/README.md`). `.gitattributes` conserva sus bytes (CRLF).
  - **Scripts de operación:**
    - Viven en `src/scripts/` y se compilan con la API.
    - Cada uno arranca un contexto de aplicación de Nest con solo los módulos que necesita: sin servidor HTTP, sin scheduler y sin bus de eventos.
    - La operación corre en su propio contexto asíncrono con identificador, como un job (ADR-0101).
    - Terminan con código 0 si todo salió bien y 1 ante un error de argumentos o de datos, y cada línea del resultado va al log.
    - `npm run geo:import -- <archivo> [--dry-run]` compila y ejecuta el script.
    - Donde el código ya está compilado se usa `node dist/scripts/import-geo-catalog.js <archivo>`: en el contenedor de desarrollo, cuyo `start:dev` compila sin parar, y en la imagen de producción.
  - **Consulta pública (UC-IAM-22):** `GET /v1/geo/states` y `GET /v1/geo/states/{stateCode}/municipalities`, con solo los municipios activos, ordenados por nombre.
    - Una clave de estado inexistente o mal formada responde 404 `not-found`.
    - Las respuestas se cachean en el espacio `geo` (ADR-0104) durante el TTL. La importación corre en otro proceso y no puede vaciar ese cache, así que un catálogo nuevo se ve en la API a más tardar al vencer el TTL (120 s por defecto).
  - **Convención de OpenAPI** (complementa ADR-0096): la respuesta de éxito de cada endpoint se declara con `@ApiOkResponse` (o `@ApiCreatedResponse`), y los campos de un DTO que contienen otros DTO, con `@ApiProperty({ type })`. El plugin de Swagger solo los deduce con el análisis de tipos de `nest build`; en los tests (ts-jest compila archivo por archivo) no, y el documento de los tests quedaría incompleto.
- **Alternativas consideradas:**
  - Cargar el catálogo como datos iniciales (`prisma db seed`): no permite actualizarlo de forma idempotente ni desactivar municipios.
  - Leer el ZIP directamente: sumaría una dependencia; el operador lo descomprime.
  - No versionar el archivo: cada desarrollador y la CI tendrían que descargarlo.
  - Escribir municipio por municipio: lento y cerca del límite de la transacción.
  - Dejar que el plugin documente las respuestas: los tests no verían el mismo documento que producción.
- **Consecuencias:**
  - La base local se carga una vez con `npm run geo:import -- data/inegi/municipios-2026-06.csv`. Actualizar el catálogo es reemplazar el archivo versionado e importarlo (`data/inegi/README.md`).
  - T-131 (primer superadministrador) usa el mismo mecanismo de scripts.
  - Para ejecutar el script en producción, la imagen necesitará el archivo del catálogo, igual que `prisma/` para las migraciones (P-05).
- **Estado:** Aceptada (plan de T-124 aprobado el 2026-09-28).

---

## ADR-0110 — Envío de correos y enlaces al frontend

- **Fecha:** 2026-09-28
- **Contexto:** T-122. ADR-0045 pide enviar los correos a través de un puerto, con un adaptador al capturador local (Mailpit) en desarrollo y el proveedor real cuando se decida P-24. ADR-0056 pide armar los enlaces de verificación y de recuperación con la URL base del frontend, configurable. Los usan la verificación de email (T-121), la recuperación de contraseña (T-123) y las notificaciones de la orden (T-215), así que el puerto no puede pertenecer a un solo contexto.
- **Decisión:**
  - **Puertos en el shared kernel**, como `AuditTrail`, para que Application los use desde cualquier contexto:
    - `EmailSender.send({ to, subject, text, html? })` envía de inmediato. Si el servidor no acepta el mensaje, rechaza con `EmailDeliveryError`, cuyo mensaje nunca lleva el destinatario.
    - No se llama dentro de una transacción: se envía después del commit, como hacen los handlers de eventos. Un correo fallido no se reintenta (ADR-0014).
    - `FrontendLinks.link(ruta, parámetros)` devuelve la URL absoluta de una página del frontend, con los parámetros en la query codificados. Dónde va el token en cada enlace lo deciden T-121 y T-123.
  - **Adaptador SMTP con nodemailer** en `src/platform/mail/`, con un módulo global.
    - Protege contra la inyección de encabezados y codifica UTF-8 en asunto y cuerpo.
    - Límites de tiempo: 10 s para conectar, 10 s para el saludo del servidor y 20 s de inactividad.
    - El puerto 465 usa TLS desde el inicio; en los demás, nodemailer pasa a TLS (STARTTLS) si el servidor lo ofrece.
    - El log registra solo el identificador del mensaje enviado, o el código de error SMTP, nunca el destinatario ni el contenido.
    - Se instaló nodemailer 10.0.10 (sin dependencias ni scripts de instalación) y no la 10.0.12, publicada el mismo día: se respeta la misma espera de 7 días de Dependabot (ADR-0106).
  - **Configuración** en `.env.example`:
    - `SMTP_HOST` (por defecto `localhost`), `SMTP_PORT` (1025), `MAIL_FROM` (`base-shop <no-reply@base-shop.test>`) y `FRONTEND_BASE_URL` (`http://localhost:5173`).
    - `MAIL_FROM` es una dirección, o `Nombre <dirección>` en una sola línea.
    - `FRONTEND_BASE_URL` es `http` o `https`, con ruta opcional, sin query, fragmento, credenciales ni barra final.
    - **Con `NODE_ENV=production` las cuatro son obligatorias**, para que nunca se envíe a Mailpit ni con enlaces a `localhost`.
    - En Docker Compose, el contenedor de la API recibe `SMTP_HOST=mailpit`.
  - **Tests** contra Mailpit real, con Testcontainers: envío con acentos y versión HTML, un asunto con saltos de línea que no agrega encabezados, y un log sin el destinatario. `testcontainers` pasa a ser dependencia de desarrollo directa.
- **Alternativas consideradas:**
  - Puerto dentro de Identity & Access: las notificaciones (T-215) no podrían usarlo sin depender de ese contexto.
  - Cliente SMTP propio o la API HTTP de un proveedor: más código, y el proveedor todavía no está decidido (P-24).
  - Mocks en lugar de Mailpit: no probarían la codificación ni el protocolo.
  - Valores por defecto también en producción: los enlaces apuntarían a `localhost` sin que nadie lo note.
- **Consecuencias:**
  - T-121, T-123 y T-215 solo arman el mensaje; no conocen el mecanismo de envío.
  - Cambiar de proveedor (P-24) es otro adaptador de `EmailSender` y otras variables SMTP. Si el proveedor pide usuario y contraseña, se agregan como variables nuevas.
  - Los correos de desarrollo se leen en http://localhost:8025.
- **Estado:** Aceptada (plan de T-122 aprobado el 2026-09-28).

---

## ADR-0111 — Autorización, catálogo de permisos y base de Identity & Access

- **Fecha:** 2026-09-28
- **Contexto:** T-130 (UC-IAM-11 y 14 a 19). Sus endpoints necesitan un usuario autenticado, pero la autenticación llega con T-120, que depende de T-130 porque necesita los usuarios. Además, la anonimización (UC-IAM-19) toca órdenes, envíos y carritos, que todavía no existen, y la reactivación del staff genera una contraseña temporal, como el alta de staff de T-131. ADR-0017 pide un catálogo de permisos en código declarado por cada módulo, y ADR-0036 fija la paginación de los listados, que aún no tenía implementación.
- **Decisión:**
  - **Reparto de T-130** en tres pull requests: (a) base, (b) administración de roles, staff y clientes, y (c) direcciones. Salen de T-130:
    - la anonimización de clientes e invitados (UC-IAM-19), a una tarea nueva, T-132, que depende de Shopping, Ordering y Shipping;
    - la reactivación del staff, a T-131, que ya genera contraseñas temporales;
    - revocar las sesiones al suspender, a T-120, en la misma transacción que la suspensión, porque las sesiones nacen allí.

    `orderCount` del detalle de cliente responde 0 hasta que T-180 conecte Ordering.
  - **Catálogo de permisos en el shared kernel** (`PERMISSIONS`, `PermissionCode`, `isPermissionCode`):
    - Los 15 permisos de ADR-0043 y ADR-0075, con su descripción en español, agrupados por contexto. Cada contexto es dueño de sus entradas.
    - Precisa ADR-0017. Si Identity importara el catálogo de cada módulo, habría dependencias circulares en cuanto otros módulos usen su fachada.
    - El plan aprobado lo ubicaba en `platform/auth`, pero el dominio y la aplicación de Identity tienen que validar los roles contra él (BR-USR-04), y las reglas de límites solo les permiten importar el shared kernel.
  - **Rol superadministrador:** tiene todos los permisos del catálogo de forma implícita y no guarda filas en `role_permissions`. Un permiso nuevo en el código le llega sin migración, y sus permisos no se editan.
  - **Roles iniciales** de ADR-0043 en la migración `20260928120000_identity_initial_roles`:
    - Superadministrador, con todos los permisos implícitos.
    - Administrador: todos menos `staff.manage`.
    - Operador: `catalog.*`, `pricing.*`, `inventory.*`, `orders.read`, `shipping.manage` y `customers.read`.

    Después se editan en la base (UC-IAM-15). No se crea ningún usuario.
  - **Autorización** en `src/platform/auth/`, con el guard global `AuthorizationGuard`:
    - `@RequirePermissions(...códigos)` marca una ruta de `/v1/admin`: exige una cuenta de staff con todos los permisos indicados.
    - `@RequireAccount({ customerOnly?, allowPendingPasswordChange? })` marca una ruta de `/v1/me`.
    - Lee el usuario de `request.user` (`AuthenticatedUser`: `id`, `type`, `permissions` y `mustChangePassword`), que T-120 llenará desde el JWT, con los permisos de `IdentityAccessFacade.permissionsOf`.
    - Sin usuario, o con uno mal formado, responde 401 `unauthenticated`.
    - A un staff con contraseña temporal le responde 403 `password-change-required`, salvo en las rutas que lo permiten.
    - A un cliente en `/v1/admin`, o a un staff sin los permisos, le responde 403 `forbidden`, que se audita (ADR-0100). También 403 `forbidden` a un staff en una ruta solo para clientes.
    - **Falla cerrado:** una ruta de `/v1/admin` o `/v1/me` sin su decorador responde 500, así un olvido no deja la ruta pública.
    - Corre después del rate limiting; la autenticación de T-120 irá antes de ambos.
    - `@RequirePermissions` documenta el Bearer y los permisos (`x-required-permissions`) en OpenAPI.
    - Hasta T-120, esas rutas responden 401. Los tests e2e usan un autenticador que solo existe en `test/support/`.
  - **Paginación (ADR-0036):**
    - `PageQueryDto` (`page` desde 1, `pageSize` de 1 a 100, 20 por defecto), que extiende el DTO de consulta de cada listado.
    - `@IsSortOf(campos)`, que acepta el campo con `-` opcional; si no, responde 400 con un mensaje en español.
    - `toSortOrder`, y `toPageResponse` para devolver `{ data, meta }`.
    - `Page`, `PageRequest` y `SortOrder` en el shared kernel, para los repositorios.
  - **Errores genéricos del shared kernel:** `VersionConflictError` (409, con `currentVersion`) e `InvalidStateTransitionError` (409, con `currentStatus`).
  - **Agregados y persistencia:**
    - `User` (suspender, reactivar clientes, reemplazar roles) y `Role` (crear, renombrar, reemplazar permisos) guardan su estado en un snapshot.
    - Los repositorios de Prisma aplican bloqueo optimista con `updateMany … where version`; si otra modificación ganó, rechazan con `VersionConflictError` y la versión actual.
    - Las asignaciones de roles registran quién las hizo.
- **Alternativas consideradas:**
  - Esperar a T-120 para hacer T-130: T-120 necesita los usuarios.
  - Catálogo de permisos en cada módulo: dependencias circulares con Identity.
  - Guardar los permisos del superadministrador como filas: un permiso nuevo necesitaría una migración.
  - Guard que deja pasar las rutas sin decorador: un olvido publicaría una ruta de administración.
  - Paginación por cursor: ADR-0036 la reserva para listados muy grandes.
- **Consecuencias:**
  - T-120 solo tiene que autenticar y llenar `request.user`; la autorización ya existe.
  - Cada endpoint nuevo de `/v1/admin` y `/v1/me` declara su requisito, o falla con 500 en los tests.
  - Un permiso nuevo se agrega al catálogo en el shared kernel y a los roles que lo necesiten. El superadministrador lo recibe solo.
  - Un validador propio de class-validator necesita un mensaje por defecto para que su mensaje en español (`context.message`) llegue a la respuesta.
- **Estado:** Aceptada (plan de T-130 aprobado el 2026-09-28; ubicación del catálogo ajustada durante la implementación, ver arriba).

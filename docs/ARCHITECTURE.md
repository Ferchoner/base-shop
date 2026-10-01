# ARCHITECTURE

## Principios

- Separación de responsabilidades
- Bajo acoplamiento
- Alta cohesión
- SOLID
- Clean Code
- Seguridad por diseño
- Testabilidad
- Modularidad
- DDD pragmático: patrones solo cuando aportan valor

## Estilo arquitectónico

Monolito modular con DDD pragmático (ADR-0003). Sin microservicios, Event Sourcing ni CQRS complejo. Una base de datos PostgreSQL (ADR-0006).

## Estructura

Cada bounded context es un módulo de NestJS con cuatro capas:

| Capa | Contiene | Puede depender de |
|---|---|---|
| `domain` | Aggregates, entidades, Value Objects, domain events, domain services, interfaces de repositories | Solo shared kernel. Nunca NestJS ni Prisma |
| `application` | Casos de uso, puertos hacia servicios externos y hacia otros contextos, fachada pública del módulo | `domain` |
| `infrastructure` | Implementaciones de repositories con Prisma, mapeadores, adaptadores (pagos, paqueterías, almacenamiento), consultas de lectura | `application`, `domain`, Prisma |
| `presentation` | Controladores REST, DTOs HTTP, validación de entrada, guards de permisos, decoradores de Swagger | `application` |

Estructura de carpetas (ADR-0088):

```text
src/
├── main.ts
├── app.module.ts              importa la plataforma y los módulos de contexto
├── platform/                  infraestructura técnica transversal, sin reglas de negocio
│   ├── auth/                  autorización: AuthenticatedUser, @RequirePermissions, @RequireAccount, @CurrentUser y el guard global, que también pone Cache-Control: no-store (T-130, ADR-0111, ADR-0112). La autenticación vive en identity-access: su guard global corre antes del rate limiting y de la autorización (T-120, ADR-0114)
│   ├── cache/                 AppCache con espacios de nombres sobre @nestjs/cache-manager (T-119, ADR-0104)
│   ├── clock/                 SystemClock, la implementación del puerto Clock (T-112)
│   ├── config/                variables de entorno y el formato de sus valores, como las duraciones (T-100, ADR-0114)
│   ├── files/                 lector CSV (RFC 4180) con la línea de cada registro, para la importación del catálogo geográfico y la carga masiva de precios (T-124, T-145; ADR-0109, ADR-0126)
│   ├── http/                  CORS, encabezados de seguridad, errores como Problem Details, validación de entrada, identificador de correlación, versionado, Swagger, idempotencia, rate limiting, paginación de listados por página y por cursor, IDs de la URL, `MoneyDto`, los DTO de dirección e imágenes servidas en `/media` (T-100, T-113, T-114, T-115, T-126, T-130, T-141, T-150, T-160, T-196)
│   ├── jobs/                  scheduler y decorador @ScheduledJob (T-117, ADR-0101)
│   ├── events/                bus de eventos en proceso: publicador, despachador y @OnDomainEvent (T-116, ADR-0098)
│   ├── mail/                  envío de correos por SMTP (nodemailer) y enlaces al frontend (T-122, ADR-0110)
│   ├── logging/               AppLogger, redacción de datos sensibles y línea de log por solicitud (T-118, ADR-0097)
│   └── persistence/           PrismaService, cliente generado de Prisma y contexto transaccional (T-110, T-111; ADR-0091, ADR-0093)
├── scripts/                   scripts de operación con un contexto de aplicación de Nest, como la importación del catálogo geográfico (ADR-0109) y la creación del primer superadministrador (ADR-0116), y de mantenimiento, como la generación de la lista de contraseñas comunes (ADR-0115)
├── shared-kernel/             Money, IDs, error de dominio, eventos, Clock (T-112), los puertos TransactionManager, DomainEventPublisher, AuditTrail, EmailSender y FrontendLinks (T-111, T-116, T-127, T-122), el catálogo de permisos, la paginación y los errores de versión y de estado (T-130); sin NestJS
└── modules/
    ├── audit/                 módulo transversal, no un contexto: implementación global del puerto AuditTrail; solo infraestructura (T-127, ADR-0100)
    ├── geo/                   módulo transversal: catálogo de estados y municipios del INEGI, su importación, la consulta pública y una fachada de solo lectura (T-124, ADR-0109)
    └── <contexto>/            identity-access, catalog, pricing, inventory, shopping, ordering, payments, shipping
        ├── domain/
        ├── application/
        ├── infrastructure/
        ├── presentation/
        ├── <contexto>.module.ts
        └── index.ts           API pública del contexto: módulo, fachada y tipos públicos (ADR-0005)
```

- `platform` puede ser usado por `infrastructure` y `presentation`; `shared-kernel`, por todas las capas.
- Un módulo solo importa de otro a través de su `index.ts`; lo verifica `npm run lint:boundaries` (ADR-0103).
- Las capacidades transversales (auditoría, notificaciones y catálogo geográfico) son módulos bajo `modules/`, con solo las capas que necesitan (T-127, T-215, T-124).

## Módulos (bounded contexts)

Ver `DOMAIN_MODEL.md` y ADR-0004 (aceptada).

- Identity & Access (sustituye a Auth y Users)
- Catalog
- Pricing
- Inventory
- Shopping (sustituye a Cart)
- Ordering (sustituye a Orders)
- Payments
- Shipping

Cambios respecto a la lista anterior:

- **Admin** no es un módulo: cada contexto expone sus endpoints administrativos protegidos por permisos.
- **Promotions** queda fuera del MVP (ADR-0018).
- **Pricing** y **Shipping** se agregan como contextos.

Capacidades transversales:

- Auditoría técnica: tabla append-only alimentada desde la capa de aplicación, en la misma transacción que el cambio; los registros con más de 3 meses se exportan a archivos comprimidos (ADR-0037). Application registra con el puerto `AuditTrail` del shared kernel, implementado en `src/modules/audit/` (ADR-0100); es la única integración transversal con un puerto compartido en lugar de un puerto por contexto (ADR-0005), porque los ocho contextos lo necesitan con la misma forma.
- Notificaciones: módulo que reacciona a eventos, sin dominio propio.
- Shared kernel mínimo: `Money`, tipos de ID, error de dominio base, forma de domain event, y los puertos `Clock`, `TransactionManager`, `DomainEventPublisher`, `AuditTrail`, `EmailSender` y `FrontendLinks` (ADR-0094, ADR-0098, ADR-0100, ADR-0110).

## Reglas de integración entre módulos

Ver ADR-0005.

- Cada módulo expone una fachada pública; nunca exporta entidades, aggregates ni repositorios.
- El consumidor define su propio puerto y un adaptador en su infraestructura. Primer caso: Identity declara `AddressLocations` y lo responde con la fachada `GeoCatalog` del módulo `geo` (ADR-0113). Pricing e Inventory declaran su `CatalogVariants` y lo responden con `CatalogFacade` (ADR-0125, ADR-0127); Inventory también declara `WarehouseLocations` para la fachada de Geo. Ordering declara un puerto por cada módulo que usa en el checkout (ADR-0132).
- Dos módulos nunca se usan mutuamente: la regla `no-circular` lo rechaza. Pricing e Inventory usan a Catalog, y Catalog no usa a ninguno (ADR-0125, ADR-0127). Shopping usa a Catalog, Pricing e Inventory, y ninguno usa a Shopping (ADR-0131). Ordering usa a Shopping, Catalog, Pricing, Inventory, Shipping, Identity & Access, Geo y Payments, y ninguno usa a Ordering (ADR-0132, ADR-0134): Payments le avisa a Ordering con eventos. Un módulo que reacciona a eventos de otro se suscribe por el nombre del evento y declara su propio tipo, sin importar el del otro.
- Entre contextos solo se comparten IDs, snapshots y eventos. Sin relaciones de Prisma ni llaves foráneas entre contextos.
- Los límites se verifican automáticamente con `dependency-cruiser` (`npm run lint:boundaries`, reglas en `.dependency-cruiser.cjs`, ADR-0103): capas según la tabla de "Estructura", módulos solo por su `index.ts`, Prisma solo en `platform` e `infrastructure`, shared kernel sin frameworks, `platform` sin módulos y sin dependencias circulares. La excepción de ADR-0060 (lectura de tablas de otros contextos en el catálogo público) no se ve en los imports.
- Única excepción: el servicio de consultas del catálogo público (`PrismaStorefrontQueries`) lee tablas de Catalog, Pricing e Inventory, solo para lectura (ADR-0060). `test/boundaries/table-ownership.spec.ts` verifica que ningún otro archivo de un módulo use tablas o modelos de Prisma de otro contexto (ADR-0129).

## Transacciones y concurrencia

- Un aggregate por transacción como regla general; las excepciones se documentan (ADR-0019).
- Nunca se llaman servicios externos dentro de una transacción de base de datos.
- Las transacciones se propagan a los repositorios mediante un contexto transaccional (AsyncLocalStorage), sin exponer Prisma a Application ni Domain. Librería: `nestjs-cls` con su plugin transaccional y el adaptador oficial para Prisma (ADR-0033, ADR-0093).
  - Application delimita la transacción con el puerto `TransactionManager` del shared kernel (`run(work)`): confirma si `work` termina bien y revierte si falla.
  - Los repositorios usan `TransactionHost<PrismaTransactionAdapter>` y su propiedad `tx`: dentro de una transacción es el cliente de esa transacción; fuera, el `PrismaService` normal. Nunca reciben la transacción como parámetro.
  - Un `run` dentro de otro se une a la transacción externa. `runNested(work)` también se une, pero si `work` falla deshace solo lo suyo con un `SAVEPOINT`, junto con los eventos que publicó, y la transacción sigue (ADR-0133).
  - Cada transacción espera como máximo 2 s para iniciar y se revierte si dura más de 5 s.
- Bloqueo optimista con columna `version` en los aggregates editables; la lista está en `DATABASE.md` (sección 12).
- Reserva de inventario con actualización condicional atómica y restricción `CHECK` (ADR-0011).
- Idempotencia con encabezado `Idempotency-Key` en PlaceOrder e InitiatePayment, con el decorador `@Idempotent` (ADR-0063, ADR-0099). La llave se registra de forma atómica, fuera de la transacción del caso de uso, así que de dos solicitudes simultáneas solo una se ejecuta.
- Nivel de aislamiento: Read Committed (predeterminado de PostgreSQL).

## Eventos de dominio

- Despacho en proceso, **en segundo plano**, después del commit, sin outbox (ADR-0014, ADR-0098). La operación responde antes de que los handlers terminen; los efectos que se ven con demora están en `API_SPEC.md` (sección 2.5).
- Application publica con el puerto `DomainEventPublisher` del shared kernel. Dentro de `TransactionManager.run`, los eventos esperan a que confirme la transacción más externa y se descartan si se revierte; fuera de una transacción salen de inmediato.
- Handlers: adaptadores de entrada en la capa `infrastructure` del contexto que consume, marcados con `@OnDomainEvent('Evento')`; llaman a un caso de uso con su propia transacción. Los eventos que publiquen se despachan igual, así que las cadenas funcionan.
- Los handlers de un evento corren uno tras otro, en orden de publicación. Un fallo se registra en el log y no detiene a los demás; no hay reintentos automáticos.
- Al cerrar la aplicación se espera a los handlers en curso antes de desconectar la base.
- Forma común en el shared kernel (`DomainEvent`): `eventId` (UUIDv7), `eventType` (el nombre de `DOMAIN_MODEL.md`) y `occurredAt`; cada evento agrega sus datos (ADR-0094).
- Handlers idempotentes por el estado de su dominio: por ejemplo, marcar como pagada una orden que ya lo está no hace nada. `eventId` identifica el evento en los logs.
- Job de conciliación de pagos como red de seguridad.
- Solo se emiten eventos con un consumidor real.

## Cache

- Integración: `@nestjs/cache-manager` (ADR-0028).
- La cache vive en Infrastructure o Presentation; Domain y Application no dependen de ella.
- Prohibida para decisiones que requieren consistencia: stock en checkout, precios al colocar la orden, pagos, carrito, permisos y tokens.
- Todo valor en cache tiene TTL.
- Almacén en memoria del proceso; si se escala a varias instancias, se cambia a un almacén compartido.
- Solo se cachean lecturas públicas del catálogo: árbol de categorías, marcas, detalle de producto y listados de la tienda sin texto de búsqueda (ADR-0060, ADR-0129).
- TTL de 120 segundos, configurable.
- Invalidación inmediata por `ProductPublished`, `ProductArchived` y `VariantDiscontinued`; el resto, por TTL.
- Implementación (ADR-0104): `AppCache` separa los datos en espacios de nombres, cada uno con su almacén (`namespace('catalog').getOrLoad(clave, carga)`), y cada espacio se vacía por separado. El handler `PublicCatalogCacheInvalidation` de Catalog vacía todo el espacio `catalog` con cualquiera de los tres eventos. El TTL se configura con `CACHE_TTL_SECONDS`. Las reglas de límites de ADR-0103 ya impiden usar el cache desde Domain y Application. Cada espacio guarda hasta 1 000 valores (`MAX_ENTRIES_PER_NAMESPACE`) y, al pasar de ahí, descarta el que se usó hace más tiempo (`LruStore`, ADR-0129).

## Jobs programados

- Expiración de reservas y de órdenes impagas.
- Conciliación de pagos.
- Limpieza diaria y archivo de la auditoría.

Mecanismo: `@nestjs/schedule` dentro del proceso de la API (ADR-0029). Los jobs llaman casos de uso, no se superponen, procesan por lotes con una transacción por elemento y son idempotentes.

Base común (ADR-0101): cada job es un método marcado con `@ScheduledJob(nombre, expresiónCron)`, que garantiza que una ejecución no se superponga con la anterior (la nueva se omite con un aviso en el log), que un fallo quede en el log sin detener el scheduler y que cada ejecución corra en su propio contexto asíncrono con un identificador que llevan sus logs. Todas las expresiones cron se interpretan en America/Mexico_City. La variable `JOBS_ENABLED` (por defecto `true`) apaga el scheduler; los tests la ponen en `false`. Al cerrar la aplicación se espera a las ejecuciones en curso.

| Job | Frecuencia | Detalle |
|---|---|---|
| Expiración de reservas y órdenes impagas | Cada minuto | ADR-0011 |
| Conciliación de pagos | Cada 5 minutos | Pagos con más de 10 minutos sin resolver (ADR-0014) |
| Limpieza | Diaria, 3:00 (America/Mexico_City) | Refresh tokens vencidos o revocados (30 días), tokens de verificación y recuperación vencidos o usados (ADR-0056), llaves de idempotencia (24 horas), eventos de webhooks (30 días), carritos de invitado inactivos (30 días); exporta a archivos comprimidos los registros de auditoría de más de 3 meses, los borra de la base y elimina los archivos de más de 2 años |

## Integraciones externas

| Integración | Estado |
|---|---|
| Pagos | Método manual para pruebas; PayPal semiimplementado y no verificado; Mercado Pago y Stripe pospuestos (ADR-0040). Pruebas de webhooks pendientes (P-31) |
| Paqueterías | Sin integración; envíos manuales (ADR-0041) |
| Almacenamiento de imágenes | Disco del servidor detrás del puerto `ProductImageStorage` de Catalog, servido por la API en `/media`; CDN a futuro (ADR-0024, ADR-0121) |
| Envío de correos | Puerto propio; en desarrollo, capturador local en Docker Compose (ADR-0045). Proveedor real pendiente de hosting (P-24) |

## Observabilidad

En local (ADR-0032): logs en consola con nivel configurable por variable de entorno (`LOG_LEVEL`), declarada en `.env.example`. Detalle en ADR-0097:

- `AppLogger` (el `ConsoleLogger` de NestJS extendido) atiende todo `new Logger(Contexto)`.
- Texto con colores en desarrollo y tests; una línea JSON por evento en producción.
- Una línea por solicitud terminada: método, ruta sin la cadena de consulta, estado y duración.

Métricas, trazas y seguimiento de errores: PENDIENTE DE DECISIÓN hasta elegir hosting (P-07).

Requisitos mínimos ya identificados:

- Registrar cada fallo o interrupción de handlers de eventos (ADR-0014).
- No registrar datos sensibles (ver `SECURITY.md`).
- Identificador de correlación por solicitud HTTP en todos sus logs (ADR-0033). Cada solicitud recibe uno generado por el servidor, guardado en el contexto de `nestjs-cls` y devuelto en `X-Correlation-Id` (ADR-0095); `AppLogger` lo agrega a cada log escrito durante la solicitud (ADR-0097).
- Los errores inesperados se registran con su stack trace y el identificador de correlación; la respuesta solo lleva el identificador (ADR-0095).

## Configuración

`@nestjs/config` valida las variables de entorno al arrancar con class-validator (ADR-0032, ADR-0087); si falta una obligatoria o una es inválida, la API no inicia. El código lee la configuración tipada con `ConfigService`. Las políticas HTTP (CORS y encabezados de seguridad) se aplican en una función compartida por el arranque y los tests end-to-end.

## CORS

Lista de orígenes permitidos en `CORS_ALLOWED_ORIGINS`, vacía por defecto y sin comodín; sin credenciales, porque la API no usa cookies. Métodos, encabezados permitidos y expuestos, y caché del preflight son fijos (ADR-0085).

## Encabezados de seguridad

`helmet` con configuración explícita (ADR-0086): `nosniff`, CSP restrictiva para respuestas JSON, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y sin `X-Powered-By`. HSTS, TLS y redirección a HTTPS los pone quien termine HTTPS (hosting, P-06).

## Reloj

Las reglas dependientes del tiempo (precios programados, expiraciones) usan un puerto `Clock` inyectado para poder probarse. El puerto está en el shared kernel y su implementación, `SystemClock`, en `src/platform/clock/`; ningún código llama a `new Date()` para obtener la hora actual (ADR-0094).

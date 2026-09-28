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
│   ├── clock/                 SystemClock, la implementación del puerto Clock (T-112)
│   ├── config/                variables de entorno (T-100)
│   ├── http/                  CORS, encabezados de seguridad, errores como Problem Details, validación de entrada, identificador de correlación, versionado, Swagger e idempotencia (T-100, T-113, T-114, T-115)
│   ├── events/                bus de eventos en proceso: publicador, despachador y @OnDomainEvent (T-116, ADR-0098)
│   ├── logging/               AppLogger, redacción de datos sensibles y línea de log por solicitud (T-118, ADR-0097)
│   └── persistence/           PrismaService, cliente generado de Prisma y contexto transaccional (T-110, T-111; ADR-0091, ADR-0093)
├── shared-kernel/             Money, IDs, error de dominio, eventos, Clock (T-112) y TransactionManager (T-111); sin NestJS
└── modules/
    └── <contexto>/            identity-access, catalog, pricing, inventory, shopping, ordering, payments, shipping
        ├── domain/
        ├── application/
        ├── infrastructure/
        ├── presentation/
        ├── <contexto>.module.ts
        └── index.ts           API pública del contexto: módulo, fachada y tipos públicos (ADR-0005)
```

- `platform` puede ser usado por `infrastructure` y `presentation`; `shared-kernel`, por todas las capas.
- Un módulo solo importa de otro a través de su `index.ts`; la verificación automática llega con T-103.
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

- Auditoría técnica: tabla append-only alimentada desde la capa de aplicación, en la misma transacción que el cambio; los registros con más de 3 meses se exportan a archivos comprimidos (ADR-0037).
- Notificaciones: módulo que reacciona a eventos, sin dominio propio.
- Shared kernel mínimo: `Money`, tipos de ID, error de dominio base, forma de domain event, y los puertos `Clock` y `TransactionManager` (ADR-0094).

## Reglas de integración entre módulos

Ver ADR-0005.

- Cada módulo expone una fachada pública; nunca exporta entidades, aggregates ni repositorios.
- El consumidor define su propio puerto y un adaptador en su infraestructura.
- Entre contextos solo se comparten IDs, snapshots y eventos. Sin relaciones de Prisma ni llaves foráneas entre contextos.
- Los límites se verifican automáticamente en CI (herramienta a elegir en T-103).
- Única excepción: el servicio de consultas del catálogo público lee tablas de Catalog, Pricing e Inventory, solo para lectura (ADR-0060).

## Transacciones y concurrencia

- Un aggregate por transacción como regla general; las excepciones se documentan (ADR-0019).
- Nunca se llaman servicios externos dentro de una transacción de base de datos.
- Las transacciones se propagan a los repositorios mediante un contexto transaccional (AsyncLocalStorage), sin exponer Prisma a Application ni Domain. Librería: `nestjs-cls` con su plugin transaccional y el adaptador oficial para Prisma (ADR-0033, ADR-0093).
  - Application delimita la transacción con el puerto `TransactionManager` del shared kernel (`run(work)`): confirma si `work` termina bien y revierte si falla.
  - Los repositorios usan `TransactionHost<PrismaTransactionAdapter>` y su propiedad `tx`: dentro de una transacción es el cliente de esa transacción; fuera, el `PrismaService` normal. Nunca reciben la transacción como parámetro.
  - Un `run` dentro de otro se une a la transacción externa; no hay savepoints.
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
- Solo se cachean lecturas públicas del catálogo: árbol de categorías, detalle de producto y listados de la tienda sin texto de búsqueda (ADR-0060).
- TTL de 120 segundos, configurable.
- Invalidación inmediata por `ProductPublished`, `ProductArchived` y `VariantDiscontinued`; el resto, por TTL.

## Jobs programados

- Expiración de reservas y de órdenes impagas.
- Conciliación de pagos.
- Limpieza diaria y archivo de la auditoría.

Mecanismo: `@nestjs/schedule` dentro del proceso de la API (ADR-0029). Los jobs llaman casos de uso, no se superponen, procesan por lotes con una transacción por elemento y son idempotentes.

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
| Almacenamiento de imágenes | Disco del servidor detrás de un puerto; CDN a futuro (ADR-0024) |
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

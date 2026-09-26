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

## Estructura propuesta

Cada bounded context es un módulo de NestJS con cuatro capas:

| Capa | Contiene | Puede depender de |
|---|---|---|
| `domain` | Aggregates, entidades, Value Objects, domain events, domain services, interfaces de repositories | Solo shared kernel. Nunca NestJS ni Prisma |
| `application` | Casos de uso, puertos hacia servicios externos y hacia otros contextos, fachada pública del módulo | `domain` |
| `infrastructure` | Implementaciones de repositories con Prisma, mapeadores, adaptadores (pagos, paqueterías, almacenamiento), consultas de lectura | `application`, `domain`, Prisma |
| `presentation` | Controladores REST, DTOs HTTP, validación de entrada, guards de permisos, decoradores de Swagger | `application` |

La estructura concreta de carpetas se definirá en la tarea T-101.

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
- Shared kernel mínimo: `Money`, tipos de ID, error de dominio base, forma de domain event.

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
- Las transacciones se propagan a los repositorios mediante un contexto transaccional (AsyncLocalStorage), sin exponer Prisma a Application ni Domain. Librería: `nestjs-cls` con su plugin transaccional para Prisma (ADR-0033).
- Bloqueo optimista con columna `version` en los aggregates editables; la lista está en `DATABASE.md` (sección 12).
- Reserva de inventario con actualización condicional atómica y restricción `CHECK` (ADR-0011).
- Idempotencia con encabezado `Idempotency-Key` en PlaceOrder e InitiatePayment.
- Nivel de aislamiento: Read Committed (predeterminado de PostgreSQL).

## Eventos de dominio

- Despacho en proceso después del commit, sin outbox (ADR-0014).
- Handlers idempotentes.
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

En local (ADR-0032): logs en consola con nivel configurable por variable de entorno, declarada en `.env.example`.

Métricas, trazas y seguimiento de errores: PENDIENTE DE DECISIÓN hasta elegir hosting (P-07).

Requisitos mínimos ya identificados:

- Registrar cada fallo o interrupción de handlers de eventos (ADR-0014).
- No registrar datos sensibles (ver `SECURITY.md`).
- Identificador de correlación por solicitud HTTP en todos sus logs (ADR-0033).

## Reloj

Las reglas dependientes del tiempo (precios programados, expiraciones) usan un puerto `Clock` inyectado para poder probarse.

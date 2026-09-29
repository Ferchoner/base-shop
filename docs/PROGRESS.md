# PROJECT PROGRESS

## Current Phase

Sprint 2 — Identity & Access (desde el 2026-09-28). El Sprint 1 (Fundaciones técnicas) se cerró el 2026-09-28 con el objetivo cumplido; su review está en el historial de `SPRINT.md`.

## Completed

- [x] Starter documentation created
- [x] Prompt workflow created
- [x] Stack principal aprobado (ADR-0002)
- [x] Estilo arquitectónico aprobado: monolito modular con DDD pragmático (ADR-0003)
- [x] Modelo de dominio propuesto (`DOMAIN_MODEL.md`)
- [x] Decisiones de negocio principales cerradas (ADR-0006 a ADR-0018)
- [x] Documentación base actualizada con las decisiones
- [x] Aprobación formal de arquitectura, integración y checkout (ADR-0004, ADR-0005, ADR-0009, ADR-0019) — T-003
- [x] Acceso de invitados a su pedido (ADR-0020)
- [x] Cancelación de órdenes (ADR-0021)
- [x] Autenticación: Passport, JWT, refresh tokens y Argon2id (ADR-0022, ADR-0023)
- [x] Almacenamiento de imágenes en disco, preparado para CDN (ADR-0024)
- [x] Node.js 24, PostgreSQL 18 y npm (ADR-0025)
- [x] País de operación México y moneda MXN (ADR-0026)
- [x] IVA del 16% para todo y sin facturación electrónica (ADR-0027)
- [x] Cache con `@nestjs/cache-manager` en memoria, TTL de 120 s (ADR-0028)
- [x] Jobs con `@nestjs/schedule`: expiración, conciliación y limpieza (ADR-0029)
- [x] CI con GitHub Actions, rama principal protegida y GitHub Flow (ADR-0030)
- [x] Hosting solo local por ahora (ADR-0031)
- [x] Configuración, secretos y logs locales con `.env` y `.env.example` (ADR-0032)
- [x] Prisma Migrate, `nestjs-cls`, tests con PostgreSQL real e identificador de correlación (ADR-0033)
- [x] Versionado de la API con prefijo `/v1` (ADR-0034)
- [x] Formato de errores RFC 9457 (ADR-0035)
- [x] Paginación, ordenamiento, filtros y grupos de rutas (ADR-0036)
- [x] Auditoría técnica con archivo y eliminación lógica por estados de negocio (ADR-0037, ADR-0038)
- [x] Una sola lista de precios en el MVP (ADR-0039)
- [x] Pago manual para pruebas y PayPal semiimplementado (ADR-0040)
- [x] Envíos manuales (ADR-0041)
- [x] Costo de envío fijo con envío gratis por monto (ADR-0042)
- [x] Permisos, roles y cuentas del staff (ADR-0043)
- [x] Email verificado para clientes registrados; invitados exentos (ADR-0044)
- [x] Capturador de correos local para desarrollo (ADR-0045)
- [x] Mecanismo de verificación de email (ADR-0046)
- [x] Política de contraseñas de 15 a 64 caracteres con lista de contraseñas comunes (ADR-0047)
- [x] Autenticación preparada para 2FA (ADR-0048)
- [x] Identificadores de la orden: consecutivo interno y código público (ADR-0049)
- [x] Estados del envío (ADR-0050)
- [x] Cancelación y reembolso de órdenes pagadas (ADR-0051)
- [x] Reintegro de stock independiente, opcional al cancelar o al reembolsar (ADR-0052)
- [x] Entrega fallida y devolución manual (ADR-0053)
- [x] Restauración del carrito al expirar una orden (ADR-0054)
- [x] Pago manual en tienda y recompra de órdenes canceladas (ADR-0055)
- [x] Recuperación de contraseña y URL base del frontend para enlaces (ADR-0056)
- [x] Datos del cliente y formato de dirección con catálogo del INEGI (ADR-0057)
- [x] Peso y dimensiones de variantes opcionales (ADR-0058)
- [x] Fusión explícita de carritos y `cartId` aleatorio (ADR-0059)
- [x] Búsqueda y filtros del catálogo público (ADR-0060)
- [x] Disponibilidad pública como disponible/agotado (ADR-0061)
- [x] Mensajes de login y registro (ADR-0062)
- [x] Comportamiento de `Idempotency-Key` (ADR-0063)
- [x] Códigos HTTP, tipos de error y rate limiting (ADR-0064, ADR-0065)
- [x] Modelo de datos en `DATABASE.md` aprobado (ADR-0066, T-004, 2026-09-25)
- [x] Datos personales: aviso de privacidad, ARCO y anonimización (ADR-0067)
- [x] Edición de variantes (ADR-0068)
- [x] Motivos de movimientos de stock (ADR-0069)
- [x] Ciclo de conservación de datos personales diseñado, fuera del MVP (ADR-0070)
- [x] Contratos REST en `API_SPEC.md` aprobados (ADR-0071, T-005, 2026-09-25)
- [x] Sesiones al cambiar la contraseña y slugs de categorías y marcas (ADR-0072)
- [x] Especificación técnica en `REQUIREMENTS.md` con casos de uso, estados, permisos, errores y requisitos no funcionales (T-002 aprobada, 2026-09-26)
- [x] oxlint como herramienta de lint (ADR-0073)
- [x] Código alineado con el stack decidido: `docs/` y `CLAUDE.md` versionados; Yarn eliminado (solo npm, ADR-0025); Vitest reemplazado por Jest (ADR-0002); eliminados los módulos generados `product/` y `cart/` y `@nestjs/observe` (ADR-0032, P-07)
- [x] Notificaciones por correo del ciclo de la orden (ADR-0074)
- [x] Permiso para configurar el costo de envío (ADR-0075)
- [x] Reactivación de entidades suspendidas, archivadas o desactivadas (ADR-0076)
- [x] Enlace de acceso al pedido fuera del MVP (ADR-0077)
- [x] Entrega propia sin paquetería; recoger en tienda fuera del MVP (ADR-0078)
- [x] IVA incluido en el costo de envío y umbral de envío gratis sobre el subtotal con IVA (ADR-0079)
- [x] Contradicciones y ambigüedades de la especificación resueltas (T-006)
- [x] Revisión integral de la documentación (2026-09-26): contradicciones corregidas y nuevas decisiones ADR-0080 (categorías y marcas inactivas), ADR-0081 (un solo almacén en el MVP) y ADR-0082 (recompra sin carrito original)
- [x] Plazo de entrega estimado en días hábiles, configurable (ADR-0083)
- [x] Formato con Prettier; ramas, commits y pull requests en inglés con Conventional Commits (ADR-0084)
- [x] CORS con lista de orígenes por variable de entorno, sin comodín ni credenciales (ADR-0085)
- [x] Encabezados de seguridad de las respuestas con `helmet` y configuración explícita; HSTS a cargo del proxy (ADR-0086)
- [x] T-100: configuración validada al arrancar con `@nestjs/config` y class-validator (ADR-0087), `.env.example`, CORS (ADR-0085) y encabezados de seguridad (ADR-0086)
- [x] T-101: estructura de carpetas (`platform`, `shared-kernel`, `modules/<contexto>` con cuatro capas) y convenciones de nombres (ADR-0088)
- [x] T-104: lint con `npm run lint` (oxlint) y formato con `npm run format` y `npm run format:check` (Prettier); su ejecución en la CI es parte de T-106
- [x] T-102: `docker compose` con PostgreSQL 18, Mailpit y la API en modo desarrollo; `Dockerfile` con etapas `development` y `production` (ADR-0089)
- [x] T-105: tests unitarios, de integración contra PostgreSQL 18 real con Testcontainers (`npm run test:int`) y end-to-end (ADR-0090)
- [x] T-110: Prisma 7 con esquema dividido por contexto y primera migración con el modelo aprobado completo, aplicable desde cero y sin diferencias con el esquema (ADR-0091)
- [x] Valores iniciales provisionales del método de envío: "Envío Estándar", $99.00 y envío gratis desde $1,500.00 (ADR-0092)
- [x] T-111: contexto transaccional con `nestjs-cls` y el adaptador oficial de Prisma; puerto `TransactionManager` para Application; rollback, anidamiento, concurrencia y límite de 5 s probados contra PostgreSQL real (ADR-0093)
- [x] T-112: shared kernel con `Money` (incluido el IVA contenido con redondeo de mitades hacia arriba), identificadores UUIDv7 y UUIDv4 con marca de tipo, `DomainError` con cuatro categorías, forma de los domain events y puerto `Clock` (ADR-0094)
- [x] T-113: errores como Problem Details con catálogo de 36 tipos en español, validación global de entrada con mensajes en español, identificador de correlación generado por el servidor en todas las respuestas, 415 para cuerpos que no son JSON ni multipart, y sin stack traces en ninguna respuesta (ADR-0095)
- [x] T-114: rutas bajo `/v1` con el versionado por ruta de NestJS; Swagger UI y documento OpenAPI de `v1` en `/docs/v1` solo con `NODE_ENV=development`, con CSP propia; DTOs documentados por el plugin de Swagger; esquema `ProblemDetails` y decorador `@ApiProblemResponses` (ADR-0096)
- [x] T-118: logs con `AppLogger` (texto en desarrollo, JSON en producción), nivel por `LOG_LEVEL`, identificador de correlación en cada log de una solicitud, línea por solicitud y redacción de correos, JWT y tokens `Bearer` (ADR-0097)
- [x] T-116: bus de eventos en proceso con despacho en segundo plano después del commit, handlers `@OnDomainEvent` aislados entre sí y fallos en el log; lista de efectos en segundo plano en `API_SPEC.md` (sección 2.5) (ADR-0098)
- [x] T-115: idempotencia HTTP con `@Idempotent` y registro atómico de la llave; repetición de éxitos y errores de negocio, 422 con contenido distinto, 409 en proceso y llaves abandonadas a los 60 segundos (ADR-0099)
- [x] T-127: registro de auditoría con el puerto `AuditTrail` (en la transacción del cambio o por separado), actor, IP, agente y correlación tomados de la solicitud, cambios sin valores personales ni sensibles y 403 de `/v1/admin` auditados automáticamente (ADR-0100)
- [x] T-117: scheduler con `@nestjs/schedule` y decorador `@ScheduledJob` (sin superposición, fallos en el log, contexto con identificador, hora de México), `JOBS_ENABLED` y espera de las ejecuciones en curso al cerrar (ADR-0101)
- [x] T-126: rate limiting con `@nestjs/throttler` y `@RateLimit`, límites de ADR-0065 por variables `RATE_LIMIT_*`, intentos fallidos de login con `FailedAttemptLimiter`, webhooks excluidos y 429 con `Retry-After` (ADR-0102)
- [x] T-103: verificación de límites entre módulos y capas con `dependency-cruiser` en `npm run lint`, con un proyecto de ejemplo que prueba cada regla (ADR-0103)
- [x] T-119: cache en memoria con espacios de nombres (`AppCache`), TTL por `CACHE_TTL_SECONDS` e invalidación del catálogo público por eventos de Catalog (ADR-0104)
- [x] T-106: CI en GitHub Actions con los 10 pasos de ADR-0030 en un job (`Pipeline`), detección de secretos con gitleaks y comprobación de los mensajes de commit en los pull requests (`Commit messages`) (ADR-0105)
- [x] T-107: `main` protegida con un ruleset (pull request, checks `Pipeline` y `Commit messages`, rama al día, sin excepciones), Dependabot semanal para npm y GitHub Actions con grupos y 7 días de espera, alertas y actualizaciones de seguridad activadas (ADR-0106)
- [x] TypeScript se mantiene en 6.x: la versión 7 no expone la API de compilador que usan ts-jest, la CLI de Nest y el plugin de Swagger; Dependabot ignora sus versiones mayores (ADR-0107)
- [x] Scripts de instalación de las dependencias negados con `allowScripts` y modo estricto de npm en local, CI y Docker, sin telemetría de `@scarf/scarf` (ADR-0108)
- [x] T-124: catálogo geográfico del INEGI en el módulo transversal `geo`: importación idempotente con `npm run geo:import` (valida el archivo completo, desactiva sin borrar, audita), catálogo versionado en `data/inegi/`, consulta pública de estados y municipios con cache, y fachada para direcciones y checkout (ADR-0109)
- [x] T-122: puertos `EmailSender` y `FrontendLinks` en el shared kernel, adaptador SMTP con nodemailer hacia Mailpit, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` y `FRONTEND_BASE_URL` obligatorias en producción, y tests contra Mailpit real (ADR-0110)
- [x] T-130 (parte a): catálogo de permisos en el shared kernel, autorización con `@RequirePermissions` y `@RequireAccount` (falla cerrado), paginación de ADR-0036, agregados `User` y `Role` con bloqueo optimista, roles iniciales por migración y `permissionsOf` para T-120 (ADR-0111). La anonimización pasa a T-132 y la reactivación del staff a T-131
- [x] T-130 (parte b): catálogo de permisos, CRUD de roles, roles y suspensión del staff, y listado, detalle, suspensión y reactivación de clientes; motivo en `audit_logs.reason`; nunca sin superadministrador activo, con bloqueo y test de concurrencia; ordenamiento por varios campos y `Cache-Control: no-store` (ADR-0112)
- [x] T-130 (parte c) y T-130 terminada: libreta de direcciones del cliente en `/v1/me/addresses`, con máximo configurable (`MAX_ADDRESSES_PER_CUSTOMER`) y una sola predeterminada bajo bloqueo; validación con el catálogo geográfico a través de un puerto y un adaptador hacia `geo` (ADR-0113)
- [x] T-120 (parte a): login, renovación con rotación y detección de reutilización, cierre de sesión y `GET /v1/me`; cada solicitud autenticada comprueba la cuenta y la sesión, así que suspender o cerrar sesión corta el token de acceso de inmediato; Argon2id de `node:crypto`; autenticación antes del rate limiting y de la autorización (ADR-0114)
- [x] T-120 (parte b) y T-120 terminada: política de contraseñas de ADR-0047 (longitud tras NFKC, caracteres imprimibles y 5,328 contraseñas comunes de SecLists en `data/passwords/`) y `POST /v1/me/password`, que conserva la sesión actual, revoca las demás y avisa por correo (ADR-0115)
- [x] T-131: alta y reactivación del staff por la API con contraseña temporal mostrada una sola vez, y script del primer superadministrador que se niega si ya hay uno activo, con bloqueo y test de concurrencia (ADR-0116)
- [x] T-121: registro de clientes, verificación de email con enlace de un solo uso (`/verify-email?token=…`, `EMAIL_VERIFICATION_TTL`), reenvío que no revela si el email existe, cambio de email con contraseña y aviso al anterior, y `PATCH /v1/me` (ADR-0117)
- [x] T-123: recuperación de contraseña con enlace de un solo uso (`/reset-password?token=…`, `PASSWORD_RESET_TTL`), que revoca todas las sesiones, quita la contraseña temporal pendiente, verifica el email y avisa por correo; el cambio de email invalida los enlaces pendientes (ADR-0118)

## In Progress

- [ ] Sprint 2: Identity & Access (T-124, T-122, T-130, T-120, T-131, T-121 y T-123); plan en `SPRINT.md`

## Next

- [ ] Contextos de negocio restantes (Catalog, Pricing, Inventory, Shopping, Ordering, Payments y Shipping), después del Sprint 2

## Blocked

- T-191 verificación de PayPal por P-31 y por falta de cuenta y sandbox
- T-330 deployment (pospuesta, ADR-0031)

## Pending Decisions

### Stack e infraestructura

| ID | Decisión | Bloquea |
|---|---|---|
| P-05 | CD: entornos, disparador, registro de imágenes, migraciones en el despliegue, reversión. Pospuesta hasta tener hosting. Opciones para las migraciones analizadas en `DATABASE.md`, sección 13 | T-330 |
| P-06 | Hosting para entorno compartido o producción (hoy solo local, ADR-0031); incluye HSTS, TLS y redirección a HTTPS (ADR-0086) | T-330 |
| P-07 | Métricas, trazas y seguimiento de errores (logs locales ya decididos, ADR-0032) | — |
| P-13 | Almacén de secretos en el servidor (local ya decidido, ADR-0032) | — |
| P-31 | Pruebas de webhooks de pago: herramienta de túnel y procedimiento por proveedor | T-191 |

### API

Ninguna pendiente.

### Negocio

| ID | Decisión | Bloquea |
|---|---|---|
| P-24 | Proveedor real de correos; en desarrollo se usa un capturador local (ADR-0045). Se decide con el hosting | — |
| P-69 | Antes de operar con clientes reales: validación con el contador del IVA del costo de envío (ADR-0079) y del modo de redondeo del IVA (ADR-0094), y confirmación por el administrador de los valores de envío con costos reales de paquetería (ADR-0092) | — |

### Arquitectura, datos y seguridad

| ID | Decisión | Bloquea |
|---|---|---|
| P-14 | Objetivos no funcionales cuantitativos | — |
| P-61 | Validación legal con especialista: valores de los plazos de fase operativa y bloqueo, y las preguntas de ADR-0070 (incluidas retención de auditoría y cuentas inactivas); además, la presentación del plazo de entrega estimado (ADR-0083) | T-232 |

### Contradicciones y ambigüedades de la especificación

Detectadas al convertir los requisitos en especificación técnica (`REQUIREMENTS.md`, sección 10).

Ninguna pendiente.

### Decisiones cerradas

| ID | Decisión | Resolución |
|---|---|---|
| P-01, P-28 | Autenticación, duración y reutilización de refresh tokens | ADR-0022, ADR-0023 |
| P-02, P-29 | Almacenamiento de imágenes, formatos y tamaño | ADR-0024 |
| P-03 | Cache | ADR-0028 |
| P-04 | Jobs programados | ADR-0029 |
| P-08 | Versionado de la API | ADR-0034 |
| P-09 | Formato de errores | ADR-0035 |
| P-10, P-30 | País, moneda, IVA y facturación | ADR-0026, ADR-0027 |
| P-11 | Envíos y costo de envío | ADR-0041, ADR-0042 |
| P-12 | Pagos | ADR-0040 |
| P-15 | Permisos, roles y cuentas del staff | ADR-0043 |
| P-16 | Aprobación del mapa de contextos y de la integración entre contextos | Aprobación formal del equipo (2026-09-24): ADR-0004 y ADR-0005 aceptados |
| P-17 | Aprobación del protocolo de checkout y de la lista de estados de la orden | Aprobación formal del equipo (2026-09-24): ADR-0019 y ADR-0009 aceptados |
| P-18 | Auditoría técnica y eliminación lógica | ADR-0037, ADR-0038 |
| P-20 | Versiones de Node.js, PostgreSQL y gestor de paquetes | ADR-0025 |
| P-21 | Cancelación de órdenes | ADR-0021 |
| P-22 | Acceso de invitados a su pedido | ADR-0020 |
| P-23, P-32 | Verificación de email | ADR-0044, ADR-0046 |
| P-25 | Listas de precios | ADR-0039 |
| P-26 | Herramientas de persistencia, transacciones, tests y trazabilidad | ADR-0033 |
| P-27 | Paginación, filtros y grupos de rutas | ADR-0036 |
| P-33 | Política de contraseñas | ADR-0047 |
| P-34 | Estados del envío | ADR-0050 |
| P-35 | Identificadores de la orden | ADR-0049 |
| P-36, P-37 | Cancelación y reembolso | ADR-0051 |
| P-38 | Reintegro de stock | ADR-0052 |
| P-39 | Entrega fallida y devolución | ADR-0053 |
| P-40 | Carrito al expirar una orden | ADR-0054 |
| P-41 | Pago manual en tienda | ADR-0055 |
| P-42 | Recuperación de contraseña | ADR-0056 |
| P-43 | Datos del cliente y dirección | ADR-0057 |
| P-44 | Fusión de carritos | ADR-0059 |
| P-46 | Disponibilidad pública | ADR-0061 |
| P-47 | Búsqueda y filtros del catálogo | ADR-0060 |
| P-52 | `Idempotency-Key` | ADR-0063 |
| P-53 | Códigos HTTP, tipos de error y rate limiting | ADR-0064, ADR-0065 |
| P-54, P-55 | Mensajes de login y registro | ADR-0062 |
| P-19, P-60 | Datos personales y canal de eliminación de cuenta | ADR-0067 |
| P-50 | Edición de variantes | ADR-0068 |
| P-51 | Motivos de movimientos de stock | ADR-0069 |
| P-59 | Peso y dimensiones | ADR-0058 |
| P-62, P-63 | Sesiones al cambiar la contraseña; slugs de categorías y marcas | ADR-0072 |
| P-45 | Notificaciones por correo | ADR-0074 |
| P-48 | Permiso para configurar el costo de envío | ADR-0075 |
| P-49 | Reactivación de entidades suspendidas, archivadas o desactivadas | ADR-0076 |
| P-56 | Enlace de acceso al pedido por correo (fuera del MVP) | ADR-0077 |
| P-57 | Envíos sin paquetería | ADR-0078 |
| P-58 | IVA del envío y base del umbral de envío gratis | ADR-0079 |
| P-66 | Efecto de desactivar categorías y marcas en la tienda | ADR-0080 |
| P-64 | Plazo de entrega estimado | ADR-0083 |
| P-65 | CORS | ADR-0085 |
| P-71 | Encabezados de seguridad de las respuestas HTTP | ADR-0086 |
| P-70 | Formato de código, ramas y mensajes de commit | ADR-0084 |
| P-67 | Un solo almacén en el MVP | ADR-0081 |
| P-68 | Recompra del staff sin carrito original | ADR-0082 |
| P-72 | Valores iniciales del método de envío | ADR-0092 |

## Notas

- La carpeta `prompts/` existe solo en local (está en `.gitignore`) y está desactualizada: por ejemplo, `03-base-datos.md` pide la tabla `promotions`, fuera del MVP. Por decisión del equipo, se trabaja sin ella por ahora. La tarea "Run Prompt 00" queda en pausa.
- Mejora pendiente a mediano o largo plazo: segundo factor (2FA), con el diseño preparado (ADR-0043, ADR-0048).

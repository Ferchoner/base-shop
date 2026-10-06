# PROJECT PROGRESS

## Current Phase

MVP cerrado el 2026-10-04 (ADR-0158) y publicado como la versión 1.0.0; el desarrollo sigue por versiones (ADR-0159). La versión 1.1.0, varios almacenes propios (ADR-0160, T-162), se cerró el 2026-10-06 con el objetivo cumplido; su review está en el historial de `SPRINT.md`. No hay sprint ni versión en curso: lo que queda fuera del MVP espera a que una entidad quiera usar el proyecto, y cada versión nueva necesita un plan aprobado.

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
- [x] Paso 0 del Sprint 3: revisión contra los ADR sin contradicciones; `brace-expansion` y `fast-uri` actualizados por avisos de seguridad (solo `package-lock.json`); `npm run secrets:scan` revisa con gitleaks los cambios preparados y todo el historial, antes de cada commit y en la CI, con la imagen fijada solo en `package.json` (ADR-0119)
- [x] T-150: árbol público de categorías con cache, administración de categorías y marcas (crear, editar, mover, desactivar, reactivar y borrar), slugs generados del nombre y numerados si ya existen, movimientos sin ciclos con un bloqueo advisory y test de concurrencia; `GET /v1/catalog/brands` y el recálculo del `search_vector` pasan a T-140 (ADR-0120)
- [x] T-141: almacenamiento de imágenes de producto en disco detrás de un puerto (`ProductImageStorage`), formato reconocido por los primeros bytes, subida con multer cortada en `IMAGE_MAX_BYTES`, `IMAGE_STORAGE_DIR` e `IMAGE_BASE_URL`, e imágenes servidas en `/media` con cache inmutable; categorías de error `too-large` y `unsupported` en el shared kernel (ADR-0121)
- [x] T-196: método de envío con `GET` y `PUT /v1/admin/shipping/method` (bloqueo optimista, auditoría y límites), cálculo del costo con IVA incluido y envío gratis por monto (`ShippingRateCalculator`), `ShippingFacade.quote` para el checkout, tasa de IVA en `VAT_RATE_BP` y "Envío Estándar" creado por migración con los valores de ADR-0092 (ADR-0122)
- [x] T-140 (parte a): productos y variantes para el staff (crear, editar, publicar, archivar, reactivar; agregar, editar, descontinuar y reactivar variantes) con bloqueo optimista, `field-locked` tras la primera publicación, slugs numerados, nombres de opción en minúsculas, `search_vector` recalculado en la misma transacción (también desde categorías y marcas) y eventos que vacían la cache pública; las partes b (imágenes) y c (tienda) siguen (ADR-0123)
- [x] T-140 (parte b): imágenes de producto (subir, editar, reordenar y borrar) sobre la base de T-141, en una galería propia sin `version`, con hasta 20 imágenes, posiciones consecutivas, bloqueo de la fila del producto para subidas simultáneas, archivo y fila siempre juntos, y 413 con `maxBytes` (ADR-0124)
- [x] T-145 (parte a): lista predeterminada creada por migración, precios desde ahora y programados en una línea de periodos sin huecos (consultar, fijar, programar y cancelar), bloqueo de la fila de la variante para cambios simultáneos, `PricingFacade.quote` para la tienda, el carrito y el checkout, y `CatalogFacade.variants`; la carga masiva queda para la parte b (ADR-0125)
- [x] T-145 (parte b): carga masiva de precios en CSV (montos en pesos, fechas en hora de México o ISO con zona), todo o nada con los errores por línea, simulación con `dryRun`, archivo repetido sin cambios, hasta 5,000 filas procesadas en bloque en una transacción, y lector CSV compartido en `platform/files` (ADR-0126)
- [x] T-160 (parte a): almacén creado por migración y editable (nombre y dirección validada con el catálogo del INEGI), entradas y ajustes con motivo en un `UPDATE` atómico y su movimiento, listado de stock completado con la fachada de Catalog (sin copiar SKU ni título) y movimientos con paginación por cursor; las reservas quedan para la parte b (ADR-0127)
- [x] T-160 (parte b): `InventoryFacade` para el carrito y el checkout: `canFulfill` sin revelar cantidades, reservas todo o nada e idempotentes por orden, confirmación con movimientos SALE y liberación, cada una una sola vez; TTL en `RESERVATION_TTL`; pruebas de concurrencia contra PostgreSQL (ADR-0128)
- [x] T-140 (parte c) y T-140 terminada: tienda pública (listado con búsqueda en español por inicio de palabra, filtros por categoría, marcas, precio y disponibilidad, seis órdenes y totales exactos; detalle por slug; marcas públicas), calculada en una sola consulta con precios y stock; `storeVisibility` en la administración con la misma definición de vendible; un test que verifica qué tablas usa cada módulo; cache acotada a 1 000 valores por espacio (ADR-0129)
- [x] T-170: carrito de invitado (`cartId` aleatorio) y del cliente, con precios, vendibilidad y disponibilidad calculados al leer; cada cambio bloquea el carrito, el del cliente se crea o se adopta bajo un bloqueo advisory, y la fusión suma con tope de 30 y es idempotente; hasta 100 variantes por carrito; pruebas de concurrencia (ADR-0131)
- [x] T-180 (parte a): cotización y colocación de la orden de invitados y clientes (bloqueo del carrito, reserva todo o nada, snapshots, código público aleatorio y `Idempotency-Key`), y consulta de mis pedidos; Ordering usa siete fachadas sin ciclos, y P-73 queda resuelta; la parte b (administración, cancelación y pago) sigue (ADR-0132)
- [x] T-180 (parte b) y T-180 terminada: consulta de órdenes para el staff (búsqueda, filtros y historial), cancelación de órdenes sin pago con su reserva liberada, reintento del surtido, y el pago capturado con el flujo de pago tardío; reservas todo o nada dentro de una transacción mayor (`runNested`) y `orderCount` fuera del detalle de cliente; la cancelación de órdenes pagadas pasa a T-190 (ADR-0133)
- [x] T-190 (parte a): iniciar el pago de una orden con la acción de pagar en tienda, registrar el pago manual (detrás de `MANUAL_PAYMENTS_ENABLED`) que publica `PaymentCaptured`, consulta de pagos del staff y el pago en las vistas de la orden; Ordering usa a Payments, y Payments solo le avisa con eventos; la parte b (reembolsos) sigue (ADR-0134)
- [x] T-190 (parte b) y T-190 terminada: cancelar órdenes pagadas inicia su reembolso total en la misma operación, y cancelar una sin pagar cancela su pago pendiente; el pago que llega después de cancelar también inicia el reembolso; registrar el reembolso manual (auditado, con bloqueo y `version`) publica `RefundCompleted` y la orden pasa a REFUNDED; el reintegro responde 409 hasta T-161 (ADR-0135)
- [x] T-230: un job cada minuto vence, por lotes de 100 y una transacción por orden, las órdenes impagas con el pago vencido junto con su reserva, y publica `OrderExpired` para T-181; el pago iniciado se conserva para un pago tardío (ADR-0136)
- [x] T-181 (parte a): Shopping escucha `OrderExpired` y devuelve las líneas de la orden vencida: el invitado, o el cliente sin carrito activo, recupera el carrito de la orden activo otra vez, y el cliente con carrito activo recibe en él las líneas con tope de 30; una sola vez, por el estado del carrito de origen; la recompra (parte b) sigue después de T-185 (ADR-0137)
- [x] T-185: consulta de pedido de invitado en `POST /v1/orders/lookup` con email y código público, en una sola consulta y con el mismo 404 para todo fallo, 10 por IP en 15 minutos; el staff puede consultar, pero no comprar ni pagar como invitado (ADR-0138)
- [x] T-181 (parte b) y T-181 terminada: recompra de órdenes canceladas o reembolsadas por el cliente, el invitado (con la identificación de T-185 y su límite) y el staff (auditada); solo se copian las variantes que se siguen vendiendo, con tope de 30; las rutas responden el `cartId`; el staff copia la orden de un invitado a su carrito original (ADR-0139)
- [x] Paso 0 del Sprint 6: revisión contra los ADR sin contradicciones; el documento OpenAPI se construye y se revisa en todo entorno salvo producción, así que un DTO que lo rompe falla en cualquier suite e2e (ADR-0096); prácticas de la review del Sprint 5 en la guía de desarrollo
- [x] T-132: anonimización de clientes y de compradores invitados desde el nuevo módulo `privacy`, en una transacción: la cuenta, sus sesiones, enlaces, direcciones y carritos; el contacto y la dirección de las órdenes y sus envíos; y las respuestas guardadas por idempotencia. Espera a que las órdenes concluyan (una SHIPPED con su envío devuelto concluye; una cancelada con pago espera su reembolso), y el checkout del mismo cliente y la anonimización se esperan. La del cliente responde `{ userId, anonymizedAt, anonymizedOrderCount }` (ADR-0145)
- [x] Paso 3 del Sprint 6: la imagen de producción pasa de 924 MB a 557 MB sin el CLI de Prisma, que vuelve a desarrollo; una imagen `migrate` aplica las migraciones antes de cada despliegue, y la CI migra un PostgreSQL 18 con ella y arranca la de producción contra él (ADR-0147)
- [x] T-220: consulta de la auditoría con `audit.read`, paginada por cursor y con filtros por actor, acción o prefijo, recurso, resultado y fechas; el job diario `audit.archive` exporta cada día UTC de más de 3 meses a un archivo JSON Lines con gzip en una carpeta privada, lo relee y compara cada ID antes de borrar exactamente esos registros, nunca sobrescribe un archivo y borra los de más de 2 años; retenciones configurables (ADR-0146)
- [x] T-186 (paso 4 del Sprint 6, a pedido del usuario): enlace de acceso a los pedidos de invitado. Se pide con el email solo y responde 202 igual, antes de emitir el enlace, que se envía en segundo plano solo si el email tiene órdenes de invitado; abre una vez las 50 más recientes. Tabla `order_access_tokens`, bloqueo advisory del email con la anonimización, limpieza diaria y límites de 3 por email y 10 por IP por hora (ADR-0148)
- [x] T-109 parte a: outbox transaccional. Los eventos se guardan con el cambio, con una entrega por handler; el despacho después del commit sigue igual, y el job `platform.deliver-events` reintenta cada minuto lo que falló o no corrió, hasta 8 intentos. `OrderAccessRequested` es volátil y los correos de la orden se reintentan (ADR-0150)
- [x] Paso 0 del Sprint 8: revisión contra los ADR extendida a `PROJECT.md` y `README.md`, con la tabla del stack corregida (imagen `migrate`, ADR-0150 y conciliación pendiente); prácticas de la review del Sprint 7 en la guía de desarrollo
- [x] T-109 parte b: el staff consulta y reintenta las entregas fallidas en `/v1/admin/event-deliveries`, una o en bloque, con el permiso nuevo `events.manage`, y la limpieza diaria `platform.cleanup-events` borra los eventos entregados hace más de 7 días (ADR-0150)
- [x] T-232 parte a: la orden guarda cuándo concluyó, y el job diario `ordering.retention` bloquea sus datos personales a los 12 meses y los anonimiza a los 72, con sus envíos; una orden bloqueada desaparece de las vistas del comprador y el staff la ve sin su email ni su dirección exacta; los plazos de la limpieza diaria son configurables (ADR-0151)
- [x] T-232 parte b: el staff con el permiso nuevo `orders.read-blocked` consulta los datos de una orden bloqueada, con un motivo y auditado; las cuentas de clientes inactivos se anonimizan si el operador configura el plazo, sin sus órdenes; `GET /v1/privacy/retention-policy` publica los plazos vigentes (ADR-0152). T-232 en DONE
- [x] Paso 0 del Sprint 9: revisión contra los ADR, con `PROJECT.md` y `README.md`, sin desajustes; la descripción del listado de pedidos del staff corregida; prácticas de la review del Sprint 8 en la guía de desarrollo
- [x] T-310 parte a: auditoría de seguridad contra el OWASP API Security Top 10, sin hallazgos críticos ni altos (`SECURITY_AUDIT.md`); la matriz de rutas comprueba en la CI cómo se protege cada una; 9 correcciones bajas (ADR-0153)
- [x] T-310 parte b: el límite general por IP cuenta en toda ruta; 5 órdenes de invitado por email por hora; el login ya no limita por email; nadie da roles ni permisos que no tiene; TLS y `https` obligatorios en producción; la recuperación y el reenvío envían el enlace en segundo plano; nombres y direcciones sin saltos ni enlaces en los correos (ADR-0154). T-310 en DONE
- [x] T-320 parte a: una prueba de contrato compara las tablas de `API_SPEC.md` y el documento OpenAPI con las rutas y la matriz de rutas, y `docs/openapi/v1.json` se comprueba en la CI; OpenAPI documenta otra vez los errores que perdía, como el 401 de `/v1/me/password` (ADR-0155)
- [x] Seguimiento de T-310: `npm run secrets:scan` corre gitleaks con `scripts/secrets-scan.ts`, que también lee el repositorio desde un worktree de git y falla si gitleaks no puede leerlo, en lugar de pasar con 0 commits revisados (ADR-0156)
- [x] T-320 parte b: toda operación, todo parámetro y cada campo que envía el cliente tienen descripción, comprobada en la CI; los IDs declaran su formato UUID, las descripciones en inglés pasan al español y los errores de cada ruta coinciden con `API_SPEC.md` (ADR-0155). T-320 en DONE
- [x] T-300: la cobertura de las tres suites se une y la CI exige 98% de sentencias, 84% de ramas, 99% de funciones y 99% de líneas; los dos rellenos de T-232 se prueban en una base migrada hasta antes de cada uno; cada línea sin cubrir se revisó y se probó si es lógica (ADR-0157). T-300 en DONE
- [x] P-61 cerrada (ADR-0149): plazos de conservación configurables con valores por defecto, y la validación legal como lista de cada operador antes de operar; T-232 deja de estar diferida
- [x] Paso 0 del Sprint 7: revisión contra los ADR, con el estado de ADR-0077 y los módulos transversales de `ARCHITECTURE.md` corregidos; prácticas de la review del Sprint 6 en la guía de desarrollo; T-109 agregada
- [x] Paso 0 del Sprint 5: revisión contra los ADR sin contradicciones; una migración quita el índice sin uso de `reservations` (ADR-0136); prácticas de la review del Sprint 4 en la guía de desarrollo
- [x] T-195 (parte a): la orden pagada nace con su envío PENDING en la misma transacción, desde el almacén activo y con el código de la orden y cada línea copiados; el staff lista y consulta los envíos y captura paquetería y guía (auditada, con bloqueo y `version`); cancelar una orden pagada cancela su envío (nuevo estado CANCELLED) o responde 409 si ya salió; las vistas de la orden muestran el envío; el despacho, la entrega, la entrega fallida y la devolución siguen en la parte b (ADR-0140)
- [x] T-195 (parte b) y T-195 terminada: el staff despacha por paquetería o como entrega propia, entrega, y registra la entrega fallida y la devolución con una nota opcional que el envío muestra; quita la guía capturada por error; la orden pasa a SHIPPED y DELIVERED en segundo plano con `ShipmentDispatched` y `ShipmentDelivered`, y una entrega que llega antes que el despacho la pasa por SHIPPED; despachar y cancelar a la vez se esperan (ADR-0141)
- [x] T-161: reintegro de stock de órdenes canceladas o reembolsadas y de envíos devueltos, línea por línea y con `Idempotency-Key`, sin pasar de lo vendido (que cuenta solo si el stock se confirmó); la cancelación de una orden pagada reintegra todo con `restock`; el registro del reembolso ya no reintegra; `AdminOrder` muestra el ID de cada línea (ADR-0142)
- [x] T-215: correos al cliente de orden recibida, pago confirmado, orden enviada, orden cancelada y reembolso completado, desde un módulo de notificaciones que escucha los eventos y lee la orden con la nueva fachada de Ordering; Ordering publica `OrderPlaced`, `OrderPaid` y `OrderCancelled`; sin correos a órdenes anonimizadas y sin reintentos (ADR-0143)
- [x] T-231: limpieza diaria a las 3:00, hora de México, con un job por dueño de cada tabla: tokens de Identity, carritos de invitado inactivos, eventos de webhooks y llaves de idempotencia; borra por lotes de 1,000 filas, y un carrito usado mientras corre no se borra (ADR-0144)
- [x] Paso 0 del Sprint 4: revisión contra los ADR sin contradicciones; el pipe de validación reporta primero la presencia y el tipo de cada campo, sin importar el orden de los decoradores (ADR-0130); límite general de 1000 por minuto en las e2e; prácticas de la review del Sprint 3 en las guías
- [x] Corrección tras el cierre del MVP (2026-10-05): con el `.env` de `.env.example`, la API no arrancaba en Docker (`JWT_SECRET` vacío llegaba como `''` a `ConfigService`) y `create-first-superadmin` fallaba por no incluir el módulo de eventos. `ConfigService` responde ahora solo con los valores validados (`skipProcessEnv`, opciones compartidas por la API y los scripts), lo que también evita que un `INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS` vacío se lea como 0 meses; el módulo del script incluye `EventsModule` y un test de integración lo arranca

## In Progress

- [x] Sprint 2: Identity & Access (T-124, T-122, T-130, T-120, T-131, T-121 y T-123), cerrado el 2026-09-29
- [x] Sprint 3: catálogo vendible (paso 0, T-150, T-141, T-196, T-140, T-145 y T-160), cerrado el 2026-10-01
- [x] Sprint 4: compra con pago en tienda (paso 0, T-170, T-180, T-190, T-230 sin la conciliación, T-185 y T-181), cerrado el 2026-10-02
- [x] Sprint 5: entrega del pedido (paso 0, T-195, T-161, T-215 y T-231), cerrado el 2026-10-02
- [x] Sprint 6: privacidad y operación (paso 0, T-132, T-220, reducir la imagen de producción y T-186), cerrado el 2026-10-03

## Next

- [x] Sprint 7: entrega garantizada de eventos (paso 0 y T-109 en dos partes, y P-61 cerrada), cerrado el 2026-10-03
- [x] Sprint 8: ciclo de conservación de datos personales (paso 0 y T-232 en dos partes), cerrado el 2026-10-03
- [x] Sprint 9: calidad antes de operar (paso 0, T-310 y T-320 en dos partes cada una, y T-300), cerrado el 2026-10-04
- [x] MVP cerrado el 2026-10-04 (ADR-0158)
- [x] Versión 1.0.0: el MVP con las correcciones del 2026-10-05; el desarrollo sigue por versiones (ADR-0159)
- [x] Versión 1.1.0: varios almacenes propios (paso 0 y T-162 en dos partes), cerrada el 2026-10-06; review en `SPRINT.md`
- [x] T-162 parte a: varios almacenes activos con prioridad; cada orden se reserva completa en el primero que la tiene toda y sale de él; la tienda suma los almacenes activos, y la cotización y el 409 marcan lo que le falta al almacén más cercano (ADR-0160)
- [x] T-162 parte b: el staff crea almacenes, edita su prioridad y los desactiva para siempre; el reintegro vuelve al almacén de origen o al que indique el staff; ajustes en almacenes inactivos con `WAREHOUSE_TRANSFER`; envíos filtrados por almacén (ADR-0160). T-162 en DONE

## Fuera del MVP

Hasta que una entidad quiera usar el proyecto (ADR-0158):

- T-192 PayPal, con la conciliación de pagos y el reintento de reembolsos fallidos, y T-191, su verificación en sandbox (P-31)
- T-193 Mercado Pago y Stripe, y T-200 promociones
- T-330 despliegue, cuando haya hosting (P-05, P-06)
- Las decisiones pendientes de abajo, que no bloquean nada de lo construido

## Blocked

Nada: lo que estaba bloqueado quedó fuera del MVP.

## Pending Decisions

Quedan abiertas fuera del MVP (ADR-0158): se deciden con la entidad que use el proyecto.

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
| P-24 | Proveedor real de correos; en desarrollo se usa un capturador local (ADR-0045). Se decide con el hosting. Debe ofrecer TLS, que producción exige, y con él se agrega la autenticación SMTP (ADR-0154) | — |
| P-69 | Antes de operar con clientes reales: validación con el contador del IVA del costo de envío (ADR-0079) y del modo de redondeo del IVA (ADR-0094), y confirmación por el administrador de los valores de envío con costos reales de paquetería (ADR-0092) | — |

### Arquitectura, datos y seguridad

| ID | Decisión | Bloquea |
|---|---|---|
| P-14 | Objetivos no funcionales cuantitativos | — |

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
| P-56 | Enlace de acceso al pedido por correo (fuera del MVP; implementado después en ADR-0148) | ADR-0077 |
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
| P-73 | Reintegro de stock sin ciclo entre Inventory y Ordering | ADR-0132 |
| P-61 | Plazos de conservación de datos personales: configurables con valores por defecto; la validación legal pasa a cada operador (`PROJECT.md`, "Antes de operar con clientes reales") | ADR-0149 |

## Notas

- La carpeta `prompts/` existe solo en local (está en `.gitignore`) y está desactualizada: por ejemplo, `03-base-datos.md` pide la tabla `promotions`, fuera del MVP. Por decisión del equipo, se trabaja sin ella por ahora. La tarea "Run Prompt 00" queda en pausa.
- Mejora pendiente a mediano o largo plazo: segundo factor (2FA), con el diseño preparado (ADR-0043, ADR-0048).

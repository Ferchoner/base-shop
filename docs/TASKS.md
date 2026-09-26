# TASKS

## Estados

- TODO
- IN_PROGRESS
- BLOCKED
- REVIEW
- DONE
- DEFERRED (fuera del MVP)

Las decisiones pendientes (P-xx) están en `PROGRESS.md`. Una tarea marcada BLOCKED indica qué decisión la bloquea. Una P-xx en la columna de dependencias de una tarea TODO afecta solo a una parte de la tarea. Los casos de uso (UC-xxx) están en `REQUIREMENTS.md`.

## Inicialización (Sprint 0)

| ID | Tarea | Estado | Depende de | Criterios de aceptación |
|---|---|---|---|---|
| T-001 | Definir stack | DONE (para entorno local) | — | Todas las filas de la tabla de stack en `PROJECT.md` tienen decisión y ADR |
| T-002 | Definir actores y alcance | REVIEW | T-006 | Especificación técnica en `REQUIREMENTS.md`: actores, módulos, estados, permisos, casos de uso con criterios de aceptación, flujos, errores, dependencias y requisitos no funcionales. Pasa a DONE cuando se aprueba y se resuelven P-34 a P-60 |
| T-003 | Aprobar arquitectura | DONE | — | ADR-0004, ADR-0005 y ADR-0019 en estado Aceptada |
| T-004 | Aprobar modelo de datos | DONE | T-003; aprobación de ADR-0066 | Esquema por contexto, diagrama ER, índices y restricciones documentados en `DATABASE.md` |
| T-006 | Resolver contradicciones y ambigüedades de la especificación | IN_PROGRESS | P-45, P-48, P-49, P-56 a P-58 | Cada P-xx cerrada con ADR o regla de negocio; `REQUIREMENTS.md`, `BUSINESS_RULES.md` y `DOMAIN_MODEL.md` sin marcas de esas decisiones |
| T-005 | Aprobar contratos API | DONE | T-003; aprobación de ADR-0071 | Endpoints del MVP documentados en `API_SPEC.md` (método, ruta, autenticación, permiso, request, parámetros, response, códigos, errores, validaciones, paginación, filtros, orden e idempotencia), con cobertura de todos los casos de uso |

## Fundaciones técnicas (sin lógica de negocio)

| ID | Tarea | Estado | Depende de | Criterios de aceptación |
|---|---|---|---|---|
| T-100 | Core/configuración | TODO | — | Proyecto NestJS con TypeScript estricto sobre Node.js 24 y npm; versión de Node.js declarada en `engines` y en archivo de versión local; `package-lock.json` versionado; configuración validada al arrancar (la API no inicia si falta una variable obligatoria); `.env` en `.gitignore`; `.env.example` con todas las variables, descripción y valores de ejemplo no reales |
| T-101 | Estructura de módulos y capas | TODO | T-003 | Un módulo por contexto con carpetas `domain`, `application`, `infrastructure`, `presentation`; convención documentada en `DEVELOPMENT_GUIDE.md` |
| T-102 | Docker para desarrollo | TODO | T-100 | `docker compose` levanta PostgreSQL 18, la API (Node.js 24) y un capturador de correos local; instrucciones en `DEVELOPMENT_GUIDE.md` |
| T-103 | Verificación de límites entre módulos | TODO | T-101 | Regla automática que falla si Domain importa NestJS o Prisma, si `@prisma/client` se usa fuera de Infrastructure, o si un módulo importa internos de otro La única excepción permitida es el servicio de consultas del catálogo público (ADR-0060) |
| T-104 | Linting y formato | TODO | T-100 | Configuración de lint y formato ejecutable con un comando |
| T-105 | Infraestructura de tests | TODO | T-102 | Jest con tests unitarios y de integración contra PostgreSQL 18 real en Docker, sin mocks de base de datos |
| T-106 | Pipeline de CI en GitHub Actions | TODO | T-102 a T-105, T-110 | Los 10 pasos de ADR-0030 corren en cada pull request y en la rama principal; PostgreSQL 18 como servicio para los tests de integración |
| T-107 | Configuración del repositorio en GitHub | TODO | T-106 | Rama principal protegida exigiendo el pipeline en verde; Dependabot semanal con actualizaciones agrupadas (requiere administrador del repositorio) |
| T-110 | Database | TODO | T-004 (aprobado) | Prisma configurado con esquema dividido por contexto; primera migración aplicable desde cero |
| T-111 | Contexto transaccional | TODO | T-110 | `nestjs-cls` con plugin transaccional; repositorios obtienen la transacción activa sin exponer Prisma a Application; test que demuestra rollback |
| T-112 | Shared kernel | TODO | T-101 | `Money` (centavos + moneda), tipos de ID, error de dominio base, forma de domain event y puerto `Clock`, con tests unitarios |
| T-113 | Manejo de errores HTTP | TODO | T-100, T-112 | Errores de dominio y de validación traducidos a Problem Details (RFC 9457) con `application/problem+json`, códigos de ADR-0064, `type` estable y extensiones `correlationId`, `errors` y `lines`; sin stack traces en producción |
| T-126 | Rate limiting con `@nestjs/throttler` y límites configurables de ADR-0065 | TODO | T-100 | Límites por endpoint desde variables de entorno declaradas en `.env.example`; 429 con `Retry-After`; tests de cada límite |
| T-114 | OpenAPI y versionado | TODO | T-100 | Prefijo `/v1` aplicado a todos los endpoints; Swagger de `v1` disponible en local |
| T-115 | Idempotencia HTTP | TODO | T-110 | Mecanismo reutilizable según ADR-0063 (llave ligada a quien la envía y al endpoint; 400, 422 y 409; respuestas guardadas 24 horas) con tests, incluido el caso concurrente |
| T-116 | Bus de eventos en proceso | TODO | T-112 | Despacho después del commit; fallos de handlers registrados en logs (ADR-0014) |
| T-117 | Scheduler de jobs | TODO | T-100 | `@nestjs/schedule` configurado; ejecuciones superpuestas omitidas; zona horaria America/Mexico_City para jobs diarios; fallos registrados en logs |
| T-118 | Observabilidad base (local) | TODO | T-100 | Logs en consola sin datos sensibles; nivel configurable por variable de entorno declarada en `.env.example`; identificador de correlación incluido en todos los logs de cada solicitud |
| T-119 | Cache base | TODO | T-100, T-116 | Módulo de cache en memoria con TTL de 120 s configurable; invalidación por eventos de Catalog; regla de límites que impide usarlo desde Domain y Application |

## Contextos de negocio

| ID | Tarea | Estado | Depende de |
|---|---|---|---|
| T-120 | Identity & Access: autenticación, UC-IAM-04 a 09 (Passport local + JWT, refresh tokens con rotación y detección de reutilización, Argon2id, política de contraseñas de ADR-0047 con lista local de contraseñas comunes; resultado de autenticación y respuesta de login preparados para 2FA según ADR-0048) | TODO | T-130, T-110 |
| T-121 | Identity & Access: verificación de email para clientes registrados, UC-IAM-01 a 03 y 10 (ADR-0046) | TODO | T-120, T-122 |
| T-122 | Puerto de envío de correos con adaptador al capturador local; URL base del frontend configurable para los enlaces (ADR-0056) | TODO | T-102 |
| T-123 | Identity & Access: recuperación de contraseña por enlace (ADR-0056); UC-IAM-07, 08 | TODO | T-120, T-122 |
| T-124 | Catálogo geográfico del INEGI: tablas, script de importación idempotente y consulta pública de estados y municipios; UC-IAM-21, 22 | TODO | T-110 |
| T-130 | Identity & Access: usuarios (tipo cliente o staff), roles iniciales, catálogo de permisos y direcciones; anonimización (ADR-0067); UC-IAM-11 a 19 | TODO | T-110, T-112, T-124, P-49 |
| T-131 | Identity & Access: script manual para crear el primer superadministrador y alta de staff con contraseña temporal; UC-IAM-13, UC-IAM-20 | TODO | T-130, T-120 |
| T-140 | Catalog: productos, variantes e imágenes; consulta pública con búsqueda y filtros (ADR-0060); UC-CAT-01, 02, 04 a 11, 14 | TODO | T-110, T-112, T-141, P-49 |
| T-141 | Almacenamiento de imágenes: puerto y adaptador de disco local con URL base configurable; validación de formato (JPEG, PNG, WebP) y tamaño (5 MB) | TODO | T-100 |
| T-145 | Pricing: lista predeterminada, precios y periodos; formato de carga masiva; UC-PRC-01 a 06 | TODO | T-140 |
| T-150 | Catalog: categorías y marcas; UC-CAT-03, 12, 13 | TODO | T-110, P-49 |
| T-160 | Inventory: almacenes, stock y reservas (incluye pruebas de concurrencia); UC-INV-01 a 07 | TODO | T-140, T-111 |
| T-161 | Inventory: reintegro de stock de órdenes canceladas o con envío devuelto (independiente, y opcional al cancelar o al registrar el reembolso sin reintegro previo, ADR-0052); UC-INV-09 | TODO | T-160, T-180, T-190, T-195 |
| T-170 | Shopping: carrito, con `cartId` aleatorio y fusión explícita (ADR-0059); UC-CRT-01 a 06 | TODO | T-140, T-145, T-160 |
| T-180 | Ordering: checkout y pedidos, con número interno y código público (ADR-0049); UC-ORD-01 a 03, 06 a 09 | TODO | T-170 |
| T-181 | Shopping: restaurar carrito al expirar una orden y copiar órdenes canceladas a un carrito; UC-CRT-08, UC-CRT-09 | TODO | T-170, T-180 |
| T-185 | Ordering: consulta de pedido de invitado (email + código público, con rate limiting); UC-ORD-04 | TODO | T-180 |
| T-186 | Ordering: enlace de acceso al pedido por correo (condicionado a su costo); UC-ORD-05 | BLOCKED | T-185, T-122, P-56 |
| T-190 | Payments: modelo, pago manual en tienda para pruebas (ADR-0055) y reembolso total al cancelar (ADR-0051); UC-PAY-01 a 03, 06, 07 | TODO | T-180 |
| T-192 | Payments: adaptador de PayPal semiimplementado (no verificado, no habilitado); UC-PAY-04 | TODO | T-190 |
| T-193 | Payments: Mercado Pago y Stripe | DEFERRED | ADR-0040 |
| T-191 | Payments: verificación del adaptador de PayPal y sus webhooks en sandbox | BLOCKED | T-192, P-31, cuenta y sandbox de PayPal |
| T-195 | Shipping: envíos manuales (creación al pagarse, captura de guía, cambios de estado, devolución); UC-SHI-03 a 09 | TODO | T-180, P-57 |
| T-196 | Shipping: costo fijo y envío gratis por monto, configurables; UC-SHI-01, 02 | TODO | T-195, P-48, P-58 |
| T-200 | Promotions | DEFERRED | ADR-0018 |
| T-210 | Admin | Reemplazada: los endpoints administrativos se implementan en cada contexto (ADR-0004) | — |
| T-215 | Notificaciones; UC-NTF-01 | TODO | T-116, T-122, P-45 |
| T-220 | Auditoría técnica (UC-AUD-01 a 03): registro en la misma transacción, eventos de seguridad, consulta con `audit.read`, exportación a archivos comprimidos de registros con más de 3 meses (sin borrar si la exportación falla) y borrado de archivos a 2 años | TODO | T-110, T-111, T-117 |
| T-230 | Jobs: expiración de reservas y órdenes (cada minuto), conciliación de pagos (cada 5 min); UC-INV-08, UC-ORD-10, UC-PAY-05 | BLOCKED | T-117, T-180, T-190 |
| T-231 | Job de limpieza diaria (refresh tokens, idempotencia, webhooks, carritos de invitado); UC-SYS-01, UC-CRT-07 | TODO | T-117, T-115, T-120, T-170 |
| T-232 | Ciclo de conservación de datos personales en órdenes: permiso de consulta de datos bloqueados, ocultamiento en la API y job de transición (ADR-0070) | DEFERRED | P-61 (validación legal) |

## Calidad

- [ ] T-300 Testing
- [ ] T-310 Security audit
- [ ] T-320 API documentation
- [ ] T-330 Deployment (pospuesta: solo entorno local, ADR-0031)

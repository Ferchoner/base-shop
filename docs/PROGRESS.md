# PROJECT PROGRESS

## Current Phase

INITIALIZATION — Sprint 0 (Discovery and Architecture)

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
- [x] Especificación técnica en `REQUIREMENTS.md` con casos de uso, estados, permisos, errores y requisitos no funcionales (T-002 en REVIEW)
- [x] oxlint como herramienta de lint (ADR-0073)
- [x] Código alineado con el stack decidido: `docs/` y `CLAUDE.md` versionados; Yarn eliminado (solo npm, ADR-0025); Vitest reemplazado por Jest (ADR-0002); eliminados los módulos generados `product/` y `cart/` y `@nestjs/observe` (ADR-0032, P-07)
- [x] Notificaciones por correo del ciclo de la orden (ADR-0074)
- [x] Permiso para configurar el costo de envío (ADR-0075)
- [x] Reactivación de entidades suspendidas, archivadas o desactivadas (ADR-0076)
- [x] Enlace de acceso al pedido fuera del MVP (ADR-0077)

## In Progress

- [ ] Revisión de la especificación técnica (T-002)
- [ ] Resolución de ambigüedades P-57 y P-58 (T-006); contradicciones resueltas

## Next

- [ ] Fundaciones técnicas (T-100 a T-118)

## Blocked

- T-191 verificación de PayPal por P-31 y por falta de cuenta y sandbox
- T-330 deployment (pospuesta, ADR-0031)

## Pending Decisions

### Stack e infraestructura

| ID | Decisión | Bloquea |
|---|---|---|
| P-05 | CD: entornos, disparador, registro de imágenes, migraciones en el despliegue, reversión. Pospuesta hasta tener hosting | T-330 |
| P-06 | Hosting para entorno compartido o producción (hoy solo local, ADR-0031) | T-330 |
| P-07 | Métricas, trazas y seguimiento de errores (logs locales ya decididos, ADR-0032) | — |
| P-13 | Almacén de secretos en el servidor (local ya decidido, ADR-0032) | — |
| P-31 | Pruebas de webhooks de pago: herramienta de túnel y procedimiento por proveedor | T-191 |

### API

Ninguna pendiente.

### Negocio

| ID | Decisión | Bloquea |
|---|---|---|
| P-24 | Proveedor real de correos; en desarrollo se usa un capturador local (ADR-0045). Se decide con el hosting | — |

### Arquitectura, datos y seguridad

| ID | Decisión | Bloquea |
|---|---|---|
| P-14 | Objetivos no funcionales cuantitativos | — |
| P-61 | Validación legal con especialista: valores de los plazos de fase operativa y bloqueo, y las preguntas de ADR-0070 (incluidas retención de auditoría y cuentas inactivas) | T-232 |

### Contradicciones y ambigüedades de la especificación

Detectadas al convertir los requisitos en especificación técnica (`REQUIREMENTS.md`, sección 10).

| ID | Tipo | Decisión | Afecta |
|---|---|---|---|
| P-57 | Ambigüedad | Envíos sin paquetería | T-195 |
| P-58 | Ambigüedad | IVA del envío y base del umbral de envío gratis | T-196 |

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

## Notas

- La carpeta `prompts/` existe en el repositorio pero no se ha revisado. Por decisión del equipo, se trabaja sin ella por ahora. La tarea "Run Prompt 00" queda en pausa.
- Mejora pendiente a mediano o largo plazo: segundo factor (2FA), con el diseño preparado (ADR-0043, ADR-0048).

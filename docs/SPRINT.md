# SPRINT

## Sprint actual

2 — Identity & Access. Inicio: 2026-09-28 (propuesta aprobada en el Sprint Review del Sprint 1).

## Goal

Identity & Access completo: clientes y staff pueden registrarse, verificar su correo, iniciar y cerrar sesión, recuperar su contraseña y operar con permisos. Todo endpoint del staff depende de esta base.

## Tasks

Detalle en `docs/TASKS.md`, sección "Contextos de negocio"; los criterios de aceptación son los de sus casos de uso en `REQUIREMENTS.md`. Orden por dependencias:

| Paso | Tareas |
|---|---|
| 0 | Revisión del repositorio contra los ADR; pull requests iniciales de Dependabot; scripts de instalación de dependencias que npm 11.19 marca como no autorizados en `allowScripts` (entre ellos Prisma y la telemetría de `@scarf/scarf`) |
| 1 | T-124 (catálogo geográfico del INEGI) y T-122 (puerto de envío de correos) |
| 2 | T-130 (usuarios, roles, permisos y direcciones) |
| 3 | T-120 (autenticación) |
| 4 | T-131 (primer superadministrador y alta de staff), T-121 (verificación de email) y T-123 (recuperación de contraseña) |

- **Criterio de cierre:** criterios de aceptación de los casos de uso de cada tarea en `REQUIREMENTS.md` y CI en verde en `main`.
- **T-120:** debe cumplir lo que esperan ADR-0099, ADR-0100 y ADR-0102:
  - el usuario autenticado queda en `request.user.id`;
  - la autenticación corre antes del guard de rate limiting;
  - los logins fallidos se cuentan con `FailedAttemptLimiter`.
- **Flujo de trabajo:** cada tarea se trabaja en su propia rama (`tipo/T-xxx-descripcion`) y se integra con un pull request que debe pasar la CI (ADR-0030, ADR-0084, ADR-0106).

## Risks

- **Ruta crítica:** T-124 → T-130 → T-120 → T-131, T-121 y T-123. Un retraso en T-130 o T-120 retrasa el resto del sprint.
- **Datos del INEGI:** T-124 necesita el archivo del catálogo del INEGI, que se descarga a mano (ADR-0057).
- **Módulo nativo de Argon2id:** hay que comprobarlo en Windows, en la CI y en la imagen de Docker en cuanto se agregue.
- **Seguridad de la autenticación:**
  - secretos de JWT solo en variables de entorno;
  - rotación de refresh tokens y detección de su reutilización;
  - mensajes que no revelan si una cuenta existe (ADR-0022, ADR-0023, ADR-0062).
- **TypeScript 7 (resuelto: pospuesto, ADR-0107):**
  - La propuesta de Dependabot (#31) fallaba en `npm ci`, porque ts-jest no admite TypeScript 7.
  - Además, TypeScript 7 ya no expone la API de compilador que usan ts-jest, la CLI de Nest y el plugin de Swagger.
  - El proyecto sigue en 6.x y Dependabot ignora las versiones mayores de TypeScript.
- **Riesgos heredados del Sprint 1:** ver su review en el historial.

## Sprint Review

PENDIENTE.

---

## Historial

### Sprint 1 — Fundaciones técnicas (2026-09-26 a 2026-09-28)

**Goal:** fundaciones técnicas sin lógica de negocio, con CI en verde. **Tareas:** T-100 a T-107, T-110 a T-119, T-126 y T-127, todas en DONE.

**Fecha:** 2026-09-28. **Resultado:** objetivo cumplido. Las 20 tareas están en DONE y el pipeline de CI está en verde en `main`.

#### Entregables

| Entregable | Estado | Referencia |
|---|---|---|
| Configuración validada al arrancar, CORS y encabezados de seguridad | DONE | T-100, ADR-0085, ADR-0086, ADR-0087 |
| Estructura de módulos por contexto con cuatro capas | DONE | T-101, ADR-0088 |
| Entorno local con Docker Compose (PostgreSQL 18, Mailpit y la API) y `Dockerfile` con etapa de producción | DONE | T-102, ADR-0089 |
| Verificación automática de límites entre módulos y capas (9 reglas) | DONE | T-103, ADR-0103 |
| Lint y formato ejecutables con un comando | DONE | T-104, ADR-0073, ADR-0084 |
| Tests unitarios, de integración y end-to-end contra PostgreSQL 18 real con Testcontainers | DONE | T-105, ADR-0090 |
| Pipeline de CI con los 10 pasos, detección de secretos y revisión de los mensajes de commit | DONE | T-106, ADR-0105 |
| `main` protegida con un ruleset; Dependabot con alertas y actualizaciones de seguridad | DONE | T-107, ADR-0106 |
| Prisma 7 y primera migración con las 38 tablas del modelo aprobado | DONE | T-110, ADR-0091 |
| Contexto transaccional con `nestjs-cls` | DONE | T-111, ADR-0093 |
| Shared kernel: `Money`, identificadores, errores de dominio, eventos y `Clock` | DONE | T-112, ADR-0094 |
| Errores como Problem Details (36 tipos) e identificador de correlación | DONE | T-113, ADR-0095 |
| Rutas bajo `/v1` y documento OpenAPI | DONE | T-114, ADR-0096 |
| Idempotencia HTTP | DONE | T-115, ADR-0099 |
| Bus de eventos en proceso con despacho después del commit | DONE | T-116, ADR-0098 |
| Scheduler de jobs | DONE | T-117, ADR-0101 |
| Logs con identificador de correlación y redacción de datos sensibles | DONE | T-118, ADR-0097 |
| Cache en memoria con espacios de nombres | DONE | T-119, ADR-0104 |
| Rate limiting con los límites de ADR-0065 | DONE | T-126, ADR-0102 |
| Registro de auditoría | DONE | T-127, ADR-0100 |
| Valores iniciales del método de envío | Decidido | P-72, ADR-0092 |
| 315 tests (207 unitarios, 39 de integración y 69 end-to-end); 0 vulnerabilidades; 0 secretos en el historial | — | CI |
| 106 ADR: 105 aceptados y 1 reemplazado parcialmente (ADR-0001); 20 nuevos en este sprint (ADR-0087 a ADR-0106) | — | `DECISIONS.md` |
| 63 de 72 decisiones pendientes (P-xx) cerradas; P-72 se abrió y se cerró en este sprint | — | `PROGRESS.md` |

El trabajo se integró en 20 pull requests a `main` (del #10 al #29). Desde T-106, cada uno pasa por la CI, que tarda unos 2 minutos.

#### Decisiones abiertas que pasan al siguiente sprint

Son las mismas nueve con las que empezó el sprint. Ninguna bloquea Identity & Access.

| Grupo | Decisiones |
|---|---|
| Dependen del hosting | P-05 (CD), P-06 (hosting, HSTS, TLS e IP del cliente detrás del proxy), P-07 (métricas y trazas), P-13 (secretos en servidor), P-24 (proveedor de correo) |
| Dependen de la cuenta de PayPal | P-31 (pruebas de webhooks; bloquea T-191) |
| Validaciones externas | P-61 (legal; difiere T-232), P-69 (fiscal) |
| Negocio y operación | P-14 (objetivos no funcionales cuantitativos) |

#### Riesgos que pasan al siguiente sprint

- Efectos en segundo plano: si un handler falla, su efecto se pierde; solo los pagos tienen conciliación (ADR-0014, ADR-0098). La lista de efectos está en `API_SPEC.md`, sección 2.5.
- El rate limiting y el cache guardan su estado en memoria: sirven mientras la API corra en una sola instancia (ADR-0102, ADR-0104).
- Dos reglas se revisan solo en code review: las lecturas SQL entre contextos del catálogo público (ADR-0060) y el acceso a la base siempre con la transacción activa (`txHost.tx`, ADR-0093).
- Limitaciones de Prisma y la función `partialIndexes`, en vista previa (ADR-0091).
- La imagen de producción pesa 913 MB porque incluye el CLI de Prisma (ADR-0093).
- Jest corre en modo ESM, una función experimental de Node.js, y necesita `test/setup-esm-interop.ts` para cargar paquetes CommonJS como `@nestjs/throttler` (ADR-0102).
- Fuera de este sprint: adaptador de PayPal sin verificar (ADR-0040) y validaciones externas antes de operar con clientes reales (P-61, P-69).

#### Qué funcionó

- Cada tarea siguió el mismo ciclo: plan con preguntas numeradas y una recomendación, aprobación, rama desde `main` actualizada, tres commits (código, tests y documentación), ADR y pull request. Cada cambio se puede rastrear hasta su decisión.
- Cada tarea tuvo pruebas de mutación: se rompe el código a propósito para comprobar que los tests fallan. Así se atrapó, por ejemplo, que `JOBS_ENABLED` se leía una sola vez al importar el módulo (T-117).
- La CI pasó a la primera. Antes de abrir el pull request se simuló el pipeline en un contenedor Linux con un clon limpio.
- Se aplicaron las mejoras del Sprint 0: ninguna rama apilada, cada rama salió de `main` ya actualizada, y los pull requests se crearon con `gh`.

#### Qué mejorar

- La CI llegó en el último paso del sprint, así que 18 tareas se verificaron solo en local. Desde T-106 corre en cada pull request; en proyectos nuevos conviene montarla al principio.
- Algunas dependencias trajeron sorpresas que aparecieron tarde:
  - la imagen de producción creció por el CLI de Prisma (ADR-0093);
  - Jest necesitó un arreglo para cargar `@nestjs/throttler`.

  Conviene probar cada dependencia nueva en el pipeline completo (build, tests y Docker) en cuanto se agrega.
- Varias ediciones de documentación hechas con comandos de shell perdieron caracteres escapados, y un `git add` fallido dejó los commits de T-119 desordenados. Para la documentación conviene usar edición directa y comprobar el resultado de cada paso de Git.
- Quedaban 32 ramas locales ya fusionadas. Se borraron al cerrar el sprint, y desde T-107 las ramas del remoto se borran al fusionar.

#### Siguiente sprint

La propuesta del Sprint 2 se aprobó el 2026-09-28; ver "Sprint actual".

### Sprint 0 — Discovery and Architecture (2026-09-24 a 2026-09-26)

**Goal:** definir requisitos, decisiones tecnológicas, arquitectura, modelo de datos y contratos API antes de implementar funcionalidades. **Tareas:** T-001 a T-006, todas en DONE.

**Fecha:** 2026-09-26. **Resultado:** objetivo cumplido.

#### Entregables

| Entregable | Estado | Referencia |
|---|---|---|
| Stack definido para el entorno local | DONE | T-001 |
| Especificación técnica: 91 casos de uso, 34 errores, permisos, estados y requisitos no funcionales | Aprobada | T-002, `REQUIREMENTS.md` |
| Arquitectura, mapa de contextos e integración entre contextos | Aprobada | T-003, ADR-0004, ADR-0005, ADR-0019 |
| Modelo de datos: 38 tablas, restricciones, índices, concurrencia y diagrama ER | Aprobado | T-004, ADR-0066, `DATABASE.md` |
| Contratos de la API: unas 120 operaciones, errores RFC 9457, idempotencia y rate limiting | Aprobados | T-005, ADR-0071, `API_SPEC.md` |
| Contradicciones y ambigüedades de la especificación resueltas | DONE | T-006 |
| 139 reglas de negocio con su fuente | — | `BUSINESS_RULES.md` |
| 86 ADR: 85 aceptados y 1 reemplazado parcialmente (ADR-0001) | — | `DECISIONS.md` |
| 62 de 71 decisiones pendientes (P-xx) cerradas | — | `PROGRESS.md` |
| Repositorio base alineado con las decisiones: NestJS con Node.js 24 y npm, Jest, oxlint, Prettier, fin de línea LF, sin vulnerabilidades en `npm audit` y documentación versionada | DONE | ADR-0025, ADR-0073, ADR-0084 |

El trabajo se integró en 7 pull requests a `main`.

#### Decisiones abiertas que pasan al siguiente sprint

Ninguna bloquea las fundaciones técnicas.

| Grupo | Decisiones |
|---|---|
| Dependen del hosting | P-05 (CD), P-06 (hosting, HSTS y TLS), P-07 (métricas y trazas), P-13 (secretos en servidor), P-24 (proveedor de correo) |
| Dependen de la cuenta de PayPal | P-31 (pruebas de webhooks; bloquea T-191) |
| Validaciones externas | P-61 (legal; difiere T-232), P-69 (fiscal) |
| Negocio y operación | P-14 (objetivos no funcionales cuantitativos) |

#### Qué funcionó

- Cada decisión quedó como ADR, con estado Propuesta cuando requería aprobación, y cada documento afectado se actualizó en el mismo cambio. La trazabilidad P-xx → ADR → documentos permite saber de dónde sale cada regla.
- La revisión integral previa a la implementación encontró 26 puntos: una vulnerabilidad alta en una dependencia de producción, dependencias entre tareas en orden incorrecto y contradicciones entre documentos. Todos se corrigieron o se convirtieron en decisiones.
- Una comprobación automática de identificadores (ADR, P-xx, BR, UC, E-xx y tareas) detecta referencias rotas después de cada cambio.

#### Qué mejorar

- El modelo de datos y los contratos se aprobaron antes de cerrar todas las ambigüedades, y varias decisiones posteriores los modificaron (ADR-0076, ADR-0078, ADR-0079, ADR-0081 y ADR-0083). Para próximos diseños: resolver las ambigüedades antes de aprobar modelo y contratos.
- Al inicio, la documentación no estaba versionada y el código no coincidía con las decisiones (Vitest, Yarn, módulos de ejemplo). Conviene revisar el repositorio contra los ADR al empezar cada sprint.
- Las ramas apiladas dependían del orden de fusión. Conviene fusionar cada rama antes de empezar la siguiente cuando sea posible.
- El equipo local no tenía la CLI de GitHub, así que los pull requests se crearon a mano (resuelto el 2026-09-26: `gh` instalado).

#### Siguiente sprint

La propuesta del Sprint 1 se aprobó el 2026-09-26; ver "Sprint actual".

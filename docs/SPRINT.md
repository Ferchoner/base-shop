# SPRINT

## Sprint actual

3 — Catálogo vendible (Catalog, Pricing e Inventory). Inicio: 2026-09-29 (propuesta aprobada en el Sprint Review del Sprint 2).

## Goal

Catálogo vendible: categorías, marcas, productos con variantes e imágenes, precios, stock con reservas y costo de envío. Es lo que necesitan el carrito y el checkout del Sprint 4.

## Tasks

Detalle en `docs/TASKS.md`, sección "Contextos de negocio"; los criterios de aceptación son los de sus casos de uso en `REQUIREMENTS.md`. Orden por dependencias:

| Paso | Tareas |
|---|---|
| 0 | Revisión del repositorio contra los ADR; pull requests de Dependabot que haya; `npm run secrets:scan` para correr gitleaks en local antes de commitear |
| 1 | T-150 (categorías y marcas), T-141 (almacenamiento de imágenes) y T-196 (costo de envío y envío gratis) |
| 2 | T-140 (productos, variantes e imágenes, con la consulta pública) |
| 3 | T-145 (precios) y T-160 (almacenes, stock y reservas) |

- **Criterio de cierre:** criterios de aceptación de los casos de uso de cada tarea en `REQUIREMENTS.md` y CI en verde en `main`.
- **T-160:** incluye pruebas de concurrencia de las reservas (`DEVELOPMENT_GUIDE.md`, sección de tests).
- **Pospuesto:** T-220 (consulta de auditoría) y reducir la imagen de producción.
- **Flujo de trabajo:** cada tarea se trabaja en su propia rama (`tipo/T-xxx-descripcion`) y se integra con un pull request que debe pasar la CI (ADR-0030, ADR-0084, ADR-0106). Antes de cada commit: revisar lo preparado con `git diff --cached --stat` y correr `npm run secrets:scan` (lecciones del Sprint 2).

## Risks

- **Ruta crítica:** T-141 → T-140 → T-145 y T-160. Un retraso en T-140 retrasa el resto del sprint.
- **Consulta pública del catálogo (ADR-0060):** lee en una sola consulta tablas de Catalog, Pricing e Inventory y oculta los productos sin precio vigente (BR-PRD-06). T-140 llega antes que T-145 y T-160, así que su plan debe decidir cómo se reparte la consulta pública entre esas tareas.
- **Imágenes en el disco del servidor (ADR-0024):** hay que incluirlas en los respaldos, y la imagen de Docker necesita un volumen para ellas.
- **Cache del catálogo público (ADR-0028):** se invalida por eventos de Catalog. Nunca se usa para stock ni precios al colocar una orden.
- **Riesgos heredados del Sprint 2:** ver su review en el historial.

## Sprint Review

PENDIENTE.

---

## Historial

### Sprint 2 — Identity & Access (2026-09-28 a 2026-09-29)

**Goal:** Identity & Access completo: clientes y staff pueden registrarse, verificar su correo, iniciar y cerrar sesión, recuperar su contraseña y operar con permisos. **Tareas:** T-124, T-122, T-130 (en tres partes), T-120 (en dos partes), T-131, T-121 y T-123, todas en DONE, precedidas por un paso 0.

**Fecha:** 2026-09-29. **Resultado:** objetivo cumplido. Las 7 tareas están en DONE y el pipeline de CI está en verde en `main`. Clientes y staff pueden registrarse, verificar su correo, iniciar y cerrar sesión, recuperar su contraseña y operar con permisos. Queda fuera la anonimización (UC-IAM-19), que pasó a T-132 porque depende de Ordering.

#### Entregables

| Entregable | Estado | Referencia |
|---|---|---|
| Scripts de instalación de las dependencias negados por defecto; TypeScript 7 pospuesto | DONE | Paso 0, ADR-0107, ADR-0108 |
| Catálogo geográfico del INEGI: importación idempotente y consulta pública de estados y municipios | DONE | T-124, ADR-0109 |
| Envío de correos por SMTP (Mailpit en local) y enlaces al frontend | DONE | T-122, ADR-0110 |
| Autorización con catálogo de permisos, `@RequirePermissions` y `@RequireAccount` (falla cerrado), y paginación | DONE | T-130, ADR-0111 |
| Administración de roles, staff y clientes, con motivo en la auditoría | DONE | T-130, ADR-0112 |
| Libreta de direcciones del cliente, validada contra el catálogo geográfico | DONE | T-130, ADR-0113 |
| Sesiones: login, renovación con rotación y detección de reutilización, cierre, y cuenta y sesión comprobadas en cada solicitud | DONE | T-120, ADR-0114 |
| Política de contraseñas con lista de contraseñas comunes, y cambio de contraseña | DONE | T-120, ADR-0115 |
| Alta y reactivación del staff con contraseña temporal, y script del primer superadministrador | DONE | T-131, ADR-0116 |
| Registro, verificación y cambio de email, y corrección de datos del cliente | DONE | T-121, ADR-0117 |
| Recuperación de contraseña | DONE | T-123, ADR-0118 |
| 856 tests (498 unitarios, 163 de integración y 195 end-to-end); 0 vulnerabilidades; 0 secretos en el historial | — | CI |
| 118 ADR: 117 aceptados y 1 reemplazado parcialmente (ADR-0001); 12 nuevos en este sprint (ADR-0107 a ADR-0118) | — | `DECISIONS.md` |
| Las 9 decisiones pendientes (P-xx) siguen abiertas; ninguna se abrió en este sprint | — | `PROGRESS.md` |

El trabajo se integró en 15 pull requests a `main` (del #30 al #45; el #31, TypeScript 7, se cerró sin fusionar). La CI pasó en todos los de las tareas; sus dos únicos fallos fueron los del #31.

#### Decisiones abiertas que pasan al siguiente sprint

Son las mismas nueve. Ninguna bloquea el catálogo, los precios ni el inventario.

| Grupo | Decisiones |
|---|---|
| Dependen del hosting | P-05 (CD), P-06 (hosting, HSTS, TLS e IP del cliente detrás del proxy), P-07 (métricas y trazas), P-13 (secretos en servidor), P-24 (proveedor de correo) |
| Dependen de la cuenta de PayPal | P-31 (pruebas de webhooks; bloquea T-191) |
| Validaciones externas | P-61 (legal; difiere T-232), P-69 (fiscal) |
| Negocio y operación | P-14 (objetivos no funcionales cuantitativos) |

#### Riesgos que pasan al siguiente sprint

- **Heredados del Sprint 1, siguen vigentes:**
  - si falla un handler de un evento, su efecto se pierde; solo los pagos tienen conciliación (ADR-0014, ADR-0098);
  - el rate limiting, el límite de logins fallidos y el cache guardan su estado en memoria: sirven mientras la API corra en una sola instancia (ADR-0102, ADR-0104);
  - dos reglas se revisan solo en code review: las lecturas SQL entre contextos del catálogo público (ADR-0060) y el acceso a la base con la transacción activa (ADR-0093);
  - Prisma y su función `partialIndexes`, en vista previa (ADR-0091);
  - la imagen de producción pesa 920 MB por el CLI de Prisma (ADR-0093);
  - Jest en modo ESM necesita `test/setup-esm-interop.ts`, y bajo Jest algunas librerías registran con otra copia del `Logger` de Nest, así que sus logs no se pueden espiar (ADR-0102, ADR-0116).
- **Nuevos de la autenticación:**
  - cada solicitud autenticada hace unas tres consultas para leer la cuenta, la sesión y los permisos (ADR-0114); con carga alta podría necesitar cache;
  - el Argon2id de `node:crypto` está en fase "release candidate" (ADR-0114);
  - no hay duración máxima absoluta de sesión: dura mientras se renueve (ADR-0114);
  - la lista de contraseñas comunes protege poco con el mínimo de 15 caracteres; la longitud es la protección principal (ADR-0115).
- **Para el frontend, cuando exista:** debe renovar la sesión de una en una, porque dos renovaciones simultáneas la cierran (ADR-0114), y enviar `Referrer-Policy: no-referrer` en las páginas que reciben tokens en la URL (ADR-0117, ADR-0118).
- **Correos:** van a Mailpit hasta decidir el proveedor (P-24), y un envío fallido no se reintenta (ADR-0110).
- **Fuera de este sprint:** adaptador de PayPal sin verificar (ADR-0040) y validaciones externas antes de operar con clientes reales (P-61, P-69).

#### Qué funcionó

- Partir las tareas grandes mantuvo cada pull request revisable: T-130 en tres partes y T-120 en dos, cada parte con su propio plan y preguntas.
- Las pruebas de mutación encontraron huecos reales. Por ejemplo:
  - no había tests de los límites de reenvío de verificación y de cambio de email (T-121);
  - el test del aviso de transacciones anidadas no podía verlo y se cambió por uno que verifica la causa (T-131).
- Cada bloqueo de fila tiene su test de concurrencia (direcciones, superadministrador, refresh tokens y primer superadministrador). El script del primer superadministrador se probó contra un PostgreSQL desechable, y la imagen de producción se construyó cada vez que cambió el `Dockerfile` o los datos que copia.
- La CI pasó a la primera en todos los pull requests de las tareas.

#### Qué mejorar

- **gitleaks después del commit:** detectó tres falsos positivos en tests (T-120, T-131 y T-121), por la palabra "password" junto a un valor literal. Se corrigieron rehaciendo commits locales. Conviene correrlo antes de commitear: el paso 0 del Sprint 3 agrega `npm run secrets:scan`.
- **Commits mezclados:** un `git mv` que ya estaba en el índice entró en el commit de código de T-123. Conviene revisar lo preparado (`git diff --cached --stat`) antes de cada commit.
- **Edición con comandos de shell:** siguió fallando por escapes (`\n`, `\S`) y por un here-document que el shell no pudo leer. Para código de varias líneas conviene la edición directa.
- **Test inestable latente:** el test de concurrencia de T-130 fallaba corrido solo, porque `pg_stat_activity` se leía dentro de la transacción que sostiene el bloqueo. Se detectó en T-120 y se arregló para todos. Conviene correr cada test de concurrencia nuevo también aislado.
- **Particularidades de NestJS 12 descubiertas al ejecutar:** `@Optional()` no se hereda en una subclase (`PassportModule.register({})`, ADR-0114). Conviene escribir primero el test de integración de cada integración nueva con Nest.

#### Resultado del paso 0

- **Revisión contra los ADR, sin contradicciones:**
  - existen todas las referencias a ADR, tareas, P-xx, reglas de negocio y casos de uso;
  - las variables de `.env.example` coinciden con las que valida el código;
  - existen los scripts que cita la documentación;
  - los módulos tienen sus cuatro capas;
  - las dependencias coinciden con el stack;
  - los `overrides` de ADR-0091 siguen siendo necesarios.
- **Arreglos menores:**
  - el árbol de `ARCHITECTURE.md` suma el rate limiting y el módulo `audit/`;
  - `JobsModule` ya no escribe una línea `DEBUG` en cada arranque de los tests.
- **Dependabot:**
  - #30 (versiones menores y parches) fusionado;
  - #31 (TypeScript 7) cerrado, porque las herramientas todavía no lo admiten (ADR-0107).
- **Scripts de instalación:** los 8 de las dependencias quedan negados y npm falla ante uno sin revisar (ADR-0108).
- **Aviso de OpenSSL en la imagen de producción:** anotado para P-05 en `DATABASE.md`, sección 13.
- **Sin acción:** `glob@10.5.0` aparece como obsoleto, pero llega por testcontainers y ts-jest, ya tiene la corrección de seguridad y `npm audit` está limpio.

#### Siguiente sprint

La propuesta del Sprint 3 se aprobó el 2026-09-29; ver "Sprint actual".

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

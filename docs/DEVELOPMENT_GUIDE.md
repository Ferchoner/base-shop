# DEVELOPMENT GUIDE

## Flujo

1. Leer `CLAUDE.md`.
2. Revisar documentación relacionada.
3. Crear/confirmar plan.
4. Implementar una tarea acotada.
5. Crear/actualizar tests.
6. Ejecutar verificaciones.
7. Actualizar documentación.
8. Actualizar `TASKS.md` y `PROGRESS.md`.
9. Crear checkpoint Git.

## Convenciones

Definidas por el stack (ADR-0002, ADR-0003):

- TypeScript en modo estricto.
- Un módulo de NestJS por bounded context en `src/modules/<contexto>/`, con capas `domain`, `application`, `infrastructure` y `presentation`, un `<contexto>.module.ts` y un `index.ts` como API pública (ADR-0088, `ARCHITECTURE.md`).
- Infraestructura técnica transversal en `src/platform/`; `Money`, IDs, errores, eventos base y `TransactionManager` en `src/shared-kernel/`.
- Imports relativos, sin alias de rutas. Entre módulos, solo desde el `index.ts` del otro módulo.
- Nombres de archivo en kebab-case con sufijo de rol: `order.ts`, `order.repository.ts` (interfaz en `domain`), `prisma-order.repository.ts` (en `infrastructure`), `place-order.use-case.ts`, `ordering.facade.ts`, `order.controller.ts`, `place-order.dto.ts`. Tests unitarios junto al código, como `*.spec.ts`.
- Domain no importa NestJS ni Prisma. `@prisma/client` solo en Infrastructure.
- Interfaces de repositories en Domain; implementaciones en Infrastructure.
- DTOs HTTP solo en Presentation.

Shared kernel (ADR-0094), importado desde `src/shared-kernel/index.ts`:

- **Dinero:** siempre `Money` (centavos enteros de 0 a 2,147,483,647, con moneda). El IVA contenido en un precio con IVA se calcula con `containedTax(tasaEnPuntosBase)`, una vez por línea.
- **Identificadores:** cada contexto declara sus tipos (`type OrderId = Id<'Order'>`). Los nuevos se crean con `newId()` (UUIDv7) o, si funcionan como credencial, con `newCredentialId()` (UUIDv4); los que llegan de fuera se convierten con `toId()`.
- **Errores de negocio:** una subclase de `DomainError` por error, con `code` igual al `type` de `API_SPEC.md` (sección 6.2) y una `category` (`invalid`, `forbidden`, `not-found` o `conflict`). `details` nunca lleva datos sensibles ni personales. El mensaje del error es para desarrolladores, en inglés: va al log y nunca a la respuesta.
- **Eventos:** interfaz que extiende `DomainEvent<'NombreDelEvento'>`, con los campos comunes de `eventMetadata(nombre, clock.now())`.
- **Hora actual:** se inyecta `Clock`; en tests unitarios, un objeto `{ now: () => fecha }`.

Cache (ADR-0028, ADR-0104):

- Solo en Infrastructure o Presentation, y solo para lecturas públicas del catálogo (y datos de referencia como el catálogo geográfico). Nunca para stock en el checkout, precios al colocar una orden, pagos, carrito, permisos ni tokens.
- Se usa `AppCache`, con una clave por consulta dentro de su espacio de nombres; cada espacio se vacía por separado con `clear()`:

  ```ts
  return this.cache
    .namespace('catalog')
    .getOrLoad(`product:${slug}`, () => this.readProduct(slug));
  ```

- Todo valor vence con `CACHE_TTL_SECONDS` (120 por defecto). Si un cambio debe verse de inmediato, se invalida con un handler de eventos que vacía el espacio correspondiente.
- Las respuestas que no guardan nada invalidable pueden usar `CacheInterceptor` de `@nestjs/cache-manager`, que tiene el mismo TTL.

Rate limiting (ADR-0065, ADR-0102):

- Todo endpoint tiene el límite general por IP. Uno con un límite de `API_SPEC.md` (sección 7) lo declara con `@RateLimit('register')` (o varios: `@RateLimit('password-reset-email', 'password-reset-ip')`), que reemplaza al general.
- El login usa `FailedAttemptLimiter`: `assertAllowed('login-email', email)` y `assertAllowed('login-ip', ip)` antes de validar las credenciales, y `recordFailure(...)` cuando no son válidas.
- Los tests pueden bajar los límites con las variables `RATE_LIMIT_*` antes de importar `AppModule`.
- `@nestjs/throttler` es CommonJS y requiere los módulos ESM de NestJS; en Jest, `test/setup-esm-interop.ts` los carga antes de cada archivo de test para evitar un ciclo de carga. No hace falta nada en el código de la aplicación.

Jobs programados (ADR-0029, ADR-0101):

- Un job es un provider en `infrastructure` del contexto, en un archivo `*.job.ts`, con un método `@ScheduledJob('contexto.accion', CronExpression.EVERY_MINUTE)` que llama a un solo caso de uso. El nombre sigue el formato de las acciones de auditoría.
- La expresión cron se lee en hora de México: `'0 3 * * *'` son las 3:00 en America/Mexico_City.
- El caso de uso procesa por lotes con un límite por ejecución y una transacción por elemento (`transactions.run` dentro del ciclo), para que un fallo no revierta el lote, y es idempotente.
- No hace falta atrapar errores ni evitar ejecuciones superpuestas: lo hace `@ScheduledJob`.
- En los tests el scheduler está apagado (`JOBS_ENABLED=false`); un test de un job llama a su método directamente.

Auditoría (ADR-0037, ADR-0100):

- Todo caso de uso que modifica datos a pedido del staff, y todo evento de seguridad, registra con el puerto `AuditTrail` del shared kernel:

  ```ts
  await this.audit.record({
    action: 'orders.cancel',
    resource: { type: 'order', id: order.id },
    changes: changesBetween(before, after, { personal: ['contactName'] }),
  });
  ```

- `record` se une a la transacción del cambio; `recordIndependently` confirma por su cuenta, para intentos denegados e inicios de sesión fallidos que ocurren dentro de una transacción que se revierte.
- El actor, la IP, el agente de usuario y la correlación salen de la solicitud; solo se indica `actor` cuando la solicitud no dice quién actuó (por ejemplo, `{ type: 'ANONYMOUS' }` en un login fallido).
- Los campos personales o sensibles se declaran en `personal`; además, una lista fija oculta contraseñas, tokens, correos, teléfonos, nombres y direcciones aunque no se declaren.
- Los 403 en `/v1/admin` ya se registran solos; no hace falta auditarlos en cada guard.

Idempotencia (ADR-0063, ADR-0099):

- Un endpoint que exige `Idempotency-Key` se marca con `@Idempotent(cartScope)` (rutas de invitado, alcance = `cartId` del cuerpo) o `@Idempotent(userScope)` (rutas de cliente, alcance = usuario autenticado). El decorador también documenta el encabezado en OpenAPI.
- El caso de uso no hace nada especial: el interceptor repite la respuesta guardada y libera la llave si la operación no llegó a ejecutarse. Las reglas del dominio deben impedir duplicados por sí mismas, porque una llave abandonada puede volver a ejecutarse.
- Solo se repiten los errores de negocio (`DomainError`); cualquier otro error libera la llave.

Eventos de dominio (ADR-0098):

- **Publicar:** el caso de uso inyecta `DomainEventPublisher` y llama a `publish(evento)` dentro de `transactions.run(...)`, así el evento sale solo si la transacción confirma. El tipo del evento se declara en el contexto que lo produce y se exporta desde su `index.ts`.
- **Consumir:** un handler es un provider en `infrastructure` del contexto que consume, en un archivo `*.event-handler.ts`, con un método `@OnDomainEvent('NombreDelEvento')` que llama a un caso de uso de su contexto. Debe ser idempotente y no puede asumir el orden respecto de otras solicitudes.
- Los handlers corren en segundo plano: quien publica no espera su resultado ni se entera de sus errores. Todo efecto nuevo que el cliente vea con demora se agrega a `API_SPEC.md` (sección 2.5).
- En tests de integración, `DomainEventDispatcher.whenIdle()` espera a que terminen los handlers, incluidos los de eventos publicados por otros handlers.

Logs (ADR-0097):

- Cada clase registra con su propio logger: `private readonly logger = new Logger(NombreDeLaClase.name)`. Nunca `console.log`.
- Niveles: `error` para fallos que requieren atención (con el stack trace como segundo argumento), `warn` para situaciones anómalas que el sistema resolvió, `log` para eventos normales relevantes, `debug` para detalle de diagnóstico. `LOG_LEVEL` (por defecto `log`) decide desde qué nivel se escribe.
- El identificador de correlación se agrega solo; no hace falta incluirlo en el mensaje.
- Nunca se registran datos personales (correos, nombres, direcciones, teléfonos), contraseñas, tokens, cuerpos de solicitudes ni cadenas de consulta; se registran identificadores. La redacción automática del logger es una red de seguridad, no un permiso.

Correos y enlaces al frontend (ADR-0045, ADR-0110):

- **Cómo enviar:** el caso de uso inyecta `EmailSender` (shared kernel) y envía `{ to, subject, text, html? }`. Siempre fuera de la transacción: después del commit, normalmente desde un handler de eventos.
- **Si falla:** `send` rechaza con `EmailDeliveryError` y el correo no se reintenta (ADR-0014). El que llama decide si el fallo cambia la respuesta.
- **Enlaces:** se arman con `FrontendLinks.link('/ruta', { token })`, nunca concatenando `FRONTEND_BASE_URL` a mano, para que los parámetros vayan codificados.
- **Qué no se registra:** el destinatario, el asunto y el cuerpo nunca van al log; el adaptador solo registra el identificador del mensaje.
- **Tests:** los que envían correos usan Mailpit real con Testcontainers y leen el mensaje por su API (`smtp-email-sender.int-spec.ts`).

Versionado y documentación OpenAPI (ADR-0096):

- Todo controlador queda bajo `/v1` sin declararlo. Una ruta de una versión futura se marca con `@Version('2')`.
- Los DTOs se escriben en archivos `*.dto.ts`. El plugin de Swagger toma sus tipos, sus reglas de class-validator y el comentario de cada propiedad, así que en los campos simples no se repite `@ApiProperty`. Los comentarios de las propiedades se publican como descripción en OpenAPI y por eso van en español, como `API_SPEC.md`.
- Se declara de forma explícita lo que el plugin solo deduce con el análisis de tipos de `nest build` (ADR-0109):
  - la respuesta de éxito de cada endpoint, con `@ApiOkResponse({ type })` o `@ApiCreatedResponse({ type })`;
  - los campos de un DTO que contienen otros DTO, con `@ApiProperty({ type: () => [OtroDto] })`.
- Cada endpoint declara sus errores con `@ApiProblemResponses('not-found', 'version-conflict', …)`; los comunes (`validation-error`, `rate-limit-exceeded`, `internal-error`) se agregan solos.
- Los tests end-to-end aplican el mismo plugin (`test/swagger-plugin.cjs`). Como ts-jest compila archivo por archivo, el plugin no deduce ahí los tipos de retorno ni los campos con otros DTO; declarándolos de forma explícita, el documento de los tests coincide con el real.

Errores HTTP y validación (ADR-0095):

- Toda respuesta de error es Problem Details; la arma el filtro global de `src/platform/http/problem-details/`, así que los controladores no construyen respuestas de error.
- Un tipo de error nuevo se agrega a la vez al catálogo de `problem-types.ts` (estado y textos en español) y a `API_SPEC.md` (sección 6.2); un test falla si no coinciden.
- Los errores que no son de dominio (autenticación, idempotencia, rate limiting) se lanzan con `ProblemException(code, extensiones, encabezados)`.
- Los DTOs se validan con class-validator. Los mensajes en español salen de una tabla por regla; si un campo necesita un texto propio, se indica en el decorador: `@Matches(/^\d{5}$/, { context: { message: 'Debe tener 5 dígitos.' } })`.

Transacciones (ADR-0093):

- Un caso de uso que escribe en más de un lugar delimita su transacción con `TransactionManager`, inyectado desde el shared kernel:

  ```ts
  await this.transactions.run(async () => {
    await this.orders.save(order);
    await this.carts.save(cart);
  });
  ```

- Un repository de Infrastructure inyecta `TransactionHost<PrismaTransactionAdapter>` y usa siempre `this.txHost.tx` en lugar de `PrismaService`; así participa de la transacción activa sin recibirla. Inyectar `TransactionHost` con su tipo completo: un alias de tipo impide que NestJS resuelva la dependencia.
- Dentro de `run` no se llaman servicios externos (pagos, correo, almacenamiento), y el trabajo debe durar menos de 5 s o se revierte.
- En tests unitarios de casos de uso, `TransactionManager` se reemplaza por un doble que solo ejecuta el trabajo: `{ run: (work) => work() }`.
- Nombres de código en inglés; documentación en español; ramas, commits y pull requests en inglés (ADR-0084).
- Montos como enteros en centavos con `Money`.
- Sin abstracciones genéricas (`BaseRepository<T>`, `BaseEntity` con lógica).
- Ningún módulo importa internos de otro; solo su fachada pública.

Tests (Jest):

| Tipo | Archivos | Comando | Necesita Docker |
|---|---|---|---|
| Unitarios (Domain y lógica sin base de datos) | `*.spec.ts`, junto al código | `npm test` | No |
| Integración (repositories y flujos transaccionales) | `*.int-spec.ts`, junto al código de `infrastructure` | `npm run test:int` | Sí |
| End-to-end (la aplicación completa por HTTP) | `test/*.e2e-spec.ts` | `npm run test:e2e` | Sí |

- Integración y end-to-end contra PostgreSQL 18 real, sin mocks de base de datos (ADR-0033): Testcontainers levanta un contenedor temporal por ejecución, le aplica todas las migraciones y expone su URL en `DATABASE_URL` (ADR-0090, ADR-0091). La infraestructura común está en `test/integration/`. Los tests corren en serie.
- Cada test deja la base como la encontró, por ejemplo trabajando dentro de una transacción que se revierte al terminar.
- Pruebas de concurrencia obligatorias para reservas de inventario y checkout.
- El proyecto es ESM (`"type": "module"`): Jest corre con `ts-jest` en modo ESM y `node --experimental-vm-modules`. Usar siempre los scripts `npm test`, `npm run test:int`, `npm run test:e2e` y `npm run test:cov`. La advertencia `ExperimentalWarning: VM Modules` es esperada.

Entorno (ADR-0025):

- Node.js 24 y PostgreSQL 18, siempre en su última actualización menor.
- npm como gestor de paquetes; `package-lock.json` se versiona y las instalaciones en CI usan `npm ci`.
- La versión de Node.js se declara en el campo `engines` de `package.json` y en un archivo de versión para el entorno local.
- Fin de línea LF en todos los archivos de texto, forzado por `.gitattributes` (`* text=auto eol=lf`), igual que `.editorconfig` y Prettier.
- `npm audit` debe quedar sin vulnerabilidades altas ni críticas, igual que en la CI (ADR-0030).
- Scripts de instalación de las dependencias (ADR-0108):
  - `package.json` los niega todos en `allowScripts`, y `.npmrc` (`strict-allow-scripts=true`) hace fallar la instalación si una dependencia trae uno sin revisar.
  - Si `npm ci` falla con `ESTRICTALLOWSCRIPTS`, se revisa el script que lista el error (`npm install-scripts ls`) y se decide:
    - lo normal es negarlo con `npm install-scripts deny <paquete>`;
    - solo si hace falta, se aprueba con `npm install-scripts approve --no-allow-scripts-pin <paquete>`, se registra el motivo en un ADR y se actualiza `test/repository/install-scripts.spec.ts`.
  - Nunca se usa `--dangerously-allow-all-scripts`.

Ramas e integración continua (ADR-0030):

- Repositorio en GitHub con CI en GitHub Actions.
- GitHub Flow: la rama principal siempre está en estado desplegable; cada tarea se trabaja en una rama corta y se integra mediante pull request.
- La rama principal está protegida: no se fusiona un pull request si el pipeline no está en verde.
- El pipeline verifica, en orden: instalación, lint y formato, límites entre módulos, compilación, tests unitarios, tests de integración con PostgreSQL 18, migraciones, auditoría de dependencias (falla con vulnerabilidades altas y críticas), detección de secretos y construcción de la imagen de Docker.
- Dependabot abre actualizaciones de dependencias agrupadas cada semana.

Protección de `main` y Dependabot (ADR-0106):

- **Ruleset de `main`:** exige pull request, los checks `Pipeline` y `Commit messages` en verde y la rama al día con `main`. Tiene 0 aprobaciones y ninguna excepción, ni para administradores. Si GitHub pide actualizar la rama, se usa "Update branch" (o se fusiona `main` en la rama) y se espera a la CI.
- **Ruleset como código:** la definición vive en `.github/rulesets/main.json`, y `npm test` comprueba que coincide con los jobs de la CI y con ADR-0106. Para cambiarlo se edita el archivo y se aplica con `gh api --method PUT repos/Ferchoner/base-shop/rulesets/<id> --input .github/rulesets/main.json`. El `<id>` sale de `gh api repos/Ferchoner/base-shop/rulesets`. Un cambio hecho en la interfaz de GitHub se copia al archivo.
- **Dependabot** (`.github/dependabot.yml`) revisa npm y GitHub Actions los lunes a las 06:00:
  - Menores y parches de npm llegan en un solo pull request; cada versión mayor, en el suyo, y se revisa como un cambio de código (notas de la versión y tests).
  - Espera 7 días desde que se publica una versión.
  - No propone versiones mayores de `@types/node` (sigue a Node.js 24) ni de `typescript` (se queda en 6.x hasta que ts-jest, la CLI de Nest y el plugin de Swagger admitan TypeScript 7, ADR-0107). Ignorar otra versión mayor requiere registrar el motivo y actualizar el test de configuración.
  - Las actualizaciones de seguridad llegan en cuanto se publica la alerta.
- **Ramas:** se borran solas al fusionar; en local se limpian con `git fetch --prune`.

Pipeline de CI (ADR-0105): `.github/workflows/ci.yml` corre en cada pull request hacia `main` y en cada push a `main`. Tiene dos jobs: `Pipeline` (los 10 pasos) y `Commit messages` (solo en pull requests). Antes de abrir un pull request se puede repetir todo en local, con Docker en marcha:

```bash
npm ci
npm run lint:code && npm run format:check && npm run lint:boundaries
npx tsc --noEmit
npm test && npm run test:int && npm run test:e2e
npm audit --audit-level=high
docker run --rm -v "${PWD}:/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --redact --verbose
docker build --target production -t base-shop .
git log --no-merges --format=%s origin/main..HEAD | bash .github/scripts/check-commit-messages.sh
```

- La migración desde cero y la comparación con el esquema de Prisma (paso 7) van dentro de `npm run test:int`.
- En Git Bash, el comando de gitleaks necesita `MSYS_NO_PATHCONV=1` delante para que no se reescriba la ruta `/repo`; en PowerShell funciona tal cual.
- Si gitleaks reporta algo:
  - **Si es un secreto real,** se rota de inmediato y se saca del historial; nunca se ignora.
  - **Si es un falso positivo,** se agrega su huella (`Fingerprint`) a `.gitleaksignore` con un comentario que explique por qué.
- Si falla `Commit messages`, se corrigen los mensajes de la rama (por ejemplo, con `git rebase` y `reword`) y se vuelve a subir con `git push --force-with-lease`. Las pruebas del script: `bash .github/scripts/check-commit-messages.test.sh`.
- Los nombres de los jobs son los checks obligatorios de `main` (ADR-0106): cambiarlos exige actualizar `.github/rulesets/main.json` y volver a aplicarlo.
- Las actions de terceros se fijan por SHA, con la versión en un comentario (`uses: actions/checkout@<sha> # v7.0.1`).

Lint (ADR-0073, ADR-0103): `npm run lint` corre oxlint (`npm run lint:code`) y la verificación de límites entre módulos y capas (`npm run lint:boundaries`, con `dependency-cruiser`).

- Si `lint:boundaries` falla, el mensaje dice qué regla se rompió y entre qué archivos. La solución es mover el código a la capa correcta o pasar por la API pública del otro módulo (`index.ts`), no relajar la regla. Cambiar una regla requiere un ADR.
- Resumen de las reglas: Domain solo usa su domain, el shared kernel y módulos nativos de Node; Application usa su domain y application, el shared kernel y `@nestjs/common`; Infrastructure no usa presentation; Presentation no usa domain ni infrastructure; entre módulos solo por `index.ts`; Prisma solo en `platform` e `infrastructure`; el shared kernel no usa frameworks; `platform` no usa módulos; sin dependencias circulares. Los archivos de test quedan fuera.
- `test/boundaries/` tiene un proyecto de ejemplo con una violación por regla; su test comprueba que cada regla la detecta y que `src` no tiene violaciones.

Formato con Prettier (ADR-0084): `npm run format` escribe y `npm run format:check` verifica. Cubre código y configuración; la documentación Markdown queda fuera (`.prettierignore`).

Ramas y commits (ADR-0084), en inglés:

- Ramas: `tipo/T-xxx-descripcion-corta`, en minúsculas y con guiones (por ejemplo, `feat/T-100-config-validation`). Sin tarea, el ID de la decisión (`chore/p-70-...`) o solo la descripción.
- Commits: Conventional Commits, `tipo: descripción` en imperativo y en una línea corta (por ejemplo, `feat: validate environment variables at startup`). Cuerpo opcional; pie opcional con referencias (`Refs: T-100, ADR-0084`).
- Tipos: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`.

## Configuración local

- Copiar `.env.example` a `.env` y completar los valores. `.env` nunca se versiona. Sin `.env` (o sin las variables en el entorno), la API no arranca: la configuración se valida al iniciar y el error indica qué variable falta o es inválida (ADR-0032, ADR-0087).
- El código lee la configuración tipada con `ConfigService`, nunca `process.env` directamente. Las variables se declaran en `src/platform/config/environment.ts` y en `.env.example`.
- Los tests no leen `.env`: toman las variables del proceso, para que la configuración local no cambie sus resultados.
- Toda variable nueva se agrega a `.env.example` en el mismo cambio, con descripción y valor de ejemplo no real.
- `DATABASE_URL` (obligatoria) apunta al PostgreSQL de Docker Compose desde el equipo (`localhost`) y la usan la API y el CLI de Prisma. El contenedor de la API recibe su propia URL, con host `postgres`, desde `docker-compose.yml`. La contraseña de PostgreSQL no debe llevar caracteres especiales de URL (`@`, `:`, `/`, `?`, `#`) o debe ir codificada en la URL.
- El proyecto corre solo en local por ahora (ADR-0031).
- Los correos que envía la API llegan a un capturador local en Docker Compose (Mailpit) y se revisan en su bandeja web, http://localhost:8025; no salen a internet (ADR-0045). `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` y `FRONTEND_BASE_URL` tienen valores por defecto para desarrollo y son obligatorias en producción (ADR-0110).
- Webhooks de pago: requieren un túnel hacia el entorno local; estrategia de prueba pendiente (P-31).

## Entorno local con Docker

ADR-0089. Requiere Docker Desktop (o Docker Engine con Compose) en ejecución y un `.env` copiado de `.env.example`.

| Servicio | Dirección |
|---|---|
| API | `http://localhost:3000` (o el `PORT` de `.env`) |
| PostgreSQL 18 | `localhost:5432` (o `POSTGRES_PORT`), con `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB` de `.env` |
| Mailpit (bandeja web) | `http://localhost:8025` |
| Mailpit (SMTP) | `localhost:1025` |
| Swagger UI | `http://localhost:3000/docs/v1` (documento en `/docs/v1/openapi.json`); solo con `NODE_ENV=development` |

Comandos:

- Todo en contenedores: `docker compose up --build`. La API recarga sola al guardar cambios. La primera vez, y cada vez que lleguen migraciones nuevas, aplicarlas (sección Migraciones). La primera vez, cargar también el catálogo geográfico (sección Catálogo geográfico y scripts de operación).
- Solo los servicios, con la API en el equipo (suele ser más rápido en Windows): `docker compose up -d postgres mailpit` y después `npm run start:dev`.
- Después de cambiar dependencias: `docker compose up --build -V`, para regenerar el `node_modules` del contenedor.
- Detener: `docker compose down`. Los datos de PostgreSQL se conservan en un volumen.
- **Borrar los datos locales de PostgreSQL:** `docker compose down -v`. No se puede deshacer.
- Imagen de producción (la construye la CI en el paso 10, ADR-0105): `docker build --target production -t base-shop .` Incluye el CLI de Prisma (ADR-0093); cómo se aplican las migraciones al desplegar se decide con P-05 (análisis en `DATABASE.md`, sección 13).

## Migraciones

Prisma Migrate (ADR-0033, ADR-0091). El esquema está dividido por contexto en `prisma/schema/` (un archivo por contexto, más `schema.prisma` y `transversal.prisma`) y las migraciones están en `prisma/migrations/`. La configuración del CLI está en `prisma.config.ts`.

| Script | Uso |
|---|---|
| `npm run db:generate` | Genera el cliente de Prisma en `src/platform/persistence/prisma/generated/` (no se versiona). Corre solo al instalar dependencias; repetirlo después de cambiar el esquema |
| `npm run db:migrate:deploy` | Aplica las migraciones pendientes a la base de `DATABASE_URL` |
| `npm run db:migrate:dev` | Crea una migración a partir de los cambios del esquema y la aplica; solo en desarrollo |
| `npm run db:diff` | Compara la base de `DATABASE_URL` con el esquema; falla si hay diferencias |

- **Base local:** la primera vez y cada vez que lleguen migraciones nuevas, `npm run db:migrate:deploy` desde el equipo, o `docker compose exec api npm run db:migrate:deploy` con la API en el contenedor.
- **Crear una migración:**
  1. Cambiar el esquema en el archivo del contexto.
  2. `npm run db:migrate:dev -- --create-only --name <descripcion>` genera la migración sin aplicarla.
  3. Agregar el SQL manual que corresponda y revisar el SQL completo.
  4. `npm run db:migrate:dev` la aplica; después, `npm run db:diff` debe responder "No difference detected".
- **SQL manual:** lo que el esquema de Prisma no expresa se escribe en la migración: extensiones, restricciones `CHECK` (nombre `<tabla>_<descripcion>_check`), restricciones de exclusión, índices de expresión y triggers. Prisma no los genera ni los borra, así que cambiarlos o quitarlos también requiere SQL manual en una migración nueva. Los índices parciales sí van en el esquema (`where: raw("...")`, función en vista previa `partialIndexes`).
- Una migración aplicada no se edita; un error se corrige con una migración nueva (`DATABASE.md`, sección 13).
- Toda migración se revisa antes de aplicarse; las destructivas requieren aprobación humana.
- Si `npm run db:migrate:dev` propone reiniciar la base (borra todos sus datos), revisar la causa antes de aceptar.

## Catálogo geográfico y scripts de operación

ADR-0057, ADR-0109. Los estados y municipios del INEGI se cargan con un script, nunca desde la API. El archivo del catálogo está versionado en `data/inegi/` con su procedencia (`data/inegi/README.md`).

- **Cargar la base local** (la primera vez, o después de borrar sus datos):
  - con la API en el equipo: `npm run geo:import -- data/inegi/municipios-2026-06.csv`;
  - con la API en el contenedor: `docker compose exec api node dist/scripts/import-geo-catalog.js data/inegi/municipios-2026-06.csv`.
- **Ver qué cambiaría sin escribir nada:** agregar `--dry-run`.
- **Qué hace la importación:**
  - Es idempotente: repetirla no cambia nada.
  - Los municipios que faltan en un archivo nuevo se desactivan y nunca se borran; los que vuelven se reactivan.
  - Si el archivo no trae los 32 estados, tiene claves mal formadas o no está en UTF-8, termina con código 1 y no cambia nada.
  - Cada importación queda en la auditoría como `geo.catalog-imported`.
- **La API** ve el catálogo nuevo a más tardar en `CACHE_TTL_SECONDS` (120 s por defecto), porque sus respuestas están en cache.
- **Actualizar el catálogo:** pasos en `data/inegi/README.md`.
- **Scripts de operación en general:**
  - Van en `src/scripts/` y arrancan un contexto de aplicación de Nest con solo los módulos que usan.
  - Registran cada línea del resultado en el log y terminan con código 0 o 1.
  - `npm run <script>` compila antes de ejecutar. En el contenedor de desarrollo (cuyo `start:dev` compila solo) y en la imagen de producción se ejecutan con `node dist/scripts/<script>.js`.

## Pull Requests

Cada PR, con título y descripción en inglés (ADR-0084), debe explicar:

- objetivo;
- cambios;
- tests;
- migraciones;
- riesgos;
- documentación actualizada.

## Definition of Done

Una tarea está DONE cuando:

- código implementado;
- tests apropiados;
- verificaciones ejecutadas;
- documentación actualizada;
- criterios de aceptación cumplidos;
- toda variable de entorno nueva agregada a `.env.example` con descripción (ADR-0032);
- sin problemas críticos conocidos.

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

Versionado y documentación OpenAPI (ADR-0096):

- Todo controlador queda bajo `/v1` sin declararlo. Una ruta de una versión futura se marca con `@Version('2')`.
- Los DTOs se escriben en archivos `*.dto.ts`: el plugin de Swagger toma sus tipos, sus reglas de class-validator y el comentario de cada propiedad, así que no se repite `@ApiProperty`. Los comentarios de las propiedades se publican como descripción en OpenAPI y por eso van en español, como `API_SPEC.md`.
- Cada endpoint declara sus errores con `@ApiProblemResponses('not-found', 'version-conflict', …)`; los comunes (`validation-error`, `rate-limit-exceeded`, `internal-error`) se agregan solos.
- Los tests end-to-end aplican el mismo plugin (`test/swagger-plugin.cjs`), así que el documento de los tests es igual al real.

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

Ramas e integración continua (ADR-0030):

- Repositorio en GitHub con CI en GitHub Actions.
- GitHub Flow: la rama principal siempre está en estado desplegable; cada tarea se trabaja en una rama corta y se integra mediante pull request.
- La rama principal está protegida: no se fusiona un pull request si el pipeline no está en verde.
- El pipeline verifica, en orden: instalación, lint y formato, límites entre módulos, compilación, tests unitarios, tests de integración con PostgreSQL 18, migraciones, auditoría de dependencias (falla con vulnerabilidades altas y críticas), detección de secretos y construcción de la imagen de Docker.
- Dependabot abre actualizaciones de dependencias agrupadas cada semana.

Lint con oxlint (`npm run lint`, ADR-0073).

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
- Los correos que envía la API llegan a un capturador local en Docker Compose y se revisan en su bandeja web; no salen a internet (ADR-0045).
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

- Todo en contenedores: `docker compose up --build`. La API recarga sola al guardar cambios. La primera vez, y cada vez que lleguen migraciones nuevas, aplicarlas (sección Migraciones).
- Solo los servicios, con la API en el equipo (suele ser más rápido en Windows): `docker compose up -d postgres mailpit` y después `npm run start:dev`.
- Después de cambiar dependencias: `docker compose up --build -V`, para regenerar el `node_modules` del contenedor.
- Detener: `docker compose down`. Los datos de PostgreSQL se conservan en un volumen.
- **Borrar los datos locales de PostgreSQL:** `docker compose down -v`. No se puede deshacer.
- Imagen de producción (la construye la CI en T-106): `docker build --target production -t base-shop .` Incluye el CLI de Prisma (ADR-0093); cómo se aplican las migraciones al desplegar se decide con P-05 (análisis en `DATABASE.md`, sección 13).

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

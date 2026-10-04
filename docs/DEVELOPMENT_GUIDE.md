# DEVELOPMENT GUIDE

## Flujo

1. Leer `CLAUDE.md`.
2. Revisar documentación relacionada.
3. Crear/confirmar plan. El plan revisa las representaciones de `API_SPEC.md` §8 de cada vista que la tarea toca: `id` y `version` de `AdminOrder.shipment` y el `id` de las líneas de `AdminOrder` aparecieron durante la implementación (T-195, T-161). Si la tarea borra o anonimiza datos personales, el plan lista todas sus copias (tokens, enlaces, respuestas guardadas por idempotencia, archivos, contenido de eventos): en T-132 las respuestas guardadas aparecieron durante la implementación. Si la tarea cambia un mecanismo transversal (eventos, transacciones, correos), el plan revisa cómo maneja los errores cada consumidor: en T-109, que los correos atrapaban la falla del servidor de correo apareció a mitad de la implementación. Si la tarea va en partes con un ADR cada una, el plan fija el número de ADR de cada parte: en T-232 parte b, el código citó ADR-0151 antes de decidir que la parte tendría ADR-0152.
4. Implementar una tarea acotada.
5. Crear/actualizar tests.
6. Ejecutar verificaciones.
7. Actualizar documentación. Una ruta nueva, o un cambio en cómo se protege una, se revisa y se escribe en `test/security/route-matrix.ts`: la prueba de la matriz falla hasta entonces (ADR-0153). Una ruta nueva va también en la tabla de resumen de su sección de `API_SPEC.md`, y todo cambio del contrato (rutas, DTOs, descripciones o errores) se guarda con `npm run openapi:update` en `docs/openapi/v1.json`: la prueba de contrato falla hasta entonces (ADR-0155). Una sección nueva va al final de su documento: las secciones que cita el código (`DATABASE.md` §11.3) no se renumeran. Un caso de uso nuevo va también en la tabla de cobertura de `API_SPEC.md` (§21): en T-232 parte a faltó UC-SYS-02.
8. Actualizar `TASKS.md` y `PROGRESS.md`; al cerrar un sprint, también el estado de `PROJECT.md` y `README.md`, que la revisión del paso 0 incluye.
9. Crear checkpoint Git, después de revisar lo preparado y correr `npm run secrets:scan` (ver "Ramas y commits").

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
- **Enlaces por correo de un solo uso:** `newLinkToken()` da el token y su SHA-256, lo único que se guarda; `isUsableLink` dice si el enlace sirve todavía, y `InvalidOrExpiredTokenError` responde 400 `invalid-or-expired-token` sin decir por qué (ADR-0117, ADR-0148).
- **Hora actual:** se inyecta `Clock`; en tests unitarios, un objeto `{ now: () => fecha }`.
- **Fechas en la base:** las escribe la aplicación, igual que el `@updatedAt` de Prisma; no se mezclan con `now()` de PostgreSQL. El reloj del contenedor puede ir atrasado respecto al de la API, y una fecha escrita con `now()` quedaría antes que otra escrita un instante antes por la aplicación (ADR-0124).

Cache (ADR-0028, ADR-0104):

- Solo en Infrastructure o Presentation, y solo para lecturas públicas del catálogo (y datos de referencia como el catálogo geográfico). Nunca para stock en el checkout, precios al colocar una orden, pagos, carrito, permisos ni tokens.
- Se usa `AppCache`, con una clave por consulta dentro de su espacio de nombres; cada espacio se vacía por separado con `clear()`:

  ```ts
  return this.cache
    .namespace('catalog')
    .getOrLoad(`product:${slug}`, () => this.readProduct(slug));
  ```

- Todo valor vence con `CACHE_TTL_SECONDS` (120 por defecto). Si un cambio debe verse de inmediato, se invalida con un handler de eventos que vacía el espacio correspondiente.
- Cada espacio guarda hasta 1 000 valores; al pasar de ahí descarta el que se usó hace más tiempo (ADR-0129). La clave debe salir de los parámetros ya validados y normalizados, para que dos URL que piden lo mismo compartan entrada.
- Las respuestas que no guardan nada invalidable pueden usar `CacheInterceptor` de `@nestjs/cache-manager`, que tiene el mismo TTL.

Rate limiting (ADR-0065, ADR-0102):

- Todo endpoint tiene el límite general por IP. Uno con un límite de `API_SPEC.md` (sección 7) lo declara con `@RateLimit('register')` (o varios: `@RateLimit('password-reset-email', 'password-reset-ip')`), que se suma al general (ADR-0154).
- Lo que cuenta intentos fallidos usa `FailedAttemptLimiter`: el login, `assertAllowed('login-ip', ip)` antes de validar las credenciales y `recordFailure('login-ip', ip)` cuando no son válidas; el cambio de contraseña, lo mismo con `'password-change'` y el id del usuario. Nunca se limita por un email antes de comprobar la contraseña, porque cualquiera podría dejar fuera al titular (ADR-0154).
- Las pruebas end-to-end corren con `RATE_LIMIT_DEFAULT` en 1000 por minuto (`test/e2e-environment.ts`), porque arman sus datos por HTTP. Las que prueban límites fijan los suyos con las variables `RATE_LIMIT_*` antes de importar `AppModule`.
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

Eventos de dominio (ADR-0098, ADR-0150):

- **Publicar:** el caso de uso inyecta `DomainEventPublisher` y llama a `publish(evento)` dentro de `transactions.run(...)`, así el evento se guarda con el cambio y sale solo si la transacción confirma. El tipo del evento se declara en el contexto que lo produce y se exporta desde su `index.ts`.
- **Sin datos personales:** un evento guardado lleva IDs, montos y fechas, nunca un email ni una dirección. Si necesita uno y perderlo no hace daño, se publica con `publishVolatile`, que no guarda ni reintenta (`OrderAccessRequested`).
- **Contenido:** el evento se guarda como JSON. Las fechas vuelven como fechas; `Money` y otros valores con `toJSON` vuelven como su JSON, así que el handler declara `{ amount, currency }` y no `Money`.
- **Consumir:** un handler es un provider en `infrastructure` del contexto que consume, en un archivo `*.event-handler.ts`, con un método `@OnDomainEvent('NombreDelEvento')` que llama a un caso de uso de su contexto. Debe ser idempotente, porque la entrega es al menos una vez, y no puede asumir el orden respecto de otras solicitudes ni de otros eventos: un reintento llega más tarde. Para que se reintente, deja que el error suba.
- Los handlers corren en segundo plano: quien publica no espera su resultado ni se entera de sus errores. Todo efecto nuevo que el cliente vea con demora se agrega a `API_SPEC.md` (sección 2.5).
- En tests de integración, `DomainEventDispatcher.whenIdle()` espera a que terminen los handlers, incluidos los de eventos publicados por otros handlers. `deliverDue()` corre una vez el job de reintentos.
- Las entregas que agotan sus intentos quedan en FAILED: el staff las ve y las reintenta en `/v1/admin/event-deliveries`, con `events.manage` (`API_SPEC.md`, sección 22).

Logs (ADR-0097):

- Cada clase registra con su propio logger: `private readonly logger = new Logger(NombreDeLaClase.name)`. Nunca `console.log`.
- Niveles: `error` para fallos que requieren atención (con el stack trace como segundo argumento), `warn` para situaciones anómalas que el sistema resolvió, `log` para eventos normales relevantes, `debug` para detalle de diagnóstico. `LOG_LEVEL` (por defecto `log`) decide desde qué nivel se escribe.
- El identificador de correlación se agrega solo; no hace falta incluirlo en el mensaje.
- Nunca se registran datos personales (correos, nombres, direcciones, teléfonos), contraseñas, tokens, cuerpos de solicitudes ni cadenas de consulta; se registran identificadores. La redacción automática del logger es una red de seguridad, no un permiso.

Autorización (ADR-0111):

- **Rutas de `/v1/admin`:** llevan `@RequirePermissions('customers.read', …)`, con todos los permisos que exigen. **Rutas de `/v1/me`:** llevan `@RequireAccount()`, o `@RequireAccount({ customerOnly: true })` si son solo para clientes. Las demás rutas son públicas.
- Una ruta de `/v1/admin` o `/v1/me` sin su decorador responde 500 (falla cerrado), así que un olvido aparece en el primer test.
- El usuario autenticado está en `request.user` (`AuthenticatedUser`); se usa su `id`, nunca un ID de la URL, para los recursos propios (ADR-0036).
- Los permisos existen solo en `PERMISSIONS` del shared kernel. Uno nuevo se agrega ahí, con su descripción en español, y a los roles que lo necesiten; el superadministrador lo recibe solo.
- En los tests e2e de rutas protegidas, `useTestAuthentication(app)` y `.set(signedInAs(usuario))` (`test/support/test-authentication.ts`) ponen el usuario sin iniciar sesión. Los tests de la autenticación misma inician sesión con `POST /v1/auth/login` (`test/auth.e2e-spec.ts`).

Autenticación (ADR-0114):

- `request.user` lo llena el guard global de `IdentityAccessModule`, que `AppModule` importa antes que `RateLimitingModule` y `AuthorizationModule`. Un módulo con guards globales nuevos debe respetar ese orden.
- Cada solicitud autenticada lee la cuenta y la sesión, así que un cambio de estado, roles o sesión aplica desde la siguiente solicitud sin hacer nada más.
- En local, `JWT_SECRET` puede quedar vacía: la API firma con una clave aleatoria y las sesiones terminan al reiniciar. En producción es obligatoria.
- Toda contraseña nueva (registro, restablecimiento, cambio, contraseña temporal) pasa por `PasswordPolicy.assertAcceptable(contraseña, campo)`, que responde 400 `password-policy-violation` con el campo y la regla (ADR-0115). La API lee la lista de contraseñas comunes de `data/passwords/` al arrancar, relativa al directorio de trabajo; los pasos para actualizarla están en `data/passwords/README.md`.

Listados (ADR-0036, ADR-0111):

- El DTO de consulta extiende `PageQueryDto` y declara sus filtros y `sort` con `@IsSortOf(['name', 'createdAt'])`, que acepta varios campos separados por comas. Los filtros con varios valores usan `@CommaSeparated()` y `@IsIn(valores, { each: true })`. Cualquier otro parámetro se rechaza con 400.
- El controlador pasa `toSortOrders(query.sort, '-createdAt')` y la página a la consulta, y responde con `toPageResponse(page, query, toDto)`, que arma `{ data, meta }`.
- Los listados y detalles de administración leen con un puerto de consultas en la aplicación (por ejemplo, `IdentityQueries`), implementado con Prisma en la infraestructura, sin cargar agregados (ADR-0112).
- El repositorio recibe `PageRequest` y `SortOrder` del shared kernel, ordena por el campo pedido y después por el ID, para que el orden sea estable entre páginas, y devuelve `Page` (`items` y `totalItems`).

Motivo del staff (ADR-0112): las acciones que piden `reason` (suspender, reactivar…) lo pasan en `audit.record({ …, reason })`. Queda en `audit_logs.reason`, aparte de `changes`, con 1 a 500 caracteres.

Concurrencia en recursos versionados: el repositorio guarda con `updateMany({ where: { id, version } })`. Si no actualiza ninguna fila, rechaza con `VersionConflictError(versiónActual)` (409 `version-conflict`, E-05) y el cliente vuelve a leer.

Usar otro módulo (ADR-0005, ADR-0113):

- La aplicación del consumidor declara un puerto con lo que necesita, en sus propios términos (por ejemplo, `AddressLocations.check(estado, municipio)`).
- Un adaptador en la infraestructura del consumidor lo implementa con la fachada del otro módulo, importada solo desde su `index.ts`.
- El módulo del consumidor importa el módulo del otro (`imports: [GeoModule]`), que exporta su fachada.
- Domain y application nunca importan otro módulo; `lint:boundaries` lo impide.

Correos y enlaces al frontend (ADR-0045, ADR-0110):

- **Cómo enviar:** el caso de uso inyecta `EmailSender` (shared kernel) y envía `{ to, subject, text, html? }`. Siempre fuera de la transacción: después del commit, normalmente desde un handler de eventos.
- **Si falla:** `send` rechaza con `EmailDeliveryError`. Desde un handler de eventos, el error sube y la entrega del evento reintenta el correo (ADR-0150); fuera de uno, el que llama decide si el fallo cambia la respuesta, y no se reintenta.
- **Enlaces:** se arman con `FrontendLinks.link('/ruta', { token })`, nunca concatenando `FRONTEND_BASE_URL` a mano, para que los parámetros vayan codificados.
- **Enlaces con token (ADR-0117):** el token sale de `newLinkToken()` y se guarda solo su hash. Las páginas son `/verify-email` y `/reset-password` (ADR-0118); `isUsableLink` decide si un enlace sirve. En local, el enlace se lee en Mailpit (`http://localhost:8025`) y su token se envía directamente a la API.
- **Avisos de la cuenta:** los avisos de cambio (contraseña, email) atrapan el fallo del envío y lo registran sin la dirección, porque el cambio ya ocurrió.
- **Qué no se registra:** el destinatario, el asunto y el cuerpo nunca van al log; el adaptador solo registra el identificador del mensaje.
- **Tests:** los que envían correos usan Mailpit real con Testcontainers y leen el mensaje por su API (`smtp-email-sender.int-spec.ts`).

Versionado y documentación OpenAPI (ADR-0096):

- Todo controlador queda bajo `/v1` sin declararlo. Una ruta de una versión futura se marca con `@Version('2')`.
- Los DTOs se escriben en archivos `*.dto.ts`. El plugin de Swagger toma sus tipos, sus reglas de class-validator y el comentario de cada propiedad, así que en los campos simples no se repite `@ApiProperty`. Los comentarios de las propiedades se publican como descripción en OpenAPI y por eso van en español, como `API_SPEC.md`.
- Se declara de forma explícita lo que el plugin solo deduce con el análisis de tipos de `nest build` (ADR-0109):
  - la respuesta de éxito de cada endpoint, con `@ApiOkResponse({ type })` o `@ApiCreatedResponse({ type })`;
  - los campos de un DTO que contienen otros DTO, con `@ApiProperty({ type: () => [OtroDto] })`;
  - las listas, las fechas y los campos que pueden ser `null` (ADR-0112), por ejemplo `@ApiProperty({ type: String, format: 'date-time', nullable: true })`.
- Cada endpoint declara sus errores con `@ApiProblemResponses('not-found', 'version-conflict', …)`; los comunes (`validation-error`, `rate-limit-exceeded`, `internal-error`) se agregan solos. Los de un controlador se suman a los de cada manejador, y `@Idempotent` agrega los de idempotencia (ADR-0155).
- El documento de `v1` está versionado en `docs/openapi/v1.json` (ADR-0155). `test/api-contract.e2e-spec.ts` lo compara con el generado, y comprueba que las tablas de `API_SPEC.md` listen las mismas rutas y accesos que la aplicación y que cada operación documente su autenticación, sus accesos denegados y sus errores según la matriz de rutas. `npm run openapi:update` lo regenera, con Docker en marcha.
- Un DTO no redeclara con decorador un campo de su clase base: TypeScript lo rechaza (TS2612), y `declare` no admite decoradores. Cada vista que necesita otro tipo declara su propio campo, como `payment` y `shipment` en las vistas de la orden (T-195).
- Los tests end-to-end aplican el mismo plugin (`test/swagger-plugin.cjs`). Como ts-jest compila archivo por archivo, el plugin no deduce ahí los tipos de retorno ni los campos con otros DTO; declarándolos de forma explícita, el documento de los tests coincide con el real.

Errores HTTP y validación (ADR-0095):

- Toda respuesta de error es Problem Details; la arma el filtro global de `src/platform/http/problem-details/`, así que los controladores no construyen respuestas de error.
- Un tipo de error nuevo se agrega a la vez al catálogo de `problem-types.ts` (estado y textos en español) y a `API_SPEC.md` (sección 6.2); un test falla si no coinciden.
- Los errores que no son de dominio (autenticación, idempotencia, rate limiting) se lanzan con `ProblemException(code, extensiones, encabezados)`.
- Los DTOs se validan con class-validator. Los mensajes en español salen de una tabla por regla; si un campo necesita un texto propio, se indica en el decorador: `@Matches(/^\d{5}$/, { context: { message: 'Debe tener 5 dígitos.' } })`.
- El pipe corre todas las reglas de un campo y reporta una: la de presencia o la de tipo si fallan; si no, la primera que falla (ADR-0130). Por eso el orden de los decoradores no cambia la regla reportada. Una regla propia (`ValidateBy`) debe aceptar un valor de cualquier tipo, porque corre aunque el tipo falle.

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
- Las fechas las pone la aplicación con `Clock`. Cada plan decide si una operación lee el reloj una sola vez, para que sus fechas coincidan: en T-190 parte b, la cancelación y el inicio del reembolso lo leen por separado, y sus fechas difieren por milisegundos.
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
- Pruebas de concurrencia obligatorias para reservas de inventario y checkout. El patrón: un cliente `pg` aparte bloquea la fila, se lanzan las operaciones, `waitForLockWaiters(n)` (`test/support/lock-waiters.ts`) espera a que queden bloqueadas y se libera la fila. Esa espera consulta `pg_stat_activity` fuera de toda transacción: dentro de una, PostgreSQL responde con una foto tomada en la primera lectura.
  - Lo que se bloquea en el test es lo que las operaciones van a escribir, no el candado que las protege. Así, sin ese candado las operaciones llegan juntas al punto crítico y el test falla (ADR-0120). Si el test retiene el propio candado, las operaciones solo esperan en fila, y el test pasa también sin él.
- Una consulta que recorre muchas filas (listados, búsquedas, reportes) se mide con datos grandes desde el primer borrador. Un test de integración temporal, que no se versiona, inserta miles de filas con `generate_series` y toma el tiempo de cada variante: así apareció en T-140c una página que tardaba 666 ms (ADR-0129).
- Una prueba de respuestas de error idénticas compara los Problem Details sin `correlationId` ni `instance`, que cambian en cada solicitud (T-185, T-181).
- Los ayudantes de las e2e reciben el código esperado cuando una ruta responde distinto según el estado: agregar al carrito responde 201 al crearlo y 200 si ya existe.
- Un error de dominio con `details` se compara con `rejects.toMatchObject({ code, details })`. `toThrow(new Error(…))` solo compara el mensaje: la prueba del tope del reintegro pasaba con otras líneas en el error (T-161).
- Los datos de prueba usan valores distintos donde el código elige entre ellos (T-215). Un reembolso igual al total de la orden, una dirección sin número interior o un solo tipo de despacho dejaron pasar mutaciones.
- Cada filtro de un listado se prueba por separado, con datos que solo ese filtro distingue: `resourceType` y `resourceId` probados juntos dejaron pasar dos mutaciones (T-220).
- Si el código agrupa o corta por día, las pruebas usan instantes que caen en días distintos en UTC y en México, como las 03:00 UTC (T-220).
- En las e2e, un límite por email cuenta durante toda la suite, así que cada prueba usa su propio email. Los correos de la orden llegan al mismo `EmailSender` falso que los demás: una prueba de otro correo lo filtra por su asunto (T-186).
- Las pruebas de mutación de cada tarea quitan o limitan los mutantes que pueden no terminar, como cambiar el orden de una lectura por lotes (T-220).
- Una tabla que llenan todas las suites, como el outbox de eventos (`domain_events`), se vacía antes de cada prueba que la cuenta o la recorre (T-109).
- `npx tsc --noEmit` compila también las specs de integración y e2e: al quitar un campo de una firma, se busca en ellas antes del commit. En T-161, el commit feat no compilaba por sí solo.
- `configureHttp` construye y revisa el documento OpenAPI fuera de producción (paso 0 del Sprint 6): construirlo falla con un DTO que no puede describir, y cada `$ref` debe tener su esquema. Así, toda suite e2e lo construye con el plugin de Swagger, y un DTO que lo rompe falla en su propia suite. Aun así, antes de cada commit se corre la suite e2e completa.
  - Una propiedad que es un arreglo de valores simples declara `@ApiProperty({ type: [String] })`: el plugin de Swagger no infiere su tipo, y sin él la construcción del documento falla (T-181).
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
npm run secrets:scan
docker build --target production -t base-shop:ci . && docker build --target migrate -t base-shop-migrate:ci .
bash .github/scripts/smoke-test-images.sh base-shop:ci base-shop-migrate:ci
git log --no-merges --format=%s origin/main..HEAD | bash .github/scripts/check-commit-messages.sh
```

- La migración desde cero y la comparación con el esquema de Prisma (paso 7) van dentro de `npm run test:int`.
- `npm run secrets:scan` (ADR-0119, ADR-0156) corre gitleaks con Docker, igual que la CI: primero sobre los cambios preparados (`secrets:scan:staged`) y después sobre todo el historial (`secrets:scan:history`), y se detiene en el primer hallazgo. Oculta los secretos en la salida (`--redact`). La imagen está fijada por digest solo en `package.json`; para actualizarla se cambian los dos scripts, y el test `test/repository/secrets-scan.spec.ts` comprueba que la CI siga usando el mismo comando.
  - `scripts/secrets-scan.ts` arma el comando de Docker. Monta en solo lectura el directorio de trabajo y el directorio de git compartido (`git rev-parse --git-common-dir`), así que funciona igual en un clon normal y en un worktree de git (como los de `.claude/worktrees/`), desde PowerShell, Git Bash y Linux. Se corre con `npm run`: desde Git Bash, llamar al script directamente convierte `/repo` en una ruta de Windows.
  - Falla aunque gitleaks diga "no leaks found" si git, dentro del contenedor, no lee el mismo `HEAD` que en el equipo, o si gitleaks registra un error de git (líneas `[git] …` y `stderr is not empty`). Ese error significa que no se revisó todo: se corrige la causa, nunca se ignora. Un escaneo del historial que sí lee el repositorio dice cuántos commits revisó (`N commits scanned`, más de 0).
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
- `test/boundaries/table-ownership.spec.ts` comprueba que cada módulo use solo las tablas y los modelos de Prisma de su contexto (ADR-0129). Lee el dueño de cada uno en `prisma/schema/*.prisma`; un modelo nuevo en `transversal.prisma` necesita su dueño en el test. Escribe las palabras clave de SQL en mayúsculas (`FROM`, `JOIN`, `UPDATE`, `INTO`), porque el test las busca así.

Formato con Prettier (ADR-0084): `npm run format` escribe y `npm run format:check` verifica. Cubre código y configuración; la documentación Markdown queda fuera (`.prettierignore`).

Ramas y commits (ADR-0084), en inglés:

- Ramas: `tipo/T-xxx-descripcion-corta`, en minúsculas y con guiones (por ejemplo, `feat/T-100-config-validation`). Sin tarea, el ID de la decisión (`chore/p-70-...`) o solo la descripción.
- Commits: Conventional Commits, `tipo: descripción` en imperativo y en una línea corta (por ejemplo, `feat: validate environment variables at startup`). Cuerpo opcional; pie opcional con referencias (`Refs: T-100, ADR-0084`).
- Tipos: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`.
- Antes de cada commit, con Docker en marcha (ADR-0119):
  1. `git diff --cached --stat`: comprobar que lo preparado es solo lo de ese commit. Un archivo movido con `git mv` queda preparado aunque no se haya agregado después.
  2. `npm run secrets:scan`: si encuentra algo en lo preparado, se corrige antes de commitear. Si su salida se filtra (por ejemplo, con `| tail`), se activa antes `set -o pipefail`: sin él, el filtro oculta el código de salida y el commit encadenado con `&&` se hace aunque el escaneo falle (T-195). En los tests, un valor literal junto a palabras como "password" o "key" puede parecer un secreto: se construye el valor o se cambia el nombre, en lugar de ignorarlo.

## Configuración local

- Copiar `.env.example` a `.env` y completar los valores. `.env` nunca se versiona. Sin `.env` (o sin las variables en el entorno), la API no arranca: la configuración se valida al iniciar y el error indica qué variable falta o es inválida (ADR-0032, ADR-0087).
- El código lee la configuración tipada con `ConfigService`, nunca `process.env` directamente. Las variables se declaran en `src/platform/config/environment.ts` y en `.env.example`.
- Los tests no leen `.env`: toman las variables del proceso, para que la configuración local no cambie sus resultados.
- Toda variable nueva se agrega a `.env.example` en el mismo cambio, con descripción y valor de ejemplo no real.
- `DATABASE_URL` (obligatoria) apunta al PostgreSQL de Docker Compose desde el equipo (`localhost`) y la usan la API y el CLI de Prisma. El contenedor de la API recibe su propia URL, con host `postgres`, desde `docker-compose.yml`. La contraseña de PostgreSQL no debe llevar caracteres especiales de URL (`@`, `:`, `/`, `?`, `#`) o debe ir codificada en la URL.
- El proyecto corre solo en local por ahora (ADR-0031).
- Los correos que envía la API llegan a un capturador local en Docker Compose (Mailpit) y se revisan en su bandeja web, http://localhost:8025; no salen a internet (ADR-0045). `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` y `FRONTEND_BASE_URL` tienen valores por defecto para desarrollo y son obligatorias en producción (ADR-0110).
- La tasa de IVA es `VAT_RATE_BP` (1600, el 16%, por defecto); cambiarla exige reiniciar la API y no altera órdenes colocadas (ADR-0027, ADR-0122).
- Una reserva de stock dura `RESERVATION_TTL` (`20m` por defecto, de 5m a 2h, BR-INV-07, ADR-0128).
- Las imágenes de producto se guardan en `IMAGE_STORAGE_DIR` (`./storage/images` por defecto, fuera de Git) y la API las sirve en `http://localhost:3000/media` (ADR-0121). `IMAGE_BASE_URL` es obligatoria en producción.
- Los archivos de la auditoría van a `AUDIT_ARCHIVE_DIR` (`./storage/audit` por defecto, fuera de Git), que la API nunca sirve (ADR-0146). Se leen con `gunzip -c storage/audit/audit-AAAA-MM-DD*.jsonl.gz`; si un día tiene más de un archivo, los registros repetidos tienen el mismo `id`.
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
| Imágenes de producto | `http://localhost:3000/media/<clave>`, desde `./storage/images` |

Comandos:

- Todo en contenedores: `docker compose up --build`. La API recarga sola al guardar cambios. La primera vez, y cada vez que lleguen migraciones nuevas, aplicarlas (sección Migraciones). La primera vez, cargar también el catálogo geográfico (sección Catálogo geográfico y scripts de operación).
- Solo los servicios, con la API en el equipo (suele ser más rápido en Windows): `docker compose up -d postgres mailpit` y después `npm run start:dev`.
- Después de cambiar dependencias: `docker compose up --build -V`, para regenerar el `node_modules` del contenedor.
- Detener: `docker compose down`. Los datos de PostgreSQL se conservan en un volumen.
- **Borrar los datos locales de PostgreSQL:** `docker compose down -v`. No se puede deshacer.
- Imagen de producción (la construye la CI en el paso 10, ADR-0105): `docker build --target production -t base-shop .` No trae el CLI de Prisma (ADR-0147), y sus dependencias se instalan sin dependencias par: una dependencia de ejecución nueva se declara en `dependencies`. Las migraciones se aplican con otra imagen, `docker build --target migrate -t base-shop-migrate .`, como paso único antes de arrancar la API; P-05 decide cómo se ejecuta al desplegar (`DATABASE.md`, sección 13). `.github/scripts/smoke-test-images.sh` migra un PostgreSQL 18 desechable con una y arranca la otra contra él; necesita Docker y funciona en Git Bash y Linux. Crea `/app/storage/images` y la carpeta privada `/app/storage/audit` con dueño `node`: al desplegar se monta un volumen persistente en `/app/storage`, que debe ir en los respaldos (ADR-0024, ADR-0121, ADR-0146).

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
- **Datos iniciales:** los que el sistema necesita para funcionar van en migraciones de datos que no sobrescriben lo que ya exista, como los roles iniciales (ADR-0111) y el método de envío (ADR-0122). Al agregar una, conviene buscar las pruebas que crean la misma clase de filas, porque pueden chocar con ella; por ejemplo, con una segunda lista predeterminada o un segundo almacén activo.
- **Rellenos de datos:** una migración que llena columnas de filas existentes, como `orders.concluded_at` y `users.last_active_at` en T-232, dice en su plan cómo se prueba ese relleno con filas preparadas como estaban antes. Las pruebas migran una base vacía, así que no lo ejercitan; T-300 define la forma.
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
- **Primer superadministrador** (UC-IAM-20, ADR-0116), después de las migraciones:
  - con la API en el equipo: completar `SUPERADMIN_EMAIL`, `SUPERADMIN_FIRST_NAMES` y `SUPERADMIN_LAST_NAMES` en `.env` y correr `npm run superadmin:create`;
  - con la API en el contenedor: `docker compose exec -e SUPERADMIN_EMAIL=… -e SUPERADMIN_FIRST_NAMES=… -e SUPERADMIN_LAST_NAMES=… api node dist/scripts/create-first-superadmin.js`, o las variables en `.env` antes de levantar el contenedor;
  - el script muestra la contraseña temporal una sola vez; se inicia sesión con ella y se cambia con `POST /v1/me/password`;
  - si ya hay un superadministrador activo, se niega: el resto del staff se da de alta por la API.
- **Scripts de operación en general:**
  - Van en `src/scripts/` y arrancan un contexto de aplicación de Nest con solo los módulos que usan.
  - Registran cada línea del resultado en el log y terminan con código 0 o 1.
  - `npm run <script>` compila antes de ejecutar. En el contenedor de desarrollo (cuyo `start:dev` compila solo) y en la imagen de producción se ejecutan con `node dist/scripts/<script>.js`.
- **Scripts de mantenimiento:** también van en `src/scripts/`, pero no usan Nest ni la base. Por ejemplo, `npm run passwords:build -- <lista descargada>` regenera la lista de contraseñas comunes (ADR-0115).

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

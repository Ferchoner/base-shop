# SPRINT

## Sprint actual

Ninguno. El proyecto se cerró como MVP el 2026-10-04, en la review del Sprint 9 (ADR-0158), y se publicó como la versión 1.0.0. No habrá otro sprint hasta que una entidad quiera usarlo; mientras tanto, el desarrollo sigue por versiones, cada una con su plan aprobado (ADR-0159).

## Versión en curso

1.3 — Pago en tienda configurable desde la API. Inicio: 2026-10-06 (plan aprobado ese día).

### Goal

Que el backoffice sepa si el pago manual, el cobro de la tienda física, está habilitado, y que un superadministrador lo encienda o lo apague sin desplegar. El valor pasa de la variable `MANUAL_PAYMENTS_ENABLED` a la base, con una ruta para consultarlo y otra para cambiarlo, reservada al superadministrador (ADR-0162).

### Tasks

| Paso | Tareas |
|---|---|
| 0 | Revisión contra los ADR; `npm audit`; versión de Prisma; prácticas de la review de la versión 1.2 en la guía de desarrollo |
| 1 | T-194: el pago manual en la base; `GET` y `PUT /v1/admin/payment-settings`; permiso `payments.configure`, reservado al superadministrador; los correos leen el valor al enviarse; sin `MANUAL_PAYMENTS_ENABLED` |

- **Criterio de cierre:** los criterios de aceptación de T-194, que fija su plan; la CI en verde en `main`; y la versión 1.3.0 publicada con su tag y su GitHub Release (ADR-0159).
- **Fuera de esta versión:** otras configuraciones de la tienda editables desde la API, otros permisos reservados y el segundo factor del staff (ADR-0048); y todo lo que ADR-0158 dejó fuera del MVP.
- **Flujo de trabajo:** el de las versiones 1.1 y 1.2. T-194 va en su rama y su pull request, con el plan de ADR-0162. El último pull request sube la versión a 1.3.0.

### Resultado del paso 0

- **Revisión contra los ADR:** los 162 ADR del índice tienen su sección, y no hay referencias a ADR, tareas, decisiones, reglas, casos de uso ni errores que no existan. Su única alerta es un script que no existe, citado entre las alternativas descartadas de ADR-0122.
- **Dependencias:**
  - `npm audit` no encuentra vulnerabilidades en las dependencias de producción. En las de desarrollo sigue el aviso moderado de `sprintf-js`, que llega con Jest y ninguna versión corrige (review de la versión 1.1): `npm audit` lo cuenta una vez por cada paquete de Jest que lo trae;
  - Prisma 7.10.0 sigue siendo la última versión estable (la 8 sigue en versión candidata, 8.0.0-rc.20);
  - Dependabot sigue en pausa, salvo las actualizaciones de seguridad (ADR-0158).
- **Guías:** `DEVELOPMENT_GUIDE.md` suma las prácticas de la review de la versión 1.2:
  - un método que devuelve una promesa es `async`, para que todo error llegue como rechazo;
  - al agregar un campo a una respuesta, se buscan antes las pruebas que la comparan completa.

### Resultado del paso 1

T-194 (ADR-0162); T-194 queda en DONE.

- **El valor en la base:** `payment_settings`, con una fila de clave fija que un CHECK mantiene sola, creada deshabilitada. Payments la lee en cada pago y reembolso manual y en cada inicio de un pago `MANUAL`, sin caché, y Notifications la pregunta al escribir el correo de orden recibida.
- **Rutas:** `GET /v1/admin/payment-settings`, con `orders.read`, y `PUT`, con `payments.configure`, versión y auditoría `payment-settings.update`. Sin cambios no se guarda ni se audita.
- **Permiso reservado:** `payments.configure` solo lo tiene el rol superadministrador; otro rol con él responde 400 `superadminOnly` (BR-USR-21), y el catálogo de permisos lo marca con `superadminOnly`.
- **Sin la variable:** `MANUAL_PAYMENTS_ENABLED` sale del entorno, de `.env.example` y de las pruebas, y una que quede en el entorno no impide arrancar. El texto del 403 `manual-payments-disabled` dice que un superadministrador lo habilita.
- **Pruebas:** las e2e encienden el pago manual en la base antes de cada archivo; una prueba con dos conexiones comprueba que de dos cambios con la misma versión gana uno.

### Risks

- **El cobro de la tienda en una cuenta de staff:** encenderlo pasa a depender del superadministrador, que no tiene segundo factor (ADR-0048). Lo atenúan el permiso reservado y la auditoría (ADR-0162).
- **Reembolsos pendientes con el pago apagado:** no se registran hasta encenderlo otra vez, como con la variable (ADR-0135).
- **Cambio para el operador:** `MANUAL_PAYMENTS_ENABLED` deja de existir, y después de migrar el pago manual queda apagado. Hoy no hay despliegues; queda en `CHANGELOG.md`.
- **Cambios de contrato:** todos compatibles dentro de `/v1`, y cada uno queda en `API_SPEC.md`, en `docs/openapi/v1.json` y en `CHANGELOG.md`.

### Review

PENDIENTE.

---

## Cierre del MVP

- **Periodo:** 10 sprints, del Sprint 0 (desde el 2026-09-24) al Sprint 9 (hasta el 2026-10-04).
- **Qué incluye:** el alcance de `PROJECT.md` (§3), en 126 rutas de `/v1`:
  - identidad y acceso, con roles y permisos;
  - catálogo con tienda pública, precios con historial, e inventario con reservas;
  - carrito, checkout y órdenes, también de invitados;
  - el pago manual en tienda, solo para pruebas, con reembolsos;
  - envíos, correos al cliente y auditoría técnica;
  - privacidad: aviso versionado, anonimización y ciclo de conservación de los datos personales;
  - entrega garantizada de eventos.
- **Cómo se construyó:** 96 pull requests fusionados en `main`, cada uno con la CI en verde; 2,409 tests, con la cobertura de la suite sobre su umbral; y 158 ADR.
- **Fuera del MVP:** las tareas T-191, T-192, T-193, T-200 y T-330, y las decisiones P-05, P-06, P-07, P-13, P-14, P-24, P-31 y P-69 (ADR-0158).
- **Riesgos del cierre:**
  - el MVP no cobra a clientes reales: no tiene proveedor de pago en línea;
  - mientras dure la pausa de Dependabot, solo llegan las actualizaciones de seguridad, y las dependencias se atrasan;
  - los riesgos de las reviews de los sprints siguen vigentes al retomar el proyecto.
- **Para retomarlo:** los cuatro pasos de ADR-0158. Primero, la lista de `PROJECT.md` (§9) con la entidad que lo use; después, quitar la pausa de Dependabot y poner al día las dependencias; luego, una revisión contra los ADR; y al final, el primer sprint, con las tareas diferidas que esa entidad necesite.

---

## Historial

### Versión 1.2 — Ventas asistidas en la tienda física (2026-10-06)

**Goal:** que el staff coloque pedidos a nombre de un cliente presente en la tienda física: con envío, como en la tienda en línea, o como venta de mostrador, en la que el cliente paga y se lleva la mercancía en el momento. Cada pedido registra quién lo colocó y por qué canal, sale del almacén de la tienda y se cobra con el pago en tienda, que deja de ser solo para pruebas (ADR-0161). **Tareas:** T-187, en dos partes, precedida por un paso 0.

**Fecha:** 2026-10-06. **Resultado:** objetivo cumplido. T-187 está en DONE, el pipeline de CI está en verde en `main`, y la versión se publica como la 1.2.0, con su tag y su GitHub Release (ADR-0159).
- El staff con `orders.place` cotiza y coloca pedidos a nombre de un cliente registrado, de un invitado o, en el mostrador, de un comprador que no da datos.
- Cada pedido guarda quién lo colocó, por qué canal y de qué almacén sale, y se audita.
- El pago en tienda es el cobro real de la tienda física, y guarda cómo se cobró.
- La venta de mostrador no tiene dirección ni envío: el vendedor la entrega en la tienda en cuanto se paga.

#### Entregables

| Entregable | Estado | Referencia |
|---|---|---|
| Plan de la versión con el nuevo ADR-0161; revisión contra los ADR sin desajustes; 0 vulnerabilidades en las dependencias de producción; prácticas de la review de la versión 1.1 en la guía; BR-USR-09 corregida | DONE | Paso 0, pull request #107 |
| Pedidos del staff a nombre de un cliente (UC-ORD-12 y UC-ORD-13): permiso `orders.place` y rol Vendedor; canal, quién colocó y almacén fijo; auditoría y filtros | DONE | T-187 parte a, pull request #108 |
| Pago en tienda real, con su método: efectivo, terminal o transferencia | DONE | T-187 parte a, pull request #109 |
| Venta de mostrador sin dirección ni envío, con un comprador opcional, y su entrega en la tienda (UC-ORD-14) | DONE | T-187 parte b, pull request #110 |
| 131 rutas de `/v1`, 3 de ellas nuevas; los cambios de contrato son compatibles, salvo la excepción acotada a ADR-0034 | — | `API_SPEC.md`, `docs/openapi/v1.json` |
| 2,532 tests (1,469 unitarios, 492 de integración y 571 end-to-end), 68 más que en la versión 1.1; cobertura de 98.86% de sentencias, 84.5% de ramas, 99.18% de funciones y 99.46% de líneas; 0 secretos en el historial | — | CI |
| Dependencias: 0 vulnerabilidades en las de producción; en las de desarrollo, el mismo aviso moderado de `sprintf-js`, sin versión corregida | — | `npm audit` |
| 161 ADR: 157 aceptados, 2 reemplazados (ADR-0014 y ADR-0081) y 2 reemplazados parcialmente (ADR-0001 y ADR-0077); 1 nuevo en esta versión (ADR-0161) | — | `DECISIONS.md` |
| Siguen abiertas 8 decisiones | — | `PROGRESS.md` |

El trabajo se integró en 4 pull requests a `main` (del #107 al #110). El pipeline pasó en los 4 y en `main` después de cada fusión. En el #107, la primera corrida se canceló al traer `main` a la rama, y la siguiente pasó.

#### Decisiones abiertas

Las mismas 8 del cierre del MVP, que quedaron fuera de él (ADR-0158); ver la review del Sprint 9. Ninguna bloquea lo construido en esta versión. La lista de `PROJECT.md` §9 suma la validación legal de que el staff capture datos personales en la tienda física (ADR-0161).

#### Riesgos

- **Resueltos en esta versión:**
  - **Copias de datos personales:** la anonimización borra la respuesta que el staff guardó al colocar la orden, por la ruta y el `id` de la orden, sin tocar sus demás respuestas.
  - **La última unidad de la tienda:** una prueba con dos conexiones comprueba que va a un solo pedido.
  - **Cambios de contrato:** rutas, campos y filtros nuevos, compatibles dentro de `/v1`, y cada uno está en `API_SPEC.md`, en el OpenAPI y en `CHANGELOG.md`. La única excepción es la acotada a ADR-0034, que decidió ADR-0161.
- **Heredados, siguen vigentes:** los del cierre del MVP y los de las reviews de los sprints y de la versión 1.1, entre ellos el aviso moderado de `sprintf-js`, que ninguna versión corrige.
- **Nuevos:**
  - **Fraude interno:** registrar un cobro sin recibir el dinero. Lo atenúan el permiso separado del cobro, la auditoría y el filtro por vendedor (ADR-0161). Mientras no haya caja ni cortes de caja, nada compara lo cobrado con lo registrado.
  - **Datos personales capturados por el staff:** necesitan la validación legal de `PROJECT.md` §9 antes de operar con clientes reales.
  - **Más cuentas de staff sin segundo factor** (ADR-0048), ahora con el rol Vendedor.
  - **Órdenes sin dirección:** un cliente de la API que suponga que toda orden tiene `shippingAddress` y `estimatedDelivery` falla con una orden `IN_STORE`, también con la de un cliente registrado al que el staff le vendió en el mostrador.
  - **Venta sin datos:** el comprador anónimo no recibe correos ni consulta su pedido como invitado. Mientras no haya factura, su comprobante queda fuera del sistema (ADR-0161).

#### Qué funcionó

- **Un plan por parte, aprobado antes de implementarla:** la versión se construyó en un día, en 4 pull requests, sin rehacer el diseño. La parte a se partió en dos, el pedido del staff y el método del pago, cada uno con su migración.
- **Compartir la colocación con el checkout:** `OrderPlacement` da a la tienda en línea y al staff los mismos precios, envío, comprador, dirección y código público. La venta de mostrador solo cambió el envío y el comprador.
- **La política de asignación aparte (ADR-0160):** el almacén fijo entró como otra política, sin tocar la reserva ni el reintegro, como anticipó la review de la versión 1.1.
- **Restricciones en la base como última guarda:** `orders_channel_check`, `payment_attempts_method_check` y `orders_fulfillment_check` rechazan una orden o un pago incoherentes aunque el código fallara. En la parte b, los 4 mutantes de la migración cayeron con pruebas de integración.
- **Las prácticas de la review de la versión 1.1:** las tablas de `API_SPEC.md` y el OpenAPI fueron en el commit de cada ruta nueva, y cada mutante corrió con la suite que tiene su prueba.
- **Pruebas de mutación:**

  | Parte | Sobrevivieron | Causa |
  |---|---|---|
  | T-187 parte a, primer pull request | 1 de 62 | Un mutante equivalente: quitar `status = 'COMPLETED'` del borrado de las respuestas guardadas. Una clave en curso no guarda respuesta, así que borrarla tampoco cambia nada |
  | T-187 parte a, segundo pull request | 0 de 15 | — |
  | T-187 parte b | 0 de 38 | — |

  El plan (#107) solo cambió documentación.

#### Qué mejorar

- **Un método que lanza antes de devolver su promesa:** la colocación del staff validaba y lanzaba antes de devolver la promesa, así que el error no llegaba como rechazo. Lo encontraron las pruebas, y el método pasó a `async`. Un método que devuelve una promesa es `async`, para que todo error llegue como rechazo.
- **Un campo nuevo en una respuesta compartida:** `fulfillment` rompió la comparación completa de la orden en `test/checkout.e2e-spec.ts`, una suite que no se corría al implementar la parte b. La encontró la primera corrida completa. Al agregar un campo a una respuesta, se buscan las pruebas que la comparan completa antes de esa corrida.

#### Resultado del paso 0

- **Revisión contra los ADR:** los 161 ADR del índice tienen su sección, y no hay referencias a ADR, tareas, decisiones, reglas, casos de uso ni errores que no existan.
- **Dependencias:**
  - `npm audit` no encuentra vulnerabilidades en las dependencias de producción. En las de desarrollo sigue el aviso moderado de `sprintf-js`, que llega con Jest y ninguna versión corrige (review de la versión 1.1);
  - Prisma 7.10.0 sigue siendo la última versión estable (la 8 sigue en versión candidata, 8.0.0-rc.20);
  - Dependabot sigue en pausa, salvo las actualizaciones de seguridad (ADR-0158).
- **Guías:** `DEVELOPMENT_GUIDE.md` suma las prácticas de la review de la versión 1.1:
  - las tablas de `API_SPEC.md` y el documento OpenAPI de una ruta nueva van en el mismo commit que la ruta;
  - una prueba de un orden usa datos que darían otro resultado con cualquier otro orden;
  - cada mutante corre con la suite que tiene su prueba.
- **Reglas:** BR-USR-09 decía que solo un superadministrador crea staff; ahora sigue a ADR-0116 y ADR-0154, que lo permiten a quien tenga `staff.manage`.

#### Resultado del paso 1 (parte a, primer pull request)

T-187 parte a (ADR-0161), sin el método del pago en tienda, que llega en el segundo pull request:

- **Permiso y rol:** `orders.place`, que recibe también el Administrador, y el rol Vendedor, que no registra pagos.
- **Rutas:** `POST /v1/admin/orders/quote` y `POST /v1/admin/orders`, con las líneas en la solicitud, para un cliente registrado o un invitado. Comparten con el checkout los precios, el envío, el comprador, la dirección y el código público.
- **Almacén fijo:** la cotización, la reserva, el pago tardío y el reintento de surtido usan solo el almacén que eligió el staff. Uno inactivo responde 404 al colocar, y cuenta como falta de stock al reservar otra vez. Una prueba con dos conexiones comprueba que la última unidad de la tienda va a un solo pedido.
- **La orden:** guarda `channel`, `placedBy` y `warehouseId`; `orders_channel_check` lo exige en la base. El historial lleva al staff, se audita como `orders.place`, y el listado filtra por canal y por quién la colocó.
- **Sin carrito:** una orden vencida no restaura ninguno, y la anonimización borra la respuesta que guardó el staff, solo la de esa orden.
- **Correo:** el de una orden de la tienda no dice cómo pagar en la tienda ni hasta cuándo se apartan los productos.

#### Resultado del paso 1 (parte a, segundo pull request)

T-187 parte a queda hecha (ADR-0161):

- **Pago en tienda real:** deja de ser solo para pruebas en el código, `.env.example` y la documentación. `MANUAL_PAYMENTS_ENABLED` sigue apagado por defecto: el operador lo enciende cuando la tienda cobra.
- **Método:** `manual-capture` acepta `method`, opcional para no romper `/v1`: `CASH`, `CARD_TERMINAL` o `TRANSFER`. Lo guarda el intento capturado, con una restricción en la base, y lo muestran `AdminPayment` y `AdminOrder.payment`. La auditoría lo registra.
- **Sin cambios:** el reembolso manual.

#### Resultado del paso 2

T-187 parte b (ADR-0161); T-187 queda en DONE.

- **Venta de mostrador:** la cotización y la colocación del staff aceptan `fulfillment` `IN_STORE`. La orden no tiene dirección, costo de envío ni plazo, y su comprador puede no dar datos.
- **Entrega en la tienda:** una orden `IN_STORE` pagada no crea envío, y `POST …/hand-over` la lleva de Paid a Delivered, con el vendedor en el historial y auditada.
- **Base de datos:** `orders_fulfillment_check` exige la dirección y el plazo a una orden que se envía, y los quita, con el costo de envío, a una que se entrega en la tienda. Las restricciones del email y del aviso admiten la venta sin datos solo ahí.
- **Contrato:** `fulfillment` es un campo nuevo; `shippingAddress` y `estimatedDelivery` salen `null` en una orden `IN_STORE`, la excepción acotada a ADR-0034.
- **Correos:** los de una venta de mostrador dicen que se entrega en la tienda, sin plazo; sin email no hay correos.

#### Siguiente versión

Ninguna en curso: la siguiente necesita un plan aprobado (ADR-0159). La 1.2 dejó fuera la caja y los cortes de caja, la factura CFDI, el apartado, recoger en tienda los pedidos en línea y el segundo factor del staff (ADR-0161). Las prácticas de esta review entran a `DEVELOPMENT_GUIDE.md` en el paso 0 de la siguiente versión, como las de la 1.1.

### Versión 1.1 — Varios almacenes propios (2026-10-05 a 2026-10-06)

**Goal:** operar varios almacenes propios. Cada orden sale completa del almacén de mayor prioridad que la cubre, la tienda suma la disponibilidad de todos, el stock vuelve al almacén del que salió, y el staff administra los almacenes. El diseño queda preparado para dividir pedidos más adelante, sin hacerlo (ADR-0160). **Tareas:** T-162, en dos partes, precedida por un paso 0.

**Fecha:** 2026-10-06. **Resultado:** objetivo cumplido. T-162 está en DONE, el pipeline de CI está en verde en `main`, y la versión se publica como la 1.1.0, con su tag y su GitHub Release (ADR-0159).
- Cada orden se reserva completa en el primer almacén activo, por prioridad, que la tiene toda, y su envío sale de ese almacén.
- La tienda, el carrito y la cotización ven todos los almacenes activos, sin duplicar productos.
- El staff crea almacenes, cambia su prioridad y los desactiva. Ninguna reserva queda en un almacén inactivo, y siempre queda un almacén activo.
- El stock reintegrado vuelve al almacén del que salió, y las transferencias se registran como ajustes con `WAREHOUSE_TRANSFER`.

#### Entregables

| Entregable | Estado | Referencia |
|---|---|---|
| Plan de la versión con el nuevo ADR-0160; revisión contra los ADR sin desajustes; 0 vulnerabilidades; prácticas de la review del Sprint 9 en la guía | DONE | Paso 0, pull request #103 |
| Varios almacenes activos con prioridad; cada orden reservada completa en un almacén; tienda, carrito y cotización con todos los almacenes activos; envío desde el almacén de la reserva | DONE | T-162 parte a, pull request #104 |
| Crear, priorizar y desactivar almacenes (UC-INV-10 y UC-INV-11); reintegro al almacén de origen; `WAREHOUSE_TRANSFER`; envíos filtrados por almacén | DONE | T-162 parte b, pull request #105 |
| `proxy-addr` 2.0.8, una actualización de seguridad de Dependabot | DONE | Pull request #102 |
| 128 rutas de `/v1`, 2 de ellas nuevas; todos los cambios de contrato son compatibles | — | `API_SPEC.md`, `docs/openapi/v1.json` |
| 2,464 tests (1,428 unitarios, 477 de integración y 559 end-to-end), 55 más que en el Sprint 9; cobertura de 98.81% de sentencias, 84.18% de ramas, 99.16% de funciones y 99.43% de líneas; 0 secretos en el historial | — | CI |
| Dependencias: 0 vulnerabilidades en las de producción; 1 aviso moderado en las de desarrollo, sin versión corregida | — | `npm audit` |
| 160 ADR: 156 aceptados, 2 reemplazados (ADR-0014 y ADR-0081) y 2 reemplazados parcialmente (ADR-0001 y ADR-0077); 1 nuevo en esta versión (ADR-0160) | — | `DECISIONS.md` |
| Siguen abiertas 8 decisiones | — | `PROGRESS.md` |

El trabajo se integró en 3 pull requests a `main` (del #103 al #105), y el usuario fusionó el #102 de Dependabot. El pipeline pasó a la primera en los 4.

En `main` falló una vez, al fusionar el #103: la auditoría de dependencias encontró un aviso crítico nuevo de `proxy-addr`. El #102 lo corrigió 9 minutos después, y desde entonces `main` sigue en verde.

#### Decisiones abiertas

Las mismas 8 del cierre del MVP, que quedaron fuera de él (ADR-0158); ver la review del Sprint 9. Ninguna bloquea lo construido en esta versión.

#### Riesgos

- **Resueltos en esta versión:**
  - **Tienda duplicada:** la migración que permite varios almacenes activos y la disponibilidad agregada de la tienda llegaron en el mismo pull request.
  - **Concurrencia entre almacenes:** tienen pruebas con dos conexiones las dos órdenes que compiten por la última unidad, y la desactivación contra las reservas y las entradas.
  - **Cambios de contrato:** todos son compatibles dentro de `/v1`, y están en `API_SPEC.md`, en el OpenAPI y en `CHANGELOG.md`.
- **Heredados, siguen vigentes:** los del cierre del MVP y los de las reviews de los sprints.
- **Nuevos:**
  - **Un pedido que ningún almacén cubre solo:** el checkout responde 409 aunque entre todos los almacenes tengan las unidades. El carrito muestra cada línea disponible, y la cotización marca lo que le falta al almacén más cercano. Es lo que decidió ADR-0160 hasta que se dividan pedidos.
  - **Pedidos divididos sin uso real:** el reintegro y el origen del envío ya trabajan por grupos, pero hoy ningún pedido sale de dos almacenes. La lectura de los orígenes de uno así solo se prueba con movimientos escritos a mano. La guarda de Ordering contra más de un grupo no tiene prueba, porque la política actual nunca los produce.
  - **Desactivar bloquea los almacenes activos:** espera a las reservas y entradas en curso en todos ellos, y las nuevas esperan a que termine. Con pocos almacenes y desactivaciones raras, el costo es aceptable.
  - **Aviso moderado en `sprintf-js`:** llega con Jest (por `js-yaml` 3 y `argparse` 1), solo en desarrollo, y ninguna versión lo corrige. La CI falla solo con avisos altos y críticos, y Dependabot sigue proponiendo las actualizaciones de seguridad.

#### Qué funcionó

- **Un plan por parte, aprobado antes de implementarla:** la versión se construyó en un día, en 3 pull requests, sin rehacer el diseño.
- **Un savepoint por intento de reserva:** si otra orden se llevó las unidades, se deshace solo ese intento y se prueba el siguiente almacén, sin tocar la transacción del checkout.
- **Pruebas de concurrencia deterministas:** dos conexiones, y una compuerta que espera a que PostgreSQL bloquee la otra, en lugar de pausas. Así se comprueba cada bloqueo de la parte b.
- **Dejar la puerta abierta sin construir de más:** la política de asignación es una pieza aparte, y el reintegro y el origen del envío ya trabajan por grupos. Dividir pedidos cambiará la política, no el reintegro ni el libro de movimientos.
- **Pruebas de mutación:**

  | Parte | Sobrevivieron | Causa |
  |---|---|---|
  | T-162 parte a | 0 de 27 | — |
  | T-162 parte b | 2 de 39 | Faltaban dos pruebas: un ajuste en un almacén que no existe, y el orden de los orígenes por prioridad, que en la prueba coincidía con el orden por código. Los dos cayeron al agregarlas |

  El plan (#103) solo cambió documentación.
- **Verificar por separado los commits de código:** encontró que al commit `feat` de la parte b le faltaban las tablas de `API_SPEC.md`, antes de subirlo.

#### Qué mejorar

- **Rutas nuevas sin sus tablas de `API_SPEC.md`:** la prueba de contrato las exige, y el primer commit `feat` de la parte b no las tenía; se rehízo antes de subirlo. Las tablas de una ruta van en el mismo commit que la ruta.
- **Datos de prueba que no distinguen:** la prueba del orden de los orígenes pasaba también ordenando por código, porque sus datos daban el mismo resultado. Cuando una prueba comprueba un orden, sus datos deben dar otro resultado con cualquier otro orden.
- **Mutante corrido con la suite equivocada:** la prueba nueva de un mutante estaba en integración y el script corría la e2e, así que sobrevivió una vez más. Cada mutante corre con la suite que tiene su prueba.

#### Resultado del paso 0

- **Revisión contra los ADR:** los 160 ADR del índice tienen su sección, y no hay referencias a ADR, tareas ni decisiones que no existan.
- **Dependencias:**
  - `npm audit` no encuentra vulnerabilidades;
  - Prisma 7.10.0 sigue siendo la última versión estable (la 8 sigue en versión candidata, 8.0.0-rc.20);
  - Dependabot sigue en pausa, salvo las actualizaciones de seguridad (ADR-0158).
- **Guías:** `DEVELOPMENT_GUIDE.md` suma las prácticas de la review del Sprint 9:
  - revisar `main` justo antes de fijar el número de un ADR cuando hay sesiones en paralelo;
  - partir en tandas las corridas de mutación largas;
  - que un control que puede pasar sin revisar nada muestre lo que revisó.

#### Resultado del paso 1

T-162 parte a (ADR-0160):

- **Varios almacenes activos:** la migración quita el índice de un solo almacén activo y agrega `priority`, de 1 a 1000, con 1 para los existentes. `GET` de almacenes la muestra y ordena por ella.
- **Reserva:** la política `ONE_WAREHOUSE_PER_ORDER` propone los almacenes que tienen todo el pedido, por prioridad. Cada intento es un savepoint propio: si otra orden se llevó las unidades, se deshace y se prueba el siguiente.
- **Cotización y 409:** el carrito sigue diciendo si algún almacén cubre cada línea. La cotización marca las líneas que le faltan al almacén más cercano, y son las mismas que lista el 409 `insufficient-stock`.
- **Tienda:** la disponibilidad agrega los almacenes activos, con una fila por variante. Va en el mismo cambio que quita el índice.
- **Envío:** sale del almacén de la reserva confirmada (`InventoryFacade.allocationOf`, que reemplaza a `activeWarehouseId`). Si hubiera más de un grupo, Ordering falla en vez de perder uno.
- **Mientras llega la parte b:** el reintegro va al primer almacén activo por prioridad.

#### Resultado del paso 2

T-162 parte b (ADR-0160); T-162 queda en DONE.

- **Administración de almacenes:**
  - `POST …/warehouses` crea almacenes activos, con un código único y una prioridad;
  - `PATCH` cambia la prioridad;
  - `POST …/deactivate` los desactiva para siempre, si no tienen unidades reservadas y no son el último activo.
- **Concurrencia:** la desactivación bloquea los almacenes activos, y cada reserva y cada entrada toman su almacén en modo compartido. Cuatro pruebas con dos conexiones lo comprueban:
  - una desactivación espera a la reserva en curso y luego se rechaza;
  - una reserva espera a la desactivación y luego cae en el siguiente almacén;
  - una entrada de mercancía espera a la desactivación y luego responde 404;
  - de dos desactivaciones a la vez, solo una pasa.
- **Reintegro al origen:** cada línea vuelve a los stock items de los que salió, según los movimientos de venta, aunque el almacén esté inactivo; con `warehouseId`, a ese almacén activo.
- **Transferencias:** los ajustes aceptan almacenes inactivos, y `WAREHOUSE_TRANSFER` llega con dos migraciones.
- **Envíos:** el listado filtra por `warehouseId`, y la orden del staff muestra el almacén del envío.

#### Siguiente versión

Ninguna en curso: la siguiente necesita un plan aprobado (ADR-0159). La 1.1 dejó fuera, para cuando se necesiten, dividir pedidos entre almacenes, las transferencias como operación propia (T-163), elegir el almacén por cercanía y los permisos por almacén (ADR-0160). Las prácticas de esta review entran a `DEVELOPMENT_GUIDE.md` en el paso 0 de la siguiente versión, como las del Sprint 9.

### Sprint 9 — Calidad antes de operar (2026-10-03 a 2026-10-04)

**Goal:** que antes de que un operador atienda a clientes reales, la API se revise en tres frentes: seguridad, cada ruta contra el OWASP API Security Top 10 y `SECURITY.md`; documentación, el OpenAPI generado contra `API_SPEC.md` y al día en la CI; y pruebas, la cobertura medida con un umbral en la CI, empezando por los rellenos de datos de las migraciones. **Tareas:** T-310 y T-320, en dos partes cada una, y T-300, en DONE, precedidas por un paso 0.

**Fecha:** 2026-10-04. **Resultado:** objetivo cumplido. T-310, T-320 y T-300 están en DONE y el pipeline de CI está en verde en `main`.
- Cada ruta se revisó contra el OWASP API Security Top 10, sin hallazgos críticos ni altos. Se corrigieron los 5 medios y los bajos que pedían decisiones, y la matriz de rutas comprueba en cada corrida cómo se protege cada una.
- El documento OpenAPI coincide con `API_SPEC.md` ruta por ruta, está versionado, y la CI lo compara con el que genera la aplicación.
- La cobertura de toda la suite se mide y tiene un umbral en la CI, y los rellenos de datos de las migraciones tienen prueba.

#### Entregables

| Entregable | Estado | Referencia |
|---|---|---|
| Revisión contra los ADR, con `PROJECT.md` y `README.md`, sin desajustes; descripción del listado de pedidos del staff corregida; prácticas de la review del Sprint 8 en la guía | DONE | Paso 0 |
| Matriz de rutas como control en la CI; informe `SECURITY_AUDIT.md` sin hallazgos críticos ni altos; 9 correcciones bajas | DONE | T-310 parte a, ADR-0153 |
| Los 5 hallazgos medios y 3 bajos que pedían decisiones: límites, nadie da lo que no tiene, TLS y `https` en producción, y enlaces de correo en segundo plano | DONE | T-310 parte b, ADR-0154 |
| `npm run secrets:scan` lee el repositorio también desde un worktree de git, y falla si gitleaks no puede leerlo | DONE | Seguimiento de T-310, ADR-0156 |
| Prueba de contrato contra `API_SPEC.md` y la matriz de rutas; `docs/openapi/v1.json` comprobado en la CI; errores que OpenAPI perdía | DONE | T-320 parte a, ADR-0155 |
| Descripción en toda operación, parámetro y campo que envía el cliente, comprobada en la CI; errores revisados ruta por ruta, sin diferencias | DONE | T-320 parte b, ADR-0155 |
| La prueba de conservación ya no depende del orden de las suites | DONE | T-232, pull request #94 |
| Cobertura de toda la suite con umbral en la CI; prueba de los rellenos de T-232; cada línea sin cubrir revisada; dos respaldos muertos borrados | DONE | T-300, ADR-0157 |
| 2,409 tests (1,398 unitarios, 460 de integración y 551 end-to-end); cobertura de 98.82% de sentencias, 84.12% de ramas, 99.10% de funciones y 99.47% de líneas; 0 vulnerabilidades; 0 secretos en el historial | — | CI |
| 157 ADR: 154 aceptados, 2 reemplazados parcialmente (ADR-0001 y ADR-0077) y 1 reemplazado (ADR-0014); 5 nuevos en este sprint (ADR-0153 a ADR-0157) | — | `DECISIONS.md` |
| Siguen abiertas 8 decisiones | — | `PROGRESS.md` |

El trabajo se integró en 8 pull requests a `main` (del #90 al #97); otra sesión, en paralelo, hizo el #94 y el #95. El pipeline pasó a la primera en todos, y también en `main` después de cada fusión. El #96 falló una vez en `Commit messages`, por un scope en el asunto de sus commits.

#### Decisiones abiertas

Quedan fuera del MVP (ADR-0158) y no bloquean nada de lo construido.

| Grupo | Decisiones |
|---|---|
| Dependen del hosting | P-05 (CD), P-06 (hosting, HSTS, TLS e IP del cliente detrás del proxy), P-07 (métricas y trazas), P-13 (secretos en servidor), P-24 (proveedor de correo) |
| Dependen de la cuenta de PayPal | P-31 (pruebas de webhooks; bloquea T-191) |
| Validaciones externas | P-69 (fiscal) |
| Negocio y operación | P-14 (objetivos no funcionales cuantitativos) |

#### Riesgos

- **Resueltos en este sprint:**
  - las rutas sin revisar contra el OWASP API Security Top 10, y sus hallazgos medios;
  - un documento OpenAPI que podía apartarse de `API_SPEC.md` sin que nadie lo notara;
  - los rellenos de `orders.concluded_at` y `users.last_active_at`, sin prueba;
  - el escaneo de secretos, que aprobaba sin revisar nada desde un worktree de git;
  - la cobertura sin medir, y la de las e2e, que no veía `src/`.
- **Heredados, siguen vigentes:** ver las reviews de los sprints 2 a 8 en este historial. Entre ellos están:
  - el estado en memoria de una sola instancia, y los contadores del rate limit en memoria;
  - los jobs, que con varias instancias correrían en cada una, salvo `platform.deliver-events`;
  - pagar dos veces, y el adaptador de PayPal, ahora fuera del MVP (ADR-0158);
  - la entrega de eventos al menos una vez, y las entregas fallidas, que solo ve el staff;
  - las cuentas inactivas, que se anonimizan sin aviso si el operador enciende la función.
- **Nuevos:**
  - **Margen del umbral de cobertura:** es pequeño en funciones (99.10%); tres funciones nuevas sin probar hacen fallar la CI.
  - **Cobertura en dos sistemas:** se midió en Windows y la CI corre en Linux. Solo la sincronización de la carpeta de los archivos de auditoría corre distinto, y la CI pasó los umbrales.
  - **Hallazgos sin corregir de la auditoría:** uno bajo y uno informativo esperan el hosting, y 7 informativos se aceptaron (`SECURITY_AUDIT.md`).

#### Qué funcionó

- **La matriz de rutas como control permanente:** una ruta nueva hace fallar la CI hasta que se revisa cómo se protege.
- **Comprobar la documentación con pruebas:** la prueba de contrato encontró 10 rutas que faltaban en `API_SPEC.md` y los errores que OpenAPI perdía, y exigir descripciones evita que vuelvan a faltar.
- **Unir la cobertura de las tres suites:** mostró que las e2e no medían `src/`. La revisión línea por línea encontró lógica sin prueba, como las carreras con claves foráneas y los fallos del outbox, y dos respaldos que nunca corrían.
- **Una base propia para cada relleno:** `MigrationDatabase` migra hasta justo antes de la migración y prueba con filas como eran entonces.
- **Pruebas de mutación:**

  | Tarea | Sobrevivieron | Causa |
  |---|---|---|
  | T-310 parte a | 0 de 28 | — |
  | T-310 parte b | 0 de 43 | — |
  | T-320 parte a | 0 de 13 | — |
  | T-320 parte b | 0 de 8 | — |
  | T-300 | 2 de 45 | Uno cayó al ajustar su prueba. El otro es equivalente: quita `s.status = 'RETURNED'` del relleno de `concluded_at`, pero una orden tiene un solo envío y solo uno devuelto tiene `returned_at` |

  El seguimiento de T-310 y el #94 no tuvieron prueba de mutación.
- **Verificar por separado los commits de código,** y el pipeline en verde a la primera en los 8 pull requests.

#### Qué mejorar

- **Asunto con scope:** el #96 usó `docs(platform):`, que el patrón de la CI no admite, porque el chequeo local de los mensajes no usaba el mismo patrón. Ahora lo usa, y los mensajes se reescribieron con `git push --force-with-lease`, con autorización.
- **Número de ADR entre sesiones en paralelo:** dos sesiones tomaron ADR-0156, y T-300 pasó a ADR-0157.
- **Falso aprobado del escaneo de secretos:** desde un worktree pasaba sin revisar nada, y se descubrió por casualidad. Un control que puede pasar sin hacer nada necesita mostrar lo que hizo, como el conteo de commits revisados.
- **Corridas de mutación largas:** una llegó al límite de 2 horas de los procesos en segundo plano con un mutante aplicado; se restauró el archivo y se repitieron los últimos mutantes.
- **Cobertura ciega desde el inicio:** desde el Sprint 1, `npm run test:cov` medía solo las unitarias, y nadie lo notó hasta T-300.

#### Resultado del paso 0

- **Revisión contra los ADR, con `PROJECT.md` y `README.md`:**
  - existen todas las referencias a ADR, tareas, P-xx, reglas de negocio, casos de uso y errores, y siguen abiertas las mismas 8 decisiones;
  - el estado de `PROJECT.md` y `README.md` pasa al Sprint 9;
  - las variables de `.env.example` coinciden con las que valida el código (las `POSTGRES_*` son solo de Docker Compose);
  - existen los scripts que cita la documentación;
  - cada contexto tiene sus cuatro capas, y los módulos transversales las que dice `ARCHITECTURE.md`;
  - Prisma 7.10.0 sigue siendo la última versión estable (la 8 sigue en versión candidata, 8.0.0-rc.19), así que siguen los `overrides` de ADR-0091;
  - `npm audit` no encuentra vulnerabilidades.
- **Dependabot:** no hay pull requests abiertos. El agrupado del lunes 5 de octubre se revisa cuando llegue, entre tareas.
- **Guías:** `DEVELOPMENT_GUIDE.md` suma las prácticas de la review del Sprint 8:
  - fijar en el plan el número de ADR de cada parte de una tarea;
  - agregar cada caso de uso nuevo a la tabla de cobertura de `API_SPEC.md` (§21);
  - decir en el plan cómo se prueba el relleno de datos de una migración.
- **Descripción del listado de pedidos:** la de `GET /v1/admin/orders` en el OpenAPI ya no dice que `payment` y `shipment` son `null` hasta T-190 y T-195. Va en un commit `fix` aparte.

#### Resultado del paso 1 (parte a)

T-310 parte a, con el nuevo ADR-0153:

- **Matriz de rutas:** una prueba compara cómo se protegen las 126 rutas con `test/security/route-matrix.ts` y llama a las 100 protegidas sin credenciales; una ruta nueva falla hasta revisarse.
- **Informe `SECURITY_AUDIT.md`:** sin hallazgos críticos ni altos; 5 medios y 3 bajos van a la parte b, 9 bajos se corrigieron, uno bajo y uno informativo se posponen con el hosting, y de los otros 8 informativos uno se corrigió y 7 se aceptan.
- **Correcciones:** `no-store` en las respuestas públicas con datos personales o el `cartId`; rutas comparadas sin distinguir mayúsculas; encabezados en el 415; 400 en lugar de 500 para páginas enormes y cuerpos JSON muy anidados; longitudes máximas en filtros del staff; contraseñas escritas en forma descompuesta; puertos de Docker Compose en `127.0.0.1`; y la carpeta de imágenes, fuera de la de trabajo.
- **Semgrep:** 2 resultados en 690 archivos, los dos informativos (SA-24 y SA-25).

#### Resultado del paso 1 (parte b)

T-310 parte b, con el nuevo ADR-0154, que cambia decisiones de rate limiting, login, staff y correo. T-310 queda en DONE.

- **Límites:**
  - el general por IP cuenta en toda ruta, también en las de límite propio (SA-01);
  - 5 órdenes de invitado por email de contacto por hora (SA-02);
  - el login ya no limita por email, que dejaba a cualquiera fuera de una cuenta ajena: quedan los 20 fallos por IP (SA-04);
  - 5 contraseñas actuales incorrectas por usuario al cambiarla (SA-15).
- **Nadie da lo que no tiene (SA-03, BR-USR-20):** con `staff.manage` solo se dan roles y permisos propios, el rol superadministrador solo lo asigna otro superadministrador, y reactivar exige poder dar los roles del reactivado.
- **Correo:** en producción, TLS obligatorio en SMTP y `https` en `FRONTEND_BASE_URL` (SA-05; la autenticación SMTP, con P-24); la recuperación y el reenvío envían el enlace en segundo plano (SA-16); los nombres y direcciones van en una línea y sin enlaces (SA-17).
- **Conteo corregido:** el informe de la parte a decía 12 bajos y 10 informativos; son 13 y 9.

#### Resultado del paso 2 (parte a)

T-320 parte a, con el nuevo ADR-0155:

- **Prueba de contrato:** las tablas de resumen de `API_SPEC.md` listan las mismas 126 rutas y los mismos accesos que la aplicación, y cada operación del OpenAPI documenta su autenticación, sus accesos denegados, la idempotencia y los errores comunes según la matriz de rutas.
- **`docs/openapi/v1.json`:** el documento de `v1`, comprobado en cada corrida de la CI; `npm run openapi:update` lo regenera.
- **Diferencias corregidas:**
  - 10 rutas que faltaban en las tablas de `API_SPEC.md`;
  - los errores de un controlador que OpenAPI perdía cuando un manejador declaraba otros del mismo estado, como el 401 de `/v1/me/password`;
  - los errores de tres rutas que no tenían y los de idempotencia del reintegro.

#### Seguimiento de T-310: escaneo de secretos en worktrees

A pedido del usuario, con el nuevo ADR-0156:

- **Falso aprobado:** en un worktree de git, gitleaks no encontraba el repositorio, revisaba 0 commits y terminaba con 0 y sin hallazgos, en lo preparado y en el historial.
- **Corrección:** `scripts/secrets-scan.ts` monta también el directorio de git compartido, y el escaneo falla si git, dentro del contenedor, no lee el mismo `HEAD`, o si gitleaks registra un error de git. Desde un worktree, el historial pasa de 0 a 261 commits revisados, y un secreto preparado se detecta.
- **Sin cambios en gitleaks:** la misma imagen y los mismos argumentos en `package.json`; la CI sigue el mismo camino que un worktree.

#### Resultado del paso 2 (parte b)

T-320 parte b; T-320 queda en DONE.

- **Errores:** comparados ruta por ruta con `API_SPEC.md`, coinciden; lo que faltaba se corrigió en la parte a.
- **Descripciones:**
  - las 31 operaciones que solo tenían resumen;
  - los 86 parámetros sin texto: 79 de ruta, con 20 nombres que se describen una vez cada uno, y 7 filtros;
  - los 50 campos sin descripción de los cuerpos que envía el cliente;
  - en las respuestas, los estados, montos, `null` y fechas que no se entienden por el nombre;
  - 9 descripciones que estaban en inglés, ahora en español.
- **Formatos y ejemplos:** 64 IDs más declaran `format: uuid`, 90 en total; los tokens de los enlaces y `Idempotency-Key` tienen ejemplo.
- **Control:** la prueba de contrato exige descripción en toda operación, parámetro y campo que envía el cliente.

#### Resultado del paso 3

T-300, con el nuevo ADR-0157; T-300 queda en DONE.

- **Cobertura de toda la suite:** cada corrida de Jest escribe su cobertura, y `scripts/coverage.ts` las une. La de las e2e no veía `src/`, porque su directorio raíz era `test/`.
- **Umbral en la CI:** 98% de sentencias, 84% de ramas, 99% de funciones y 99% de líneas, de lo medido al terminar y redondeado hacia abajo. Vale para el total.
- **Rellenos de datos:** los de `orders.concluded_at` y `users.last_active_at` se prueban en una base propia, migrada hasta antes de cada uno, con filas como eran entonces.
- **Huecos:** cada línea sin cubrir se revisó. Tienen prueba ahora, entre otras:
  - las carreras con claves foráneas de categorías, productos y roles;
  - los fallos del outbox y de la auditoría de un acceso denegado;
  - el límite de memoria del contador de intentos fallidos;
  - los cursores con un ID inválido;
  - el detalle de un producto con categorías e imágenes.
- **Quedan sin cubrir, justificados:** los relanzamientos de errores inesperados, las invariantes para el compilador y las funciones de decoradores de DTO.
- **Código muerto:** se borraron dos respaldos del interceptor de idempotencia que Express nunca alcanza.
- **Pruebas:** 2,409 (1,398 unitarias, 460 de integración y 551 end-to-end).

#### Siguiente sprint

Ninguno: en esta review, el proyecto se cerró como MVP (ADR-0158); ver "Cierre del MVP".

### Sprint 8 — Ciclo de conservación de datos personales (2026-10-03)

**Goal:** que los datos personales de órdenes y envíos sigan el ciclo de ADR-0070, con los plazos configurables de ADR-0149: ocultos al vencer la fase operativa, consultados solo con un permiso propio y auditado, anonimizados al vencer el bloqueo, y con los plazos que cada operador ajusta y publica. **Tareas:** T-232 en dos partes, en DONE, precedida por un paso 0.

**Fecha:** 2026-10-03. **Resultado:** objetivo cumplido. T-232 está en DONE y el pipeline de CI está en verde en `main`.
- Los datos personales de una orden y de su envío se bloquean 12 meses después de que la orden concluye y se anonimizan 60 meses después. El comprador deja de ver una orden bloqueada, y el staff la ve sin el email ni la dirección exacta.
- El Administrador consulta los datos bloqueados con un motivo, y cada consulta se audita.
- Cada operador ajusta los plazos con variables de entorno, puede anonimizar las cuentas inactivas y publica la política vigente.

#### Entregables

| Entregable | Estado | Referencia |
|---|---|---|
| Revisión contra los ADR extendida a `PROJECT.md` y `README.md`, con la tabla del stack de `PROJECT.md` corregida, y prácticas de la review del Sprint 7 en la guía | DONE | Paso 0 |
| Fecha de conclusión de la orden, también al volver su envío (`ShipmentReturned`); job `ordering.retention` que bloquea y anonimiza; datos bloqueados ocultos al comprador y enmascarados para el staff; los 30 días de la limpieza diaria, configurables | DONE | T-232 parte a, ADR-0151 |
| Consulta de los datos bloqueados con el permiso nuevo `orders.read-blocked`, auditada; anonimización opcional de cuentas inactivas; política de conservación pública | DONE | T-232 parte b, ADR-0152 |
| 2,314 tests (1,355 unitarios, 446 de integración y 513 end-to-end); 0 vulnerabilidades; 0 secretos en el historial | — | CI |
| 152 ADR: 149 aceptados, 2 reemplazados parcialmente (ADR-0001 y ADR-0077) y 1 reemplazado (ADR-0014); 2 nuevos en este sprint (ADR-0151 y ADR-0152) | — | `DECISIONS.md` |
| Siguen abiertas 8 decisiones | — | `PROGRESS.md` |

El trabajo se integró en 3 pull requests a `main` (del #87 al #89). La CI pasó a la primera en todos, y también en `main` después de cada fusión.

#### Decisiones abiertas que pasan al siguiente sprint

Ninguna bloquea el trabajo de calidad del Sprint 9.

| Grupo | Decisiones |
|---|---|
| Dependen del hosting | P-05 (CD), P-06 (hosting, HSTS, TLS e IP del cliente detrás del proxy), P-07 (métricas y trazas), P-13 (secretos en servidor), P-24 (proveedor de correo) |
| Dependen de la cuenta de PayPal | P-31 (pruebas de webhooks; bloquea T-191) |
| Validaciones externas | P-69 (fiscal) |
| Negocio y operación | P-14 (objetivos no funcionales cuantitativos) |

#### Riesgos que pasan al siguiente sprint

- **Resueltos en este sprint:**
  - los datos personales de órdenes y envíos se conservaban sin plazo: el ciclo de ADR-0070 ya corre;
  - los 30 días fijos de la limpieza diaria no se podían ajustar;
  - la descripción desactualizada del listado de pedidos del staff, corregida en esta review.
- **Heredados, siguen vigentes:** ver las reviews de los sprints 2 a 7 en el historial. Entre ellos están:
  - el estado en memoria de una sola instancia, y los contadores del rate limit en memoria;
  - el adaptador de PayPal sin verificar, y pagar dos veces;
  - los jobs, que con varias instancias correrían en cada una, salvo `platform.deliver-events`;
  - la entrega de eventos al menos una vez, y las entregas fallidas, que solo ve el staff.
- **Nuevos:**
  - **Primera corrida del ciclo:** en una base con historial, bloquea de una vez las órdenes que concluyeron hace más de 12 meses, hasta 1,000 por día.
  - **Rellenos de migraciones sin prueba:** `orders.concluded_at` y `users.last_active_at` se llenan con SQL que las pruebas no ejercitan, porque migran una base vacía (T-300).
  - **Cuentas inactivas sin aviso:** si el operador enciende la función, la cuenta se anonimiza sin avisar antes al cliente.
  - **Inicio de sesión en el instante de anonimizar:** puede abrirse una sesión justo después; la anonimización por solicitud ya tenía la misma carrera.

#### Qué funcionó

- **Separar los plazos de la ley (ADR-0149):** el ciclo corre con valores por defecto, y cada operador los ajusta sin cambiar código.
- **Ocultar en las consultas:** los datos bloqueados se filtran y enmascaran en las vistas, y el dominio los conserva intactos; un pago tardío desbloquea la orden en el acto.
- **La fecha de conclusión en el dominio:** un solo campo indexado reemplaza el cálculo por estado, y `ShipmentReturned` trae la devolución sin que Ordering lea Shipping.
- **Repetir las condiciones al bloquear la fila:** el job revisa otra vez bajo `SELECT … FOR UPDATE`, y una prueba con dos conexiones lo comprueba.
- **Pruebas de mutación:**

  | Tarea | Sobrevivieron | Causa |
  |---|---|---|
  | T-232 parte a | 0 de 77 | — |
  | T-232 parte b | 0 de 41 | Antes de correrlas se quitaron 3 fragmentos redundantes que ninguna prueba habría distinguido |

- **Verificar el commit feat por separado,** y **CI a la primera** en los 3 pull requests.

#### Qué mejorar

- **Número de ADR de cada parte:** en la parte b, el código citó ADR-0151 antes de decidir que la parte tendría su propio ADR; se corrigió al final.
- **Cobertura de la API:** la parte a agregó UC-SYS-02 sin sumarlo a la tabla de la §21 de `API_SPEC.md`; se corrigió en la parte b.
- **Rellenos de las migraciones:** los de `concluded_at` y `last_active_at` no tienen prueba.
- **Sugerencias aparte:** la descripción del listado de pedidos, detectada en T-109 parte b, esperó dos sprints; se corrigió en esta review.

#### Resultado del paso 0

- **Revisión contra los ADR, ahora también de `PROJECT.md` y `README.md`:**
  - existen todas las referencias a ADR, tareas, P-xx, reglas de negocio, casos de uso y errores, y siguen abiertas las mismas 8 decisiones;
  - tres desajustes corregidos en la tabla del stack de `PROJECT.md`: la fila de Docker no tenía la imagen `migrate` (ADR-0147), la de observabilidad citaba ADR-0014, ya reemplazado, y la de jobs daba la conciliación de pagos como hecha, cuando llega con T-192;
  - el `README.md` lista ahora `SPRINT.md` y `CHANGELOG.md`, y sus scripts existen;
  - las variables de `.env.example` coinciden con las que valida el código (las `POSTGRES_*` son solo de Docker Compose);
  - cada contexto tiene sus cuatro capas, y los módulos transversales las que dice `ARCHITECTURE.md`;
  - `npm audit` no encuentra vulnerabilidades.
- **Dependabot:** no hay pull requests abiertos. El agrupado del lunes 5 de octubre se revisa cuando llegue, entre tareas.
- **Guías:** `DEVELOPMENT_GUIDE.md` suma las prácticas de la review del Sprint 7:
  - revisar en el plan cómo maneja los errores cada consumidor de un mecanismo transversal;
  - vaciar antes de cada prueba las tablas que llenan todas las suites;
  - no renumerar las secciones que cita el código;
  - actualizar el estado de `PROJECT.md` y `README.md` al cerrar un sprint.

#### Resultado del paso 1

T-232 parte a, con el nuevo ADR-0151:

- **Fecha de conclusión:** la orden guarda cuándo concluyó (`concluded_at`). Una SHIPPED concluye cuando vuelve su envío, que Shipping avisa con `ShipmentReturned`, y un pago tardío que la reabre la borra. La migración la llena en las órdenes existentes.
- **Bloqueo y anonimización:** el job diario `ordering.retention` bloquea las órdenes que concluyeron hace 12 meses, con sus envíos, y anonimiza las de hace 72. Hace hasta 1,000 de cada uno por corrida, cada orden en su transacción, auditada como sistema.
- **Ocultamiento:** una orden bloqueada desaparece de las vistas del comprador (sus pedidos, la consulta y el enlace del invitado, la recompra), y el staff la ve con `blockedAt`, sin su email ni su dirección exacta, también en el envío; la búsqueda por email no la encuentra.
- **Plazos:** seis variables nuevas con rango, entre ellas los 30 días de la limpieza diaria, y la política vigente en el log al arrancar.
- **Riesgos del sprint:** los correos no necesitan ocultamiento, porque una orden bloqueada ya concluyó y no genera eventos; un pago tardío la desbloquea antes de avisar. Las respuestas guardadas por idempotencia ya no existen al anonimizar, porque duran 24 horas.

#### Resultado del paso 2

T-232 parte b, con el nuevo ADR-0152; T-232 queda en DONE:

- **Consulta de los datos bloqueados:** `POST /v1/admin/orders/{orderId}/blocked-data` con un motivo, solo con el permiso nuevo `orders.read-blocked` (Administrador y Superadministrador). Responde el email, la dirección y el destino del envío como se guardaron, y cada consulta se audita sin los datos.
- **Cuentas inactivas:** la actividad es registrarse, iniciar sesión o renovar la sesión (`users.last_active_at`). Con `INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS` configurada, el job diario `privacy.anonymize-inactive-customers` anonimiza la cuenta, sin sus órdenes, que siguen su ciclo. Un cliente con una orden sin concluir o que vuelve a tener actividad se queda. Apagado por defecto.
- **Política pública:** `GET /v1/privacy/retention-policy` da los plazos vigentes para el aviso de privacidad.
- **Riesgos del sprint:** la consulta de los datos bloqueados cierra el ocultamiento de ADR-0070, y la anonimización de cuentas inactivas define la actividad y deja las órdenes a su propio ciclo.

#### Siguiente sprint

La propuesta del Sprint 9 se aprobó el 2026-10-03; ver su entrada en este historial.

### Sprint 7 — Entrega garantizada de eventos (2026-10-03)

**Goal:** que ningún efecto de un evento se pierda: los eventos se guardan con el cambio que los origina, se reintentan hasta entregarse, y los que fallan una y otra vez quedan a la vista del staff. **Tareas:** T-109 en dos partes, en DONE, precedida por un paso 0. Además se cerró P-61 con ADR-0149, a pedido del usuario.

**Fecha:** 2026-10-03. **Resultado:** objetivo cumplido. T-109 está en DONE y el pipeline de CI está en verde en `main`.
- Un `PaymentCaptured` perdido ya no deja un pago capturado en una orden que expira, ni se pierden el despacho, la entrega, el reembolso o los correos: si un manejador falla o la API se cae, el efecto se reintenta.
- El staff ve las entregas que agotaron sus intentos y las reintenta.
- Los plazos de conservación de datos personales son configurables, y T-232 dejó de estar diferida.

#### Entregables

| Entregable | Estado | Referencia |
|---|---|---|
| Revisión contra los ADR, con el estado de ADR-0077 y los módulos transversales de `ARCHITECTURE.md` corregidos, y prácticas de la review del Sprint 6 en la guía | DONE | Paso 0 |
| Plazos de conservación configurables con valores por defecto; la validación legal pasa a la lista "Antes de operar" de cada operador; P-61 cerrada y T-232 a TODO | DONE | ADR-0149 |
| Outbox transaccional: los eventos se guardan con el cambio, con una entrega por manejador, y el job `platform.deliver-events` reintenta 8 veces; `publishVolatile` para el evento con un email; los correos de la orden se reintentan | DONE | T-109 parte a, ADR-0150 |
| Consulta y reintento de las entregas fallidas con el permiso nuevo `events.manage`, y limpieza diaria de los eventos entregados | DONE | T-109 parte b, ADR-0150 |
| 2,207 tests (1,272 unitarios, 429 de integración y 506 end-to-end); 0 vulnerabilidades; 0 secretos en el historial | — | CI |
| 150 ADR: 147 aceptados, 2 reemplazados parcialmente (ADR-0001 y ADR-0077) y 1 reemplazado (ADR-0014); 2 nuevos en este sprint (ADR-0149 y ADR-0150) | — | `DECISIONS.md` |
| Quedan abiertas 8 decisiones: P-61 se cerró | — | `PROGRESS.md` |

El trabajo se integró en 4 pull requests a `main` (del #83 al #86). La CI pasó a la primera en todos, y también en `main` después de cada fusión. En el #84 hubo además una corrida cancelada al actualizar la rama con `main`, no una falla.

#### Decisiones abiertas que pasan al siguiente sprint

Ninguna bloquea el ciclo de conservación: desde ADR-0149, sus plazos son configurables y cada operador los valida antes de operar.

| Grupo | Decisiones |
|---|---|
| Dependen del hosting | P-05 (CD), P-06 (hosting, HSTS, TLS e IP del cliente detrás del proxy), P-07 (métricas y trazas), P-13 (secretos en servidor), P-24 (proveedor de correo) |
| Dependen de la cuenta de PayPal | P-31 (pruebas de webhooks; bloquea T-191) |
| Validaciones externas | P-69 (fiscal) |
| Negocio y operación | P-14 (objetivos no funcionales cuantitativos) |

#### Riesgos que pasan al siguiente sprint

- **Resueltos en este sprint:**
  - los efectos que dependían de un evento se perdían si su manejador fallaba o la API se caía (riesgo de ADR-0014 y ADR-0098, abierto desde el Sprint 2);
  - un `PaymentCaptured` perdido no tenía red, porque la conciliación está en T-192;
  - los correos no se reintentaban;
  - P-61 bloqueaba el ciclo de conservación (T-232).
- **Heredados, siguen vigentes:** ver las reviews de los sprints 2 a 6 en el historial. Entre ellos están:
  - el estado en memoria de una sola instancia, y los contadores del rate limit en memoria;
  - el adaptador de PayPal sin verificar, y pagar dos veces;
  - los jobs, que con varias instancias correrían en cada una, salvo `platform.deliver-events`, que ya toma cada entrega una sola vez.
- **Nuevos:**
  - **Al menos una vez (ADR-0150):** si la API se cae entre un manejador y la marca de entregado, el manejador corre otra vez; un correo puede llegar dos veces.
  - **Entregas fallidas:** se conservan hasta que alguien las reintente; nadie avisa de ellas fuera de la consulta del staff, hasta tener observabilidad (P-07).
  - **`OrderAccessRequested`** sigue siendo volátil: si la API se cae, el invitado pide otro enlace.
  - **Prisma 8** está en versión candidata (8.0.0-rc.19), publicada como `latest` en npm: se revisa cuando sea estable.
  - **Descripción desactualizada** en el listado administrativo de pedidos: dice que `payment` y `shipment` son `null` hasta T-190 y T-195. Quedó como tarea aparte.

#### Qué funcionó

- **Guardar los eventos antes del commit,** dentro del `TransactionScope`: `publish` siguió siendo síncrono y no hubo que tocar las 11 llamadas que publican.
- **Una entrega por manejador:** un reintento repite solo el que falló, y los manejadores de estado ya toleraban repeticiones y eventos tardíos.
- **Eventos volátiles:** la tabla de eventos nunca guarda datos personales, y una e2e lo comprueba.
- **Decidir P-61 como configuración:** la propuesta del usuario de hacer configurables los plazos, con valores por defecto, quitó un bloqueo legal que no dependía del proyecto.
- **Pruebas de mutación:**

  | Tarea | Sobrevivieron | Causa |
  |---|---|---|
  | T-109 parte a | 1 de 33 | Eventos guardados y volátiles publicados juntos, sin prueba |
  | T-109 parte b | 2 de 19 | Una comprobación redundante en la limpieza, que se quitó del código |

- **Verificar el commit feat por separado,** y **CI a la primera** en los 4 pull requests.

#### Qué mejorar

- **Errores de los consumidores:** al cambiar un mecanismo transversal, el plan revisa cómo maneja los errores cada consumidor. Que los correos atrapaban la falla del servidor de correo apareció a mitad de T-109.
- **Tablas que comparten todas las suites:** el outbox recibe eventos de todas las pruebas, así que las que lo cuentan lo vacían antes de cada prueba.
- **No renumerar secciones de la documentación** que el código cita: la sección nueva de `DATABASE.md` fue la §11.4, y la de `API_SPEC.md` la §22.
- **La revisión del paso 0 no cubría `PROJECT.md` ni `README.md`:** el estado de `PROJECT.md` seguía en el Sprint 6 y su alcance no tenía el enlace de acceso; se encontró a mano.

#### Resultado del paso 0

- **Revisión contra los ADR:**
  - existen todas las referencias a ADR, tareas, P-xx, reglas de negocio, casos de uso y errores, y siguen abiertas las mismas 9 decisiones;
  - dos desajustes corregidos:
    - el estado de ADR-0077 no empezaba como su índice ("Reemplazada parcialmente por ADR-0148");
    - `ARCHITECTURE.md` decía que `audit` solo tiene infraestructura, cuando desde T-220 tiene aplicación, infraestructura y presentación, y no listaba `notifications` ni `privacy`;
  - las variables de `.env.example` coinciden con las que valida el código (las `POSTGRES_*` son solo de Docker Compose);
  - existen los scripts que cita la documentación;
  - cada contexto tiene sus cuatro capas, y los módulos transversales las que dice `ARCHITECTURE.md`;
  - los `overrides` de ADR-0091 siguen siendo necesarios: Prisma 7.10.0, la última versión estable, fija `mysql2` 3.15.3, y `@prisma/config` fija `deepmerge-ts` 7.1.5. Prisma 8 está en versión candidata (8.0.0-rc.19); se revisa cuando sea estable;
  - `npm audit` no encuentra vulnerabilidades.
- **Dependabot:** no hay pull requests abiertos. El agrupado del lunes 5 de octubre se revisa cuando llegue, entre tareas.
- **Guías:** `DEVELOPMENT_GUIDE.md` suma las prácticas de la review del Sprint 6:
  - listar en el plan todas las copias de un dato personal que se borra o anonimiza;
  - probar cada filtro por separado, con datos que solo ese filtro distingue;
  - instantes que caen en días distintos en UTC y en México;
  - un email propio por prueba cuando hay límites por email, y filtrar los correos por asunto;
  - quitar o limitar los mutantes que pueden no terminar.
- **T-109** agregada a `TASKS.md`, con sus dos partes.

#### Siguiente sprint

La propuesta del Sprint 8 se aprobó el 2026-10-03; ver su entrada en este historial.

### Sprint 6 — Privacidad y operación (2026-10-02 a 2026-10-03)

**Goal:** privacidad y operación: un cliente o un comprador invitado se anonimiza sin romper sus órdenes ni sus envíos; el staff consulta la auditoría de los últimos 3 meses, y los registros más viejos se archivan; la imagen de producción se reduce. **Tareas:** T-132, T-220 y la reducción de la imagen (paso 3), precedidas por un paso 0. A pedido del usuario se agregó T-186 como paso 4. Todas en DONE.

**Fecha:** 2026-10-03. **Resultado:** objetivo cumplido. Las tareas están en DONE y el pipeline de CI está en verde en `main`.
- Un cliente o un comprador invitado se anonimiza en una sola operación, sin romper sus órdenes ni sus envíos.
- El staff consulta la auditoría, y cada noche lo que tiene más de 3 meses pasa a archivos verificados.
- La imagen de producción pesa 557 MB y la CI la arranca contra una base migrada.
- Un invitado que perdió el código de su pedido recibe un enlace a sus órdenes por correo.

#### Entregables

| Entregable | Estado | Referencia |
|---|---|---|
| Revisión contra los ADR, documento OpenAPI construido y revisado en cada corrida, y prácticas de la review del Sprint 5 en la guía | DONE | Paso 0, ADR-0096 |
| Anonimización de clientes y de compradores invitados en una transacción: cuenta, sesiones, enlaces, direcciones, carritos, órdenes, envíos y respuestas guardadas por idempotencia; espera a que las órdenes concluyan | DONE | T-132, ADR-0145 |
| Consulta de la auditoría por cursor con filtros, y archivo diario por día UTC, verificado antes de borrar y sin sobrescribir nunca un archivo | DONE | T-220, ADR-0146 |
| Imagen de producción de 924 MB a 557 MB sin el CLI de Prisma, imagen `migrate` y prueba de arranque en la CI | DONE | Paso 3, ADR-0147 |
| Enlace de acceso a los pedidos de invitado por correo, de un solo uso | DONE | T-186, ADR-0148 |
| 2,158 tests (1,255 unitarios, 404 de integración y 499 end-to-end); 0 vulnerabilidades; 0 secretos en el historial | — | CI |
| 148 ADR: 146 aceptados y 2 reemplazados parcialmente (ADR-0001 y ADR-0077); 4 nuevos en este sprint (ADR-0145 a ADR-0148) | — | `DECISIONS.md` |
| Siguen abiertas las 9 decisiones de siempre | — | `PROGRESS.md` |

El trabajo se integró en 5 pull requests a `main` (del #77 al #81). La CI pasó a la primera en todos, y también en `main` después de cada fusión.

#### Decisiones abiertas que pasan al siguiente sprint

Las mismas 9. P-24 (proveedor de correo) afecta ahora también al enlace de acceso a los pedidos, que mientras tanto se prueba con el capturador local.

| Grupo | Decisiones |
|---|---|
| Dependen del hosting | P-05 (CD), P-06 (hosting, HSTS, TLS e IP del cliente detrás del proxy), P-07 (métricas y trazas), P-13 (secretos en servidor), P-24 (proveedor de correo) |
| Dependen de la cuenta de PayPal | P-31 (pruebas de webhooks; bloquea T-191) |
| Validaciones externas | P-61 (legal; difiere T-232), P-69 (fiscal) |
| Negocio y operación | P-14 (objetivos no funcionales cuantitativos) |

#### Riesgos que pasan al siguiente sprint

- **Resueltos en este sprint:**
  - la imagen de producción de 920 MB: pesa 557 MB y la CI la arranca (paso 3);
  - el documento OpenAPI que solo se construía en algunas suites (paso 0);
  - un cliente que pide eliminar sus datos ya se anonimiza desde la API (T-132).
- **Heredados, siguen vigentes:** ver las reviews de los sprints 2 a 5 en el historial. Entre ellos están:
  - el estado en memoria de una sola instancia, y los contadores del rate limit en memoria;
  - el adaptador de PayPal sin verificar, y pagar dos veces;
  - los efectos que dependen de un evento: si su manejador falla o la API se cae, se pierden. T-186 suma uno, el envío del enlace de acceso;
  - los jobs, que con varias instancias correrían en cada una.
- **Nuevos:**
  - **Anonimización (ADR-0145):**
    - las notas del staff (historial, envíos, pagos y reintegros) no se anonimizan: son texto libre en el que la API pide no escribir datos personales;
    - las respuestas guardadas por idempotencia se borran fuera de la transacción: si la anonimización falla después, solo se pierde la repetición de una solicitud de las últimas 24 horas.
  - **Archivo de la auditoría (ADR-0146):**
    - con varias instancias, el job necesitará un candado;
    - en Windows la carpeta no se fuerza a disco;
    - los archivos se leen a mano, con `gunzip -c`.
  - **Imágenes (ADR-0147):**
    - una dependencia de ejecución que llegue solo como dependencia par de otra debe declararse en `dependencies`, o la prueba de arranque falla;
    - la imagen `migrate` pesa 1.43 GB, aunque solo corre como paso único;
    - las migraciones contra una base con TLS se revisan al decidir P-05: Prisma pediría otro motor.
  - **Enlace de acceso (ADR-0148):** sin frontend ni proveedor de correo real; un email con más de 50 órdenes de invitado ve solo las 50 más recientes.
  - **Cambios de contrato:**
    - rutas nuevas: `POST /v1/admin/identity/customers/{userId}/anonymize`, `POST /v1/admin/identity/guest-anonymizations`, `GET /v1/admin/audit`, `POST /v1/orders/access-links` y `POST /v1/orders/access`;
    - en una orden anonimizada, `AdminOrder` tiene `contactEmail` en `null` y la dirección sin datos personales, y el envío, su destino igual (ADR-0145);
    - un pago tardío de una orden vencida y anonimizada la deja esperando al staff, que solo puede cancelarla con su reembolso (ADR-0145).

#### Qué funcionó

- **La propuesta del usuario de nunca sobrescribir un archivo de auditoría:** un día que vuelve a tener registros va a un archivo nuevo, y no se pierde historia después de una falla (T-220).
- **Probar cada carrera nueva en los dos órdenes contra PostgreSQL:**
  - el checkout y la anonimización del mismo cliente (T-132);
  - emitir un enlace de acceso y anonimizar al invitado (T-186).
- **Medir antes de planear:** la imagen reducida se construyó y se arrancó antes de proponer el paso 3, y la prueba de arranque se comprobó quitando `pg`.
- **Sacar del diferido una tarea ya diseñada:** T-186 partió del diseño de ADR-0077, así que el plan solo cerró detalles.
- **Pruebas de mutación:**

  | Tarea | Sobrevivieron | Causa |
  |---|---|---|
  | T-132 | 0 de 55 | — |
  | T-220 | 5 de 57 | Filtros probados juntos, la zona horaria, y una comprobación redundante que se quitó del código |
  | T-186 | 1 de 31 | Un enlace usado que quedaba marcado como reemplazado, sin efecto en el comportamiento |

- **Verificar el commit feat por separado,** con versiones feat de las specs que cambian en los dos commits.
- **CI a la primera** en los 5 pull requests.

#### Qué mejorar

- **Listar en el plan todas las copias de un dato personal:** las respuestas guardadas por idempotencia aparecieron durante la implementación de T-132. T-186 ya lo aplicó desde el plan.
- **Probar cada filtro por separado, con datos que difieran:** `resourceType` y `resourceId` se probaban juntos y dejaron pasar dos mutaciones (T-220).
- **Fechas:** usar instantes que caigan en días distintos en UTC y en México (T-220).
- **Mutantes que pueden no terminar,** como cambiar el orden de una lectura por lotes: quitarlos de la lista o ponerles un límite (T-220).
- **Límites por email en las e2e:** el contador dura lo que la aplicación de la suite, así que cada prueba usa su propio email (T-186).
- **Correos en las e2e:** los de la orden llegan al mismo capturador; las pruebas filtran por asunto (T-186).

#### Resultado del paso 0

- **Revisión contra los ADR, sin contradicciones:**
  - existen todas las referencias a ADR, tareas, P-xx, reglas de negocio, casos de uso y errores, y el índice de ADR coincide con sus secciones; siguen abiertas las mismas 9 decisiones;
  - las variables de `.env.example` coinciden con las que valida el código (las `POSTGRES_*` son solo de Docker Compose);
  - existen los scripts que cita la documentación;
  - cada contexto tiene sus cuatro capas; `audit` solo infraestructura y `notifications` aplicación e infraestructura, como dice `ARCHITECTURE.md`;
  - los `overrides` de ADR-0091 siguen siendo necesarios, porque Prisma 7.10.0 todavía fija `mysql2` 3.15.3 y `deepmerge-ts` 7.1.5;
  - `npm audit` no encuentra vulnerabilidades.
- **Documento OpenAPI en cada corrida (ADR-0096):**
  - `configureHttp` construye y revisa el documento en todo entorno salvo producción, y solo lo sirve en desarrollo;
  - la revisión falla si construirlo falla o si un `$ref` no tiene su esquema, y lo prueba `api-docs.spec.ts`;
  - comprobado rompiendo el DTO de la recompra: sin `@ApiProperty({ type: [String] })`, la suite de la recompra, corrida sola, falla con la dependencia circular que en T-181 solo apareció en otra suite.
- **Dependabot:** no hay pull requests abiertos. El agrupado del lunes 5 de octubre se revisa cuando llegue, entre tareas.
- **Guías:** `DEVELOPMENT_GUIDE.md` suma las prácticas de la review del Sprint 5:
  - revisar en cada plan las representaciones de `API_SPEC.md` §8;
  - comparar los errores de dominio por su `code` y sus `details`;
  - valores distintos en los datos de prueba;
  - que `tsc` compila también las specs de integración y e2e;
  - `set -o pipefail` si se filtra la salida del escaneo de secretos;
  - que un DTO no redeclara con decorador un campo de su clase base.

#### Siguiente sprint

Al cerrar, el usuario pidió solo la review. La propuesta del Sprint 7 se aprobó después, el 2026-10-03; ver su entrada en este historial.

### Sprint 5 — Entrega del pedido (2026-10-02)

**Goal:** entrega del pedido: la orden pagada se envía y se entrega, o se devuelve con su stock; el cliente recibe un correo en cada paso, y la limpieza diaria borra lo vencido. **Tareas:** T-195 (en dos partes), T-161, T-215 y T-231, todas en DONE, precedidas por un paso 0.

**Fecha:** 2026-10-02. **Resultado:** objetivo cumplido. Las 4 tareas están en DONE y el pipeline de CI está en verde en `main`.
- La orden pagada nace con su envío.
- El staff le captura la guía, la despacha y la entrega, o registra la entrega fallida y la devolución, y la orden sigue al envío.
- El stock de las órdenes canceladas y de los envíos devueltos vuelve sin pasar de lo vendido.
- El cliente recibe un correo en cada paso.
- Cada noche se borra lo vencido.

#### Entregables

| Entregable | Estado | Referencia |
|---|---|---|
| Revisión contra los ADR, índice sin uso de `reservations` fuera y prácticas de la review del Sprint 4 en la guía | DONE | Paso 0, ADR-0136 |
| El envío nace con la orden pagada; consulta del staff, paquetería y guía, cancelación con la orden y el envío en las vistas de la orden | DONE | T-195 parte a, ADR-0140 |
| Despacho, entrega, entrega fallida y devolución con notas; la orden pasa a SHIPPED y DELIVERED por eventos | DONE | T-195 parte b, ADR-0141 |
| Reintegro de stock de órdenes canceladas o reembolsadas y de envíos devueltos, con tope por línea, y al cancelar una orden pagada | DONE | T-161, ADR-0142 |
| Correos al cliente: orden recibida, pago confirmado, orden enviada, orden cancelada y reembolso completado | DONE | T-215, ADR-0143 |
| Limpieza diaria de tokens, carritos de invitado inactivos, eventos de webhooks y llaves de idempotencia | DONE | T-231, ADR-0144 |
| 2,014 tests (1,165 unitarios, 372 de integración y 477 end-to-end); 0 vulnerabilidades; 0 secretos en el historial | — | CI |
| 144 ADR: 143 aceptados y 1 reemplazado parcialmente (ADR-0001); 5 nuevos en este sprint (ADR-0140 a ADR-0144) | — | `DECISIONS.md` |
| Siguen abiertas las 9 decisiones de siempre | — | `PROGRESS.md` |

El trabajo se integró en 6 pull requests a `main` (del #70 al #75). La CI pasó a la primera en todos, y también en `main` después de cada fusión.

#### Decisiones abiertas que pasan al siguiente sprint

Ninguna bloquea la anonimización, la auditoría ni la imagen de producción. P-61 decide los plazos de conservación (T-232), no la anonimización, que ya está decidida (ADR-0067).

| Grupo | Decisiones |
|---|---|
| Dependen del hosting | P-05 (CD), P-06 (hosting, HSTS, TLS e IP del cliente detrás del proxy), P-07 (métricas y trazas), P-13 (secretos en servidor), P-24 (proveedor de correo) |
| Dependen de la cuenta de PayPal | P-31 (pruebas de webhooks; bloquea T-191) |
| Validaciones externas | P-61 (legal; difiere T-232), P-69 (fiscal) |
| Negocio y operación | P-14 (objetivos no funcionales cuantitativos) |

#### Riesgos que pasan al siguiente sprint

- **Resueltos en este sprint:**
  - el cliente ya recibe correos (T-215), y Ordering publica `OrderPlaced`, `OrderPaid` y `OrderCancelled`;
  - el reintegro ya no responde 409 (T-161);
  - el índice sin uso de `reservations` se quitó (paso 0).
- **Heredados, siguen vigentes:** ver las reviews de los sprints 2 a 4 en el historial. Entre ellos están:
  - el estado en memoria de una sola instancia;
  - la imagen de producción de 920 MB, que entra al Sprint 6;
  - el adaptador de PayPal sin verificar;
  - pagar dos veces;
  - los contadores del rate limit en memoria;
  - la documentación OpenAPI, que solo se construye en algunas suites (paso 0 del Sprint 6).
- **Nuevos de la entrega:**
  - **Efectos que dependen de un evento:**
    - `ShipmentDispatched`, `ShipmentDelivered` y los correos se pierden si falla su manejador;
    - un despacho perdido deja la orden en PAID hasta la entrega, y mientras tanto cancelarla responde 409 (ADR-0141);
    - un correo perdido no se reintenta (ADR-0143).
  - **Varias instancias:** los cuatro jobs de limpieza correrían en cada una. Son idempotentes, pero harían trabajo doble (ADR-0029).
  - **Correos en las e2e:** las suites que colocan órdenes intentan enviarlos y fallan sin servidor SMTP; el logger de pruebas oculta la advertencia (ADR-0143).
  - **Limpieza:**
    - las tablas de tokens no tienen índice por vencimiento;
    - la recompra del staff de una orden de invitado de más de 30 días responde 409 (ADR-0082);
    - un refresh token borrado ya no detecta su reutilización (ADR-0144).
  - **Cambios de contrato:**
    - `Idempotency-Key` en el reintegro, y `restock` fuera del registro del reembolso (ADR-0142);
    - `id` en las líneas de `AdminOrder` (ADR-0142), e `id` y `version` en `AdminOrder.shipment` (ADR-0140);
    - `failureNote` y `returnNote` en `AdminShipment`, y `null` en el `PATCH` de la guía (ADR-0141).
  - **Sin correo por un pago a una orden ya cancelada:** con el pago en tienda no puede pasar; se revisa con PayPal (T-192, ADR-0143).

#### Qué funcionó

- **Partir T-195:** primero la creación y la cancelación del envío; después el despacho, con la orden siguiendo al envío por eventos.
- **Dependencias en un solo sentido:**
  - Ordering crea y cancela el envío por la fachada de Shipping;
  - la orden sigue al envío por eventos;
  - Notificaciones lee la orden por la primera fachada de Ordering.

  No se formó ningún ciclo.
- **Pruebas de mutación:** en todas las tareas encontraron pruebas débiles:

  | Tarea | Sobrevivieron | Causa |
  |---|---|---|
  | T-195 | 7 de 99 | Valores que no se comprobaban |
  | T-161 | 3 de 33 | Errores comparados solo por su mensaje |
  | T-215 | 3 de 28 | Valores que coincidían en los datos de prueba |
  | T-231 | 2 de 21 | 1 real y 1 equivalente |

- **Concurrencia:** cada carrera nueva tiene su prueba contra PostgreSQL:
  - despachar contra cancelar la orden;
  - dos reintegros de una línea a la vez;
  - un carrito usado mientras corre la limpieza.
- **Verificar el commit feat por separado:** detectó una spec de integración que no compilaba sola (T-161).
- **CI a la primera** en los 6 pull requests.

#### Qué mejorar

- **Comparar errores de dominio:** `toThrow(new Error(…))` solo compara el mensaje. Un error con `details` se compara con `rejects.toMatchObject({ code, details })` (T-161).
- **Valores distintos en los datos de prueba:** valores que coinciden dejaron pasar mutaciones (T-215). Fueron un reembolso igual al total, una dirección sin número interior y una sola forma de despacho.
- **`tsc` compila también las specs de integración:** al quitar un campo de una firma, hay que buscarlo en ellas antes del commit (T-161).
- **Huecos de contrato tardíos:** `id` y `version` de `AdminOrder.shipment` y el `id` de las líneas de `AdminOrder` aparecieron durante la implementación. En cada plan conviene revisar las representaciones de `API_SPEC.md` §8 de las vistas que se tocan.
- **Escaneo de secretos encadenado con `| tail`:** ocultó su código de salida. Con `set -o pipefail`, el commit depende del escaneo (T-195 parte a).
- **DTO que redeclara un campo de su base:** no puede hacerlo con decorador (TS2612). Cada vista declara su propio campo (T-195 parte a).

#### Resultado del paso 0

- **Revisión contra los ADR, sin contradicciones:**
  - existen todas las referencias a ADR, tareas, P-xx, reglas de negocio, casos de uso y errores; el índice de ADR coincide con sus secciones, y siguen abiertas las mismas 9 decisiones;
  - las variables de `.env.example` coinciden con las que valida el código (las `POSTGRES_*` son solo de Docker Compose);
  - existen los scripts que cita la documentación;
  - cada contexto tiene sus cuatro capas, y `audit` solo infraestructura, como dice `ARCHITECTURE.md`;
  - los `overrides` de ADR-0091 siguen siendo necesarios, porque Prisma 7.10.0 todavía fija `mysql2` 3.15.3 y `deepmerge-ts` 7.1.5;
  - `npm audit` no encuentra vulnerabilidades.
- **Dependabot:** no hay pull requests abiertos. El agrupado del lunes 5 de octubre se revisa cuando llegue, entre tareas.
- **Índice sin uso (ADR-0136):** la migración `20261002120000_inventory_drop_reservation_expiry_index` quita `(expires_at) WHERE status = 'ACTIVE'` de `reservations`, y el esquema deja de declararlo. La prueba que compara la base migrada con el esquema detecta tanto una migración olvidada como un índice que el esquema siga declarando.
- **Guías:** `DEVELOPMENT_GUIDE.md` suma las prácticas de la review del Sprint 4:
  - comparar errores sin `correlationId` ni `instance`;
  - el código esperado en los ayudantes de las e2e;
  - la suite e2e completa antes de cada commit, por el documento OpenAPI, y `@ApiProperty({ type: [String] })` en los arreglos;
  - decidir en cada plan si una operación lee el reloj una sola vez.

#### Siguiente sprint

La propuesta del Sprint 6 se aprobó el 2026-10-02; ver su entrada en este historial.

### Sprint 4 — Compra con pago en tienda (2026-10-01 a 2026-10-02)

**Goal:** compra completa con pago en tienda: un cliente o un invitado arma su carrito, coloca la orden y la paga en tienda; si no paga, la orden vence y el stock reservado vuelve. **Tareas:** T-170, T-180 (en dos partes), T-190 (en dos partes), T-230, T-181 (en dos partes) y T-185, todas en DONE, precedidas por un paso 0.

**Fecha:** 2026-10-02. **Resultado:** objetivo cumplido. Las 6 tareas están en DONE y el pipeline de CI está en verde en `main`. Un cliente o un invitado arma su carrito, coloca la orden y la paga en tienda; si no paga, la orden vence, su stock vuelve y sus líneas regresan al carrito. El staff administra las órdenes, cancela con reembolso y registra pagos y reembolsos en tienda, y el cliente puede volver a comprar una orden cancelada.

#### Entregables

| Entregable | Estado | Referencia |
|---|---|---|
| El pipe de validación reporta primero la presencia y el tipo de cada campo; límite general de 1000 por minuto en las e2e | DONE | Paso 0, ADR-0130 |
| Carrito de invitado y de cliente, con fusión, y precios y disponibilidad calculados al leer | DONE | T-170, ADR-0131 |
| Cotización, colocación de la orden con reserva todo o nada, y mis pedidos | DONE | T-180 parte a, ADR-0132 |
| Administración de órdenes, cancelación, reintento del surtido, pago capturado y pago tardío | DONE | T-180 parte b, ADR-0133 |
| Pago en tienda: iniciar el pago, registrarlo a mano, consultar pagos y verlos en la orden | DONE | T-190 parte a, ADR-0134 |
| Reembolso total al cancelar una orden pagada, y registro del reembolso manual | DONE | T-190 parte b, ADR-0135 |
| Vencimiento de órdenes impagas con su reserva, con un job cada minuto | DONE | T-230, ADR-0136 |
| Las líneas de una orden vencida vuelven al carrito | DONE | T-181 parte a, ADR-0137 |
| Consulta de pedido de invitado con email y código público | DONE | T-185, ADR-0138 |
| Recompra de órdenes canceladas o reembolsadas por el cliente, el invitado y el staff | DONE | T-181 parte b, ADR-0139 |
| 1,881 tests (1,069 unitarios, 350 de integración y 462 end-to-end); 0 vulnerabilidades; 0 secretos en el historial | — | CI |
| 139 ADR: 138 aceptados y 1 reemplazado parcialmente (ADR-0001); 10 nuevos en este sprint (ADR-0130 a ADR-0139) | — | `DECISIONS.md` |
| P-73 resuelta (ADR-0132); siguen abiertas las 9 decisiones de siempre | — | `PROGRESS.md` |

El trabajo se integró en 10 pull requests a `main` (del #59 al #68). La CI pasó a la primera en todos, y también en `main` después de cada fusión.

#### Decisiones abiertas que pasan al siguiente sprint

Ninguna bloquea los envíos manuales, el reintegro, los correos con el capturador local ni la limpieza diaria.

| Grupo | Decisiones |
|---|---|
| Dependen del hosting | P-05 (CD), P-06 (hosting, HSTS, TLS e IP del cliente detrás del proxy), P-07 (métricas y trazas), P-13 (secretos en servidor), P-24 (proveedor de correo) |
| Dependen de la cuenta de PayPal | P-31 (pruebas de webhooks; bloquea T-191) |
| Validaciones externas | P-61 (legal; difiere T-232), P-69 (fiscal) |
| Negocio y operación | P-14 (objetivos no funcionales cuantitativos) |

#### Riesgos que pasan al siguiente sprint

- **Resueltos en este sprint:**
  - las reservas ya vencen (T-230);
  - P-73: Ordering le pasa a Inventory las líneas del reintegro, así que no hay ciclo (ADR-0132).
- **Heredados, siguen vigentes:** ver las reviews de los sprints 2 y 3 en el historial. Entre ellos, el estado en memoria de una sola instancia, la imagen de producción de 920 MB, que no se volvió a medir, y el adaptador de PayPal sin verificar.
- **Nuevos de la compra:**
  - **Efectos que dependen de un evento:** `PaymentCaptured`, `RefundCompleted` y `OrderExpired` se pierden si falla su manejador. El pago lo rescatará la conciliación de T-192; los otros dos quedan en el log para revisión (ADR-0098).
  - **Varias instancias:** el job de vencimiento correría en cada una. El bloqueo de la orden evita efectos dobles, pero haría falta un bloqueo advisory (ADR-0029, ADR-0136).
  - **Pagar dos veces:** riesgo aceptado (ADR-0054, ADR-0055), ahora real. Una orden vencida devuelve sus líneas al carrito y todavía puede pagarse en tienda, así que el cliente podría pagar dos veces si vuelve a comprar.
  - **Recompra sin `Idempotency-Key`:** repetirla vuelve a sumar las líneas, con el tope de 30 (ADR-0139).
  - **Contadores del rate limit:** viven en memoria y son por IP; detrás de un proxy habrá que decidir qué IP se toma (P-06).
  - **Cambios de contrato:**
    - la ruta y la respuesta del pago manual (ADR-0134);
    - la respuesta de la recompra (ADR-0139).
  - **Funciones pendientes de otras tareas:**
    - sin correos al cliente hasta T-215;
    - el reintegro responde 409 `restock-not-allowed` hasta T-161;
    - Ordering todavía no publica `OrderPlaced`, `OrderPaid` ni `OrderCancelled`.
  - **Índice sin uso:** el índice `(expires_at) WHERE status = 'ACTIVE'` de `reservations` quedó sin uso (ADR-0136).
  - **Documentación OpenAPI:** solo se construye en las suites que simulan el entorno local, así que un DTO que la rompe pasa las pruebas de su propia ruta.

#### Qué funcionó

- **Partir las tareas:** T-180, T-190 y T-181 se hicieron en dos partes. T-185 se metió entre las dos de T-181 para que la recompra pública usara su identificación del invitado y su límite.
- **Dependencias en un solo sentido:** Ordering usa ocho fachadas, y Payments y Shopping le responden con eventos (`PaymentCaptured`, `RefundCompleted` y `OrderExpired`), así que nunca se formó un ciclo.
- **Pruebas de mutación:** siguieron encontrando huecos reales. En T-190 parte b sobrevivieron 7 de 60:
  - 3 eran pruebas faltantes;
  - 1 era una línea de código muerto, que se quitó;
  - 3 eran equivalentes.

  En T-181 y T-185 cada sobreviviente fue una prueba faltante.
- **Concurrencia:** cada carrera nueva tiene su prueba contra PostgreSQL, y todas pasaron 5 de 5:
  - cancelación contra pago;
  - dos reembolsos a la vez;
  - vencimiento contra pago y contra cancelación;
  - restauración y recompra contra una línea nueva del mismo cliente.
- **Usar el caso de uso real en las pruebas:** cambiar el vencimiento simulado por el job reveló que la simulación no sumaba versión.
- **CI a la primera** en los 10 pull requests.

#### Qué mejorar

- **Documentación OpenAPI:** un `string[]` sin `@ApiProperty({ type: [String] })` rompió la construcción del documento. Solo lo encontró la corrida completa de las e2e, en una suite ajena a la ruta. Conviene una prueba que construya el documento en toda corrida.
- **Comparar respuestas de error:** los Problem Details llevan `correlationId` e `instance`, que cambian en cada solicitud. Una prueba de "respuestas idénticas" debe excluirlos.
- **Códigos en los ayudantes de las e2e:** agregar al carrito responde 201 al crearlo y 200 cuando ya existe. Los ayudantes deben recibir el código esperado.
- **Heredocs:** un heredoc de Python volvió a fallar. La regla de escribir los scripts en archivos sigue vigente.
- **Fechas dentro de una operación:** el reembolso y la cancelación leen el reloj por separado. Conviene decidir en cada plan si una operación usa una sola fecha.

#### Resultado del paso 0

- **Revisión contra los ADR, sin contradicciones:**
  - existen todas las referencias a ADR, tareas, P-xx, reglas de negocio y casos de uso, y siguen abiertas las mismas 10 decisiones (P-73 incluida);
  - las variables de `.env.example` coinciden con las que valida el código (las `POSTGRES_*` son solo de Docker Compose);
  - existen los scripts que cita la documentación;
  - cada contexto tiene sus cuatro capas, y `audit` solo infraestructura, como dice `ARCHITECTURE.md`;
  - las dependencias coinciden con el stack;
  - los `overrides` de ADR-0091 siguen siendo necesarios, porque Prisma 7.10.0 todavía fija `mysql2` 3.15.3 y `deepmerge-ts` 7.1.5;
  - `npm audit` no encuentra vulnerabilidades.
- **Dependabot:** no hay pull requests abiertos. El agrupado del lunes 5 de octubre se revisa cuando llegue, entre tareas.
- **Validación (ADR-0130):** el pipe reporta primero la presencia y el tipo de cada campo, sin importar el orden de los decoradores. Corrige las 102 propiedades de 14 archivos que tenían la regla de tipo arriba, sin tocarlas: por ejemplo, `pageSize=abc` ahora responde "Debe ser un número entero.".
- **Rate limit en las e2e:** `test/e2e-environment.ts` sube el límite general a 1000 por minuto en todas las suites; las que prueban límites fijan los suyos.
- **Guías:** `DEVELOPMENT_GUIDE.md` suma medir con datos grandes y revisar las pruebas al crear datos por migración, y `AI_WORKFLOW.md`, cómo editar con scripts y comprobar el escaneo de secretos antes de cada commit.

#### Siguiente sprint

La propuesta del Sprint 5 se aprobó el 2026-10-02; ver su entrada en este historial.

### Sprint 3 — Catálogo vendible (2026-09-29 a 2026-09-30)

**Goal:** catálogo vendible: categorías, marcas, productos con variantes e imágenes, precios, stock con reservas y costo de envío. **Tareas:** T-150, T-141, T-196, T-140 (en tres partes), T-145 (en dos partes) y T-160 (en dos partes), todas en DONE, precedidas por un paso 0.

**Fecha:** 2026-10-01. **Resultado:** objetivo cumplido. Las 6 tareas están en DONE y el pipeline de CI está en verde en `main`. El catálogo es vendible: categorías, marcas, productos con variantes e imágenes, precios, stock con reservas, costo de envío y una tienda pública con búsqueda y filtros.

#### Entregables

| Entregable | Estado | Referencia |
|---|---|---|
| `npm run secrets:scan` antes de cada commit; avisos de seguridad de dos dependencias corregidos | DONE | Paso 0, ADR-0119 |
| Categorías y marcas: administración, slugs numerados, movimientos sin ciclos y árbol público con cache | DONE | T-150, ADR-0120 |
| Imágenes de producto en disco detrás de un puerto, validadas por su contenido y servidas en `/media` | DONE | T-141, ADR-0121 |
| Método de envío, costo con IVA y envío gratis por monto | DONE | T-196, ADR-0122 |
| Productos y variantes para el staff, con `search_vector` y eventos | DONE | T-140 parte a, ADR-0123 |
| Galería de imágenes de cada producto | DONE | T-140 parte b, ADR-0124 |
| Precios en una línea de periodos sin huecos, precios programados y `PricingFacade.quote` | DONE | T-145 parte a, ADR-0125 |
| Carga masiva de precios en CSV, todo o nada | DONE | T-145 parte b, ADR-0126 |
| Almacén, entradas, ajustes, listado de stock y movimientos | DONE | T-160 parte a, ADR-0127 |
| Reservas para el checkout (`InventoryFacade`), con pruebas de concurrencia | DONE | T-160 parte b, ADR-0128 |
| Tienda pública (listado, detalle y marcas), `storeVisibility`, test de las tablas de cada contexto y cache acotada | DONE | T-140 parte c, ADR-0129 |
| 1,528 tests (878 unitarios, 298 de integración y 352 end-to-end); 0 vulnerabilidades; 0 secretos en el historial | — | CI |
| 129 ADR: 128 aceptados y 1 reemplazado parcialmente (ADR-0001); 11 nuevos en este sprint (ADR-0119 a ADR-0129) | — | `DECISIONS.md` |
| Las 9 decisiones pendientes siguen abiertas; se abrió P-73 (reintegro de stock sin ciclo entre Inventory y Ordering) | — | `PROGRESS.md` |

El trabajo se integró en 11 pull requests a `main` (del #47 al #57). La CI pasó a la primera en todos, y también en `main` después de cada fusión.

#### Decisiones abiertas que pasan al siguiente sprint

Las nueve de siempre no bloquean el carrito, el checkout ni el pago en tienda. P-73 se resuelve al planear T-180, que define cómo usa Ordering a Inventory.

| Grupo | Decisiones |
|---|---|
| Dependen del hosting | P-05 (CD), P-06 (hosting, HSTS, TLS e IP del cliente detrás del proxy), P-07 (métricas y trazas), P-13 (secretos en servidor), P-24 (proveedor de correo) |
| Dependen de la cuenta de PayPal | P-31 (pruebas de webhooks; bloquea T-191) |
| Validaciones externas | P-61 (legal; difiere T-232), P-69 (fiscal) |
| Negocio y operación | P-14 (objetivos no funcionales cuantitativos) |
| Arquitectura | P-73 (cómo obtiene Inventory las cantidades del reintegro sin un ciclo con Ordering; bloquea T-161) |

#### Riesgos que pasan al siguiente sprint

- **Resuelto en este sprint:** las lecturas SQL entre contextos del catálogo público ya no dependen del code review: un test verifica que cada módulo use solo sus tablas (ADR-0129). El acceso a la base con la transacción activa (ADR-0093) sigue revisándose a mano.
- **Heredados, siguen vigentes:** ver la review del Sprint 2 en el historial. Entre ellos, los efectos de eventos que se pierden si falla su handler, el estado en memoria de una sola instancia, la imagen de producción de 920 MB y el adaptador de PayPal sin verificar.
- **Nuevos del catálogo:**
  - las reservas no vencen solas hasta T-230 (ADR-0128);
  - el listado de la tienda calcula la oferta de todos los productos en cada consulta: de 40 a 55 ms con 5 000 productos. Los listados sin búsqueda salen de la cache, y si el catálogo crece se puede pasar a una proyección de lectura (ADR-0060, ADR-0129);
  - la tienda puede mostrar hasta 120 s un precio o una disponibilidad desactualizados, así que el checkout debe volver a validar (ADR-0028);
  - una búsqueda hecha solo de palabras vacías ("de"), o del inicio de una, no encuentra nada (ADR-0129);
  - las imágenes viven en el disco del servidor: van en los respaldos y necesitan un volumen en Docker (ADR-0024). Un archivo queda huérfano si falla su borrado después del commit (ADR-0124);
  - el test de las tablas de cada contexto reconoce el SQL escrito con palabras clave en mayúsculas (ADR-0129);
  - dos `ORDER BY` que exigen las reglas no los puede observar ningún test: el de los stock items al reservar (BR-INV-14) y el de la página del listado (ADR-0129).

#### Qué funcionó

- **Partir las tareas grandes:** T-140 en tres partes, y T-145 y T-160 en dos, cada parte con su plan, sus preguntas y su pull request. La consulta pública llegó al final, cuando precios y stock ya tenían dueño.
- **Dependencias en un solo sentido:** Pricing e Inventory usan la fachada de Catalog, y Catalog no usa a ninguno, así que nunca se formó un ciclo (ADR-0125, ADR-0127). `storeVisibility` salió del servicio de la tienda en vez de la fachada de Pricing.
- **Pruebas de mutación:** siguieron encontrando huecos reales. En T-140c, 7 de 9 sobrevivientes eran pruebas faltantes, por ejemplo un precio en una lista que no es la predeterminada, o un orden por relevancia que no se distinguía del orden por fecha.
- **Medir con datos grandes:** con 5 000 productos apareció una página que tardaba 666 ms. Se corrigió a unos 43 ms antes de fusionar.
- **Concurrencia:** las pruebas de las reservas (cinco órdenes sobre el mismo stock, líneas en orden contrario, confirmar y liberar a la vez, dos reservas de una orden) pasaron en todas las repeticiones, solas y en la suite.
- **`npm run secrets:scan` antes de cada commit:** ningún falso positivo llegó a un commit.

#### Qué mejorar

- **Edición con comandos de shell:** los heredocs sin comillas siguieron rompiendo cadenas (`\n`), y uno dejó un script de mutaciones con un error de sintaxis. Conviene escribir los scripts con la edición directa o con heredocs entre comillas (`<<'EOF'`).
- **Migraciones que crean datos:** la lista de precios y el almacén que crean sus migraciones rompieron pruebas anteriores del esquema que creaban filas iguales. Al agregar datos por migración conviene buscar las pruebas que crean la misma clase de filas.
- **Rate limit en las e2e:** las suites que arman sus datos por HTTP pasan del límite general de 100 solicitudes por minuto y deben subirlo antes de importar `AppModule`.
- **Medir antes:** la medición de rendimiento llegó al final de T-140c. En consultas que recorren muchas filas conviene medir con datos grandes desde el primer borrador.
- **Orden de los validadores:** los decoradores de class-validator corren de abajo hacia arriba, y eso sorprendió dos veces (fechas de precios y precios de la tienda). `PageQueryDto` responde "Es mayor que el máximo permitido." a `pageSize=abc`; se corrige en el paso 0 del Sprint 4.

#### Resultado del paso 0

- **Revisión contra los ADR, sin contradicciones:**
  - existen todas las referencias a ADR, tareas, P-xx, reglas de negocio y casos de uso, y siguen abiertas las mismas 9 decisiones;
  - las variables de `.env.example` coinciden con las que valida el código (las `POSTGRES_*` son solo de Docker Compose);
  - existen los scripts que cita la documentación;
  - la estructura de `src/` coincide con `ARCHITECTURE.md`, y cada contexto tiene sus cuatro capas;
  - las dependencias coinciden con el stack;
  - los `overrides` de ADR-0091 siguen siendo necesarios, porque Prisma 7.10.0 todavía fija `mysql2` 3.15.3 y `deepmerge-ts` 7.1.5.
- **Arreglos menores:**
  - `API_SPEC.md` decía que no había endpoints implementados;
  - el árbol de `ARCHITECTURE.md` suma la paginación de `platform/http/` y las duraciones de `platform/config/`.
- **Vulnerabilidades nuevas** publicadas después de la última CI, sin arreglo de Dependabot todavía. Se corrigieron con `npm audit fix`, que solo cambia `package-lock.json`, y `npm audit` queda limpio:
  - `brace-expansion` 5.0.9 → 5.0.12, alta, llega por la CLI de Nest y es solo de desarrollo;
  - `fast-uri` 3.1.7 → 3.1.8, moderada, llega por el CLI de Prisma en la imagen de producción.

  Las dos correcciones se publicaron hace más de 7 días, así que respetan el cooldown de ADR-0106.
- **Dependabot:** no hay pull requests abiertos. Las versiones menores y los parches pendientes (NestJS 12.1.1, testcontainers 12.2.0, nodemailer 10.0.13, oxlint, prettier y supertest) llegan en el pull request agrupado del lunes 5 de octubre.
- **`npm run secrets:scan` (ADR-0119):**
  - corre gitleaks sobre los cambios preparados y sobre todo el historial;
  - la CI usa el mismo comando;
  - la imagen queda fijada solo en `package.json`;
  - el paso manual antes de cada commit queda en `DEVELOPMENT_GUIDE.md`.
- **Imagen de producción:** sigue en 920 MB.

#### Siguiente sprint

La propuesta del Sprint 4 se aprobó el 2026-10-01; ver su entrada en este historial.

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

La propuesta del Sprint 3 se aprobó el 2026-09-29; ver su entrada en este historial.

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

La propuesta del Sprint 2 se aprobó el 2026-09-28; ver su entrada en este historial.

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

La propuesta del Sprint 1 se aprobó el 2026-09-26; ver su entrada en este historial.

# SPRINT

## Sprint actual

5 — Entrega del pedido (Shipping, Inventory y notificaciones). Inicio: 2026-10-02 (propuesta aprobada en el Sprint Review del Sprint 4).

## Goal

Entrega del pedido: la orden pagada se envía y se entrega, o se devuelve con su stock; el cliente recibe un correo en cada paso, y la limpieza diaria borra lo vencido.

## Tasks

Detalle en `docs/TASKS.md`, sección "Contextos de negocio"; los criterios de aceptación son los de sus casos de uso en `REQUIREMENTS.md`. Orden por dependencias:

| Paso | Tareas |
|---|---|
| 0 | Revisión del repositorio contra los ADR; pull request agrupado de Dependabot (lunes 5 de octubre); migración que quita el índice sin uso de `reservations` (ADR-0136) |
| 1 | T-195 en dos partes (ADR-0140): (a) creación al pagarse, consulta, guía y cancelación con la orden; (b) despacho, entrega, entrega fallida y devolución (ADR-0141) |
| 2 | T-161 (reintegro de stock: reemplaza el 409 de `restock` y atiende las devoluciones) |
| 3 | T-215 (correos al cliente: orden recibida, pagada, enviada, cancelada y reembolsada) |
| 4 | T-231 (limpieza diaria) |

- **Criterio de cierre:** criterios de aceptación de los casos de uso de cada tarea en `REQUIREMENTS.md` y CI en verde en `main`.
- **Pospuesto al Sprint 6 o después:** T-132 (anonimización, que necesita a T-195), T-220 (consulta de auditoría), T-192 (PayPal y conciliación, sin cuenta para verificarlo) y reducir la imagen de producción.
- **Flujo de trabajo:** cada tarea se trabaja en su propia rama (`tipo/T-xxx-descripcion`) y se integra con un pull request que debe pasar la CI (ADR-0030, ADR-0084, ADR-0106). Antes de cada commit: revisar lo preparado con `git diff --cached --stat` y correr `npm run secrets:scan`, con Docker en marcha.

### Resultado del paso 0

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

## Risks

- **Ruta crítica:** T-195 → T-161 → T-215. T-195 crea el envío de la orden pagada y la lleva a SHIPPED y DELIVERED; el reintegro de los envíos devueltos y los correos de envío dependen de él.
- **Dependencias entre módulos:** Ordering usa a Shipping para cotizar, así que Shipping no puede usar a Ordering. T-195 decide en su plan cómo nace el envío al pagarse la orden y cómo avanza la orden con el envío, sin formar un ciclo: con la fachada de Shipping desde Ordering o con eventos (`ShipmentDispatched`, `ShipmentDelivered`, API_SPEC.md §2.5). Resuelto en ADR-0140: Ordering crea y cancela el envío con `ShippingFacade`, y la orden seguirá al envío por eventos en la parte b.
- **Eventos que aún no existen:** Ordering todavía no publica `OrderPlaced`, `OrderPaid` ni `OrderCancelled`, que necesitan los correos (ADR-0074). T-215 los agrega; el envío ya no depende de `OrderPaid` (ADR-0140).
- **Reintegro (T-161):** Ordering le pasa a Inventory las líneas y lo vendido de cada una (ADR-0132), y la opción `restock` deja de responder 409 (ADR-0135). La suma reintegrada por línea nunca supera lo vendido (ADR-0052).
- **Correos (T-215):** se envían en segundo plano con el capturador local (ADR-0045, ADR-0074); P-24 (proveedor real) sigue abierta. Un correo se pierde si falla su manejador.
- **Limpieza diaria (T-231):** borra datos. Debe ir por lotes, ser idempotente y conservar los carritos de clientes (BR-CRT-06); el carrito original de una orden de invitado que se borre deja la recompra del staff en 409 (ADR-0082).
- **Riesgos heredados del Sprint 4:** ver su review en el historial.

## Sprint Review

PENDIENTE.

---

## Historial

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

La propuesta del Sprint 5 se aprobó el 2026-10-02; ver "Sprint actual".

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

La propuesta del Sprint 4 se aprobó el 2026-10-01; ver "Sprint actual".

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

# SECURITY

## Principios

- No almacenar secretos en el repositorio.
- Validar y sanitizar entradas.
- Aplicar autorización explícita.
- Hash seguro de contraseñas.
- Proteger información sensible.
- No exponer stack traces ni mensajes internos en ninguna respuesta, en ningún entorno: solo van al log (ADR-0095).
- Logging sin secretos ni datos sensibles innecesarios.
- Aplicar rate limiting cuando corresponda.
- Revisar dependencias vulnerables: la CI falla con vulnerabilidades altas y críticas (`npm audit --audit-level=high`), y Dependabot propone actualizaciones semanales (ADR-0030, ADR-0105).
- Detectar secretos en cada cambio: el secret scanning y la protección de push de GitHub bloquean los secretos conocidos al subirlos, y gitleaks revisa lo preparado antes de cada commit (`npm run secrets:scan`) y todo el historial en la CI (ADR-0030, ADR-0105, ADR-0119).
- La CI corre con permisos de solo lectura, actions de terceros fijadas por SHA y sin interpolar datos del pull request (como el título) en sus scripts (ADR-0105).
- Autorización (ADR-0111):
  - Toda ruta de `/v1/admin` exige staff con los permisos del catálogo en código, y toda ruta de `/v1/me`, una cuenta.
  - El guard falla cerrado: una ruta de esos grupos sin requisito responde 500 en lugar de quedar pública. Compara las rutas sin distinguir mayúsculas, como las enruta Express (ADR-0153).
  - Los 403 de `/v1/admin` se auditan.
  - Toda respuesta autenticada lleva `Cache-Control: no-store`, errores incluidos (ADR-0071, ADR-0112).
  - El sistema nunca queda sin superadministrador activo: los cambios que podrían dejarlo sin ninguno bloquean el rol y se validan de a uno (ADR-0112).
  - El motivo que da el staff queda en la auditoría y nunca debe llevar datos personales.
- Correos (ADR-0110):
  - El log no registra destinatarios, asuntos ni contenidos.
  - `MAIL_FROM` se valida en una sola línea, y nodemailer impide inyectar encabezados desde el asunto.
  - Los enlaces al frontend se arman con `FrontendLinks`, que codifica los parámetros.
  - En producción, el servidor SMTP, el remitente y la URL del frontend son obligatorios.
- Ninguna dependencia ejecuta scripts al instalarse: `allowScripts` los niega y `.npmrc` hace fallar la instalación ante uno sin revisar, en local, en la CI y en Docker. Esto también corta la telemetría de `@scarf/scarf` (ADR-0108).
- Auditoría de seguridad (T-310, ADR-0153): el resultado y los hallazgos están en `SECURITY_AUDIT.md`. Una prueba compara cómo se protege cada ruta con la matriz revisada de `test/security/route-matrix.ts` y llama a cada ruta protegida sin credenciales; una ruta nueva se revisa y se escribe allí.
- `main` solo recibe cambios por pull request con la CI en verde, sin excepciones para administradores. Dependabot espera 7 días antes de proponer una versión nueva, para evitar paquetes comprometidos recién publicados, y abre de inmediato las actualizaciones de seguridad (ADR-0106).

## Contratos de la API (ADR-0071)

- Los recursos ajenos se responden como inexistentes (404), no como 403.
- Email y código de orden de invitados viajan en el cuerpo, nunca en la URL.
- Cuerpos con campos no declarados se rechazan (400).
- Los errores de validación nunca repiten el valor rechazado, y la ruta de `instance` va sin la cadena de consulta (ADR-0095).
- El identificador de correlación lo genera siempre el servidor; uno enviado por el cliente se ignora, para que no se pueda falsificar ni usar para inyectar texto en los logs (ADR-0095).
- `Cache-Control: no-store` en respuestas autenticadas o con datos personales o tokens. Las públicas de carritos, cotización y órdenes de invitado lo llevan con `@NoStore()`, también en sus errores (ADR-0153).
- La contraseña temporal del staff se muestra una sola vez, en la respuesta de creación o de reactivación (ADR-0076). Son 20 caracteres aleatorios (unos 100 bits), pasan la política de contraseñas y se guardan solo como hash (ADR-0116).
- El primer superadministrador se crea con un script que muestra su contraseña temporal una sola vez en la terminal, nunca en el log, y que se niega a correr si ya hay un superadministrador activo (ADR-0116).
- Un staff con cambio de contraseña pendiente solo accede a su cuenta, al cambio de contraseña y al cierre de sesión.
- Las rutas públicas de carrito solo operan sobre carritos sin dueño.
- El pago de un invitado exige el `cartId` de origen de la orden.

## Autenticación

Integración: Passport mediante `@nestjs/passport` (ADR-0022). Las estrategias viven en Infrastructure y delegan en casos de uso; el dominio no depende de Passport.

Mecanismo (ADR-0023):

- Login con email y contraseña, validados como cualquier solicitud y comprobados por el caso de uso `SignIn`, sin estrategia de Passport (ADR-0114).
- Token de acceso JWT de unos 15 minutos (configurable), enviado en `Authorization: Bearer`. Sin cookies.
- Refresh token opaco, guardado con hash en base de datos y rotado en cada uso.
- Suspender un usuario o cerrar sesión revoca sus refresh tokens. Cada solicitud comprueba la cuenta y la sesión, así que el token de acceso deja de servir en la siguiente solicitud (ADR-0114).
- Token de acceso: JWT HS256 con solo el usuario y la sesión; la verificación no acepta otro algoritmo. Clave `JWT_SECRET` de al menos 32 caracteres, obligatoria en producción (ADR-0114).
- Hash de contraseñas con Argon2id de `node:crypto`: 19 MiB, 2 pasadas y 1 carril (mínimo de OWASP), formato PHC y normalización NFKC (ADR-0114).
- El login responde igual y tarda lo mismo con un email inexistente: se compara contra un hash de reemplazo (ADR-0062, ADR-0114).
- Política de contraseñas (ADR-0047): de 15 a 64 caracteres, sin reglas de composición, aceptando letras, dígitos, espacio y todos los símbolos imprimibles, y rechazo de contraseñas comunes mediante una lista local. Aplica a clientes, staff y contraseñas temporales (generadas por el sistema).
  - Implementada en ADR-0115: la longitud se cuenta en caracteres tras normalizar a NFKC, y se rechazan tabuladores, saltos de línea y caracteres de control o invisibles.
  - La lista son 5,328 contraseñas comunes de SecLists (`data/passwords/`). La API no arranca sin ella.
  - El cambio de contraseña comprueba la actual antes que la política.
- Segundo factor (2FA): pospuesto, con el diseño de autenticación preparado para incorporarlo (ADR-0048).
- Cambio de contraseña desde la cuenta: revoca las demás sesiones, conserva la actual y envía aviso por correo (ADR-0072).
- Recuperación de contraseña (ADR-0056): enlace de un solo uso vigente 30 minutos, token guardado con hash, respuesta que no revela si el email existe, límite por email y por IP, revocación de todas las sesiones al restablecer y aviso por correo. El cambio obligatorio del staff pide la contraseña temporal.
  - Implementada en ADR-0118: vigencia configurable de 5 minutos a 2 horas, y el cambio de email invalida los enlaces pendientes, que fueron a la dirección anterior.
- Los enlaces de verificación y recuperación usan la URL base del frontend configurada por variable de entorno (ADR-0056).
- Verificación de email (ADR-0046): enlace de un solo uso vigente 24 horas; reenvío limitado que invalida el anterior; nueva verificación al cambiar de email.
  - Implementada en ADR-0117: el token del enlace (256 bits) se guarda solo como hash, y verifica únicamente la dirección a la que se envió.
- Enlace de acceso a los pedidos de invitado (ADR-0148): el mismo token de 256 bits guardado solo como hash, de un solo uso, vigente 30 minutos (configurable), que invalida los anteriores del email. Se emite en segundo plano, para que ni la respuesta ni su tiempo revelen si el email tiene órdenes, y la anonimización del invitado lo borra.
  - El reenvío responde igual en todos los casos y solo envía a clientes activos sin verificar.
  - Cambiar el email pide la contraseña actual, se audita y avisa al email anterior, sin mostrarle el nuevo.
- La clave de firma de los JWT se gestiona como secreto (ADR-0032).
- El refresh token dura 7 días (configurable).
- Si se presenta un refresh token ya rotado, se revoca toda la sesión a la que pertenece y el usuario debe volver a iniciar sesión.

Ya definido:

- Un usuario suspendido no puede autenticarse (BR-USR-02). Al reactivarlo, el staff recibe una contraseña temporal nueva con cambio obligatorio, porque la suspensión pudo deberse a una contraseña comprometida; la reactivación se audita como evento de seguridad (ADR-0076).
- El hash de contraseña, los tokens y los intentos de login nunca salen del contexto Identity & Access.
- Se permite compra como invitado (ADR-0010): los endpoints de checkout y carrito deben funcionar sin usuario autenticado, y el invitado consulta su orden con email de contacto y el código público aleatorio de la orden (ADR-0020, ADR-0049); el número interno consecutivo nunca se expone a clientes. Ese endpoint requiere rate limiting y respuestas de error que no revelen si la orden existe. Si perdió el código, pide con su email un enlace de un solo uso que llega a ese buzón; la respuesta es la misma, y sale antes de emitir el enlace, tenga o no órdenes el email (ADR-0148).

## Autorización

RBAC (ADR-0017):

- Permisos con granularidad contexto.acción, definidos en código por cada módulo.
- Roles editables en base de datos.
- Guards en la capa de presentación.
- Las llaves de idempotencia están ligadas a quien las envía, para que nadie obtenga la respuesta de otro usuario con una llave ajena (ADR-0063).
- El `cartId` de un carrito de invitado es aleatorio y no adivinable, porque es la única credencial de ese carrito (ADR-0059).
- Login: respuesta única de credenciales no válidas, sin revelar si la cuenta existe o está suspendida. Registro: indica si el email ya existe (riesgo de enumeración aceptado, mitigado con rate limiting obligatorio en el registro) (ADR-0062).
- Rutas de cliente bajo `/v1/me`: el ID del cliente se toma del token, nunca de la URL, para impedir el acceso a recursos de otros clientes (ADR-0036).
- Rutas administrativas bajo `/v1/admin/{contexto}`: un guard por grupo exige token de staff y el permiso del contexto.
- Los demás contextos no consultan tablas de Identity.
- La cancelación y gestión de órdenes requiere el permiso `orders.manage`, reservado a administradores y roles de nivel alto (ADR-0021).
- Roles iniciales (ADR-0043): Superadministrador (todos los permisos), Administrador (todos excepto `staff.manage`) y Operador (catálogo, precios, inventario, lectura de pedidos, envíos y lectura de clientes).
- Las cuentas son de tipo cliente o staff; los clientes nunca tienen roles.
- El primer superadministrador se crea con un script manual; no hay credenciales predeterminadas en el repositorio.
- El staff se autentica solo con contraseña; el segundo factor (2FA) queda como mejora a mediano o largo plazo, con el diseño preparado (ADR-0048).

## Pagos

- Nunca se almacenan datos de tarjeta; solo referencias y tokens del proveedor.
- Los webhooks verifican la firma de cada proveedor y se deduplican.
- El monto a cobrar se obtiene de la orden, nunca del cliente.
- Los cambios que afectan pagos requieren revisión humana (`TEAM_GUIDE.md`).
- El registro de pagos y reembolsos manuales requiere `payments.manage`, queda auditado y solo está disponible si la variable de entorno que habilita el pago manual está activa (ADR-0040, ADR-0051). La variable es `MANUAL_PAYMENTS_ENABLED`, `false` por defecto (ADR-0134).

## Subida de archivos

- Solo el personal con permiso de catálogo puede subir imágenes.
- Se valida el tipo real del archivo por su contenido, no por su extensión ni por el tipo declarado por el cliente.
- El nombre en disco lo genera el servidor; nunca se usa el nombre enviado por el cliente (evita sobrescrituras y rutas manipuladas).
- La carpeta de imágenes no permite ejecutar archivos.
- Formatos permitidos: JPEG, PNG y WebP. Tamaño máximo: 5 MB por imagen, configurable (ADR-0024). El límite se aplica al recibir la solicitud, antes de procesar el archivo completo.
- Implementación (ADR-0121):
  - el formato se reconoce por los primeros bytes del archivo;
  - la clave `products/<productId>/<imageId>.<ext>` la genera el servidor, y el adaptador rechaza cualquier otra antes de tocar el disco;
  - los archivos se escriben primero en `.uploading/` y quedan con permisos `0644`, sin ejecución;
  - la API los sirve en `/media` con `nosniff` y la CSP estricta, sin listar carpetas ni servir carpetas con punto.
- Las imágenes no se reescriben, así que conservan sus metadatos EXIF, que pueden incluir la ubicación donde se tomó la foto: el staff debe subir fotos sin ubicación (ADR-0121).
- `/media` es público y no pasa por el rate limiting de la API; cuando exista hosting (P-06), conviene servirlo desde un servidor web o un CDN.

## Gestión de secretos

ADR-0032:

- Configuración y secretos se leen de variables de entorno. En local, desde `.env`, que nunca se versiona.
- `.env.example` lista todas las variables del proyecto con descripción y valores de ejemplo no reales; al desplegar se usa como base.
- La API no arranca si falta una variable obligatoria.
- La detección de secretos es la segunda barrera: la protección de push de GitHub y gitleaks antes de cada commit y en la CI (ADR-0105, ADR-0119). Un secreto detectado se rota de inmediato y se saca del historial; solo los falsos positivos revisados van en `.gitleaksignore`, con un comentario.
- Almacén de secretos en el servidor: PENDIENTE DE DECISIÓN hasta elegir hosting (P-13).

## CORS / CSRF

CSRF: no aplica a la autenticación, porque las credenciales viajan en el encabezado `Authorization` y no en cookies (ADR-0023). Si en el futuro se usan cookies, revisar.

CORS (ADR-0085):

- Orígenes permitidos: lista de orígenes exactos en `CORS_ALLOWED_ORIGINS`, vacía por defecto; sin configurarla, ningún navegador de otro origen puede usar la API.
- Sin comodín: la validación de configuración rechaza `*` y los orígenes mal formados, y la API no inicia.
- Sin credenciales; métodos `GET`, `POST`, `PUT`, `PATCH` y `DELETE`; encabezados de solicitud `Authorization`, `Content-Type` e `Idempotency-Key`; encabezados expuestos `Location`, `Retry-After` y `X-Correlation-Id`; preflight en caché 600 segundos.
- Una sola lista para todas las rutas. CORS no sustituye la autorización: cada solicitud sigue validando token y permisos.

## Encabezados de seguridad

ADR-0086, con `helmet` y configuración explícita:

- En todas las respuestas de la API: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, sin `X-Powered-By`, y `Cache-Control: no-store` donde lo exige ADR-0071.
- Swagger UI (solo con `NODE_ENV=development`, en `/docs/v1`): política CSP más permisiva únicamente en su ruta, con scripts, estilos, imágenes y conexiones del mismo origen, estilos en línea e imágenes `data:`; nunca en marcos (ADR-0096).
- Sin `Cross-Origin-Resource-Policy: same-origin`, para no bloquear las imágenes que la tienda cargue desde otro origen.
- HSTS, TLS y redirección a HTTPS: a cargo de quien termine HTTPS, definido con el hosting (P-06). La API no envía HSTS.

## Rate limiting

ADR-0065: `@nestjs/throttler` con contadores en memoria; límites configurables por variables de entorno.

| Endpoint | Límite |
|---|---|
| Login | 5 intentos fallidos por email en 15 minutos, y 20 por IP |
| Registro | 5 por IP por hora |
| Recuperación de contraseña | 3 por email y 10 por IP por hora |
| Reenvío de verificación | 3 por email por hora |
| Cambio de email | 3 por hora (ADR-0071) |
| Consulta de pedido, recompra de invitado y uso del enlace de acceso | 10 por IP en 15 minutos (ADR-0071, ADR-0148) |
| Enlace de acceso a los pedidos de invitado | 3 por email y 10 por IP por hora (ADR-0148) |
| Colocar orden | 10 por usuario o carrito en 10 minutos |
| Resto de endpoints | 100 solicitudes por minuto por IP |

- La tabla de referencia por endpoint está en `API_SPEC.md` (sección 7).
- Se frena por tiempo; nunca se bloquean cuentas por intentos fallidos.
- 429 con `Retry-After` al exceder un límite.
- Detrás de un proxy, la IP a considerar se configura al elegir hosting (P-06).
- Mecanismo (ADR-0102): en el login cuentan solo los intentos fallidos, por correo y por IP; los correos usados como clave se guardan en memoria como huella SHA-256; los webhooks quedan fuera; la autenticación debe ejecutarse antes del guard de rate limiting para que los límites por usuario vean quién llama.
- El rate limiting por IP no basta para proteger la memoria de la cache, porque cada combinación de filtros del catálogo público es una clave nueva y llegan desde muchas IP. Cada espacio de la cache guarda hasta 1 000 valores y descarta el que se usó hace más tiempo (ADR-0129).

## Datos personales

ADR-0067 (Ley Federal de Protección de Datos Personales en Posesión de los Particulares de 2025; la validación legal completa corresponde a un especialista):

- Se guarda la versión del aviso de privacidad presentada en el registro y en el checkout de invitado.
- Derechos ARCO por canal externo; el staff ejecuta las acciones en el sistema.
- Anonimización de clientes y compradores invitados, implementada en T-132 (ADR-0145): no deja datos personales del comprador en sus tablas, en las respuestas guardadas por idempotencia ni en los enlaces de acceso a sus pedidos (ADR-0148), y se audita sin valores.
- Logs y auditoría sin valores de datos personales.
- Eventos de dominio guardados (ADR-0150) sin datos personales: el que lleva uno se publica como volátil y no se guarda (`OrderAccessRequested`), y el último error de cada entrega se guarda redactado como los logs. El staff las consulta y las reintenta con `events.manage`, auditado.
- Logs (ADR-0097): nunca se registran cuerpos, encabezados, tokens ni cadenas de consulta. Como red de seguridad, el logger reemplaza por `[redacted]` los correos, los JWT y los tokens `Bearer` que aparezcan en mensajes o stack traces, y en formato texto escapa los saltos de línea para que nadie pueda inyectar líneas falsas.
- Ciclo de conservación de datos personales en órdenes (operativa, bloqueo y anonimización) diseñado en ADR-0070, con plazos configurables y valores por defecto (ADR-0149). Desde T-232 parte a (ADR-0151), el job diario `ordering.retention` bloquea los datos de las órdenes concluidas hace 12 meses, que el comprador deja de ver y el staff ve sin su email ni su dirección exacta, y los anonimiza 60 meses después; audita cada paso como sistema y sin valores, y procesa hasta 1,000 órdenes de cada paso por corrida, así que un plazo acortado por error no anonimiza todo de una vez. Desde T-232 parte b (ADR-0152), los datos bloqueados solo los consulta quien tiene `orders.read-blocked` (el Administrador y el Superadministrador), con un motivo, y cada consulta se audita sin los datos; las cuentas de clientes inactivos se anonimizan si el operador configura el plazo, y la política vigente es pública, sin datos personales. Cada operador valida los plazos con su especialista antes de operar (`PROJECT.md`).

## Auditoría

- Historia de negocio en cada contexto (historial de estados de orden, movimientos de stock, periodos de precio).
- Auditoría técnica transversal y append-only (ADR-0037):
  - Se auditan todas las modificaciones del staff en `/v1/admin` y los eventos de seguridad (inicios de sesión exitosos y fallidos, cierres de sesión, cambios y recuperación de contraseña, reutilización de refresh token, suspensiones, cambios de roles y permisos, accesos denegados).
  - Los valores de campos sensibles (hashes, tokens, datos de pago) nunca se guardan.
  - Lectura exclusiva con el permiso `audit.read`; ningún endpoint modifica ni borra registros.
  - Mecanismo (ADR-0100): el actor, la IP, el agente de usuario y el identificador de correlación se toman de la solicitud; los cambios guardan solo los campos modificados, y los personales o sensibles quedan como `{ "changed": true }`, con una lista fija de nombres (contraseña, hash, token, secreto, correo, teléfono, nombres, apellidos, dirección) que se ocultan aunque no se declaren.
  - Todo 403 en `/v1/admin` se registra automáticamente como `http.access-denied` con resultado DENIED; los 401 no se auditan (sin actor conocido; los cubren el rate limiting y los logs).
  - Retención: 3 meses en la base de datos; después, archivos comprimidos hasta 2 años (configurables con `AUDIT_RETENTION_MONTHS` y `AUDIT_ARCHIVE_RETENTION_MONTHS`); cada operador los valida antes de operar (ADR-0149).
  - Los archivos comprimidos se guardan en un directorio privado, nunca servido públicamente y separado del de imágenes, e incluido en los respaldos. Implementado en T-220 (ADR-0146):
    - `AUDIT_ARCHIVE_DIR`, con permisos 0700, y sus archivos 0600;
    - la API no arranca si esa carpeta queda dentro de la de imágenes, que se sirve en `/media`;
    - los registros salen de la base solo después de releer su archivo y comparar cada ID;
    - ningún archivo se sobrescribe.

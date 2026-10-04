# AUDITORÍA DE SEGURIDAD

Evaluación de la API contra el OWASP API Security Top 10 (2023) y contra lo que afirma `SECURITY.md` (T-310, ADR-0153). `SECURITY.md` es la política; este documento registra qué se revisó, qué se encontró y en qué quedó cada hallazgo.

## 1. Alcance y método

- **Fecha:** 2026-10-03, sobre `main` después del Sprint 8.
- **Alcance:** las 126 rutas de `/v1`, el servicio de `/media`, la plataforma (HTTP, autenticación, autorización, rate limiting, idempotencia, configuración, logs y correo), el `Dockerfile`, Docker Compose y la CI. Fuera de alcance: PayPal, que no está habilitado (T-191), y el despliegue, sin hosting (P-06).
- **Matriz de rutas (control permanente):** una prueba e2e lee cada ruta de la aplicación con los metadatos que leen sus guards e interceptores y la compara con `test/security/route-matrix.ts`. Una ruta nueva, o un cambio en cómo se protege, falla hasta revisarse. La misma prueba llama a cada ruta protegida sin token y con permisos insuficientes.
- **Revisión ruta por ruta,** en cuatro áreas: Identity & Access, Privacy, Audit y Geo; Catalog, Pricing, Inventory, Shipping y entregas de eventos; Shopping, Ordering y Payments; y la plataforma. Cada hallazgo se verificó en el código, y los que dicen un comportamiento, con una prueba.
- **Análisis estático:** una pasada única de Semgrep con su imagen oficial de Docker, con las reglas de TypeScript, Node.js, Express, OWASP Top 10 y secretos, sin agregarlo al repositorio ni a la CI: 151 reglas en 690 archivos, 2 resultados (SA-24 y SA-25).
- **Dependencias y secretos:** `npm audit` sin vulnerabilidades; gitleaks sin secretos en el historial.

### Severidad

| Severidad | Criterio |
|---|---|
| Crítica | Acceso a datos o acciones ajenas sin credenciales, o compromiso del sistema |
| Alta | Lo mismo con una credencial cualquiera, o pérdida de datos |
| Media | Abuso que afecta a terceros, a la disponibilidad o eleva privilegios dentro de un permiso alto |
| Baja | Defensa en profundidad, errores 500 provocables o diferencias con `SECURITY.md` sin acceso indebido |
| Informativa | Observación o riesgo aceptado, sin acción |

## 2. Matriz de rutas

| Acceso | Rutas |
|---|---|
| Público | 26 |
| Cualquier cuenta | 9, y 3 más que admiten al staff con contraseña temporal (`GET /v1/me`, cambio de contraseña y cierre de sesión) |
| Solo clientes | 8 |
| Staff con permisos del catálogo | 80 |

- 10 rutas tienen límites propios (ADR-0065) y 5 exigen `Idempotency-Key` (ADR-0063). El login se limita por sus intentos fallidos, sin decorador (ADR-0102).
- Las 100 rutas protegidas responden 401 sin token, con `Cache-Control: no-store`; las 80 administrativas responden 403 al staff con todos los permisos menos los suyos y a los clientes; las 8 de solo clientes responden 403 al staff.

## 3. Resultado

No hay hallazgos críticos ni altos. Hay 5 medios, que necesitan decisiones y van a la parte b de T-310 (ADR-0154 si alguno cambia una decisión vigente); 12 bajos, de los que la parte a corrigió 9; y 10 informativos.

| ID | Severidad | OWASP | Hallazgo | Estado |
|---|---|---|---|---|
| SA-01 | Media | API4 | Los límites propios reemplazan al general de 100 por minuto por IP. Colocar una orden de invitado se cuenta por el `cartId` del cuerpo y el reenvío de verificación por el email, así que cambiándolos no hay tope por IP. Cada orden con un `cartId` inventado guarda además un 404 en `idempotency_keys` por 24 horas | Parte b |
| SA-02 | Media | API6 | El checkout de invitado envía "Recibimos tu pedido" a un email sin verificar, con nombre y calle que escribe quien compra, y aparta stock 20 minutos; no hay límite por email | Parte b |
| SA-03 | Media | API5 | Quien tiene `staff.manage` puede darse el rol de superadministrador, crear un rol con todos los permisos y obtener la contraseña temporal de otro staff al suspenderlo y reactivarlo. Hoy solo el Superadministrador tiene ese permiso, pero los roles son editables | Parte b |
| SA-04 | Media | API2, API6 | El límite de 5 fallos por email se comprueba antes que las credenciales: cualquiera puede impedir que el titular entre, el bloqueo de cuentas que ADR-0065 rechazó | Parte b |
| SA-05 | Media | API10 | El correo usa STARTTLS oportunista, sin TLS obligatorio ni autenticación SMTP, y en producción se acepta un `FRONTEND_BASE_URL` con `http`: los enlaces con token podrían viajar sin cifrar. Se resuelve con el proveedor de correo (P-24) | Parte b |
| SA-06 | Baja | API8 | Las respuestas públicas con datos personales o con el `cartId` (carritos, cotización, órdenes de invitado, su consulta, enlace, recompra y pago) no llevaban `Cache-Control: no-store`, como pide `SECURITY.md` | Corregido |
| SA-07 | Baja | API5, API8 | Express enruta sin distinguir mayúsculas, pero el guard y el filtro de errores comparaban `/v1/admin` y `/v1/me` con ellas: `/V1/ADMIN/...` no auditaba su 403 ni fallaba cerrado ante una ruta sin requisito. El permiso sí se aplicaba | Corregido |
| SA-08 | Baja | API8 | La respuesta 415 salía antes de helmet y CORS: con `X-Powered-By: Express` y sin los encabezados de seguridad | Corregido |
| SA-09 | Baja | API4 | `page` no tenía máximo: `page=1e21` respondía 500, en el catálogo público y en los listados del staff; `availableMax` de existencias, igual | Corregido |
| SA-10 | Baja | API4 | Un cuerpo JSON muy anidado desbordaba la pila de la validación y de la huella de idempotencia: 500 en cualquier ruta | Corregido |
| SA-11 | Baja | API4 | Los filtros `q` de staff, clientes, roles y existencias, y el `sku` de existencias, no tenían longitud máxima; las listas de roles, tampoco | Corregido |
| SA-12 | Baja | API2 | Una contraseña escrita en forma descompuesta (NFD) se registraba, porque la política cuenta tras NFKC, pero el login, el cambio de contraseña y el de email la rechazaban por pasar de 64 caracteres | Corregido |
| SA-13 | Baja | API8 | Docker Compose publicaba PostgreSQL, Mailpit y la API en todas las interfaces; Mailpit guarda los enlaces de verificación y recuperación | Corregido |
| SA-14 | Baja | API8 | `IMAGE_STORAGE_DIR` podía ser la carpeta de trabajo o una que la contuviera: `/media` publicaría el código y el `.env` | Corregido |
| SA-15 | Baja | API2 | El cambio de contraseña no tiene límite por usuario: con un token robado se puede probar la contraseña actual, y cada intento cuesta un Argon2id | Parte b |
| SA-16 | Baja | API2 | La recuperación de contraseña y el reenvío de verificación envían el correo dentro de la solicitud: el tiempo de respuesta dice si la cuenta está activa o verificada | Parte b |
| SA-17 | Baja | API6 | Los nombres admiten saltos de línea y enlaces, y van en correos a cualquier email: registrarse con un email ajeno permite enviarle texto propio | Parte b |
| SA-18 | Baja | API4 | Los límites por IP usan la dirección IPv6 completa: un cliente con un bloque /64 la rota | Pospuesto (P-06) |
| SA-19 | Informativa | API4 | El servidor HTTP usa los tiempos de espera de Node (5 minutos por solicitud) | Pospuesto (P-06) |
| SA-20 | Informativa | API4 | La búsqueda pública admite unas 50 palabras por consulta, sin cache; la acota el límite general por IP | Aceptado |
| SA-21 | Informativa | API4 | El listado de existencias carga y ordena en memoria, compromiso documentado del MVP; necesita `inventory.read` | Aceptado |
| SA-22 | Informativa | API4 | Un carrito de cliente puede pasar de 100 líneas al fusionar o recomprar (ADR-0131); lo acota el número de variantes | Aceptado |
| SA-23 | Informativa | API1 | Las imágenes de productos sin publicar se pueden leer por su URL, que no se puede adivinar ni aparece en respuestas públicas (ADR-0121) | Aceptado |
| SA-24 | Informativa | API8 | La imagen de desarrollo del `Dockerfile` corre como root (Semgrep); las de producción y `migrate` usan `node` | Aceptado |
| SA-25 | Informativa | Cadena de suministro | `.npmrc` no fija `min-release-age` (Semgrep). Dependabot ya espera 7 días; fijarlo también retrasaría las actualizaciones de seguridad, que deben llegar de inmediato (ADR-0105) | Aceptado |
| SA-26 | Informativa | API9 | `API_SPEC.md` listaba como rutas el reintento de reembolso y el webhook de PayPal, que no existen todavía, y su tabla de grupos no tenía `/v1/privacy`; el `Location` de una imagen subida apunta a una ruta sin `GET` | Corregido |
| SA-27 | Informativa | — | Otras observaciones sin acción: la imagen base va por etiqueta y no por digest; la redacción de logs cubre emails, JWT y tokens `Bearer`; el guard de autenticación consulta la base antes del rate limit; la importación de precios audita solo conteos; entradas y ajustes de stock no son idempotentes; las contraseñas temporales del staff no vencen; los datos que alguien deja al registrarse con un email ajeno sobreviven a la recuperación del titular | Aceptado |

## 4. Correcciones de la parte a

- **SA-06:** `@NoStore()` (`src/platform/http/no-store.ts`) en los controladores públicos de carritos, cotización y órdenes de invitado. El encabezado sale antes del manejador, así que también acompaña a sus errores.
- **SA-07:** el guard de autorización y el filtro de errores comparan las rutas sin distinguir mayúsculas. La exención de los webhooks se queda como estaba: ampliarla no da seguridad.
- **SA-08:** helmet y CORS van antes del rechazo de tipos de contenido.
- **SA-09:** `page` va de 1 a 1,000,000, y `availableMax` llega al entero mayor de PostgreSQL; fuera de ese rango, 400.
- **SA-10:** el parser JSON, con el mismo límite de 100 kB, rechaza con 400 un cuerpo anidado a más de 32 niveles, antes de que lo recorra código recursivo. Las solicitudes de la API llegan a 3 niveles.
- **SA-11:** `q` de roles hasta 100 caracteres, de staff y clientes hasta 254, de existencias hasta 100, y `sku` hasta 64; de 1 a 50 roles por lista.
- **SA-12:** las contraseñas que se comparan admiten hasta 256 caracteres tal como se escriben; la política sigue contando 64 tras NFKC.
- **SA-13:** Docker Compose publica sus puertos solo en `127.0.0.1`.
- **SA-14:** la API no arranca si `IMAGE_STORAGE_DIR` es la carpeta de trabajo o la contiene.
- **SA-26:** `API_SPEC.md` corregido.

Las pruebas de estas correcciones están en `test/security/hardening.e2e-spec.ts`, `src/platform/http/json-depth.spec.ts` y `src/platform/config/environment.spec.ts`.

## 5. Controles verificados

Lo que `SECURITY.md` afirma y se comprobó en el código, con al menos una prueba:

- **Autorización:** el guard es global, falla cerrado y pone `no-store` antes de responder 401 o 403; los requisitos se leen del manejador y del controlador; el staff con contraseña temporal solo llega a su cuenta. La matriz lo comprueba en las 126 rutas.
- **Recursos ajenos:** las rutas de `/v1/me` toman al cliente del token; las direcciones, los carritos, las órdenes y los pagos de otro responden 404; las rutas públicas de carrito solo operan sobre carritos sin dueño; el pago de invitado exige el carrito de origen; las imágenes, variantes y periodos de precio pertenecen a su producto o lista.
- **Campos de más:** la validación rechaza los campos no declarados; el precio, el total y el monto a cobrar los calcula el servidor; las respuestas no llevan hashes, tokens, el número interno de la orden al comprador ni la clave de almacenamiento de una imagen.
- **Autenticación:** JWT HS256 sin otro algoritmo, con la cuenta y la sesión revisadas en cada solicitud; Argon2id con los parámetros mínimos de OWASP y un hash de reemplazo para emails inexistentes; refresh tokens de 256 bits guardados como hash, rotados en cada uso, con la sesión revocada ante una reutilización; enlaces de un solo uso de 256 bits guardados como hash.
- **Consumo de recursos:** cuerpos JSON de hasta 100 kB; `pageSize` y `limit` hasta 100; subidas de imágenes cortadas antes de leerse completas, una por solicitud, de hasta 5 MB, reconocidas por su contenido y guardadas con un nombre del servidor y permisos `0644`; archivos de precios de hasta 1 MB y 5,000 filas.
- **Configuración:** encabezados de helmet explícitos; CORS con orígenes exactos y sin credenciales; problemas sin trazas ni mensajes internos, también para errores inesperados; los errores de validación no repiten el valor; el identificador de correlación lo genera el servidor; los logs no llevan cuerpos, encabezados, tokens ni cadenas de consulta; `trust proxy` apagado, así que `X-Forwarded-For` no cambia la IP; Swagger solo en desarrollo; la imagen de producción corre como `node`, sin scripts de instalación.
- **Inventario:** todas las rutas viven bajo `/v1`, coinciden con `API_SPEC.md` y no hay rutas de salud ni sin versión.
- **SSRF y servicios externos:** la API no hace solicitudes HTTP salientes; los enlaces de los correos se arman con `FRONTEND_BASE_URL`, nunca con el encabezado `Host`; el correo tiene tiempos de espera y solo registra el código de error.

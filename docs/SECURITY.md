# SECURITY

## Principios

- No almacenar secretos en el repositorio.
- Validar y sanitizar entradas.
- Aplicar autorización explícita.
- Hash seguro de contraseñas.
- Proteger información sensible.
- No exponer stack traces en producción.
- Logging sin secretos ni datos sensibles innecesarios.
- Aplicar rate limiting cuando corresponda.
- Revisar dependencias vulnerables: la CI falla con vulnerabilidades altas y críticas, y Dependabot propone actualizaciones semanales (ADR-0030).
- Detectar secretos en cada cambio mediante la CI (ADR-0030).

## Contratos de la API (ADR-0071, propuesta)

- Los recursos ajenos se responden como inexistentes (404), no como 403.
- Email y código de orden de invitados viajan en el cuerpo, nunca en la URL.
- Cuerpos con campos no declarados se rechazan (400).
- `Cache-Control: no-store` en respuestas autenticadas o con datos personales o tokens.
- La contraseña temporal del staff se muestra una sola vez, en la respuesta de creación.
- Un staff con cambio de contraseña pendiente solo accede a su cuenta, al cambio de contraseña y al cierre de sesión.
- Las rutas públicas de carrito solo operan sobre carritos sin dueño.
- El pago de un invitado exige el `cartId` de origen de la orden.

## Autenticación

Integración: Passport mediante `@nestjs/passport` (ADR-0022). Las estrategias viven en Infrastructure y delegan en casos de uso; el dominio no depende de Passport.

Mecanismo (ADR-0023):

- Login con estrategia local (email y contraseña).
- Token de acceso JWT de unos 15 minutos (configurable), enviado en `Authorization: Bearer`. Sin cookies.
- Refresh token opaco, guardado con hash en base de datos y rotado en cada uso.
- Suspender un usuario o cerrar sesión revoca sus refresh tokens. El token de acceso vigente sigue válido hasta vencer.
- Hash de contraseñas con Argon2id.
- Política de contraseñas (ADR-0047): de 15 a 64 caracteres, sin reglas de composición, aceptando letras, dígitos, espacio y todos los símbolos imprimibles, y rechazo de contraseñas comunes mediante una lista local. Aplica a clientes, staff y contraseñas temporales (generadas por el sistema).
- Segundo factor (2FA): pospuesto, con el diseño de autenticación preparado para incorporarlo (ADR-0048).
- Cambio de contraseña desde la cuenta: revoca las demás sesiones, conserva la actual y envía aviso por correo (ADR-0072).
- Recuperación de contraseña (ADR-0056): enlace de un solo uso vigente 30 minutos, token guardado con hash, respuesta que no revela si el email existe, límite por email y por IP, revocación de todas las sesiones al restablecer y aviso por correo. El cambio obligatorio del staff pide la contraseña temporal.
- Los enlaces de verificación y recuperación usan la URL base del frontend configurada por variable de entorno (ADR-0056).
- Verificación de email (ADR-0046): enlace de un solo uso vigente 24 horas; reenvío limitado que invalida el anterior; nueva verificación al cambiar de email.
- La clave de firma de los JWT se gestiona como secreto (ADR-0032).
- El refresh token dura 7 días (configurable).
- Si se presenta un refresh token ya rotado, se revoca toda la sesión a la que pertenece y el usuario debe volver a iniciar sesión.

Ya definido:

- Un usuario suspendido no puede autenticarse (BR-USR-02).
- El hash de contraseña, los tokens y los intentos de login nunca salen del contexto Identity & Access.
- Se permite compra como invitado (ADR-0010): los endpoints de checkout y carrito deben funcionar sin usuario autenticado, y el invitado consulta su orden con email de contacto y el código público aleatorio de la orden (ADR-0020, ADR-0049); el número interno consecutivo nunca se expone a clientes. Ese endpoint requiere rate limiting y respuestas de error que no revelen si la orden existe. El enlace de acceso por correo, si se implementa, usa un token firmado con expiración.

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
- El registro de pagos y reembolsos manuales requiere `payments.manage`, queda auditado y solo está disponible si la variable de entorno que habilita el pago manual está activa (ADR-0040, ADR-0051).

## Subida de archivos

- Solo el personal con permiso de catálogo puede subir imágenes.
- Se valida el tipo real del archivo por su contenido, no por su extensión ni por el tipo declarado por el cliente.
- El nombre en disco lo genera el servidor; nunca se usa el nombre enviado por el cliente (evita sobrescrituras y rutas manipuladas).
- La carpeta de imágenes no permite ejecutar archivos.
- Formatos permitidos: JPEG, PNG y WebP. Tamaño máximo: 5 MB por imagen, configurable (ADR-0024). El límite se aplica al recibir la solicitud, antes de procesar el archivo completo.

## Gestión de secretos

ADR-0032:

- Configuración y secretos se leen de variables de entorno. En local, desde `.env`, que nunca se versiona.
- `.env.example` lista todas las variables del proyecto con descripción y valores de ejemplo no reales; al desplegar se usa como base.
- La API no arranca si falta una variable obligatoria.
- La detección de secretos de la CI (ADR-0030) es la segunda barrera.
- Almacén de secretos en el servidor: PENDIENTE DE DECISIÓN hasta elegir hosting (P-13).

## CORS / CSRF

CSRF: no aplica a la autenticación, porque las credenciales viajan en el encabezado `Authorization` y no en cookies (ADR-0023). Si en el futuro se usan cookies, revisar.

CORS: orígenes permitidos PENDIENTES DE DEFINICIÓN; dependen de clientes que aún no existen.

## Rate limiting

ADR-0065: `@nestjs/throttler` con contadores en memoria; límites configurables por variables de entorno.

| Endpoint | Límite |
|---|---|
| Login | 5 intentos fallidos por email en 15 minutos, y 20 por IP |
| Registro | 5 por IP por hora |
| Recuperación de contraseña | 3 por email y 10 por IP por hora |
| Reenvío de verificación | 3 por email por hora |
| Consulta de pedido de invitado | 10 por IP en 15 minutos |
| Colocar orden | 10 por usuario o carrito en 10 minutos |
| Resto de endpoints | 100 solicitudes por minuto por IP |

- Se frena por tiempo; nunca se bloquean cuentas por intentos fallidos.
- 429 con `Retry-After` al exceder un límite.
- Detrás de un proxy, la IP a considerar se configura al elegir hosting (P-06).

## Datos personales

ADR-0067 (Ley Federal de Protección de Datos Personales en Posesión de los Particulares de 2025; la validación legal completa corresponde a un especialista):

- Se guarda la versión del aviso de privacidad presentada en el registro y en el checkout de invitado.
- Derechos ARCO por canal externo; el staff ejecuta las acciones en el sistema.
- Anonimización definida para clientes y compradores invitados.
- Logs y auditoría sin valores de datos personales.
- Ciclo de conservación de datos personales en órdenes (operativa, bloqueo y anonimización) diseñado en ADR-0070, fuera del MVP; plazos y preguntas pendientes de validación legal con un especialista (P-61).

## Auditoría

- Historia de negocio en cada contexto (historial de estados de orden, movimientos de stock, periodos de precio).
- Auditoría técnica transversal y append-only (ADR-0037):
  - Se auditan todas las modificaciones del staff en `/v1/admin` y los eventos de seguridad (inicios de sesión exitosos y fallidos, cierres de sesión, cambios y recuperación de contraseña, reutilización de refresh token, suspensiones, cambios de roles y permisos, accesos denegados).
  - Los valores de campos sensibles (hashes, tokens, datos de pago) nunca se guardan.
  - Lectura exclusiva con el permiso `audit.read`; ningún endpoint modifica ni borra registros.
  - Retención: 3 meses en la base de datos; después, archivos comprimidos hasta 2 años (configurables), sujeto a validación legal (P-61).
  - Los archivos comprimidos se guardan en un directorio privado, nunca servido públicamente y separado del de imágenes, e incluido en los respaldos.

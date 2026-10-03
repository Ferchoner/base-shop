# PROJECT — Ecommerce API

## 1. Visión

Construir una API RESTful para una tienda en línea.

## 2. Objetivo

Proporcionar un backend seguro, mantenible, documentado y preparado para integrarse con aplicaciones web, móviles u otros clientes.

La API es un backend independiente: no asume ningún framework ni comportamiento específico del frontend (por ejemplo, no asume cookies para identificar carritos). El frontend todavía no existe.

## 3. Alcance inicial (MVP)

Incluido:

- Usuarios, autenticación y autorización (roles y permisos)
- Direcciones del cliente
- Productos, categorías, marcas, variantes e imágenes
- Listas de precios con precios históricos y programados
- Almacenes, inventario y reservas de inventario
- Carrito (incluido carrito de invitado)
- Checkout y pedidos (incluida compra como invitado, y el enlace de acceso a sus pedidos por correo, ADR-0148)
- Pagos
- Envíos
- Notificaciones (como reacción a eventos)
- Auditoría técnica
- Privacidad: aviso versionado, anonimización y conservación de datos personales con plazos configurables (ADR-0067, ADR-0149)
- Documentación (OpenAPI) y testing

Fuera del MVP (ver ADR-0018):

- Promociones y cupones. La orden guarda un campo de descuento desde el inicio.
- Devoluciones y reembolsos parciales como proceso de negocio. `Refund` queda modelado dentro de `Payment`.
- Envíos parciales.
- Métodos de pago asíncronos (efectivo en tiendas de conveniencia y transferencia a través de un proveedor, ADR-0013). El pago manual en tienda (ADR-0055) es solo para pruebas.
- Múltiples almacenes en operación (el modelo los soporta).
- Múltiples monedas.
- Recoger en tienda (ADR-0078).

"Administración" no es un módulo propio: cada contexto expone sus operaciones administrativas protegidas por permisos (ver ADR-0004).

El alcance funcional detallado se mantiene en `REQUIREMENTS.md`.

## 4. Stack tecnológico

| Área | Estado | Decisión | Referencia |
|---|---|---|---|
| Lenguaje | Definido | TypeScript 6.x sobre Node.js 24 (Active LTS); TypeScript 7 pospuesto hasta que lo admitan las herramientas | ADR-0002, ADR-0025, ADR-0107 |
| Gestor de paquetes | Definido | npm, con `package-lock.json` versionado | ADR-0025 |
| Framework | Definido | NestJS | ADR-0002 |
| Base de datos | Definido | PostgreSQL 18, una sola base de datos y un solo esquema | ADR-0002, ADR-0006, ADR-0025 |
| ORM | Definido | Prisma 7 con el driver adapter de `pg`; esquema dividido por contexto en `prisma/schema/`. `@prisma/client` solo en Infrastructure | ADR-0002, ADR-0003, ADR-0091 |
| Migraciones | Definido | Prisma Migrate. Restricciones `CHECK`, exclusión, índices de expresión y trigger añadidos como SQL en las migraciones | ADR-0006, ADR-0033, ADR-0091 |
| API | Definido | REST versionada con prefijo `/v1`, documentada con Swagger/OpenAPI | ADR-0002, ADR-0034 |
| Autenticación | Implementado | Login con email y contraseña; JWT HS256 de corta duración en `Authorization: Bearer`, verificado con Passport, con la cuenta y la sesión comprobadas en cada solicitud; refresh token opaco de 7 días (configurable), rotado, guardado con hash y con detección de reutilización; Argon2id de `node:crypto`; política de contraseñas con lista local de contraseñas comunes | ADR-0022, ADR-0023, ADR-0047, ADR-0114, ADR-0115 |
| Autorización | Definido | RBAC: roles editables, permisos definidos en código con granularidad contexto.acción | ADR-0017 |
| Pagos | Definido | Método manual solo para pruebas (el administrador registra el pago). PayPal semiimplementado sin probar. Mercado Pago y Stripe pospuestos. Captura inmediata; sin métodos asíncronos | ADR-0013, ADR-0040 |
| Storage (imágenes) | Definido | Disco del servidor por ahora; CDN a futuro. Se guarda la clave de almacenamiento y la URL se construye al responder. Formatos JPEG, PNG y WebP, reconocidos por su contenido; máximo 5 MB por imagen, configurable. La API las sirve en `/media` mientras no haya hosting | ADR-0016, ADR-0024, ADR-0121 |
| Cache | Definido | `@nestjs/cache-manager` en memoria del proceso; solo lecturas públicas del catálogo; TTL de 120 s (configurable); invalidación por eventos de Catalog | ADR-0028 |
| Colas / jobs | Definido parcialmente | Sin colas de mensajes; eventos en proceso, guardados con el cambio en un outbox y reintentados. Jobs con `@nestjs/schedule` en el proceso de la API: expiración de órdenes y reintento de eventos cada minuto, limpieza diaria, archivo de la auditoría y ciclo de conservación de datos personales a las 3:00; la conciliación de pagos, cada 5 minutos, llega con PayPal (T-192) | ADR-0029, ADR-0150, ADR-0151 |
| Testing | Definido | Jest: unitarios (`npm test`), integración contra PostgreSQL 18 real con Testcontainers (`npm run test:int`) y end-to-end (`npm run test:e2e`, también con Testcontainers); sin mocks de base de datos | ADR-0002, ADR-0033, ADR-0090, ADR-0091 |
| Docker | Definido | `docker compose` para desarrollo local (PostgreSQL 18, Mailpit y la API en modo desarrollo); `Dockerfile` con las imágenes `development`, `production` (sin el CLI de Prisma) y `migrate` (aplica las migraciones), que la CI arranca contra un PostgreSQL 18 | ADR-0002, ADR-0089, ADR-0147 |
| Lint y formato | Definido | oxlint para lint; Prettier para formato de código y configuración | ADR-0073, ADR-0084 |
| Validación | Definido | class-validator y class-transformer para DTOs y configuración; `@nestjs/config` para las variables de entorno | ADR-0087 |
| CI | Definido | GitHub Actions; pipeline en cada pull request y en la rama principal (10 pasos en un job, secretos con gitleaks, también antes de cada commit, y mensajes de commit revisados); rama principal protegida; GitHub Flow; Dependabot semanal | ADR-0030, ADR-0105, ADR-0106, ADR-0119 |
| CD | Pospuesto | Sin hosting no hay a dónde desplegar (P-05) | ADR-0031 |
| Hosting | Definido (temporal) | Solo entorno local con Docker Compose. Candidatos futuros: Oracle Cloud Always Free o VPS de bajo costo (P-06) | ADR-0031 |
| Observabilidad | Definido parcialmente | Logs en consola con nivel configurable por variable de entorno; los fallos de handlers van al log y a sus entregas, que el staff consulta (`events.manage`). Herramientas se deciden con el hosting (P-07) | ADR-0032, ADR-0150 |
| Gestión de secretos | Definido (local) | Variables de entorno; `.env` fuera de Git; `.env.example` con todas las variables como base para desplegar. Almacén de secretos en servidor se decide con el hosting (P-13) | ADR-0032 |

## 5. Usuarios del sistema

- Cliente registrado.
- Cliente invitado (compra sin cuenta, identificado por email de contacto).
- Personal de la tienda (staff) con roles y permisos.

Roles del personal: Superadministrador, Administrador y Operador (ADR-0043).

## 6. País, moneda e impuestos

- País de operación: México (ADR-0026).
- Moneda: peso mexicano (MXN), única moneda por ahora (ADR-0007, ADR-0026).
- Impuestos: tratamiento configurable por lista de precios, con impuesto incluido por defecto y redondeo por línea (ADR-0008). Impuesto aplicable: IVA del 16% para todos los productos, configurable. Sin emisión de facturas electrónicas por ahora (ADR-0027).

## 7. Envíos

- Una orden genera un solo envío (sin envíos parciales en el MVP).
- Se surte desde un solo almacén.
- Envíos manuales: sin integración con paqueterías; el administrador captura paquetería y guía, o marca el envío como entrega propia de la tienda, y actualiza el estado (ADR-0041, ADR-0078).
- Costo de envío: fijo por orden, con IVA incluido, gratis cuando el subtotal con IVA alcanza un monto mínimo; ambos configurables, con valores iniciales provisionales de $99.00 y $1,500.00 (ADR-0042, ADR-0079, ADR-0092).
- Plazo de entrega: estimado, en días hábiles desde la confirmación del pago; configurable, con valor inicial de 3 a 7 días (ADR-0083).

## 8. Estado

Fase: Inicialización. Sprint 0 (Discovery and Architecture) cerrado el 2026-09-26: especificación técnica, arquitectura, modelo de datos y contratos de la API aprobados. Sprint 1 (fundaciones técnicas) cerrado el 2026-09-28: configuración, estructura de módulos, Docker, base de datos, mecanismos transversales y CI. Sprint 2 (Identity & Access) cerrado el 2026-09-29: registro, verificación de email, sesiones, recuperación de contraseña, staff, roles, permisos y direcciones. Sprint 3 (catálogo vendible) cerrado el 2026-10-01: categorías, marcas, productos con variantes e imágenes, precios, stock con reservas, costo de envío y tienda pública. Sprint 4 (compra con pago en tienda) cerrado el 2026-10-02: carrito, checkout, órdenes, pago en tienda, reembolsos, vencimiento y recompra. Sprint 5 (entrega del pedido) cerrado el 2026-10-02: envíos, reintegro de stock, correos al cliente y limpieza diaria. Sprint 6 (privacidad y operación) cerrado el 2026-10-03: anonimización, consulta y archivo de la auditoría, imagen de producción reducida y enlace de acceso a los pedidos de invitado. Sprint 7 (entrega garantizada de eventos) cerrado el 2026-10-03: outbox transaccional con reintentos y consulta del staff, y plazos de conservación configurables. En curso: Sprint 8 (ciclo de conservación de datos personales), desde el 2026-10-03. Ver `SPRINT.md` y `PROGRESS.md`.

## 9. Antes de operar con clientes reales

base-shop no tiene una entidad vendedora definida: cada operador resuelve esta lista antes de atender clientes reales, y la revisa cuando cambia la ley.

- **Datos personales (ADR-0149), con un especialista legal:**
  - los plazos de conservación: fase operativa y de bloqueo, cuentas inactivas, auditoría, eventos de webhooks, refresh tokens y carritos de invitado. Todos son variables de `.env.example`, con valores por defecto que no son asesoría legal;
  - las preguntas de ADR-0070, entre ellas qué datos exigen conservar las obligaciones fiscales y mercantiles, y el plazo de prescripción que aplica;
  - el texto del aviso de privacidad, con su versión y los plazos vigentes, que publica `GET /v1/privacy/retention-policy` (ADR-0067, ADR-0152);
  - la presentación del plazo de entrega estimado (ADR-0083);
  - una nueva revisión cuando se publique el reglamento de la ley de 2025.
- **Impuestos y envíos, con el contador y el administrador (P-69):** el IVA del costo de envío, el modo de redondeo del IVA y los valores del método de envío con costos reales (ADR-0079, ADR-0092, ADR-0094).
- **Infraestructura:** hosting, despliegue, secretos en el servidor y proveedor real de correos (P-05, P-06, P-13, P-24).
- **Pagos:** el pago manual en tienda es solo para pruebas (ADR-0055); PayPal debe verificarse en su sandbox antes de habilitarse (T-191).
- **Recomendado:** segundo factor de autenticación para el staff (ADR-0048).

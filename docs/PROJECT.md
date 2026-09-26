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
- Checkout y pedidos (incluida compra como invitado)
- Pagos
- Envíos
- Notificaciones (como reacción a eventos)
- Auditoría técnica
- Documentación (OpenAPI) y testing

Fuera del MVP (ver ADR-0018):

- Promociones y cupones. La orden guarda un campo de descuento desde el inicio.
- Devoluciones y reembolsos parciales como proceso de negocio. `Refund` queda modelado dentro de `Payment`.
- Envíos parciales.
- Métodos de pago asíncronos (efectivo en tienda, transferencia).
- Múltiples almacenes en operación (el modelo los soporta).
- Múltiples monedas.

"Administración" no es un módulo propio: cada contexto expone sus operaciones administrativas protegidas por permisos (ver ADR-0004).

El alcance funcional detallado se mantiene en `REQUIREMENTS.md`.

## 4. Stack tecnológico

| Área | Estado | Decisión | Referencia |
|---|---|---|---|
| Lenguaje | Definido | TypeScript sobre Node.js 24 (Active LTS) | ADR-0002, ADR-0025 |
| Gestor de paquetes | Definido | npm, con `package-lock.json` versionado | ADR-0025 |
| Framework | Definido | NestJS | ADR-0002 |
| Base de datos | Definido | PostgreSQL 18, una sola base de datos y un solo esquema | ADR-0002, ADR-0006, ADR-0025 |
| ORM | Definido | Prisma. `@prisma/client` solo en Infrastructure | ADR-0002, ADR-0003 |
| Migraciones | Definido | Prisma Migrate. Restricciones `CHECK` añadidas como SQL en las migraciones | ADR-0006, ADR-0033 |
| API | Definido | REST versionada con prefijo `/v1`, documentada con Swagger/OpenAPI | ADR-0002, ADR-0034 |
| Autenticación | Definido | Passport vía `@nestjs/passport`: estrategia local para login y JWT de corta duración en `Authorization: Bearer`; refresh token opaco de 7 días (configurable), rotado, guardado con hash y con detección de reutilización; Argon2id | ADR-0022, ADR-0023 |
| Autorización | Definido | RBAC: roles editables, permisos definidos en código con granularidad contexto.acción | ADR-0017 |
| Pagos | Definido | Método manual solo para pruebas (el administrador registra el pago). PayPal semiimplementado sin probar. Mercado Pago y Stripe pospuestos. Captura inmediata; sin métodos asíncronos | ADR-0013, ADR-0040 |
| Storage (imágenes) | Definido | Disco del servidor por ahora; CDN a futuro. Se guarda la clave de almacenamiento y la URL se construye al responder. Formatos JPEG, PNG y WebP; máximo 5 MB por imagen, configurable | ADR-0016, ADR-0024 |
| Cache | Definido | `@nestjs/cache-manager` en memoria del proceso; solo lecturas públicas del catálogo; TTL de 120 s (configurable); invalidación por eventos de Catalog | ADR-0028 |
| Colas / jobs | Definido parcialmente | Sin colas de mensajes; eventos en proceso sin outbox. Jobs con `@nestjs/schedule` en el proceso de la API: expiración cada minuto, conciliación de pagos cada 5 minutos, limpieza diaria a las 3:00 | ADR-0014, ADR-0029 |
| Testing | Definido | Jest. Tests de integración contra PostgreSQL 18 real en Docker, sin mocks de base de datos | ADR-0002, ADR-0033 |
| Docker | Definido parcialmente | Docker forma parte del stack. Uso concreto (desarrollo, imagen de producción) pendiente de definir | ADR-0002 |
| Lint | Definido | oxlint. Formato pendiente de confirmar en T-104 | ADR-0073 |
| CI | Definido | GitHub Actions; pipeline en cada pull request; rama principal protegida; GitHub Flow; Dependabot semanal | ADR-0030 |
| CD | Pospuesto | Sin hosting no hay a dónde desplegar (P-05) | ADR-0031 |
| Hosting | Definido (temporal) | Solo entorno local con Docker Compose. Candidatos futuros: Oracle Cloud Always Free o VPS de bajo costo (P-06) | ADR-0031 |
| Observabilidad | Definido parcialmente | Logs en consola con nivel configurable por variable de entorno; registro de fallos de handlers. Herramientas se deciden con el hosting (P-07) | ADR-0014, ADR-0032 |
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
- Envíos manuales: sin integración con paqueterías; el administrador captura paquetería y guía y actualiza el estado (ADR-0041).
- Costo de envío: fijo por orden, gratis a partir de un monto mínimo; ambos configurables (ADR-0042).

## 8. Estado

Fase: Inicialización / Sprint 0 (Discovery and Architecture). Diseño de dominio y decisiones de arquitectura aprobados formalmente. Ver `PROGRESS.md`.

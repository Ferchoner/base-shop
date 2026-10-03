# base-shop

API REST de comercio electrónico: catálogo, precios, inventario, carrito, checkout, pagos y envíos. Monolito modular con NestJS, PostgreSQL y Prisma.

## Estado

Sprint 2 (Identity & Access) cerrado: registro de clientes, verificación de email, sesiones, recuperación de contraseña, alta del staff, roles, permisos y direcciones, sobre las fundaciones técnicas del Sprint 1. Sprint 3 (catálogo vendible) cerrado: tienda pública con búsqueda y filtros, precios, stock con reservas y costo de envío. Sprint 4 (compra con pago en tienda) cerrado: carrito, checkout, órdenes, pago y reembolso en tienda, vencimiento de órdenes y recompra. Sprint 5 (entrega del pedido) cerrado: envíos, reintegro de stock, correos al cliente y limpieza diaria. Sprint 6 (privacidad y operación) cerrado: anonimización, consulta y archivo de la auditoría, imagen de producción reducida y enlace de acceso a los pedidos de invitado. Sprint 7 (entrega garantizada de eventos) cerrado: outbox transaccional con reintentos y consulta del staff, y plazos de conservación configurables. En curso: Sprint 8 (ciclo de conservación de datos personales). Ver `docs/SPRINT.md`, `docs/PROGRESS.md` y `docs/TASKS.md`.

## Requisitos

- Node.js 24 (versión fijada en `.nvmrc` y en `engines` de `package.json`).
- npm (el proyecto versiona `package-lock.json`; no se usan otros gestores).
- Docker Desktop (o Docker Engine con Compose) para PostgreSQL 18 y el capturador de correos.

## Uso

```bash
cp .env.example .env
docker compose up --build
```

Levanta PostgreSQL 18, Mailpit (bandeja en `http://localhost:8025`) y la API en `http://localhost:3000`, con sus rutas bajo `/v1` y Swagger UI en `http://localhost:3000/docs/v1`. La primera vez, y cada vez que lleguen migraciones nuevas, hay que aplicarlas a la base local:

```bash
docker compose exec api npm run db:migrate:deploy
```

La primera vez también hay que cargar el catálogo geográfico: `docker compose exec api node dist/scripts/import-geo-catalog.js data/inegi/municipios-2026-06.csv`. Y crear el primer superadministrador, que muestra su contraseña temporal una sola vez: `docker compose exec -e SUPERADMIN_EMAIL=… -e SUPERADMIN_FIRST_NAMES=… -e SUPERADMIN_LAST_NAMES=… api node dist/scripts/create-first-superadmin.js`.

Para correr la API fuera de Docker: `docker compose up -d postgres mailpit`, `npm ci`, `npm run db:migrate:deploy`, `npm run geo:import -- data/inegi/municipios-2026-06.csv` y `npm run start:dev`. Detalles en `docs/DEVELOPMENT_GUIDE.md`.

| Script | Uso |
|---|---|
| `npm run lint` | Lint con oxlint y verificación de límites entre módulos y capas |
| `npm run lint:boundaries` | Solo la verificación de límites (`dependency-cruiser`) |
| `npm run format` | Formato con Prettier |
| `npm test` | Tests unitarios (Jest en modo ESM) |
| `npm run test:int` | Tests de integración contra PostgreSQL 18 real (requiere Docker en marcha) |
| `npm run test:e2e` | Tests end-to-end (requiere Docker en marcha) |
| `npm run test:cov` | Cobertura |
| `npm run db:migrate:deploy` | Aplica las migraciones pendientes a la base de `DATABASE_URL` |
| `npm run db:migrate:dev` | Crea una migración nueva (solo desarrollo) |
| `npm run db:diff` | Verifica que la base coincide con el esquema de Prisma |
| `npm run db:generate` | Genera el cliente de Prisma |
| `npm run geo:import -- <archivo>` | Carga o actualiza el catálogo de estados y municipios del INEGI (`data/inegi/`) |
| `npm run superadmin:create` | Crea el primer superadministrador con las variables `SUPERADMIN_*` y muestra su contraseña temporal |
| `npm run passwords:build -- <archivo>` | Regenera la lista de contraseñas comunes (`data/passwords/`) |

## Documentación

La fuente de verdad del proyecto está en `docs/`:

| Documento | Contenido |
|---|---|
| `PROJECT.md` | Visión, alcance del MVP y stack |
| `REQUIREMENTS.md` | Casos de uso, estados, permisos y errores |
| `BUSINESS_RULES.md` | Reglas de negocio |
| `DOMAIN_MODEL.md` | Contextos, aggregates y eventos |
| `ARCHITECTURE.md` | Arquitectura y convenciones técnicas |
| `DATABASE.md` | Modelo de datos |
| `API_SPEC.md` | Contratos de la API |
| `SECURITY.md` | Seguridad |
| `DECISIONS.md` | Registro de decisiones (ADR) |
| `TASKS.md`, `PROGRESS.md` | Plan de trabajo y estado |
| `SPRINT.md` | Sprint actual y reviews de los anteriores |
| `CHANGELOG.md` | Cambios registrados |
| `DEVELOPMENT_GUIDE.md` | Flujo de trabajo y convenciones |

## Flujo de trabajo

GitHub Flow: una rama corta por tarea y pull request hacia `main` (ADR-0030). Cada pull request pasa por la CI de GitHub Actions (`.github/workflows/ci.yml`, ADR-0105); cómo repetirla en local está en `docs/DEVELOPMENT_GUIDE.md`. Las instrucciones para trabajar con Claude Code están en `CLAUDE.md`.

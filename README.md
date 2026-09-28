# base-shop

API REST de comercio electrónico: catálogo, precios, inventario, carrito, checkout, pagos y envíos. Monolito modular con NestJS, PostgreSQL y Prisma.

## Estado

Sprint 1 (fundaciones técnicas) en curso. La especificación, el modelo de datos y los contratos de la API están aprobados; aún no hay endpoints de negocio. Ver `docs/SPRINT.md`, `docs/PROGRESS.md` y `docs/TASKS.md`.

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

Para correr la API fuera de Docker: `docker compose up -d postgres mailpit`, `npm ci`, `npm run db:migrate:deploy` y `npm run start:dev`. Detalles en `docs/DEVELOPMENT_GUIDE.md`.

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
| `DEVELOPMENT_GUIDE.md` | Flujo de trabajo y convenciones |

## Flujo de trabajo

GitHub Flow: una rama corta por tarea y pull request hacia `main` (ADR-0030). Las instrucciones para trabajar con Claude Code están en `CLAUDE.md`.

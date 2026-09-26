# base-shop

API REST de comercio electrónico: catálogo, precios, inventario, carrito, checkout, pagos y envíos. Monolito modular con NestJS, PostgreSQL y Prisma.

## Estado

Sprint 0 (análisis y arquitectura) completado: especificación, modelo de datos y contratos de la API aprobados. Aún no hay endpoints de negocio; el siguiente paso son las fundaciones técnicas (T-100 en adelante). Ver `docs/PROGRESS.md` y `docs/TASKS.md`.

## Requisitos

- Node.js 24 (versión fijada en `.nvmrc` y en `engines` de `package.json`).
- npm (el proyecto versiona `package-lock.json`; no se usan otros gestores).
- PostgreSQL 18 y Docker: se incorporan en T-102 y T-110.

## Uso

```bash
npm ci
npm run build
npm run start:dev
```

| Script | Uso |
|---|---|
| `npm run lint` | Lint con oxlint |
| `npm run format` | Formato con Prettier |
| `npm test` | Tests unitarios (Jest en modo ESM) |
| `npm run test:e2e` | Tests end-to-end |
| `npm run test:cov` | Cobertura |

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

# base-shop

API REST de comercio electrónico: catálogo, precios, inventario, carrito, checkout, pagos y envíos. Monolito modular con NestJS, PostgreSQL y Prisma.

## Estado

Versión 1.0.0: el MVP, cerrado el 2026-10-04 (ADR-0158) después de 10 sprints. Incluye identidad y acceso, catálogo con tienda pública, precios, inventario con reservas, carrito, checkout y órdenes, pago manual en tienda (solo para pruebas), envíos, correos al cliente, auditoría, privacidad con conservación y anonimización de datos personales, entrega garantizada de eventos, y una revisión de seguridad, documentación y pruebas. Corre solo en el entorno local. El desarrollo sigue por versiones (ADR-0159).

Fuera del MVP, hasta que una entidad quiera usar el proyecto: los proveedores de pago en línea, el despliegue, las promociones y las decisiones que dependen del hosting o del negocio. Para retomarlo, ver "Antes de operar con clientes reales" en `docs/PROJECT.md` y ADR-0158. El historial de los sprints está en `docs/SPRINT.md`.

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
| `npm run test:cov` | Las tres suites con cobertura, unida y comparada con sus umbrales (requiere Docker en marcha) |
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
| `openapi/v1.json` | Documento OpenAPI de `v1`, generado y comprobado en la CI |
| `SECURITY.md` | Seguridad |
| `DECISIONS.md` | Registro de decisiones (ADR) |
| `TASKS.md`, `PROGRESS.md` | Plan de trabajo y estado |
| `SPRINT.md` | Sprint actual y reviews de los anteriores |
| `SECURITY_AUDIT.md` | Auditoría de seguridad: método, matriz de rutas y hallazgos |
| `CHANGELOG.md` | Cambios registrados |
| `DEVELOPMENT_GUIDE.md` | Flujo de trabajo y convenciones |

## Flujo de trabajo

GitHub Flow: una rama corta por tarea y pull request hacia `main` (ADR-0030). Cada pull request pasa por la CI de GitHub Actions (`.github/workflows/ci.yml`, ADR-0105); cómo repetirla en local está en `docs/DEVELOPMENT_GUIDE.md`. Las instrucciones para trabajar con Claude Code están en `CLAUDE.md`.

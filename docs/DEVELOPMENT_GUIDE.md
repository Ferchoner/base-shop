# DEVELOPMENT GUIDE

## Flujo

1. Leer `CLAUDE.md`.
2. Revisar documentación relacionada.
3. Crear/confirmar plan.
4. Implementar una tarea acotada.
5. Crear/actualizar tests.
6. Ejecutar verificaciones.
7. Actualizar documentación.
8. Actualizar `TASKS.md` y `PROGRESS.md`.
9. Crear checkpoint Git.

## Convenciones

Definidas por el stack (ADR-0002, ADR-0003):

- TypeScript en modo estricto.
- Un módulo de NestJS por bounded context, con capas `domain`, `application`, `infrastructure` y `presentation` (ver `ARCHITECTURE.md`).
- Domain no importa NestJS ni Prisma. `@prisma/client` solo en Infrastructure.
- Interfaces de repositories en Domain; implementaciones en Infrastructure.
- DTOs HTTP solo en Presentation.
- Nombres de código en inglés; documentación en español.
- Montos como enteros en centavos con `Money`.
- Sin abstracciones genéricas (`BaseRepository<T>`, `BaseEntity` con lógica).
- Ningún módulo importa internos de otro; solo su fachada pública.

Tests (Jest):

- Unitarios para Domain, sin base de datos.
- Integración para repositories y flujos transaccionales contra PostgreSQL 18 real en Docker, sin mocks de base de datos (ADR-0033).
- Pruebas de concurrencia obligatorias para reservas de inventario y checkout.

Entorno (ADR-0025):

- Node.js 24 y PostgreSQL 18, siempre en su última actualización menor.
- npm como gestor de paquetes; `package-lock.json` se versiona y las instalaciones en CI usan `npm ci`.
- La versión de Node.js se declara en el campo `engines` de `package.json` y en un archivo de versión para el entorno local.

Ramas e integración continua (ADR-0030):

- Repositorio en GitHub con CI en GitHub Actions.
- GitHub Flow: la rama principal siempre está en estado desplegable; cada tarea se trabaja en una rama corta y se integra mediante pull request.
- La rama principal está protegida: no se fusiona un pull request si el pipeline no está en verde.
- El pipeline verifica, en orden: instalación, lint y formato, límites entre módulos, compilación, tests unitarios, tests de integración con PostgreSQL 18, migraciones, auditoría de dependencias (falla con vulnerabilidades altas y críticas), detección de secretos y construcción de la imagen de Docker.
- Dependabot abre actualizaciones de dependencias agrupadas cada semana.

PENDIENTE DE DEFINICIÓN: herramientas de lint y formato, convención de nombres de ramas y de mensajes de commit.

## Configuración local

- Copiar `.env.example` a `.env` y completar los valores. `.env` nunca se versiona.
- Toda variable nueva se agrega a `.env.example` en el mismo cambio, con descripción y valor de ejemplo no real.
- El proyecto corre solo en local por ahora (ADR-0031).
- Los correos que envía la API llegan a un capturador local en Docker Compose y se revisan en su bandeja web; no salen a internet (ADR-0045).
- Webhooks de pago: requieren un túnel hacia el entorno local; estrategia de prueba pendiente (P-31).

## Migraciones

- Prisma Migrate (ADR-0033).
- Toda migración se revisa antes de aplicarse; las destructivas requieren aprobación humana.
- Las restricciones `CHECK` se agregan como SQL en la migración correspondiente.

## Pull Requests

Cada PR debe explicar:

- objetivo;
- cambios;
- tests;
- migraciones;
- riesgos;
- documentación actualizada.

## Definition of Done

Una tarea está DONE cuando:

- código implementado;
- tests apropiados;
- verificaciones ejecutadas;
- documentación actualizada;
- criterios de aceptación cumplidos;
- toda variable de entorno nueva agregada a `.env.example` con descripción (ADR-0032);
- sin problemas críticos conocidos.

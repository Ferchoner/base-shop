# SPRINT

## Sprint

0 — Discovery and Architecture

## Goal

Definir requisitos, decisiones tecnológicas, arquitectura, modelo de datos y contratos API antes de implementar funcionalidades.

## Tasks

Ver `docs/TASKS.md`, sección "Inicialización (Sprint 0)": T-001 a T-006, todas en DONE.

Las fundaciones técnicas (T-100 a T-118) ya pueden iniciar (T-003 aprobada y P-20 decidida), siempre que no incluyan lógica de negocio. Las bloqueadas por otras decisiones se indican en `TASKS.md`.

## Risks

- El adaptador de PayPal se escribe sin poder probarse (ADR-0040): requiere verificación completa antes de habilitarse.
- Eventos sin outbox (ADR-0014): riesgo aceptado, depende de la conciliación y de handlers idempotentes.
- Limitaciones de Prisma (sin seguimiento de cambios, sin `SELECT … FOR UPDATE` ni `CHECK` en el esquema) que aumentan el trabajo de los repositorios.
- La carpeta `prompts/` no se ha revisado y podría referenciar el alcance anterior (Promotions, Admin). Se trabaja sin ella por ahora.

## Sprint Review

PENDIENTE.

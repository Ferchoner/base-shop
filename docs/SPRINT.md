# SPRINT

## Sprint actual

1 — Fundaciones técnicas. Inicio: 2026-09-26 (propuesta aprobada por el equipo en el Sprint Review del Sprint 0).

## Goal

Fundaciones técnicas sin lógica de negocio: proyecto configurado y validado al arrancar, estructura de módulos, entorno local con Docker, base de datos con la primera migración, y los mecanismos transversales (errores, versionado, rate limiting, idempotencia, auditoría, eventos, jobs, observabilidad y cache), con CI en verde.

## Tasks

Detalle y criterios de aceptación en `docs/TASKS.md`, sección "Fundaciones técnicas". Orden por dependencias:

| Paso | Tareas |
|---|---|
| 1 | T-100 (configuración, CORS y encabezados de seguridad), T-104 (casi terminada) y T-101 |
| 2 | T-102 (Docker), T-105 (tests), T-110 (base de datos y primera migración), T-111 y T-112 |
| 3 | T-113, T-114, T-115, T-116, T-117, T-118, T-126 y T-127 |
| 4 | T-119 y T-103 (verificación de límites) |
| 5 | T-106 (CI) y T-107 (configuración de GitHub; requiere administrador del repositorio) |

- **Criterio de cierre:** criterios de aceptación de cada tarea en `TASKS.md` y pipeline de CI en verde.
- **Nota:** la primera migración (T-110) incluye los cambios al modelo de ADR-0076, ADR-0078, ADR-0079, ADR-0081 y ADR-0083.
- Cada tarea se trabaja en su propia rama (`tipo/T-xxx-descripcion`) y se integra con un pull request (ADR-0030, ADR-0084).

## Risks

- Limitaciones de Prisma (sin seguimiento de cambios, sin `SELECT … FOR UPDATE` ni `CHECK` en el esquema) que aumentan el trabajo de los repositorios (T-110, T-111).
- Resuelto en T-110: los objetos creados con SQL manual en las migraciones (`CHECK`, exclusión, índices de expresión, trigger) no aparecen como diferencias en la verificación de migraciones (`DATABASE.md`, sección 13; ADR-0091).
- La función `partialIndexes` de Prisma, usada para los índices únicos parciales, está en vista previa y puede cambiar al actualizar Prisma (ADR-0091).
- Eventos sin outbox (ADR-0014): riesgo aceptado, depende de la conciliación y de handlers idempotentes (T-116).
- Jest corre en modo ESM con `--experimental-vm-modules`, una función experimental de Node.js (T-105).
- Resuelto en T-107: la configuración de GitHub se aplicó con la cuenta administradora del repositorio (ADR-0106).
- Riesgos del proyecto fuera de este sprint: adaptador de PayPal sin verificar (ADR-0040) y validaciones externas pendientes antes de operar con clientes reales (P-61, P-69).

## Sprint Review

PENDIENTE.

---

## Historial

### Sprint 0 — Discovery and Architecture (2026-09-24 a 2026-09-26)

**Goal:** definir requisitos, decisiones tecnológicas, arquitectura, modelo de datos y contratos API antes de implementar funcionalidades. **Tareas:** T-001 a T-006, todas en DONE.

**Fecha:** 2026-09-26. **Resultado:** objetivo cumplido.

#### Entregables

| Entregable | Estado | Referencia |
|---|---|---|
| Stack definido para el entorno local | DONE | T-001 |
| Especificación técnica: 91 casos de uso, 34 errores, permisos, estados y requisitos no funcionales | Aprobada | T-002, `REQUIREMENTS.md` |
| Arquitectura, mapa de contextos e integración entre contextos | Aprobada | T-003, ADR-0004, ADR-0005, ADR-0019 |
| Modelo de datos: 38 tablas, restricciones, índices, concurrencia y diagrama ER | Aprobado | T-004, ADR-0066, `DATABASE.md` |
| Contratos de la API: unas 120 operaciones, errores RFC 9457, idempotencia y rate limiting | Aprobados | T-005, ADR-0071, `API_SPEC.md` |
| Contradicciones y ambigüedades de la especificación resueltas | DONE | T-006 |
| 139 reglas de negocio con su fuente | — | `BUSINESS_RULES.md` |
| 86 ADR: 85 aceptados y 1 reemplazado parcialmente (ADR-0001) | — | `DECISIONS.md` |
| 62 de 71 decisiones pendientes (P-xx) cerradas | — | `PROGRESS.md` |
| Repositorio base alineado con las decisiones: NestJS con Node.js 24 y npm, Jest, oxlint, Prettier, fin de línea LF, sin vulnerabilidades en `npm audit` y documentación versionada | DONE | ADR-0025, ADR-0073, ADR-0084 |

El trabajo se integró en 7 pull requests a `main`.

#### Decisiones abiertas que pasan al siguiente sprint

Ninguna bloquea las fundaciones técnicas.

| Grupo | Decisiones |
|---|---|
| Dependen del hosting | P-05 (CD), P-06 (hosting, HSTS y TLS), P-07 (métricas y trazas), P-13 (secretos en servidor), P-24 (proveedor de correo) |
| Dependen de la cuenta de PayPal | P-31 (pruebas de webhooks; bloquea T-191) |
| Validaciones externas | P-61 (legal; difiere T-232), P-69 (fiscal) |
| Negocio y operación | P-14 (objetivos no funcionales cuantitativos) |

#### Qué funcionó

- Cada decisión quedó como ADR, con estado Propuesta cuando requería aprobación, y cada documento afectado se actualizó en el mismo cambio. La trazabilidad P-xx → ADR → documentos permite saber de dónde sale cada regla.
- La revisión integral previa a la implementación encontró 26 puntos: una vulnerabilidad alta en una dependencia de producción, dependencias entre tareas en orden incorrecto y contradicciones entre documentos. Todos se corrigieron o se convirtieron en decisiones.
- Una comprobación automática de identificadores (ADR, P-xx, BR, UC, E-xx y tareas) detecta referencias rotas después de cada cambio.

#### Qué mejorar

- El modelo de datos y los contratos se aprobaron antes de cerrar todas las ambigüedades, y varias decisiones posteriores los modificaron (ADR-0076, ADR-0078, ADR-0079, ADR-0081 y ADR-0083). Para próximos diseños: resolver las ambigüedades antes de aprobar modelo y contratos.
- Al inicio, la documentación no estaba versionada y el código no coincidía con las decisiones (Vitest, Yarn, módulos de ejemplo). Conviene revisar el repositorio contra los ADR al empezar cada sprint.
- Las ramas apiladas dependían del orden de fusión. Conviene fusionar cada rama antes de empezar la siguiente cuando sea posible.
- El equipo local no tenía la CLI de GitHub, así que los pull requests se crearon a mano (resuelto el 2026-09-26: `gh` instalado).

#### Siguiente sprint

La propuesta del Sprint 1 se aprobó el 2026-09-26; ver "Sprint actual".

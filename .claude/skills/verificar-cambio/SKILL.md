---
name: verificar-cambio
description: Revisa y verifica un diff local o de una rama sin modificarlo.
disable-model-invocation: true
---

Alcance o criterio de aceptación: $ARGUMENTS

1. Determina el alcance del diff. Para cambios locales incluye el índice, el árbol de trabajo y los archivos nuevos pertinentes. Para una rama, usa la base indicada o la base verificable del PR y registra cuál usaste.
2. Identifica los flujos y contratos afectados. Elige comprobaciones existentes en CI, scripts o README y ejecuta las aplicables desde su directorio.
3. Delega la revisión del diff a `revisor-de-cambios` con la base, el alcance, los archivos nuevos pertinentes, los criterios y las referencias de documentación. Si la delegación no está disponible, revisa directamente e indícalo.
4. Reporta hallazgos con archivo y línea, impacto y corrección propuesta. Registra cada comando ejecutado y su resultado, además de las comprobaciones pendientes y su motivo.

## Verificación en base-shop

Usa npm run lint:code, npm run lint:boundaries, npm run format:check, npx tsc --noEmit y npm test, según el alcance y los requisitos de CLAUDE.md. Consulta .github/workflows/ci.yml para dependencias, entorno y comprobaciones adicionales. Si el diff afecta el contrato, aplica también revisar-contrato-api/SKILL.md desde la carpeta de skills. Registra los cambios esperados si generas tipos o documentación.

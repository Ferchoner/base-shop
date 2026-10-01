# AI WORKFLOW

## Regla

La IA trabaja por tareas acotadas, no por instrucciones ambiguas de "construir todo".

## Ciclo

ANALIZAR
→ PLANIFICAR
→ IMPLEMENTAR
→ PROBAR
→ REVISAR
→ DOCUMENTAR
→ CHECKPOINT GIT

## Sesiones

Cada nueva sesión debe comenzar leyendo `CLAUDE.md` y el estado relevante del proyecto.

## Cambios

Si una tarea revela una nueva decisión importante:

1. detener la implementación relacionada si es necesario;
2. explicar la decisión;
3. registrar ADR;
4. obtener aprobación humana;
5. continuar.

## Edición y commits

- Los cambios de varias líneas se hacen con edición directa o con scripts guardados en archivo. Un heredoc de shell sin comillas cambia secuencias como `\n` y `\d`; si hace falta uno, va entre comillas (`<<'EOF'`).
- Antes de cada commit se comprueba el código de salida de `npm run secrets:scan`, que necesita Docker en marcha. No se pone detrás de una tubería que esconda su error.

## Contexto

No sobrecargar una sesión con documentación irrelevante. Leer primero archivos directamente relacionados con la tarea.

# Revisión de experiencia de uso

El problema principal era la carga de decisiones: reproductor, dictado, grabación, tutor y diccionario aparecían simultáneamente, sin un recorrido claro. La interfaz describía detalles internos con más claridad que lo que debía hacer la persona.

## Cambios aplicados

- **Biblioteca:** búsqueda por título o canal en todas las páginas de la API, filtros por estado, orden por título o duración, progreso y acceso para retomar el último video pendiente. Los videos completos ofrecen repaso.
- **Primer uso:** guía breve y comienzo por escuchar cuando el video todavía no tiene práctica. En móviles con videos importados, la guía de la portada se oculta para acercar la biblioteca.
- **Práctica:** actividades reales de escuchar, escribir y hablar. Dos columnas en escritorio, una en móvil. Lista de frases y notas opcionales. Los borradores y las grabaciones permanecen montados al cambiar de actividad.
- **Ritmo:** el avance automático se puede activar y su preferencia se conserva. Por defecto, la persona decide cuándo avanzar.
- **Continuidad:** borradores guardados localmente, biblioteca actualizada al regresar y protección contra mostrar otro video durante una carga fallida.
- **Grabación:** los cambios de actividad se bloquean mientras se graba. Descartar completa la navegación solicitada.
- **Importación:** validación del enlace, opciones avanzadas plegadas, cierre con Escape, foco contenido en el diálogo, recuperación del foco y nueva importación después de completar un trabajo.
- **Archivos locales:** importación de MP4/WebM con reproducción nativa y transcripción local. No depende de YouTube ni de cookies; permanece disponible durante una pausa de importaciones de YouTube.
- **Legibilidad:** colores coherentes, más espacio, controles táctiles, indicadores de foco y respeto a movimiento reducido. Se sustituyeron identificadores internos y métricas de edición por mensajes de práctica.
- **Tutor:** se eliminó la solicitud duplicada al abrir el panel; las notas respetan la preferencia del idioma de explicación.
- **Ajustes:** las preferencias de estudio aparecen antes que el diagnóstico técnico.

## Siguientes mejoras de producto

1. Unificar el idioma de toda la interfaz. Actualmente predominan los textos en inglés y todavía hay mensajes heredados en español; el idioma de las explicaciones ya es configurable.
2. Añadir un historial de sesiones y objetivos diarios basados en actividad real. El progreso actual cuenta frases completadas, pero no mide constancia ni evolución.
3. Crear una colección de vocabulario guardado y repaso espaciado. El diccionario contextual existente sirve para consultar, pero falta un recorrido de repaso.
4. Ofrecer una primera lección de demostración para empezar sin elegir ni importar un video.
5. Probar tareas con estudiantes reales: importar, retomar, entender un error y repetir una grabación. Eso permitirá priorizar fricciones que el análisis del código no revela.

## Verificación

Se añadieron pruebas de búsqueda, filtros, orden, paginación, cambio de actividad, conservación de borradores, descarte de grabaciones, enlaces inválidos y reapertura de importaciones. Se revisó la interfaz en navegador, tanto en escritorio como a 390 px de ancho.

La grabación con micrófono real y las respuestas de los proveedores de IA no forman parte de esta comprobación manual; sus flujos conservan las pruebas automatizadas existentes.

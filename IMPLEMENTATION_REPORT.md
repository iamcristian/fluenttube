# Backend de fonética y shadowing

## Estudio dentro de la ventana

El escritorio (desde 1024 px de ancho y 600 px de alto) usa 100dvh y el ancho completo. El vídeo y la navegación de frases ocupan la columna izquierda; Speak reparte captura/comparación y evaluación en dos columnas contiguas. Se compactan navegación, micrófono y curvas, conservando los controles y sus etiquetas accesibles. Notas y detalles extensos tienen desplazamiento independiente; el vídeo y la frase permanecen en su panel. En pantallas pequeñas se conserva el flujo vertical para permitir lectura y zoom.

Verificación real a 1280×720: documento de 720 px de alto, panel de captura de 439 px con contenido de 439 px (sin desplazamiento), curvas original/toma y vídeo visibles. La evaluación extensa y la lista de frases permiten desplazamiento interno. Las 123 pruebas frontend y la compilación pasan. La captura se guarda en docs/screenshots/study-single-viewport.png.

## Shadowing: comparación vertical y controles de reproducción

La actividad Speak elimina la tarjeta introductoria Step 03. El primer gráfico reproduce el intervalo exacto de la frase del vídeo importado, servido por GET /api/segments/{id}/reference-audio. Debajo aparece la toma actual; los reproductores usan los botones dentro de las formas de onda y el reproductor nativo duplicado queda oculto. Las reproducciones se alternan para evitar solaparse y se pausan al grabar.

Tras evaluar, cada bloque incorpora su curva de altura relativa, con escala compartida; la evaluación completa va después de ambos. El historial sin audio conserva su curva e indica que la grabación no se conserva. Una toma nueva oculta la evaluación previa y puede evaluarse de nuevo. La comparación usa el original humano del vídeo, sin síntesis.

Validación: 123 pruebas frontend y compilación aprobadas; dos pruebas de audio del backend aprobadas con FFmpeg real, incluida la extracción exacta de 0,6 segundos y limpieza del archivo temporal. Verificación en navegador sobre una frase completada: forma de onda original disponible, curvas del original y del último intento apiladas y evaluación inferior. No se grabó una toma nueva del micrófono durante esta comprobación.

## Prueba de voz del laboratorio y selección de micrófono

La grabación del laboratorio anteriormente solo producía un reproductor. Ahora el panel principal permite elegir entrada, muestra su nombre efectivo y un medidor durante la grabación, conserva la selección en este navegador y permite escuchar referencia/toma y solicitar comparación acústica. El selector también se utiliza en Shadowing. Una entrada desconectada produce un mensaje específico, sin cambiar silenciosamente a otra.

POST /api/phonetics/voice/{lesson_id} valida y convierte la subida con FFmpeg, compara con el ejemplo británico sintético de la ficha y devuelve nivel RMS, clipping, duración y curvas relativas de altura. Silencio y señal insuficiente se identifican como no evaluables; no se asigna una nota de pronunciación. El audio subido y los WAV temporales se eliminan incluso ante error. La referencia es sintética; este panel no compara con un hablante humano del vídeo.

La práctica de oído queda plegada como opcional, con explicación explícita de que puede sonar cualquiera de las dos palabras y repetirse. Sigue limitada a ese contraste; no se presenta como generador de contenido nuevo.

Validación: 153 pruebas backend y 123 frontend aprobadas (122 en la batería completa y una prueba adicional del panel). Compilación TypeScript/producción aprobada. Casos nuevos: entrada exacta seleccionada, micrófono desconectado, subida desde la UI, señal sinusoidal y silencio procesados con FFmpeg/Praat reales, archivo inválido y limpieza temporal. Verificación en navegador: ficha de sheep con selector, entradas reales enumeradas y grabación prioritaria. La prueba con voz y dispositivo del estudiante queda para su interacción; no se grabó audio ambiente durante la verificación.

## Estado actual: atlas y curso (3 de noviembre de 2026)

La aplicación local sirve la versión 2: todas las entradas de la tabla tienen ficha y actividad (12 vocales simples, 8 diptongos, 24 consonantes y 3 signos). Se conservan los identificadores y las respuestas anteriores. Cada ficha tiene un modelo gráfico distinto: posición lingual, labios y trayectoria para las vocales; lugar, modo y sonoridad para las consonantes; sílabas con marcas para los signos. Los gráficos son esquemas originales. La animación sigue el avance global del ejemplo, sin afirmar límites temporales por fonema. Los ejercicios de NEAR/SQUARE/CURE comprueban notación para evitar penalizar variantes del hablante.

El curso contiene 60 miniunidades A01–D60 con ejemplo sonoro, consigna, actividad y explicación. La respuesta se comprueba en el servidor y el avance persiste en SQLite. E1–E6 aportan consulta, diagnóstico conceptual y glosario. El inspector abre la lectura elegida y permite saltar a sus sonidos sin desmontar el vídeo. El diccionario editorial local tiene 56 palabras, incluidas todas las palabras de ejemplo del atlas. Los 103 textos distintos de audio del atlas y del curso están sintetizados y en la caché de este equipo; la caché no se distribuye con el código.

Verificación: 152 pruebas backend y 120 frontend aprobadas, TypeScript y compilación de producción correctos. Una prueba exige 47 modelos distintos y resolución de todos sus ejemplos; otras comprueban que los quizzes guardan la respuesta una vez, que se conserva la sonoridad en el dibujo y que el inspector respeta las africadas y los diptongos. En una pestaña de verificación se abrieron las fichas de /ŋ/, /aɪ/ y acento principal, se volvió a la tabla y se seleccionó D60 desde el curso. La verificación de respuestas se realizó sobre una base temporal.

Límites: revisión fonética independiente, grabaciones humanas con licencia, marcas temporales por fonema y evaluación calibrada con voces humanas siguen pendientes. El léxico no tiene cobertura general. La voz sintética del curso sirve de referencia léxica, sin garantizar la entonación pedagógica de cada consigna. Las secciones siguientes describen entregas históricas, incluida la de seis fichas que reemplaza esta versión.

Revisión del 3 de noviembre de 2026 sobre la base 9a277746273e479ba3c014af8124892081b40996.

## Cambios entregados

| Área | Resultado |
|---|---|
| Diccionario y caché | El IPA histórico deja de considerarse una fuente GB. Las definiciones permanecen disponibles. Un catálogo original pequeño devuelve lecturas, variantes, procedencia y estado editorial pendiente de revisión. Las palabras desconocidas devuelven null. Se retiró la conversión de ARPABET US a supuesto acento GB. |
| Audio del diccionario | La consulta deja de esperar a Edge TTS. Su endpoint sigue siendo opcional por internet. El caché distingue voz y texto completo, usa escritura temporal atómica y espera máxima de 20 segundos. Un error no deja una descarga parcial reutilizable. |
| SQLite | Alembic adopta el esquema anterior y añade campos opcionales y caché acústica. Antes del upgrade de una base existente se crea una copia con SQLite Backup, compatible con WAL. DDL y registro de revisión comparten transacción explícita. Un esquema al que le faltan columnas conocidas detiene el arranque. |
| Tiempos de palabras | Las nuevas importaciones conservan las marcas ASR, incluyendo el desplazamiento de bloques de cinco minutos. Los vídeos anteriores pueden recuperar tiempos al solicitar V2. Se requiere coincidencia textual heurística de al menos 90 para conservarlos. |
| Procesamiento acústico | Praat/Parselmouth en CPU extrae F0 relativo a la mediana individual en semitonos, cuadros sordos como null, rango, actividad por energía, pausas internas y clipping. Resultado descriptivo y experimental. Se conservan avisos de calidad no verificada. |
| Caché de referencia | Huella SHA-256 del clip PCM, intervalo, texto, versión y parámetros. Reutiliza features y tiempos. Una sustitución del clip invalida la entrada. La FK elimina el caché al eliminar el segmento. El audio temporal se elimina al terminar el job. |
| Reintentos | Identidad de petición por operación, audio original, segmento y versión. El mismo envío reutiliza job. Otro audio o versión con la misma clave produce 409. Un job fallido admite volver a subir la captura y reencolar con la misma identidad. Un WAV creado por un envío concurrente descartado se limpia. |
| Frontend consumidor | La captura mantiene una clave estable al repetir la solicitud. El cliente API admite V2 explícito. El inspector presenta variantes y revisión pendiente y muestra el diccionario sin esperar al tutor. |

## Uso de V2

### Inspector, tarea 02 de Sol Medium

El inspector muestra el diccionario mientras el tutor sigue cargando. Presenta lecturas alternativas, procedencia, revisión editorial pendiente y ausencia de IPA. Los errores del diccionario ofrecen reintento y los de audio permiten volver a escuchar. Cambiar o quitar la selección descarta respuestas antiguas, incluso en una secuencia A → B → A. El reproductor libera audio al cambiar de palabra o desmontarse y cancela su indicador si falla la reproducción o la carga inicial supera 25 segundos. El estado del tutor usa un mensaje independiente del proveedor configurado.

Verificación automatizada con acciones de selección, reproducción y reintento en el componente. Siete pruebas del inspector y la regresión completa de **117 pruebas frontend** pasaron. El build con TypeScript también pasó. La comprobación de esta tarea utilizó respuestas y audio simulados, y queda pendiente una revisión visual en navegador. El laboratorio y el panel V2 se integraron en la entrega posterior descrita abajo.

El POST multipart existente `/api/shadowing/evaluate` acepta `evaluation_version=1|2`, con valor predeterminado `1`, junto a `segment_id`, `audio_file` y `client_request_id`. El resultado del job V2 y el histórico de intentos contienen `evaluation_version` y `prosody`. La puntuación textual/duración conserva el algoritmo V1. Los índices de similitud prosódica quedan en null porque aún falta su calibración. El cliente TypeScript admite `evaluateShadowing(segmentId, blob, captureKey, '2')` para la futura interfaz.

Para reintentar una captura tras un fallo, volver a enviar los mismos bytes, segmento, versión y clave. Para una captura nueva, crear otra clave. Si el servidor responde 409, corregir la identidad del envío. Los jobs históricos creados sin huella de audio requieren una clave nueva al volver a subir una grabación. La cola soporta un único proceso de aplicación, como el servidor local actual.

La recuperación de palabras y su caché se ejecutan dentro del worker existente. Si falta el vídeo o falla el DSP, se guarda el resultado textual y el bloque acústico queda unavailable con aviso. La primera evaluación V2 de un vídeo anterior puede requerir ASR adicional de la referencia.

## Instalación y restauración

El entorno local ya contiene las nuevas dependencias. En otra instalación usar `backend\\.venv\\Scripts\\python.exe -m pip install -r backend/requirements-lock.txt` desde la raíz. El siguiente arranque aplica la revisión `0001_phonetics`. Las pruebas usan bases aisladas. Durante este trabajo no se ejecutó el upgrade sobre la biblioteca personal.

Para restaurar, detener todos los procesos de la aplicación. Usar `sqlite3.Connection.backup` desde la copia `.pre-phonetics-<id>.bak` a una ruta nueva. Ejecutar el código anterior contra esa ruta. Esto evita mezclar el fichero principal restaurado con los WAL/SHM de una conexión antigua. Las pruebas recuperan una copia y vuelven a migrarla. El downgrade de Alembic deriva a este procedimiento de restauración.

## Archivos de implementación

- DB y migraciones en `backend/app/database.py`, `backend/app/models.py`, `backend/migrations/env.py` y `backend/migrations/versions/0001_phonetics.py`.
- Diccionario en `backend/app/services/pronunciation_lexicon.py`, `backend/app/services/british_service.py`, `backend/app/routers/british.py` y `backend/app/schemas.py`.
- Audio y evaluación en `backend/app/services/reference_audio.py`, `backend/app/services/prosody.py`, `backend/app/services/local_video.py`, `backend/app/services/segmenter.py`, `backend/app/services/shadowing_service.py`, `backend/app/services/jobs.py` y `backend/app/routers/shadowing.py`.
- Consumidores en `frontend/src/api/client.ts`, `frontend/src/api/types.ts`, `frontend/src/components/BritishInspector.tsx` y `frontend/src/components/ShadowingStudio.tsx`.
- Dependencias en `backend/requirements.in` y `backend/requirements-lock.txt`.
- Pruebas en `backend/tests/test_phonetics_backend.py`, `backend/tests/test_shadowing.py`, `backend/tests/test_british.py` y `frontend/tests/ShadowingStudio.test.tsx`.

## Validación y límites

Resultado final de la regresión con `python -m pytest backend/tests -q --disable-warnings` desde el entorno del backend y `npm --prefix frontend test -- --reporter=dot`: **151 pruebas backend y 113 frontend aprobadas**. `npm --prefix frontend run build` y `python -m pip check` también pasaron. Persisten dos avisos backend y avisos React sobre act en pruebas anteriores.

Se ejecutó además un recorrido real en una base temporal, sin ASR simulado. Una frase sintetizada con System.Speech se convirtió a referencia MP4 con FFmpeg. El POST multipart V2 creó un job real, Whisper small.en transcribió en CUDA y Praat calculó la referencia y la toma. Resultado de palabras 100, bloque prosódico experimental, histórico conservado y cero WAV temporales al finalizar. El recorrido tardó 4,43 segundos en esta ejecución con RTX 3050. El tiempo incluye primera evaluación de referencia y no constituye un benchmark p95 ni una prueba con voz humana de estudiante.

La batería añade casos para IPA legado, homógrafos, fuentes US ambiguas, restauración, fallo a mitad de migración, desplazamiento temporal de bloques, octava frente a melodía plana, silencio, JSON sin NaN, caché de voz/texto, concurrencia de envíos, fallo/reintento y borrado en cascada. La integración V2 procesa una señal con FFmpeg y Praat reales con ASR simulado, comprueba histórico, reenvío, conflicto de contenido, caché e invalidación al sustituir el clip. Las pruebas del diccionario simulan proveedores para que sean repetibles sin red. El benchmark de CUDA y voz sintética de la revisión anterior permanece como evidencia separada en el plan de factibilidad.

El catálogo tiene 16 entradas originales con estado `editorial_pending_review`. Una palabra ausente puede conservar definición y audio online pero carecer de IPA. Quedan pendientes un lexicón amplio revisado y su desambiguación contextual, un panel visual V2, alineamiento léxico/DTW, puntuaciones calibradas, detección fiable de música y varios hablantes, corrección de saltos de octava y evaluación de fonemas. El pitch usa un rango amplio fijo de 50–600 Hz y abstención básica, que necesita evaluación con voces fuera de ese rango. El detector de actividad por energía es heurístico. Las curvas conservan diferencias expresivas y diferencias entre las tomas, pero aún no generan recomendaciones por palabra.

## Dependencias y procedencia

Las versiones y licencias siguientes se leyeron en los metadatos de las distribuciones instaladas. Alembic 1.20.1 y Mako 1.4.3 declaran MIT. MarkupSafe 3.0.4 declara BSD-3-Clause. Praat-Parselmouth 0.4.7 declara GPLv3. La distribución conjunta de la aplicación requiere revisar y cumplir estas licencias. Los archivos de licencia vienen en las distribuciones instaladas. No se incorporó un dataset externo ni modelos de voz nuevos.

[Alembic](https://github.com/sqlalchemy/alembic) · [Mako](https://github.com/sqlalchemy/mako) · [MarkupSafe](https://github.com/pallets/markupsafe) · [Parselmouth](https://github.com/YannickJadoul/Parselmouth)


## Laboratorio integrado, segunda entrega

El botón Phonetics Lab abre un diálogo sobre biblioteca o estudio. El estudio sigue montado para conservar segmento y toma. Se pausa la reproducción antes de abrirlo y el acceso se bloquea mientras el micrófono está activo. El cierre devuelve el foco. El diálogo soporta teclado, foco contenido y preferencia de movimiento reducido.

El inventario incluye vocales, diptongos, consonantes y símbolos, con búsqueda por IPA y ejemplos. El primer pack contiene seis lecciones originales y tres contrastes (KIT/FLEECE, f/v, s/ʃ), con explicaciones en español, reproductor nativo con pausa, seek, loop y velocidad, dibujo ilustrativo SVG y grabación local. Los demás símbolos aparecen como referencia con lección todavía no redactada. El audio usa la voz británica Edge existente, con caché local. La ilustración sigue el progreso del audio pero carece de marcas fonéticas revisadas: no es una animación anatómica alineada por fonema.

Los quizzes se generan en el servidor. El cliente recibe un ID opaco y opciones, sin la clave. El audio no contiene la respuesta en su URL. Escuchar hasta el final habilita las opciones. La respuesta se verifica en el servidor y se guarda una sola vez por ejercicio. Reenviar una elección distinta devuelve 409. La cola usa intervalos de 1, 3, 7, 14 y 30 días según racha de aciertos, siempre como práctica perceptiva. La revisión 0002_reviews añade persistencia sin eliminar intentos anteriores. Las grabaciones de práctica siguen en memoria.

Shadowing solicita V2 desde su flujo normal, conserva curvas en el historial y muestra referencia y toma en escalas relativas compartidas, con ejes temporales independientes. Se muestran huecos sordos, rango, cobertura sonora, pausas y avisos, sin porcentajes de pronunciación inventados.

Verificación en navegador real sobre base QA temporal: abrir desde biblioteca, entrar al contraste, escuchar el audio completo, elegir, recibir corrección, actualizar próxima revisión y regresar. La captura queda en el espacio de visualizaciones del chat. Los cinco audios ship/sheep/fan/van/sip se sintetizaron y Whisper reconoció las palabras esperadas. Esto comprueba la ruta de medios, sin sustituir revisión fonética. No se modificó la base personal.

Pendientes editoriales y de investigación: revisión independiente del pack, anatomía y marcas temporales por fonema, grabaciones humanas autorizadas, currículo completo y validación de métricas automáticas. La app identifica el pack como editorial pendiente y el panel acústico como experimental.

Regresión final de esta entrega: 152 pruebas backend y 118 frontend aprobadas. TypeScript y build de producción aprobados. Persisten avisos de deprecación backend y avisos act de React en pruebas existentes. La revisión visual se hizo con la aplicación real conectada a una base QA temporal.

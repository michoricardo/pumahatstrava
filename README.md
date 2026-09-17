# Strava UI Activity Points Extractor

Este proyecto documenta un enfoque de OSINT aplicado a Strava usando la interfaz web en vez de la API oficial. La idea no es depender de un plan de pago ni de tokens de API, sino demostrar que un investigador puede diseñar un flujo reproducible a partir de la vista semanal del perfil, navegando por intervalos `YYYYWW` y usando GPX solo como evidencia de respaldo cuando hace falta.

Archivos principales:
- `activitiespointschecker.js`: script para consola del navegador que recolecta actividades y extrae puntos de inicio y fin.
- `activitiespointschecker_polyline.js`: variante experimental que intenta recuperar puntos desde HTML y polyline cuando no quieres depender de GPX.
- `strava_ratelimit_probe.js`: probe simple para inspeccionar si una respuesta expone `Retry-After` o headers de cuota.

## Objetivo

Extraer puntos de inicio y termino de actividades visibles desde Strava para:
- comprobar si una semana o rango temporal contiene suficiente señal geografica,
- exportar resultados a CSV y GeoJSON,
- validar coordenadas,
- cargar esos datos en un mapa y razonar sobre zonas probables de rutina.

## Como se ejecuta

1. Inicia sesion en Strava en el navegador.
2. Abre exactamente la vista que vas a analizar:
   - `https://www.strava.com/athletes/ATHLETE_ID` si usaras un ID numerico
3. Abre DevTools.
4. Ve a la pestaña Console.
5. Copia el contenido completo de `activitiespointschecker.js`.
6. Pegalo y ejecutalo en la consola.
7. Responde los prompts.
8. Espera a que se descarguen:
   - `strava_activity_points.csv`
   - `strava_activity_points.geojson`
   - `strava_activity_points_map.html`
   - `strava_activity_points_google_maps.html`

Vista semanal de ejemplo:
- `https://www.strava.com/athletes/71555238#interval?interval=202632&interval_type=week&chart_type=miles&year_offset=0`

Nota importante:
- la parte despues de `#` es un fragmento del navegador y no se envia al servidor.
- por eso este script no intenta pedir semanas al backend con muchas rutas distintas.
- en vez de eso, cambia el `hash` en la pestaña actual, espera a que la UI muestre esa semana y extrae las actividades visibles de esa vista.

## Que significa cada prompt

### `How many matching activities to inspect?`

Cuantas actividades maximo quieres conservar y extraer dentro de las semanas pedidas.

Ejemplo:
- `20` significa: aunque encuentre mas actividades visibles al navegar semanas, solo conservara y extraera hasta 20 que si caigan en esas semanas.

Si pones mas actividades de las que existen:
- no pasa nada malo,
- el script simplemente recolecta todas las que encuentre y se detiene,
- el total real queda limitado por lo que haya disponible en esas semanas.

Si pones menos actividades de las que existen:
- el script corta antes,
- esto reduce tiempo, peticiones y ruido,
- es util para pruebas rapidas o demos cortas.

### `Min delay between requests (ms)`

Es la espera minima entre peticiones.

Ejemplo:
- `900` = al menos 0.9 segundos.

Sirve para:
- evitar patrones demasiado agresivos,
- bajar el riesgo de rate limiting,
- parecer menos automatizado.

### `Max delay between requests (ms)`

Es la espera maxima entre peticiones.

El script elige un tiempo aleatorio entre minimo y maximo.

Ejemplo:
- minimo `900`, maximo `1800`
- cada espera sera aleatoria entre 0.9 y 1.8 segundos.

Por que es mejor que un delay fijo:
- reduce repeticion mecanica,
- ayuda a no generar un patron exactamente identico en cada request.

### `Max retries on 429/5xx`

Numero de reintentos automaticos si hay errores temporales del servidor.

Casos tipicos:
- `429`: demasiadas peticiones.
- `500`, `502`, `503`, `504`: errores temporales del backend o gateway.

Ejemplo:
- `1` significa que intentara una vez extra antes de fallar definitivamente.

Si el servidor devuelve un error no reintentable:
- el script lo marca como fallo y sigue con otras partes del flujo cuando aplica.

Recomendacion practica:
- para `429`, usa `0` o `1`.
- reintentar demasiadas veces puede empeorar el bloqueo, sobre todo en `export_gpx`.

### `Athlete ID (number)`

Define de quien intentar recolectar actividades.

Usa un numero, por ejemplo `71555238`.

Cuando usarlo:
- si quieres demostrar navegacion de perfil concreto,
- o si la vista del atleta expone mejor las actividades desde UI.

### `Interval year (YYYY)`

Ano base para construir intervalos semanales del tipo `YYYYWW`.

Ejemplo:
- `2026`

Es obligatorio en la estrategia actual porque el loop solo navega por semanas.

### `Start week (1-53)`

Semana inicial del ano para construir el intervalo.

Ejemplo:
- `32`

Combinado con el ano:
- `2026` + `32` produce `202632`.

### `How many weeks to scan from start week?`

Cuantas semanas consecutivas quieres recorrer desde la semana inicial.

Ejemplo:
- ano `2026`, start week `32`, scan `4`
- intentara `202632`, `202633`, `202634`, `202635`.

Si en ese lapso hay menos actividades de las que pediste arriba:
- solo obtendras las que realmente existan.

Si en ese lapso hay mas actividades de las que pediste arriba:
- el script se detiene al llegar al maximo configurado.

### `Use GPX fallback when page has no start/end coords?`

El fallback es una ruta alternativa de evidencia.

Que hace:
- primero intenta obtener `start_latlng` y `end_latlng` desde el HTML de la actividad,
- si eso no existe o viene vacio,
- intenta encontrar el enlace `export_gpx`,
- descarga el GPX,
- toma el primer `trkpt` como inicio,
- toma el ultimo `trkpt` como fin.

Por que es util:
- muchas actividades no exponen coordenadas claras en HTML,
- pero si tienen GPX exportable,
- eso mejora cobertura para running, cycling y actividades outdoor.

Limitaciones:
- actividades de fuerza o gym pueden no tener GPX util,
- el GPX puede no existir o no estar disponible,
- si no hay ruta, no hay inicio o fin geograficamente utiles.
- el rate limiting puede depender de la sesion o cuenta usada, no solo del script.
- si Strava devuelve `429`, conviene detener la corrida y reintentar mas tarde en vez de insistir.

### `Enable diagnostics logs?`

Activa logs adicionales.

Sirve para ver:
- que semana esta navegando,
- cuantos IDs visibles detecto en cada semana,
- cuales actividades fueron descartadas por estar fuera de las semanas pedidas,
- donde hubo errores,
- si hubo reintentos por rate limit.

Recomendado:
- `yes` durante desarrollo,
- `no` si ya solo quieres una corrida limpia para demo.

## Que pasa si el rango temporal no coincide con las actividades

### Si pides mas actividades de las que hay en esas semanas

No es un problema. El comportamiento esperado es:
- el script intenta encontrar hasta el maximo que pediste,
- si solo hay 5 en ese lapso, procesa 5,
- y se detiene sin error.

### Si pides menos actividades de las que realmente existen

Tampoco es un problema. El script:
- sigue navegando por las semanas pedidas,
- pero corta el resultado al maximo configurado.

Esto es util si quieres:
- reducir tiempo de demo,
- limitar peticiones,
- probar un subconjunto antes de una corrida mayor.

## Como valida el script que las coordenadas tengan sentido

El script hace varios checks:

1. Valida rango geografico:
- latitud entre `-90` y `90`
- longitud entre `-180` y `180`

2. Construye links de mapa:
- `startMapUrl`
- `endMapUrl`

3. Imprime un resumen de calidad:
- total de filas procesadas,
- cuantas tuvieron inicio,
- cuantas tuvieron fin,
- bounding box (`bbox`),
- muestra de puntos.

Si quieres comprobar manualmente que un punto esta bien:
- abre el `startMapUrl` o `endMapUrl` en el CSV,
- valida si cae en una zona coherente contigo o con la actividad.

## Por que a veces muchas actividades quedan sin coords

Casos comunes:
- actividades indoor,
- entrenamiento de fuerza,
- rutas sin GPX exportable,
- paginas donde Strava no expone `start_latlng` o `end_latlng`.

Eso no significa necesariamente que el script falle.
Puede significar simplemente que esa actividad no deja una huella geografica util.

Desde la perspectiva OSINT, eso es importante:
- ausencia de geodatos tambien es una observacion valida,
- la calidad de evidencia depende del tipo de actividad,
- no todas las semanas tienen el mismo valor investigativo.

## Flujo tecnico del script

El loop principal es:

1. Navigate
- parte de la vista del atleta ya abierta,
- cambia el `hash` a cada semana `YYYYWW`,
- espera a que Strava pinte la vista semanal.

2. Collect
- toma los `activityId` visibles en esa semana desde la UI actual,
- deduplica IDs entre semanas.

3. Extract
- abre cada actividad,
- intenta extraer `start_latlng` y `end_latlng` del HTML.

4. Validate
- verifica que la actividad realmente pertenezca a una de las semanas pedidas,
- si faltan coordenadas, intenta fallback GPX,
- valida rangos de lat/lon,
- genera muestra y bbox.

5. Export
- genera CSV,
- genera GeoJSON,
- genera un HTML con todos los puntos en un solo mapa,
- genera un HTML con enlaces agrupados a Google Maps,
- lista puntos para visualizar en mapa.

## Recomendaciones de uso para no verte agresivo

Valores sugeridos para una demo segura:
- `minDelayMs = 1200`
- `maxDelayMs = 2500`
- `maxRetries = 2`
- `maxActivities = 15` o `20`

Valores conservadores:
- `minDelayMs = 1800`
- `maxDelayMs = 3200`
- `maxRetries = 3`
- `maxActivities = 10` o `15`

Buenas practicas:
- prueba primero con pocas actividades,
- usa semanas con running o cycling outdoor,
- evita hacer corridas muy largas repetidas una tras otra,
- si ves `429`, espera un rato antes de relanzar,
- trata `export_gpx` como la parte mas sensible del flujo.

Valores mas prudentes para GPX:
- `maxActivities = 10`
- `maxRetries = 0` o `1`
- `gpxDelayMs = 8000` a `15000`

Nota sobre limites:
- este proyecto no usa la API oficial de Strava.
- por eso no siempre recibiras headers como `X-RateLimit-*` o `Retry-After`.
- cuando no aparezcan, no hay una cuenta regresiva exacta disponible desde la respuesta.

## Salidas

### CSV

Columnas actuales:
- `activityId`
- `title`
- `startDateLocal`
- `yearWeek`
- `collectedYearWeek`
- `ownerAthleteId`
- `collectedOwnerHintAthleteId`
- `ownerStatus`
- `startLat`
- `startLon`
- `endLat`
- `endLon`
- `startMapUrl`
- `endMapUrl`
- `source`
- `ok`

Interpretacion de `source`:
- `activity_page`: salio desde HTML de la actividad.
- `activity_page+gpx`: hizo falta usar GPX para completar la evidencia.
- `error`: fallo la extraccion de esa actividad.

Interpretacion de `ownerStatus`:
- `match`: la actividad coincide con el atleta objetivo.
- `unknown`: no hubo suficiente metadata para afirmarlo con certeza.
- `mismatch`: la actividad fue descartada por pertenecer a otro atleta.

Interpretacion de `ok`:
- `true`: obtuvo inicio, fin o ambos.
- `false`: no obtuvo coordenadas utiles.

### GeoJSON

Contiene puntos listos para:
- cargar en mapas,
- agrupar clusters,
- comparar inicios y finales,
- hacer reasoning visual.

### HTML para Google Maps

El archivo `strava_activity_points_google_maps.html` agrega los puntos de inicio y fin en enlaces agrupados hacia Google Maps.

Como usarlo:
- abre el HTML descargado en tu navegador,
- haz click en `Abrir en Google Maps`,
- si Google Maps no acepta todos los puntos en un solo enlace, usa el siguiente lote.

Nota:
- Google Maps via URL tiene limites practicos de longitud y cantidad de waypoints,
- por eso el script divide los puntos en mapas por lote cuando hace falta.

### HTML de mapa unico

El archivo `strava_activity_points_map.html` abre todos los puntos detectados en un solo mapa usando Leaflet.

Que resuelve:
- no trata tus puntos como si fueran un viaje con escalas,
- no convierte los puntos en waypoints intermedios,
- permite ver todos los inicios y finales del chequeo en una sola vista.
- no depende de tiles externos para funcionar como archivo local.

Que muestra:
- puntos de inicio en azul,
- puntos de fin en rojo,
- un segmento corto entre inicio y fin cuando una actividad tiene ambos.

### HTML para geojson.io

El archivo `strava_activity_points_geojsonio.html` automatiza la carga del GeoJSON en `geojson.io` usando una URL con el contenido embebido.

Que resuelve:
- evita importar el archivo manualmente,
- abre los puntos como capa GeoJSON,
- mantiene colores distintos para `start` y `end` cuando el visor los respeta.

Limitacion:
- si el dataset crece mucho, la URL puede ser demasiado larga para el navegador.

## Otras herramientas para ver los puntos

Si no quieres usar `geojson.io`, estas son las opciones mas utiles:

### QGIS

Sirve para cargar `strava_activity_points.geojson` como capa local.

Ventajas:
- no depende del navegador,
- permite simbologia por atributo,
- puedes colorear por `pointType`, `yearWeek` o `activityId`,
- sirve mejor si luego quieres clusters, buffers o mapas para presentar.

### Google My Maps

Sirve para importar `CSV` o `GeoJSON` como marcadores, no como ruta de navegacion.

Ventajas:
- mas simple que QGIS,
- facil de compartir,
- no trata los puntos como viaje intermedio igual que Google Maps Directions.

### uMap

Sirve para subir `GeoJSON` y verlo sobre capas de OpenStreetMap en un mapa compartible.

Ventajas:
- rapido,
- soporta capas y estilos,
- bueno para demos ligeras en navegador.

### kepler.gl

Sirve para cargar `GeoJSON` o `CSV` y explorar visualmente muchos puntos.

Ventajas:
- muy bueno para densidad, agrupacion y patrones,
- util si luego quieres contar inicios y finales por zona.

Recomendacion practica:
- para una demo rapida: `geojson.io` o `Google My Maps`
- para analisis serio: `QGIS`
- para exploracion visual de muchos puntos: `kepler.gl`

## Script auxiliares

### `activitiespointschecker_polyline.js`

Sirve para probar una superficie menos dependiente de GPX.

Que hace:
- recorre semanas igual que el extractor principal,
- intenta leer coordenadas desde HTML o polyline,
- exporta CSV, GeoJSON y un HTML de mapa cuando encuentra puntos validos.

Cuando usarlo:
- si quieres medir cuanto recuperas sin tocar `export_gpx`,
- o si quieres comparar cobertura entre HTML y GPX.

### `strava_ratelimit_probe.js`

Sirve para inspeccionar una URL concreta de Strava y ver si la respuesta expone:
- `Retry-After`
- `X-RateLimit-*`
- algun otro indicio util de cuota

Importante:
- no evita limites,
- no desbloquea sesiones,
- solo ayuda a diagnosticar si el servidor expone informacion util.

## Relacion con la charla

Este repo no trata de una herramienta magica. Trata de proceso.

Lo que demuestra:
- una restriccion de API no cancela una investigacion,
- se puede reconstruir un flujo a partir de UI y artefactos derivados,
- el investigador decide pivotes, validacion y limites,
- la IA y la automatizacion sirven mejor cuando operan sobre loops claros.

## Crear repo y hacer push sin mezclar tu cuenta del trabajo

La parte importante aqui no es solo el token. Es aislar tambien la identidad Git local.

### 1. Configura identidad solo para este repo

Dentro de la carpeta del proyecto:

```powershell
git init
git checkout -b main
git config user.name "TU_NOMBRE_PERSONAL"
git config user.email "TU_CORREO_PERSONAL"
```

Esto configura nombre y correo solo en este repo, no globalmente.

Puedes verificarlo con:

```powershell
git config --get user.name
git config --get user.email
```

### 2. Crea el repo en GitHub manualmente desde tu navegador personal

No uses la cuenta del trabajo. Crea un repo vacio, por ejemplo:
- `strava-ui-activity-points-osint`

### 3. Agrega archivos y haz commit

```powershell
git add .
git commit -m "Initial commit: Strava UI activity points extractor"
```

### 4. Agrega remote HTTPS

```powershell
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
```

### 5. Haz push sin guardar credenciales del trabajo

```powershell
git -c credential.helper= push -u origin main
```

Eso hace que Git no use un helper persistente para ese comando.

Cuando Git pida credenciales:
- username: tu usuario personal de GitHub
- password: tu Personal Access Token

### 6. Importante sobre el token

No pongas el token en:
- comandos pegados en la terminal,
- URLs del remote,
- archivos del repo,
- scripts,
- historial compartido.

Evita comandos como este:

```powershell
git remote add origin https://TU_TOKEN@github.com/TU_USUARIO/TU_REPO.git
```

Aunque funciona, deja demasiada superficie de exposicion.

### 7. Verifica que el remote sea el correcto

```powershell
git remote -v
```

Debe apuntar solo a tu repo personal.

### 8. Si quieres extremar cuidado

Despues del push:

```powershell
git config --unset user.name
git config --unset user.email
```

Eso no borra el commit ya hecho, pero limpia la configuracion local del repo si ya no la quieres dejar ahi.

## Proxima mejora natural

Buenas siguientes iteraciones para este repo:
- anonimizar coordenadas con jitter configurable,
- generar resumen de clusters automaticamente,
- exportar un reporte markdown de hallazgos,
- separar script en version "debug" y version "demo".
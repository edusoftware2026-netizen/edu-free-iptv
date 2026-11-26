# Plan de Acción: Free-IPTV Pro v2.0 - Android TV

## Problem Analysis
- **Síntoma**: `catalogs.movies` = 0, `catalogs.series` = 0, `counts.movies` = 0, `counts.series` = 0
- **Causa**: El flujo `fetchXtream` en `catalog.js` carga los endpoints, pero los datos de prueba/mock no están poblando movies/series, o el código de normalización no está extrayéndolos correctamente.
- **Impacto**: La página principal no muestra secciones de PELICULAS y SERIES, solo LIVE. El usuario ve "todo junto" porque no hay separación visual.

## Fase 1: Arreglar Carga de Catálogos (Priority: Critical)

### Tarea 1.1: Verificar endpoints Xtream en `www/js/core/xtream.js`
- `vodCategories()` → debe devolver categorías de VOD/ películas
- `vodStreams()` → debe devolver películas
- `seriesCategories()` → debe devolver categorías de series
- `series()` → debe devolver series con temporadas/episodios
- `vodInfo()` → debe devolver info de película (poster, plot, etc.)

### Tarea 1.2: Revisar `www/js/core/catalog.js` - `fetchXtream`
- Confirmar que `onProgress` y `mapPool` no están bloqueando la carga
- Verificar `applyCatalog` construye correctamente `categories.movies` y `categories.series` con `withCounts`
- Agregar logs de debug si los endpoints retornan vacío

### Tarea 1.3: Probar con datos mock en `www/js/core/m3u.js` y `www/js/core/xtream.js`
- Crear datos de prueba realistas con películas y series
- Verificar que `parseM3UAsync` también soporte movies/series (actualmente solo live)

## Fase 2: Mejorar UI Página Principal (Priority: High)

### Tarea 2.1: `www/js/ui/screens/home.js` - Separar secciones claramente
- La estructura actual ya tiene live, movies, series rows
- **Problema**: Si `catalogs.movies` está vacío, la sección no aparece o muestra "Sin contenido"
- **Solución**: 
  - Agregar estados vacíos diferenciados por tipo
  - Mostrar mensaje "Actualiza el catalogo" solo para el tipo que falta
  - Mantener el layout: LIVE | PELICULAS | SERIES como columnas claras

### Tarea 2.2: `www/js/ui/screens/live.js` - Filtrar solo live
- Asegurar que `renderChannels` y `filteredChannels` solo usen `catalogs.live`
- El EPG y categorías deben ser solo de live

### Tarea 2.3: `www/js/ui/screens/media.js` - Pantalla dedicada para películas/series
- Ya existe `createMediaScreen` con chips y grid de posters
- **Probar** que `mount` carga `store.state.catalogs[kind]` correctamente
- Agregar mensaje "Sin peliculas" / "Sin series" si el catálogo está vacío

## Fase 3: Optimizar para Android TV (Priority: High)

### Tarea 3.1: Navegación D-Pad y foco en home
- `FocusManager` ya está implementado en `focus.js`
- **Verificar** que `attach(root, { initial: '.poster' })` funcione en grid de movies/series
- **Verificar** que el foco se mueva correctamente con flechas arriba/abajo/izquierda/derecha
- **Añadir** indicadores visuales de foco (`is-focused` class)

### Tarea 3.1: Layout responsivo Android TV
- El CSS `app.css` ya tiene media queries para `max-width: 1100px` y `760px`
- **Probar** en emulador Android TV (1080p × 1920, landscape)
- **Ajustar** `--overscan`, `--topbar-h` si es necesario

### Tarea 3.2: Tecla Atrás behavior en Android TV
- `router.js` `back()` ya maneja doble-press para salir
- **Verificar** que en `home.onBack()` funcione correcto
- **Verificar** que en `live.onBack()` detenga reproducción y vuelva al lista
- **Verificar** que en `detail.onBack()` detenga video y vuelva

## Fase 4: Testing y Validación (Priority: Medium)

### Tarea 4.1: Datos de prueba mock completos
- Crear un script Node que simule un panel Xtream con live + movies + series
- Cargar esos datos via `localStorage` o IndexedDB y verificar que todas las pantallas se renderizan

### Tarea 4.2: Test en emulador Android TV
- `npx cap sync android && ./gradlew.bat assembleDebug`
- Instalar y probar:
  - Navegación desde el inicio a LIVE, PELICULAS, SERIES
  - Scroll con D-Pad
  - Seleccionar canal/episodio/película
  - Tecla Atrás en cada pantalla
  - Volver al inicio dos veces para salir

### Tarea 4.3: Lista de verificación de aceptación (Android TV)
- [ ] Live channels cargan y se navegan con flechas
- [ ] Películas tienen sección propia con carteles (posters)
- [ ] Series tienen sección propia con temporadas/episodios
- [ ] Foco se mueve fluido entre items del grid
- [ ] Tecla Atrás regresa apropiadamente en cada pantalla
- [ ] No hay mezclado de contenido entre live/movies/series

## Inmediate Next Steps (próximos 2 horas)

1. **Ejecutar** `npm run dev` y abrir `http://localhost:8099`
2. **Ir a Inicio** - verificar si aparecen las 3 secciones (LIVE, PELICULAS, SERIES)
3. **Si solo aparece LIVE**: revisar `catalog.js` `fetchXtream` y los datos de prueba
3. **Si aparecen pero vacías**: agregar datos mock de movies/series en `localStorage` y probar `loadCatalog`
4. **Probar en emulador** - `npx cap sync android && ./gradlew.bat assembleDebug`
5. **Corregir** cualquier problema de foco/navegación D-Pad

## Rollback si es necesario
- El proyecto original `v1.0` está intacto en `D:\Free-Iptv-Pro-v1.0`
- Se puede `git checkout` o copiar archivos de vuelta si los cambios rompen algo

## Éxito Criteria
- Página principal muestra 3 secciones claras: LIVE (canales), PELICULAS (carteles), SERIES (temporadas)
- Cada sección navega correctamente con D-Pad/teclas de flecha
- Catálogo movies y series se carga desde Xtream o M3U
- Tecla Atrás comportarse consistente en todas las pantallas
- Rendimiento: renderizado < 300ms para 60 items por sección
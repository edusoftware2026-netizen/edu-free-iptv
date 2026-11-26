# Free-IPTV Pro 2.0

Cliente IPTV para Android TV construido sobre **Capacitor + WebView + ExoPlayer (Media3)**.
Carga paneles **Xtream Codes** y listas **M3U**, con una interfaz propia cyan/oscura y un
reproductor nativo preparado para zapping rápido.

> Proyecto independiente. No está afiliado a Xtream, no incluye canales ni credenciales y
> no redistribuye código, assets ni protecciones de aplicaciones de terceros. Usa únicamente
> contenido y paneles sobre los que tengas derechos de acceso.

---

## 1. Funcionalidad incluida (MVP)

| Área | Incluido |
|---|---|
| Acceso | Login Xtream (`player_api.php`) y listas M3U por URL; listas públicas de iptv-org bajo demanda |
| Cuenta | Estado, vencimiento, conexiones activas/máximas y datos del panel |
| Inicio | Hero de cuenta, contadores, continuar viendo, favoritos, filas de live/películas/series |
| Live | Categorías, búsqueda local, lista por bloques, EPG “ahora/después”, reproducción nativa |
| Películas | Catálogo, categorías, búsqueda, ficha, reanudar y favoritos |
| Series | Catálogo, ficha, temporadas, episodios y reanudar por episodio |
| Búsqueda | Búsqueda global en live, películas y series |
| Favoritos | Persistencia local; fila de favoritos en Inicio |
| Progreso | Continuar viendo en VOD y episodios, guardado cada 5 s |
| Reproductor | ExoPlayer nativo como motor principal; HLS.js como fallback web |
| Ajustes | Motor, buffer, EPG, movimiento reducido, caché, logs y cierre de sesión |
| Caché | Catálogo en IndexedDB con TTL de 15 min; estado pequeño en localStorage |
| Rendimiento | Worker para M3U, render por bloques de 60, navegación D-Pad con rects cacheados y logs por lote |

### Fuera del MVP

Descargas, grabaciones, multiscreen, catch-up, control parental, multi-perfil y EPG XMLTV
completo. La arquitectura deja puntos de extensión para añadirlos después.

---

## 2. Stack y estructura

- **Capacitor 8.6** (Android) + WebView.
- **JavaScript ES Modules** sin bundler.
- **IndexedDB** para catálogos; **localStorage** solo para estado pequeño.
- **Media3/ExoPlayer 1.3.1** para reproducción nativa.
- **HLS.js** local en `www/vendor` como fallback.

```
Free-Iptv-Pro-v2.0/
├─ www/
│  ├─ index.html
│  ├─ css/
│  │  ├─ theme.css          Variables de color y tipografía
│  │  └─ app.css            Layout, componentes, TV y responsive
│  ├─ js/
│  │  ├─ main.js            Arranque, rutas, back global
│  │  ├─ core/
│  │  │  ├─ http.js         CapacitorHttp → fetch → bridge nativo
│  │  │  ├─ xtream.js       Cliente Xtream y normalización
│  │  │  ├─ m3u.js          Carga M3U + worker
│  │  │  ├─ m3u-parser.js   Parser compartido
│  │  │  ├─ catalog.js      Catálogo, caché, búsqueda, EPG
│  │  │  ├─ db.js           IndexedDB
│  │  │  ├─ store.js        Estado persistente
│  │  │  ├─ focus.js        Navegación espacial D-Pad
│  │  │  ├─ router.js       Router hash
│  │  │  ├─ logger.js       Logs no bloqueantes por lote
│  │  │  └─ util.js         Utilidades
│  │  ├─ player/player.js   Orquestación nativo/web
│  │  ├─ ui/dom.js          Iconos, tarjetas, modales, toasts
│  │  ├─ ui/screens/        login, home, live, media, detail, search, settings
│  │  └─ workers/           Parser M3U en Web Worker
│  └─ vendor/hls.min.js
├─ android/
│  ├─ app/src/main/java/com/freeiptv/app/
│  │  ├─ MainActivity.java
│  │  └─ plugins/ExoPlayerPlugin.java
│  └─ app/src/main/assets/public/   (generado por `cap sync`)
├─ scripts/dev-server.mjs
├─ capacitor.config.json
├─ package.json
└─ README.md
```

---

## 3. Requisitos

- **Node.js 20+** y npm.
- **JDK 21** (el proyecto fija `org.gradle.java.home` a un JBR 21; cámbialo si usas otra ruta).
- **Android SDK 36** y Build Tools 35/36.
- Android Studio opcional para abrir el proyecto nativo.

En Windows, si Gradle no encuentra el SDK:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
```

Si tu JDK 21 está en otra ruta, edita `android/gradle.properties`:

```properties
org.gradle.java.home=C:/ruta/a/tu/jdk-21
```

---

## 4. Desarrollo web (UI rápida)

```powershell
npm install
npm run dev
```

Abre `http://localhost:8099`. El servidor solo sirve `www/`; no sustituye a Capacitor.
En navegador, ExoPlayer no existe y el reproductor usa HLS.js. Algunos paneles Xtream
pueden bloquear CORS en navegador; en Android se usa `CapacitorHttp`.

---

## 5. Compilar el APK

### Opción A: Android Studio

```powershell
npm install
npx cap sync android
npx cap open android
```

En Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

### Opción B: línea de comandos

```powershell
npm install
npx cap sync android
cd android
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleDebug
```

APK de depuración:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Instalar en un dispositivo conectado:

```powershell
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Para una build de release, crea un keystore y configura `signingConfigs` en
`android/app/build.gradle`; no se incluye ningún keystore en el repositorio.

### Sincronizar solo cambios web

```powershell
npx cap copy android
```

Recuerda ejecutar `npx cap sync android` (o `copy`) antes de compilar: los archivos de
`www/` se copian a `android/app/src/main/assets/public/`.

---

## 6. Uso

1. Abre la app.
2. Elige **Xtream Codes** o **Lista M3U**.
3. Xtream: servidor con protocolo y puerto (`http://host:8080`), usuario y contraseña.
4. M3U: URL directa a la lista. También puedes usar **Usar listas gratis** y elegir países.
5. En Inicio pulsa **Ver Live**, **Películas** o **Series**.
6. En Live selecciona un canal; el video se coloca en el área de la derecha.
7. En una ficha de película/serie pulsa **Reproducir**; el video pasa a pantalla completa.
8. Botón **Atrás**: cierra el reproductor, sale de pantalla completa, cierra modales o
   navega a Inicio. Pulsa Atrás dos veces en Inicio para salir.

---

## 7. Rendimiento: decisiones clave

- **HTTP asíncrono**: `CapacitorHttp` evita CORS y no bloquea el hilo JS. Solo si falla se
  usa `fetch` y, como último recurso, el puente nativo síncrono.
- **M3U en Worker**: listas de más de 64 KB se parsean fuera del hilo principal.
- **Listas por bloques**: se insertan 60 elementos por vez; el resto se carga al hacer
  scroll o al llegar al borde con el D-Pad.
- **Foco espacial cacheado**: los rects se miden una vez por render y se reutilizan en
  cada pulsación; no hay `getComputedStyle` por elemento.
- **EPG bajo demanda**: solo se piden “ahora/después” para los canales visibles (máx. 18),
  con concurrencia 3, no para los 60 de golpe.
- **Caché de catálogo**: IndexedDB evita volver a descargar todo al abrir la app; TTL 15 min.
- **ExoPlayer reutilizado**: el plugin conserva instancia y `PlayerView`; cambiar de canal
  no recrea el reproductor.
- **Imágenes diferidas**: `loading="lazy"` y `decoding="async"` en posters/logos.
- **Logs por lote**: se agrupan y escriben cada 1.5 s, no en cada línea.

### Objetivos de aceptación

| Métrica | Objetivo |
|---|---|
| Primer contenido visible | < 1.5 s con caché |
| Render inicial de 5k canales | < 300 ms (60 visibles) |
| Cambio de categoría | < 150 ms |
| Búsqueda local | < 100 ms |
| Inicio de canal | < 2 s en red estable |
| Zapping | < 1.5 s |
| Memoria de la app | < 250 MB |
| Tarea de main thread | < 100 ms |

Mide con `adb shell dumpsys meminfo com.freeiptv.app`, Chrome DevTools remoto
(`chrome://inspect`) y los logs de la app.

---

## 8. Arquitectura de reproducción

1. `player.js` detecta si `window.Capacitor.Plugins.ExoPlayerPlugin` existe.
2. Si existe y el motor es `native`, llama a `play()` del plugin y coloca el `PlayerView`
   sobre la WebView con `setLayout({x,y,w,h})` en píxeles físicos.
3. En Live, el rect es el `player-stage`. En detalle, se usa pantalla completa.
4. Si ExoPlayer falla o no está disponible, se crea un overlay `<video>` con HLS.js.
5. Un fallo de formato HLS reintenta una vez con la extensión alternativa (`.ts`/`.m3u8`).
6. El progreso VOD se consulta cada 5 s y se guarda en `localStorage`.

El `PlayerView` nativo está por encima de la WebView: la UI web no puede dibujar controles
encima del video nativo. Por eso el control se hace con el mando (Atrás detiene) y el área
de video se reserva en el layout.

---

## 9. Almacenamiento y privacidad

- `localStorage` (`freeiptv.v2.small`): perfil, ajustes, favoritos, progreso y último canal.
- `IndexedDB` (`freeiptv_db`): catálogos normalizados por perfil.
- Logs: `Android/data/com.freeiptv.app/files/logs/app.log` (máx. 2 MB, rotación a `app_old.log`).
- No se envía telemetría ni datos a servidores propios.
- **Cerrar sesión** borra perfil, favoritos, progreso y catálogo local.

---

## 10. Limitaciones y notas

- El EPG es “ahora/después” por canal; no se descarga XMLTV completo.
- No hay catch-up, grabaciones, descargas ni multiscreen.
- La lista M3U se trata como live; no se detectan películas/series dentro de M3U.
- Algunos paneles devuelven URLs `.ts`; el reproductor reintenta automáticamente.
- El APK de depuración no está firmado para distribución. Genera tu propio release.
- En Android TV, el banner y los iconos están en `android/app/src/main/res/`.

---

## 11. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| “No se pudo conectar” en login | URL/puerto incorrectos o panel caído | Prueba `http://host:puerto/player_api.php?username=...&password=...` en el navegador |
| Error 401/403 | Credenciales o puerto | Revisa usuario/contraseña y que el panel permita el puerto |
| CORS en navegador | El panel no envía cabeceras CORS | Prueba en Android; allí `CapacitorHttp` evita CORS |
| Video negro pero audio | Códec no soportado por el dispositivo | Prueba motor HLS.js o un canal H.264/AAC |
| El mando no navega | Foco perdido tras un modal | Pulsa Atrás para cerrar el modal; el foco se restaura |
| La app no actualiza canales | Caché de 15 min | Ajustes → Actualizar, o Inicio → Actualizar catálogo |
| Gradle no encuentra SDK | `ANDROID_HOME` vacío | Define `ANDROID_HOME` como en la sección 3 |

---

## 12. Estado de la entrega

- Código web completo y validado con `node --check`.
- Assets sincronizados a `android/app/src/main/assets/public`.
- Build nativo verificado con `gradlew assembleDebug` (**BUILD SUCCESSFUL**).
- Pendiente de validación final: cuenta Xtream real con VOD/series y dispositivo/emulador
  Android TV para medir tiempos y códecs del panel.

Versión: **2.0.0** · `versionCode 40` · package **com.freeiptv.app**.

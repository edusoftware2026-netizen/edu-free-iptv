# Checklist de Publicación en Google Play Store — EDU-IPTV PRO

Estado actual verificado en el proyecto y pasos pendientes para subir a **Google Play Console**.

---

## 1. Lo que ya está listo en el proyecto
* **Android SDK:** `compileSdkVersion = 36`, `targetSdkVersion = 36`, `minSdkVersion = 24` (`android/variables.gradle`) — cumple con los requisitos actuales de Play Store.
* **Versionado:** `versionCode 42`, `versionName "1.0.0"` (`android/app/build.gradle`).
* **Soporte Android TV + Móvil:** `AndroidManifest.xml` incluye `LEANBACK_LAUNCHER`, `android:banner="@drawable/tv_banner"`, y `uses-feature` con `required="false"` para `touchscreen` y `television` (permite distribución unificada en móvil y TV).
* **Iconos y Banner:** Presentes en `android/app/src/main/res/mipmap-*` y `drawable/tv_banner.png`.
* **Textos legales creados:** `TERMS_AND_CONDITIONS.md` y `PRIVACY_POLICY.md` en la raíz del proyecto.

---

## 2. Lo que debes revisar / completar antes de compilar el Release

### A. Cambiar el `applicationId` si es necesario (Muy importante)
Actualmente en `android/app/build.gradle` y `capacitor.config.json` el ID es:
`com.freeiptv.app`
* En Google Play, el `applicationId` debe ser **único en toda la tienda** y una vez publicado **no se puede cambiar**.
* Si `com.freeiptv.app` ya existe en Play Store o prefieres reflejar el nombre actual, cámbialo por uno propio (ej. `com.eduardo.eduiptvpro`) en:
  1. `capacitor.config.json` (`appId`)
  2. `android/app/build.gradle` (`namespace` y `applicationId`)
  3. Carpeta Java en `android/app/src/main/java/...` y `MainActivity.java` / `ExoPlayerPlugin.java`

### B. Crear el Keystore y firmar el App Bundle (`.aab`)
Google Play **no acepta APKs de depuración**; exige un **Android App Bundle (`.aab`) firmado**.
1. Genera tu keystore (guárdalo en un lugar seguro; si lo pierdes, no podrás actualizar la app):
   ```powershell
   keytool -genkey -v -keystore edu-iptv-release.keystore -alias eduiptv -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Configura `signingConfigs` en `android/app/build.gradle` (sin subir las contraseñas a Git).
3. Sincroniza web y genera el `.aab`:
   ```powershell
   npx cap sync android
   cd android
   .\gradlew.bat bundleRelease
   ```
   El archivo quedará en: `android/app/build/outputs/bundle/release/app-release.aab`.

### C. Políticas de Google Play para Apps IPTV (Crítico para evitar rechazo)
Google Play revisa con especial rigor las apps IPTV:
1. **URL pública de Política de Privacidad:** Sube `PRIVACY_POLICY.md` (y `TERMS_AND_CONDITIONS.md`) a GitHub Pages, Vercel, Netlify o tu web y pega esa URL en Play Console → *Contenido de la aplicación → Política de privacidad*.
2. **Mostrar Términos y Política dentro de la app:** Es muy recomendable agregar un botón/modal de **"Términos y Privacidad"** en Login y Ajustes para que el revisor de Google lo vea dentro de la app.
3. **Capturas de pantalla limpias:** En las capturas que subas a Play Store, **NO muestres logos de canales de TV con copyright, ni películas/series comerciales reales** (usa pantallas de Login, Ajustes, o canales/títulos genéricos o de dominio público).
4. **Descripción en Play Store:** Aclara explícitamente que **EDU-IPTV PRO es solo un reproductor y no incluye canales ni contenido multimedia**, y que el usuario debe aportar sus propias listas legales.
5. **Revisión de "Listas gratis" (`iptv-org`):** Ten en cuenta que si la app descarga o enlaza listas públicas de terceros desde un botón integrado, algunos revisores de Google pueden pedirte justificar que no promueve contenido protegido por derechos de autor. Si te rechazan por eso, la solución rápida es dejar solo la entrada manual de URL M3U / Xtream.
6. **`usesCleartextTraffic="true"`:** Muchos servidores Xtream usan `http://` sin SSL, por eso está activo; funciona en Play Store, aunque en el formulario de seguridad de datos conviene tener claro que el tráfico hacia servidores externos depende de la URL que ingrese el usuario.

---

## 3. Requisitos de la ficha de Play Console
* **Cuenta de Google Play Console:** Verificada (las cuentas personales nuevas requieren **12 testers cerrados durante 14 días** antes de pasar a producción).
* **Assets gráficos obligatorios:**
  * Ícono de app: `512 × 512 px` (PNG 32-bit, sin transparencia).
  * Gráfico de funciones (*Feature Graphic*): `1024 × 500 px` (PNG/JPG).
  * Capturas de móvil: mínimo 2 (16:9 o 9:16).
  * **Si habilitas Android TV en Play Console:** Banner de TV (`1280 × 720 px`), capturas en `1920 × 1080 px` (16:9) y activar la distribución para Android TV en *Configuración avanzada → Factores de forma*.
* **Formularios de Play Console:**
  * *Seguridad de los datos (Data Safety):* Declarar que **no se recopilan ni comparten datos con terceros** (todo es local en el dispositivo).
  * *Clasificación de contenido (IARC):* Completar el cuestionario (generalmente resulta en Todos / 3+ o 12+ según funciones).
  * *Acceso a la app:* Si el revisor necesita probar la app más allá del Login, proporciona instrucciones claras (ej. cómo probar con una URL M3U de prueba de dominio público).

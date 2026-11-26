package com.freeiptv.app;

import android.content.Context;
import android.content.Intent;
import android.content.ComponentCallbacks2;
import android.provider.Settings;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import com.freeiptv.app.plugins.ExoPlayerPlugin;
import com.freeiptv.app.plugins.RemoteControlPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends BridgeActivity {

    private boolean bridgeInjected = false;
    private static final String LOG_DIR = "logs";
    private static final String LOG_FILE = "app.log";
    private static final long MAX_LOG_SIZE = 2 * 1024 * 1024; // 2 MB

    public boolean isTelevision() {
        try {
            android.app.UiModeManager uiModeManager = (android.app.UiModeManager) getSystemService(UI_MODE_SERVICE);
            if (uiModeManager != null && uiModeManager.getCurrentModeType() == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION) {
                return true;
            }
            android.content.pm.PackageManager pm = getPackageManager();
            if (pm != null && (pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK)
                    || pm.hasSystemFeature("android.hardware.type.television"))) {
                return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // El plugin debe registrarse ANTES de super.onCreate(): BridgeActivity
        // construye el Bridge (y carga los plugins) dentro de super.onCreate().
        this.registerPlugin(ExoPlayerPlugin.class);
        this.registerPlugin(RemoteControlPlugin.class);
        super.onCreate(savedInstanceState);
        
        // Garantizar que los botones físicos de volumen en móviles controlen el audio multimedia
        setVolumeControlStream(android.media.AudioManager.STREAM_MUSIC);

        try {
            if (isTelevision()) {
                setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            } else {
                setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            }
        } catch (Exception ignored) {}

        configureWebView();
        setupRenderProcessGoneListener();
        safeHideSystemUI();

        writeLog("INFO", "System", "EDU-IPTV PRO iniciado v" + getVersionName());
        writeLog("INFO", "System", "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
        writeLog("INFO", "System", "Modelo: " + Build.MODEL + " | " + Build.MANUFACTURER);
    }

    private String getVersionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "desconocida";
        }
    }

    private File logFile() {
        File dir = new File(getExternalFilesDir(null), LOG_DIR);
        if (!dir.exists()) dir.mkdirs();
        File file = new File(dir, LOG_FILE);
        if (file.exists() && file.length() > MAX_LOG_SIZE) {
            File old = new File(dir, "app_old.log");
            if (old.exists()) old.delete();
            file.renameTo(old);
        }
        return file;
    }

    @android.webkit.JavascriptInterface
    public void writeLog(String level, String tag, String message) {
        try {
            File file = logFile();
            String timestamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(new Date());
            String line = "[" + timestamp + "] [" + level + "] [" + tag + "] " + message + "\n";
            FileWriter fw = new FileWriter(file, true);
            fw.write(line);
            fw.close();
        } catch (Exception e) {
            android.util.Log.e("FreeIPTVLog", "Error escribiendo log: " + e.getMessage());
        }
    }

    /**
     * Escribe un lote completo en una sola apertura de archivo.
     * Evita el cuello de botella de abrir/cerrar el archivo por cada linea.
     */
    @android.webkit.JavascriptInterface
    public void writeLogBatch(String jsonArray) {
        try {
            JSONArray arr = new JSONArray(jsonArray);
            if (arr.length() == 0) return;
            File file = logFile();
            FileWriter fw = new FileWriter(file, true);
            for (int i = 0; i < arr.length(); i++) {
                fw.write(arr.optString(i, ""));
                fw.write("\n");
            }
            fw.close();
        } catch (Exception e) {
            android.util.Log.e("FreeIPTVLog", "Error escribiendo lote: " + e.getMessage());
        }
    }

    @android.webkit.JavascriptInterface
    public String getLogPath() {
        try {
            return logFile().getAbsolutePath();
        } catch (Exception e) {
            return "Desconocida";
        }
    }

    @android.webkit.JavascriptInterface
    public String readLog() {
        try {
            File file = logFile();
            if (!file.exists()) return "";
            StringBuilder sb = new StringBuilder();
            java.io.BufferedReader br = new java.io.BufferedReader(new java.io.FileReader(file));
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append("\n");
            br.close();
            return sb.toString();
        } catch (Exception e) {
            return "ERROR leyendo log: " + e.getMessage();
        }
    }

    @android.webkit.JavascriptInterface
    public void clearLog() {
        try {
            File file = logFile();
            if (file.exists()) file.delete();
        } catch (Exception ignored) {}
    }

    @android.webkit.JavascriptInterface
    public String getDeviceInfo() {
        try {
            JSONObject o = new JSONObject();
            o.put("model", Build.MODEL);
            o.put("manufacturer", Build.MANUFACTURER);
            o.put("android", Build.VERSION.RELEASE);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("version", getVersionName());
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @Override
    public void onBackPressed() {
        try {
            com.getcapacitor.PluginHandle handle = getBridge().getPlugin("ExoPlayerPlugin");
            if (handle != null) {
                ExoPlayerPlugin plugin = (ExoPlayerPlugin) handle.getInstance();
                if (plugin != null && plugin.isPlayerActiveAndVisible()) {
                    if (plugin.isFullscreen()) {
                        plugin.requestExitFullscreen();
                        return;
                    }
                }
            }
        } catch (Exception ignored) {}
        super.onBackPressed();
    }

    @Override
    public boolean onKeyDown(int keyCode, android.view.KeyEvent event) {
        if (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP || keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN) {
            try {
                android.media.AudioManager am = (android.media.AudioManager) getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    int direction = (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP)
                            ? android.media.AudioManager.ADJUST_RAISE
                            : android.media.AudioManager.ADJUST_LOWER;
                    am.adjustStreamVolume(android.media.AudioManager.STREAM_MUSIC, direction, android.media.AudioManager.FLAG_SHOW_UI);
                    return true;
                }
            } catch (Exception ignored) {}
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onResume() {
        super.onResume();
        safeHideSystemUI();
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().onResume();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onPause() {
        super.onPause();
        pauseWebPlayer();
    }

    @Override
    public void onStop() {
        super.onStop();
        pauseWebPlayer();
    }

    private void pauseWebPlayer() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(
                    "if (window.Player && typeof Player.pauseForExternal === 'function') { Player.pauseForExternal(); }",
                    null
                );
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) safeHideSystemUI();
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        // No limpiamos cache en niveles bajos: eso obliga a re-descargar logos y catalogos.
        if (level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE) {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().clearCache(true);
                }
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onDestroy() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                webView.loadUrl("about:blank");
                webView.clearHistory();
            }
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    private void safeHideSystemUI() {
        try {
            Window window = getWindow();
            if (window == null) return;
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

            View decorView = window.getDecorView();
            if (decorView != null) {
                decorView.post(() -> {
                    try {
                        WindowCompat.setDecorFitsSystemWindows(window, false);
                        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(window, decorView);
                        controller.hide(WindowInsetsCompat.Type.systemBars());
                        controller.setSystemBarsBehavior(
                            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                        );
                    } catch (Exception ignored) {}
                });
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void setupRenderProcessGoneListener() {
        try {
            if (getBridge() != null) {
                getBridge().addWebViewListener(new WebViewListener() {
                    @Override
                    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                        writeLog("ERROR", "Renderer", "Render process crashed. didCrash=" +
                                (detail != null && detail.didCrash()));
                        try { view.destroy(); } catch (Exception ignored) {}
                        new android.os.Handler(android.os.Looper.getMainLooper()).post(MainActivity.this::recreate);
                        return true;
                    }
                });
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void configureWebView() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                webView.setBackgroundColor(Color.BLACK);

                WebSettings settings = webView.getSettings();
                settings.setJavaScriptEnabled(true);
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setAllowFileAccess(true);
                settings.setAllowContentAccess(true);
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                settings.setMediaPlaybackRequiresUserGesture(false);
                settings.setCacheMode(WebSettings.LOAD_DEFAULT);
                settings.setJavaScriptCanOpenWindowsAutomatically(false);
                settings.setSupportMultipleWindows(false);
                settings.setLoadWithOverviewMode(false);
                settings.setUseWideViewPort(false);
                settings.setTextZoom(100);
                settings.setAllowFileAccessFromFileURLs(false);
                settings.setAllowUniversalAccessFromFileURLs(false);

                webView.setFocusable(true);
                webView.setFocusableInTouchMode(true);
                webView.requestFocus();

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    WebView.setWebContentsDebuggingEnabled(true);
                }

                if (!bridgeInjected) {
                    webView.addJavascriptInterface(new Object() {

                        @android.webkit.JavascriptInterface
                        public void exitApp() {
                            runOnUiThread(() -> {
                                try {
                                    finishAffinity();
                                    android.os.Process.killProcess(android.os.Process.myPid());
                                    System.exit(0);
                                } catch (Exception ignored) {
                                    System.exit(0);
                                }
                            });
                        }

                        @android.webkit.JavascriptInterface
                        public void openExternalPlayer(String url, String title) {
                            runOnUiThread(() -> {
                                try {
                                    pauseWebPlayer();
                                    android.content.Intent intent =
                                        new android.content.Intent(android.content.Intent.ACTION_VIEW);
                                    intent.setDataAndType(android.net.Uri.parse(url), "video/*");
                                    intent.putExtra("title", title);
                                    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                                    startActivity(android.content.Intent.createChooser(intent, "Reproducir con:"));
                                } catch (Exception e) {
                                    writeLog("ERROR", "Player", "Error abriendo externo: " + e.getMessage());
                                    android.widget.Toast.makeText(
                                        MainActivity.this,
                                        "Instala VLC o MX Player para reproducir formatos externos.",
                                        android.widget.Toast.LENGTH_LONG
                                    ).show();
                                }
                            });
                        }

                        /**
                         * Fallback sincrono. La app usa CapacitorHttp como via principal.
                         */
                        @android.webkit.JavascriptInterface
                        public String fetchUrl(String urlString, String userAgent, int timeoutMs) {
                            final long MAX_BYTES = 64L * 1024L * 1024L;
                            try {
                                java.net.URL url = new java.net.URL(urlString);
                                java.net.HttpURLConnection conn =
                                    (java.net.HttpURLConnection) url.openConnection();
                                conn.setRequestMethod("GET");
                                conn.setRequestProperty("User-Agent",
                                    (userAgent != null && !userAgent.isEmpty())
                                        ? userAgent
                                        : "Free-IPTV-Pro/2.0");
                                conn.setConnectTimeout(timeoutMs > 0 ? timeoutMs : 25000);
                                conn.setReadTimeout(timeoutMs > 0 ? timeoutMs : 25000);
                                conn.setInstanceFollowRedirects(true);

                                int responseCode = conn.getResponseCode();
                                java.io.InputStream inputStream =
                                    (responseCode >= 200 && responseCode < 300)
                                        ? conn.getInputStream()
                                        : conn.getErrorStream();

                                if (inputStream == null) {
                                    writeLog("ERROR", "Network", "HTTP " + responseCode);
                                    return "ERROR: HTTP " + responseCode;
                                }

                                java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream(16384);
                                byte[] buffer = new byte[8192];
                                int read;
                                long totalBytes = 0;
                                while ((read = inputStream.read(buffer)) != -1) {
                                    totalBytes += read;
                                    if (totalBytes > MAX_BYTES) {
                                        inputStream.close();
                                        baos.close();
                                        return "ERROR: LISTA DEMASIADO GRANDE (>64MB).";
                                    }
                                    baos.write(buffer, 0, read);
                                }
                                inputStream.close();
                                return baos.toString("UTF-8");
                            } catch (Exception e) {
                                writeLog("ERROR", "Network", "Error fetching: " + e.getMessage());
                                return "ERROR: " + e.getMessage();
                            }
                        }

                        @android.webkit.JavascriptInterface
                        public void log(String level, String tag, String message) {
                            writeLog(level, tag, message);
                        }

                        @android.webkit.JavascriptInterface
                        public void writeLogBatch(String json) {
                            MainActivity.this.writeLogBatch(json);
                        }

                        @android.webkit.JavascriptInterface
                        public String getLogPath() {
                            return MainActivity.this.getLogPath();
                        }

                        @android.webkit.JavascriptInterface
                        public String readLog() {
                            return MainActivity.this.readLog();
                        }

                        @android.webkit.JavascriptInterface
                        public void clearLog() {
                            MainActivity.this.clearLog();
                        }

                        @android.webkit.JavascriptInterface
                        public String getClipboardText() {
                            try {
                                android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                                if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
                                    android.content.ClipData.Item item = cm.getPrimaryClip().getItemAt(0);
                                    CharSequence text = item.coerceToText(MainActivity.this);
                                    return text != null ? text.toString() : "";
                                }
                            } catch (Exception ignored) {}
                            return "";
                        }

                        @android.webkit.JavascriptInterface
                        public void setClipboardText(String text) {
                            runOnUiThread(() -> {
                                try {
                                    android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                                    if (cm != null) {
                                        android.content.ClipData clip = android.content.ClipData.newPlainText("EDU-IPTV", text != null ? text : "");
                                        cm.setPrimaryClip(clip);
                                    }
                                } catch (Exception ignored) {}
                            });
                        }

                        @android.webkit.JavascriptInterface
                        public String getDeviceInfo() {
                            return MainActivity.this.getDeviceInfo();
                        }

                        @android.webkit.JavascriptInterface
                        public boolean isTelevision() {
                            return MainActivity.this.isTelevision();
                        }

                        @android.webkit.JavascriptInterface
                        public boolean isWifiConnected() {
                            try {
                                android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                                if (cm != null) {
                                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                        android.net.Network net = cm.getActiveNetwork();
                                        if (net != null) {
                                            android.net.NetworkCapabilities caps = cm.getNetworkCapabilities(net);
                                            return caps != null && caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI);
                                        }
                                    } else {
                                        android.net.NetworkInfo ni = cm.getNetworkInfo(android.net.ConnectivityManager.TYPE_WIFI);
                                        return ni != null && ni.isConnected();
                                    }
                                }
                            } catch (Exception ignored) {}
                            return false;
                        }

                        @android.webkit.JavascriptInterface
                        public boolean canCast() {
                            return !MainActivity.this.isTelevision();
                        }

                        @android.webkit.JavascriptInterface
                        public boolean openCastSettings() {
                            try {
                                Intent intent = new Intent(Settings.ACTION_CAST_SETTINGS);
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(intent);
                                return true;
                            } catch (Exception e1) {
                                try {
                                    Intent intent = new Intent("android.settings.WIFI_DISPLAY_SETTINGS");
                                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                    startActivity(intent);
                                    return true;
                                } catch (Exception e2) {
                                    try {
                                        Intent intent = new Intent(Settings.ACTION_DISPLAY_SETTINGS);
                                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                        startActivity(intent);
                                        return true;
                                    } catch (Exception e3) {
                                        return false;
                                    }
                                }
                            }
                        }

                        @android.webkit.JavascriptInterface
                        public void setOrientation(String mode) {
                            runOnUiThread(() -> {
                                try {
                                    if (MainActivity.this.isTelevision()) return;
                                    if ("landscape".equalsIgnoreCase(mode)) {
                                        setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                                    } else if ("portrait".equalsIgnoreCase(mode)) {
                                        setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
                                    } else {
                                        setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                                    }
                                } catch (Exception ignored) {}
                            });
                        }
                    }, "AndroidNativeApp");
                    bridgeInjected = true;
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}

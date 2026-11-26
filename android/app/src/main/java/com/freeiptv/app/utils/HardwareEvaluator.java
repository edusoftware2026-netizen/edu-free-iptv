package com.freeiptv.app.utils;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Evaluador de capacidades de hardware y deteccion de reproductores externos.
 * Valora si el dispositivo soporta decodificacion de video H.264 por hardware
 * a una Surface y detecta arquitecturas como x86/x86_64 o TV Boxes con codecs rotos.
 */
public class HardwareEvaluator {

    private static final String TAG = "HardwareEvaluator";

    // Reproductores recomendados por orden de compatibilidad y calidad de decodificacion
    public static final String PKG_VLC = "org.videolan.vlc";
    public static final String PKG_MX_FREE = "com.mxtech.videoplayer.ad";
    public static final String PKG_MX_PRO = "com.mxtech.videoplayer.pro";
    public static final String PKG_JUST_PLAYER = "com.brouken.player";
    public static final String PKG_MPV = "is.xyz.mpv";
    public static final String PKG_NOVA = "org.courville.nova";

    /**
     * Evalua el hardware del dispositivo y devuelve un reporte detallado.
     */
    public static JSObject evaluate(Context context) {
        JSObject result = new JSObject();
        try {
            String primaryAbi = Build.SUPPORTED_ABIS != null && Build.SUPPORTED_ABIS.length > 0 
                    ? Build.SUPPORTED_ABIS[0] : "unknown";
            boolean isX86 = primaryAbi.toLowerCase(Locale.ROOT).contains("x86");
            for (String abi : Build.SUPPORTED_ABIS) {
                if (abi.toLowerCase(Locale.ROOT).contains("x86")) {
                    isX86 = true;
                    break;
                }
            }

            // Analisis de decodificadores de video disponibles
            boolean hasH264Hw = false;
            boolean hasH264Surface = false;
            List<String> h264Decoders = new ArrayList<>();

            try {
                MediaCodecList mcl = new MediaCodecList(MediaCodecList.REGULAR_CODECS);
                for (MediaCodecInfo mci : mcl.getCodecInfos()) {
                    if (mci.isEncoder()) continue;
                    for (String type : mci.getSupportedTypes()) {
                        if ("video/avc".equalsIgnoreCase(type)) {
                            h264Decoders.add(mci.getName());
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                                if (mci.isHardwareAccelerated()) {
                                    hasH264Hw = true;
                                }
                            } else {
                                String name = mci.getName().toLowerCase(Locale.ROOT);
                                if (!name.startsWith("omx.google.") && !name.startsWith("c2.android.")) {
                                    hasH264Hw = true;
                                }
                            }

                            try {
                                MediaCodecInfo.CodecCapabilities caps = mci.getCapabilitiesForType("video/avc");
                                if (caps != null && caps.colorFormats != null) {
                                    for (int color : caps.colorFormats) {
                                        // 0x7f000789 = COLOR_FormatSurface
                                        if (color == MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface) {
                                            hasH264Surface = true;
                                            break;
                                        }
                                    }
                                }
                            } catch (Exception ignored) {}
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Error consultando MediaCodecList", e);
            }

            // Determinacion de limitaciones de hardware
            // En x86_64 o dispositivos sin decodificador por hardware con soporte Surface,
            // ExoPlayer suele fallar con 'gralloc-mapper is missing' o 4003 DECODING_FAILED.
            boolean isHardwareLimited = isX86 || !hasH264Hw || !hasH264Surface;

            result.put("primaryAbi", primaryAbi);
            result.put("supportedAbis", new JSArray(Arrays.asList(Build.SUPPORTED_ABIS)));
            result.put("isX86", isX86);
            result.put("model", Build.MODEL);
            result.put("manufacturer", Build.MANUFACTURER);
            result.put("sdkInt", Build.VERSION.SDK_INT);
            result.put("hasH264Hardware", hasH264Hw);
            result.put("hasH264Surface", hasH264Surface);
            result.put("h264Decoders", new JSArray(h264Decoders));
            result.put("isHardwareLimited", isHardwareLimited);
            result.put("recommendedEngine", isHardwareLimited ? "external" : "native");

            String statusLabel;
            String statusDetail;
            if (isHardwareLimited) {
                statusLabel = "Hardware con decodificador limitado";
                statusDetail = isX86 
                        ? "Arquitectura x86 detectada. Se recomienda Reproductor Externo (VLC) para video fluido sin fallos de códec."
                        : "El decodificador interno de video carece de aceleración completa. Recomendado Reproductor Externo.";
            } else {
                statusLabel = "Aceleración de video estándar";
                statusDetail = "El dispositivo cuenta con decodificación de video por hardware compatible con ExoPlayer.";
            }

            result.put("statusLabel", statusLabel);
            result.put("statusDetail", statusDetail);

            // Reproductores externos instalados
            JSArray players = getInstalledPlayers(context);
            result.put("installedPlayers", players);
            result.put("hasExternalPlayer", players.length() > 0);

        } catch (Exception e) {
            Log.e(TAG, "Error evaluando hardware", e);
            result.put("error", e.getMessage());
            result.put("isHardwareLimited", false);
            result.put("recommendedEngine", "native");
        }
        return result;
    }

    /**
     * Retorna la lista de reproductores de video instalados.
     */
    public static JSArray getInstalledPlayers(Context context) {
        JSArray list = new JSArray();
        if (context == null) return list;
        PackageManager pm = context.getPackageManager();

        Intent testIntent = new Intent(Intent.ACTION_VIEW);
        testIntent.setDataAndType(Uri.parse("http://example.com/stream.mp4"), "video/*");

        List<ResolveInfo> matches = pm.queryIntentActivities(testIntent, PackageManager.MATCH_DEFAULT_ONLY);
        if (matches != null) {
            for (ResolveInfo info : matches) {
                if (info.activityInfo == null) continue;
                String pkg = info.activityInfo.packageName;
                if (context.getPackageName().equals(pkg)) continue; // Ignorar a nosotros mismos

                JSObject playerObj = new JSObject();
                playerObj.put("packageName", pkg);
                CharSequence label = info.loadLabel(pm);
                playerObj.put("name", label != null ? label.toString() : pkg);
                playerObj.put("isVlc", PKG_VLC.equals(pkg));
                playerObj.put("isMx", PKG_MX_FREE.equals(pkg) || PKG_MX_PRO.equals(pkg));
                playerObj.put("isRecommended", PKG_VLC.equals(pkg) || PKG_MX_FREE.equals(pkg) || PKG_MX_PRO.equals(pkg) || PKG_JUST_PLAYER.equals(pkg));
                list.put(playerObj);
            }
        }

        // Chequeo directo de reproductores conocidos para garantizar detección en Android 11+
        String[] knownPackages = new String[] {
            PKG_VLC, PKG_MX_FREE, PKG_MX_PRO, PKG_JUST_PLAYER, PKG_MPV, PKG_NOVA
        };
        for (String pkg : knownPackages) {
            try {
                android.content.pm.PackageInfo pi = pm.getPackageInfo(pkg, 0);
                if (pi != null && pi.applicationInfo != null) {
                    boolean alreadyAdded = false;
                    for (int i = 0; i < list.length(); i++) {
                        org.json.JSONObject item = list.optJSONObject(i);
                        if (item != null && pkg.equals(item.optString("packageName"))) {
                            alreadyAdded = true;
                            break;
                        }
                    }
                    if (!alreadyAdded) {
                        JSObject playerObj = new JSObject();
                        playerObj.put("packageName", pkg);
                        CharSequence label = pm.getApplicationLabel(pi.applicationInfo);
                        playerObj.put("name", label != null ? label.toString() : pkg);
                        playerObj.put("isVlc", PKG_VLC.equals(pkg));
                        playerObj.put("isMx", PKG_MX_FREE.equals(pkg) || PKG_MX_PRO.equals(pkg));
                        playerObj.put("isRecommended", true);
                        list.put(playerObj);
                    }
                }
            } catch (Exception ignored) {}
        }

        return list;
    }

    /**
     * Construye un Intent configurado con todas las cabeceras y metadata IPTV
     * compatible con VLC, MX Player, Just Player y otros reproductores.
     */
    public static Intent buildExternalPlayerIntent(Context context, String url, String title, Map<String, String> headers, String targetPackage) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        Uri uri = Uri.parse(url);
        intent.setDataAndType(uri, "video/*");

        // Metadata estándar
        intent.putExtra("title", title != null ? title : "Transmisión");
        intent.putExtra("android.intent.extra.TITLE", title != null ? title : "Transmisión");
        intent.putExtra("secure_uri", true);

        // Cabeceras HTTP
        if (headers != null && !headers.isEmpty()) {
            List<String> headerList = new ArrayList<>();
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                if (entry.getKey() != null && entry.getValue() != null) {
                    headerList.add(entry.getKey() + ": " + entry.getValue());
                }
            }
            String[] headersArray = headerList.toArray(new String[0]);
            intent.putExtra("headers", headersArray);

            if (headers.containsKey("User-Agent")) {
                String ua = headers.get("User-Agent");
                intent.putExtra("User-Agent", ua);
                intent.putExtra("user_agent", ua);
            }
            if (headers.containsKey("Referer")) {
                intent.putExtra("Referer", headers.get("Referer"));
            }
        }

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        if (targetPackage != null && !targetPackage.isEmpty() 
                && !"auto".equalsIgnoreCase(targetPackage) 
                && !"chooser".equalsIgnoreCase(targetPackage)) {
            intent.setPackage(targetPackage);
        } else if ("auto".equalsIgnoreCase(targetPackage) || targetPackage == null) {
            // Si VLC está instalado, preferir VLC automáticamente para garantizar software decoding
            try {
                context.getPackageManager().getPackageInfo(PKG_VLC, 0);
                intent.setPackage(PKG_VLC);
            } catch (Exception ignored) {
                // VLC no instalado, intent genérico o chooser
            }
        }

        return intent;
    }
}

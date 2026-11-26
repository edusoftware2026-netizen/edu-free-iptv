package com.freeiptv.app.plugins;

import android.content.Context;
import android.content.Intent;
import android.app.Activity;
import android.media.AudioManager;
import android.view.WindowManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Log;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.RelativeLayout;
import android.widget.TextView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.freeiptv.app.utils.HardwareEvaluator;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo;
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector;
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Reproductor nativo basado en Media3 / ExoPlayer.
 *
 * Optimizado para zapping:
 *  - reutiliza la instancia del player y la vista,
 *  - no recrea el PlayerView en cada canal,
 *  - expone setLayout para colocar el video en el area de la UI,
 *  - soporta HLS, progresivo, AC-3/E-AC-3 y pistas multiples.
 */
@CapacitorPlugin(name = "ExoPlayerPlugin")
public class ExoPlayerPlugin extends Plugin {

    private static final String TAG = "ExoPlayerPlugin";
    private static final String DEFAULT_USER_AGENT = "IPTVSmartersPro/2.4.0 (Linux; Android 11; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.0.0 Safari/537.36";

    private ExoPlayer player;
    private PlayerView playerView;
    private DefaultTrackSelector trackSelector;
    private Context context;
    private int bufferSeconds = 30;
    private boolean listenersAttached = false;
    private RelativeLayout topOverlay;
    private TextView vodTitleView;
    private TextView nativeHudToast;
    private boolean isCurrentLive = false;
    private boolean videoFallbackAttempted = false;
    private String currentUrl;
    private String currentTitle;
    private Map<String, String> currentHeaders = new HashMap<>();
    private final Handler overlayHandler = new Handler(Looper.getMainLooper());

    private final Runnable hideOverlayRunnable = new Runnable() {
        @Override
        public void run() {
            if (topOverlay != null && topOverlay.getVisibility() == View.VISIBLE) {
                topOverlay.animate()
                        .alpha(0f)
                        .setDuration(280)
                        .withEndAction(() -> {
                            if (topOverlay != null) {
                                topOverlay.setVisibility(View.GONE);
                                topOverlay.setAlpha(1f);
                            }
                        })
                        .start();
            }
        }
    };

    private final Runnable hideHudToastRunnable = new Runnable() {
        @Override
        public void run() {
            if (nativeHudToast != null && nativeHudToast.getVisibility() == View.VISIBLE) {
                nativeHudToast.animate()
                        .alpha(0f)
                        .setDuration(250)
                        .withEndAction(() -> {
                            if (nativeHudToast != null) {
                                nativeHudToast.setVisibility(View.GONE);
                                nativeHudToast.setAlpha(1f);
                            }
                        })
                        .start();
            }
        }
    };

    public void showTopOverlayBriefly(long durationMs) {
        if (getActivity() == null) return;
        getActivity().runOnUiThread(() -> {
            if (topOverlay == null) return;
            overlayHandler.removeCallbacks(hideOverlayRunnable);
            topOverlay.animate().cancel();
            topOverlay.setAlpha(1f);
            topOverlay.setVisibility(View.VISIBLE);
            topOverlay.bringToFront();
            if (durationMs > 0) {
                overlayHandler.postDelayed(hideOverlayRunnable, durationMs);
            }
        });
    }

    public void hideTopOverlay() {
        if (getActivity() == null) return;
        getActivity().runOnUiThread(() -> {
            if (topOverlay == null) return;
            overlayHandler.removeCallbacks(hideOverlayRunnable);
            hideOverlayRunnable.run();
        });
    }

    public void toggleTopOverlay() {
        if (topOverlay == null) return;
        if (topOverlay.getVisibility() == View.VISIBLE && topOverlay.getAlpha() > 0.5f) {
            hideTopOverlay();
        } else {
            showTopOverlayBriefly(3000);
        }
    }

    private void ensureNativeHudToast() {
        if (nativeHudToast != null) return;
        if (getActivity() == null || bridge == null || bridge.getWebView() == null) return;
        ViewGroup rootView = (ViewGroup) bridge.getWebView().getParent();
        if (rootView == null) return;

        nativeHudToast = new TextView(getContext());
        nativeHudToast.setTextSize(13);
        nativeHudToast.setTypeface(null, Typeface.BOLD);
        nativeHudToast.setPadding(dp(22), dp(10), dp(22), dp(10));
        nativeHudToast.setGravity(Gravity.CENTER);
        nativeHudToast.setElevation(dp(40));
        nativeHudToast.setClickable(false);
        nativeHudToast.setFocusable(false);

        ViewGroup.LayoutParams genericLp;
        if (rootView instanceof androidx.coordinatorlayout.widget.CoordinatorLayout) {
            androidx.coordinatorlayout.widget.CoordinatorLayout.LayoutParams lp =
                    new androidx.coordinatorlayout.widget.CoordinatorLayout.LayoutParams(
                            ViewGroup.LayoutParams.WRAP_CONTENT,
                            ViewGroup.LayoutParams.WRAP_CONTENT
                    );
            lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
            lp.bottomMargin = dp(46);
            genericLp = lp;
        } else {
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT
            );
            lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
            lp.bottomMargin = dp(46);
            genericLp = lp;
        }
        nativeHudToast.setLayoutParams(genericLp);
        nativeHudToast.setVisibility(View.GONE);

        rootView.addView(nativeHudToast);
    }

    public void showHudToast(String message, String type) {
        showHudToast(message, type, 2400);
    }

    private boolean isTelevision() {
        try {
            android.app.UiModeManager uiModeManager = (android.app.UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
            if (uiModeManager != null && uiModeManager.getCurrentModeType() == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION) {
                return true;
            }
            android.content.pm.PackageManager pm = getContext().getPackageManager();
            if (pm != null && (pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK)
                    || pm.hasSystemFeature("android.hardware.type.television"))) {
                return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    public void showHudToast(String message, String type, long durationMs) {
        if (getActivity() == null || message == null || message.trim().isEmpty()) return;
        final String cleanMsg = message.trim();
        final long timeout = durationMs > 0 ? durationMs : 2400;
        getActivity().runOnUiThread(() -> {
            ensureNativeHudToast();
            if (nativeHudToast == null) return;
            overlayHandler.removeCallbacks(hideHudToastRunnable);
            nativeHudToast.animate().cancel();
            nativeHudToast.setText(cleanMsg);

            GradientDrawable toastBg = new GradientDrawable();
            toastBg.setCornerRadius(dp(22));
            if ("error".equals(type)) {
                toastBg.setColor(Color.parseColor("#EE221016"));
                toastBg.setStroke(dp(1), Color.parseColor("#FF4D6D"));
                nativeHudToast.setTextColor(Color.parseColor("#FFC2CD"));
            } else if ("ok".equals(type)) {
                toastBg.setColor(Color.parseColor("#EE0D1E16"));
                toastBg.setStroke(dp(1), Color.parseColor("#22C55E"));
                nativeHudToast.setTextColor(Color.parseColor("#B7F7CB"));
            } else {
                toastBg.setColor(Color.parseColor("#EE0D1726"));
                toastBg.setStroke(dp(1), Color.parseColor("#00F3FF"));
                nativeHudToast.setTextColor(Color.parseColor("#BFFBFF"));
            }
            nativeHudToast.setBackground(toastBg);
            nativeHudToast.setAlpha(1f);
            nativeHudToast.setVisibility(View.VISIBLE);
            nativeHudToast.bringToFront();
            overlayHandler.postDelayed(hideHudToastRunnable, timeout);
        });
    }

    @Override
    public void load() {
        context = getContext().getApplicationContext();
    }

    private int dp(int value) {
        float density = getContext().getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }

    private void createTopBarOverlay() {
        if (topOverlay != null || playerView == null) return;

        topOverlay = new RelativeLayout(getContext());
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
        );
        lp.gravity = Gravity.TOP;
        topOverlay.setLayoutParams(lp);

        int padH = dp(16);
        int padV = dp(14);
        topOverlay.setPadding(padH, padV, padH, padV);

        GradientDrawable bg = new GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                new int[] { Color.parseColor("#E605050A"), Color.TRANSPARENT }
        );
        topOverlay.setBackground(bg);

        // Boton Salir de reproduccion
        TextView exitBtn = new TextView(getContext());
        exitBtn.setId(View.generateViewId());
        exitBtn.setText("← Salir");
        exitBtn.setTextSize(15);
        exitBtn.setTextColor(Color.WHITE);
        exitBtn.setTypeface(null, Typeface.BOLD);
        exitBtn.setPadding(dp(16), dp(8), dp(16), dp(8));
        exitBtn.setMinimumWidth(dp(54));
        exitBtn.setMinimumHeight(dp(44));
        exitBtn.setGravity(Gravity.CENTER);

        GradientDrawable btnBg = new GradientDrawable();
        btnBg.setColor(Color.parseColor("#99141824"));
        btnBg.setCornerRadius(dp(20));
        btnBg.setStroke(dp(1), Color.parseColor("#8800F3FF"));
        exitBtn.setBackground(btnBg);

        RelativeLayout.LayoutParams exitLp = new RelativeLayout.LayoutParams(
                RelativeLayout.LayoutParams.WRAP_CONTENT,
                RelativeLayout.LayoutParams.WRAP_CONTENT
        );
        exitLp.addRule(RelativeLayout.ALIGN_PARENT_LEFT);
        exitLp.addRule(RelativeLayout.CENTER_VERTICAL);
        exitBtn.setLayoutParams(exitLp);

        exitBtn.setOnClickListener(v -> {
            if (isCurrentLive) {
                JSObject data = new JSObject();
                data.put("action", "exitFullscreen");
                notifyListeners("exitFullscreen", data);
            } else {
                stopPlaybackFromNative("user_exit");
            }
        });

        // Boton Reproductor Externo (VLC / MX)
        TextView extBtn = new TextView(getContext());
        extBtn.setId(View.generateViewId());
        extBtn.setText("↗ Abrir en VLC");
        extBtn.setTextSize(14);
        extBtn.setTextColor(Color.WHITE);
        extBtn.setTypeface(null, Typeface.BOLD);
        extBtn.setPadding(dp(14), dp(8), dp(14), dp(8));
        extBtn.setMinimumHeight(dp(44));
        extBtn.setGravity(Gravity.CENTER);

        GradientDrawable extBtnBg = new GradientDrawable();
        extBtnBg.setColor(Color.parseColor("#99141824"));
        extBtnBg.setCornerRadius(dp(20));
        extBtnBg.setStroke(dp(1), Color.parseColor("#88FF9800"));
        extBtn.setBackground(extBtnBg);

        RelativeLayout.LayoutParams extLp = new RelativeLayout.LayoutParams(
                RelativeLayout.LayoutParams.WRAP_CONTENT,
                RelativeLayout.LayoutParams.WRAP_CONTENT
        );
        extLp.addRule(RelativeLayout.ALIGN_PARENT_RIGHT);
        extLp.addRule(RelativeLayout.CENTER_VERTICAL);
        extBtn.setLayoutParams(extLp);

        extBtn.setOnClickListener(v -> {
            if (currentUrl != null && !currentUrl.isEmpty()) {
                showHudToast("↗ Abriendo reproductor externo...", "info");
                try {
                    Intent intent = HardwareEvaluator.buildExternalPlayerIntent(
                            getContext(), currentUrl, currentTitle, currentHeaders, "auto"
                    );
                    getContext().startActivity(intent);
                } catch (Exception ex) {
                    try {
                        Intent intent = HardwareEvaluator.buildExternalPlayerIntent(
                                getContext(), currentUrl, currentTitle, currentHeaders, "chooser"
                        );
                        Intent chooser = Intent.createChooser(intent, "Reproducir con...");
                        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getContext().startActivity(chooser);
                    } catch (Exception ignored) {}
                }
            }
        });

        // Titulo del contenido
        vodTitleView = new TextView(getContext());
        vodTitleView.setTextSize(15);
        vodTitleView.setTextColor(Color.WHITE);
        vodTitleView.setTypeface(null, Typeface.BOLD);
        vodTitleView.setSingleLine(true);
        vodTitleView.setEllipsize(TextUtils.TruncateAt.END);
        vodTitleView.setPadding(dp(16), 0, dp(16), 0);

        RelativeLayout.LayoutParams titleLp = new RelativeLayout.LayoutParams(
                RelativeLayout.LayoutParams.MATCH_PARENT,
                RelativeLayout.LayoutParams.WRAP_CONTENT
        );
        titleLp.addRule(RelativeLayout.RIGHT_OF, exitBtn.getId());
        titleLp.addRule(RelativeLayout.LEFT_OF, extBtn.getId());
        titleLp.addRule(RelativeLayout.CENTER_VERTICAL);
        vodTitleView.setLayoutParams(titleLp);

        topOverlay.addView(exitBtn);
        topOverlay.addView(extBtn);
        topOverlay.addView(vodTitleView);
        topOverlay.setOnClickListener(v -> hideTopOverlay());

        playerView.addView(topOverlay);
        topOverlay.setVisibility(View.GONE);
    }

    public void stopPlaybackFromNative(String reason) {
        getActivity().runOnUiThread(() -> {
            try {
                overlayHandler.removeCallbacks(hideOverlayRunnable);
                overlayHandler.removeCallbacks(hideHudToastRunnable);
                if (player != null) {
                    player.stop();
                    player.clearMediaItems();
                }
                if (playerView != null) {
                    playerView.setVisibility(View.GONE);
                }
                if (topOverlay != null) {
                    topOverlay.setVisibility(View.GONE);
                }
                if (nativeHudToast != null) {
                    nativeHudToast.setVisibility(View.GONE);
                }
                JSObject data = new JSObject();
                data.put("reason", reason);
                notifyListeners("playerClosed", data);
                notifyListeners("playbackEnded", data);
            } catch (Exception e) {
                Log.e(TAG, "Error stopping from native", e);
            }
        });
    }

    public boolean isPlayerActiveAndVisible() {
        return playerView != null && playerView.getVisibility() == View.VISIBLE && player != null;
    }

    public boolean isFullscreen() {
        if (!isPlayerActiveAndVisible()) return false;
        ViewGroup.LayoutParams lp = playerView.getLayoutParams();
        if (lp != null && (lp.width == ViewGroup.LayoutParams.MATCH_PARENT || lp.width < 0)) return true;
        if (getActivity() == null) return false;
        int screenW = getActivity().getWindow().getDecorView().getWidth();
        return screenW > 0 && playerView.getWidth() >= screenW - 100;
    }

    public void requestExitFullscreen() {
        getActivity().runOnUiThread(() -> {
            JSObject data = new JSObject();
            data.put("action", "exitFullscreen");
            notifyListeners("exitFullscreen", data);
        });
    }

    private int getCodecPriority(String codecName) {
        if (codecName == null) return 0;
        String name = codecName.toLowerCase(Locale.ROOT);
        // 1. FFmpeg decoders tienen prioridad maxima
        if (name.contains("ffmpeg")) return 100;
        // 2. Decodificadores hardware de fabricante (Qualcomm, MediaTek, Intel, Samsung, Nvidia, etc.)
        if (name.contains("intel") || name.contains("qcom") || name.contains("qti")
                || name.contains("mtk") || name.contains("exynos") || name.contains("nvidia")
                || name.contains("amlogic") || name.contains("hisilicon")) {
            return 90;
        }
        // 3. Otros decodificadores que no sean software generico de Google
        if (!name.startsWith("c2.android.") && !name.startsWith("omx.google.")) {
            return 80;
        }
        // 4. Decodificador software clasico OpenMAX de Google (estable en x86 y ARM)
        if (name.startsWith("omx.google.")) {
            return 40;
        }
        // 5. Decodificador Codec2 de Google (c2.android.* tiene el bug de CCodecBufferChannel en x86)
        return 10;
    }

    private void ensurePlayer() {
        if (player != null && playerView != null) return;

        if (trackSelector == null) {
            trackSelector = new DefaultTrackSelector(context);
        }

        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                        5000,
                        Math.max(15000, bufferSeconds * 1000),
                        1500,
                        2500
                )
                .build();

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .setUsage(C.USAGE_MEDIA)
                .build();

        MediaCodecSelector codecSelector = (mimeType, requiresSecureDecoder, requiresTunnelingDecoder) -> {
            List<MediaCodecInfo> list = MediaCodecSelector.DEFAULT.getDecoderInfos(mimeType, requiresSecureDecoder, requiresTunnelingDecoder);
            List<MediaCodecInfo> result = new ArrayList<>();
            if (list != null) {
                result.addAll(list);
            }

            // Inyectar decodificadores alternativos (como OpenMAX clásico) si MediaCodecUtil los filtró por ser alias
            if (MimeTypes.VIDEO_H264.equals(mimeType)) {
                boolean hasOmx = false;
                for (MediaCodecInfo info : result) {
                    if (info.name.equalsIgnoreCase("OMX.google.h264.decoder")) {
                        hasOmx = true;
                        break;
                    }
                }
                if (!hasOmx) {
                    try {
                        android.media.MediaCodecList mcl = new android.media.MediaCodecList(android.media.MediaCodecList.ALL_CODECS);
                        for (android.media.MediaCodecInfo mci : mcl.getCodecInfos()) {
                            if (!mci.isEncoder() && mci.getName().equalsIgnoreCase("OMX.google.h264.decoder")) {
                                android.media.MediaCodecInfo.CodecCapabilities caps = mci.getCapabilitiesForType(mimeType);
                                if (caps != null) {
                                    MediaCodecInfo customInfo = MediaCodecInfo.newInstance(
                                            mci.getName(),
                                            mimeType,
                                            mimeType,
                                            caps,
                                            false, // hardwareAccelerated
                                            true,  // softwareOnly
                                            false, // vendor
                                            false, // forceDisableAdaptive
                                            false  // forceSecure
                                    );
                                    result.add(customInfo);
                                    Log.i(TAG, "Inyectado decodificador alternativo: " + mci.getName());
                                }
                                break;
                            }
                        }
                    } catch (Throwable t) {
                        Log.w(TAG, "No se pudo inyectar OMX.google.h264.decoder: " + t.getMessage());
                    }
                }
            }

            if (result.size() <= 1) return result;
            Collections.sort(result, (a, b) -> {
                int scoreA = getCodecPriority(a.name);
                int scoreB = getCodecPriority(b.name);
                return Integer.compare(scoreB, scoreA);
            });
            for (MediaCodecInfo mci : result) {
                Log.d(TAG, "Prioridad de codec [" + mimeType + "]: " + mci.name + " (score=" + getCodecPriority(mci.name) + ")");
            }
            return result;
        };

        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(context)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
                .setEnableDecoderFallback(true)
                .setMediaCodecSelector(codecSelector);

        player = new ExoPlayer.Builder(context, renderersFactory)
                .setTrackSelector(trackSelector)
                .setAudioAttributes(audioAttributes, true)
                .setLoadControl(loadControl)
                .build();
        player.setHandleAudioBecomingNoisy(true);

        LayoutInflater inflater = LayoutInflater.from(getContext());
        playerView = (PlayerView) inflater.inflate(com.freeiptv.app.R.layout.exo_player_texture_view, null);
        playerView.setPlayer(player);
        playerView.setUseController(false);
        playerView.setBackgroundColor(Color.BLACK);
        playerView.setShutterBackgroundColor(Color.BLACK);
        playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        playerView.setClickable(true);
        playerView.setFocusable(true);
        playerView.setFocusableInTouchMode(true);

        GestureDetector gestureDetector = new GestureDetector(getContext(), new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDown(MotionEvent e) {
                return true;
            }

            @Override
            public boolean onSingleTapUp(MotionEvent e) {
                if (isFullscreen()) {
                    toggleTopOverlay();
                    return true;
                } else {
                    getActivity().runOnUiThread(() -> {
                        JSObject data = new JSObject();
                        data.put("action", "requestFullscreen");
                        notifyListeners("toggleFullscreen", data);
                    });
                    return true;
                }
            }

            @Override
            public boolean onScroll(MotionEvent e1, MotionEvent e2, float distanceX, float distanceY) {
                if (isTelevision() || e1 == null || e2 == null) return false;
                if (Math.abs(distanceX) > Math.abs(distanceY)) return false;

                int viewWidth = playerView.getWidth();
                int viewHeight = playerView.getHeight();
                if (viewWidth <= 0 || viewHeight <= 0) return false;

                // Mitad DERECHA: Control de VOLUMEN por pantalla
                if (e1.getX() > (float) viewWidth / 2.0f) {
                    try {
                        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
                        if (am != null) {
                            int maxVol = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                            int curVol = am.getStreamVolume(AudioManager.STREAM_MUSIC);
                            float step = (distanceY / (float) viewHeight) * maxVol * 1.5f;
                            int newVol = Math.max(0, Math.min(maxVol, curVol + (step > 0 ? 1 : step < 0 ? -1 : 0)));
                            if (newVol != curVol) {
                                am.setStreamVolume(AudioManager.STREAM_MUSIC, newVol, 0);
                            }
                            int pct = (int) Math.round(((double) newVol / (double) maxVol) * 100);
                            showHudToast("🔊 Volumen: " + pct + "%", "info", 1000);
                            return true;
                        }
                    } catch (Exception ignored) {}
                }
                // Mitad IZQUIERDA: Control de BRILLO por pantalla
                else {
                    try {
                        Activity act = getActivity();
                        if (act != null) {
                            WindowManager.LayoutParams lp = act.getWindow().getAttributes();
                            float curBrightness = lp.screenBrightness;
                            if (curBrightness < 0) curBrightness = 0.5f;
                            float delta = (distanceY / (float) viewHeight) * 0.8f;
                            float newBrightness = Math.max(0.01f, Math.min(1.0f, curBrightness + delta));
                            lp.screenBrightness = newBrightness;
                            act.getWindow().setAttributes(lp);
                            int pct = Math.round(newBrightness * 100);
                            showHudToast("☀️ Brillo: " + pct + "%", "info", 1000);
                            return true;
                        }
                    } catch (Exception ignored) {}
                }
                return false;
            }
        });
        playerView.setOnTouchListener((v, event) -> {
            boolean handled = gestureDetector.onTouchEvent(event);
            if (event.getAction() == MotionEvent.ACTION_UP) {
                v.performClick();
            }
            return handled;
        });

        playerView.setControllerVisibilityListener(new PlayerView.ControllerVisibilityListener() {
            @Override
            public void onVisibilityChanged(int visibility) {
                if (topOverlay != null && !isCurrentLive) {
                    if (visibility == View.VISIBLE) {
                        showTopOverlayBriefly(3500);
                    } else {
                        hideTopOverlay();
                    }
                }
            }
        });

        createTopBarOverlay();

        ViewGroup rootView = (ViewGroup) bridge.getWebView().getParent();
        if (rootView != null) {
            rootView.addView(playerView, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
            ));
            playerView.bringToFront();
        }

        attachListeners();
    }

    private void attachListeners() {
        if (player == null || listenersAttached) return;
        listenersAttached = true;

        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                JSObject data = new JSObject();
                data.put("playing", isPlaying);
                data.put("state", player != null ? player.getPlaybackState() : 0);
                data.put("positionMs", player != null ? player.getCurrentPosition() : 0);
                data.put("durationMs", safeDuration());
                notifyListeners("playbackStateChanged", data);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                JSObject data = new JSObject();
                data.put("state", state);
                data.put("playing", player != null && player.isPlaying());
                data.put("positionMs", player != null ? player.getCurrentPosition() : 0);
                data.put("durationMs", safeDuration());
                notifyListeners("playbackStateChanged", data);

                if (state == Player.STATE_ENDED) {
                    notifyListeners("playbackEnded", new JSObject());
                } else if (state == Player.STATE_READY) {
                    notifyListeners("playbackReady", new JSObject());
                    if (isCurrentLive && vodTitleView != null && vodTitleView.getText().length() > 0) {
                        showHudToast("▶ Reproduciendo " + vodTitleView.getText().toString(), "ok");
                    }
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                Log.e(TAG, "ExoPlayer error", error);
                String errorDetails = error != null ? (error.getErrorCodeName() + " (" + error.errorCode + "): " + error.getMessage()) : "Playback error";

                String msg = error != null ? error.getMessage() : "";
                int code = error != null ? error.errorCode : 0;
                boolean isVideoError = (code == PlaybackException.ERROR_CODE_DECODING_FAILED
                        || code == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED)
                        && msg != null && msg.contains("MediaCodecVideoRenderer");

                if (isVideoError) {
                    Log.w(TAG, "Fallo en decodificador de video por hardware/SO: " + errorDetails);
                    showHudToast("⚠ Hardware no soporta decodificación interna de video", "error", 3500);
                    try {
                        com.freeiptv.app.MainActivity mainAct = (com.freeiptv.app.MainActivity) getActivity();
                        if (mainAct != null) {
                            mainAct.writeLog("WARN", "ExoPlayer", "Fallo video MediaCodec (" + errorDetails + "). Notificando para reproductor externo.");
                        }
                    } catch (Exception ignored) {}

                    JSObject data = new JSObject();
                    data.put("error", errorDetails);
                    data.put("errorCode", code);
                    data.put("isVideoCodecError", true);
                    data.put("url", currentUrl);
                    data.put("title", currentTitle);
                    notifyListeners("videoCodecError", data);
                    notifyListeners("playbackError", data);

                    getActivity().runOnUiThread(() -> {
                        if (player != null) {
                            player.stop();
                        }
                        if (playerView != null) playerView.setVisibility(View.GONE);
                    });
                    return;
                }

                showHudToast("⚠ Error al conectar canal", "error");
                try {
                    com.freeiptv.app.MainActivity mainAct = (com.freeiptv.app.MainActivity) getActivity();
                    if (mainAct != null) {
                        mainAct.writeLog("ERROR", "ExoPlayer", errorDetails);
                    }
                } catch (Exception ignored) {}

                JSObject data = new JSObject();
                data.put("error", errorDetails);
                data.put("errorCode", error != null ? error.errorCode : 0);
                notifyListeners("playbackError", data);

                getActivity().runOnUiThread(() -> {
                    if (playerView != null) playerView.setVisibility(View.GONE);
                });
            }
        });
    }

    private long safeDuration() {
        if (player == null) return 0;
        long d = player.getDuration();
        return d == C.TIME_UNSET ? 0 : Math.max(0, d);
    }

    private Map<String, String> readHeaders(PluginCall call) {
        Map<String, String> headers = new HashMap<>();
        JSObject obj = call.getObject("headers");
        if (obj != null) {
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String value = obj.optString(key, null);
                if (value != null) headers.put(key, value);
            }
        }
        return headers;
    }

    @PluginMethod()
    public void play(final PluginCall call) {
        final String url = call.getString("url");
        final String title = call.getString("title", "Contenido");
        final long startPositionMs = call.getLong("startPositionMs", 0L);
        final String mimeType = call.getString("mimeType", "");
        final boolean isLive = Boolean.TRUE.equals(call.getBoolean("isLive", false));
        final int requestedBuffer = call.getInt("bufferSeconds", 30);
        final Map<String, String> headers = readHeaders(call);

        if (url == null || url.isEmpty()) {
            call.reject("URL no proporcionada");
            return;
        }

        currentUrl = url;
        currentTitle = title;
        currentHeaders = new HashMap<>(headers);

        getActivity().runOnUiThread(() -> {
            try {
                if (requestedBuffer > 0 && requestedBuffer != bufferSeconds) {
                    bufferSeconds = requestedBuffer;
                    releasePlayer();
                }
                ensurePlayer();

                videoFallbackAttempted = false;
                if (trackSelector != null) {
                    trackSelector.setParameters(trackSelector.buildUponParameters().setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, false));
                }

                player.stop();
                player.clearMediaItems();

                String userAgent = DEFAULT_USER_AGENT;
                if (headers.containsKey("User-Agent")) {
                    String customUa = headers.remove("User-Agent");
                    if (customUa != null && !customUa.isEmpty()) {
                        userAgent = customUa;
                    }
                }

                DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                        .setUserAgent(userAgent)
                        .setAllowCrossProtocolRedirects(true)
                        .setConnectTimeoutMs(15000)
                        .setReadTimeoutMs(20000);
                Map<String, String> requestHeaders = new HashMap<>();
                requestHeaders.put("Accept", "*/*");
                if (!headers.isEmpty()) {
                    requestHeaders.putAll(headers);
                }
                httpFactory.setDefaultRequestProperties(requestHeaders);

                DefaultDataSource.Factory dataSourceFactory =
                        new DefaultDataSource.Factory(context, httpFactory);

                DefaultExtractorsFactory extractorsFactory = new DefaultExtractorsFactory()
                        .setConstantBitrateSeekingEnabled(true)
                        .setTsExtractorFlags(
                                DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES
                                | DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS
                        );

                DefaultMediaSourceFactory mediaSourceFactory =
                        new DefaultMediaSourceFactory(dataSourceFactory, extractorsFactory);

                MediaItem.Builder mediaItemBuilder = new MediaItem.Builder().setUri(Uri.parse(url));
                String lowerUrl = url.toLowerCase();
                String lowerMime = mimeType.toLowerCase();

                if (lowerMime.contains("mpegurl") || lowerUrl.contains(".m3u8")) {
                    mediaItemBuilder.setMimeType(MimeTypes.APPLICATION_M3U8);
                } else if (lowerMime.contains("dash") || lowerUrl.contains(".mpd")) {
                    mediaItemBuilder.setMimeType(MimeTypes.APPLICATION_MPD);
                }

                MediaItem mediaItem = mediaItemBuilder.build();
                MediaSource source = mediaSourceFactory.createMediaSource(mediaItem);

                isCurrentLive = isLive;
                if (vodTitleView != null) vodTitleView.setText(title);
                showHudToast("⏳ Conectando con " + title + "...", "info");
                if (isLive) {
                    playerView.setUseController(false);
                    playerView.setClickable(true);
                    playerView.setFocusable(true);
                    playerView.setFocusableInTouchMode(true);
                    hideTopOverlay(); // Oculto por defecto en transmision en vivo; solo aparece al tocar la pantalla
                } else {
                    playerView.setUseController(true);
                    playerView.setShowRewindButton(true);
                    playerView.setShowFastForwardButton(true);
                    playerView.setShowPreviousButton(false);
                    playerView.setShowNextButton(false);
                    playerView.setControllerShowTimeoutMs(3500);
                    playerView.setControllerAutoShow(true);
                    playerView.setClickable(true);
                    playerView.setFocusable(true);
                    playerView.setFocusableInTouchMode(true);
                    showTopOverlayBriefly(3500);
                    playerView.showController();
                }

                playerView.setVisibility(View.VISIBLE);
                playerView.bringToFront();
                player.setMediaSource(source, Math.max(0, startPositionMs));
                player.prepare();
                player.setPlayWhenReady(true);

                // En TV Live, asegurar que el WebView retenga el foco para la navegación D-Pad
                if (isLive && bridge != null && bridge.getWebView() != null) {
                    bridge.getWebView().post(() -> bridge.getWebView().requestFocus());
                }

                JSObject result = new JSObject();
                result.put("status", "playing");
                result.put("url", url);
                result.put("title", title);
                result.put("live", isLive);
                call.resolve(result);
            } catch (Exception ex) {
                Log.e(TAG, "Error iniciando ExoPlayer", ex);
                call.reject("Error iniciando ExoPlayer: " + ex.getMessage());
            }
        });
    }

    @PluginMethod()
    public void pause(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) {
                player.setPlayWhenReady(false);
                call.resolve();
            } else {
                call.reject("No hay reproduccion activa");
            }
        });
    }

    @PluginMethod()
    public void resume(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) {
                player.setPlayWhenReady(true);
                call.resolve();
            } else {
                call.reject("No hay reproduccion activa");
            }
        });
    }

    @PluginMethod()
    public void stop(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) {
                player.stop();
                player.clearMediaItems();
            }
            if (playerView != null) {
                playerView.setVisibility(View.GONE);
            }
            if (topOverlay != null) {
                topOverlay.setVisibility(View.GONE);
            }
            call.resolve();
        });
    }

    @PluginMethod()
    public void seek(final PluginCall call) {
        final long positionMs = call.getLong("positionMs", 0L);
        getActivity().runOnUiThread(() -> {
            if (player != null) {
                player.seekTo(Math.max(0, positionMs));
                call.resolve();
            } else {
                call.reject("No hay reproduccion activa");
            }
        });
    }

    @PluginMethod()
    public void setVolume(final PluginCall call) {
        final double volume = call.getDouble("volume", 1.0);
        getActivity().runOnUiThread(() -> {
            if (player != null) {
                player.setVolume((float) Math.max(0, Math.min(1, volume)));
                call.resolve();
            } else {
                call.reject("No hay reproduccion activa");
            }
        });
    }

    @PluginMethod()
    public void setSpeed(final PluginCall call) {
        final double speed = call.getDouble("speed", 1.0);
        getActivity().runOnUiThread(() -> {
            if (player != null) {
                player.setPlaybackSpeed((float) Math.max(0.25, Math.min(3.0, speed)));
                call.resolve();
            } else {
                call.reject("No hay reproduccion activa");
            }
        });
    }

    @PluginMethod()
    public void setBuffer(final PluginCall call) {
        int seconds = call.getInt("seconds", 30);
        if (seconds > 0 && seconds != bufferSeconds) {
            bufferSeconds = seconds;
            getActivity().runOnUiThread(this::releasePlayer);
        }
        call.resolve();
    }

    @PluginMethod()
    public void setVisibility(final PluginCall call) {
        final boolean visible = call.getBoolean("visible", true);
        getActivity().runOnUiThread(() -> {
            if (playerView != null) {
                playerView.setVisibility(visible ? View.VISIBLE : View.GONE);
                if (topOverlay != null && !visible) {
                    topOverlay.setVisibility(View.GONE);
                }
            }
            call.resolve();
        });
    }

    @PluginMethod()
    public void setLayout(final PluginCall call) {
        final boolean isFull = Boolean.TRUE.equals(call.getBoolean("fullscreen", false));
        final int x = call.getInt("x", 0);
        final int y = call.getInt("y", 0);
        final int rawW = call.getInt("w", ViewGroup.LayoutParams.MATCH_PARENT);
        final int rawH = call.getInt("h", ViewGroup.LayoutParams.MATCH_PARENT);

        if (!isFull && (rawW == 0 || rawH == 0)) {
            getActivity().runOnUiThread(() -> {
                if (playerView != null) {
                    playerView.setVisibility(View.GONE);
                    if (topOverlay != null) topOverlay.setVisibility(View.GONE);
                }
                call.resolve();
            });
            return;
        }

        int w = rawW;
        int h = rawH;

        if (isFull || w < 0 || h < 0) {
            w = ViewGroup.LayoutParams.MATCH_PARENT;
            h = ViewGroup.LayoutParams.MATCH_PARENT;
        }

        final int targetW = w;
        final int targetH = h;
        final int targetX = (isFull || targetW == ViewGroup.LayoutParams.MATCH_PARENT) ? 0 : x;
        final int targetY = (isFull || targetH == ViewGroup.LayoutParams.MATCH_PARENT) ? 0 : y;

        getActivity().runOnUiThread(() -> {
            if (playerView != null) {
                playerView.setVisibility(View.VISIBLE);
                ViewGroup.LayoutParams lp = playerView.getLayoutParams();
                if (lp != null) {
                    lp.width = targetW;
                    lp.height = targetH;
                    playerView.setLayoutParams(lp);
                }
                playerView.setX(targetX);
                playerView.setY(targetY);
                playerView.bringToFront();

                int screenW = getActivity().getWindow().getDecorView().getWidth();
                boolean isFullscreen = (isFull || targetW == ViewGroup.LayoutParams.MATCH_PARENT || (screenW > 0 && targetW >= screenW - 100));
                hideTopOverlay(); // En Live mantener oculto por defecto para no tapar la reproduccion
            }
            call.resolve();
        });
    }

    @PluginMethod()
    public void setResizeMode(final PluginCall call) {
        final String mode = call.getString("mode", "fit");
        getActivity().runOnUiThread(() -> {
            if (playerView != null) {
                int value = AspectRatioFrameLayout.RESIZE_MODE_FIT;
                if ("fill".equals(mode)) value = AspectRatioFrameLayout.RESIZE_MODE_FILL;
                else if ("zoom".equals(mode)) value = AspectRatioFrameLayout.RESIZE_MODE_ZOOM;
                else if ("fixed_width".equals(mode)) value = AspectRatioFrameLayout.RESIZE_MODE_FIXED_WIDTH;
                else if ("fixed_height".equals(mode)) value = AspectRatioFrameLayout.RESIZE_MODE_FIXED_HEIGHT;
                playerView.setResizeMode(value);
            }
            call.resolve();
        });
    }

    @PluginMethod()
    public void getStatus(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject result = new JSObject();
            if (player == null) {
                result.put("active", false);
                call.resolve(result);
                return;
            }
            result.put("active", true);
            result.put("playing", player.isPlaying());
            result.put("state", player.getPlaybackState());
            result.put("positionMs", player.getCurrentPosition());
            result.put("durationMs", safeDuration());
            result.put("bufferedMs", player.getBufferedPosition());
            result.put("volume", player.getVolume());
            call.resolve(result);
        });
    }

    @PluginMethod()
    public void getDuration(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) {
                JSObject result = new JSObject();
                result.put("durationMs", safeDuration());
                call.resolve(result);
            } else {
                call.reject("No hay reproduccion activa");
            }
        });
    }

    @PluginMethod()
    public void getCurrentPosition(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) {
                JSObject result = new JSObject();
                result.put("positionMs", player.getCurrentPosition());
                call.resolve(result);
            } else {
                call.reject("No hay reproduccion activa");
            }
        });
    }

    @PluginMethod()
    public void setAudioTrack(final PluginCall call) {
        // La seleccion automatica la resuelve DefaultTrackSelector.
        call.resolve();
    }

    @PluginMethod()
    public void openCastSettings(final PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_CAST_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent intent = new Intent("android.settings.WIRELESS_SETTINGS");
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception ex) {
                call.reject("No se pudo abrir la configuracion de pantalla inalambrica: " + ex.getMessage());
            }
        }
    }

    @PluginMethod()
    public void showToast(final PluginCall call) {
        final String message = call.getString("message", "");
        final String type = call.getString("type", "info");
        final int duration = call.getInt("duration", 2400);
        showHudToast(message, type, duration);
        call.resolve();
    }

    @PluginMethod()
    public void isSupported(final PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("platform", "android");
        result.put("engine", "exoplayer_media3");
        call.resolve(result);
    }

    @PluginMethod()
    public void evaluateHardware(final PluginCall call) {
        try {
            JSObject result = HardwareEvaluator.evaluate(getContext());
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Error en evaluateHardware", e);
            call.reject("Error evaluando hardware: " + e.getMessage());
        }
    }

    @PluginMethod()
    public void getInstalledVideoPlayers(final PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("players", HardwareEvaluator.getInstalledPlayers(getContext()));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Error obteniendo reproductores: " + e.getMessage());
        }
    }

    @PluginMethod()
    public void openExternalPlayer(final PluginCall call) {
        final String url = call.getString("url", currentUrl);
        final String title = call.getString("title", currentTitle != null ? currentTitle : "Transmisión");
        final String targetPackage = call.getString("packageName", "auto");
        final boolean forceChooser = Boolean.TRUE.equals(call.getBoolean("forceChooser", false));

        if (url == null || url.isEmpty()) {
            call.reject("URL no proporcionada");
            return;
        }

        Map<String, String> headers = readHeaders(call);
        if (headers.isEmpty() && currentHeaders != null) {
            headers = currentHeaders;
        }

        final Map<String, String> finalHeaders = headers;

        getActivity().runOnUiThread(() -> {
            try {
                if (player != null && player.isPlaying()) {
                    player.pause();
                }
                if (playerView != null) {
                    playerView.setVisibility(View.GONE);
                }

                Intent intent = HardwareEvaluator.buildExternalPlayerIntent(
                        getContext(), url, title, finalHeaders, forceChooser ? "chooser" : targetPackage
                );

                if (forceChooser || "chooser".equalsIgnoreCase(targetPackage)) {
                    Intent chooser = Intent.createChooser(intent, "Reproducir con...");
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(chooser);
                } else {
                    getContext().startActivity(intent);
                }

                JSObject res = new JSObject();
                res.put("launched", true);
                res.put("url", url);
                res.put("title", title);
                call.resolve(res);
            } catch (Exception e) {
                Log.w(TAG, "Fallo al iniciar reproductor externo directo, probando chooser", e);
                try {
                    Intent fallbackIntent = HardwareEvaluator.buildExternalPlayerIntent(
                            getContext(), url, title, finalHeaders, "chooser"
                    );
                    Intent chooser = Intent.createChooser(fallbackIntent, "Reproducir con...");
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(chooser);
                    JSObject res = new JSObject();
                    res.put("launched", true);
                    res.put("fallbackChooser", true);
                    call.resolve(res);
                } catch (Exception ex) {
                    Log.e(TAG, "Error definitivo abriendo reproductor externo", ex);
                    call.reject("No se encontró ningún reproductor externo compatible: " + ex.getMessage());
                }
            }
        });
    }

    @PluginMethod()
    public void openPlayStore(final PluginCall call) {
        String pkg = call.getString("packageName", HardwareEvaluator.PKG_VLC);
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception ex) {
                call.reject("No se pudo abrir tienda o navegador: " + ex.getMessage());
            }
        }
    }

    private void releasePlayer() {
        if (topOverlay != null) {
            topOverlay = null;
            vodTitleView = null;
        }
        if (playerView != null) {
            try {
                ViewGroup parent = (ViewGroup) playerView.getParent();
                if (parent != null) parent.removeView(playerView);
            } catch (Exception ignored) {}
            playerView = null;
        }
        if (player != null) {
            try {
                player.stop();
                player.release();
            } catch (Exception ignored) {}
            player = null;
        }
        listenersAttached = false;
    }

    @Override
    protected void handleOnDestroy() {
        releasePlayer();
        super.handleOnDestroy();
    }
}

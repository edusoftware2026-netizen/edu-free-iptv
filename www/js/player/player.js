/* Reproductor unificado.
   - Android: ExoPlayerPlugin nativo (Media3).
   - Web / fallback: <video> + HLS.js.
   - Guarda progreso para VOD y emite eventos a la UI.
*/

import { store } from '../core/store.js';
import { escapeHtml, loadScript, setNativeOrientation } from '../core/util.js';
import { Logger } from '../core/logger.js';
import { confirmDialog, toast } from '../ui/dom.js';

const listeners = new Map();
let nativeBound = false;
let native = null;
let current = null;
let layout = null;
let web = null;
let hls = null;
let progressTimer = 0;
let lastSaved = 0;
let fullscreen = false;
let retriedFormat = false;
let isStartingPlayback = false;
let startLockTimer = 0;

function acquireStartLock() {
  isStartingPlayback = true;
  clearTimeout(startLockTimer);
  startLockTimer = setTimeout(() => { isStartingPlayback = false; }, 8000);
}

function releaseStartLock() {
  isStartingPlayback = false;
  clearTimeout(startLockTimer);
  startLockTimer = 0;
}

function emit(name, detail) {
  const set = listeners.get(name);
  if (set) for (const fn of set) {
    try { fn(detail); } catch (err) { console.error('Player listener', err); }
  }
  window.dispatchEvent(new CustomEvent(`player:${name}`, { detail }));
}

export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}

function plugin() {
  if (native !== null) return native;
  native = window.Capacitor?.Plugins?.ExoPlayerPlugin || null;
  return native;
}

export function isNativeAvailable() {
  return !!plugin();
}

function guessMime(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('.m3u8')) return 'application/x-mpegURL';
  if (u.includes('.mpd')) return 'application/dash+xml';
  if (u.includes('.mkv')) return 'video/x-matroska';
  if (u.includes('.webm')) return 'video/webm';
  return 'video/mp4';
}

function isWebPlayable(url) {
  const u = String(url || '').toLowerCase();
  if (/\.(mkv|avi|flv|wmv|ts)(\?|$)/i.test(u)) return false;
  return true;
}

function isHeavyContainer(url) {
  return /\.(mkv|avi|flv|wmv)(\?|$)/i.test(String(url || '').toLowerCase());
}

function alternateUrl(url) {
  const u = String(url || '');
  if (/\.m3u8(\?|$)/i.test(u)) return u.replace(/\.m3u8(\?|$)/i, '.ts$1');
  if (/\.ts(\?|$)/i.test(u)) return u.replace(/\.ts(\?|$)/i, '.m3u8$1');
  return '';
}

function fullRect() {
  const dpr = window.devicePixelRatio || 1;
  return {
    x: 0,
    y: 0,
    w: Math.round(window.innerWidth * dpr),
    h: Math.round(window.innerHeight * dpr),
  };
}

async function bindNative() {
  if (nativeBound) return;
  const p = plugin();
  if (!p) return;
  nativeBound = true;
  try {
    await p.addListener('playbackStateChanged', (data) => {
      if (data?.playing || data?.state === 'ready' || data?.state === 'ended') {
        releaseStartLock();
      }
      emit('state', data);
    });
    await p.addListener('playerClosed', () => {
      stop();
    });
    await p.addListener('exitFullscreen', () => {
      exitFullscreen();
    });
    await p.addListener('toggleFullscreen', () => {
      emit('toggleFullscreen');
    });
    await p.addListener('playbackEnded', () => {
      stop();
    });
    await p.addListener('videoCodecError', async (data) => {
      releaseStartLock();
      Logger.warn('Player', 'Fallo de códec de video nativo: ' + JSON.stringify(data));
      const url = data?.url || current?.url;
      const title = data?.title || current?.title || 'Canal';
      const engine = store.state.settings.engine || 'auto';
      const hw = cachedHardware || (await evaluateHardware().catch(() => null));

      if (engine === 'external' || (engine === 'auto' && hw?.hasRecommendedExternalPlayer)) {
        Logger.info('Player', 'Conmutando automáticamente a Reproductor Externo...');
        await stop({ silent: true });
        const launched = await openExternal({ url, title });
        if (!launched) {
          showExternalPlayerPrompt(url, title);
        }
      } else if (engine === 'auto' && current && !current.webFallbackTried && isWebPlayable(url)) {
        current.webFallbackTried = true;
        Logger.info('Player', 'Conmutando a reproductor web (HLS.js) por fallo de códec nativo');
        try {
          await plugin()?.stop();
          current.mode = 'web';
          await playWeb({ url, title, live: current.live, startPosition: current.startPosition || 0 });
          emit('ready', { mode: 'web' });
          return;
        } catch (_) {}
        await stop({ silent: true });
        showExternalPlayerPrompt(url, title);
      } else {
        await stop({ silent: true });
        showExternalPlayerPrompt(url, title);
      }
    });
    await p.addListener('playbackError', async (data) => {
      if (data?.isVideoCodecError) {
        // Manejado prioritariamente por videoCodecError
        return;
      }
      releaseStartLock();
      const message = data?.error || 'Error de reproduccion';
      Logger.warn('Player', message);
      const isHttpDead = message.includes('404') || message.includes('403') || message.includes('2004');
      const isCodecError = message.includes('4003') || message.includes('4001') || message.includes('DECODING_FAILED') || message.includes('DECODER_INIT_FAILED') || message.includes('MediaCodec');
      
      if (isCodecError) {
        const url = current?.url || data?.url;
        const title = current?.title || data?.title;
        const engine = store.state.settings.engine || 'auto';
        if (engine === 'auto' || engine === 'external') {
          await stop({ silent: true });
          const launched = await openExternal({ url, title });
          if (!launched) {
            showExternalPlayerPrompt(url, title);
          }
          return;
        }
      }

      const alt = (!isHttpDead && !isCodecError && current && !retriedFormat) ? alternateUrl(current.url) : '';
      if (alt) {
        retriedFormat = true;
        Logger.info('Player', 'Reintentando formato alternativo: ' + alt);
        try {
          await play({ ...current, url: alt }, { retry: true });
          return;
        } catch (_) {}
      }

      // Si falla en nativo por decodificacion (4003/4001) o error de hardware, intentar con el reproductor web integrado
      if (current && !current.webFallbackTried && isCodecError) {
        current.webFallbackTried = true;
        Logger.info('Player', 'Activando fallback web por falla de codec nativo');
        try {
          await plugin()?.stop();
          current.mode = 'web';
          await playWeb({ url: current.url, title: current.title, live: current.live });
          return;
        } catch (_) {}
      }

      // En caso de error nativo en Android, emitir error para que la UI maneje el aviso y no abrir overlay web
      emit('error', { message });
    });
  } catch (err) {
    Logger.warn('Player', 'No se pudieron enlazar eventos nativos', err?.message || err);
  }
}

function startProgress(item, live) {
  stopProgress();
  if (live || !item) return;
  progressTimer = setInterval(async () => {
    if (!current || current.live) return;
    try {
      let pos = 0;
      let dur = 0;
      if (current.mode === 'native') {
        const p = plugin();
        const r1 = await p.getCurrentPosition();
        pos = Number(r1?.positionMs || 0) / 1000;
        try {
          const r2 = await p.getDuration();
          dur = Number(r2?.durationMs || 0) / 1000;
        } catch (_) {}
      } else if (web?.video) {
        pos = web.video.currentTime || 0;
        dur = Number.isFinite(web.video.duration) ? web.video.duration : 0;
      }
      if (pos > 5) {
        store.setProgress(current.item, pos, dur);
        lastSaved = Date.now();
        emit('progress', { position: pos, duration: dur });
      }
    } catch (_) {}
  }, 5000);
}

function stopProgress() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = 0;
}

function destroyWeb() {
  if (hls) {
    try { hls.destroy(); } catch (_) {}
    hls = null;
  }
  if (web?.root) {
    try { web.video?.pause(); } catch (_) {}
    web.root.remove();
  }
  web = null;
}

async function ensureWebOverlay(title, targetLayout = null) {
  destroyWeb();
  const root = document.createElement('div');
  root.className = 'web-player';
  const dpr = window.devicePixelRatio || 1;
  const useBox = targetLayout && !fullscreen;

  if (useBox) {
    root.style.position = 'fixed';
    root.style.left = Math.round(targetLayout.x / dpr) + 'px';
    root.style.top = Math.round(targetLayout.y / dpr) + 'px';
    root.style.width = Math.round(targetLayout.w / dpr) + 'px';
    root.style.height = Math.round(targetLayout.h / dpr) + 'px';
    root.style.zIndex = '50';
  } else {
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.width = '100vw';
    root.style.height = '100vh';
    root.style.zIndex = '3000';
  }

  root.innerHTML = `
    <div class="web-player__bar${useBox ? ' hidden' : ''}">
      <div class="web-player__title">${escapeHtml(title || '')}</div>
      <button class="btn btn--ghost btn--icon" data-web-close aria-label="Cerrar">✕</button>
    </div>
    <video class="web-player__video" playsinline controls autoplay></video>`;
  document.body.appendChild(root);
  const video = root.querySelector('video');
  root.querySelector('[data-web-close]')?.addEventListener('click', () => {
    stop();
  });
  web = { root, video };
  return web;
}

async function playWeb({ url, title, live, startPosition = 0, layout: targetLayout = null }) {
  const { video } = await ensureWebOverlay(title, targetLayout || layout);
  const Hls = window.Hls || await loadScript('vendor/hls.min.js', 'Hls').catch(() => null);

  const isHls = /\.m3u8(\?|$)/i.test(url) || url.includes('.m3u');
  if (isHls && Hls?.isSupported?.()) {
    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      maxBufferSize: 60 * 1024 * 1024,
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data?.fatal) return;
      Logger.warn('HLS', data.details || 'Error fatal');
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        try { hls.startLoad(); return; } catch (_) {}
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        try { hls.recoverMediaError(); return; } catch (_) {}
      }
      emit('error', { message: 'No se pudo reproducir el canal (Web)' });
    });
  } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
  } else {
    video.src = url;
  }

  if (startPosition > 5 && !live) {
    video.addEventListener('loadedmetadata', () => {
      try { video.currentTime = startPosition; } catch (_) {}
    }, { once: true });
  }
  try {
    await video.play();
    emit('state', { playing: true });
  } catch (_) {}
  video.addEventListener('error', () => emit('error', { message: 'No se pudo reproducir el contenido' }));
}

export async function play(item, options = {}) {
  if (!item && !options.url) throw new Error('Contenido no valido');
  const url = options.url || item?.url;
  if (!url) throw new Error('URL no disponible');

  if (isStartingPlayback && !options.retry) {
    toast('Espera a que inicie la reproducción actual...', 'info', 1400);
    return current;
  }

  acquireStartLock();

  // Cerrar siempre cualquier reproducción previa antes de analizar o abrir la nueva
  await stop({ silent: true, keepLock: true });
  if (!options.retry) retriedFormat = false;

  const live = !!options.live;
  const title = options.title || item?.name || 'Reproduccion';
  const startPosition = Number(options.startPosition || 0);
  const engine = store.state.settings.engine || 'auto';

  emit('analyzing', { item: item || null, url, title, live });

  // 1. Si el usuario configuró explícitamente Reproductor Externo
  if (engine === 'external' && isNativeAvailable()) {
    current = {
      item: item || null,
      url,
      title,
      live,
      mode: 'external',
      startedAt: Date.now(),
    };
    if (item) store.setLastChannel(item);
    emit('start', { item: current.item, url, live, mode: 'external' });
    const ok = await openExternal({ url, title, live });
    if (!ok) {
      showExternalPlayerPrompt(url, title);
    }
    releaseStartLock();
    emit('ready', { mode: 'external' });
    return current;
  }

  // 2. Modo Automático: analizar dispositivo y tipo de contenido.
  //    - Dispositivos modernos: ExoPlayer nativo (SurfaceView + HW).
  //    - Dispositivos antiguos/limitados:
  //        * Contenedores pesados (.mkv/.avi/.flv/.wmv) -> VLC/MX si existe.
  //        * Resto -> intentar DENTRO de la APK primero (ExoPlayer con TextureView + SW),
  //          con fallback automático a HLS.js o reproductor externo si falla el códec.
  if (engine === 'auto' && isNativeAvailable()) {
    const hw = cachedHardware || (await evaluateHardware());
    if (hw?.isHardwareLimited && isHeavyContainer(url) && hw?.hasRecommendedExternalPlayer) {
      current = {
        item: item || null,
        url,
        title,
        live,
        mode: 'external',
        startedAt: Date.now(),
      };
      if (item) store.setLastChannel(item);
      emit('start', { item: current.item, url, live, mode: 'external' });
      await openExternal({ url, title, live });
      releaseStartLock();
      emit('ready', { mode: 'external' });
      return current;
    }
  }

  const useNative = engine !== 'web' && isNativeAvailable();

  current = {
    item: item || null,
    url,
    title,
    live,
    mode: useNative ? 'native' : 'web',
    startedAt: Date.now(),
  };
  layout = options.layout || layout;

  emit('start', { item: current.item, url, live, mode: current.mode });

  if (useNative) {
    const p = plugin();
    await bindNative();
    try {
      await p.play({
        url,
        title,
        startPositionMs: Math.max(0, Math.round(startPosition * 1000)),
        isLive: live,
        mimeType: guessMime(url),
        bufferSeconds: Number(store.state.settings.buffer) || 30,
      });
      if (layout) await p.setLayout(layout).catch(() => {});
      releaseStartLock();
      emit('ready', { mode: 'native' });
    } catch (err) {
      Logger.warn('Player', 'ExoPlayer fallo, usando web', err?.message || err);
      current.mode = 'web';
      await playWeb({ url, title, live, startPosition });
      releaseStartLock();
      emit('ready', { mode: 'web' });
    }
  } else {
    await playWeb({ url, title, live, startPosition });
    releaseStartLock();
    emit('ready', { mode: 'web' });
  }

  if (item) store.setLastChannel(item);
  startProgress(item, live);
  return current;
}

export async function stop({ silent = false, keepLock = false } = {}) {
  if (!keepLock) releaseStartLock();
  stopProgress();
  const was = current;
  current = null;
  if (fullscreen) {
    fullscreen = false;
    setNativeOrientation('unspecified');
  }
  if (!silent) emit('stop', { item: was?.item || null });
  try {
    const p = plugin();
    if (p) await p.stop();
  } catch (_) {}
  destroyWeb();
  layout = null;
}

export async function pause() {
  if (!current) return;
  if (current.mode === 'native') {
    try { await plugin()?.pause(); } catch (_) {}
  } else {
    try { web?.video?.pause(); } catch (_) {}
  }
  emit('state', { playing: false });
}

export async function resume() {
  if (!current) return;
  if (current.mode === 'native') {
    try {
      const p = plugin();
      if (p?.resume) await p.resume();
    } catch (_) {}
  } else {
    try { await web?.video?.play(); } catch (_) {}
  }
  emit('state', { playing: true });
}

export async function seek(seconds) {
  if (!current) return;
  const ms = Math.max(0, Math.round(seconds * 1000));
  if (current.mode === 'native') {
    try { await plugin()?.seek({ positionMs: ms }); } catch (_) {}
  } else if (web?.video) {
    try { web.video.currentTime = seconds; } catch (_) {}
  }
}

export async function setVisibility(visible) {
  if (current?.mode === 'native') {
    try {
      await plugin()?.setVisibility({ visible: !!visible });
    } catch (_) {}
  } else if (web?.root) {
    web.root.style.display = visible ? '' : 'none';
  }
}

export async function setLayout(rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    if (current?.mode === 'native') {
      try { await plugin()?.setVisibility({ visible: false }); } catch (_) {}
    } else if (web?.root && !fullscreen) {
      web.root.style.display = 'none';
    }
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const px = {
    x: Math.max(0, Math.round(rect.left * dpr)),
    y: Math.max(0, Math.round(rect.top * dpr)),
    w: Math.max(1, Math.round(rect.width * dpr)),
    h: Math.max(1, Math.round(rect.height * dpr)),
  };
  layout = px;
  if (current?.mode === 'native') {
    try {
      await plugin()?.setLayout(px);
      await plugin()?.setVisibility({ visible: true });
    } catch (_) {}
  } else if (web?.root && !fullscreen) {
    web.root.style.display = '';
    web.root.style.position = 'fixed';
    web.root.style.left = Math.round(rect.left) + 'px';
    web.root.style.top = Math.round(rect.top) + 'px';
    web.root.style.width = Math.round(rect.width) + 'px';
    web.root.style.height = Math.round(rect.height) + 'px';
    web.root.style.zIndex = '50';
  }
}

export async function enterFullscreen() {
  fullscreen = true;
  setNativeOrientation('landscape');
  if (current?.mode === 'native') {
    try { await plugin()?.setLayout({ x: 0, y: 0, w: -1, h: -1, fullscreen: true }); } catch (_) {}
  } else if (web?.root) {
    web.root.style.position = 'fixed';
    web.root.style.left = '0px';
    web.root.style.top = '0px';
    web.root.style.width = '100vw';
    web.root.style.height = '100vh';
    web.root.style.zIndex = '3000';
    web.root.querySelector('.web-player__bar')?.classList.remove('hidden');
  }
  emit('fullscreen', { fullscreen: true });
}

export async function exitFullscreen() {
  fullscreen = false;
  setNativeOrientation('unspecified');
  if (current?.mode === 'native' && layout) {
    try { await plugin()?.setLayout(layout); } catch (_) {}
  } else if (web?.root && layout) {
    const dpr = window.devicePixelRatio || 1;
    web.root.style.position = 'fixed';
    web.root.style.left = Math.round(layout.x / dpr) + 'px';
    web.root.style.top = Math.round(layout.y / dpr) + 'px';
    web.root.style.width = Math.round(layout.w / dpr) + 'px';
    web.root.style.height = Math.round(layout.h / dpr) + 'px';
    web.root.style.zIndex = '50';
    web.root.querySelector('.web-player__bar')?.classList.add('hidden');
  }
  emit('fullscreen', { fullscreen: false });
}

export function isFullscreen() {
  return fullscreen;
}

export function getCurrent() {
  return current;
}

export function getVideo() {
  return web?.video || null;
}

export function getLastSaved() {
  return lastSaved;
}

let cachedHardware = null;

export async function evaluateHardware(force = false) {
  if (cachedHardware && !force) return cachedHardware;
  const p = plugin();
  if (!p || typeof p.evaluateHardware !== 'function') {
    return {
      isHardwareLimited: false,
      recommendedEngine: 'native',
      installedPlayers: [],
      hasExternalPlayer: false,
    };
  }
  try {
    cachedHardware = await p.evaluateHardware();
    Logger.info('Player', 'Hardware evaluado: ' + JSON.stringify(cachedHardware));
    return cachedHardware;
  } catch (err) {
    Logger.warn('Player', 'Error evaluando hardware', err?.message || err);
    return {
      isHardwareLimited: false,
      recommendedEngine: 'native',
      installedPlayers: [],
      hasExternalPlayer: false,
    };
  }
}

export async function getInstalledPlayers() {
  const p = plugin();
  if (!p || typeof p.getInstalledVideoPlayers !== 'function') return [];
  try {
    const res = await p.getInstalledVideoPlayers();
    return res?.players || [];
  } catch (_) {
    return [];
  }
}

export async function openExternal(itemOrOptions = {}) {
  const p = plugin();
  if (!p) {
    Logger.warn('Player', 'Reproductor externo solo disponible en Android');
    return false;
  }

  let url = '';
  let title = 'Transmisión';
  if (typeof itemOrOptions === 'string') {
    url = itemOrOptions;
  } else if (itemOrOptions && typeof itemOrOptions === 'object') {
    url = itemOrOptions.url || itemOrOptions.item?.url || current?.url || '';
    title = itemOrOptions.title || itemOrOptions.name || itemOrOptions.item?.name || current?.title || 'Transmisión';
  }

  if (!url) {
    Logger.warn('Player', 'openExternal: URL no disponible');
    return false;
  }

  const targetPackage = store.state.settings.externalPlayer || 'auto';
  const forceChooser = targetPackage === 'chooser';

  try {
    const res = await p.openExternalPlayer({
      url,
      title,
      packageName: targetPackage,
      forceChooser,
    });
    Logger.info('Player', 'Reproductor externo lanzado correctamente', res);
    toast('↗ Abriendo en reproductor externo...', 'info', 2000);
    return true;
  } catch (err) {
    Logger.error('Player', 'Error lanzando reproductor externo', err?.message || err);
    return false;
  }
}

export async function showExternalPlayerPrompt(url, title) {
  const p = plugin();
  const hw = await evaluateHardware();
  const hasPlayer = hw?.hasExternalPlayer || false;

  const confirmed = await confirmDialog({
    title: 'Reproductor de Video',
    message: hasPlayer
      ? `El hardware de este dispositivo no soporta la decodificación interna de este formato. ¿Deseas abrir "${title || 'la transmisión'}" en el Reproductor Externo (VLC)?`
      : `El hardware de este dispositivo no cuenta con aceleración de video para este formato. Se recomienda instalar VLC for Android para reproducción fluida por software. ¿Deseas instalar VLC o abrir con otra app?`,
    okLabel: hasPlayer ? 'Abrir en VLC' : 'Instalar VLC',
    cancelLabel: 'Cancelar',
  });

  if (confirmed) {
    if (hasPlayer) {
      await openExternal({ url, title });
    } else {
      try {
        await p?.openPlayStore({ packageName: 'org.videolan.vlc' });
      } catch (_) {
        window.open('https://play.google.com/store/apps/details?id=org.videolan.vlc', '_blank');
      }
    }
  }
}

export const Player = {
  play,
  stop,
  pause,
  resume,
  seek,
  setVisibility,
  setLayout,
  enterFullscreen,
  exitFullscreen,
  isFullscreen,
  getCurrent,
  getVideo,
  getLastSaved,
  on,
  isNativeAvailable,
  evaluateHardware,
  getInstalledPlayers,
  openExternal,
  showExternalPlayerPrompt,
  pauseForExternal: pause,
};

// El shell nativo llama a window.Player.pauseForExternal() al pasar a segundo plano.
try { window.Player = Player; } catch (_) {}

export default Player;

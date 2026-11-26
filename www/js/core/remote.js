/* Control Remoto Móvil via servidor HTTP local (RemoteControlPlugin). */

import { store } from './store.js';
import { XtreamClient, normalizeServer } from './xtream.js';
import { parseXtreamLink } from '../ui/screens/login.js';
import Router, { navigate } from './router.js';
import { Player } from '../player/player.js';
import { toast } from '../ui/dom.js';
import { showCatalogLoadingModal } from '../ui/modals.js';
import { uid } from './util.js';
import { Logger } from './logger.js';

let initialized = false;
let isPlaying = false;

function plugin() {
  return window.Capacitor?.Plugins?.RemoteControlPlugin || null;
}

export function isRemoteSupported() {
  return !!plugin();
}

export async function startRemoteServer() {
  const p = plugin();
  if (!p) throw new Error('Control móvil disponible solo en la app Android.');
  return await p.startServer();
}

export async function stopRemoteServer() {
  const p = plugin();
  if (!p) return { running: false };
  return await p.stopServer();
}

function dispatchKey(key) {
  const target = document.activeElement && document.activeElement !== document.body
    ? document.activeElement
    : document;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function closeOpenModals() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.querySelectorAll('[data-cancel], .modal__close').forEach((btn) => btn.click());
}

async function handleLoadUrl(rawUrl, rawName) {
  const url = String(rawUrl || '').trim();
  if (!url) return;

  closeOpenModals();
  const xtreamCreds = parseXtreamLink(url);
  if (xtreamCreds) {
    await handleLoadXtream(xtreamCreds.server, xtreamCreds.username, xtreamCreds.password);
    return;
  }

  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('Protocolo inválido');
  } catch (_) {
    toast('URL recibida inválida', 'error');
    return;
  }

  const profile = {
    id: uid(),
    type: 'm3u',
    name: String(rawName || '').trim() || 'Lista desde móvil',
    url,
  };
  store.addExternalProfile(profile, null);
  store.saveNow();
  toast('Lista recibida desde el móvil', 'ok', 2000);
  await showCatalogLoadingModal(profile, {
    title: 'Cargando Lista desde Móvil',
    onComplete: () => navigate('/live'),
  });
}

async function handleLoadXtream(server, username, password) {
  closeOpenModals();
  try {
    const normalized = normalizeServer(server);
    let name = 'Xtream';
    try { name = new URL(normalized).host; } catch (_) {}
    const profile = {
      id: uid(),
      type: 'xtream',
      name,
      server: normalized,
      username: String(username || '').trim(),
      password: String(password || ''),
    };
    toast('Conectando Xtream desde el móvil...', 'info', 2000);
    const client = new XtreamClient(profile);
    const account = await client.account();
    if (!account.auth) {
      toast('Credenciales Xtream incorrectas', 'error');
      return;
    }
    store.addExternalProfile(profile, account);
    store.saveNow();
    await showCatalogLoadingModal(profile, {
      title: 'Cargando Servidor Xtream',
      onComplete: () => navigate('/live'),
    });
  } catch (err) {
    toast(err?.message || 'Error conectando Xtream desde el móvil', 'error');
  }
}

async function handleCommand(cmd) {
  if (!cmd || !cmd.type) return;
  Logger.info('Remote', `Comando recibido: ${cmd.type} ${cmd.action || ''}`);

  if (cmd.type === 'nav') {
    const map = {
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      ok: 'Enter',
    };
    if (map[cmd.action]) {
      dispatchKey(map[cmd.action]);
    } else if (cmd.action === 'back') {
      Router.back();
    } else if (cmd.action === 'home') {
      navigate(store.state.profile ? '/home' : '/login');
    }
    return;
  }

  if (cmd.type === 'media') {
    if (cmd.action === 'play_pause') {
      if (isPlaying) await Player.pause();
      else await Player.resume();
    } else if (cmd.action === 'stop') {
      await Player.stop();
    }
    return;
  }

  if (cmd.type === 'search') {
    const q = String(cmd.query || '').trim();
    if (!q || !store.state.profile) return;
    navigate('/search');
    setTimeout(() => {
      const inp = document.getElementById('global-search');
      if (inp) {
        inp.value = q;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 120);
    return;
  }

  if (cmd.type === 'load_url') {
    await handleLoadUrl(cmd.url, cmd.name);
    return;
  }

  if (cmd.type === 'load_xtream') {
    await handleLoadXtream(cmd.server, cmd.username, cmd.password);
  }
}

export function initRemoteControl() {
  if (initialized) return;
  initialized = true;

  Player.on('state', (st) => {
    if (typeof st?.playing === 'boolean') isPlaying = st.playing;
  });

  const p = plugin();
  if (!p?.addListener) return;
  try {
    p.addListener('remoteCommand', (data) => {
      handleCommand(data).catch((err) => Logger.warn('Remote', err?.message || 'Error en comando'));
    });
  } catch (_) {}
}

import { Logger } from './core/logger.js';
import { store } from './core/store.js';
import { Focus } from './core/focus.js';
import Router, { navigate, register, start } from './core/router.js';
import { initUI, toast, showPinModal } from './ui/dom.js';
import { showHardwareRecommendationModal } from './ui/modals.js';
import { isSessionUnlocked, unlockSession } from './core/parental.js';
import * as Parental from './core/parental.js';
import { parseHash, isTv } from './core/util.js';
import { initRemoteControl } from './core/remote.js';
import * as Player from './player/player.js';

import Login from './ui/screens/login.js';
import Home from './ui/screens/home.js';
import Live from './ui/screens/live.js';
import Movies from './ui/screens/movies.js';
import Series from './ui/screens/series.js';
import Search from './ui/screens/search.js';
import Settings from './ui/screens/settings.js';
import Detail from './ui/screens/detail.js';

function applySettings(state) {
  document.body.classList.toggle('reduce-motion', !!state.settings?.reduceMotion);
}

function bindGlobalClicks() {
  document.addEventListener('click', (event) => {
    const fav = event.target.closest?.('[data-fav]');
    if (fav) {
      event.preventDefault();
      event.stopPropagation();
      const [type, id] = String(fav.dataset.fav || '').split(':');
      const kind = type === 'series' ? 'series' : type === 'live' ? 'live' : 'movies';
      const item = store.findItem(kind, id) || (store.state.catalogs[kind] || []).find((i) => String(i.id) === String(id));
      if (!item) return;
      const active = store.toggleFavorite(item);
      document.querySelectorAll(`[data-fav="${type}:${id}"]`).forEach((el) => el.classList.toggle('is-active', active));
      toast(active ? 'Agregado a favoritos' : 'Quitado de favoritos', 'ok', 1500);
      return;
    }

    const go = event.target.closest?.('[data-go]');
    if (go) {
      event.preventDefault();
      const target = go.dataset.go;
      if (target) navigate(target);
      return;
    }

    const open = event.target.closest?.('[data-open]');
    if (open) {
      event.preventDefault();
      const type = open.dataset.open;
      const id = open.dataset.id;
      if (!type || id == null) return;

      if (open.dataset.locked === 'true' && !isSessionUnlocked()) {
        showPinModal({
          title: 'Contenido Protegido',
          subtitle: 'Ingresa el PIN para acceder a este contenido',
          onSuccess: () => {
            unlockSession(store.state.settings.parental?.sessionTimeout);
            if (type === 'live') navigate('/live', { play: id });
            else if (type === 'movie' || type === 'series') navigate('/detail', { type, id });
            else if (type === 'episode') navigate('/detail', { type: 'series', id });
          },
        }).catch(() => {});
        return;
      }

      if (type === 'live') navigate('/live', { play: id });
      else if (type === 'movie' || type === 'series') navigate('/detail', { type, id });
      else if (type === 'episode') navigate('/detail', { type: 'series', id });
    }
  });
}

function bindBackButton() {
  window.addEventListener('ui:back', () => Router.back());
  // ui:sair es manejado por router.js (start → sair()) → navega a /login.
  // NO agregar otro listener aquí para evitar conflictos con el bridge nativo.

  const App = window.Capacitor?.Plugins?.App;
  if (App?.addListener) {
    try {
      const backHandle = App.addListener('backButton', () => {
        Router.back();
      });
      if (backHandle?.catch) backHandle.catch(() => {});
      const stateHandle = App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          Logger.flush();
          const cur = Player.getCurrent?.();
          if (cur && cur.mode !== 'external') {
            Player.stop({ silent: true }).catch(() => {});
          }
        }
      });
      if (stateHandle?.catch) stateHandle.catch(() => {});
    } catch (_) {}
  }

  // Si no hay foco activo (por ejemplo, en el login), el back debe seguir funcionando.
  window.addEventListener('keydown', (event) => {
    if ((event.key === 'Escape' || event.key === 'BrowserBack') && !Focus.scope) {
      Router.back();
    }
  });
}

function guardRoutes() {
  window.addEventListener('hashchange', (event) => {
    const { path } = parseHash();
    if (!store.state.profile && path !== '/login') {
      event.stopImmediatePropagation();
      history.replaceState(null, '', '#/login');
      Router.render();
    }
  }, true);
}

function boot() {
  const tvDevice = isTv();
  document.documentElement.classList.toggle('device-tv', tvDevice);
  document.documentElement.classList.toggle('device-mobile', !tvDevice);

  Logger.init();
  store.load();
  applySettings(store.state);
  store.subscribe(applySettings);

  initUI();
  Focus.init();
  initRemoteControl();
  bindGlobalClicks();
  bindBackButton();
  guardRoutes();

  register('/login', Login);
  register('/home', Home);
  register('/live', Live);
  register('/movies', Movies);
  register('/series', Series);
  register('/search', Search);
  register('/settings', Settings);
  register('/detail', Detail);

  if (!location.hash) {
    const initial = store.state.profile ? '#/home' : '#/login';
    history.replaceState(null, '', initial);
  }

  start();

  const bootEl = document.getElementById('boot');
  const bootVideo = document.getElementById('boot-video');
  const hideBoot = () => bootEl?.classList.add('is-hidden');

  if (store.state.settings?.reduceMotion || !bootVideo) {
    setTimeout(hideBoot, 900);
  } else {
    const fallbackTimer = setTimeout(hideBoot, 4200);
    const finishBoot = () => {
      clearTimeout(fallbackTimer);
      hideBoot();
    };
    const showVideo = () => bootVideo.classList.add('is-ready');
    bootVideo.addEventListener('loadeddata', showVideo, { once: true });
    bootVideo.addEventListener('playing', showVideo, { once: true });
    if (bootVideo.readyState >= 2) showVideo();
    bootVideo.addEventListener('ended', finishBoot, { once: true });
    bootVideo.addEventListener('error', finishBoot, { once: true });
    bootVideo.play?.().catch(() => {});
  }

  document.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('gesturestart', (event) => event.preventDefault());

  window.Player = Player;
  window.EduIPTV = { store, Router, Focus, Logger, navigate, Player, Parental, isTv };
  window.FreeIPTV = window.EduIPTV;
  Logger.info('System', 'EDU-IPTV PRO 1.0.0 iniciado');

  // Valoración de capacidades de hardware al iniciar la aplicación
  Player.evaluateHardware().then((hw) => {
    if (hw?.isHardwareLimited) {
      Logger.warn('Hardware', 'Hardware limitado detectado: ' + (hw.statusDetail || ''));
      if (hw.hasRecommendedExternalPlayer) {
        toast('Modo inteligente: Reproductor externo compatible listo', 'info', 3500);
      } else {
        const key = 'edu_iptv_hw_prompt_v1';
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, '1');
          setTimeout(() => showHardwareRecommendationModal(hw), 4400);
        }
      }
    } else {
      Logger.info('Hardware', 'Hardware estándar con aceleración de video OK');
    }
  }).catch(() => {});
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

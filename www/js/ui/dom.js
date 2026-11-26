/* Helpers de UI: iconos, topbar, tarjetas, modales, toasts. */

import { escapeAttr, escapeHtml, fmtDuration, canCast, isWifiConnected, openCastSettings } from '../core/util.js';
import { Focus } from '../core/focus.js';
import { store } from '../core/store.js';
import { isItemLocked, isSessionUnlocked } from '../core/parental.js';
import { openFreeCountriesModal, showCatalogLoadingModal, openExternalListsModal, openExitModal, showPinModal, openManageCategoriesModal } from './modals.js';
import { switchToProfile } from '../core/catalog.js';

export { openFreeCountriesModal, showCatalogLoadingModal, openExternalListsModal, openExitModal, showPinModal, openManageCategoriesModal };

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>',
  live: '<rect x="2" y="6" width="20" height="13" rx="3"/><path d="m8 3 4 3 4-3"/><circle cx="8" cy="12" r="1.2" fill="currentColor" stroke="none"/><path d="M12 12h5"/>',
  movie: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4"/>',
  series: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M8 3v4M16 3v4M8 12h8M8 15h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.09A1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  tv: '<rect x="2" y="7" width="20" height="13" rx="2"/><path d="m7 3 5 4 5-4"/>',
  fullscreen: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  warning: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  earth: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  crown: '<path d="m3 7 4 10h10l4-10-5 5-4-8-4 8-5-5z" fill="currentColor" stroke="none"/><rect x="5" y="18" width="14" height="2" rx="1" fill="currentColor" stroke="none"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
  external: '<path d="M14 3h7v7M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
  wifi: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.3a10 10 0 0 1 14 0M8.5 15.8a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  starFilled: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/>',
  cast: '<path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><line x1="2" y1="20" x2="2.01" y2="20"/>',
};

export function icon(name, cls = 'icon') {
  const path = ICONS[name] || ICONS.info;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function brand() {
  return `<div class="app-header__brand">
    <div class="brand-logo-icon">${icon('tv', 'icon icon--md')}</div>
    <div class="brand-titles">
      <div class="brand-title">EDU-IPTV <span>PRO</span></div>
      <div class="brand-version">v.1.0.0</div>
    </div>
  </div>`;
}

/**
 * Header unificado de la aplicacion que homologa el diseno premium de la version de referencia.
 */
export function topbar({
  activeTab = '',
  title = '',
  subtitle = '',
  back = false,
  actions = '',
  sair = true,
  showBrand = true,
} = {}) {
  const profile = store.state.profile;
  const isFree = store.state.settings.modo === 'free' || profile?.id?.startsWith('free-') || (Array.isArray(profile?.urls) && profile?.urls.length > 1);
  const isXtream = !isFree;

  // Auto-detectar pestaña activa según ruta si no viene explícita
  let currentTab = activeTab;
  if (!currentTab) {
    const hash = (location.hash || '').toLowerCase();
    if (hash.includes('live')) currentTab = 'live';
    else if (hash.includes('movies') || hash.includes('movie')) currentTab = 'movies';
    else if (hash.includes('series')) currentTab = 'series';
  }

  const backBtn = back
    ? `<button class="topbar__back icon-btn" data-focusable data-back aria-label="Volver">${icon('back')}</button>`
    : '';

  return `<header class="app-header">
    <div class="app-header__left">
      ${backBtn}
      ${showBrand ? brand() : ''}
      ${title && !showBrand ? `<div class="topbar__title"><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>` : ''}
    </div>

    <div class="app-header__center">
      <!-- Selector de Modo A / B (FREE vs PREMIUM) -->
      <div class="mode-switcher" id="mode-switcher" role="group" aria-label="Modo de Contenido">
        <button class="mode-btn mode-btn--free${isFree ? ' mode-btn--active-free' : ''}" data-focusable data-header-action="mode-free" title="Modo Free: Canales Públicos IPTV-org">
          ${icon('globe', 'icon icon--sm')} <span>FREE</span>
        </button>
        <button class="mode-btn mode-btn--premium${isXtream ? ' mode-btn--active-premium' : ''}" data-focusable data-header-action="mode-premium" title="Modo Premium: Panel Xtream / Listas Privadas">
          ${icon('crown', 'icon icon--sm')} <span>PREMIUM</span>
        </button>
      </div>

      <!-- Pestañas de Navegación Principal -->
      <nav class="app-header__tabs" role="tablist">
        <button class="tab${currentTab === 'live' ? ' tab--active' : ''}" data-focusable data-go="/live" role="tab" aria-selected="${currentTab === 'live'}">
          TV LIVE
        </button>
        <button class="tab${currentTab === 'movies' ? ' tab--active' : ''}" data-focusable data-go="/movies" role="tab" aria-selected="${currentTab === 'movies'}">
          PELÍCULAS
        </button>
        <button class="tab${currentTab === 'series' ? ' tab--active' : ''}" data-focusable data-go="/series" role="tab" aria-selected="${currentTab === 'series'}">
          SERIES
        </button>
      </nav>
    </div>

    <div class="app-header__actions">
      <!-- Búsqueda Global -->
      <button class="icon-btn" data-focusable data-go="/search" title="Buscar contenido" aria-label="Buscar">
        ${icon('search')}
      </button>

      <!-- Transmitir pantalla a Smart TV (Móvil) -->
      ${canCast() ? `
        <button class="icon-btn icon-btn--cast" data-focusable data-header-action="cast" title="Transmitir / Duplicar a Smart TV" aria-label="Transmitir">
          ${icon('cast')}
        </button>
      ` : ''}

      <!-- Ajustes -->
      <button class="icon-btn" data-focusable data-go="/settings" title="Ajustes" aria-label="Ajustes">
        ${icon('settings')}
      </button>

      ${actions}

      <!-- Salir / Cambiar cuenta -->
      ${sair ? `
        <button class="icon-btn icon-btn--danger" data-focusable data-header-action="sair" title="Salir de la aplicación" aria-label="Salir">
          ${icon('power')}
        </button>
      ` : ''}
    </div>
  </header>`;
}

export function actionButton(iconName, label, attrs = '') {
  return `<button class="btn btn--ghost btn--icon" data-focusable aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}" ${attrs}>${icon(iconName)}</button>`;
}

// Alias para evitar errores si alguna pantalla lo invoca
export const iconButton = actionButton;

export function poster(item, { progress = null } = {}) {
  const isLive = item.streamType === 'live';
  const isEpisode = item.streamType === 'episode';
  const type = isEpisode ? 'series' : item.streamType === 'series' ? 'series' : isLive ? 'live' : 'movie';
  const openId = isEpisode ? (item.seriesId || item.id) : item.id;
  const pct = progress && progress.duration > 0
    ? Math.min(100, Math.round((progress.position / progress.duration) * 100))
    : 0;
  const fav = item.__fav ? ' is-active' : '';
  const numRating = Number(String(item.rating || '').replace(',', '.'));
  const ratingStr = (Number.isFinite(numRating) && numRating > 0)
    ? numRating.toFixed(1)
    : '';

  const isLocked = isItemLocked(item) && !isSessionUnlocked();

  return `<button class="poster${isLive ? ' poster--live' : ''}${isLocked ? ' is-locked' : ''}" data-focusable data-open="${type}" data-id="${escapeAttr(openId)}" ${isLocked ? 'data-locked="true"' : ''} aria-label="${escapeAttr(item.name)}">
    <div class="poster__media">
      ${item.icon ? `<img src="${escapeAttr(item.icon)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
      ${isLocked ? `<span class="poster__badge" style="background:#ff9800;color:#000;font-weight:900">🔒 BLOQUEADO</span>` : isLive ? `<span class="poster__badge">LIVE</span>` : ratingStr ? `<span class="poster__rating-badge">★ ${escapeHtml(ratingStr)}</span>` : item.year ? `<span class="poster__badge">${escapeHtml(item.year)}</span>` : ''}
      ${isEpisode ? '' : `<span class="poster__fav${fav}" data-fav="${type}:${escapeAttr(item.id)}" role="button" aria-label="Favorito">${icon('heart', 'icon icon--sm')}</span>`}
      ${pct ? `<div class="poster__bar" style="position:absolute;left:6px;right:6px;bottom:6px"><i style="width:${pct}%"></i></div>` : ''}
    </div>
    <div class="poster__body">
      <div class="poster__title">${isLocked ? '🔒 ' : ''}${escapeHtml(item.name)}</div>
    </div>
  </button>`;
}

export function channelRow(item, { active = false } = {}) {
  const isFav = store.isFavorite(item);
  const isLocked = isItemLocked(item) && !isSessionUnlocked();
  return `<button class="channel-row${active ? ' is-active' : ''}${isLocked ? ' is-locked' : ''}" data-focusable data-channel="${escapeAttr(item.id)}" ${isLocked ? 'data-channel-locked="true"' : ''} aria-label="${escapeAttr(item.name)}">
    <div class="channel-row__logo-box">
      ${item.icon ? `<img class="channel-row__logo" src="${escapeAttr(item.icon)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentElement.style.visibility='hidden'">` : ''}
    </div>
    <span class="channel-row__name">${isLocked ? '🔒 ' : ''}${escapeHtml(item.name)}</span>
    ${isFav ? `<span class="channel-row__fav-star" title="Favorito">⭐</span>` : ''}
  </button>`;
}

export function searchItem(item) {
  const type = item.streamType;
  const meta = type === 'live' ? 'Canal en vivo' : type === 'series' ? 'Serie' : 'Película';
  const isLocked = isItemLocked(item) && !isSessionUnlocked();
  return `<button class="search-item${isLocked ? ' is-locked' : ''}" data-focusable data-open="${type === 'live' ? 'live' : type}" data-id="${escapeAttr(item.id)}" ${isLocked ? 'data-locked="true"' : ''}>
    ${item.icon ? `<img src="${escapeAttr(item.icon)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : '<span style="width:44px;height:44px;border-radius:8px;background:var(--surface-2);flex:0 0 auto"></span>'}
    <span>
      <span class="search-item__title">${isLocked ? '🔒 ' : ''}${escapeHtml(item.name)}</span>
      <span class="search-item__meta">${meta}${item.year ? ' · ' + escapeHtml(item.year) : ''}</span>
    </span>
  </button>`;
}

export function emptyState({ iconName = 'info', title = 'Sin contenido', text = '', action = '' } = {}) {
  return `<div class="empty">
    <div class="empty__icon">${icon(iconName, 'icon icon--lg')}</div>
    <h3>${escapeHtml(title)}</h3>
    ${text ? `<p>${escapeHtml(text)}</p>` : ''}
    ${action}
  </div>`;
}

export function skeletonGrid(count = 12) {
  return `<div class="posters">${Array.from({ length: count }, () => '<div class="skeleton skeleton--poster"></div>').join('')}</div>`;
}

export function spinner(label = 'Cargando...') {
  return `<div class="empty"><div class="spinner" style="border-color:rgba(0,243,255,.2);border-top-color:var(--accent)"></div><p>${escapeHtml(label)}</p></div>`;
}

/* ---------- Toasts ---------- */
let lastToastMsg = '';
let lastToastTime = 0;

export function toast(message, type = 'info', timeout = 2500) {
  // 1. No mostrar notificaciones si la app está en segundo plano
  if (typeof document !== 'undefined' && document.hidden) return;
  if (!message || typeof message !== 'string') return;

  const cleanMsg = message.trim();
  if (!cleanMsg) return;

  // Si estamos en entorno nativo (Android), mostrar en el HUD nativo de primer plano
  if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.ExoPlayerPlugin?.showToast) {
    try {
      window.Capacitor.Plugins.ExoPlayerPlugin.showToast({ message: cleanMsg, type, duration: timeout });
      return; // El HUD nativo garantiza primer plano absoluto sin solapamientos
    } catch (_) {}
  }

  const root = document.getElementById('toast-root');
  if (!root) return;

  // 2. Limpiar toasts anteriores para que NUNCA se solapen entre sí
  root.innerHTML = '';

  lastToastMsg = cleanMsg;
  lastToastTime = Date.now();

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = cleanMsg;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.style.transition = 'opacity .2s, transform .2s';
    setTimeout(() => {
      el.remove();
      if (lastToastMsg === cleanMsg) lastToastMsg = '';
    }, 220);
  }, timeout);
}

/* ---------- Modales ---------- */
const modalStack = [];

export function modal({ title = '', body = '', footer = '', wide = false, onClose = null } = {}) {
  const root = document.getElementById('modal-root');
  if (!root) return null;
  const previousScope = Focus.scope;

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;z-index:1000;overflow:hidden;';
  wrap.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal${wide ? ' modal--wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal__head">
        <h2>${escapeHtml(title)}</h2>
        <button class="btn btn--ghost btn--icon" data-focusable data-modal-close aria-label="Cerrar">${icon('close')}</button>
      </div>
      <div class="modal__body">${body}</div>
      ${footer ? `<div class="modal__foot">${footer}</div>` : ''}
    </div>`;
  root.appendChild(wrap);
  root.classList.add('is-open');
  try { window.Player?.setVisibility?.(false); } catch (_) {}

  const controller = {
    root: wrap,
    body: wrap.querySelector('.modal__body'),
    footer: wrap.querySelector('.modal__foot'),
    close() {
      const index = modalStack.indexOf(controller);
      if (index >= 0) modalStack.splice(index, 1);
      wrap.remove();
      if (!modalStack.length) {
        root.classList.remove('is-open');
        try { window.Player?.setVisibility?.(true); } catch (_) {}
        if (previousScope && previousScope.isConnected) Focus.attach(previousScope, { autoFocus: false });
      }
      try { onClose?.(); } catch (_) {}
    },
  };

  wrap.querySelector('[data-modal-close]')?.addEventListener('click', () => controller.close());
  wrap.querySelector('.modal-backdrop')?.addEventListener('click', () => controller.close());
  modalStack.push(controller);
  Focus.attach(wrap, { autoFocus: true });
  return controller;
}

export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (top) top.close();
}

export function confirmDialog({ title = 'Confirmar', message = '', confirmText = 'Aceptar', okLabel, cancelLabel = 'Cancelar', danger = false } = {}) {
  const actionText = okLabel || confirmText;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      m?.close();
      resolve(value);
    };
    const m = modal({
      title,
      body: `<p style="color:var(--text-2);line-height:1.55;font-size:.9rem">${escapeHtml(message)}</p>`,
      footer: `<button class="btn btn--ghost" data-focusable data-cancel>${escapeHtml(cancelLabel)}</button>
               <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-focusable data-ok>${escapeHtml(actionText)}</button>`,
      onClose: () => finish(false),
    });
    m?.root.querySelector('[data-cancel]')?.addEventListener('click', () => finish(false));
    m?.root.querySelector('[data-ok]')?.addEventListener('click', () => finish(true));
  });
}

export function initUI() {
  window.addEventListener('toast', (event) => {
    const { message, type, timeout } = event.detail || {};
    if (message) toast(message, type, timeout);
  });

  window.addEventListener('modal:close', closeTopModal);

  document.addEventListener('click', (event) => {
    const back = event.target.closest?.('[data-back]');
    if (back) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('ui:back'));
      return;
    }

    const sair = event.target.closest?.('[data-sair]');
    if (sair) {
      event.preventDefault();
      openExitModal();
      return;
    }

    const headerAction = event.target.closest?.('[data-header-action]');
    if (headerAction) {
      event.preventDefault();
      const action = headerAction.dataset.headerAction;
      if (action === 'countries') {
        openFreeCountriesModal();
      } else if (action === 'lists') {
        openExternalListsModal();
      } else if (action === 'sair') {
        openExitModal();
      } else if (action === 'cast') {
        const onWifi = isWifiConnected();
        if (!onWifi) {
          toast('Tip: Conecta tu móvil a la misma red Wi-Fi de tu Smart TV', 'info', 3000);
        }
        const ok = openCastSettings();
        if (ok) {
          toast('Abriendo opciones de transmisión de pantalla...', 'ok', 2000);
        } else {
          toast('Opciones de transmisión no disponibles en este móvil', 'error', 2500);
        }
      } else if (action === 'mode-free') {
        const freeProf = store.state.freeProfile;
        if (freeProf) {
          if (store.state.profile?.id === freeProf.id) {
            toast(`Ya estás en Modo FREE (${freeProf.name})`, 'info', 2000);
          } else {
            showCatalogLoadingModal(freeProf, {
              title: `Cambiando a ${freeProf.name}`,
              onComplete: () => {
                store.switchProfile(freeProf);
                toast(`Modo FREE activado (${freeProf.name})`, 'ok', 3000);
                navigate('/live');
              },
            }).catch((err) => {
              toast(`Error: ${err?.message || err}`, 'error');
            });
          }
        } else {
          openFreeCountriesModal();
        }
      } else if (action === 'mode-premium') {
        const premProf = store.state.premiumProfile;
        if (premProf) {
          if (store.state.profile?.id === premProf.id) {
            toast(`Ya estás en Modo PREMIUM (${premProf.name})`, 'info', 2000);
          } else {
            showCatalogLoadingModal(premProf, {
              title: `Cambiando a ${premProf.name}`,
              onComplete: () => {
                store.switchProfile(premProf);
                toast(`Modo PREMIUM activado (${premProf.name})`, 'ok', 3000);
                navigate('/live');
              },
            }).catch((err) => {
              toast(`Error: ${err?.message || err}`, 'error');
            });
          }
        } else {
          openExternalListsModal();
        }
      }
    }
  });
}

export function ratingText(value) {
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return '';
  return n > 5 ? n.toFixed(1) : `${n.toFixed(1)}/5`;
}

export function progressLabel(progress) {
  if (!progress) return '';
  const left = Math.max(0, (progress.duration || 0) - (progress.position || 0));
  return left > 0 ? `Faltan ${fmtDuration(left)}` : '';
}

export default {
  icon,
  brand,
  topbar,
  actionButton,
  iconButton,
  poster,
  channelRow,
  searchItem,
  emptyState,
  skeletonGrid,
  spinner,
  toast,
  modal,
  closeTopModal,
  confirmDialog,
  openFreeCountriesModal,
  showCatalogLoadingModal,
  openExternalListsModal,
  openExitModal,
  showPinModal,
  openManageCategoriesModal,
  initUI,
  ratingText,
  progressLabel,
};

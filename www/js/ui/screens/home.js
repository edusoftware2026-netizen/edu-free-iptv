import { store } from '../../core/store.js';
import { loadCatalog, refreshCatalog } from '../../core/catalog.js';
import { navigate } from '../../core/router.js';
import { Focus } from '../../core/focus.js';
import { shouldHideItem } from '../../core/parental.js';
import { actionButton, emptyState, icon, poster, skeletonGrid, topbar, toast } from '../dom.js';
import { escapeHtml, fmtDate } from '../../core/util.js';

function daysLeft(expDate) {
  const n = Number(expDate);
  if (!Number.isFinite(n) || n <= 0) return null;
  const diff = new Date(n * 1000).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function statusOf(profile, account) {
  if (!profile) return { text: 'Sin cuenta', cls: 'muted' };
  if (profile.type === 'm3u') return { text: 'Lista gratis', cls: 'accent' };
  const status = account?.status || 'Desconocido';
  const map = {
    Active: { text: 'Activa', cls: 'ok' },
    Trial: { text: 'Prueba', cls: 'warn' },
    Expired: { text: 'Vencida', cls: 'danger' },
    Disabled: { text: 'Deshabilitada', cls: 'danger' },
    Banned: { text: 'Bloqueada', cls: 'danger' },
  };
  return map[status] || { text: status, cls: 'muted' };
}

function hero(root) {
  const { profile, account } = store.state;
  const status = statusOf(profile, account);
  const days = daysLeft(account?.expDate);
  const pct = days == null ? 100 : Math.max(4, Math.min(100, (days / 30) * 100));
  const ringValue = days == null ? '∞' : String(days);
  const ringLabel = days == null ? 'sin limite' : 'dias';
  const conn = profile?.type === 'xtream'
    ? `${account?.activeConnections ?? 0}/${account?.maxConnections || '?'} conexiones`
    : 'Sin conexiones';
  const server = profile?.type === 'xtream'
    ? (profile.server || '').replace(/^https?:\/\//, '')
    : (profile?.name || 'Lista M3U');

  return `<section class="hero">
    <div class="hero__content">
      <div class="hero__tag">${icon('wifi', 'icon icon--sm')} ${profile?.type === 'xtream' ? 'Cuenta Xtream' : 'Lista M3U'}</div>
      <h2 class="hero__title">${escapeHtml(profile?.name || 'EDU-IPTV PRO')}</h2>
      <div class="hero__meta">
        <span>Estado: <b class="${status.cls}">${status.text}</b></span>
        ${account?.expDate ? `<span>Vence: <b>${escapeHtml(fmtDate(account.expDate))}</b></span>` : ''}
        <span>${escapeHtml(conn)}</span>
        <span class="ellipsis" style="max-width:320px">${escapeHtml(server)}</span>
      </div>
      <div class="hero__actions">
        <button class="btn btn--primary" id="hero-btn-live" data-focusable data-go="/live">${icon('live', 'icon icon--sm')} Ver Live</button>
        <button class="btn btn--ghost" data-focusable data-go="/movies">${icon('movie', 'icon icon--sm')} Peliculas</button>
        <button class="btn btn--ghost" data-focusable data-go="/series">${icon('series', 'icon icon--sm')} Series</button>
      </div>
      <div id="home-progress" class="hidden" style="margin-top:16px;max-width:420px">
        <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--muted);margin-bottom:6px">
          <span id="home-progress-label">Cargando catalogo...</span>
          <span id="home-progress-pct">0%</span>
        </div>
        <div class="poster__bar" style="height:4px"><i id="home-progress-bar" style="width:0%"></i></div>
      </div>
    </div>
    <div class="hero__ring" style="--p:${pct}%">
      <span>${ringValue}</span>
      <small>${ringLabel}</small>
    </div>
  </section>`;
}

function statCard(iconName, value, label, route, attrs = '') {
  return `<button class="stat" data-focusable ${attrs || `data-go="${route}"`}>
    <span class="stat__icon">${icon(iconName)}</span>
    <span>
      <span class="stat__value" data-count="${route || label}">${value}</span>
      <span class="stat__label">${label}</span>
    </span>
  </button>`;
}

function rowSection(title, items, { route = '', progressMap = null, empty = '', id = '' } = {}) {
  if (!items.length) {
    return empty ? `<section class="section"${id ? ` id="${id}"` : ''}><div class="section__head"><h2 class="section__title">${escapeHtml(title)}</h2></div>${empty}</section>` : '';
  }
  return `<section class="section"${id ? ` id="${id}"` : ''}>
    <div class="section__head">
      <h2 class="section__title">${escapeHtml(title)}</h2>
      ${route ? `<button class="section__link" data-focusable data-go="${route}">Ver todo ${icon('chevron', 'icon icon--sm')}</button>` : ''}
    </div>
    <div class="row">
      ${items.map((item) => {
        const progress = progressMap?.[store.itemKey(item)] || null;
        const fav = store.isFavorite(item);
        return poster({ ...item, __fav: fav }, { progress });
      }).join('')}
    </div>
  </section>`;
}

function homeBody(root) {
  const s = store.state;
  const counts = s.counts;
  const loading = s.loading.catalog;
  const catalogs = s.catalogs;

  if (s.error && !catalogs.live.length) {
    return `${hero(root)}
      ${emptyState({
        iconName: 'warning',
        title: 'No se pudo cargar el catalogo',
        text: s.error,
        action: `<button class="btn btn--primary" data-focusable data-retry>${icon('refresh', 'icon icon--sm')} Reintentar</button>`,
      })}`;
  }

  const progressMap = s.progress;
  const continueItems = Object.values(progressMap)
    .filter((p) => p && !p.finished && p.position > 5)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 12);

  const favorites = store.favoritesList().filter((i) => !shouldHideItem(i)).slice(0, 12);

  return `${hero(root)}
    <div class="stats stats--dashboard">
      ${statCard('live', counts.live, 'Canales', '/live')}
      ${statCard('movie', counts.movies, 'Películas', '/movies')}
      ${statCard('series', counts.series, 'Series', '/series')}
      ${statCard('heart', favorites.length, 'Favoritos', '/live')}
    </div>

    ${continueItems.length ? rowSection('Continuar viendo', continueItems, { route: '', progressMap }) : ''}
    ${favorites.length ? rowSection('Tus favoritos', favorites, { route: '/live', id: 'home-favorites' }) : ''}

    ${!catalogs.live.length && loading ? `<section class="section"><div class="section__head"><h2 class="section__title">Preparando tu contenido</h2></div>${skeletonGrid(8)}</section>` : ''}

    ${!catalogs.live.length && !loading && !s.error ? emptyState({
      iconName: 'tv',
      title: 'Catálogo vacío',
      text: 'Actualiza el catálogo para comenzar.',
      action: `<button class="btn btn--primary" data-focusable data-retry>${icon('refresh', 'icon icon--sm')} Actualizar</button>`,
    }) : ''}`;
}

function paint(root) {
  const s = store.state;
  root.innerHTML = `<section class="screen">
    ${topbar({
      title: 'Inicio',
      subtitle: s.profile?.type === 'xtream' ? 'Panel Xtream' : 'Lista M3U',
      actions: actionButton('refresh', 'Actualizar catalogo', 'data-refresh'),
      sair: true,
    })}
    <div class="screen__body">
      <div class="page">
        <div class="home">${homeBody(root)}</div>
      </div>
    </div>
  </section>`;
}

async function load(root, { force = false } = {}) {
  const profile = store.state.profile;
  if (!profile) return;
  const progress = root.querySelector('#home-progress');
  const bar = root.querySelector('#home-progress-bar');
  const pct = root.querySelector('#home-progress-pct');
  const label = root.querySelector('#home-progress-label');
  if (progress) progress.classList.remove('hidden');

  try {
    const runner = force ? refreshCatalog : loadCatalog;
    await runner(profile, {
      onProgress: (p, text) => {
        if (progress) progress.classList.remove('hidden');
        const percent = Math.min(100, Math.max(0, Math.round((p || 0) * 100)));
        if (bar) bar.style.width = `${percent}%`;
        if (pct) pct.textContent = `${percent}%`;
        if (label && text) label.textContent = text;
      },
    });
    store.setError(null);
    if (bar) bar.style.width = '100%';
    if (pct) pct.textContent = '100%';
    if (label) label.textContent = 'Listo';
    setTimeout(() => {
      paint(root);
      Focus.attach(root, { initial: '#hero-btn-live' });
    }, 450);
  } catch (err) {
    store.setError(err?.message || 'Error cargando catalogo');
    paint(root);
    Focus.attach(root, { initial: '#hero-btn-live' });
    toast(err?.message || 'No se pudo cargar el catalogo', 'error');
  }
}

export default {
  async mount(root) {
    if (!store.state.profile) {
      navigate('/login', {}, { replace: true });
      return;
    }
    paint(root);
    Focus.attach(root, { initial: '#hero-btn-live' });

    let lastUpdated = store.state.catalogUpdatedAt;
    let unsub = store.subscribe((state) => {
      if (state.catalogUpdatedAt && state.catalogUpdatedAt !== lastUpdated) {
        lastUpdated = state.catalogUpdatedAt;
        paint(root);
        Focus.attach(root, { initial: '#hero-btn-live' });
      }
    });

    this._onClick = (event) => {
      const retry = event.target.closest('[data-retry]');
      if (retry) {
        event.preventDefault();
        load(root, { force: true });
        return;
      }
      const scroll = event.target.closest('[data-scroll]');
      if (scroll) {
        event.preventDefault();
        const target = document.getElementById(scroll.dataset.scroll);
        if (target) {
          target.scrollIntoView({ block: 'start' });
          const first = target.querySelector('.poster');
          if (first) Focus.focus(first, { scroll: false });
        } else {
          toast('Todavia no tienes favoritos', 'info');
        }
        return;
      }
      const refresh = event.target.closest('[data-refresh]');
      if (refresh) {
        event.preventDefault();
        toast('Actualizando catalogo...', 'info');
        load(root, { force: true });
      }
    };
    root.addEventListener('click', this._onClick);

    if (!store.state.catalogs.live.length || store.state.error) {
      load(root);
    }

    this._unsub = unsub;
  },

  unmount() {
    this._unsub?.();
    this._unsub = null;
    if (this._onClick) {
      document.getElementById('app')?.removeEventListener('click', this._onClick);
      this._onClick = null;
    }
  },
};

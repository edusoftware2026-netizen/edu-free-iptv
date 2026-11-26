import { store } from '../../core/store.js';
import { getDetails, streamUrl } from '../../core/catalog.js';
import { navigate } from '../../core/router.js';
import { Focus } from '../../core/focus.js';
import { Player } from '../../player/player.js';
import { isItemLocked, isSessionUnlocked, unlockSession } from '../../core/parental.js';
import { emptyState, icon, ratingText, spinner, topbar, toast, showPinModal } from '../dom.js';
import { escapeAttr, escapeHtml, fmtDateShort, fmtDuration, canCast, isWifiConnected, openCastSettings } from '../../core/util.js';

function findItem(type, id) {
  const list = type === 'series' ? 'series' : 'movies';
  return store.findItem(list, id) || (store.state.catalogs[list] || []).find((i) => String(i.id) === String(id)) || null;
}

function metaRow(parts) {
  return parts.filter(Boolean).map((p) => `<span>${p}</span>`).join('<span class="dot">·</span>');
}

function pctOf(item) {
  const p = store.getProgress(item);
  if (!p || !p.duration) return 0;
  return Math.min(100, Math.round((p.position / p.duration) * 100));
}

export default {
  async mount(root, params = {}) {
    if (!store.state.profile) {
      navigate('/login', {}, { replace: true });
      return;
    }
    this.root = root;
    this.profile = store.state.profile;
    this.type = params.type === 'series' ? 'series' : 'movie';
    this.item = findItem(this.type, params.id);
    this.handlers = [];
    this.rootBound = false;
    this.unsubs = [];

    if (!this.item) {
      root.innerHTML = `<section class="screen">${topbar({ title: 'Detalle', back: true, sair: true })}<div class="screen__body"><div class="page page--center">${emptyState({
        iconName: 'warning',
        title: 'Contenido no encontrado',
        text: 'Vuelve al catalogo y selecciona otro titulo.',
        action: `<button class="btn btn--primary" data-focusable data-go="/home">Volver al inicio</button>`,
      })}</div></div></section>`;
      Focus.attach(root);
      return;
    }

    this.paintLoading();
    try {
      this.data = await getDetails(this.profile, this.item);
    } catch (err) {
      this.data = { item: this.item };
      toast('No se pudo cargar la ficha completa', 'warn');
    }

    if (this.type === 'series') {
      const seasons = this.data?.series?.seasons || [];
      const progressSeason = seasons.find((s) => s.episodes.some((e) => store.getProgress(e)?.position > 5))?.season;
      this.season = progressSeason ?? seasons[0]?.season ?? 0;
    }

    this.paint();
    Focus.attach(root, { initial: '.detail__actions [data-focusable]' });

    this.unsubs.push(Player.on('progress', (p) => this.onProgress(p)));
    this.unsubs.push(Player.on('error', ({ message }) => toast(message || 'Error de reproduccion', 'error')));
  },

  paintLoading() {
    this.root.innerHTML = `<section class="screen">
      ${topbar({ title: this.item.name, back: true, sair: true })}
      <div class="screen__body"><div class="page page--center">${spinner('Cargando ficha...')}</div></div>
    </section>`;
  },

  paint() {
    const item = this.item;
    const info = this.data?.info || {};
    const series = this.data?.series;
    const isSeries = this.type === 'series';

    const posterSrc = isSeries ? (series?.info?.cover || item.icon) : (info.poster || item.icon);
    const backdrop = isSeries ? (series?.info?.backdrop || posterSrc) : (info.backdrop || posterSrc);
    const title = isSeries ? (series?.info?.name || item.name) : (info.name || item.name);
    const plot = isSeries ? (series?.info?.plot || item.plot || '') : (info.plot || '');
    const year = isSeries ? (series?.info?.releaseDate || item.year || '') : (info.year || item.year || '');
    const rating = isSeries ? (series?.info?.rating || item.rating || '') : (info.rating || item.rating || '');
    const genre = isSeries ? (series?.info?.genre || '') : (info.genre || '');
    const duration = isSeries ? '' : (info.duration || '');
    const cast = isSeries ? (series?.info?.cast || '') : (info.cast || '');
    const director = isSeries ? (series?.info?.director || '') : (info.director || '');
    const fav = store.isFavorite(item);
    const progress = store.getProgress(item);
    const progressPct = pctOf(item);

    let actionButtonsHtml = '';
    if (isSeries) {
      actionButtonsHtml = `
        <button class="btn btn--primary" data-focusable data-play-primary>
          ${icon('play', 'icon icon--sm')} Ver primer episodio
        </button>`;
    } else if (progressPct > 0) {
      actionButtonsHtml = `
        <button class="btn btn--primary" data-focusable data-play-resume>
          ${icon('play', 'icon icon--sm')} Continuar viendo (${progressPct}%)
        </button>
        <button class="btn btn--ghost" data-focusable data-play-restart title="Comenzar desde el inicio">
          ${icon('refresh', 'icon icon--sm')} Reiniciar
        </button>
        <button class="btn btn--ghost" data-focusable data-play-external title="Abrir en VLC / Reproductor Externo">
          ${icon('external', 'icon icon--sm')} VLC
        </button>
        ${canCast() ? `
          <button class="btn btn--ghost" data-focusable data-cast title="Transmitir / Duplicar a Smart TV">
            ${icon('cast', 'icon icon--sm')} Transmitir
          </button>
        ` : ''}`;
    } else {
      actionButtonsHtml = `
        <button class="btn btn--primary" data-focusable data-play-primary>
          ${icon('play', 'icon icon--sm')} Reproducir
        </button>
        <button class="btn btn--ghost" data-focusable data-play-external title="Abrir en VLC / Reproductor Externo">
          ${icon('external', 'icon icon--sm')} VLC
        </button>
        ${canCast() ? `
          <button class="btn btn--ghost" data-focusable data-cast title="Transmitir / Duplicar a Smart TV">
            ${icon('cast', 'icon icon--sm')} Transmitir
          </button>
        ` : ''}`;
    }

    this.root.innerHTML = `<section class="screen">
      ${topbar({ title: isSeries ? 'Serie' : 'Pelicula', subtitle: item.name, back: true, sair: true })}
      <div class="screen__body">
        <div class="page">
          <div class="detail">
            <section class="detail__hero">
              ${backdrop ? `<img class="detail__backdrop" src="${escapeAttr(backdrop)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
              <div class="detail__poster">${posterSrc ? `<img src="${escapeAttr(posterSrc)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : ''}</div>
              <div class="detail__info">
                <h1 class="detail__title">${escapeHtml(title)}</h1>
                <div class="detail__meta">
                  ${metaRow([
                    year ? escapeHtml(String(year).slice(0, 4)) : '',
                    rating ? `★ ${escapeHtml(ratingText(rating) || rating)}` : '',
                    duration ? escapeHtml(duration) : '',
                    genre ? escapeHtml(genre) : '',
                    isSeries && series?.seasons?.length ? `${series.seasons.length} temporada${series.seasons.length > 1 ? 's' : ''}` : '',
                  ])}
                </div>
                ${plot ? `<p class="detail__plot">${escapeHtml(plot)}</p>` : ''}
                <div class="detail__actions">
                  ${actionButtonsHtml}
                  <button class="btn btn--ghost" data-focusable data-detail-fav class="${fav ? 'is-fav' : ''}">
                    ${icon('heart', 'icon icon--sm')} ${fav ? 'En favoritos' : 'Favorito'}
                  </button>
                  ${!isSeries && progressPct ? `<span style="display:inline-flex;align-items:center;gap:10px;color:var(--muted);font-size:.8rem">
                    <span class="poster__bar" style="width:120px;display:inline-block"><i style="width:${progressPct}%"></i></span>
                    ${progressPct}%
                  </span>` : ''}
                </div>
              </div>
            </section>

            ${isSeries ? `
              <section class="section">
                <div class="section__head"><h2 class="section__title">Episodios</h2></div>
                <div class="seasons" id="season-tabs"></div>
                <div class="episodes" id="episode-list"></div>
              </section>` : `
              ${(cast || director) ? `<section class="section">
                <div class="section__head"><h2 class="section__title">Ficha</h2></div>
                <div class="panel"><div class="panel__body">
                  ${director ? `<div class="setting-row"><div class="setting-row__label">Director</div><div class="muted">${escapeHtml(director)}</div></div>` : ''}
                  ${cast ? `<div class="setting-row"><div class="setting-row__label">Reparto</div><div class="muted" style="text-align:right;max-width:60%">${escapeHtml(cast)}</div></div>` : ''}
                </div></div>
              </section>` : ''}`}
          </div>
        </div>
      </div>
    </section>`;

    this.bind();
    if (isSeries) {
      this.renderSeasons();
      this.renderEpisodes();
    }
  },

  bind() {
    if (this.rootBound) return;
    this.rootBound = true;
    const root = this.root;

    this.listen(root, 'click', (event) => {
      if (event.target.closest('[data-play-primary]')) {
        event.preventDefault();
        if (this.type === 'series') this.playFirstEpisode();
        else this.playMovie(true);
        return;
      }
      if (event.target.closest('[data-play-resume]')) {
        event.preventDefault();
        this.playMovie(true);
        return;
      }
      if (event.target.closest('[data-play-restart]')) {
        event.preventDefault();
        this.playMovie(false);
        return;
      }
      if (event.target.closest('[data-cast]')) {
        event.preventDefault();
        const onWifi = isWifiConnected();
        if (!onWifi) {
          toast('Tip: Conecta tu móvil a la misma red Wi-Fi de tu Smart TV', 'info', 3000);
        }
        const ok = openCastSettings();
        if (ok) {
          toast('Selecciona tu Smart TV en la lista', 'ok', 2500);
        } else {
          toast('Opciones de transmisión no disponibles en este móvil', 'error', 2500);
        }
        return;
      }
      if (event.target.closest('[data-play-external]')) {
        event.preventDefault();
        if (this.item) Player.openExternal(this.item);
        return;
      }
      if (event.target.closest('[data-detail-fav]')) {
        event.preventDefault();
        const active = store.toggleFavorite(this.item);
        const btn = this.root.querySelector('[data-detail-fav]');
        if (btn) {
          btn.classList.toggle('is-fav', active);
          btn.innerHTML = `${icon('heart', 'icon icon--sm')} ${active ? 'En favoritos' : 'Favorito'}`;
        }
        toast(active ? 'Agregado a favoritos' : 'Quitado de favoritos', 'ok', 1600);
        return;
      }
      const seasonBtn = event.target.closest('[data-season]');
      if (seasonBtn) {
        this.season = Number(seasonBtn.dataset.season);
        this.renderSeasons();
        this.renderEpisodes();
        const first = this.root.querySelector('.episode');
        if (first) Focus.focus(first, { scroll: false });
        return;
      }
      const ep = event.target.closest('[data-episode]');
      if (ep) {
        const episode = this.currentEpisodes?.find((e) => String(e.id) === ep.dataset.episode);
        if (episode) this.playEpisode(episode);
      }
    });
  },

  listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.handlers.push(() => {
      try { target.removeEventListener(type, fn, opts); } catch (_) {}
    });
  },

  renderSeasons() {
    const tabs = this.root.querySelector('#season-tabs');
    if (!tabs) return;
    const seasons = this.data?.series?.seasons || [];
    tabs.innerHTML = seasons.map((s) => `
      <button class="chip${Number(s.season) === Number(this.season) ? ' is-active' : ''}" data-focusable data-season="${s.season}">
        Temporada ${s.season || 1}
      </button>`).join('');
  },

  renderEpisodes() {
    const list = this.root.querySelector('#episode-list');
    if (!list) return;
    const seasons = this.data?.series?.seasons || [];
    const current = seasons.find((s) => Number(s.season) === Number(this.season)) || seasons[0];
    this.currentEpisodes = current?.episodes || [];

    if (!this.currentEpisodes.length) {
      list.innerHTML = emptyState({ iconName: 'series', title: 'Sin episodios', text: 'Esta temporada no tiene episodios disponibles.' });
      return;
    }

    list.innerHTML = this.currentEpisodes.map((ep) => {
      const pct = pctOf(ep);
      return `<button class="episode" data-focusable data-episode="${escapeAttr(ep.id)}">
        <span class="episode__num">${escapeHtml(ep.episodeNum || '')}</span>
        <span style="min-width:0">
          <span class="episode__title">${escapeHtml(ep.name || `Episodio ${ep.episodeNum}`)}</span>
          <span class="episode__meta">${escapeHtml(ep.plot || ep.duration || '')}</span>
          ${pct ? `<span class="episode__bar" data-ep-progress="${escapeAttr(ep.id)}"><i style="width:${pct}%"></i></span>` : ''}
        </span>
        <span class="episode__play">${icon('play', 'icon icon--sm')}</span>
      </button>`;
    }).join('');

    requestAnimationFrame(() => Focus.refresh({ autoFocus: false }));
  },

  async playMovie(resume = true) {
    const info = this.data?.info || {};
    const item = {
      ...this.item,
      streamType: 'movie',
      containerExtension: info.containerExtension || this.item.containerExtension || 'mp4',
    };
    if (isItemLocked(item) && !isSessionUnlocked()) {
      showPinModal({
        title: 'Película Protegida',
        subtitle: item.name,
        onSuccess: () => {
          unlockSession(store.state.settings.parental?.sessionTimeout);
          this.playMovie(resume);
        },
      }).catch(() => {});
      return;
    }
    const url = streamUrl(this.profile, item);
    if (!url) {
      toast('Este título no tiene URL de reproducción', 'error');
      return;
    }
    const progress = resume ? store.getProgress(item) : null;
    const startPosition = (resume && progress?.position) ? progress.position : 0;
    try {
      await Player.play(item, {
        url,
        title: item.name,
        startPosition,
      });
      await Player.enterFullscreen();
    } catch (err) {
      toast(err?.message || 'No se pudo reproducir', 'error');
    }
  },

  async playEpisode(ep, resume = true) {
    if (isItemLocked(ep) && !isSessionUnlocked()) {
      showPinModal({
        title: 'Episodio Protegido',
        subtitle: ep.name || this.item.name,
        onSuccess: () => {
          unlockSession(store.state.settings.parental?.sessionTimeout);
          this.playEpisode(ep, resume);
        },
      }).catch(() => {});
      return;
    }
    const url = streamUrl(this.profile, ep);
    if (!url) {
      toast('Este episodio no tiene URL de reproducción', 'error');
      return;
    }
    const progress = resume ? store.getProgress(ep) : null;
    const startPosition = (resume && progress?.position) ? progress.position : 0;
    const seriesName = this.data?.series?.info?.name || this.item.name;
    try {
      await Player.play(ep, {
        url,
        title: `${seriesName} · ${ep.name || 'Episodio ' + ep.episodeNum}`,
        startPosition,
      });
      await Player.enterFullscreen();
    } catch (err) {
      toast(err?.message || 'No se pudo reproducir el episodio', 'error');
    }
  },

  playFirstEpisode() {
    const seasons = this.data?.series?.seasons || [];
    if (!seasons.length) {
      toast('Esta serie no tiene episodios', 'warn');
      return;
    }
    const current = seasons.find((s) => Number(s.season) === Number(this.season)) || seasons[0];
    const first = current.episodes[0];
    if (first) this.playEpisode(first);
  },

  onProgress({ position, duration }) {
    if (!this.currentEpisodes?.length) return;
    const active = Player.getCurrent()?.item;
    if (!active || active.streamType !== 'episode') return;
    const pct = duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0;
    const bar = this.root.querySelector(`[data-ep-progress="${active.id}"] i`);
    if (bar) bar.style.width = `${pct}%`;
  },

  onBack() {
    if (Player.getCurrent()) {
      Player.stop();
      return true;
    }
    return false;
  },

  unmount() {
    for (const unsub of this.unsubs || []) {
      try { unsub(); } catch (_) {}
    }
    for (const off of this.handlers || []) {
      try { off(); } catch (_) {}
    }
    this.handlers = [];
    this.rootBound = false;
    Player.stop({ silent: true });
  },
};

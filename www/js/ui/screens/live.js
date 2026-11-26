import { store } from '../../core/store.js';
import { getEpg, loadCatalog, refreshCatalog, streamUrl } from '../../core/catalog.js';
import { mapPool } from '../../core/xtream.js';
import { navigate } from '../../core/router.js';
import { Focus } from '../../core/focus.js';
import { Player } from '../../player/player.js';
import { isParentalEnabled, isCategoryLocked, shouldHideCategory, isItemLocked, shouldHideItem, unlockSession, isSessionUnlocked } from '../../core/parental.js';
import { channelRow, emptyState, icon, spinner, topbar, toast, showPinModal } from '../dom.js';
import { debounce, escapeAttr, escapeHtml, fmtTime, normalize, throttle, canCast, isWifiConnected, openCastSettings } from '../../core/util.js';

const CHUNK = 60;

function nowNext(epg) {
  if (!epg || !epg.length) return '';
  const now = epg[0];
  const next = epg[1];
  const parts = [];
  if (now?.title) parts.push(`${fmtTime(now.start)} ${now.title}`);
  if (next?.title) parts.push(`Luego ${fmtTime(next.start)} ${next.title}`);
  return parts.join('  ·  ');
}

export default {
  async mount(root, params = {}) {
    if (!store.state.profile) {
      navigate('/login', {}, { replace: true });
      return;
    }
    this.root = root;
    this.profile = store.state.profile;
    this.allChannels = store.state.catalogs.live || [];
    this.channelById = new Map(this.allChannels.map((c) => [String(c.id), c]));
    this.category = '';
    this.rendered = 0;
    this.activeId = null;
    this.epgRequested = new Set();
    this.epgNodes = new Map();
    this.epgText = new Map();
    this.layoutRaf = 0;
    this.unsubs = [];
    this.handlers = [];
    this.rootBound = false;
    this.mobileView = 'channels'; // 'cats' | 'channels' | 'player'
    this.consecutiveErrors = 0;
    this.activeChannelItem = null;
    this.osdTimer = 0;
    this.isPaused = false;

    this.onResize = () => this.scheduleLayout();
    window.addEventListener('resize', this.onResize);

    this.onTvChannel = (e) => {
      if (Player.getCurrent()) {
        this.stepChannel(e.detail?.delta || 1);
      }
    };
    this.onTvPlayPause = () => {
      if (Player.getCurrent()) {
        if (this.isPaused) {
          Player.resume();
          this.isPaused = false;
          toast('▶ Reanudado', 'info', 1000);
        } else {
          Player.pause();
          this.isPaused = true;
          toast('⏸ Pausado', 'info', 1000);
        }
      }
    };
    this.onKeyTv = (event) => {
      if (!Player.getCurrent()) return;
      if (Player.isFullscreen()) {
        const key = event.key;
        if (key === 'ArrowUp' || key === 'ChannelUp' || key === 'PageUp') {
          event.preventDefault();
          this.stepChannel(1);
          return;
        }
        if (key === 'ArrowDown' || key === 'ChannelDown' || key === 'PageDown') {
          event.preventDefault();
          this.stepChannel(-1);
          return;
        }
        if (key === 'Enter' || key === ' ' || key === 'ArrowLeft' || key === 'ArrowRight') {
          event.preventDefault();
          this.toggleOsd();
          return;
        }
      }
    };

    window.addEventListener('tv:channel', this.onTvChannel);
    window.addEventListener('tv:playpause', this.onTvPlayPause);
    window.addEventListener('keydown', this.onKeyTv);

    this.unsubs.push(Player.on('state', (data) => {
      if (data?.playing && this.activeChannelItem) {
        this.consecutiveErrors = 0;
        this.isPaused = false;
        toast(`▶ Reproduciendo ${this.activeChannelItem.name}`, 'ok', 1800);
      }
    }));

    this.unsubs.push(Player.on('error', ({ message }) => {
      this.handleChannelError(message);
    }));
    this.unsubs.push(Player.on('stop', () => this.clearActive()));
    this.unsubs.push(Player.on('fullscreen', ({ fullscreen }) => {
      this.liveEl?.classList.toggle('is-fullscreen', !!fullscreen);
      if (fullscreen) {
        this.showOsd(4500);
      } else {
        this.hideOsd();
        this.scheduleLayout();
      }
    }));
    this.unsubs.push(Player.on('toggleFullscreen', () => {
      this.toggleFullscreen();
    }));

    this.paint();
    Focus.attach(root, { initial: '.channel-row' });

    if (!this.allChannels.length) {
      await this.loadAndPaint();
    } else if (params.play) {
      const item = this.allChannels.find((c) => String(c.id) === String(params.play));
      if (item) {
        if (item.categoryId) this.category = item.categoryId;
        this.renderCategories();
        this.renderChannels(true);
        this.playChannel(item);
      }
    }
  },

  paint() {
    const root = this.root;
    const total = this.allChannels.length;

    root.innerHTML = `<section class="screen screen--live">
      ${topbar({
        activeTab: 'live',
        title: 'TV en vivo',
        subtitle: `${total} canales`,
        sair: true,
      })}

      <!-- Barra de navegación móvil para pantallas estrechas -->
      <div class="mobile-live-tabs" id="mobile-live-tabs">
        <button class="mobile-tab" data-focusable data-mview="cats">
          ${icon('folder', 'icon icon--sm')} Categorías (<span id="m-cat-count">0</span>)
        </button>
        <button class="mobile-tab is-active" data-focusable data-mview="channels">
          ${icon('live', 'icon icon--sm')} Canales (<span id="m-chan-count">${total}</span>)
        </button>
        <button class="mobile-tab" data-focusable data-mview="player">
          ${icon('tv', 'icon icon--sm')} Reproductor
        </button>
      </div>

      <div class="screen__body">
        <div class="live" id="live" data-view="${this.mobileView}">
          <!-- Columna 1: Categorías -->
          <aside class="live__cats col--categories" id="live-cats-col">
            <div class="cats-list" id="live-cats"></div>
          </aside>

          <!-- Columna 2: Canales -->
          <section class="live__list col--channels" id="live-channels-col">
            <div class="channel-list" id="channel-list"></div>
          </section>

          <!-- Columna 3: Escenario del Reproductor TV -->
          <section class="player-stage col--player" id="player-stage">
            <div class="player-stage__placeholder" id="player-placeholder">
              <div class="empty__icon empty__icon--cyan-glow">
                ${icon('tv', 'icon icon--xl')}
              </div>
              <h2 class="player-idle-title">EDU-IPTV PRO</h2>
              <p class="player-idle-sub">Selecciona un canal de la lista para comenzar</p>
              ${canCast() ? `
                <div style="margin-top:14px">
                  <button class="btn btn--ghost btn--sm" data-focusable data-live-action="cast" title="Transmitir / Duplicar a Smart TV">
                    ${icon('cast', 'icon icon--sm')} Transmitir a Smart TV
                  </button>
                </div>
              ` : ''}
            </div>

            <!-- Controles flotantes amigables en vivo -->
            <div class="player-stage__controls hidden" id="player-overlay-controls">
              <button class="btn btn--primary btn--expand-friendly" data-focusable data-live-action="fullscreen" title="Ampliar a Pantalla Completa">
                ${icon('fullscreen', 'icon icon--sm')} <span>Pantalla Completa</span>
              </button>
              ${canCast() ? `
                <button class="btn btn--ghost btn--icon" data-focusable data-live-action="cast" title="Transmitir / Duplicar a Smart TV">
                  ${icon('cast', 'icon icon--sm')}
                </button>
              ` : ''}
              <button class="btn btn--ghost btn--icon" data-focusable data-live-action="external" title="Abrir en VLC / Reproductor Externo">
                ${icon('external', 'icon icon--sm')}
              </button>
              <button class="btn btn--danger btn--icon" data-focusable data-live-action="stop" title="Detener reproducción">
                ${icon('close')}
              </button>
            </div>

            <!-- Barra OSD en pantalla completa -->
            <div class="player-fullscreen-bar hidden" id="player-fullscreen-bar">
              <button class="btn btn--primary btn--sm" data-focusable data-live-action="fullscreen" title="Salir de pantalla completa">
                ${icon('back', 'icon icon--sm')} Volver
              </button>
              ${canCast() ? `
                <button class="btn btn--ghost btn--sm" data-focusable data-live-action="cast" title="Transmitir / Duplicar a Smart TV">
                  ${icon('cast', 'icon icon--sm')} Cast
                </button>
              ` : ''}
              <button class="btn btn--ghost btn--sm" data-focusable data-live-action="external" title="Abrir en VLC / Reproductor Externo">
                ${icon('external', 'icon icon--sm')} VLC
              </button>
              <div class="player-osd-info">
                <span class="player-fullscreen-title" id="player-active-title"></span>
                <span class="player-osd-cat" id="player-active-cat"></span>
                <span class="player-osd-epg" id="player-active-epg"></span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>`;

    this.listEl = root.querySelector('#channel-list');
    this.catsEl = root.querySelector('#live-cats');
    this.stageEl = root.querySelector('#player-stage');
    this.liveEl = root.querySelector('#live');
    this.overlayControls = root.querySelector('#player-overlay-controls');

    this.renderCategories();
    this.renderChannels(true);
    this.bindEvents();
    this.updateMobileView(this.mobileView);
  },

  listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.handlers.push(() => {
      try { target.removeEventListener(type, fn, opts); } catch (_) {}
    });
  },

  bindEvents() {
    const root = this.root;

    if (!this.rootBound) {
      this.rootBound = true;
      this.listen(root, 'click', (event) => {
        // Clic en pestaña móvil
        const mTab = event.target.closest('[data-mview]');
        if (mTab) {
          const view = mTab.dataset.mview;
          this.updateMobileView(view);
          return;
        }

        // Clic en categoría
        const cat = event.target.closest('[data-category]');
        if (cat) {
          const targetCatId = cat.dataset.category || '';
          if (cat.dataset.catLocked === 'true' && !isSessionUnlocked()) {
            showPinModal({
              title: 'Categoría Protegida',
              subtitle: 'Ingresa el PIN para acceder a este contenido',
              onSuccess: () => {
                unlockSession(store.state.settings.parental?.sessionTimeout);
                this.category = targetCatId;
                this.renderCategories();
                this.renderChannels(true);
                if (window.innerWidth < 768) {
                  this.updateMobileView('channels');
                }
                const first = this.root.querySelector('.channel-row');
                if (first) Focus.focus(first, { scroll: false });
              },
            }).catch(() => {});
            return;
          }
          this.category = targetCatId;
          this.renderCategories();
          this.renderChannels(true);
          // En móvil, cambiar automáticamente a vista de canales
          if (window.innerWidth < 768) {
            this.updateMobileView('channels');
          }
          const first = this.root.querySelector('.channel-row');
          if (first) Focus.focus(first, { scroll: false });
          return;
        }

        // Clic en Favorito (estrella)
        const favBtn = event.target.closest('[data-fav-channel]');
        if (favBtn) {
          event.preventDefault();
          event.stopPropagation();
          const id = favBtn.dataset.favChannel;
          const item = this.channelById.get(String(id));
          if (item) {
            const isFav = store.toggleFavorite(item);
            favBtn.classList.toggle('is-favorite', isFav);
            favBtn.innerHTML = icon(isFav ? 'starFilled' : 'star', 'icon icon--sm');
            favBtn.title = isFav ? 'Quitar de favoritos' : 'Añadir a favoritos';
            toast(isFav ? `⭐ ${item.name} añadido a favoritos` : 'Canal eliminado de favoritos', 'ok', 1400);
          }
          return;
        }

        // Clic en canal
        const channel = event.target.closest('[data-channel]');
        if (channel) {
          const item = this.allChannels.find((c) => String(c.id) === channel.dataset.channel);
          if (item) {
            if ((channel.dataset.channelLocked === 'true' || isItemLocked(item)) && !isSessionUnlocked()) {
              showPinModal({
                title: 'Canal Protegido',
                subtitle: item.name,
                onSuccess: () => {
                  unlockSession(store.state.settings.parental?.sessionTimeout);
                  this.playChannel(item);
                  if (window.innerWidth < 768) {
                    this.updateMobileView('player');
                  }
                },
              }).catch(() => {});
              return;
            }
            this.playChannel(item);
            // En móvil, cambiar automáticamente a vista de reproductor
            if (window.innerWidth < 768) {
              this.updateMobileView('player');
            }
          }
          return;
        }

        // Controles de reproductor
        const liveAction = event.target.closest('[data-live-action]');
        if (liveAction) {
          const act = liveAction.dataset.liveAction;
          if (act === 'fullscreen') this.toggleFullscreen();
          else if (act === 'stop') this.stop();
          else if (act === 'cast') {
            const onWifi = isWifiConnected();
            if (!onWifi) {
              toast('Tip: Conecta tu móvil a la misma red Wi-Fi de tu Smart TV', 'info', 3000);
            }
            const ok = openCastSettings();
            if (ok) {
              toast('Selecciona tu Smart TV o Chromecast en la lista', 'ok', 2500);
            } else {
              toast('Opciones de transmisión no disponibles en este móvil', 'error', 2500);
            }
          }
          else if (act === 'external') {
            if (this.activeChannelItem) {
              Player.openExternal(this.activeChannelItem);
            }
          }
          return;
        }

        // Clic directo en el escenario de video para ampliar a pantalla completa
        const stage = event.target.closest('#player-stage');
        if (stage && !event.target.closest('button') && !event.target.closest('#player-placeholder')) {
          if (this.activeId) {
            this.toggleFullscreen();
            return;
          }
        }

        if (event.target.closest('[data-retry]')) {
          this.loadAndPaint(true);
        }
      });

      this.listen(root, 'focus:edge', (event) => {
        if (event.detail?.direction === 'down') this.loadMore();
      });
    }

    this.listEl.addEventListener('scroll', throttle(() => {
      const el = this.listEl;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 220) this.loadMore();
      this.hydrateVisibleEpg();
    }, 140), { passive: true });
  },

  updateMobileView(view) {
    this.mobileView = view;
    if (this.liveEl) this.liveEl.dataset.view = view;
    const tabs = this.root.querySelectorAll('[data-mview]');
    tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.mview === view));
    if (view !== 'player' && !Player.isFullscreen()) {
      try { Player?.setVisibility?.(false); } catch (_) {}
    } else if (view === 'player' && !Player.isFullscreen() && !document.querySelector('.modal-root.is-open')) {
      try { Player?.setVisibility?.(true); } catch (_) {}
    }
    this.scheduleLayout();
  },

  renderCategories() {
    if (!this.catsEl) return;
    const cats = store.state.categories.live || [];
    const counts = new Map(cats.map((c) => [String(c.id), c.count || 0]));
    const favCount = store.favoritesList('live').length;
    const recent = store.state.lastChannel;

    const mCatCount = this.root.querySelector('#m-cat-count');
    if (mCatCount) mCatCount.textContent = String(cats.length);

    const items = [];

    // Pinned 1: FAVORITOS
    items.push(`
      <button class="cat cat--pinned${this.category === '__fav__' ? ' is-active' : ''}" data-focusable data-category="__fav__">
        <span class="cat__icon">💖</span>
        <span class="cat__name">FAVORITOS</span>
        ${favCount > 0 ? `<span class="cat__count">${favCount}</span>` : ''}
      </button>
    `);

    // Pinned 2: RECIENTEMENTE VISTO
    items.push(`
      <button class="cat cat--pinned${this.category === '__recent__' ? ' is-active' : ''}" data-focusable data-category="__recent__">
        <span class="cat__icon">🕒</span>
        <span class="cat__name">RECIENTEMENTE VISTO</span>
        ${recent ? `<span class="cat__count">1</span>` : ''}
      </button>
    `);

    // Categorias de canales
    cats.forEach((cat) => {
      if (shouldHideCategory(cat)) return;
      const isLocked = isCategoryLocked(cat) && !isSessionUnlocked();
      const isSelected = this.category === String(cat.id);
      items.push(`
        <button class="cat${isSelected ? ' is-active' : ''}${isLocked ? ' is-locked' : ''}" data-focusable data-category="${escapeAttr(cat.id)}" ${isLocked ? 'data-cat-locked="true"' : ''}>
          <span class="cat__name">${isLocked ? '🔒 ' : ''}${escapeHtml(cat.name)}</span>
          <span class="cat__count">${counts.get(String(cat.id)) || 0}</span>
        </button>
      `);
    });

    if (!items.length) {
      this.catsEl.innerHTML = `<div style="padding:14px;color:var(--muted);font-size:.8rem;text-align:center">Sin categorías</div>`;
      return;
    }

    this.catsEl.innerHTML = items.join('');
  },

  filteredChannels() {
    let list = this.allChannels;
    if (this.category === '__fav__') {
      list = this.allChannels.filter((ch) => store.isFavorite(ch));
    } else if (this.category === '__recent__') {
      const last = store.state.lastChannel;
      if (!last) return [];
      const ch = this.allChannels.find((c) => String(c.id) === String(last.id)) || last;
      list = [ch];
    } else if (this.category) {
      list = this.allChannels.filter((ch) => String(ch.categoryId) === String(this.category));
    }
    // Si modo 'hide' y no esta desbloqueado -> ocultar canales protegidos
    if (shouldHideCategory({ id: this.category })) return [];
    return list.filter((ch) => !shouldHideItem(ch));
  },

  renderChannels(reset) {
    if (!this.listEl) return;
    if (reset) {
      this.listEl.innerHTML = '';
      this.listEl.scrollTop = 0;
      this.rendered = 0;
      this.filtered = this.filteredChannels();
      this.epgNodes.clear();
      const mChanCount = this.root.querySelector('#m-chan-count');
      if (mChanCount) mChanCount.textContent = String(this.filtered.length);
    }

    if (!this.filtered) this.filtered = this.filteredChannels();

    if (!this.filtered.length) {
      this.listEl.innerHTML = emptyState({
        iconName: 'search',
        title: 'Sin canales',
        text: this.chanQuery ? 'No hay coincidencias para tu búsqueda.' : 'Esta categoría no contiene canales.',
      });
      return;
    }

    const slice = this.filtered.slice(this.rendered, this.rendered + CHUNK);
    if (!slice.length) return;

    const html = slice.map((item) => channelRow(item, { active: String(item.id) === String(this.activeId) })).join('');
    this.listEl.insertAdjacentHTML('beforeend', html);
    this.rendered += slice.length;

    for (const el of this.listEl.querySelectorAll('[data-epg-for]')) {
      this.epgNodes.set(String(el.dataset.epgFor), el);
    }
    for (const [id, el] of this.epgNodes) {
      const cached = this.epgText.get(String(id));
      if (cached) el.textContent = cached;
    }

    requestAnimationFrame(() => {
      Focus.refresh({ autoFocus: false });
      this.hydrateVisibleEpg();
    });
  },

  loadMore() {
    if (!this.filtered) return;
    if (this.rendered < this.filtered.length) this.renderChannels(false);
  },

  hydrateVisibleEpg() {
    if (!store.state.settings.epg || this.profile?.type !== 'xtream' || !this.listEl) return;
    const listRect = this.listEl.getBoundingClientRect();
    const pending = [];

    for (const el of this.listEl.querySelectorAll('[data-epg-for]')) {
      if (pending.length >= 18) break;
      const id = String(el.dataset.epgFor || '');
      if (!id || this.epgRequested.has(id)) continue;
      const row = el.closest('.channel-row');
      if (!row) continue;
      const r = row.getBoundingClientRect();
      if (r.bottom < listRect.top - 80 || r.top > listRect.bottom + 80) continue;
      const item = this.channelById.get(id);
      if (!item) continue;
      this.epgRequested.add(id);
      pending.push(item);
    }

    if (!pending.length) return;
    mapPool(pending, 3, async (item) => {
      const epg = await getEpg(this.profile, item.id);
      if (!epg.length) return;
      const text = nowNext(epg);
      if (!text) return;
      this.epgText.set(String(item.id), text);
      const el = this.epgNodes.get(String(item.id));
      if (el) el.textContent = text;
    });
  },

  scheduleLayout() {
    cancelAnimationFrame(this.layoutRaf);
    this.layoutRaf = requestAnimationFrame(() => {
      if (!this.stageEl || !Player.getCurrent() || Player.isFullscreen()) return;
      if (document.querySelector('.modal-root.is-open')) {
        try { Player?.setVisibility?.(false); } catch (_) {}
        return;
      }
      if (window.innerWidth < 840 && this.mobileView !== 'player') {
        try { Player?.setVisibility?.(false); } catch (_) {}
        return;
      }
      const rect = this.stageEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        Player.setLayout(rect);
        try { Player?.setVisibility?.(true); } catch (_) {}
      } else {
        try { Player?.setVisibility?.(false); } catch (_) {}
      }
    });
  },

  handleChannelError(message) {
    if (!this.activeId) return;

    let friendlyMessage = 'No se pudo reproducir el canal';
    if (message.includes('404') || message.includes('2004')) {
      friendlyMessage = 'Canal no disponible (fuera de transmisión)';
    } else if (message.includes('403')) {
      friendlyMessage = 'Acceso restringido o geobloqueado (403)';
    } else if (message.includes('Timeout') || message.includes('connect')) {
      friendlyMessage = 'Tiempo de espera agotado al conectar';
    } else if (message.includes('4003') || message.includes('DECODING_FAILED')) {
      friendlyMessage = 'Formato no compatible con el códec del dispositivo';
    }

    toast(`⚠ ${friendlyMessage}`, 'error', 3000);
    this.clearActive();
  },

  showOsd(duration = 4000) {
    const fsBar = this.root?.querySelector('#player-fullscreen-bar');
    if (!fsBar) return;
    fsBar.classList.remove('hidden');
    clearTimeout(this.osdTimer);
    if (duration > 0) {
      this.osdTimer = setTimeout(() => {
        if (Player.isFullscreen()) {
          fsBar.classList.add('hidden');
        }
      }, duration);
    }
  },

  hideOsd() {
    clearTimeout(this.osdTimer);
    const fsBar = this.root?.querySelector('#player-fullscreen-bar');
    if (fsBar) fsBar.classList.add('hidden');
  },

  toggleOsd() {
    const fsBar = this.root?.querySelector('#player-fullscreen-bar');
    if (!fsBar) return;
    if (fsBar.classList.contains('hidden')) {
      this.showOsd(4500);
    } else {
      this.hideOsd();
    }
  },

  stepChannel(delta) {
    const list = this.filtered?.length ? this.filtered : this.allChannels;
    if (!list || !list.length) return;
    const currentIndex = list.findIndex((c) => String(c.id) === String(this.activeId));
    let nextIndex = 0;
    if (currentIndex >= 0) {
      nextIndex = (currentIndex + delta + list.length) % list.length;
    }
    const nextItem = list[nextIndex];
    if (nextItem) {
      this.playChannel(nextItem);
      this.showOsd(4500);
      const row = this.listEl?.querySelector(`[data-channel="${nextItem.id}"]`);
      if (row) {
        row.scrollIntoView({ block: 'nearest' });
      }
    }
  },

  async playChannel(item) {
    if (!item) return;
    try {
      const url = streamUrl(this.profile, item);
      if (!url) throw new Error('Este canal no tiene URL de reproducción');
      this.activeId = item.id;
      this.activeChannelItem = item;
      this.updateActive();

      const placeholder = this.root.querySelector('#player-placeholder');
      if (placeholder) placeholder.classList.add('hidden');
      if (this.overlayControls) this.overlayControls.classList.remove('hidden');

      const titleEl = this.root.querySelector('#player-active-title');
      if (titleEl) titleEl.textContent = item.name;

      const catEl = this.root.querySelector('#player-active-cat');
      if (catEl) {
        const cat = (store.state.categories.live || []).find((c) => String(c.id) === String(item.categoryId));
        catEl.textContent = cat ? cat.name : (item.group || '');
      }

      const epgEl = this.root.querySelector('#player-active-epg');
      if (epgEl) {
        const cachedEpg = this.epgText.get(String(item.id));
        epgEl.textContent = cachedEpg || '';
      }

      toast(`Conectando con ${item.name}...`, 'info', 1400);
      const stageRect = this.stageEl ? this.stageEl.getBoundingClientRect() : null;
      await Player.play(item, { url, live: true, title: item.name, layout: stageRect });
      this.scheduleLayout();
    } catch (err) {
      this.handleChannelError(err?.message || 'Error al conectar el canal');
    }
  },

  updateActive() {
    if (!this.listEl) return;
    for (const row of this.listEl.querySelectorAll('.channel-row')) {
      row.classList.toggle('is-active', String(row.dataset.channel) === String(this.activeId));
    }
  },

  clearActive() {
    this.activeId = null;
    this.activeChannelItem = null;
    this.updateActive();
    const placeholder = this.root?.querySelector('#player-placeholder');
    if (placeholder) placeholder.classList.remove('hidden');
    if (this.overlayControls) this.overlayControls.classList.add('hidden');
    this.hideOsd();
  },

  async toggleFullscreen() {
    try {
      if (Player.isFullscreen()) {
        await Player.exitFullscreen();
        this.liveEl?.classList.remove('is-fullscreen');
        this.hideOsd();
        this.scheduleLayout();
      } else {
        this.liveEl?.classList.add('is-fullscreen');
        await Player.enterFullscreen();
        this.showOsd(4500);
      }
    } catch (err) {
      toast('No se pudo cambiar a pantalla completa', 'error');
    }
  },

  stop() {
    this.consecutiveErrors = 0;
    this.hideOsd();
    Player.stop();
    this.clearActive();
    this.liveEl?.classList.remove('is-fullscreen');
  },

  async loadAndPaint(force = false) {
    const root = this.root;
    const list = root.querySelector('#channel-list');
    if (list) {
      list.innerHTML = `
        <div class="progress-manager" style="max-width:320px;margin:30px auto;padding:18px 12px;">
          <div class="progress-manager__head">
            <div class="progress-manager__icon">${icon('live', 'icon icon--lg')}</div>
            <div class="progress-manager__title">Cargando Canales</div>
            <div class="progress-manager__sub">${escapeHtml(this.profile?.name || '')}</div>
          </div>
          <div class="progress-manager__pct" id="live-load-pct">0%</div>
          <div class="progress-manager__bar">
            <div class="progress-manager__fill" id="live-load-fill" style="width:0%"></div>
          </div>
          <div class="progress-manager__status" id="live-load-status">Iniciando conexión...</div>
        </div>
      `;
    }
    try {
      const runner = force ? refreshCatalog : loadCatalog;
      await runner(this.profile, {
        onProgress: (ratio, status) => {
          const pct = Math.min(100, Math.max(0, Math.round((ratio || 0) * 100)));
          const pctEl = root.querySelector('#live-load-pct');
          const fillEl = root.querySelector('#live-load-fill');
          const statusEl = root.querySelector('#live-load-status');
          if (pctEl) pctEl.textContent = `${pct}%`;
          if (fillEl) fillEl.style.width = `${pct}%`;
          if (statusEl && status) statusEl.textContent = status;
        },
      });
      this.allChannels = store.state.catalogs.live || [];
      this.channelById = new Map(this.allChannels.map((c) => [String(c.id), c]));
      this.paint();
      Focus.attach(root, { initial: '.channel-row' });
    } catch (err) {
      if (list) {
        list.innerHTML = emptyState({
          iconName: 'warning',
          title: 'No se pudieron cargar los canales',
          text: err?.message || 'Error de red',
          action: `<button class="btn btn--primary" data-focusable data-retry>${icon('refresh', 'icon icon--sm')} Reintentar</button>`,
        });
      }
      toast(err?.message || 'Error cargando canales', 'error');
    }
  },

  onBack() {
    if (Player.isFullscreen()) {
      this.toggleFullscreen();
      return true;
    }
    const active = Player.getCurrent();
    if (active) {
      this.stop();
      return true;
    }
    return false;
  },

  unmount() {
    cancelAnimationFrame(this.layoutRaf);
    clearTimeout(this.osdTimer);
    window.removeEventListener('tv:channel', this.onTvChannel);
    window.removeEventListener('tv:playpause', this.onTvPlayPause);
    window.removeEventListener('keydown', this.onKeyTv);
    this.chanSearchDebounced?.cancel?.();
    this.catSearchDebounced?.cancel?.();
    window.removeEventListener('resize', this.onResize);
    for (const unsub of this.unsubs || []) {
      try { unsub(); } catch (_) {}
    }
    for (const off of this.handlers || []) {
      try { off(); } catch (_) {}
    }
    this.handlers = [];
    this.rootBound = false;
    this.stop();
  },
};

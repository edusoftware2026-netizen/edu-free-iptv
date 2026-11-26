/* Pantalla reutilizable para Peliculas y Series con Diseno Two-Pane Premium. */

import { store } from '../../core/store.js';
import { loadCatalog, refreshCatalog } from '../../core/catalog.js';
import { navigate } from '../../core/router.js';
import { Focus } from '../../core/focus.js';
import { isCategoryLocked, shouldHideCategory, shouldHideItem, isSessionUnlocked, unlockSession } from '../../core/parental.js';
import { actionButton, emptyState, icon, poster, skeletonGrid, topbar, toast, showPinModal } from '../dom.js';
import { escapeAttr, escapeHtml, throttle } from '../../core/util.js';

const CHUNK = 60;

export function createMediaScreen({ kind, title, iconName, singular }) {
  return {
    async mount(root, params = {}) {
      if (!store.state.profile) {
        navigate('/login', {}, { replace: true });
        return;
      }
      this.root = root;
      this.profile = store.state.profile;
      this.items = store.state.catalogs[kind] || [];
      this.category = params.category || '';
      this.rendered = 0;
      this.handlers = [];
      this.rootBound = false;

      this.paint();
      Focus.attach(root, { initial: '.poster' });

      if (!this.items.length) {
        await this.loadAndPaint();
      }

      this.unsub = store.subscribe((state) => {
        const next = state.catalogs[kind] || [];
        if (next !== this.items && next.length) {
          this.items = next;
          this.paint();
          Focus.attach(root, { initial: '.poster' });
        }
      });
    },

    paint() {
      const total = this.items.length;
      this.root.innerHTML = `<section class="screen screen--media">
        ${topbar({
          activeTab: kind,
          title,
          subtitle: `${total} ${title.toLowerCase()}`,
          back: true,
          actions: actionButton('refresh', 'Actualizar', 'data-media-refresh'),
          sair: true,
        })}
        <div class="screen__body">
          <div class="media-container" id="media-container">
            <!-- Columna lateral: Categorías y Pinned Filters -->
            <aside class="media-sidebar" id="media-sidebar">
              <div class="media-cats" id="media-cats"></div>
            </aside>

            <!-- Grilla Principal de Posters -->
            <main class="media-main" id="media-main">
              <div class="posters" id="media-grid"></div>
            </main>
          </div>
        </div>
      </section>`;

      this.mainEl = this.root.querySelector('#media-main');
      this.gridEl = this.root.querySelector('#media-grid');
      this.catsEl = this.root.querySelector('#media-cats');

      this.renderSidebar();
      this.renderGrid(true);
      this.bindEvents();
    },

    bindEvents() {
      const root = this.root;
      if (!this.rootBound) {
        this.rootBound = true;
        this.listen(root, 'click', (event) => {
          const catBtn = event.target.closest('[data-media-cat]');
          if (catBtn) {
            const targetCat = catBtn.dataset.mediaCat || '';
            if (catBtn.dataset.catLocked === 'true' && !isSessionUnlocked()) {
              showPinModal({
                title: 'Categoría Protegida',
                subtitle: 'Ingresa el PIN para acceder a este contenido',
                onSuccess: () => {
                  unlockSession(store.state.settings.parental?.sessionTimeout);
                  this.category = targetCat;
                  this.renderSidebar();
                  if (this.mainEl) this.mainEl.scrollTop = 0;
                  this.renderGrid(true);
                  const first = this.root.querySelector('.poster');
                  if (first) Focus.focus(first, { scroll: false });
                },
              }).catch(() => {});
              return;
            }
            this.category = targetCat;
            this.renderSidebar();
            if (this.mainEl) this.mainEl.scrollTop = 0;
            this.renderGrid(true);
            const first = this.root.querySelector('.poster');
            if (first) Focus.focus(first, { scroll: false });
            return;
          }
          if (event.target.closest('[data-media-refresh]')) {
            toast('Actualizando catalogo...', 'info');
            this.loadAndPaint(true);
            return;
          }
          if (event.target.closest('[data-retry]')) {
            this.loadAndPaint(true);
          }
        });

        this.listen(root, 'focus:edge', (event) => {
          if (event.detail?.direction === 'down') this.loadMore();
        });
      }

      if (this.mainEl) {
        this.mainEl.addEventListener('scroll', throttle(() => {
          const el = this.mainEl;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 260) this.loadMore();
        }, 120), { passive: true });
      }
    },

    listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      this.handlers.push(() => {
        try { target.removeEventListener(type, fn, opts); } catch (_) {}
      });
    },

    renderSidebar() {
      if (!this.catsEl) return;
      const cats = store.state.categories[kind] || [];
      const favList = store.favoritesList(kind === 'series' ? 'series' : 'movie');
      const watched = store.continueWatching(100);
      const watchingCount = watched.filter((w) => (kind === 'series' ? (w.streamType === 'series' || w.streamType === 'episode') : w.streamType === 'movie')).length;
      const total = this.items.length;

      const items = [];

      // 1. ALL
      items.push(`
        <button class="cat cat--pinned${this.category === '' ? ' is-active' : ''}" data-focusable data-media-cat="">
          <span class="cat__icon" style="font-size:1.15rem;line-height:1">▦</span>
          <span class="cat__name">ALL</span>
          <span class="cat__count">${total}</span>
        </button>
      `);

      // 2. FAVOURITES
      items.push(`
        <button class="cat cat--pinned${this.category === '__fav__' ? ' is-active' : ''}" data-focusable data-media-cat="__fav__">
          <span class="cat__icon">💖</span>
          <span class="cat__name">FAVOURITES</span>
          ${favList.length > 0 ? `<span class="cat__count">${favList.length}</span>` : ''}
        </button>
      `);

      // 3. RECENTLY WATCHED (CONTINUAR VIENDO)
      items.push(`
        <button class="cat cat--pinned${this.category === '__recent__' ? ' is-active' : ''}" data-focusable data-media-cat="__recent__">
          <span class="cat__icon">🕒</span>
          <span class="cat__name">RECENTLY WATCHED</span>
          ${watchingCount > 0 ? `<span class="cat__count">${watchingCount}</span>` : ''}
        </button>
      `);

      // 4. RECENTLY ADDED
      items.push(`
        <button class="cat cat--pinned${this.category === '__added__' ? ' is-active' : ''}" data-focusable data-media-cat="__added__">
          <span class="cat__icon">➕</span>
          <span class="cat__name">RECENTLY ADDED</span>
          <span class="cat__count">${Math.min(100, total)}</span>
        </button>
      `);

      // 5. Categorías del catálogo
      cats.forEach((cat) => {
        if (shouldHideCategory(cat)) return;
        const isLocked = isCategoryLocked(cat) && !isSessionUnlocked();
        const isSelected = this.category === String(cat.id);
        const name = cat.name.startsWith('★') ? cat.name : `★ ${cat.name}`;
        items.push(`
          <button class="cat${isSelected ? ' is-active' : ''}${isLocked ? ' is-locked' : ''}" data-focusable data-media-cat="${escapeAttr(cat.id)}" ${isLocked ? 'data-cat-locked="true"' : ''}>
            <span class="cat__name">${isLocked ? '🔒 ' : ''}${escapeHtml(name)}</span>
            <span class="cat__count">${cat.count || 0}</span>
          </button>
        `);
      });

      this.catsEl.innerHTML = items.join('');
    },

    filteredItems() {
      let list = this.items;
      if (this.category === '__fav__') {
        list = this.items.filter((item) => store.isFavorite(item));
      } else if (this.category === '__recent__') {
        const watched = store.continueWatching(100);
        const ids = new Set(watched.map((w) => String(w.id)));
        list = this.items.filter((item) => ids.has(String(item.id)));
      } else if (this.category === '__added__') {
        list = this.items.slice(0, 100);
      } else if (this.category) {
        list = this.items.filter((item) => String(item.categoryId) === String(this.category));
      }
      if (shouldHideCategory({ id: this.category })) return [];
      return list.filter((item) => !shouldHideItem(item));
    },

    renderGrid(reset) {
      if (!this.gridEl) return;
      if (reset) {
        this.gridEl.innerHTML = '';
        this.rendered = 0;
        this.filtered = this.filteredItems();
      }
      if (!this.filtered) this.filtered = this.filteredItems();

      if (!this.filtered.length) {
        this.gridEl.innerHTML = '';
        this.gridEl.insertAdjacentHTML('beforeend', `<div style="grid-column:1/-1">${emptyState({
          iconName,
          title: `Esta categoría no tiene ${title.toLowerCase()}`,
          text: 'Actualiza el catálogo o selecciona otra categoría.',
        })}</div>`);
        return;
      }

      const slice = this.filtered.slice(this.rendered, this.rendered + CHUNK);
      if (!slice.length) return;
      const html = slice.map((item) => {
        const progress = store.getProgress(item);
        return poster({ ...item, __fav: store.isFavorite(item) }, { progress });
      }).join('');
      this.gridEl.insertAdjacentHTML('beforeend', html);
      this.rendered += slice.length;
      requestAnimationFrame(() => Focus.refresh({ autoFocus: false }));
    },

    loadMore() {
      if (this.filtered && this.rendered < this.filtered.length) this.renderGrid(false);
    },

    async loadAndPaint(force = false) {
      if (this.gridEl) {
        this.gridEl.innerHTML = `
          <div style="grid-column:1/-1;display:flex;justify-content:center;padding:40px 16px;">
            <div class="progress-manager" style="max-width:360px;">
              <div class="progress-manager__head">
                <div class="progress-manager__icon">${icon(iconName || 'movie', 'icon icon--lg')}</div>
                <div class="progress-manager__title">Cargando ${escapeHtml(title)}</div>
                <div class="progress-manager__sub">${escapeHtml(this.profile?.name || '')}</div>
              </div>
              <div class="progress-manager__pct" id="media-load-pct">0%</div>
              <div class="progress-manager__bar">
                <div class="progress-manager__fill" id="media-load-fill" style="width:0%"></div>
              </div>
              <div class="progress-manager__status" id="media-load-status">Iniciando conexión...</div>
            </div>
          </div>
        `;
      }
      try {
        const runner = force ? refreshCatalog : loadCatalog;
        await runner(this.profile, {
          onProgress: (ratio, status) => {
            const pct = Math.min(100, Math.max(0, Math.round((ratio || 0) * 100)));
            const pctEl = this.root.querySelector('#media-load-pct');
            const fillEl = this.root.querySelector('#media-load-fill');
            const statusEl = this.root.querySelector('#media-load-status');
            if (pctEl) pctEl.textContent = `${pct}%`;
            if (fillEl) fillEl.style.width = `${pct}%`;
            if (statusEl && status) statusEl.textContent = status;
          },
        });
        this.items = store.state.catalogs[kind] || [];
        this.paint();
        Focus.attach(this.root, { initial: '.poster' });
      } catch (err) {
        if (this.gridEl) {
          this.gridEl.innerHTML = `<div style="grid-column:1/-1">${emptyState({
            iconName: 'warning',
            title: 'No se pudo cargar el contenido',
            text: err?.message || 'Error de red',
            action: `<button class="btn btn--primary" data-focusable data-retry>${icon('refresh', 'icon icon--sm')} Reintentar</button>`,
          })}</div>`;
        }
        toast(err?.message || 'Error cargando contenido', 'error');
      }
    },

    onBack() {
      return false;
    },

    unmount() {
      this.unsub?.();
      this.unsub = null;
      for (const off of this.handlers || []) {
        try { off(); } catch (_) {}
      }
      this.handlers = [];
      this.rootBound = false;
    },
  };
}

export default createMediaScreen;

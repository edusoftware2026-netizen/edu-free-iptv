import { store } from '../../core/store.js';
import { loadCatalog, search } from '../../core/catalog.js';
import { navigate } from '../../core/router.js';
import { Focus } from '../../core/focus.js';
import { emptyState, icon, searchItem, topbar } from '../dom.js';
import { debounce, escapeHtml } from '../../core/util.js';

export default {
  async mount(root) {
    if (!store.state.profile) {
      navigate('/login', {}, { replace: true });
      return;
    }
    this.root = root;
    this.profile = store.state.profile;
    this.query = '';
    this.handlers = [];
    this.rootBound = false;

    this.debounced = debounce((value) => {
      this.query = value;
      this.runSearch();
    }, 220);

    root.innerHTML = `<section class="screen">
      ${topbar({ title: 'Buscar', subtitle: 'Live, peliculas y series', back: true, sair: true })}
      <div class="screen__body">
        <div class="page">
          <div class="search">
            <div class="search__bar">
              ${icon('search', 'icon')}
              <input class="input input--search" id="global-search" data-focusable type="search" placeholder="Buscar pelicula, serie o canal..." autocomplete="off" spellcheck="false">
            </div>
            <div id="search-results"></div>
          </div>
        </div>
      </div>
    </section>`;

    this.input = root.querySelector('#global-search');
    this.results = root.querySelector('#search-results');
    this.bind();
    Focus.attach(root, { initial: this.input });
    this.renderHint();

    if (!store.state.catalogs.live.length && !store.state.loading.catalog) {
      loadCatalog(this.profile, { onProgress: () => {} }).then(() => {
        if (this.query) this.runSearch();
      }).catch(() => {});
    }
  },

  bind() {
    if (this.rootBound) return;
    this.rootBound = true;
    this.listen(this.root, 'input', (event) => {
      if (event.target.id === 'global-search') this.debounced(event.target.value);
    });
    this.listen(this.root, 'keydown', (event) => {
      if (event.target.id === 'global-search' && event.key === 'Enter') {
        const first = this.root.querySelector('.search-item');
        if (first) {
          event.preventDefault();
          Focus.focus(first, { scroll: false });
        }
      }
    });
  },

  listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.handlers.push(() => {
      try { target.removeEventListener(type, fn, opts); } catch (_) {}
    });
  },

  renderHint() {
    this.results.innerHTML = `<div class="empty" style="padding-top:20px">
      <div class="empty__icon">${icon('search', 'icon icon--lg')}</div>
      <h3>Busca en todo tu contenido</h3>
      <p>Escribe al menos 2 letras. Los resultados se agrupan por canales, peliculas y series.</p>
    </div>`;
  },

  runSearch() {
    const q = this.query.trim();
    if (q.length < 2) {
      this.renderHint();
      Focus.refresh({ autoFocus: false });
      return;
    }

    const res = search(q, 30);
    const total = res.live.length + res.movies.length + res.series.length;
    if (!total) {
      this.results.innerHTML = emptyState({
        iconName: 'search',
        title: `Sin resultados para "${q}"`,
        text: 'Prueba con otro termino o revisa que el catalogo este actualizado.',
      });
      Focus.refresh({ autoFocus: false });
      return;
    }

    const group = (title, items, count) => {
      if (!items.length) return '';
      return `<section class="search-group">
        <h3>${escapeHtml(title)} <span>${count} resultado${count > 1 ? 's' : ''}</span></h3>
        <div class="search-list">${items.map(searchItem).join('')}</div>
      </section>`;
    };

    this.results.innerHTML = `
      ${group('Canales en vivo', res.live, res.live.length)}
      ${group('Peliculas', res.movies, res.movies.length)}
      ${group('Series', res.series, res.series.length)}
    `;
    Focus.refresh({ autoFocus: false });
  },

  onBack() {
    return false;
  },

  unmount() {
    this.debounced?.cancel?.();
    for (const off of this.handlers || []) {
      try { off(); } catch (_) {}
    }
    this.handlers = [];
    this.rootBound = false;
  },
};

/* Modales centrales de la aplicacion:
   - Carga de listas Free por paises (IPTV-org) con banderas y regiones.
   - Carga de listas externas M3U / Xtream Codes.
   - Dialogo de salida / cambio de cuenta.
*/

import { SPANISH_COUNTRIES, REGIONS, freeListUrl } from '../core/m3u.js';
import { store } from '../core/store.js';
import { DB } from '../core/db.js';
import { loadCatalog, refreshCatalog } from '../core/catalog.js';
import { verifyPin, isAdultString, isCategoryLocked } from '../core/parental.js';
import { XtreamClient, normalizeServer } from '../core/xtream.js';
import { parseXtreamLink } from './screens/login.js';
import { navigate } from '../core/router.js';
import { Focus } from '../core/focus.js';
import { icon, modal, toast, confirmDialog } from './dom.js';
import { escapeAttr, escapeHtml, uid } from '../core/util.js';
import { startRemoteServer, stopRemoteServer } from '../core/remote.js';
import { renderQrSvg } from '../core/qr.js';

const STORAGE_COUNTRIES_KEY = 'free_iptv_selected_countries';

/**
 * Modal de seleccion de paises de habla hispana para canales Free.
 * Sin ningún país precargado por defecto, sin barra de búsqueda por nombre,
 * y con un gestor visual de porcentaje de carga en tiempo real (0% - 100%).
 */
export function openFreeCountriesModal() {
  // SIN ningún país precargado por defecto (conjunto vacío)
  const selected = new Set();
  let currentRegion = 'todos';

  const body = `
    <div class="countries-modal">
      <div class="countries-modal__intro">
        <p>Selecciona los países que deseas cargar de las listas públicas de IPTV-org. Puedes elegir uno o varios países para tu catálogo.</p>
      </div>

      <!-- Pestañas de Región -->
      <div class="region-tabs" id="modal-region-tabs" role="tablist">
        ${REGIONS.map((r) => `
          <button class="region-tab${r.id === 'todos' ? ' is-active' : ''}" data-focusable data-region="${r.id}" role="tab">
            ${escapeHtml(r.label)}
          </button>
        `).join('')}
      </div>

      <!-- Barra de herramientas: Selección Rápida y Contador -->
      <div class="countries-toolbar">
        <div class="countries-actions">
          <button class="btn btn--sm btn--ghost" id="modal-select-all" data-focusable title="Seleccionar todos los visibles">
            ${icon('check', 'icon icon--sm')} Todos
          </button>
          <button class="btn btn--sm btn--ghost" id="modal-deselect-all" data-focusable title="Limpiar selección">
            ${icon('close', 'icon icon--sm')} Ninguno
          </button>
        </div>
        <div class="countries-counter" id="modal-countries-count">
          0 países seleccionados
        </div>
      </div>

      <!-- Cuadrícula de Países con Banderas y Badges -->
      <div class="countries-grid" id="modal-countries-grid"></div>
    </div>
  `;

  const m = modal({
    title: 'Canales Free por Países',
    body,
    wide: true,
    footer: `
      <button class="btn btn--ghost" data-focusable data-cancel>Cancelar</button>
      <button class="btn btn--primary" id="modal-submit-countries" data-focusable disabled>
        ${icon('wifi', 'icon icon--sm')} Cargar canales Free (<span id="modal-btn-count">0</span>)
      </button>
    `,
  });

  if (!m) return;

  const grid = m.root.querySelector('#modal-countries-grid');
  const countBadge = m.root.querySelector('#modal-countries-count');
  const btnCount = m.root.querySelector('#modal-btn-count');
  const submitBtn = m.root.querySelector('#modal-submit-countries');

  function getFilteredCountries() {
    return SPANISH_COUNTRIES.filter((c) => {
      if (currentRegion !== 'todos' && c.region !== currentRegion) return false;
      return true;
    });
  }

  function renderGrid() {
    const list = getFilteredCountries();
    if (!list.length) {
      grid.innerHTML = `<div class="empty-inline" style="grid-column:1/-1;text-align:center;padding:30px;color:var(--muted)">No hay países en esta región.</div>`;
      return;
    }

    grid.innerHTML = list.map((c) => {
      const isChecked = selected.has(c.code);
      return `
        <button class="country-card${isChecked ? ' is-checked' : ''}" data-focusable data-code="${c.code}" role="checkbox" aria-checked="${isChecked}">
          <span class="country-card__flag" aria-hidden="true">${c.flag}</span>
          <span class="country-card__details">
            <span class="country-card__name">${escapeHtml(c.name)}</span>
            <span class="country-card__code">${escapeHtml(c.code)}</span>
          </span>
          <span class="country-card__check" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="icon" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6 9 17l-5-5"/>
            </svg>
          </span>
        </button>
      `;
    }).join('');

    requestAnimationFrame(() => Focus.refresh({ autoFocus: false }));
  }

  function updateCounts() {
    const size = selected.size;
    if (countBadge) countBadge.textContent = `${size} país${size === 1 ? '' : 'es'} seleccionado${size === 1 ? '' : 's'}`;
    if (btnCount) btnCount.textContent = String(size);
    if (submitBtn) submitBtn.disabled = size === 0;
  }

  // Eventos de seleccion de país
  grid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-code]');
    if (!card) return;
    const code = card.dataset.code;
    if (selected.has(code)) {
      selected.delete(code);
      card.classList.remove('is-checked');
      card.setAttribute('aria-checked', 'false');
    } else {
      selected.add(code);
      card.classList.add('is-checked');
      card.setAttribute('aria-checked', 'true');
    }
    updateCounts();
  });

  // Pestañas de Región
  m.root.querySelectorAll('[data-region]').forEach((tab) => {
    tab.addEventListener('click', () => {
      m.root.querySelectorAll('[data-region]').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      currentRegion = tab.dataset.region || 'todos';
      renderGrid();
    });
  });

  // Seleccionar todos los visibles
  m.root.querySelector('#modal-select-all')?.addEventListener('click', () => {
    const visible = getFilteredCountries();
    visible.forEach((c) => selected.add(c.code));
    grid.querySelectorAll('.country-card').forEach((card) => card.classList.add('is-checked'));
    updateCounts();
  });

  // Deseleccionar todos
  m.root.querySelector('#modal-deselect-all')?.addEventListener('click', () => {
    selected.clear();
    grid.querySelectorAll('.country-card').forEach((card) => card.classList.remove('is-checked'));
    updateCounts();
  });

  m.root.querySelector('[data-cancel]')?.addEventListener('click', () => m.close());

  // Confirmar y cargar con Gestor de Porcentaje en tiempo real
  submitBtn?.addEventListener('click', async () => {
    if (!selected.size) {
      toast('Selecciona al menos un país', 'warn');
      return;
    }

    const codes = Array.from(selected);
    try {
      localStorage.setItem(STORAGE_COUNTRIES_KEY, JSON.stringify(codes));
    } catch (_) {}

    const urls = codes.map((code) => freeListUrl(code));
    const labels = codes.map((code) => {
      const match = SPANISH_COUNTRIES.find((c) => c.code === code);
      return match ? match.name : code;
    });

    const profile = {
      id: `free-${codes.join('-').toLowerCase()}`,
      type: 'm3u',
      name: `Canales Free (${codes.length} países)`,
      urls,
      labels,
    };

    // Cambiar cuerpo del modal al Gestor de Carga visual
    const modalBody = m.root.querySelector('.modal__body');
    const modalFoot = m.root.querySelector('.modal__foot');
    if (modalFoot) modalFoot.style.display = 'none';

    if (modalBody) {
      modalBody.innerHTML = `
        <div class="progress-manager">
          <div class="progress-manager__head">
            <div class="progress-manager__icon">${icon('wifi', 'icon icon--lg')}</div>
            <div class="progress-manager__title">Descargando Canales Free</div>
            <div class="progress-manager__sub">Conectando y buscando listas en repositorios de GitHub...</div>
          </div>
          <div class="progress-manager__pct" id="load-progress-pct">0%</div>
          <div class="progress-manager__bar">
            <div class="progress-manager__fill" id="load-progress-fill" style="width:0%"></div>
          </div>
          <div class="progress-manager__status" id="load-progress-status">Iniciando descarga...</div>
        </div>
      `;
    }

    try {
      store.set({ profile, account: null });
      store.saveNow();

      await refreshCatalog(profile, {
        onProgress: (ratio, status) => {
          const pct = Math.min(100, Math.max(0, Math.round(ratio * 100)));
          const pctEl = m.root.querySelector('#load-progress-pct');
          const fillEl = m.root.querySelector('#load-progress-fill');
          const statusEl = m.root.querySelector('#load-progress-status');
          if (pctEl) pctEl.textContent = `${pct}%`;
          if (fillEl) fillEl.style.width = `${pct}%`;
          if (statusEl && status) statusEl.textContent = status;
        },
      });

      const pctEl = m.root.querySelector('#load-progress-pct');
      const fillEl = m.root.querySelector('#load-progress-fill');
      const statusEl = m.root.querySelector('#load-progress-status');
      if (pctEl) pctEl.textContent = '100%';
      if (fillEl) fillEl.style.width = '100%';
      if (statusEl) statusEl.textContent = '¡Canales cargados con éxito! Abriendo TV Live...';

      setTimeout(() => {
        m.close();
        navigate('/live');
        toast('Canales Free cargados correctamente', 'ok', 2500);
      }, 600);
    } catch (err) {
      const statusEl = m.root.querySelector('#load-progress-status');
      if (statusEl) {
        statusEl.innerHTML = `<span style="color:var(--danger)">Error: ${escapeHtml(err?.message || 'Fallo al cargar canales')}</span>`;
      }
      if (modalFoot) {
        modalFoot.style.display = '';
        modalFoot.innerHTML = `<button class="btn btn--ghost" data-focusable data-cancel>Cerrar</button>`;
        modalFoot.querySelector('[data-cancel]')?.addEventListener('click', () => m.close());
      }
    }
  });

  renderGrid();
  updateCounts();
}

/**
 * Modal visual con barra de progreso y porcentaje numérico en tiempo real (0% - 100%)
 * para la carga y conexión de listas externas (M3U / Xtream Codes).
 */
export function showCatalogLoadingModal(profile, {
  title = 'Cargando Lista Externa',
  force = true,
  onComplete = null,
} = {}) {
  const isXtream = profile?.type === 'xtream';
  const name = profile?.name || (isXtream ? 'Xtream Codes' : 'Lista M3U');

  const body = `
    <div class="progress-manager">
      <div class="progress-manager__head">
        <div class="progress-manager__icon">${icon(isXtream ? 'crown' : 'link', 'icon icon--lg')}</div>
        <div class="progress-manager__title">${escapeHtml(title)}</div>
        <div class="progress-manager__sub">${escapeHtml(name)}</div>
      </div>
      <div class="progress-manager__pct" id="load-progress-pct">0%</div>
      <div class="progress-manager__bar">
        <div class="progress-manager__fill" id="load-progress-fill" style="width:0%"></div>
      </div>
      <div class="progress-manager__status" id="load-progress-status">Iniciando conexión con el servidor...</div>
    </div>
  `;

  const m = modal({
    title: 'Cargando Contenido',
    body,
    wide: false,
    footer: `<button class="btn btn--ghost" data-focusable data-cancel-load style="display:none">Cerrar</button>`,
  });

  if (!m) return Promise.reject(new Error('No se pudo abrir modal de carga'));

  const pctEl = m.root.querySelector('#load-progress-pct');
  const fillEl = m.root.querySelector('#load-progress-fill');
  const statusEl = m.root.querySelector('#load-progress-status');
  const cancelBtn = m.root.querySelector('[data-cancel-load]');

  cancelBtn?.addEventListener('click', () => m.close());

  return new Promise(async (resolve, reject) => {
    try {
      const runner = force ? refreshCatalog : loadCatalog;
      await runner(profile, {
        onProgress: (ratio, status) => {
          const pct = Math.min(100, Math.max(0, Math.round((ratio || 0) * 100)));
          if (pctEl) pctEl.textContent = `${pct}%`;
          if (fillEl) fillEl.style.width = `${pct}%`;
          if (statusEl && status) statusEl.textContent = status;
        },
      });

      if (pctEl) pctEl.textContent = '100%';
      if (fillEl) fillEl.style.width = '100%';
      if (statusEl) statusEl.textContent = '¡Carga completa al 100%! Abriendo contenido...';

      setTimeout(() => {
        m.close();
        if (onComplete) {
          onComplete();
        } else {
          navigate('/live');
        }
        toast(`Lista ${name} cargada al 100%`, 'ok', 2500);
        resolve();
      }, 550);
    } catch (err) {
      if (statusEl) {
        statusEl.innerHTML = `<span style="color:var(--danger)">Error: ${escapeHtml(err?.message || 'Fallo al cargar lista')}</span>`;
      }
      if (cancelBtn) {
        cancelBtn.style.display = 'inline-block';
      }
      toast(err?.message || 'Error cargando lista', 'error', 3000);
      reject(err);
    }
  });
}

/**
 * Modal para gestionar y conectar listas externas (M3U / Xtream Codes).
 * Permite usar más de una lista externa, alternar entre ellas en cualquier momento,
 * y únicamente se eliminan cuando el usuario lo solicita explícitamente.
 */
export function openExternalListsModal() {
  const externalProfiles = store.state.externalProfiles || [];
  const currentProfileId = store.state.profile?.id;

  const savedListsHtml = externalProfiles.length > 0 ? `
    <div class="saved-lists-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="saved-lists-title" style="margin:0">Tus Listas Guardadas (${externalProfiles.length})</div>
        <button type="button" class="btn btn--sm btn--ghost" id="modal-open-countries-shortcut" data-focusable style="font-size:0.8rem">
          ${icon('globe', 'icon icon--sm')} Países Free
        </button>
      </div>
      <div class="saved-lists-grid">
        ${externalProfiles.map((p) => {
          const isActive = p.id === currentProfileId;
          return `
            <div class="saved-list-card${isActive ? ' is-active' : ''}">
              <div class="saved-list-card__info">
                <span class="saved-list-card__badge">${(p.type || 'M3U').toUpperCase()}</span>
                <span class="saved-list-card__title" title="${escapeAttr(p.name)}">${escapeHtml(p.name)}</span>
                ${isActive ? `<span class="saved-list-card__active-pill">✓ ACTIVA</span>` : ''}
              </div>
              <div class="saved-list-card__actions">
                ${!isActive ? `<button type="button" class="btn btn--sm btn--primary" data-focusable data-switch-profile="${p.id}">Conectar</button>` : ''}
                <button type="button" class="btn btn--sm btn--danger" data-focusable data-delete-profile="${p.id}" title="Eliminar lista">🗑</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  ` : `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
      <button type="button" class="btn btn--sm btn--ghost" id="modal-open-countries-shortcut" data-focusable style="font-size:0.8rem">
        ${icon('globe', 'icon icon--sm')} Ver Países Free (IPTV-org)
      </button>
    </div>
  `;

  const body = `
    <div class="lists-modal">
      ${savedListsHtml}

      <div class="saved-lists-title" style="margin-top:12px">Agregar / Conectar Nueva Lista</div>
      <p style="color:var(--muted);font-size:.85rem;margin-bottom:12px;line-height:1.4">
        Pega un enlace M3U, enlace Xtream Codes o completa los datos del servidor.
      </p>

      <div class="login__tabs" role="tablist" style="margin-bottom:14px">
        <button class="login__tab is-active" data-focusable data-list-tab="m3u" role="tab">Enlace M3U / URL</button>
        <button class="login__tab" data-focusable data-list-tab="xtream" role="tab">Xtream Codes</button>
      </div>

      <div class="login__error" id="modal-list-error"></div>

      <form id="modal-list-form" autocomplete="off">
        <div id="modal-pane-m3u">
          <div class="field" style="margin-bottom:10px">
            <div class="field__label-row">
              <label for="modal-m3u-url">URL de la lista M3U</label>
              <button type="button" class="login__paste-btn" id="modal-paste-m3u-btn" data-focusable title="Pegar del portapapeles">
                📋 Pegar
              </button>
            </div>
            <input class="input" id="modal-m3u-url" data-focusable type="text" inputmode="url" autocomplete="off" autocorrect="off" autocapitalize="none" placeholder="http://servidor.com/lista.m3u" spellcheck="false">
          </div>
          <div class="field">
            <label for="modal-m3u-name" class="label--compact">Nombre de la lista (opcional)</label>
            <input class="input input--compact" id="modal-m3u-name" data-focusable type="text" placeholder="Mi lista M3U">
          </div>
        </div>

        <div id="modal-pane-xtream" class="hidden">
          <div class="field" style="margin-bottom:10px">
            <div class="field__label-row">
              <label for="modal-xtream-server">Servidor (Host y Puerto)</label>
              <button type="button" class="login__paste-btn" id="modal-paste-xtream-btn" data-focusable title="Pegar del portapapeles">
                📋 Pegar
              </button>
            </div>
            <input class="input" id="modal-xtream-server" data-focusable type="text" inputmode="url" autocomplete="off" autocorrect="off" autocapitalize="none" placeholder="http://servidor.com:8080" spellcheck="false">
          </div>
          <div class="login__xtream-row">
            <div class="field">
              <label for="modal-xtream-user">Usuario</label>
              <input class="input input--compact" id="modal-xtream-user" data-focusable type="text" placeholder="usuario" spellcheck="false">
            </div>
            <div class="field">
              <label for="modal-xtream-pass">Contraseña</label>
              <input class="input input--compact" id="modal-xtream-pass" data-focusable type="password" placeholder="contraseña">
            </div>
          </div>
        </div>
      </form>
    </div>
  `;

  const m = modal({
    title: 'Listas Externas / Xtream',
    body,
    wide: false,
    footer: `
      <button class="btn btn--ghost" data-focusable data-cancel>Cancelar</button>
      <button class="btn btn--primary" id="modal-submit-list" data-focusable>
        ${icon('play', 'icon icon--sm')} Conectar lista
      </button>
    `,
  });

  if (!m) return;

  const form = m.root.querySelector('#modal-list-form');
  const errorBox = m.root.querySelector('#modal-list-error');
  const submitBtn = m.root.querySelector('#modal-submit-list');
  let mode = 'm3u';

  function showError(msg) {
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.classList.add('is-visible');
    }
  }

  function clearErr() {
    if (errorBox) {
      errorBox.textContent = '';
      errorBox.classList.remove('is-visible');
    }
  }

  // Cambio y eliminación de listas guardadas
  m.root.addEventListener('click', async (event) => {
    const switchBtn = event.target.closest('[data-switch-profile]');
    if (switchBtn) {
      const pid = switchBtn.dataset.switchProfile;
      const target = (store.state.externalProfiles || []).find((x) => x.id === pid);
      if (target) {
        store.switchProfile(target);
        m.close();
        showCatalogLoadingModal(target, {
          title: `Conectando con ${target.name}`,
          onComplete: () => navigate('/live'),
        }).catch(() => {});
      }
      return;
    }

    const delBtn = event.target.closest('[data-delete-profile]');
    if (delBtn) {
      const pid = delBtn.dataset.deleteProfile;
      const target = (store.state.externalProfiles || []).find((x) => x.id === pid);
      const targetName = target?.name || 'esta lista';
      const confirmed = await confirmDialog({
        title: 'Eliminar Lista',
        message: `¿Eliminar permanentemente la lista "${targetName}" y su contenido?`,
        okLabel: 'Eliminar',
        cancelLabel: 'Cancelar',
        danger: true,
      });
      if (confirmed) {
        await DB.deleteProfile(pid);
        store.removeExternalProfile(pid);
        toast('Lista eliminada correctamente', 'ok');
        m.close();
        openExternalListsModal();
      }
      return;
    }

    const shortcutBtn = event.target.closest('#modal-open-countries-shortcut');
    if (shortcutBtn) {
      m.close();
      openFreeCountriesModal();
      return;
    }
  });

  const getClipboardModal = async () => {
    if (window.AndroidNativeApp && typeof window.AndroidNativeApp.getClipboardText === 'function') {
      try {
        const t = window.AndroidNativeApp.getClipboardText();
        if (t) return t;
      } catch (_) {}
    }
    if (navigator.clipboard?.readText) {
      try {
        return await navigator.clipboard.readText();
      } catch (_) {}
    }
    return '';
  };

  m.root.querySelector('#modal-paste-m3u-btn')?.addEventListener('click', async () => {
    const inp = m.root.querySelector('#modal-m3u-url');
    if (!inp) return;
    try {
      const text = await getClipboardModal();
      if (text && text.trim()) {
        inp.value = text.trim();
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        toast('Enlace copiado pegado exactamente', 'ok', 1800);
      } else {
        toast('Portapapeles sin texto disponible', 'info', 1800);
        inp.focus();
      }
    } catch (_) {
      inp.focus();
      toast('Mantén presionado sobre el campo para pegar', 'info', 1800);
    }
  });

  m.root.querySelector('#modal-paste-xtream-btn')?.addEventListener('click', async () => {
    const inp = m.root.querySelector('#modal-xtream-server');
    if (!inp) return;
    try {
      const text = await getClipboardModal();
      if (text && text.trim()) {
        const raw = text.trim();
        const creds = parseXtreamLink(raw);
        if (creds) {
          m.root.querySelector('#modal-xtream-server').value = creds.server;
          m.root.querySelector('#modal-xtream-user').value = creds.username;
          m.root.querySelector('#modal-xtream-pass').value = creds.password;
          toast('Enlace Xtream detectado y rellenado', 'ok', 2500);
        } else {
          inp.value = raw;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          toast('Texto pegado correctamente', 'ok', 1800);
        }
      } else {
        toast('Portapapeles sin texto disponible', 'info', 1800);
        inp.focus();
      }
    } catch (_) {
      inp.focus();
      toast('Mantén presionado sobre el campo para pegar', 'info', 1800);
    }
  });

  // Cambio de pestañas M3U / Xtream
  m.root.querySelectorAll('[data-list-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      mode = tab.dataset.listTab;
      m.root.querySelectorAll('[data-list-tab]').forEach((t) => t.classList.toggle('is-active', t === tab));
      m.root.querySelector('#modal-pane-m3u')?.classList.toggle('hidden', mode !== 'm3u');
      m.root.querySelector('#modal-pane-xtream')?.classList.toggle('hidden', mode !== 'xtream');
      clearErr();
    });
  });

  m.root.querySelector('[data-cancel]')?.addEventListener('click', () => m.close());

  submitBtn?.addEventListener('click', async () => {
    clearErr();
    if (mode === 'm3u') {
      const url = m.root.querySelector('#modal-m3u-url')?.value.trim();
      const name = m.root.querySelector('#modal-m3u-name')?.value.trim() || 'Lista Externa M3U';
      if (!url) {
        showError('Ingresa la URL de la lista M3U');
        return;
      }
      const creds = parseXtreamLink(url);
      if (creds) {
        mode = 'xtream';
        m.root.querySelector('#modal-xtream-server').value = creds.server;
        m.root.querySelector('#modal-xtream-user').value = creds.username;
        m.root.querySelector('#modal-xtream-pass').value = creds.password;
      } else {
        try {
          new URL(url);
        } catch (_) {
          showError('La URL ingresada no es válida');
          return;
        }
        const profile = { id: uid(), type: 'm3u', name, url };
        store.addExternalProfile(profile, null);
        m.close();
        showCatalogLoadingModal(profile, {
          title: 'Cargando Lista M3U Externa',
          onComplete: () => navigate('/live'),
        }).catch((err) => {
          toast(err?.message || 'Error cargando lista M3U', 'error');
        });
        return;
      }
    }

    // Modo Xtream
    const server = m.root.querySelector('#modal-xtream-server')?.value.trim();
    const username = m.root.querySelector('#modal-xtream-user')?.value.trim();
    const password = m.root.querySelector('#modal-xtream-pass')?.value;
    if (!server || !username || !password) {
      showError('Completa servidor, usuario y contraseña');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner"></span> Verificando Xtream...`;
    try {
      const normalized = normalizeServer(server);
      const profile = {
        id: uid(),
        type: 'xtream',
        name: new URL(normalized).host,
        server: normalized,
        username,
        password,
      };
      const client = new XtreamClient(profile);
      const account = await client.account();
      if (!account.auth) {
        throw new Error('Credenciales incorrectas en el panel Xtream');
      }
      store.addExternalProfile(profile, account);
      m.close();
      showCatalogLoadingModal(profile, {
        title: 'Cargando Servidor Xtream',
        onComplete: () => navigate('/live'),
      }).catch((err) => {
        toast(err?.message || 'Error cargando panel Xtream', 'error');
      });
    } catch (err) {
      showError(err?.message || 'No se pudo conectar con el servidor Xtream');
      submitBtn.disabled = false;
      submitBtn.innerHTML = `${icon('play', 'icon icon--sm')} Conectar lista`;
    }
  });
}

/**
 * Modal de salida y gestión de sesión.
 */
export function openExitModal() {
  const profileName = store.state.profile?.name || 'la sesión actual';

  const body = `
    <div style="text-align:center;padding:10px 4px">
      <div style="font-size:2rem;margin-bottom:12px;color:var(--accent)">
        ${icon('tv', 'icon icon--lg')}
      </div>
      <h3 style="font-size:1.15rem;font-weight:800;margin-bottom:8px">¿Qué deseas hacer?</h3>
      <p style="color:var(--muted);font-size:.88rem;line-height:1.5;max-width:360px;margin:0 auto 20px">
        Actualmente conectado a: <b>${escapeHtml(profileName)}</b>
      </p>

      <div style="display:grid;gap:10px;max-width:320px;margin:0 auto">
        <button class="btn btn--secondary" id="btn-modal-switch-lists" data-focusable style="height:44px">
          ${icon('link', 'icon icon--sm')} Mis Listas / Cambiar de lista
        </button>
        <button class="btn btn--primary" id="btn-modal-logout" data-focusable style="height:44px">
          ${icon('logout', 'icon icon--sm')} Cerrar sesión
        </button>
        <button class="btn btn--danger" id="btn-modal-exit-app" data-focusable style="height:44px">
          ${icon('close', 'icon icon--sm')} Salir de la aplicación
        </button>
      </div>
    </div>
  `;

  const m = modal({
    title: 'Gestión de Sesión',
    body,
    wide: false,
    footer: `<button class="btn btn--ghost" data-focusable data-cancel>Cancelar</button>`,
  });

  if (!m) return;

  m.root.querySelector('[data-cancel]')?.addEventListener('click', () => m.close());

  m.root.querySelector('#btn-modal-switch-lists')?.addEventListener('click', () => {
    m.close();
    openExternalListsModal();
  });

  m.root.querySelector('#btn-modal-logout')?.addEventListener('click', () => {
    m.close();
    store.resetProfile();
    navigate('/login', {}, { replace: true });
  });

  m.root.querySelector('#btn-modal-exit-app')?.addEventListener('click', () => {
    m.close();
    try {
      if (window.AndroidNativeApp?.exitApp) {
        window.AndroidNativeApp.exitApp();
        return;
      }
    } catch (_) {}
    try {
      if (window.Capacitor?.Plugins?.App?.exitApp) {
        window.Capacitor.Plugins.App.exitApp();
        return;
      }
    } catch (_) {}
    try {
      window.close();
    } catch (_) {}
    navigate('/login', {}, { replace: true });
  });
}

/**
 * Modal PIN Pad con teclado numérico en pantalla y soporte para teclas físicas del control remoto.
 * Soporta modos: 'verify' (validar PIN actual) o 'set' (crear/cambiar con doble confirmación).
 */
export function showPinModal({
  title = 'Contenido Protegido',
  subtitle = 'Ingresa el PIN de 4 dígitos',
  mode = 'verify',
  onSuccess = null,
  onCancel = null,
} = {}) {
  let entered = '';
  let firstPin = '';
  let step = mode === 'set' ? 'enter_new' : 'verify';

  let currentTitle = title;
  let currentSub = subtitle;
  if (mode === 'set') {
    currentTitle = 'Nuevo PIN de Seguridad';
    currentSub = 'Ingresa 4 dígitos numéricos';
  }

  const body = `
    <div class="pin-pad-container" id="pin-pad-box">
      <div class="pin-pad__header">
        <div class="pin-pad__icon">${icon('lock', 'icon icon--lg')}</div>
        <div class="pin-pad__title" id="pin-modal-title">${escapeHtml(currentTitle)}</div>
        <div class="pin-pad__sub" id="pin-modal-sub">${escapeHtml(currentSub)}</div>
      </div>
      <div class="pin-dots" id="pin-modal-dots">
        <div class="pin-dot"></div>
        <div class="pin-dot"></div>
        <div class="pin-dot"></div>
        <div class="pin-dot"></div>
      </div>
      <div class="pin-error" id="pin-modal-error"></div>
      <div class="pin-keypad" id="pin-modal-keypad">
        <button type="button" class="pin-btn" data-focusable data-pin-digit="1">1</button>
        <button type="button" class="pin-btn" data-focusable data-pin-digit="2">2</button>
        <button type="button" class="pin-btn" data-focusable data-pin-digit="3">3</button>
        <button type="button" class="pin-btn" data-focusable data-pin-digit="4">4</button>
        <button type="button" class="pin-btn" data-focusable data-pin-digit="5">5</button>
        <button type="button" class="pin-btn" data-focusable data-pin-digit="6">6</button>
        <button type="button" class="pin-btn" data-focusable data-pin-digit="7">7</button>
        <button type="button" class="pin-btn" data-focusable data-pin-digit="8">8</button>
        <button type="button" class="pin-btn" data-focusable data-pin-digit="9">9</button>
        <button type="button" class="pin-btn pin-btn--action" data-focusable data-pin-action="backspace" title="Borrar">⌫</button>
        <button type="button" class="pin-btn" data-focusable data-pin-digit="0">0</button>
        <button type="button" class="pin-btn pin-btn--action pin-btn--cancel" data-focusable data-pin-action="cancel" title="Cancelar">✕</button>
      </div>
    </div>
  `;

  const m = modal({
    title: 'Control Parental',
    body,
    wide: false,
    footer: '',
  });

  if (!m) return Promise.reject(new Error('No se pudo abrir modal de PIN'));

  return new Promise((resolve, reject) => {
    const dotsContainer = m.root.querySelector('#pin-modal-dots');
    const dots = m.root.querySelectorAll('.pin-dot');
    const errorEl = m.root.querySelector('#pin-modal-error');
    const titleEl = m.root.querySelector('#pin-modal-title');
    const subEl = m.root.querySelector('#pin-modal-sub');

    function updateDots() {
      dots.forEach((dot, idx) => {
        dot.classList.toggle('is-filled', idx < entered.length);
        dot.classList.remove('is-error', 'is-success');
      });
    }

    function showErr(msg) {
      if (errorEl) errorEl.textContent = msg;
      if (dotsContainer) {
        dotsContainer.classList.add('shake');
        dots.forEach((d) => d.classList.add('is-error'));
        setTimeout(() => {
          dotsContainer?.classList.remove('shake');
          dots.forEach((d) => d.classList.remove('is-error'));
          entered = '';
          updateDots();
        }, 500);
      }
    }

    function handleComplete() {
      if (mode === 'set') {
        if (step === 'enter_new') {
          firstPin = entered;
          entered = '';
          step = 'confirm_new';
          if (titleEl) titleEl.textContent = 'Confirma tu PIN';
          if (subEl) subEl.textContent = 'Vuelve a ingresar los 4 dígitos';
          if (errorEl) errorEl.textContent = '';
          updateDots();
          return;
        } else if (step === 'confirm_new') {
          if (entered === firstPin) {
            dots.forEach((d) => d.classList.add('is-success'));
            store.updateParental({ pin: entered });
            toast('PIN actualizado correctamente', 'ok', 2500);
            cleanup();
            m.close();
            if (onSuccess) onSuccess(entered);
            resolve(entered);
          } else {
            showErr('Los PINs no coinciden. Intenta de nuevo.');
            step = 'enter_new';
            firstPin = '';
            if (titleEl) titleEl.textContent = 'Nuevo PIN de Seguridad';
            if (subEl) subEl.textContent = 'Ingresa 4 dígitos numéricos';
          }
          return;
        }
      }

      // Modo 'verify'
      const valid = verifyPin(entered);
      if (valid) {
        dots.forEach((d) => d.classList.add('is-success'));
        setTimeout(() => {
          cleanup();
          m.close();
          if (onSuccess) onSuccess();
          resolve(true);
        }, 200);
      } else {
        showErr('PIN incorrecto. Intenta de nuevo.');
      }
    }

    function addDigit(digit) {
      if (entered.length < 4) {
        entered += digit;
        if (errorEl) errorEl.textContent = '';
        updateDots();
        if (entered.length === 4) {
          setTimeout(handleComplete, 80);
        }
      }
    }

    function backspace() {
      if (entered.length > 0) {
        entered = entered.slice(0, -1);
        if (errorEl) errorEl.textContent = '';
        updateDots();
      }
    }

    function cancel() {
      cleanup();
      m.close();
      if (onCancel) onCancel();
      reject(new Error('Cancelado por el usuario'));
    }

    const onKey = (e) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        addDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey);

    const onClick = (e) => {
      const digitBtn = e.target.closest('[data-pin-digit]');
      if (digitBtn) {
        addDigit(digitBtn.dataset.pinDigit);
        return;
      }
      const actionBtn = e.target.closest('[data-pin-action]');
      if (actionBtn) {
        const act = actionBtn.dataset.pinAction;
        if (act === 'backspace') backspace();
        else if (act === 'cancel') cancel();
      }
    };
    m.root.addEventListener('click', onClick);

    function cleanup() {
      window.removeEventListener('keydown', onKey);
      m.root.removeEventListener('click', onClick);
    }
  });
}

/**
 * Modal para gestionar el bloqueo manual de categorías.
 */
export function openManageCategoriesModal() {
  const cats = store.state.categories.live || [];
  const lockedSet = new Set(store.state.settings.parental?.customLockedCats || []);

  const body = `
    <div style="max-height:60vh;overflow-y:auto;padding-right:6px">
      <p style="font-size:0.85rem;color:var(--muted);margin-bottom:12px;line-height:1.4">
        Las categorías marcadas requerirán PIN para abrirse o reproducir sus canales.
      </p>
      <div style="display:grid;gap:8px" id="manage-cats-list">
        ${cats.length ? cats.map((c) => {
          const isAutoAdult = isAdultString(c.name || '') || isAdultString(c.id || '');
          const isChecked = lockedSet.has(String(c.id)) || isAutoAdult;
          return `
            <div class="setting-row" style="padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:10px">
              <div>
                <div style="font-weight:700;font-size:0.9rem;display:flex;align-items:center;gap:6px">
                  ${escapeHtml(c.name)}
                  ${isAutoAdult ? `<span class="chip warn" style="font-size:0.65rem;padding:2px 6px">Auto Adulto</span>` : ''}
                </div>
                <div style="font-size:0.75rem;color:var(--muted)">${c.count || 0} canales</div>
              </div>
              <div>
                <button type="button" class="switch${isChecked ? ' is-on' : ''}" data-focusable data-toggle-cat="${escapeAttr(c.id)}" role="switch" aria-checked="${isChecked}"></button>
              </div>
            </div>
          `;
        }).join('') : `<div class="empty-inline" style="text-align:center;padding:20px;color:var(--muted)">No hay categorías disponibles</div>`}
      </div>
    </div>
  `;

  const m = modal({
    title: 'Bloqueo Manual de Categorías',
    body,
    wide: false,
    footer: `<button class="btn btn--primary" data-focusable data-cancel>Listo</button>`,
  });

  if (!m) return;

  m.root.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-toggle-cat]');
    if (sw) {
      const catId = sw.dataset.toggleCat;
      store.toggleLockedCategory(catId);
      const isNowLocked = (store.state.settings.parental?.customLockedCats || []).includes(String(catId));
      sw.classList.toggle('is-on', isNowLocked);
      sw.setAttribute('aria-checked', String(isNowLocked));
      return;
    }
    if (e.target.closest('[data-cancel]')) {
      m.close();
    }
  });
}

export function openLegalModal(initialTab = 'terms') {
  let activeTab = initialTab === 'privacy' ? 'privacy' : 'terms';

  const termsHtml = `
    <div style="display:grid;gap:10px;font-size:0.86rem;line-height:1.55;color:var(--text-2)">
      <p><strong style="color:var(--text)">1. Naturaleza de la Aplicación (Solo Reproductor):</strong> EDU-IPTV PRO es exclusivamente un reproductor multimedia compatible con listas M3U y paneles Xtream Codes proporcionados por el usuario. <strong>NO incluye, aloja, distribuye ni vende canales, películas, series ni credenciales propias.</strong></p>
      <p><strong style="color:var(--text)">2. Responsabilidad sobre el Contenido:</strong> El usuario es el único responsable de las URLs, servidores y credenciales que introduzca, y garantiza contar con los derechos o autorizaciones legales para reproducir dicho contenido.</p>
      <p><strong style="color:var(--text)">3. Ausencia de Afiliación:</strong> Proyecto independiente sin afiliación ni respaldo de Xtream Codes, proveedores IPTV o cadenas de terceros.</p>
      <p><strong style="color:var(--text)">4. Listas Públicas:</strong> El acceso opcional a directorios públicos gratuitos funciona únicamente como visor externo; no garantizamos su disponibilidad ni continuidad.</p>
      <p><strong style="color:var(--text)">5. Limitación de Responsabilidad:</strong> La aplicación se ofrece "tal cual" (AS IS), sin garantías de disponibilidad continua o compatibilidad universal de códecs.</p>
      <p><strong style="color:var(--text)">6. Control Parental:</strong> La configuración y custodia del PIN de bloqueo es responsabilidad exclusiva del usuario adulto.</p>
    </div>
  `;

  const privacyHtml = `
    <div style="display:grid;gap:10px;font-size:0.86rem;line-height:1.55;color:var(--text-2)">
      <p><strong style="color:var(--text)">1. Cero Recopilación Remota:</strong> EDU-IPTV PRO <strong>no recopila, transmite ni vende datos personales</strong> a servidores propios del desarrollador, ni incluye rastreadores de publicidad o analíticas de terceros.</p>
      <p><strong style="color:var(--text)">2. Almacenamiento Local:</strong> Tus preferencias, perfil, favoritos, progreso y caché de catálogo se guardan únicamente en tu dispositivo (<code>localStorage</code> e <code>IndexedDB</code>), junto con un registro técnico local de diagnóstico.</p>
      <p><strong style="color:var(--text)">3. Conexiones Directas:</strong> El permiso de Internet se usa exclusivamente para conectar directamente con los servidores M3U/Xtream/EPG que tú configures.</p>
      <p><strong style="color:var(--text)">4. Eliminación de Datos:</strong> Puedes borrar toda tu información local en cualquier momento desde <strong>Ajustes → Cerrar sesión</strong> o limpiando los datos de la app en Android.</p>
    </div>
  `;

  const body = `
    <div style="display:grid;gap:14px">
      <div class="region-tabs" role="tablist">
        <button type="button" class="region-tab${activeTab === 'terms' ? ' is-active' : ''}" data-focusable data-legal-tab="terms" role="tab">Términos de Uso</button>
        <button type="button" class="region-tab${activeTab === 'privacy' ? ' is-active' : ''}" data-focusable data-legal-tab="privacy" role="tab">Política de Privacidad</button>
      </div>
      <div id="legal-modal-content" style="max-height:54vh;overflow-y:auto;padding-right:6px">
        ${activeTab === 'privacy' ? privacyHtml : termsHtml}
      </div>
    </div>
  `;

  const m = modal({
    title: 'Información Legal · EDU-IPTV PRO',
    body,
    wide: true,
    footer: `<button type="button" class="btn btn--primary" data-focusable data-cancel>Entendido</button>`,
  });

  if (!m) return;

  const contentEl = m.root.querySelector('#legal-modal-content');
  m.root.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-legal-tab]');
    if (tabBtn) {
      activeTab = tabBtn.dataset.legalTab === 'privacy' ? 'privacy' : 'terms';
      m.root.querySelectorAll('[data-legal-tab]').forEach((b) => b.classList.toggle('is-active', b === tabBtn));
      if (contentEl) {
        contentEl.innerHTML = activeTab === 'privacy' ? privacyHtml : termsHtml;
        contentEl.scrollTop = 0;
      }
      return;
    }
    if (e.target.closest('[data-cancel]')) {
      m.close();
    }
  });
}

export async function openRemoteControlModal() {
  let info = null;
  try {
    info = await startRemoteServer();
  } catch (err) {
    toast(err?.message || 'No se pudo iniciar el control móvil', 'error', 3000);
    return;
  }

  const qrSvg = renderQrSvg(info.url, 196);
  const body = `
    <div style="display:grid;gap:14px;justify-items:center;text-align:center">
      <p style="font-size:0.88rem;color:var(--text-2);line-height:1.45;margin:0">
        Escanea este QR con tu <strong>iPhone o Android</strong> (en el mismo Wi-Fi) para pegar listas M3U/Xtream y usar el control remoto desde el celular.
      </p>
      <div style="padding:10px;background:#fff;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,0.35)">
        ${qrSvg || '<div style="color:#05050a;padding:16px">Usa la dirección de abajo</div>'}
      </div>
      <div style="background:rgba(255,255,255,0.04);border:1px solid var(--line);border-radius:12px;padding:10px 14px;width:100%">
        <div style="font-size:0.75rem;color:var(--muted);margin-bottom:4px">Dirección local</div>
        <div style="font-family:var(--mono);font-size:0.92rem;color:var(--accent);word-break:break-all">${escapeHtml(info.url)}</div>
        <div style="font-size:0.8rem;color:var(--text-2);margin-top:6px">PIN de acceso: <strong style="color:var(--accent)">${escapeHtml(info.token)}</strong></div>
      </div>
      <p style="font-size:0.76rem;color:var(--muted);margin:0">
        Puedes cerrar esta ventana; el control seguirá activo mientras la app esté abierta.
      </p>
    </div>
  `;

  const m = modal({
    title: 'Control y Carga desde Móvil',
    body,
    wide: false,
    footer: `
      <button type="button" class="btn btn--ghost" data-focusable data-remote-stop>Apagar</button>
      <button type="button" class="btn btn--primary" data-focusable data-cancel>Listo</button>
    `,
  });

  if (!m) return;
  m.root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-remote-stop]')) {
      await stopRemoteServer().catch(() => {});
      toast('Control móvil desactivado', 'info', 1800);
      m.close();
      return;
    }
    if (e.target.closest('[data-cancel]')) {
      m.close();
    }
  });
}

export function showHardwareRecommendationModal(hw) {
  const deviceName = [hw?.manufacturer, hw?.model].filter(Boolean).join(' ') || 'Dispositivo Android';
  const abi = hw?.primaryAbi || 'desconocida';
  const reason = hw?.isX86
    ? `Se detectó arquitectura <strong>${escapeHtml(abi)}</strong> en <strong>${escapeHtml(deviceName)}</strong>. Este entorno no cuenta con aceleración H.264 completa para ExoPlayer.`
    : `El dispositivo <strong>${escapeHtml(deviceName)}</strong> (${escapeHtml(abi)}) tiene decodificación de video por hardware limitada.`;

  const body = `
    <div style="display:grid;gap:12px;font-size:0.88rem;line-height:1.5;color:var(--text-2)">
      <p style="margin:0">${reason}</p>
      <p style="margin:0">Para reproducir canales HD/FHD sin cortes ni fallos de códec, te recomendamos instalar <strong>VLC for Android</strong> (o usar el modo web integrado).</p>
    </div>
  `;

  const m = modal({
    title: 'Compatibilidad de Video Detectada',
    body,
    wide: false,
    footer: `
      <button type="button" class="btn btn--ghost" data-focusable data-hw-web>Usar modo Web</button>
      <button type="button" class="btn btn--primary" data-focusable data-hw-vlc>Instalar VLC</button>
    `,
  });

  if (!m) return;
  m.root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-hw-web]')) {
      store.setSettings({ engine: 'web' });
      toast('Motor cambiado a HLS.js (Web)', 'ok', 2500);
      m.close();
      return;
    }
    if (e.target.closest('[data-hw-vlc]')) {
      try {
        await window.Capacitor?.Plugins?.ExoPlayerPlugin?.openPlayStore({ packageName: 'org.videolan.vlc' });
      } catch (_) {
        window.open('https://play.google.com/store/apps/details?id=org.videolan.vlc', '_blank');
      }
      m.close();
    }
  });
}

export default {
  openFreeCountriesModal,
  showCatalogLoadingModal,
  openExternalListsModal,
  openExitModal,
  showPinModal,
  openManageCategoriesModal,
  openLegalModal,
  openRemoteControlModal,
  showHardwareRecommendationModal,
};

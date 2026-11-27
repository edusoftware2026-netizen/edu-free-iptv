import { store } from '../../core/store.js';
import { XtreamClient, normalizeServer } from '../../core/xtream.js';
import { FREE_COUNTRIES, freeListUrl } from '../../core/m3u.js';
import { navigate } from '../../core/router.js';
import { Focus } from '../../core/focus.js';
import { icon, modal, toast, openFreeCountriesModal } from '../dom.js';
import { openExternalListsModal, showCatalogLoadingModal, openLegalModal, openRemoteControlModal, openSpeedTestModal } from '../modals.js';
import { escapeAttr, escapeHtml, uid } from '../../core/util.js';

export function parseXtreamLink(input) {
  if (!input || typeof input !== 'string') return null;
  const str = input.trim();

  try {
    const testUrl = /^https?:\/\//i.test(str) ? str : `http://${str}`;
    const parsed = new URL(testUrl);

    // 1. Query parameters (get.php?username=XXX&password=YYY, player_api.php?...)
    const params = parsed.searchParams;
    const user = params.get('username') || params.get('user') || params.get('u');
    const pass = params.get('password') || params.get('pass') || params.get('p');
    if (user && pass) {
      return {
        server: `${parsed.protocol}//${parsed.host}`,
        username: decodeURIComponent(user).trim(),
        password: decodeURIComponent(pass).trim(),
      };
    }

    // 2. Embedded credentials (http://user:pass@host:port/)
    if (parsed.username && parsed.password) {
      return {
        server: `${parsed.protocol}//${parsed.host}`,
        username: decodeURIComponent(parsed.username).trim(),
        password: decodeURIComponent(parsed.password).trim(),
      };
    }

    // 3. Path segments (/live/user/pass/id, /movie/user/pass/id, /series/user/pass/id)
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 3 && ['live', 'movie', 'series'].includes(pathParts[0].toLowerCase())) {
      return {
        server: `${parsed.protocol}//${parsed.host}`,
        username: decodeURIComponent(pathParts[1]).trim(),
        password: decodeURIComponent(pathParts[2]).trim(),
      };
    }
    // Formato /user/pass/id.ts
    if (pathParts.length === 3 && /^[\w-]+\.\w+$/.test(pathParts[2]) && !['get.php', 'player_api.php'].includes(pathParts[0].toLowerCase())) {
      return {
        server: `${parsed.protocol}//${parsed.host}`,
        username: decodeURIComponent(pathParts[0]).trim(),
        password: decodeURIComponent(pathParts[1]).trim(),
      };
    }
  } catch (_) {}

  // 4. Texto multilínea o datos copiados
  const serverMatch = str.match(/(?:server|servidor|host|url)?\s*[:=]?\s*(https?:\/\/[^\s\r\n]+)/i);
  const userMatch = str.match(/(?:user|usuario|username)\s*[:=]?\s*([^\s\r\n]+)/i);
  const passMatch = str.match(/(?:pass|password|contraseña|contrasena|clave)\s*[:=]?\s*([^\s\r\n]+)/i);

  if (serverMatch && userMatch && passMatch) {
    try {
      const u = new URL(serverMatch[1]);
      return {
        server: `${u.protocol}//${u.host}`,
        username: userMatch[1].trim(),
        password: passMatch[1].trim(),
      };
    } catch (_) {}
  }

  return null;
}

function errorBox(root) {
  return root.querySelector('#login-error');
}

function showError(root, message) {
  const box = errorBox(root);
  if (!box) return;
  box.textContent = message;
  box.classList.add('is-visible');
}

function clearError(root) {
  const box = errorBox(root);
  if (!box) return;
  box.textContent = '';
  box.classList.remove('is-visible');
}

function setBusy(root, busy, label = 'Conectando...') {
  const btn = root.querySelector('#login-submit');
  if (!btn) return;
  btn.disabled = busy;
  btn.innerHTML = busy ? `<span class="spinner"></span> ${escapeHtml(label)}` : `${icon('play', 'icon icon--sm')} Conectar`;
}

function serverLabel(profile) {
  try {
    return new URL(normalizeServer(profile.server)).host;
  } catch (_) {
    return profile.name || 'Xtream';
  }
}

async function connectM3U(root, profile) {
  clearError(root);
  setBusy(root, true, 'Preparando listas...');
  try {
    const isFree = profile.isFree || profile.id?.startsWith('free-') || (Array.isArray(profile.urls) && profile.urls.length > 1);
    if (!isFree) {
      store.addExternalProfile(profile, null);
    } else {
      store.set({ profile, freeProfile: profile, account: null });
    }
    store.saveNow();
    await showCatalogLoadingModal(profile, {
      title: isFree ? 'Cargando Canales Free' : 'Cargando Lista M3U Externa',
      onComplete: () => navigate('/live'),
    });
  } catch (err) {
    showError(root, err?.message || 'No se pudo cargar la lista');
    setBusy(root, false);
  }
}

async function connectXtream(root, form) {
  clearError(root);
  const server = form.querySelector('#login-server').value.trim();
  const username = form.querySelector('#login-username').value.trim();
  const password = form.querySelector('#login-password').value;

  if (!server || !username || !password) {
    showError(root, 'Completa servidor, usuario y contrasena.');
    return;
  }

  setBusy(root, true);
  try {
    const normalized = normalizeServer(server);
    const profile = {
      id: uid(),
      type: 'xtream',
      name: serverLabel({ server: normalized }),
      server: normalized,
      username,
      password,
    };
    const client = new XtreamClient(profile);
    const account = await client.account();
    if (!account.auth) {
      throw new Error('Usuario o contrasena incorrectos. Revisa los datos del panel.');
    }
    store.addExternalProfile(profile, account);
    store.saveNow();
    await showCatalogLoadingModal(profile, {
      title: 'Cargando Servidor Xtream',
      onComplete: () => navigate('/live'),
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/HTTP 401|HTTP 403/i.test(msg)) {
      showError(root, 'El servidor rechazo la conexion (401/403). Verifica el puerto y las credenciales.');
    } else if (/HTTP 404/i.test(msg)) {
      showError(root, 'No se encontro player_api.php. Revisa la URL del servidor.');
    } else if (/tiempo de espera|timeout|Network|Failed to fetch/i.test(msg)) {
      showError(root, 'No se pudo conectar con el servidor. Revisa la red o la URL.');
    } else {
      showError(root, msg);
    }
    setBusy(root, false);
  }
}

function connectM3UUrl(root, form) {
  clearError(root);
  const url = form.querySelector('#login-m3u-url').value.trim();
  const name = form.querySelector('#login-m3u-name').value.trim() || 'Mi lista M3U';
  if (!url) {
    showError(root, 'Ingresa la URL de la lista M3U.');
    return;
  }

  // Si la URL contiene credenciales Xtream Codes, auto-conectamos con Xtream para habilitar Películas y Series
  const xtreamCreds = parseXtreamLink(url);
  if (xtreamCreds) {
    const sInput = form.querySelector('#login-server');
    const uInput = form.querySelector('#login-username');
    const pInput = form.querySelector('#login-password');
    if (sInput) sInput.value = xtreamCreds.server;
    if (uInput) uInput.value = xtreamCreds.username;
    if (pInput) pInput.value = xtreamCreds.password;
    toast('Enlace Xtream detectado: Conectando con VOD completo...', 'info', 2000);
    connectXtream(root, form);
    return;
  }

  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('Protocolo no valido');
  } catch (_) {
    showError(root, 'La URL no es valida. Debe comenzar con http:// o https://');
    return;
  }
  connectM3U(root, { id: uid(), type: 'm3u', name, url });
}

export default {
  async mount(root) {
    root.innerHTML = `
      <section class="screen">
        <div class="login">
          <div class="login__brand">
            <div class="login__logo">
              <div class="brand__mark" style="width:56px;height:56px;border-radius:16px">${icon('tv', 'icon icon--lg')}</div>
              <h1>EDU-IPTV <span>PRO</span></h1>
            </div>
            <div class="login__tagline">Todo tu contenido,<br><em>sin limites.</em></div>
            <div class="login__points">
              <div class="login__point"><i>${icon('live', 'icon icon--sm')}</i> Canales en vivo con EPG ahora y despues</div>
              <div class="login__point"><i>${icon('movie', 'icon icon--sm')}</i> Peliculas y series con continuar viendo</div>
              <div class="login__point"><i>${icon('shield', 'icon icon--sm')}</i> Reproductor nativo ExoPlayer y cache local</div>
            </div>
          </div>

          <div class="login__panel">
            <div class="login__card">
              <div class="login__card-header">
                <h2>Conecta tu cuenta</h2>
                <p>Usa un panel Xtream Codes o una lista M3U.</p>
              </div>

              ${store.state.externalProfiles?.length ? `
                <div style="margin-bottom:12px">
                  <button type="button" class="btn btn--sm btn--secondary" id="login-open-saved-lists" data-focusable style="width:100%;height:38px;gap:8px;font-size:0.82rem">
                    ${icon('link', 'icon icon--sm')} Mis listas guardadas (${store.state.externalProfiles.length})
                  </button>
                </div>
              ` : ''}

              <div class="login__tabs" role="tablist">
                <button class="login__tab is-active" data-focusable data-tab="m3u" role="tab">URL (Lista M3U)</button>
                <button class="login__tab" data-focusable data-tab="xtream" role="tab">Xtream Codes</button>
              </div>

              <div class="login__error" id="login-error"></div>

              <form class="login__form" id="login-form" autocomplete="off">
                <div id="pane-m3u">
                  <div class="field" style="margin-bottom:8px">
                    <div class="field__label-row">
                      <label for="login-m3u-url">URL de la lista</label>
                      <button type="button" class="login__paste-btn" id="login-paste-btn" data-focusable title="Pegar del portapapeles">
                        📋 Pegar
                      </button>
                    </div>
                    <input class="input" id="login-m3u-url" data-focusable type="text" inputmode="url" autocomplete="off" autocorrect="off" autocapitalize="none" placeholder="http://ejemplo.com/lista.m3u" spellcheck="false">
                  </div>
                  <div class="field" style="margin-bottom:6px">
                    <label for="login-m3u-name" class="label--compact">Nombre (opcional)</label>
                    <input class="input input--compact" id="login-m3u-name" data-focusable type="text" placeholder="Mi lista">
                  </div>
                </div>

                <div id="pane-xtream" class="hidden">
                  <div class="field" style="margin-bottom:8px">
                    <div class="field__label-row">
                      <label for="login-server">Servidor</label>
                      <button type="button" class="login__paste-btn" id="login-paste-server-btn" data-focusable title="Pegar del portapapeles">
                        📋 Pegar
                      </button>
                    </div>
                    <input class="input" id="login-server" data-focusable type="text" inputmode="url" autocomplete="off" autocorrect="off" autocapitalize="none" placeholder="http://servidor.com:8080" spellcheck="false">
                  </div>
                  <div class="login__xtream-row">
                    <div class="field">
                      <label for="login-username">Usuario</label>
                      <input class="input input--compact" id="login-username" data-focusable type="text" placeholder="usuario" spellcheck="false">
                    </div>
                    <div class="field">
                      <label for="login-password">Contraseña</label>
                      <input class="input input--compact" id="login-password" data-focusable type="password" placeholder="contraseña">
                    </div>
                  </div>
                </div>

                <button class="btn btn--primary login__submit-btn" id="login-submit" data-focusable type="submit">
                  ${icon('play', 'icon icon--sm')} Conectar
                </button>
              </form>

              <div class="login__foot">
                <span>v.1.0.0 · EDU-IPTV PRO</span>
                <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                  <button type="button" id="login-remote" data-focusable>📱 Desde el móvil</button>
                  <button type="button" id="login-speed" data-focusable>⚡ Test red</button>
                  <button type="button" id="login-legal" data-focusable>Términos y Privacidad</button>
                  <button type="button" id="free-lists" data-focusable>Usar listas gratis</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>`;

    const form = root.querySelector('#login-form');
    let mode = 'm3u';

    const setTab = (targetMode) => {
      mode = targetMode;
      root.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === mode));
      root.querySelector('#pane-xtream')?.classList.toggle('hidden', mode !== 'xtream');
      root.querySelector('#pane-m3u')?.classList.toggle('hidden', mode !== 'm3u');
      clearError(root);
    };

    const tryAutoFillXtream = (text) => {
      const creds = parseXtreamLink(text);
      if (!creds) return false;
      const sInput = root.querySelector('#login-server');
      const uInput = root.querySelector('#login-username');
      const pInput = root.querySelector('#login-password');
      if (sInput) sInput.value = creds.server;
      if (uInput) uInput.value = creds.username;
      if (pInput) pInput.value = creds.password;
      setTab('xtream');
      toast('¡Enlace detectado! Datos de Xtream Codes completados (VOD listo)', 'ok', 3500);
      const submitBtn = root.querySelector('#login-submit');
      if (submitBtn) Focus.focus(submitBtn, { scroll: false });
      return true;
    };

    const getClipboard = async () => {
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

    root.querySelector('#login-paste-btn')?.addEventListener('click', async () => {
      const inp = root.querySelector('#login-m3u-url');
      if (!inp) return;
      try {
        const text = await getClipboard();
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

    root.querySelector('#login-paste-server-btn')?.addEventListener('click', async () => {
      const inp = root.querySelector('#login-server');
      if (!inp) return;
      try {
        const text = await getClipboard();
        if (text && text.trim()) {
          const raw = text.trim();
          if (!tryAutoFillXtream(raw)) {
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

    root.querySelector('#login-open-saved-lists')?.addEventListener('click', () => {
      openExternalListsModal();
    });

    root.querySelector('#login-server')?.addEventListener('input', (event) => {
      const val = event.target.value;
      if (val.includes('?') || val.includes('/live/') || val.includes('/movie/')) {
        tryAutoFillXtream(val);
      }
    });

    root.querySelectorAll('[data-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        mode = tab.dataset.tab;
        root.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('is-active', t === tab));
        root.querySelector('#pane-xtream').classList.toggle('hidden', mode !== 'xtream');
        root.querySelector('#pane-m3u').classList.toggle('hidden', mode !== 'm3u');
        clearError(root);
        const first = mode === 'xtream' ? '#login-server' : '#login-m3u-url';
        const input = root.querySelector(first);
        if (input) Focus.focus(input, { scroll: false });
      });
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (mode === 'xtream') connectXtream(root, form);
      else connectM3UUrl(root, form);
    });

    root.querySelector('#login-remote')?.addEventListener('click', () => openRemoteControlModal());
    root.querySelector('#login-speed')?.addEventListener('click', () => openSpeedTestModal());
    root.querySelector('#login-legal')?.addEventListener('click', () => openLegalModal('terms'));
    root.querySelector('#free-lists')?.addEventListener('click', () => openFreeCountriesModal());

    setTab('m3u');
    Focus.attach(root, { initial: '#login-m3u-url' });
  },

  unmount() {},
};

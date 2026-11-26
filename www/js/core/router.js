/* Router minimo basado en hash.
   Cada pantalla: { mount(root, params), unmount?(), onBack?(): boolean }
*/

import { parseHash } from './util.js';
import { Focus } from './focus.js';
import { Player } from '../player/player.js';

const routes = new Map();
let current = null;
let currentPath = '';
let navToken = 0;
let lastBackAt = 0;

export function register(path, screen) {
  routes.set(path, screen);
}

function setHash(path, params, replace) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== '') query.set(k, String(v));
  }
  const qs = query.toString();
  const hash = `#${path}${qs ? '?' + qs : ''}`;
  if (location.hash === hash) return false;
  if (replace) {
    history.replaceState(null, '', hash);
    return true;
  }
  location.hash = hash;
  return true;
}

export function navigate(path, params = {}, { replace = false } = {}) {
  const changed = setHash(path, params, replace);
  // replaceState no dispara hashchange: hay que renderizar a mano.
  if (replace || !changed) render();
}

export function replace(path, params = {}) {
  navigate(path, params, { replace: true });
}

export async function render() {
  const token = ++navToken;
  const { path, params } = parseHash();
  const screen = routes.get(path) || routes.get('/home');
  if (!screen) return;

  // Detener de inmediato cualquier reproducción activa al cambiar de pantalla
  try {
    Player?.stop?.({ silent: true });
  } catch (_) {}

  try { current?.unmount?.(); } catch (err) { console.warn('unmount', err); }
  Focus.detach();
  current = null;
  currentPath = path;

  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = '';

  try {
    current = screen;
    await screen.mount(root, params, token);
    if (token !== navToken) return;
    root.dataset.route = path;
  } catch (err) {
    console.error('Router render', err);
    root.innerHTML = `
      <section class="screen">
        <div class="page page--center">
          <div class="empty">
            <div class="empty__icon">!</div>
            <h3>No se pudo abrir la pantalla</h3>
            <p>${String(err?.message || err)}</p>
            <button class="btn btn--primary" data-focusable onclick="location.hash='#/home'">Volver al inicio</button>
          </div>
        </div>
      </section>`;
    Focus.attach(root);
  }
}

export function back() {
  if (document.querySelector('.modal-root.is-open')) {
    window.dispatchEvent(new CustomEvent('modal:close'));
    return;
  }
  try {
    if (current?.onBack?.()) return;
  } catch (err) {
    console.warn('onBack', err);
  }

  const { path } = parseHash();
  if (path !== '/home' && path !== '/login') {
    navigate('/home');
    return;
  }

  const now = Date.now();
  if (now - lastBackAt < 2200) {
    try { window.AndroidNativeApp?.exitApp?.(); } catch (_) { history.back(); }
    return;
  }
  lastBackAt = now;
  window.dispatchEvent(new CustomEvent('toast', {
    detail: { message: 'Presiona atras otra vez para salir', type: 'info' },
  }));
}

export function sair() {
  if (document.querySelector('.modal-root.is-open')) {
    window.dispatchEvent(new CustomEvent('modal:close'));
    return;
  }
  try {
    if (current?.onBack?.()) return;
  } catch (err) {
    console.warn('onBack', err);
  }
  try {
    if (window.Player && typeof window.Player.stop === 'function') {
      window.Player.stop({ silent: true });
    }
  } catch (_) {}
  // Go to login and show logout confirm, or just navigate to login
  navigate('/login', {}, { replace: true });
}

export function currentRoute() {
  return { path: currentPath, screen: current };
}

export function start() {
  window.addEventListener('hashchange', render);
  window.addEventListener('ui:sair', sair);
  if (!location.hash) history.replaceState(null, '', '#/home');
  render();
  return { render, back, navigate, replace, sair };
}

export default { register, navigate, replace, render, back, start, currentRoute };

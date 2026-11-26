/* Utilidades generales. Sin dependencias. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function uid() {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

export function hashCode(str) {
  let h = 0;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export function safeJson(text, fallback = null) {
  if (text == null) return fallback;
  if (typeof text === 'object') return text;
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

export function b64decode(value) {
  if (!value || typeof value !== 'string') return '';
  const s = value.trim();
  if (!/^[A-Za-z0-9+/=\s]+$/.test(s) || s.length < 4) return value;
  try {
    const bin = atob(s.replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch (_) {
    return value;
  }
}

export function fmtTime(timestampSeconds) {
  const n = Number(timestampSeconds);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(value) {
  if (value == null || value === '' || value === 'null') return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return String(value);
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateShort(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDuration(seconds) {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${n}s`;
}

export function fmtClock(seconds) {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function debounce(fn, wait = 250) {
  let timer = 0;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return wrapped;
}

export function throttle(fn, wait = 100) {
  let last = 0;
  let timer = 0;
  let pendingArgs = null;
  return (...args) => {
    const now = performance.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      clearTimeout(timer);
      timer = 0;
      last = now;
      fn(...args);
    } else {
      pendingArgs = args;
      if (!timer) {
        timer = setTimeout(() => {
          timer = 0;
          last = performance.now();
          if (pendingArgs) fn(...pendingArgs);
          pendingArgs = null;
        }, remaining);
      }
    }
  };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function loadScript(src, globalName) {
  if (globalName && globalThis[globalName]) return globalThis[globalName];
  const existing = document.querySelector(`script[data-src="${src}"]`);
  if (existing) {
    if (existing.dataset.loaded === '1') return globalName ? globalThis[globalName] : true;
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(globalName ? globalThis[globalName] : true), { once: true });
      existing.addEventListener('error', reject, { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.src = src;
    s.onload = () => {
      s.dataset.loaded = '1';
      resolve(globalName ? globalThis[globalName] : true);
    };
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
}

export function parseHash() {
  const raw = (location.hash || '').replace(/^#/, '') || '/home';
  const [pathPart, queryPart] = raw.split('?');
  const params = {};
  if (queryPart) {
    for (const [k, v] of new URLSearchParams(queryPart)) params[k] = v;
  }
  return { path: pathPart || '/home', params };
}

export function isTv() {
  if (window.AndroidNativeApp && typeof window.AndroidNativeApp.isTelevision === 'function') {
    try {
      return !!window.AndroidNativeApp.isTelevision();
    } catch (_) {}
  }
  const ua = navigator.userAgent || '';
  return /Android/i.test(ua) && !/Mobile/i.test(ua);
}

export function setNativeOrientation(mode) {
  if (window.AndroidNativeApp && typeof window.AndroidNativeApp.setOrientation === 'function') {
    try {
      window.AndroidNativeApp.setOrientation(mode);
    } catch (_) {}
  }
}

export function canCast() {
  if (window.AndroidNativeApp && typeof window.AndroidNativeApp.canCast === 'function') {
    try { return !!window.AndroidNativeApp.canCast(); } catch (_) {}
  }
  return !isTv();
}

export function isWifiConnected() {
  if (window.AndroidNativeApp && typeof window.AndroidNativeApp.isWifiConnected === 'function') {
    try { return !!window.AndroidNativeApp.isWifiConnected(); } catch (_) {}
  }
  return true;
}

export function openCastSettings() {
  if (window.AndroidNativeApp && typeof window.AndroidNativeApp.openCastSettings === 'function') {
    try { return !!window.AndroidNativeApp.openCastSettings(); } catch (_) {}
  }
  return false;
}

export function text(value) {
  return String(value ?? '').trim();
}

export function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  }
  return '';
}

export function firstNumber(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

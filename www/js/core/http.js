/* HTTP con tres caminos:
   1. CapacitorHttp (nativo, asincrono, sin CORS)  <- preferido
   2. fetch del WebView
   3. bridge sincrono AndroidNativeApp.fetchUrl     <- ultimo recurso
*/

const UA = 'Free-IPTV-Pro/2.0 (Android)';
const DEFAULT_TIMEOUT = 25000;

export function redact(url) {
  return String(url || '').replace(/(username|password|user|pass)=([^&]+)/gi, '$1=***');
}

function normalizeData(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (typeof data === 'object') return JSON.stringify(data);
  return String(data);
}

function withTimeout(promise, ms, message = 'Tiempo de espera agotado') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function headersFor(extra = {}) {
  return {
    'User-Agent': UA,
    Accept: '*/*',
    ...extra,
  };
}

async function viaCapacitor(url, options) {
  const CapacitorHttp = window.Capacitor?.Plugins?.CapacitorHttp;
  if (!CapacitorHttp) throw new Error('CapacitorHttp no disponible');
  const res = await withTimeout(
    CapacitorHttp.get({
      url,
      headers: headersFor(options.headers),
      connectTimeout: options.timeout,
      readTimeout: options.timeout,
      responseType: 'text',
    }),
    options.timeout + 4000,
    'CapacitorHttp: tiempo de espera agotado'
  );
  const body = normalizeData(res?.data);
  if (res && res.status >= 200 && res.status < 400) return body;
  const err = new Error(`HTTP ${res?.status ?? '?'}`);
  err.status = res?.status;
  err.body = body;
  throw err;
}

async function viaFetch(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: headersFor(options.headers),
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
    });
    const body = await res.text();
    if (res.ok) return body;
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function viaNativeSync(url, options) {
  const bridge = window.AndroidNativeApp;
  if (!bridge || typeof bridge.fetchUrl !== 'function') {
    throw new Error('Sin transporte HTTP disponible');
  }
  const result = bridge.fetchUrl(url, UA, options.timeout);
  if (typeof result === 'string' && result.startsWith('ERROR:')) {
    throw new Error(result.replace(/^ERROR:\s*/, ''));
  }
  return result;
}

export async function httpText(url, opts = {}) {
  const options = {
    timeout: opts.timeout || DEFAULT_TIMEOUT,
    headers: opts.headers || {},
  };

  let lastError = null;

  // 1) Nativo asincrono
  try {
    return await viaCapacitor(url, options);
  } catch (err) {
    lastError = err;
    // Un error HTTP real no debe reintentarse por otra via.
    if (err.status) throw err;
  }

  // 2) fetch
  try {
    return await viaFetch(url, options);
  } catch (err) {
    lastError = err;
    if (err.status) throw err;
  }

  // 3) bridge sincrono (ultimo recurso)
  try {
    console.warn('HTTP: usando bridge sincrono para', redact(url));
    return viaNativeSync(url, options);
  } catch (err) {
    lastError = err;
  }

  throw lastError || new Error('No se pudo completar la peticion');
}

export async function httpJson(url, opts = {}) {
  const text = await httpText(url, opts);
  try {
    return JSON.parse(text);
  } catch (err) {
    const preview = String(text || '').slice(0, 160).replace(/\s+/g, ' ');
    throw new Error(`Respuesta no valida (${preview})`);
  }
}

export default { httpText, httpJson, redact };

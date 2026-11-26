/* Carga, cachea e indexa catalogos Xtream / M3U. */

import { DB } from './db.js';
import { store } from './store.js';
import { XtreamClient, mapPool } from './xtream.js';
import { httpText } from './http.js';
import { buildCategories, groupM3USeries, parseM3UAsync } from './m3u.js';
import { normalize } from './util.js';
import { Logger } from './logger.js';
import { navigate } from './router.js';
import { shouldHideItem } from './parental.js';

const TTL = 15 * 60 * 1000; // 15 minutos
const clients = new Map();
const indexes = {
  live: new Map(),
  movies: new Map(),
  series: new Map(),
};
const detailsCache = new Map();
const epgCache = new Map();
const EPG_TTL = 5 * 60 * 1000;
let inflight = null;

export function getClient(profile) {
  if (!profile || profile.type !== 'xtream') return null;
  if (!clients.has(profile.id)) clients.set(profile.id, new XtreamClient(profile));
  return clients.get(profile.id);
}

function withCounts(categories, items, defaultType = 'live') {
  const counts = new Map();
  const names = new Map();
  for (let i = 0; i < (items || []).length; i++) {
    const item = items[i];
    const id = String(item.categoryId || '');
    counts.set(id, (counts.get(id) || 0) + 1);
    if (!names.has(id) && item.group) names.set(id, item.group);
  }
  const knownIds = new Set();
  const result = [];
  for (const c of categories || []) {
    const count = counts.get(String(c.id)) || 0;
    if (count > 0) {
      result.push({ ...c, count });
      knownIds.add(String(c.id));
    }
  }
  // Añade categorias con elementos que no estuvieran en la lista de categorias del servidor
  for (const [id, count] of counts.entries()) {
    if (!knownIds.has(id) && count > 0) {
      const name = names.get(id) || 'Otros';
      result.push({
        id,
        name,
        count,
        type: defaultType,
      });
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function indexCatalog(catalogs) {
  for (const kind of ['live', 'movies', 'series']) {
    indexes[kind].clear();
    for (const item of catalogs[kind] || []) {
      indexes[kind].set(String(item.id), item);
      // Para series, indexar tambien sus episodios para busquedas directas y favoritos
      if (kind === 'series' && item.seasons) {
        for (const s of item.seasons) {
          for (const ep of s.episodes || []) {
            indexes[kind].set(String(ep.id), ep);
          }
        }
      }
    }
  }
}

function applyCatalog({ account, categories, catalogs, updatedAt }) {
  indexCatalog(catalogs);
  store.setCatalogs({ account, categories, catalogs, updatedAt });
}

function emptyCatalog() {
  return {
    catalogs: { live: [], movies: [], series: [] },
    categories: { live: [], movies: [], series: [] },
  };
}

/* ---------- Xtream ---------- */
async function fetchXtream(profile, onProgress) {
  const client = getClient(profile);
  onProgress?.(0.08, 'Conectando con el servidor Xtream...');

  // 1. Verificación de cuenta y autenticación
  let account;
  try {
    account = await client.account();
  } catch (err) {
    throw new Error(err?.message || 'No se pudo conectar con el servidor Xtream');
  }
  if (!account || !account.auth) {
    throw new Error('Usuario o contrasena incorrectos. Verifica los datos del panel.');
  }
  onProgress?.(0.18, `Conectado (${account.status || 'OK'})`);

  // 2. Categorias (se piden en paralelo por ser livianas)
  onProgress?.(0.25, 'Cargando categorías...');
  const [liveCatsRes, vodCatsRes, seriesCatsRes] = await Promise.allSettled([
    client.liveCategories(),
    client.vodCategories(),
    client.seriesCategories(),
  ]);
  const liveCats = liveCatsRes.status === 'fulfilled' ? liveCatsRes.value : [];
  const vodCats = vodCatsRes.status === 'fulfilled' ? vodCatsRes.value : [];
  const seriesCats = seriesCatsRes.status === 'fulfilled' ? seriesCatsRes.value : [];
  onProgress?.(0.38, 'Categorías listas');

  // 3. Canales en vivo
  onProgress?.(0.42, 'Descargando canales en vivo...');
  let live = [];
  try {
    live = await client.liveStreams();
  } catch (err) {
    Logger.warn('Catalog', `liveStreams fallo: ${err?.message || err}`);
  }
  onProgress?.(0.65, `${live.length} canales cargados`);

  // 4. Peliculas (VOD)
  onProgress?.(0.70, 'Descargando películas (VOD)...');
  let movies = [];
  try {
    movies = await client.vodStreams();
  } catch (err) {
    Logger.warn('Catalog', `vodStreams fallo: ${err?.message || err}`);
  }
  onProgress?.(0.85, `${movies.length} películas cargadas`);

  // 5. Series
  onProgress?.(0.88, 'Descargando series...');
  let series = [];
  try {
    series = await client.series();
  } catch (err) {
    Logger.warn('Catalog', `series fallo: ${err?.message || err}`);
  }
  onProgress?.(0.93, `${series.length} series cargadas`);

  if (!live.length && !movies.length && !series.length) {
    throw new Error('No se pudo cargar contenido. Revisa la conexion e intentalo de nuevo.');
  }

  // 6. Indexando contenido
  onProgress?.(0.96, 'Indexando contenido y categorías...');
  const catalogs = { live, movies, series };
  const categories = {
    live: withCounts(liveCats, live, 'live'),
    movies: withCounts(vodCats, movies, 'movie'),
    series: withCounts(seriesCats, series, 'series'),
  };
  onProgress?.(1.0, '¡Catálogo cargado al 100%!');
  return { account, categories, catalogs };
}

/* ---------- M3U ---------- */
async function fetchM3U(profile, onProgress) {
  const urls = Array.isArray(profile.urls) && profile.urls.length
    ? profile.urls
    : [profile.url].filter(Boolean);
  if (!urls.length) throw new Error('No hay ninguna lista M3U configurada');

  const labels = Array.isArray(profile.labels) ? profile.labels : [];
  const multi = urls.length > 1;
  const errors = [];
  let completed = 0;

  onProgress?.(0.06, multi ? `Conectando con ${urls.length} listas...` : 'Conectando con el servidor M3U...');

  const chunks = await mapPool(urls, 3, async (url, index) => {
    const label = labels[index] || (multi ? `Lista ${index + 1}` : 'Lista M3U');
    let dlTimer = null;
    let parseTimer = null;
    try {
      let dlProgress = 0.08 + (index / urls.length) * 0.45;
      onProgress?.(dlProgress, `Descargando ${label}...`);
      dlTimer = setInterval(() => {
        if (dlProgress < 0.58) {
          dlProgress += 0.03;
          onProgress?.(dlProgress, `Descargando ${label} (${Math.round(dlProgress * 100)}%)...`);
        }
      }, 350);

      let text = null;
      try {
        text = await httpText(url, { timeout: 45000 });
      } catch (dlErr) {
        // Fallback al repositorio de GitHub si falla la URL directa
        const m = url.match(/\/countries\/([a-z]{2})\.m3u/i);
        if (m) {
          const code = m[1].toLowerCase();
          const ghFallbacks = [
            `https://raw.githubusercontent.com/iptv-org/iptv/gh-pages/countries/${code}.m3u`,
            `https://raw.githubusercontent.com/iptv-org/iptv/master/streams/${code}.m3u`,
          ];
          for (const fbUrl of ghFallbacks) {
            try {
              onProgress?.(dlProgress, `Buscando en repositorio GitHub (${label})...`);
              text = await httpText(fbUrl, { timeout: 35000 });
              if (text && text.includes('#EXT')) break;
            } catch (_) {}
          }
        }
        if (!text) throw dlErr;
      }
      clearInterval(dlTimer);
      dlTimer = null;

      if (!text || text.length < 40 || !text.includes('#EXT')) {
        throw new Error('La lista no contiene canales validos');
      }

      const sizeMb = (text.length / (1024 * 1024)).toFixed(1);
      let pProgress = 0.62;
      onProgress?.(pProgress, `Analizando ${label} (${sizeMb} MB)...`);

      parseTimer = setInterval(() => {
        if (pProgress < 0.82) {
          pProgress += 0.02;
          onProgress?.(pProgress, `Procesando contenido (${Math.round(pProgress * 100)}%)...`);
        }
      }, 300);

      const parsed = await parseM3UAsync(text, { baseUrl: url });
      clearInterval(parseTimer);
      parseTimer = null;

      if (!parsed.length && !parsed.live?.length && !parsed.movies?.length && !parsed.series?.length) {
        throw new Error('La lista esta vacia');
      }
      const isFree = profile.isFree || profile.id?.startsWith('free-') || urls.length > 1;
      if (label && (isFree || multi)) {
        const setCountryGroup = (items) => {
          for (const it of items || []) {
            it.country = label;
            it.group = label; // Agrupado DIRECTAMENTE por país
            it.categoryId = 'c:' + label;
          }
        };
        setCountryGroup(parsed.live);
        setCountryGroup(parsed.movies);
        setCountryGroup(parsed.seriesRaw || parsed.series);
      } else if (multi && label) {
        const prefixGroup = (items) => {
          for (const it of items || []) {
            it.group = `${label} - ${it.group || 'General'}`;
            it.categoryId = 'g:' + it.group;
          }
        };
        prefixGroup(parsed.live);
        prefixGroup(parsed.movies);
        prefixGroup(parsed.seriesRaw || parsed.series);
      }
      return parsed;
    } catch (err) {
      if (dlTimer) clearInterval(dlTimer);
      if (parseTimer) clearInterval(parseTimer);
      errors.push(err);
      Logger.warn('M3U', `${label || url}: ${err.message}`);
      return null;
    } finally {
      if (dlTimer) clearInterval(dlTimer);
      if (parseTimer) clearInterval(parseTimer);
      completed++;
      onProgress?.(0.82 + (completed / urls.length) * 0.04, `Listo ${label}`);
    }
  });

  const validChunks = chunks.filter(Boolean);
  if (!validChunks.length) throw errors[0] || new Error('No se pudo cargar ninguna lista M3U');

  onProgress?.(0.86, 'Organizando contenido (Live, VOD, Series)...');

  const live = [];
  const movies = [];
  const seriesRaw = [];

  for (const chunk of validChunks) {
    if (chunk && Array.isArray(chunk.live)) {
      for (let i = 0; i < chunk.live.length; i++) live.push(chunk.live[i]);
      if (Array.isArray(chunk.movies)) {
        for (let i = 0; i < chunk.movies.length; i++) movies.push(chunk.movies[i]);
      }
      const sArr = chunk.seriesRaw || chunk.series || [];
      for (let i = 0; i < sArr.length; i++) seriesRaw.push(sArr[i]);
    } else if (Array.isArray(chunk)) {
      for (let i = 0; i < chunk.length; i++) {
        const item = chunk[i];
        if (item.streamType === 'movie') movies.push(item);
        else if (item.streamType === 'series' || item.streamType === 'episode') seriesRaw.push(item);
        else live.push(item);
      }
    }
  }

  // Agrupacion quirurgica de series (homologada a Xtream)
  onProgress?.(0.90, 'Estructurando temporadas y series...');
  const series = groupM3USeries(seriesRaw);

  onProgress?.(0.94, 'Generando categorías...');
  const liveCats = buildCategories(live, 'live');
  const movieCats = buildCategories(movies, 'movie');
  const seriesCats = buildCategories(series, 'series');

  onProgress?.(0.98, 'Guardando en caché local...');

  return {
    account: {
      auth: true,
      status: 'Free',
      username: profile.name || 'Free',
      expDate: null,
      maxConnections: 0,
      activeConnections: 0,
      formats: ['m3u8', 'ts', 'mp4', 'mkv'],
    },
    categories: {
      live: withCounts(liveCats, live, 'live'),
      movies: withCounts(movieCats, movies, 'movie'),
      series: withCounts(seriesCats, series, 'series'),
    },
    catalogs: {
      live,
      movies,
      series,
    },
  };
}

/* ---------- API publica ---------- */
export async function loadCatalog(profile, { force = false, onProgress = null } = {}) {
  if (!profile) throw new Error('No hay perfil activo');
  if (inflight) return inflight;

  const cachedRow = await DB.getCatalog(profile.id, 'all');
  const cached = cachedRow?.data || null;
  const fresh = cached && Date.now() - (cached.updatedAt || 0) < TTL;

  if (cached && !force) {
    applyCatalog(cached);
    if (fresh) {
      onProgress?.(1.0, 'Listo (100%)');
      return cached;
    }
  }

  inflight = (async () => {
    try {
      store.setLoading('catalog', true);
      onProgress?.(0.05, 'Iniciando...');
      const result = profile.type === 'm3u'
        ? await fetchM3U(profile, onProgress)
        : await fetchXtream(profile, onProgress);
      const payload = { ...result, updatedAt: Date.now() };
      applyCatalog(payload);
      await DB.putCatalog(profile.id, 'all', payload);
      onProgress?.(1.0, '¡Catálogo listo al 100%!');
      return payload;
    } finally {
      inflight = null;
      store.setLoading('catalog', false);
    }
  })();

  return inflight;
}

export async function refreshCatalog(profile, options = {}) {
  return loadCatalog(profile, { ...options, force: true });
}

export async function switchToProfile(profile, modo = 'free') {
  if (!profile) return;
  store.set({ profile, settings: { ...store.state.settings, modo } });
  store.saveNow();
  try {
    await loadCatalog(profile);
    const hash = (location.hash || '').toLowerCase();
    if (hash.includes('live')) navigate('/live');
    else if (hash.includes('movie')) navigate('/movies');
    else if (hash.includes('series')) navigate('/series');
    else navigate('/home');
  } catch (err) {
    Logger.error('Catalog', `switchToProfile error: ${err?.message || err}`);
    throw err;
  }
}

export function getCatalogCounts() {
  const c = store.state.catalogs;
  return {
    live: c.live?.length || 0,
    movies: c.movies?.length || 0,
    series: c.series?.length || 0,
  };
}

export function findItem(type, id) {
  const key = String(id);
  const map = type === 'movie' ? indexes.movies : type === 'series' ? indexes.series : indexes.live;
  return map.get(key) || null;
}

export function search(query, limit = 40) {
  const q = normalize(query);
  if (q.length < 2) return { live: [], movies: [], series: [] };
  const result = { live: [], movies: [], series: [] };
  const scan = (list, bucket) => {
    for (const item of list || []) {
      if (result[bucket].length >= limit) return;
      if (shouldHideItem(item)) continue;
      if (normalize(item.name).includes(q)) result[bucket].push(item);
    }
  };
  scan(store.state.catalogs.live, 'live');
  scan(store.state.catalogs.movies, 'movies');
  scan(store.state.catalogs.series, 'series');
  return result;
}

export async function getDetails(profile, item) {
  if (!profile || !item) return { item };
  const key = `${profile.id}:${item.streamType}:${item.id}`;
  const hit = detailsCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const client = getClient(profile);
  let value;
  if (profile.type === 'xtream' && client) {
    if (item.streamType === 'movie') {
      const info = await client.vodInfo(item.id);
      value = { item, info };
    } else if (item.streamType === 'series') {
      const info = await client.seriesInfo(item.id);
      value = { item, series: info };
    } else {
      value = { item };
    }
  } else {
    // M3U
    if (item.streamType === 'series') {
      value = {
        item,
        series: {
          info: {
            name: item.name,
            cover: item.icon,
            backdrop: item.backdrop || item.icon,
            plot: item.plot || '',
            rating: item.rating || '',
            releaseDate: item.year || '',
            genre: item.group || '',
          },
          seasons: item.seasons || [],
        },
      };
    } else {
      // movie or live
      value = {
        item,
        info: {
          name: item.name,
          poster: item.icon,
          backdrop: item.backdrop || item.icon,
          year: item.year || '',
          containerExtension: item.containerExtension || 'mp4',
          duration: item.duration || '',
          plot: item.plot || '',
          rating: item.rating || '',
        },
      };
    }
  }
  detailsCache.set(key, { at: Date.now(), value });
  return value;
}

export async function getEpg(profile, streamId) {
  if (!profile || profile.type !== 'xtream' || !streamId) return [];
  const key = `${profile.id}:${streamId}`;
  const hit = epgCache.get(key);
  if (hit && Date.now() - hit.at < EPG_TTL) return hit.value;
  try {
    const client = getClient(profile);
    const value = await client.shortEpg(streamId, 2);
    epgCache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    epgCache.set(key, { at: Date.now(), value: [] });
    return [];
  }
}

export function streamUrl(profile, item, options) {
  if (item?.url) return item.url;
  const client = getClient(profile);
  if (!client) return item?.url || '';
  return client.streamUrl(item, options);
}

export async function clearCatalog(profileId) {
  indexes.live.clear();
  indexes.movies.clear();
  indexes.series.clear();
  detailsCache.clear();
  epgCache.clear();
  if (profileId) await DB.deleteProfile(profileId);
  else await DB.clearAll();
}

export function clearRuntimeCaches() {
  detailsCache.clear();
  epgCache.clear();
}

export default {
  loadCatalog,
  refreshCatalog,
  getCatalogCounts,
  findItem,
  search,
  getDetails,
  getEpg,
  streamUrl,
  clearCatalog,
  clearRuntimeCaches,
};

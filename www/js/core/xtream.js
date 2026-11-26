/* Cliente Xtream Codes.
   Normaliza todas las respuestas a un modelo unico:
   { id, name, icon, categoryId, streamType, ... }
*/

import { httpJson } from './http.js';
import { b64decode, firstNumber, pick } from './util.js';

export function normalizeServer(server) {
  let s = String(server || '').trim().replace(/\/+$/, '');
  if (!s) throw new Error('Ingresa el servidor');
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  try {
    // Valida el formato sin descartar rutas.
    new URL(s);
  } catch (_) {
    throw new Error('Servidor no valido');
  }
  return s;
}

function fixUrl(icon, server) {
  let value = String(icon || '').trim();
  if (!value || value === 'null' || value === 'undefined' || value === 'http://null' || value === 'https://null') return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return 'http:' + value;
  if (server) {
    const s = String(server).replace(/\/+$/, '');
    if (value.startsWith('/')) return s + value;
    return s + '/' + value;
  }
  return value;
}

export function normalizeAccount(raw) {
  const user = raw?.user_info || {};
  const srv = raw?.server_info || {};
  return {
    auth: Number(user.auth) === 1,
    status: user.status || 'Unknown',
    username: user.username || '',
    expDate: user.exp_date || null,
    isTrial: String(user.is_trial || '0') === '1',
    activeConnections: Number(user.active_cons || 0),
    maxConnections: Number(user.max_connections || 0),
    createdAt: user.created_at || null,
    formats: Array.isArray(user.allowed_output_formats) ? user.allowed_output_formats : [],
    serverUrl: srv.url || '',
    serverPort: srv.port || '',
    serverProtocol: srv.server_protocol || '',
    timezone: srv.timezone || '',
    timestampNow: Number(srv.timestamp_now || 0),
  };
}

export function normalizeCategory(raw, type) {
  return {
    id: String(pick(raw, 'category_id', 'id')),
    name: String(pick(raw, 'category_name', 'name') || 'Sin categoria'),
    parentId: String(pick(raw, 'parent_id') || ''),
    type,
  };
}

export function normalizeLive(raw, server) {
  return {
    id: String(pick(raw, 'stream_id', 'id')),
    name: String(pick(raw, 'name') || 'Canal'),
    icon: fixUrl(pick(raw, 'stream_icon', 'icon', 'logo', 'tvg_logo', 'channel_icon'), server),
    categoryId: String(pick(raw, 'category_id') || ''),
    epgChannelId: String(pick(raw, 'epg_channel_id') || ''),
    num: String(pick(raw, 'num') || ''),
    tvArchive: String(pick(raw, 'tv_archive') || '0') === '1',
    tvArchiveDuration: Number(pick(raw, 'tv_archive_duration') || 0),
    streamType: 'live',
  };
}

export function normalizeMovie(raw, server) {
  return {
    id: String(pick(raw, 'stream_id', 'id')),
    name: String(pick(raw, 'name') || 'Pelicula'),
    icon: fixUrl(pick(raw, 'stream_icon', 'cover', 'movie_image', 'poster', 'icon'), server),
    categoryId: String(pick(raw, 'category_id') || ''),
    rating: String(pick(raw, 'rating', 'rating_5based') || ''),
    year: String(pick(raw, 'year', 'releaseDate') || '').slice(0, 4),
    containerExtension: String(pick(raw, 'container_extension') || 'mp4'),
    streamType: 'movie',
  };
}

export function normalizeSeries(raw, server) {
  return {
    id: String(pick(raw, 'series_id', 'id')),
    name: String(pick(raw, 'name') || 'Serie'),
    icon: fixUrl(pick(raw, 'cover', 'stream_icon', 'movie_image', 'poster', 'banner', 'icon'), server),
    categoryId: String(pick(raw, 'category_id') || ''),
    rating: String(pick(raw, 'rating', 'rating_5based') || ''),
    year: String(pick(raw, 'year', 'releaseDate') || '').slice(0, 4),
    plot: String(pick(raw, 'plot') || ''),
    cast: String(pick(raw, 'cast') || ''),
    director: String(pick(raw, 'director') || ''),
    genre: String(pick(raw, 'genre') || ''),
    backdrop: fixUrl(pick(raw, 'backdrop_path', 'cover_big') || '', server),
    streamType: 'series',
  };
}

export function normalizeEpisode(raw, seriesId, season, server) {
  const info = raw?.info || {};
  const num = firstNumber(pick(raw, 'episode_num', 'episode_number'), 0);
  return {
    id: String(pick(raw, 'id', 'stream_id')),
    name: String(pick(raw, 'title', 'name') || `Episodio ${num || ''}`).trim(),
    icon: fixUrl(pick(info, 'movie_image', 'cover', 'stream_icon') || pick(raw, 'movie_image', 'cover', 'stream_icon') || '', server),
    plot: String(pick(info, 'plot', 'overview') || ''),
    duration: String(pick(info, 'duration') || ''),
    rating: String(pick(info, 'rating') || ''),
    seriesId: String(seriesId),
    season: Number(season) || 0,
    episodeNum: num,
    containerExtension: String(pick(raw, 'container_extension') || 'mp4'),
    streamType: 'episode',
  };
}

export function normalizeEpg(raw) {
  const start = Number(pick(raw, 'start_timestamp', 'start'));
  const end = Number(pick(raw, 'stop_timestamp', 'end'));
  return {
    id: String(pick(raw, 'id') || ''),
    title: b64decode(String(pick(raw, 'title') || '')),
    description: b64decode(String(pick(raw, 'description') || '')),
    start: Number.isFinite(start) ? start : 0,
    end: Number.isFinite(end) ? end : 0,
    nowPlaying: Number(pick(raw, 'now_playing') || 0) === 1,
  };
}

export function mapPool(items, limit, fn) {
  return new Promise((resolve) => {
    const list = Array.from(items || []);
    const results = new Array(list.length);
    let next = 0;
    let active = 0;
    let done = 0;
    if (!list.length) return resolve(results);

    const launch = () => {
      while (active < limit && next < list.length) {
        const index = next++;
        active++;
        Promise.resolve()
          .then(() => fn(list[index], index))
          .then((value) => { results[index] = value; })
          .catch(() => { results[index] = null; })
          .finally(() => {
            active--;
            done++;
            if (done === list.length) resolve(results);
            else launch();
          });
      }
    };
    launch();
  });
}

export class XtreamClient {
  constructor(profile) {
    this.profile = profile || {};
    this.server = normalizeServer(this.profile.server);
    this.username = String(this.profile.username || '');
    this.password = String(this.profile.password || '');
    this.accountInfo = null;
  }

  get baseUrl() {
    return `${this.server}/player_api.php?username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
  }

  apiUrl(action, params = {}) {
    const url = new URL(this.baseUrl);
    if (action) url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  async api(action, params) {
    return httpJson(this.apiUrl(action, params));
  }

  async account() {
    const raw = await httpJson(this.baseUrl);
    this.accountInfo = normalizeAccount(raw);
    return this.accountInfo;
  }

  async liveCategories() {
    const raw = await this.api('get_live_categories');
    return (Array.isArray(raw) ? raw : []).map((c) => normalizeCategory(c, 'live'));
  }

  async liveStreams(categoryId = '') {
    const raw = await this.api('get_live_streams', categoryId ? { category_id: categoryId } : {});
    return (Array.isArray(raw) ? raw : []).map((s) => normalizeLive(s, this.server));
  }

  async vodCategories() {
    const raw = await this.api('get_vod_categories');
    return (Array.isArray(raw) ? raw : []).map((c) => normalizeCategory(c, 'movie'));
  }

  async vodStreams(categoryId = '') {
    const raw = await this.api('get_vod_streams', categoryId ? { category_id: categoryId } : {});
    return (Array.isArray(raw) ? raw : []).map((s) => normalizeMovie(s, this.server));
  }

  async seriesCategories() {
    const raw = await this.api('get_series_categories');
    return (Array.isArray(raw) ? raw : []).map((c) => normalizeCategory(c, 'series'));
  }

  async series(categoryId = '') {
    const raw = await this.api('get_series', categoryId ? { category_id: categoryId } : {});
    return (Array.isArray(raw) ? raw : []).map((s) => normalizeSeries(s, this.server));
  }

  async vodInfo(vodId) {
    const raw = await this.api('get_vod_info', { vod_id: vodId });
    const info = raw?.info || {};
    const movie = raw?.movie_data || {};
    return {
      ...info,
      plot: info.plot || info.description || '',
      cast: info.cast || info.actors || '',
      director: info.director || '',
      genre: info.genre || '',
      duration: info.duration || '',
      backdrop: fixUrl(info.backdrop_path || info.movie_image || '', this.server),
      poster: fixUrl(info.movie_image || movie.stream_icon || '', this.server),
      containerExtension: movie.container_extension || info.container_extension || 'mp4',
      raw,
    };
  }

  async seriesInfo(seriesId) {
    const raw = await this.api('get_series_info', { series_id: seriesId });
    const info = raw?.info || {};
    const episodesRaw = raw?.episodes || {};
    const seasons = [];
    for (const [seasonKey, list] of Object.entries(episodesRaw)) {
      const season = Number(seasonKey) || 0;
      const episodes = (Array.isArray(list) ? list : []).map((ep) =>
        normalizeEpisode(ep, seriesId, season, this.server)
      );
      episodes.sort((a, b) => a.episodeNum - b.episodeNum);
      seasons.push({ season, episodes });
    }
    seasons.sort((a, b) => a.season - b.season);
    return {
      info: {
        ...info,
        name: info.name || '',
        cover: fixUrl(info.cover || '', this.server),
        backdrop: fixUrl(info.backdrop_path || info.cover_big || '', this.server),
        plot: info.plot || '',
        cast: info.cast || '',
        director: info.director || '',
        genre: info.genre || '',
        rating: info.rating || '',
        releaseDate: info.releaseDate || '',
      },
      seasons,
      raw,
    };
  }

  async shortEpg(streamId, limit = 2) {
    const raw = await this.api('get_short_epg', { stream_id: streamId, limit });
    const list = raw?.epg_listings || [];
    return (Array.isArray(list) ? list : []).map(normalizeEpg);
  }

  streamUrl(item, { format } = {}) {
    if (!item) return '';
    if (item.url) return item.url;
    const user = encodeURIComponent(this.username);
    const pass = encodeURIComponent(this.password);
    if (item.streamType === 'live') {
      const preferred = format || (this.accountInfo?.formats?.includes('m3u8') ? 'm3u8' : 'm3u8');
      return `${this.server}/live/${user}/${pass}/${item.id}.${preferred}`;
    }
    const ext = item.containerExtension || 'mp4';
    if (item.streamType === 'episode') {
      return `${this.server}/series/${user}/${pass}/${item.id}.${ext}`;
    }
    return `${this.server}/movie/${user}/${pass}/${item.id}.${ext}`;
  }
}

export default XtreamClient;

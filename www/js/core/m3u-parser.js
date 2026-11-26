/* Parser M3U optimizado para Live TV, VOD (Peliculas) y Series.
   Incorpora clasificacion inteligente, extraccion de temporadas/episodios,
   agrupacion de series estilo Xtream, deteccion de extensiones y BOM UTF-8.
*/

function resolveUrl(value, baseUrl) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return 'https:' + raw;
  if (!baseUrl) return raw;
  try { return new URL(raw, baseUrl).toString(); } catch (_) { return raw; }
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Parsea atributos con comillas y sin comillas (Pattern a y b de rg1.java).
 */
function parseAttributes(line) {
  const attrs = {};
  // 1. Atributos con comillas: key="valor"
  const reQuoted = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = reQuoted.exec(line))) {
    attrs[m[1].toLowerCase()] = m[2];
  }
  // 2. Atributos sin comillas: key=valor
  const reUnquoted = /([a-zA-Z0-9_-]+)\s*=\s*([^"\s][^\s]*)/g;
  while ((m = reUnquoted.exec(line))) {
    const k = m[1].toLowerCase();
    if (attrs[k] === undefined) {
      attrs[k] = m[2];
    }
  }
  return attrs;
}

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

/**
 * Separa cabecera y titulo de un #EXTINF por la primera coma fuera de comillas.
 */
function splitExtinf(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      return [line.slice(0, i), line.slice(i + 1)];
    }
  }
  return [line, ''];
}

/**
 * Extrae año de 4 dígitos si está presente entre paréntesis o delimitado en el nombre.
 */
export function extractYear(name) {
  const m = String(name || '').match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[1] : '';
}

/**
 * Clasificador inteligente de contenido basado en Xtream / rg1.java:
 * live, movie (VOD), series
 */
export function detectStreamType(url, group, name) {
  const cleanUrl = String(url || '').toLowerCase().split('?')[0];
  const cleanGroup = String(group || '').toLowerCase();
  const cleanTitle = String(name || '').toLowerCase();

  // 1. Deteccion prioritaria por estructura de URL Xtream
  if (cleanUrl.includes('/series/')) {
    return 'series';
  }
  if (cleanUrl.includes('/movie/') || cleanUrl.includes('/movies/') || cleanUrl.includes('/vod/')) {
    return 'movie';
  }

  // 2. Deteccion de series por patrones de Temporada / Episodio en el titulo
  const isSeriesTitle =
    /\b[sStT](\d{1,2})\s*[-_.]?\s*[eE](\d{1,3})\b/.test(cleanTitle) ||
    /\b(\d{1,2})x(\d{1,3})\b/.test(cleanTitle) ||
    /\b(?:season|temporada|temp\.?)\s*(\d{1,2})\b/i.test(cleanTitle) ||
    /\b(?:episode|episodio|cap|capitulo|capítulo)\s*(\d{1,3})\b/i.test(cleanTitle);

  if (isSeriesTitle) {
    return 'series';
  }

  // 3. Palabras clave en el grupo
  if (
    cleanGroup.includes('series') ||
    cleanGroup.includes('seriados') ||
    cleanGroup.includes('temporada') ||
    cleanGroup.includes('season') ||
    cleanGroup.includes('novela') ||
    cleanGroup.includes('dorama') ||
    cleanGroup.includes('anime')
  ) {
    return 'series';
  }

  if (
    cleanGroup.includes('vod') ||
    cleanGroup.includes('movie') ||
    cleanGroup.includes('pelicula') ||
    cleanGroup.includes('película') ||
    cleanGroup.includes('cine') ||
    cleanGroup.includes('film') ||
    cleanGroup.includes('cinema') ||
    cleanGroup.includes('estreno')
  ) {
    return 'movie';
  }

  // 4. Extensiones de archivo de video (VOD de peliculas)
  if (/\.(mp4|mkv|avi|mov|m4v|flv|wmv|mpg|mpeg|3gp|webm)$/i.test(cleanUrl)) {
    return 'movie';
  }

  return 'live';
}

/**
 * Detecta extension del contenedor (mp4, mkv, etc.)
 */
export function detectContainerExtension(url) {
  const cleanUrl = String(url || '').toLowerCase().split('?')[0];
  const match = cleanUrl.match(/\.([a-z0-9]{2,5})$/i);
  if (match && ['mp4', 'mkv', 'avi', 'mov', 'm4v', 'flv', 'wmv', 'mpg', 'mpeg', '3gp', 'webm', 'ts', 'm3u8'].includes(match[1])) {
    return match[1];
  }
  return 'mp4';
}

/**
 * Parsea el nombre de un episodio para obtener titulo de serie, temporada, numero y subtitulo.
 */
export function parseSeriesEpisodeInfo(name) {
  const clean = cleanName(name);
  let season = 1;
  let episodeNum = 1;
  let seriesTitle = clean;
  let episodeTitle = '';

  const reSE = /^(.*?)\s*[-_.]?\s*\b[sStT](\d{1,2})\s*[-_.]?\s*[eE](\d{1,3})\b\s*[-_.:]?\s*(.*)$/i;
  const reX = /^(.*?)\s*[-_.]?\s*\b(\d{1,2})x(\d{1,3})\b\s*[-_.:]?\s*(.*)$/i;
  const reWords = /^(.*?)\s*[-_.]?\s*\b(?:season|temporada|temp\.?)\s*(\d{1,2})\s*[-_.]?\s*(?:episode|episodio|cap|capitulo|capítulo)\s*(\d{1,3})\b\s*[-_.:]?\s*(.*)$/i;

  const m = clean.match(reSE) || clean.match(reX) || clean.match(reWords);
  if (m) {
    seriesTitle = m[1].replace(/[-_.:]+$/, '').trim() || clean;
    season = parseInt(m[2], 10) || 1;
    episodeNum = parseInt(m[3], 10) || 1;
    episodeTitle = m[4].replace(/^[-_.:]+/, '').trim();
  }

  const year = extractYear(seriesTitle);

  return {
    seriesTitle,
    season,
    episodeNum,
    episodeTitle: episodeTitle || `Episodio ${episodeNum}`,
    year,
  };
}

/**
 * Agrupa episodios sueltos de series M3U en objetos de Serie con temporadas y episodios,
 * homologando exactamente la estructura de Xtream (get_series_info).
 */
export function groupM3USeries(seriesItems) {
  const seriesMap = new Map();

  for (const item of seriesItems || []) {
    const epInfo = parseSeriesEpisodeInfo(item.name);
    const seriesTitle = epInfo.seriesTitle || item.name;
    const seriesKey = (item.group || '') + '||' + normalize(seriesTitle);

    if (!seriesMap.has(seriesKey)) {
      const seriesId = `m3u-series-${hash(seriesKey)}`;
      seriesMap.set(seriesKey, {
        id: seriesId,
        name: seriesTitle,
        icon: item.icon || '',
        categoryId: item.categoryId || 'g:' + (item.group || 'Series'),
        group: item.group || 'Series',
        year: epInfo.year || item.year || '',
        rating: item.rating || '',
        streamType: 'series',
        _seasons: new Map(),
      });
    }

    const sObj = seriesMap.get(seriesKey);
    if (!sObj.icon && item.icon) sObj.icon = item.icon;
    if (!sObj.year && epInfo.year) sObj.year = epInfo.year;

    const seasonNum = epInfo.season || 1;
    if (!sObj._seasons.has(seasonNum)) {
      sObj._seasons.set(seasonNum, []);
    }

    const episodeObj = {
      id: item.id,
      name: epInfo.episodeTitle || item.name,
      icon: item.icon || sObj.icon || '',
      plot: '',
      duration: '',
      rating: '',
      seriesId: sObj.id,
      season: seasonNum,
      episodeNum: epInfo.episodeNum || (sObj._seasons.get(seasonNum).length + 1),
      url: item.url,
      containerExtension: item.containerExtension || 'mp4',
      streamType: 'episode',
    };

    sObj._seasons.get(seasonNum).push(episodeObj);
  }

  const seriesList = [];
  for (const sObj of seriesMap.values()) {
    const seasons = [];
    const sortedSeasonNums = Array.from(sObj._seasons.keys()).sort((a, b) => a - b);
    for (const sNum of sortedSeasonNums) {
      const episodes = sObj._seasons.get(sNum);
      episodes.sort((a, b) => a.episodeNum - b.episodeNum);
      seasons.push({
        season: sNum,
        episodes,
      });
    }
    delete sObj._seasons;
    sObj.seasons = seasons;
    seriesList.push(sObj);
  }

  seriesList.sort((a, b) => a.name.localeCompare(b.name));
  return seriesList;
}

export function parseM3U(rawText, options = {}) {
  const baseUrl = options.baseUrl || '';
  if (!rawText || typeof rawText !== 'string') return [];

  // Limpieza de BOM UTF-8 (\uFEFF)
  let text = rawText;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  if (!text.includes('#EXTM3U') && !text.includes('#EXTINF')) return [];

  const lines = text.split(/\r?\n/);
  const live = [];
  const movies = [];
  const seriesRaw = [];

  let meta = null;
  let pendingGroup = '';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTGRP:')) {
      pendingGroup = line.slice(8).trim();
      continue;
    }
    if (line.startsWith('#EXTINF')) {
      const [head, tail] = splitExtinf(line);
      const attrs = parseAttributes(head);
      const name = cleanName(attrs['tvg-name'] || tail || attrs['tvg-id'] || 'Canal');
      const group = cleanName(attrs['group-title'] || pendingGroup || 'General');
      meta = {
        name: name || 'Contenido',
        group: group || 'General',
        icon: resolveUrl(attrs['tvg-logo'] || attrs['logo'] || attrs['tvg_logo'] || attrs['tvg-icon'] || attrs['icon'] || '', baseUrl),
        epgChannelId: attrs['tvg-id'] || '',
        num: attrs['tvg-chno'] || '',
        year: attrs['tvg-year'] || extractYear(name),
        rating: attrs['tvg-rating'] || '',
      };
      pendingGroup = '';
      continue;
    }
    if (line.startsWith('#')) continue;
    if (!meta) continue;

    const url = resolveUrl(line, baseUrl);
    if (!url) { meta = null; continue; }

    const streamType = detectStreamType(url, meta.group, meta.name);
    const containerExtension = detectContainerExtension(url);
    const id = `m3u-${hash(url + '|' + meta.name)}`;

    const item = {
      id,
      name: meta.name,
      icon: meta.icon,
      categoryId: 'g:' + meta.group,
      group: meta.group,
      epgChannelId: meta.epgChannelId,
      num: meta.num,
      year: meta.year,
      rating: meta.rating,
      url,
      streamType,
      containerExtension,
    };

    if (streamType === 'movie') movies.push(item);
    else if (streamType === 'series') seriesRaw.push(item);
    else live.push(item);

    meta = null;
  }

  // Agrupacion quirurgica de series (equivalente a Series de Xtream)
  const series = groupM3USeries(seriesRaw);

  const out = live.concat(movies, series);
  out.live = live;
  out.movies = movies;
  out.series = series;
  out.seriesRaw = seriesRaw;
  return out;
}

export function buildCategories(items, type = 'live') {
  const map = new Map();
  for (const item of items || []) {
    const name = item.group || 'General';
    const id = item.categoryId || 'g:' + name;
    const row = map.get(id) || { id, name, count: 0, type: item.streamType || type };
    row.count++;
    map.set(id, row);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export default parseM3U;

/* Carga y parseo de listas M3U.
   El parseo pesado ocurre en un Web Worker para no bloquear la UI.
*/

import {
  parseM3U,
  buildCategories,
  groupM3USeries,
  parseSeriesEpisodeInfo,
  detectStreamType,
} from './m3u-parser.js';
import { uid } from './util.js';

export {
  parseM3U,
  buildCategories,
  groupM3USeries,
  parseSeriesEpisodeInfo,
  detectStreamType,
};

export function parseM3UAsync(text, { baseUrl = '', timeout = 45000 } = {}) {
  if (typeof Worker === 'undefined' || !text || text.length < 64 * 1024) {
    return Promise.resolve(parseM3U(text, { baseUrl }));
  }

  return new Promise((resolve, reject) => {
    let worker;
    const id = uid();
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { worker?.terminate(); } catch (_) {}
      resolve(parseM3U(text, { baseUrl }));
    }, timeout);

    try {
      worker = new Worker('js/workers/m3u-worker.js', { type: 'module' });
    } catch (_) {
      clearTimeout(timer);
      resolve(parseM3U(text, { baseUrl }));
      return;
    }

    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.id !== id || done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      if (data.ok) {
        const list = data.channels || [];
        list.live = data.live || [];
        list.movies = data.movies || [];
        list.series = data.series || [];
        list.seriesRaw = data.seriesRaw || [];
        resolve(list);
      } else {
        reject(new Error(data.error || 'Error parseando M3U'));
      }
    };
    worker.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { worker?.terminate(); } catch (_) {}
      resolve(parseM3U(text, { baseUrl }));
    };
    worker.postMessage({ id, text, baseUrl });
  });
}

/* =========================================================
   CATALOGO DE PAISES DE HABLA HISPANA (IPTV-ORG)
   Agrupados por region: Sudamerica, Centroamerica y Caribe,
   Norteamerica, Europa (Espana)
   ========================================================= */
export const SPANISH_COUNTRIES = [
  // Sudamerica
  { code: 'AR', name: 'Argentina', flag: '🇦🇷', region: 'sur', regionLabel: 'Sudamérica' },
  { code: 'BO', name: 'Bolivia', flag: '🇧🇴', region: 'sur', regionLabel: 'Sudamérica' },
  { code: 'BR', name: 'Brasil', flag: '🇧🇷', region: 'sur', regionLabel: 'Sudamérica' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱', region: 'sur', regionLabel: 'Sudamérica' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴', region: 'sur', regionLabel: 'Sudamérica' },
  { code: 'EC', name: 'Ecuador', flag: '🇪🇨', region: 'sur', regionLabel: 'Sudamérica' },
  { code: 'PY', name: 'Paraguay', flag: '🇵🇾', region: 'sur', regionLabel: 'Sudamérica' },
  { code: 'PE', name: 'Perú', flag: '🇵🇪', region: 'sur', regionLabel: 'Sudamérica' },
  { code: 'UY', name: 'Uruguay', flag: '🇺🇾', region: 'sur', regionLabel: 'Sudamérica' },
  { code: 'VE', name: 'Venezuela', flag: '🇻🇪', region: 'sur', regionLabel: 'Sudamérica' },

  // Centroamerica y Caribe
  { code: 'CR', name: 'Costa Rica', flag: '🇨🇷', region: 'centro', regionLabel: 'Centroamérica y Caribe' },
  { code: 'CU', name: 'Cuba', flag: '🇨🇺', region: 'centro', regionLabel: 'Centroamérica y Caribe' },
  { code: 'DO', name: 'República Dominicana', flag: '🇩🇴', region: 'centro', regionLabel: 'Centroamérica y Caribe' },
  { code: 'SV', name: 'El Salvador', flag: '🇸🇻', region: 'centro', regionLabel: 'Centroamérica y Caribe' },
  { code: 'GT', name: 'Guatemala', flag: '🇬🇹', region: 'centro', regionLabel: 'Centroamérica y Caribe' },
  { code: 'HN', name: 'Honduras', flag: '🇭🇳', region: 'centro', regionLabel: 'Centroamérica y Caribe' },
  { code: 'NI', name: 'Nicaragua', flag: '🇳🇮', region: 'centro', regionLabel: 'Centroamérica y Caribe' },
  { code: 'PA', name: 'Panamá', flag: '🇵🇦', region: 'centro', regionLabel: 'Centroamérica y Caribe' },
  { code: 'PR', name: 'Puerto Rico', flag: '🇵🇷', region: 'centro', regionLabel: 'Centroamérica y Caribe' },

  // Norteamerica
  { code: 'MX', name: 'México', flag: '🇲🇽', region: 'norte', regionLabel: 'Norteamérica' },

  // Europa
  { code: 'ES', name: 'España', flag: '🇪🇸', region: 'europa', regionLabel: 'España / Europa' },
];

export const REGIONS = [
  { id: 'todos', label: 'Todos', name: 'Todos' },
  { id: 'sur', label: 'Sudamérica', name: 'Sudamérica' },
  { id: 'centro', label: 'Centroamérica y Caribe', name: 'Centroamérica y Caribe' },
  { id: 'norte', label: 'Norteamérica', name: 'Norteamérica' },
  { id: 'europa', label: 'España / Europa', name: 'España / Europa' },
];

export const FREE_COUNTRIES = SPANISH_COUNTRIES;

export function freeListUrl(code) {
  const cleanCode = String(code || '').toLowerCase().trim();
  return `https://iptv-org.github.io/iptv/countries/${cleanCode}.m3u`;
}

/**
 * Endpoints alternativos y de respaldo directo en GitHub para asegurar
 * la descarga y actualización de las listas sin cortes.
 */
export function freeListGitHubUrls(code) {
  const cleanCode = String(code || '').toLowerCase().trim();
  return [
    `https://iptv-org.github.io/iptv/countries/${cleanCode}.m3u`,
    `https://raw.githubusercontent.com/iptv-org/iptv/gh-pages/countries/${cleanCode}.m3u`,
    `https://raw.githubusercontent.com/iptv-org/iptv/master/streams/${cleanCode}.m3u`,
  ];
}

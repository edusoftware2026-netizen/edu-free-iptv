import { parseM3U } from '../core/m3u-parser.js';

self.onmessage = (event) => {
  const { id, text, baseUrl } = event.data || {};
  try {
    const result = parseM3U(text, { baseUrl });
    self.postMessage({
      id,
      ok: true,
      channels: result,
      live: result.live || [],
      movies: result.movies || [],
      series: result.series || [],
      seriesRaw: result.seriesRaw || [],
    });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};

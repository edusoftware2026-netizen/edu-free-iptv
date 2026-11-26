/* Estado global pequeno y persistente.
   Los catalogos NO se guardan aqui: van a IndexedDB (db.js).
*/

const KEY = 'freeiptv.v2.small';

const defaults = () => ({
  version: 2,
  profile: null,
  freeProfile: null,
  premiumProfile: null,
  externalProfiles: [], // Lista persistente de listas externas agregadas por el usuario
  account: null,
  settings: {
    engine: 'auto',        // auto | native | external | web
    externalPlayer: 'auto',// auto | org.videolan.vlc | com.mxtech.videoplayer.ad | chooser
    buffer: 30,            // segundos
    epg: true,
    reduceMotion: false,
    modo: 'free',          // premium | free
    lastTab: 'home',
    parental: {
      enabled: false,           // true | false
      pin: '0000',              // PIN de 4 dígitos
      mode: 'hide',             // 'hide' (ocultar) | 'lock' (candado con PIN)
      customLockedCats: [],     // IDs de categorías bloqueadas manualmente
      sessionTimeout: 15,       // Minutos de desbloqueo temporal (0 = siempre pedir)
    },
  },
  favorites: {},
  progress: {},
  lastChannel: null,
  catalogs: { live: [], movies: [], series: [] },
  categories: { live: [], movies: [], series: [] },
  counts: { live: 0, movies: 0, series: 0 },
  loading: { catalog: false, epg: false },
  catalogUpdatedAt: 0,
  error: null,
});

function clone(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) {}
  }
  return JSON.parse(JSON.stringify(value));
}

function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = merge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

class Store {
  constructor() {
    this.state = defaults();
    this.listeners = new Set();
    this.saveTimer = 0;
    this.loaded = false;
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        this.state = merge(defaults(), saved);
        if (!Array.isArray(this.state.externalProfiles)) {
          this.state.externalProfiles = [];
        }
        if (this.state.profile) {
          const p = this.state.profile;
          const isFree = p.isFree || p.id?.startsWith('free-') || (Array.isArray(p.urls) && p.urls.length > 1);
          if (isFree && !this.state.freeProfile) this.state.freeProfile = p;
          if (!isFree) {
            if (!this.state.premiumProfile) this.state.premiumProfile = p;
            if (!this.state.externalProfiles.some((ep) => ep.id === p.id)) {
              this.state.externalProfiles.push(p);
            }
          }
        }
      }
    } catch (err) {
      console.warn('Store: no se pudo leer estado', err);
    }
    window.addEventListener('pagehide', () => this.saveNow());
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveNow();
    });
  }

  get() {
    return this.state;
  }

  set(patch) {
    if (patch.profile) {
      const p = patch.profile;
      const isFree = p.isFree || p.id?.startsWith('free-') || (Array.isArray(p.urls) && p.urls.length > 1);
      if (isFree) {
        patch.freeProfile = p;
        if (!patch.settings) patch.settings = { ...this.state.settings, modo: 'free' };
        else patch.settings.modo = 'free';
      } else {
        patch.premiumProfile = p;
        if (!patch.settings) patch.settings = { ...this.state.settings, modo: 'premium' };
        else patch.settings.modo = 'premium';
      }
    }
    this.state = { ...this.state, ...patch };
    this.save();
    this.emit();
    return this.state;
  }

  setSettings(patch) {
    this.state.settings = { ...this.state.settings, ...patch };
    this.save();
    this.emit();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) {
      try { fn(this.state); } catch (err) { console.error('Store listener', err); }
    }
  }

  persistable() {
    const s = this.state;
    return {
      version: s.version,
      profile: s.profile,
      freeProfile: s.freeProfile,
      premiumProfile: s.premiumProfile,
      externalProfiles: s.externalProfiles || [],
      settings: s.settings,
      favorites: s.favorites,
      progress: s.progress,
      lastChannel: s.lastChannel,
    };
  }

  addExternalProfile(profile, account = null) {
    if (!profile) return null;
    if (!Array.isArray(this.state.externalProfiles)) this.state.externalProfiles = [];
    const idx = this.state.externalProfiles.findIndex((p) => {
      if (p.id === profile.id) return true;
      if (profile.type === 'xtream' && p.server === profile.server && p.username === profile.username) return true;
      if (profile.type === 'm3u' && profile.url && p.url === profile.url) return true;
      return false;
    });
    const entry = { ...profile, lastUsedAt: Date.now() };
    if (idx >= 0) {
      this.state.externalProfiles[idx] = entry;
    } else {
      this.state.externalProfiles.unshift(entry);
    }
    this.state.profile = entry;
    this.state.premiumProfile = entry;
    this.state.account = account;
    this.state.settings.modo = 'premium';
    this.saveNow();
    this.emit();
    return entry;
  }

  removeExternalProfile(profileId) {
    if (!profileId || !Array.isArray(this.state.externalProfiles)) return;
    this.state.externalProfiles = this.state.externalProfiles.filter((p) => p.id !== profileId);
    if (this.state.profile?.id === profileId) {
      if (this.state.externalProfiles.length > 0) {
        this.switchProfile(this.state.externalProfiles[0]);
      } else if (this.state.freeProfile) {
        this.switchProfile(this.state.freeProfile);
      } else {
        this.resetProfile();
      }
    }
    this.saveNow();
    this.emit();
  }

  switchProfile(profile) {
    if (!profile) return;
    const isFree = profile.isFree || profile.id?.startsWith('free-') || (Array.isArray(profile.urls) && profile.urls.length > 1);
    this.state.profile = profile;
    if (isFree) {
      this.state.freeProfile = profile;
      this.state.settings.modo = 'free';
      this.state.account = null;
    } else {
      this.state.premiumProfile = profile;
      this.state.settings.modo = 'premium';
    }
    this.saveNow();
    this.emit();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.persistable()));
    } catch (err) {
      console.warn('Store: no se pudo guardar', err);
    }
  }

  resetProfile() {
    this.state.profile = null;
    this.state.account = null;
    this.state.catalogs = { live: [], movies: [], series: [] };
    this.state.categories = { live: [], movies: [], series: [] };
    this.state.counts = { live: 0, movies: 0, series: 0 };
    this.state.catalogUpdatedAt = 0;
    this.state.lastChannel = null;
    this.saveNow();
    this.emit();
  }

  /* ---------- Control Parental ---------- */
  updateParental(patch) {
    if (!this.state.settings.parental) {
      this.state.settings.parental = {
        enabled: false,
        pin: '0000',
        mode: 'hide',
        customLockedCats: [],
        sessionTimeout: 15,
      };
    }
    this.state.settings.parental = {
      ...this.state.settings.parental,
      ...(patch || {}),
    };
    this.saveNow();
    this.emit();
  }

  toggleLockedCategory(catId) {
    if (!catId) return;
    if (!this.state.settings.parental) this.updateParental({});
    const locked = new Set(this.state.settings.parental.customLockedCats || []);
    const strId = String(catId);
    if (locked.has(strId)) {
      locked.delete(strId);
    } else {
      locked.add(strId);
    }
    this.state.settings.parental.customLockedCats = Array.from(locked);
    this.saveNow();
    this.emit();
  }

  /* ---------- Favoritos ---------- */
  itemKey(item) {
    if (!item) return '';
    return `${item.streamType || 'item'}:${item.id}`;
  }

  isFavorite(item) {
    return !!this.state.favorites[this.itemKey(item)];
  }

  toggleFavorite(item) {
    const key = this.itemKey(item);
    if (!key) return false;
    if (this.state.favorites[key]) {
      delete this.state.favorites[key];
    } else {
      this.state.favorites[key] = minimalItem(item);
    }
    this.save();
    this.emit();
    return !!this.state.favorites[key];
  }

  favoritesList(type = null) {
    const list = Object.values(this.state.favorites);
    return (type ? list.filter((i) => i.streamType === type) : list)
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }

  /* ---------- Progreso / continuar viendo ---------- */
  getProgress(item) {
    if (!item) return null;
    return this.state.progress[this.itemKey(item)] || null;
  }

  setProgress(item, position, duration) {
    if (!item) return;
    const key = this.itemKey(item);
    if (!key) return;
    const pos = Math.max(0, Number(position) || 0);
    const dur = Math.max(0, Number(duration) || 0);
    if (pos < 5 && dur > 0) return;
    const entry = {
      ...minimalItem(item),
      position: pos,
      duration: dur,
      updatedAt: Date.now(),
    };
    if (dur > 0 && pos >= dur - 15) {
      // Terminado: se conserva pero sin barra.
      entry.position = 0;
      entry.finished = true;
    }
    this.state.progress[key] = entry;
    this.save();
    this.emit();
  }

  clearProgress(item) {
    const key = this.itemKey(item);
    if (key && this.state.progress[key]) {
      delete this.state.progress[key];
      this.save();
      this.emit();
    }
  }

  continueWatching(limit = 12) {
    const list = Object.values(this.state.progress)
      .filter((p) => p && !p.finished && p.position > 5)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return list.slice(0, limit);
  }

  /* ---------- Busqueda de items en catalogo ---------- */
  findItem(type, id) {
    const list = this.state.catalogs[type] || [];
    const key = String(id);
    return list.find((i) => String(i.id) === key) || null;
  }

  setLastChannel(item) {
    this.state.lastChannel = minimalItem(item);
    this.save();
  }

  setCatalogs({ catalogs, categories, account, updatedAt }) {
    this.state.catalogs = catalogs || { live: [], movies: [], series: [] };
    this.state.categories = categories || { live: [], movies: [], series: [] };
    this.state.account = account || this.state.account;
    this.state.counts = {
      live: this.state.catalogs.live.length,
      movies: this.state.catalogs.movies.length,
      series: this.state.catalogs.series.length,
    };
    this.state.catalogUpdatedAt = updatedAt || Date.now();
    this.emit();
  }

  setLoading(key, value) {
    this.state.loading = { ...this.state.loading, [key]: value };
    this.emit();
  }

  setError(message) {
    this.state.error = message || null;
    this.emit();
  }
}

export function minimalItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    name: item.name,
    icon: item.icon || '',
    url: item.url || '',
    group: item.group || '',
    streamType: item.streamType || 'live',
    categoryId: item.categoryId || '',
    epgChannelId: item.epgChannelId || '',
    num: item.num || '',
    containerExtension: item.containerExtension || '',
    rating: item.rating || '',
    year: item.year || '',
    seriesId: item.seriesId || '',
    season: item.season || 0,
    episodeNum: item.episodeNum || 0,
    addedAt: item.addedAt || Date.now(),
  };
}

export const store = new Store();
export default store;

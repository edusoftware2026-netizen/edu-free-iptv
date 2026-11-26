/* Navegacion espacial para TV / D-Pad.
   - Mide una sola vez por render (no en cada tecla).
   - No usa getComputedStyle por elemento.
   - Mantiene el foco dentro de la pantalla activa.
*/

class FocusManager {
  constructor() {
    this.scope = null;
    this.items = [];
    this.rects = [];
    this.current = null;
    this.enabled = true;
    this.measureRaf = 0;
    this.scrollTimer = 0;
    this.boundKey = this.onKey.bind(this);
    this.boundFocusIn = this.onFocusIn.bind(this);
    this.boundBack = this.onBack.bind(this);
  }

  init() {
    document.addEventListener('keydown', this.boundKey, true);
    document.addEventListener('focusin', this.boundFocusIn, true);
    document.addEventListener('scroll', () => {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(() => this.measure(), 80);
    }, true);
    window.addEventListener('app:back', this.boundBack);
    return this;
  }

  attach(scope, { autoFocus = true, initial = null } = {}) {
    this.scope = scope;
    this.current = null;
    this.refresh({ autoFocus: false });
    if (initial) {
      const el = typeof initial === 'string' ? scope.querySelector(initial) : initial;
      if (el) this.focus(el, { scroll: false });
      else if (autoFocus) this.focusFirst();
    } else if (autoFocus) {
      this.focusFirst();
    }
  }

  detach() {
    if (this.current) this.current.classList.remove('is-focused');
    this.scope = null;
    this.items = [];
    this.rects = [];
    this.current = null;
  }

  setEnabled(value) {
    this.enabled = !!value;
  }

  isVisible(el) {
    if (!el || el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
    return el.getClientRects().length > 0;
  }

  collect() {
    if (!this.scope) return [];
    const nodes = this.scope.querySelectorAll('[data-focusable]');
    const out = [];
    for (const el of nodes) {
      if (this.isVisible(el)) out.push(el);
    }
    return out;
  }

  refresh({ autoFocus = true } = {}) {
    if (!this.scope) return;
    const items = this.collect();
    this.items = items;
    this.rects = new Array(items.length);
    this.measure();
    if (this.current && !items.includes(this.current)) {
      this.current = null;
    }
    if (!this.current && autoFocus) this.focusFirst();
  }

  measure() {
    cancelAnimationFrame(this.measureRaf);
    this.measureRaf = requestAnimationFrame(() => {
      this.items = this.items.filter((el) => el.isConnected);
      this.rects = this.items.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      });
    });
  }

  focusFirst() {
    if (!this.items.length) return;
    this.focus(this.items[0], { scroll: false });
  }

  focus(el, { scroll = true } = {}) {
    if (!el || !el.isConnected) return;
    if (this.current && this.current !== el) this.current.classList.remove('is-focused');
    this.current = el;
    el.classList.add('is-focused');
    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      try { el.focus(); } catch (_) {}
    }
    if (scroll) {
      try {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch (_) {}
      clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(() => this.measure(), 90);
    }
  }

  onFocusIn(event) {
    if (!this.scope || !this.scope.contains(event.target)) return;
    const el = event.target.closest?.('[data-focusable]');
    if (!el || el === this.current) return;
    if (this.current) this.current.classList.remove('is-focused');
    this.current = el;
    el.classList.add('is-focused');
  }

  indexOf(el) {
    return this.items.indexOf(el);
  }

  currentRect() {
    if (!this.current) return null;
    const idx = this.indexOf(this.current);
    if (idx >= 0 && this.rects[idx]) return this.rects[idx];
    const r = this.current.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  bestCandidate(direction, rect) {
    let best = null;
    let bestScore = Infinity;
    const horizontal = direction === 'left' || direction === 'right';
    const sign = direction === 'right' || direction === 'down' ? 1 : -1;

    for (let i = 0; i < this.items.length; i++) {
      const el = this.items[i];
      if (el === this.current) continue;
      const r = this.rects[i];
      if (!r || r.w === 0 || r.h === 0) continue;

      const primary = horizontal ? (r.cx - rect.cx) * sign : (r.cy - rect.cy) * sign;
      if (primary <= 4) continue;

      const secondary = horizontal ? Math.abs(r.cy - rect.cy) : Math.abs(r.cx - rect.cx);
      const overlap = horizontal
        ? Math.max(0, Math.min(r.y + r.h, rect.y + rect.h) - Math.max(r.y, rect.y))
        : Math.max(0, Math.min(r.x + r.w, rect.x + rect.w) - Math.max(r.x, rect.x));

      const score = primary + secondary * 1.7 - overlap * 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  move(direction) {
    if (!this.items.length) this.refresh({ autoFocus: false });
    if (!this.current) {
      this.focusFirst();
      return true;
    }
    const rect = this.currentRect();
    if (!rect) return false;
    const candidate = this.bestCandidate(direction, rect);
    if (candidate) {
      this.focus(candidate);
      return true;
    }
    this.scope?.dispatchEvent(new CustomEvent('focus:edge', {
      bubbles: true,
      detail: { direction, current: this.current },
    }));
    return false;
  }

  onBack() {
    const el = this.current;
    if (el) el.classList.remove('is-focused');
    this.current = null;
    window.dispatchEvent(new CustomEvent('ui:back'));
  }

  isTextInput(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return !['button', 'submit', 'checkbox', 'radio', 'range', 'reset'].includes(type);
  }

  onKey(event) {
    if (!this.enabled) return;
    const key = event.key;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const active = document.activeElement;
    const inInput = this.isTextInput(active);

    if (inInput) {
      if (key === 'Escape') {
        active.blur();
        event.preventDefault();
        return;
      }
      // En campos de una linea, arriba/abajo salen del input hacia otro control.
      const canLeave = active?.tagName === 'INPUT' && (key === 'ArrowUp' || key === 'ArrowDown');
      if (!canLeave) return;
    }

    if (key === 'Escape' || key === 'BrowserBack' || key === 'GoBack') {
      event.preventDefault();
      this.onBack();
      return;
    }

    // Teclas multimedia y zapping de control remoto TV
    if (key === 'ChannelUp' || key === 'PageUp') {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('tv:channel', { detail: { delta: -1 } }));
      return;
    }
    if (key === 'ChannelDown' || key === 'PageDown') {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('tv:channel', { detail: { delta: 1 } }));
      return;
    }
    if (key === 'MediaPlayPause' || key === 'PlayPause' || key === 'MediaPlay' || key === 'MediaPause') {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('tv:playpause'));
      return;
    }
    if (key === 'MediaFastForward') {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('tv:forward'));
      return;
    }
    if (key === 'MediaRewind') {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('tv:rewind'));
      return;
    }

    if (/^[0-9]$/.test(key) && !inInput) {
      window.dispatchEvent(new CustomEvent('tv:number', { detail: { digit: key } }));
    }

    if (!this.scope) return;

    switch (key) {
      case 'ArrowUp': event.preventDefault(); this.move('up'); break;
      case 'ArrowDown': event.preventDefault(); this.move('down'); break;
      case 'ArrowLeft': event.preventDefault(); this.move('left'); break;
      case 'ArrowRight': event.preventDefault(); this.move('right'); break;
      case 'Enter': {
        if (this.current) {
          event.preventDefault();
          this.current.click();
        }
        break;
      }
      case ' ': {
        if (this.current && !this.isTextInput(this.current)) {
          event.preventDefault();
          this.current.click();
        }
        break;
      }
      default:
        break;
    }
  }
}

export const Focus = new FocusManager();
export default Focus;

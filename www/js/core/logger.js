/* Logger no bloqueante.
   - Nunca escribe en localStorage por cada linea.
   - Acumula y envia al bridge nativo en lote cada 1.5 s.
   - Mantiene las ultimas 400 lineas en memoria para la pantalla de ajustes.
*/

const MAX_MEMORY = 400;
const FLUSH_MS = 1500;
const MAX_BATCH = 80;

const memory = [];
let pending = [];
let timer = 0;
let initialized = false;
let original = null;

function formatArg(arg) {
  if (arg == null) return String(arg);
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message || String(arg);
  if (typeof arg === 'object') {
    try {
      const seen = new WeakSet();
      return JSON.stringify(arg, (k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      });
    } catch (_) {
      return String(arg);
    }
  }
  return String(arg);
}

function line(level, tag, args) {
  const message = args.map(formatArg).join(' ').slice(0, 2000);
  const stamp = new Date().toISOString();
  return `[${stamp}] [${level}] [${tag}] ${message}`;
}

function push(level, tag, args) {
  const entry = line(level, tag, args);
  memory.push(entry);
  if (memory.length > MAX_MEMORY) memory.splice(0, memory.length - MAX_MEMORY);
  pending.push(entry);
  schedule();
}

function schedule() {
  if (timer) return;
  timer = setTimeout(flush, FLUSH_MS);
}

export function flush() {
  timer = 0;
  if (!pending.length) return;
  const batch = pending.splice(0, MAX_BATCH);
  try {
    const bridge = window.AndroidNativeApp;
    if (bridge && typeof bridge.writeLogBatch === 'function') {
      bridge.writeLogBatch(JSON.stringify(batch));
    }
  } catch (_) {
    /* el log nunca debe romper la app */
  }
  if (pending.length) schedule();
}

function installConsole() {
  if (initialized || !window.console) return;
  initialized = true;
  original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  const wrap = (level, fn) => (...args) => {
    try { fn(...args); } catch (_) {}
    push(level, 'Console', args);
  };

  console.log = wrap('INFO', original.log);
  console.info = wrap('INFO', original.info);
  console.warn = wrap('WARN', original.warn);
  console.error = wrap('ERROR', original.error);
  console.debug = wrap('DEBUG', original.debug || original.log);
}

export const Logger = {
  init() {
    installConsole();
    window.addEventListener('error', (event) => {
      push('ERROR', 'Window', [event.message || 'Error', `${event.filename || ''}:${event.lineno || ''}`]);
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      push('ERROR', 'Promise', [reason?.stack || reason?.message || String(reason)]);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
    push('INFO', 'System', ['Logger iniciado']);
  },

  info(tag, ...args) { push('INFO', tag, args); },
  warn(tag, ...args) { push('WARN', tag, args); },
  error(tag, ...args) { push('ERROR', tag, args); },
  debug(tag, ...args) { push('DEBUG', tag, args); },

  recent() { return memory.slice(); },
  clear() {
    memory.length = 0;
    pending.length = 0;
    try { window.AndroidNativeApp?.clearLog?.(); } catch (_) {}
  },
  flush,
};

export default Logger;

import { store } from '../../core/store.js';
import { clearCatalog, refreshCatalog } from '../../core/catalog.js';
import { navigate } from '../../core/router.js';
import { Focus } from '../../core/focus.js';
import { Player, isNativeAvailable } from '../../player/player.js';
import { Logger } from '../../core/logger.js';
import { confirmDialog, icon, modal, topbar, toast, showPinModal, openManageCategoriesModal } from '../dom.js';
import { openLegalModal } from '../modals.js';
import { escapeHtml, fmtDate, canCast, isWifiConnected, openCastSettings } from '../../core/util.js';

function row(label, hint, control) {
  return `<div class="setting-row">
    <div>
      <div class="setting-row__label">${escapeHtml(label)}</div>
      ${hint ? `<div class="setting-row__hint">${escapeHtml(hint)}</div>` : ''}
    </div>
    <div class="setting-row__control">${control}</div>
  </div>`;
}

function switchControl(key, on) {
  return `<button class="switch${on ? ' is-on' : ''}" data-focusable data-switch="${key}" role="switch" aria-checked="${on}"></button>`;
}

export default {
  async mount(root) {
    if (!store.state.profile) {
      navigate('/login', {}, { replace: true });
      return;
    }
    this.root = root;
    this.handlers = [];
    this.rootBound = false;
    this.hw = await Player.evaluateHardware().catch(() => null);
    this.paint();
    Focus.attach(root);
  },

  paint() {
    const s = store.state;
    const profile = s.profile;
    const account = s.account;
    const native = isNativeAvailable();
    const server = profile?.type === 'xtream' ? profile.server : (profile?.urls?.[0] || profile?.url || '');
    const user = profile?.type === 'xtream' ? profile.username : 'Lista M3U';
    const status = profile?.type === 'xtream' ? (account?.status || '—') : 'Free';
    const exp = profile?.type === 'xtream' ? (account?.expDate ? fmtDate(account.expDate) : '—') : 'Sin vencimiento';
    const connections = profile?.type === 'xtream' ? `${account?.activeConnections ?? 0} / ${account?.maxConnections || '?'}` : '—';

    this.root.innerHTML = `<section class="screen">
      ${topbar({ title: 'Ajustes', subtitle: 'Cuenta, reproduccion y datos', back: true, sair: true })}
      <div class="screen__body">
        <div class="page">
          <div class="settings">
            <section class="panel">
              <div class="panel__head">Cuenta</div>
              <div class="panel__body">
                ${row('Tipo', profile?.type === 'xtream' ? 'Panel Xtream Codes' : 'Lista M3U', `<span class="chip is-active">${profile?.type === 'xtream' ? 'XTREAM' : 'M3U'}</span>`)}
                ${row('Servidor / origen', '', `<span class="muted ellipsis" style="max-width:420px;text-align:right">${escapeHtml(server)}</span>`)}
                ${row('Usuario', '', `<span class="muted">${escapeHtml(user)}</span>`)}
                ${row('Estado', '', `<span class="ok">${escapeHtml(status)}</span>`)}
                ${row('Vencimiento', '', `<span class="muted">${escapeHtml(exp)}</span>`)}
                ${row('Conexiones', '', `<span class="muted">${escapeHtml(connections)}</span>`)}
                <div class="setting-row">
                  <div class="setting-row__label">Acciones de cuenta</div>
                  <div class="setting-row__control">
                    <button class="btn btn--ghost btn--sm" data-focusable data-action="refresh">${icon('refresh', 'icon icon--sm')} Actualizar</button>
                    <button class="btn btn--danger btn--sm" data-focusable data-action="logout">${icon('logout', 'icon icon--sm')} Cerrar sesion</button>
                  </div>
                </div>
              </div>
            </section>

            <section class="panel">
              <div class="panel__head">Reproduccion</div>
              <div class="panel__body">
                ${row('Motor de reproduccion', 'Selecciona el motor de reproduccion y decodificacion', `
                  <select class="select" data-focusable data-engine ${native ? '' : 'disabled'}>
                    <option value="auto"${s.settings.engine === 'auto' ? ' selected' : ''}>Automatico (Recomendado)</option>
                    <option value="native"${s.settings.engine === 'native' ? ' selected' : ''}>ExoPlayer nativo + FFmpeg</option>
                    <option value="external"${s.settings.engine === 'external' ? ' selected' : ''}>Reproductor Externo (VLC / MX)</option>
                    <option value="web"${s.settings.engine === 'web' ? ' selected' : ''}>HLS.js (web)</option>
                  </select>`)}
                ${row('Reproductor externo', 'Aplicacion preferida para decodificacion de video', `
                  <select class="select" data-focusable data-external-player ${native ? '' : 'disabled'}>
                    <option value="auto"${s.settings.externalPlayer === 'auto' ? ' selected' : ''}>Automatico (VLC preferente)</option>
                    <option value="org.videolan.vlc"${s.settings.externalPlayer === 'org.videolan.vlc' ? ' selected' : ''}>VLC for Android</option>
                    <option value="com.mxtech.videoplayer.ad"${s.settings.externalPlayer === 'com.mxtech.videoplayer.ad' ? ' selected' : ''}>MX Player</option>
                    <option value="chooser"${s.settings.externalPlayer === 'chooser' ? ' selected' : ''}>Preguntar siempre (Selector)</option>
                  </select>`)}
                ${row('Diagnostico de hardware', this.hw?.statusLabel || 'Evaluacion de compatibilidad', `
                  <div style="display:flex;align-items:center;gap:8px">
                    <span class="chip ${this.hw?.isHardwareLimited ? 'warn' : 'is-active'}">${escapeHtml(this.hw?.primaryAbi || 'Android')}</span>
                    <button class="btn btn--ghost btn--sm" data-focusable data-action="test-hw">Detalles</button>
                  </div>`)}
                ${row('Buffer', 'Segundos de colchon para VOD y live', `
                  <select class="select" data-focusable data-buffer>
                    ${[15, 30, 45, 60].map((n) => `<option value="${n}"${Number(s.settings.buffer) === n ? ' selected' : ''}>${n} s</option>`).join('')}
                  </select>`)}
                ${row('Pantalla completa', 'El reproductor nativo se coloca sobre el area de video', `<span class="muted">Automatico</span>`)}
                ${canCast() ? `
                  ${row('Transmitir Pantalla', 'Smart View / Pantalla Inalámbrica a Smart TV', `
                    <button class="btn btn--secondary btn--sm" data-focusable data-action="cast">
                      ${icon('cast', 'icon icon--sm')} Transmitir
                    </button>`)}
                ` : ''}
                ${row('Modo', 'FREE (listas gratuitas) o PREMIUM (panel Xtream)', switchControl('modo', s.settings.modo === 'free'))}
              </div>
            </section>

            <section class="panel">
              <div class="panel__head">Contenido</div>
              <div class="panel__body">
                ${row('EPG', 'Mostrar ahora / despues en la lista de canales', switchControl('epg', s.settings.epg))}
                ${row('Movimiento reducido', 'Desactiva animaciones de tarjetas', switchControl('reduceMotion', s.settings.reduceMotion))}
                ${row('Cache de catalogo', 'Guardado local en IndexedDB', `
                  <button class="btn btn--ghost btn--sm" data-focusable data-action="clear-cache">${icon('refresh', 'icon icon--sm')} Limpiar</button>`)}
                ${row('Logs', 'Diagnostico de red y reproduccion', `
                  <button class="btn btn--ghost btn--sm" data-focusable data-action="logs">${icon('info', 'icon icon--sm')} Ver logs</button>`)}
              </div>
            </section>

            <section class="panel">
              <div class="panel__head">Control Parental</div>
              <div class="panel__body">
                ${row('Control Parental', 'Protege o bloquea contenido para adultos', switchControl('parentalEnabled', !!s.settings.parental?.enabled))}
                ${s.settings.parental?.enabled ? `
                  ${row('Modo de protección', 'Comportamiento ante contenido adulto', `
                    <select class="select" data-focusable data-parental-mode>
                      <option value="hide"${s.settings.parental?.mode === 'hide' ? ' selected' : ''}>Ocultar completamente (Modo Seguro)</option>
                      <option value="lock"${s.settings.parental?.mode === 'lock' ? ' selected' : ''}>Bloquear con candado 🔒 (Pedir PIN)</option>
                    </select>`)}
                  ${row('PIN de seguridad', 'PIN de 4 dígitos para desbloqueo', `
                    <button class="btn btn--ghost btn--sm" data-focusable data-action="change-pin">${icon('lock', 'icon icon--sm')} Cambiar PIN</button>`)}
                  ${row('Tiempo de desbloqueo', 'Minutos de gracia antes de volver a solicitar PIN', `
                    <select class="select" data-focusable data-parental-timeout>
                      <option value="0"${Number(s.settings.parental?.sessionTimeout) === 0 ? ' selected' : ''}>Pedir PIN siempre</option>
                      <option value="15"${Number(s.settings.parental?.sessionTimeout) === 15 ? ' selected' : ''}>15 minutos</option>
                      <option value="30"${Number(s.settings.parental?.sessionTimeout) === 30 ? ' selected' : ''}>30 minutos</option>
                      <option value="60"${Number(s.settings.parental?.sessionTimeout) === 60 ? ' selected' : ''}>1 hora</option>
                    </select>`)}
                  ${row('Bloqueo de Categorías', 'Selecciona categorías adicionales para proteger', `
                    <button class="btn btn--ghost btn--sm" data-focusable data-action="manage-cats">${icon('shield', 'icon icon--sm')} Administrar</button>`)}
                ` : ''}
              </div>
            </section>

            <section class="panel">
              <div class="panel__head">Acerca de</div>
              <div class="panel__body">
                ${row('EDU-IPTV PRO', 'Versión v.1.0.0', `<span class="muted">Universal (TV / Móvil)</span>`)}
                ${row('Arquitectura', 'WebView + ExoPlayer Media3', `<span class="muted">Capacitor</span>`)}
                ${row('Soporte', 'Xtream Codes y listas M3U', `<span class="muted">HLS / TS / MP4</span>`)}
                ${row('Legal', 'Condiciones de uso y privacidad local', `
                  <div style="display:flex;gap:8px">
                    <button class="btn btn--ghost btn--sm" data-focusable data-action="legal-terms">Términos</button>
                    <button class="btn btn--ghost btn--sm" data-focusable data-action="legal-privacy">Privacidad</button>
                  </div>`)}
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>`;

    this.bind();
  },

  bind() {
    if (this.rootBound) return;
    this.rootBound = true;

    this.listen(this.root, 'click', async (event) => {
      const sw = event.target.closest('[data-switch]');
      if (sw) {
        const key = sw.dataset.switch;
        if (key === 'modo') {
          const currentMode = store.state.settings.modo || 'premium';
          const nextMode = currentMode === 'free' ? 'premium' : 'free';
          store.setSettings({ modo: nextMode });
          const isFree = nextMode === 'free';
          sw.classList.toggle('is-on', isFree);
          sw.setAttribute('aria-checked', String(isFree));
          toast(isFree ? 'Modo FREE activado' : 'Modo PREMIUM activado', 'ok', 1500);
          return;
        }
        if (key === 'parentalEnabled') {
          const isCurrentlyEnabled = !!store.state.settings.parental?.enabled;
          if (isCurrentlyEnabled) {
            showPinModal({
              title: 'Desactivar Control Parental',
              subtitle: 'Ingresa tu PIN actual para desactivar',
              onSuccess: () => {
                store.updateParental({ enabled: false });
                toast('Control Parental desactivado', 'warn', 2000);
                this.paint();
                Focus.attach(this.root);
              },
            }).catch(() => {});
          } else {
            const hasCustomPin = store.state.settings.parental?.pin && store.state.settings.parental.pin !== '0000';
            if (!hasCustomPin) {
              showPinModal({
                mode: 'set',
                title: 'Crear PIN de Control Parental',
                subtitle: 'Ingresa 4 dígitos numéricos',
                onSuccess: (newPin) => {
                  store.updateParental({ enabled: true, pin: newPin });
                  toast('Control Parental activado', 'ok', 2500);
                  this.paint();
                  Focus.attach(this.root);
                },
              }).catch(() => {});
            } else {
              showPinModal({
                title: 'Activar Control Parental',
                subtitle: 'Ingresa tu PIN de 4 dígitos',
                onSuccess: () => {
                  store.updateParental({ enabled: true });
                  toast('Control Parental activado', 'ok', 2500);
                  this.paint();
                  Focus.attach(this.root);
                },
              }).catch(() => {});
            }
          }
          return;
        }
        const next = !store.state.settings[key];
        store.setSettings({ [key]: next });
        sw.classList.toggle('is-on', next);
        sw.setAttribute('aria-checked', String(next));
        return;
      }

      const action = event.target.closest('[data-action]');
      if (!action) return;
      const name = action.dataset.action;

      if (name === 'legal-terms') {
        openLegalModal('terms');
        return;
      }

      if (name === 'legal-privacy') {
        openLegalModal('privacy');
        return;
      }

      if (name === 'refresh') {
        toast('Actualizando catalogo...', 'info');
        try {
          await refreshCatalog(store.state.profile, { onProgress: () => {} });
          toast('Catalogo actualizado', 'ok');
        } catch (err) {
          toast(err?.message || 'No se pudo actualizar', 'error');
        }
        return;
      }

      if (name === 'cast') {
        const onWifi = isWifiConnected();
        if (!onWifi) {
          toast('Tip: Conecta tu móvil a la red Wi-Fi de tu Smart TV para transmitir', 'info', 3000);
        }
        const opened = openCastSettings();
        if (opened) {
          toast('Abriendo opciones de transmisión de pantalla...', 'ok', 2000);
        } else {
          toast('Opciones de transmisión no disponibles en este móvil', 'error', 2500);
        }
        return;
      }

      if (name === 'logout') {
        const yes = await confirmDialog({
          title: 'Cerrar sesion',
          message: 'Se eliminaran el perfil, los favoritos y el progreso guardado en este dispositivo. El catalogo tambien se borrara.',
          confirmText: 'Cerrar sesion',
          danger: true,
        });
        if (!yes) return;
        const id = store.state.profile?.id;
        Player.stop({ silent: true });
        if (id) await clearCatalog(id);
        store.state.favorites = {};
        store.state.progress = {};
        store.resetProfile();
        navigate('/login', {}, { replace: true });
        return;
      }

      if (name === 'clear-cache') {
        const yes = await confirmDialog({
          title: 'Limpiar cache',
          message: 'Se borrara el catalogo guardado. La proxima carga se hara desde el servidor.',
          confirmText: 'Limpiar',
          danger: true,
        });
        if (!yes) return;
        const id = store.state.profile?.id;
        if (id) await clearCatalog(id);
        store.state.catalogs = { live: [], movies: [], series: [] };
        store.state.categories = { live: [], movies: [], series: [] };
        store.state.counts = { live: 0, movies: 0, series: 0 };
        store.state.catalogUpdatedAt = 0;
        store.emit();
        toast('Cache eliminada', 'ok');
        navigate('/home');
        return;
      }

      if (name === 'test-hw') {
        const hw = this.hw || (await Player.evaluateHardware(true));
        const players = Array.isArray(hw?.installedPlayers) && hw.installedPlayers.length > 0
          ? hw.installedPlayers.map((p) => `• ${escapeHtml(p.name)} (${escapeHtml(p.packageName)})`).join('\n')
          : 'Ninguno detectado';

        modal({
          title: 'Diagnostico de Hardware y Codecs',
          wide: true,
          body: `
            <div style="font-size:.85rem;line-height:1.6;color:var(--text-1)">
              <p><b>Dispositivo:</b> ${escapeHtml(hw?.manufacturer || '')} ${escapeHtml(hw?.model || '')} (Android API ${hw?.sdkInt || '?'})</p>
              <p><b>Arquitectura CPU:</b> ${escapeHtml(hw?.primaryAbi || 'Desconocida')} ${hw?.isX86 ? '<b>(x86/PC)</b>' : '(ARM)'}</p>
              <p><b>Aceleracion H.264 por HW:</b> <span class="${hw?.hasH264Hardware ? 'ok' : 'warn'}">${hw?.hasH264Hardware ? 'SOPORTADA' : 'NO DISPONIBLE / SOFTWARE ONLY'}</span></p>
              <p><b>Salida Surface de Video:</b> <span class="${hw?.hasH264Surface ? 'ok' : 'warn'}">${hw?.hasH264Surface ? 'DIRECTA' : 'LIMITADA / YUV ONLY'}</span></p>
              <p><b>Diagnostico:</b> <span class="${hw?.isHardwareLimited ? 'warn' : 'ok'}">${escapeHtml(hw?.statusDetail || '')}</span></p>
              <p><b>Motor Recomendado:</b> <b>${hw?.recommendedEngine === 'external' ? 'Reproductor Externo (VLC)' : 'ExoPlayer nativo'}</b></p>
              <div style="margin-top:10px;padding:10px;background:#0d111a;border-radius:8px">
                <b>Reproductores externos detectados:</b>
                <pre style="margin-top:4px;white-space:pre-wrap;font-family:var(--mono);font-size:.75rem;color:var(--text-2)">${players}</pre>
              </div>
            </div>
          `,
          footer: `<button class="btn btn--primary" data-focusable data-modal-close>Entendido</button>`,
        });
        return;
      }

      if (name === 'logs') {
        const logs = Logger.recent().slice(-120).join('\n') || 'Sin registros.';
        const m = modal({
          title: 'Logs de la app',
          wide: true,
          body: `<pre style="max-height:52vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:var(--mono);font-size:.72rem;line-height:1.5;color:var(--text-2);background:#08080f;border:1px solid var(--line);border-radius:10px;padding:14px">${escapeHtml(logs)}</pre>`,
          footer: `<button class="btn btn--ghost" data-focusable data-clear-logs>Borrar</button>
                   <button class="btn btn--primary" data-focusable data-close-logs>Cerrar</button>`,
        });
        m?.root.querySelector('[data-clear-logs]')?.addEventListener('click', () => {
          Logger.clear();
          toast('Logs borrados', 'ok');
          m.close();
        });
        m?.root.querySelector('[data-close-logs]')?.addEventListener('click', () => m.close());
      }

      if (name === 'change-pin') {
        showPinModal({
          title: 'Validar PIN Actual',
          subtitle: 'Ingresa tu PIN actual para continuar',
          onSuccess: () => {
            showPinModal({
              mode: 'set',
              title: 'Nuevo PIN de Seguridad',
              subtitle: 'Ingresa los nuevos 4 dígitos',
              onSuccess: (newPin) => {
                store.updateParental({ pin: newPin });
                toast('PIN cambiado correctamente', 'ok', 2500);
                this.paint();
                Focus.attach(this.root);
              },
            }).catch(() => {});
          },
        }).catch(() => {});
        return;
      }

      if (name === 'manage-cats') {
        openManageCategoriesModal();
        return;
      }
    });

    this.listen(this.root, 'change', (event) => {
      const pMode = event.target.closest('[data-parental-mode]');
      if (pMode) {
        store.updateParental({ mode: pMode.value });
        toast(pMode.value === 'hide' ? 'Modo Seguro activado (Adultos ocultos)' : 'Contenido bloqueado con candado 🔒', 'ok', 2500);
        return;
      }
      const pTimeout = event.target.closest('[data-parental-timeout]');
      if (pTimeout) {
        store.updateParental({ sessionTimeout: Number(pTimeout.value) });
        toast('Tiempo de desbloqueo actualizado', 'ok');
        return;
      }
      const engine = event.target.closest('[data-engine]');
      if (engine) {
        store.setSettings({ engine: engine.value });
        const labels = {
          auto: 'Motor automático seleccionado',
          native: 'Motor nativo ExoPlayer seleccionado',
          external: 'Reproductor Externo (VLC) seleccionado',
          web: 'Motor web seleccionado',
        };
        toast(labels[engine.value] || 'Motor actualizado', 'ok');
        return;
      }
      const extPlayer = event.target.closest('[data-external-player]');
      if (extPlayer) {
        store.setSettings({ externalPlayer: extPlayer.value });
        toast('Reproductor externo actualizado', 'ok');
        return;
      }
      const buffer = event.target.closest('[data-buffer]');
      if (buffer) {
        store.setSettings({ buffer: Number(buffer.value) });
        toast(`Buffer: ${buffer.value} s`, 'ok');
      }
    });
  },

  listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.handlers.push(() => {
      try { target.removeEventListener(type, fn, opts); } catch (_) {}
    });
  },

  onBack() {
    return false;
  },

  unmount() {
    for (const off of this.handlers || []) {
      try { off(); } catch (_) {}
    }
    this.handlers = [];
    this.rootBound = false;
  },
};

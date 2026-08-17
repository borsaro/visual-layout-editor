/** Live agent bridge: receives patches over SSE and publishes editor state back. */

const LIVE_STATE_DEBOUNCE_MS = 400;
const LIVE_ALLOWED_KEYS = new Set([
  'name', 'x', 'y', 'w', 'h', 'z', 'opacity', 'rotation', 'skewX', 'skewY',
  'blendMode', 'visible', 'locked', 'shadow', 'glow',
  'src', 'fit', 'crop', 'adjust', 'keyBlack',
  'text', 'fontSize', 'fontWeight', 'fontFamily', 'fontStyle', 'color',
  'align', 'vAlign', 'lineHeight', 'letterSpacing', 'textTransform',
  'underline', 'strikethrough',
  'fill', 'stroke', 'strokeWidth', 'radius',
  'shapeKind', 'sides', 'corner', 'fillEnabled', 'points',
  'gradientType', 'angle', 'stops',
]);

let liveSource = null;
let liveStateTimer = null;
let pendingLiveOps = [];

function liveClientId() {
  const key = 'robyLiveClientId';
  try {
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = 'c_' + Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch (_) {
    return 'c_' + Math.random().toString(36).slice(2, 12);
  }
}

function liveNormPath(p) {
  if (!p) return '';
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Drop ops aimed at another tab or another open layout. */
function liveOpsForMe(msg) {
  if (msg.client && msg.client !== liveClientId()) return false;
  if (!msg.path) return true;
  const mine = liveNormPath(state.currentLayoutPath);
  if (!mine) return false;
  return liveNormPath(msg.path) === mine;
}

function liveIsBusy() {
  return !!(typeof drag !== 'undefined' && drag) || !!(typeof vertexDrag !== 'undefined' && vertexDrag);
}

function findLiveTarget(ref) {
  if (ref.id) {
    const byId = state.layers.find((l) => l.id === ref.id);
    if (byId) return byId;
  }
  if (ref.name) {
    const named = state.layers.filter((l) => l.name === ref.name);
    if (named.length === 1) return named[0];
    if (named.length > 1) throw new Error(`Più layer chiamati "${ref.name}": usa l'id`);
  }
  return null;
}

function applyLivePatch(patch) {
  const layer = findLiveTarget(patch);
  if (!layer) return { id: patch.id || patch.name, error: 'layer non trovato' };
  const applied = {};
  Object.entries(patch).forEach(([key, value]) => {
    if (key === 'id' || key === 'name' && !patch.id) return;
    if (!LIVE_ALLOWED_KEYS.has(key)) return;
    layer[key] = value;
    applied[key] = value;
  });
  return { id: layer.id, applied };
}

function applyLiveOps(msg) {
  pushHistory();
  const results = { patched: [], added: [], removed: [] };

  (msg.remove || []).forEach((id) => {
    const before = state.layers.length;
    state.layers = state.layers.filter((l) => l.id !== id);
    if (state.layers.length < before) results.removed.push(id);
  });

  (msg.add || []).forEach((raw) => {
    const layer = { ...raw };
    if (!layer.id) layer.id = uid();
    if (layer.z == null) layer.z = nextZ();
    state.layers.push(layer);
    results.added.push(layer.id);
  });

  (msg.patches || []).forEach((patch) => results.patched.push(applyLivePatch(patch)));

  state.selectedIds = state.selectedIds.filter((id) => state.layers.some((l) => l.id === id));
  state.selectedId = state.selectedIds.at(-1) || null;
  markDirty();
  render();
  flashLiveLayers([...results.patched.map((p) => p.id), ...results.added]);
  showLiveActivity(`agente: ${msg.label || 'patch'} · ${results.patched.length + results.added.length + results.removed.length} layer`);
  showToast?.(`Agente: ${results.patched.length} modificati, ${results.added.length} aggiunti, ${results.removed.length} rimossi — Cmd+Z per annullare`);
  if (msg.autosave !== false) autoSaveAfterLive();
  return results;
}

/** Agent edits persist only when the layout has a server path; local files stay dirty. */
async function autoSaveAfterLive() {
  if (!state.currentLayoutPath) return;
  try {
    const res = await fetch('/api/save-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Tagged with this tab's id: the server skips it when announcing the write, so
      // the editor does not reload the file it just wrote itself.
      body: JSON.stringify({ path: state.currentLayoutPath, layout: layoutPayload(), client: liveClientId() }),
    });
    const data = await res.json();
    if (data.ok) {
      clearDirty();
      render();
    }
  } catch (_) { /* offline server: keep the change in the session */ }
}

function flushPendingLiveOps() {
  if (!pendingLiveOps.length || liveIsBusy()) return;
  const queued = pendingLiveOps;
  pendingLiveOps = [];
  queued.filter(liveOpsForMe).forEach(applyLiveOps);
}

function publishLiveState() {
  if (!liveSource || liveSource.readyState !== EventSource.OPEN) return;
  clearTimeout(liveStateTimer);
  liveStateTimer = setTimeout(() => {
    fetch('/api/live/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: liveClientId(),
        path: state.currentLayoutPath,
        canvas: state.canvas,
        layers: state.layers,
        selectedIds: state.selectedIds,
        dirty: state.dirty,
      }),
    }).catch(() => { /* server not reachable */ });
  }, LIVE_STATE_DEBOUNCE_MS);
}

/* ------------------------------------------------- seeing the agent at work */

/**
 * Outline the layers an agent just touched for a moment. Without it a live edit is a
 * silent jump: you see the new state but not what moved, which is exactly the part
 * worth watching while the model works.
 */
function flashLiveLayers(ids) {
  const wanted = [...new Set((ids || []).filter(Boolean))];
  if (!wanted.length) return;
  requestAnimationFrame(() => {
    wanted.forEach((id) => {
      const el = document.querySelector(`.layer[data-id="${CSS.escape(String(id))}"]`);
      if (!el) return;
      el.classList.remove('liveTouched');
      void el.offsetWidth;            // restart the animation on a repeated hit
      el.classList.add('liveTouched');
      setTimeout(() => el.classList.remove('liveTouched'), 1400);
    });
  });
}

let liveActivityTimer = null;
/** Small badge in the toolbar: lit while the agent is writing, with what it did. */
function showLiveActivity(text) {
  const el = $('liveActivity');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  el.classList.add('isBusy');
  clearTimeout(liveActivityTimer);
  liveActivityTimer = setTimeout(() => {
    el.classList.remove('isBusy');
    el.hidden = true;
  }, 4000);
}

function changedLayerIds(before, after) {
  const was = new Map((before || []).map((l) => [l.id, JSON.stringify(l)]));
  const now = new Map((after || []).map((l) => [l.id, JSON.stringify(l)]));
  const ids = [];
  now.forEach((json, id) => { if (was.get(id) !== json) ids.push(id); });
  return ids;
}

/**
 * A tool wrote the layout file: pull it back in without touching zoom or selection,
 * so the canvas follows the agent edit by edit. Local unsaved work is never
 * overwritten — that would silently destroy the user's own edits.
 */
async function applyLiveFileChange(msg) {
  const label = msg.label || 'agente';
  if (msg.action === 'variants') {
    showLiveActivity(`agente: ${label}`);
    await loadVariants?.();
    return;
  }
  if (state.dirty) {
    showLiveActivity(`agente: ${label} (su disco)`);
    showToast?.(`L'agente ha scritto il file (${label}), ma hai modifiche non salvate: usa Ricarica per prenderle.`);
    return;
  }
  try {
    const { layout } = await fetchLayoutFromPath(state.currentLayoutPath);
    const before = state.layers;
    state.canvas = layout.canvas || state.canvas;
    state.layers = layout.layers || [];
    state.selectedIds = state.selectedIds.filter((id) => state.layers.some((l) => l.id === id));
    state.selectedId = state.selectedIds.at(-1) || null;
    clearDirty();
    syncCanvasInputs?.();
    render();
    const touched = msg.ids?.length ? msg.ids : changedLayerIds(before, state.layers);
    flashLiveLayers(touched);
    showLiveActivity(`agente: ${label}${touched.length ? ` · ${touched.length} layer` : ''}`);
    publishLiveState();
  } catch (e) {
    showToast?.('Modifica dell’agente non ricaricata: ' + (e.message || e));
  }
}

function initLiveBridge() {
  if (liveSource || typeof EventSource === 'undefined') return;
  liveSource = new EventSource('/api/live/stream?client=' + encodeURIComponent(liveClientId()));
  liveSource.addEventListener('patch', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (!liveOpsForMe(msg)) return;
    // A drag in progress would fight the incoming edit; apply it on mouseup instead.
    if (liveIsBusy()) {
      pendingLiveOps.push(msg);
      document.addEventListener('mouseup', flushPendingLiveOps, { once: true });
      return;
    }
    applyLiveOps(msg);
    publishLiveState();
  });
  // A file written by a tool, not a live patch: same idea, but the truth is on disk.
  liveSource.addEventListener('file', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (!msg.path || liveNormPath(msg.path) !== liveNormPath(state.currentLayoutPath)) return;
    if (liveIsBusy()) {
      document.addEventListener('mouseup', () => applyLiveFileChange(msg), { once: true });
      return;
    }
    applyLiveFileChange(msg);
  });
  liveSource.addEventListener('hello', () => publishLiveState());
  liveSource.onerror = () => { /* EventSource reconnects on its own */ };
}

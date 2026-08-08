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
      body: JSON.stringify({ path: state.currentLayoutPath, layout: layoutPayload() }),
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
  queued.forEach(applyLiveOps);
}

function publishLiveState() {
  clearTimeout(liveStateTimer);
  liveStateTimer = setTimeout(() => {
    fetch('/api/live/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: state.currentLayoutPath,
        canvas: state.canvas,
        layers: state.layers,
        selectedIds: state.selectedIds,
        dirty: state.dirty,
      }),
    }).catch(() => { /* server not reachable */ });
  }, LIVE_STATE_DEBOUNCE_MS);
}

function initLiveBridge() {
  if (liveSource || typeof EventSource === 'undefined') return;
  liveSource = new EventSource('/api/live/stream');
  liveSource.addEventListener('patch', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    // A drag in progress would fight the incoming edit; apply it on mouseup instead.
    if (liveIsBusy()) {
      pendingLiveOps.push(msg);
      document.addEventListener('mouseup', flushPendingLiveOps, { once: true });
      return;
    }
    applyLiveOps(msg);
    publishLiveState();
  });
  liveSource.addEventListener('hello', () => publishLiveState());
  liveSource.onerror = () => { /* EventSource reconnects on its own */ };
  publishLiveState();
}

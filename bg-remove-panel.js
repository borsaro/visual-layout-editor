/**
 * Inspector wiring for background removal on image layers.
 *
 * The heavy lifting happens server-side (scripts/bg_remove.py): here we only pick the
 * model, call the endpoint and repoint the layer at the cutout. Two facts shape the
 * UX: inference is CPU-bound (seconds per image), and the first use of a model
 * downloads its weights (up to ~1 GB) — so the button must show progress, survive
 * long waits, and say when a download is about to happen.
 */

const BG_REMOVE_STATE = {
  catalog: null,     // /api/bg-models payload
  running: false,
};

async function loadBgModels() {
  try {
    const res = await fetch('/api/bg-models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'bg-models failed');
    BG_REMOVE_STATE.catalog = data;
  } catch (e) {
    BG_REMOVE_STATE.catalog = null;
  }
  syncBgModelSelect();
}

function syncBgModelSelect() {
  const sel = $('propBgModel');
  if (!sel) return;
  const cat = BG_REMOVE_STATE.catalog;
  sel.innerHTML = '';
  if (!cat) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'server non raggiungibile';
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  cat.models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    // The download size is part of the choice: 927 MB on first use is not a detail.
    opt.textContent = `${m.label} — ${m.best_for}` + (m.downloaded ? '' : ` (scarica ${m.size_mb} MB)`);
    opt.title = m.desc;
    if (m.id === cat.default) opt.selected = true;
    sel.appendChild(opt);
  });
}

function bgRemoveTargetLayer() {
  const l = selected();
  if (!l || l.type !== 'image') return null;
  return l;
}

/** Only path-based sources can be cut out server-side; base64 lives nowhere on disk. */
function bgRemoveSourcePath(layer) {
  const src = String(layer?.src || '');
  if (!src || isEmbeddedSrc(src) || src.startsWith('http')) return null;
  return src.split('?')[0];
}

async function runBgRemove() {
  if (BG_REMOVE_STATE.running) return;
  const layer = bgRemoveTargetLayer();
  if (!layer) return;
  const path = bgRemoveSourcePath(layer);
  const hint = $('bgRemoveHint');
  if (!path) {
    showToast('Questo layer usa una sorgente incorporata (base64): serve un path su disco');
    if (hint) hint.textContent = 'Sorgente base64: salva prima l’immagine come file (path) per poterla scontornare.';
    return;
  }
  const btn = $('propBgRemoveBtn');
  const model = $('propBgModel')?.value || undefined;
  const modelMeta = BG_REMOVE_STATE.catalog?.models?.find((m) => m.id === model);
  const needsDownload = modelMeta && !modelMeta.downloaded;

  BG_REMOVE_STATE.running = true;
  if (btn) { btn.disabled = true; btn.textContent = needsDownload ? `Scarico il modello (${modelMeta.size_mb} MB)…` : 'Scontorno…'; }
  if (hint) hint.textContent = needsDownload
    ? 'Primo uso di questo modello: il download può richiedere qualche minuto.'
    : 'Elaborazione in corso: su immagini grandi può volerci qualche decina di secondi.';
  try {
    const res = await fetch('/api/remove-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, model }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'remove-background failed');

    pushHistory();
    layer.src = data.src;
    markDirty();
    render();
    if (hint) hint.textContent = `Fatto: ${data.path}`;
    showToast('Sfondo rimosso → ' + data.path);
    loadBgModels();   // "downloaded" just changed for this model
  } catch (e) {
    if (hint) hint.textContent = 'Errore: ' + (e.message || e);
    showToast('Scontorno fallito: ' + (e.message || e));
  } finally {
    BG_REMOVE_STATE.running = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Rimuovi sfondo'; }
  }
}

function bindBgRemove() {
  $('propBgRemoveBtn')?.addEventListener('click', runBgRemove);
  loadBgModels();
}

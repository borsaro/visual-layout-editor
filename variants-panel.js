/**
 * Variants bar: the open layout plus its alternative versions, edited as one project.
 *
 * The mental model is a project, not a file. You move between the base and its
 * variants, edit any of them, and one "Salva Json" writes everything back where it
 * belongs: the base into the .layout.json, the variants into the sidecar. Switching
 * away from something you edited never discards it — the edit is held as a draft
 * until the save.
 *
 * A variant is stored as ops over the base, so editing the base afterwards still
 * propagates: the ops are field-level overrides, not a frozen copy.
 */

const VARIANTS_STATE = {
  payload: null,       // last /api/variants response
  activeId: null,      // what is on the canvas, null = base
  baseLayers: null,    // the base as it exists on disk
  draftBase: null,     // base with unsaved edits, null when clean
  draftOps: new Map(), // variantId -> unsaved ops
  newIds: new Set(),   // created here, not on disk yet: always pending until saved
  checked: new Set(),  // ticked for bulk delete; independent of what is on canvas
  anchorId: null,      // last plainly-clicked card, for shift+click ranges
};

function variantsBarEl() { return $('variantsBar'); }

function variantsApplicableFields() {
  return state.patchableFields && state.patchableFields.length
    ? new Set(state.patchableFields)
    : null; // health unavailable: apply everything rather than silently dropping fields
}

/** The base as it would be saved right now: drafts included. */
function currentBaseLayers() {
  return VARIANTS_STATE.draftBase || VARIANTS_STATE.baseLayers || state.layers;
}

function storedOpsOf(id) {
  const v = (VARIANTS_STATE.payload?.variants || []).find((x) => x.id === id);
  return v ? v.ops : { patches: [], add: [], remove: [] };
}

/** Draft first, then what is on disk. */
function effectiveOpsOf(id) {
  return VARIANTS_STATE.draftOps.has(id) ? VARIANTS_STATE.draftOps.get(id) : storedOpsOf(id);
}

function variantsHaveUnsavedWork() {
  return !!VARIANTS_STATE.draftBase || VARIANTS_STATE.draftOps.size > 0 || VARIANTS_STATE.newIds.size > 0;
}

/** Pending = edited since the last save, or never written at all. */
function variantIsPending(id) {
  return VARIANTS_STATE.draftOps.has(id) || VARIANTS_STATE.newIds.has(id);
}

/* --------------------------------------------------------------- ops <-> canvas */

/** Client-side twin of variants.apply_variant: remove, then patch, then add. */
function applyVariantOps(baseLayers, ops) {
  const layers = JSON.parse(JSON.stringify(baseLayers || []));
  const o = ops || {};

  const remove = new Set(o.remove || []);
  let out = remove.size ? layers.filter((l) => !remove.has(l.id)) : layers;

  const allowed = variantsApplicableFields();
  (o.patches || []).forEach((patch) => {
    const target = patch.id
      ? out.find((l) => l.id === patch.id)
      : out.filter((l) => l.name === patch.name).length === 1
        ? out.find((l) => l.name === patch.name)
        : null;
    if (!target) return;
    Object.entries(patch).forEach(([key, value]) => {
      if (key === 'id' || key === 'type') return;
      if (allowed && !allowed.has(key)) return;
      target[key] = JSON.parse(JSON.stringify(value));
    });
  });

  (o.add || []).forEach((layer) => {
    const clone = JSON.parse(JSON.stringify(layer));
    out = out.filter((l) => l.id !== clone.id);
    out.push(clone);
  });
  return out;
}

/**
 * Canvas -> ops, the inverse of applyVariantOps.
 * Only patchable fields are compared, so a diff cannot contain something the server
 * would drop on write, leaving the editor showing a variant nobody can save.
 */
function diffLayersToOps(baseLayers, currentLayers) {
  const base = new Map((baseLayers || []).map((l) => [l.id, l]));
  const current = new Map((currentLayers || []).map((l) => [l.id, l]));
  const allowed = variantsApplicableFields();
  const fieldsOf = (layer) => Object.keys(layer).filter((k) => k !== 'id' && k !== 'type'
    && (!allowed || allowed.has(k)));

  const remove = [...base.keys()].filter((id) => !current.has(id));
  const add = [...current.values()].filter((l) => !base.has(l.id)).map((l) => JSON.parse(JSON.stringify(l)));

  const patches = [];
  current.forEach((layer, id) => {
    const before = base.get(id);
    if (!before) return;
    const patch = {};
    new Set([...fieldsOf(before), ...fieldsOf(layer)]).forEach((key) => {
      if (JSON.stringify(before[key] ?? null) !== JSON.stringify(layer[key] ?? null)) {
        patch[key] = layer[key] ?? null;
      }
    });
    if (Object.keys(patch).length) patches.push({ id, ...patch });
  });
  return { patches, add, remove };
}

function normalizeOpsForCompare(ops) {
  const o = ops || {};
  const sortById = (list) => [...(list || [])]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((p) => Object.fromEntries(Object.entries(p).sort(([a], [b]) => a.localeCompare(b))));
  return { patches: sortById(o.patches), add: sortById(o.add), remove: [...(o.remove || [])].sort() };
}

function sameOps(a, b) {
  return JSON.stringify(normalizeOpsForCompare(a)) === JSON.stringify(normalizeOpsForCompare(b));
}

/**
 * Fold whatever is on the canvas into the draft for whatever is selected.
 * Called before every switch and before saving, so no edit is ever dropped.
 */
function captureCanvasIntoDraft() {
  if (!VARIANTS_STATE.baseLayers) return;
  if (VARIANTS_STATE.activeId) {
    const ops = diffLayersToOps(currentBaseLayers(), state.layers);
    if (sameOps(ops, storedOpsOf(VARIANTS_STATE.activeId)) && !VARIANTS_STATE.newIds.has(VARIANTS_STATE.activeId)) {
      VARIANTS_STATE.draftOps.delete(VARIANTS_STATE.activeId);
    } else {
      VARIANTS_STATE.draftOps.set(VARIANTS_STATE.activeId, ops);
    }
    return;
  }
  const changed = JSON.stringify(state.layers) !== JSON.stringify(VARIANTS_STATE.baseLayers);
  VARIANTS_STATE.draftBase = changed ? JSON.parse(JSON.stringify(state.layers)) : null;
}

/* ------------------------------------------------------------------- loading */

async function loadVariants({ quiet = true } = {}) {
  const path = state.currentLayoutPath;
  if (!path) {
    VARIANTS_STATE.payload = null;
    renderVariantsBar();
    return;
  }
  try {
    const res = await fetch('/api/variants?path=' + encodeURIComponent(path), { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'variants failed');
    VARIANTS_STATE.payload = data;
    if (VARIANTS_STATE.activeId && !(data.variants || []).some((v) => v.id === VARIANTS_STATE.activeId)) {
      VARIANTS_STATE.activeId = null;
    }
  } catch (e) {
    VARIANTS_STATE.payload = null;
    if (!quiet) showToast('Varianti non caricate: ' + (e.message || e));
  } finally {
    renderVariantsBar();
  }
}

/* ---------------------------------------------------------------------- view */

/**
 * Selection-only refresh. Kept apart from renderVariantsBar because rebuilding the
 * list recreates every <img>, and thumbnails are served no-store: every click would
 * refetch them and the strip would flicker.
 */
function syncVariantsSelectionUi() {
  const activeId = VARIANTS_STATE.activeId;
  const variants = VARIANTS_STATE.payload?.variants || [];

  // What is on the canvas right now counts as a draft even before the next switch.
  const liveEdited = VARIANTS_STATE.baseLayers && (activeId
    ? !sameOps(diffLayersToOps(currentBaseLayers(), state.layers), storedOpsOf(activeId))
    : JSON.stringify(state.layers) !== JSON.stringify(VARIANTS_STATE.baseLayers));

  document.querySelectorAll('.variantCard').forEach((card) => {
    const id = card.dataset.id;
    const isActive = id === activeId;
    card.classList.toggle('isActive', isActive);
    card.classList.toggle('isChecked', VARIANTS_STATE.checked.has(id));
    card.classList.toggle('hasEdits', (isActive && !!liveEdited) || variantIsPending(id));
  });

  const baseBtn = $('variantsBaseBtn');
  if (baseBtn) {
    baseBtn.classList.toggle('variantActive', !activeId);
    const baseDirty = activeId ? !!VARIANTS_STATE.draftBase : !!liveEdited;
    baseBtn.textContent = baseDirty ? 'Base •' : 'Base';
  }
  const promote = $('variantsPromoteBtn');
  if (promote) promote.disabled = !activeId;
  const del = $('variantsDeleteBtn');
  if (del) {
    const n = VARIANTS_STATE.checked.size;
    del.disabled = !n;
    del.textContent = n > 1 ? `Elimina (${n})` : 'Elimina';
  }
  const empty = $('variantsEmpty');
  if (empty) empty.hidden = variants.length > 0;

  const hint = $('variantsHint');
  if (hint) {
    const pendingIds = new Set([...VARIANTS_STATE.draftOps.keys(), ...VARIANTS_STATE.newIds]);
    if (liveEdited && activeId) pendingIds.add(activeId);
    const pending = pendingIds.size + ((VARIANTS_STATE.draftBase || (liveEdited && !activeId)) ? 1 : 0);
    if (pending) {
      hint.textContent = `${pending} da salvare — "Salva Json" scrive base e varianti insieme.`;
    } else if (VARIANTS_STATE.payload?.baseChanged) {
      hint.textContent = 'Il layout base è cambiato: le varianti segnate potrebbero non applicarsi più.';
    } else {
      hint.textContent = 'Click applica · Cmd+click e Shift+click selezionano per l’eliminazione.';
    }
  }
}

function renderVariantsBar() {
  const bar = variantsBarEl();
  if (!bar) return;
  const variants = VARIANTS_STATE.payload?.variants || [];

  const count = $('variantsCount');
  if (count) count.textContent = String(variants.length);
  const stale = $('variantsStale');
  if (stale) stale.hidden = !VARIANTS_STATE.payload?.baseChanged;

  const list = $('variantsList');
  if (list) {
    list.innerHTML = '';
    // Cards are built only while the bar is open: building them collapsed would put
    // every <img> in a display:none subtree, where the fetch never starts and the
    // thumbnails stay blank after opening.
    if (!bar.classList.contains('isCollapsed')) {
      variants.forEach((variant) => list.appendChild(variantCard(variant)));
    }
  }
  syncVariantsSelectionUi();
}

function variantCard(variant) {
  const card = document.createElement('div');
  card.className = 'variantCard' + (variant.stale ? ' isStale' : '');
  card.dataset.id = variant.id;
  card.title = variant.stale
    ? `Layer mancanti: ${(variant.missingLayers || []).join(', ')}`
    : (variant.note || variant.label || variant.id);

  const path = state.currentLayoutPath || '';
  const img = document.createElement('img');
  img.className = 'variantThumb';
  img.alt = variant.label || variant.id;
  img.src = `/api/variant-thumb?path=${encodeURIComponent(path)}&id=${encodeURIComponent(variant.id)}`;
  img.onerror = () => {
    const ph = document.createElement('div');
    ph.className = 'variantThumbMissing';
    ph.textContent = 'senza anteprima';
    img.replaceWith(ph);
  };
  card.appendChild(img);

  const label = document.createElement('div');
  label.className = 'variantLabel';
  label.textContent = variant.label || variant.id;
  card.appendChild(label);

  if (variant.axes?.length) {
    const axes = document.createElement('div');
    axes.className = 'variantAxes';
    axes.textContent = variant.axes.join(' · ');
    card.appendChild(axes);
  }
  if (variant.stale || variant.promoted) {
    const badge = document.createElement('span');
    badge.className = 'variantBadge' + (variant.promoted && !variant.stale ? ' isPromoted' : '');
    badge.textContent = variant.stale ? 'stantia' : 'promossa';
    card.appendChild(badge);
  }

  card.addEventListener('click', (ev) => selectVariant(variant.id, ev));
  return card;
}

/* ----------------------------------------------------------------- selection */

/** Cmd/Ctrl+click ticks one card, Shift+click ticks a range. Neither touches the canvas. */
function toggleVariantChecked(id, ev) {
  const ids = (VARIANTS_STATE.payload?.variants || []).map((v) => v.id);
  if (ev.shiftKey && VARIANTS_STATE.anchorId && ids.includes(VARIANTS_STATE.anchorId)) {
    const from = ids.indexOf(VARIANTS_STATE.anchorId);
    const to = ids.indexOf(id);
    ids.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((x) => VARIANTS_STATE.checked.add(x));
  } else if (VARIANTS_STATE.checked.has(id)) {
    VARIANTS_STATE.checked.delete(id);
  } else {
    VARIANTS_STATE.checked.add(id);
    VARIANTS_STATE.anchorId = id;
  }
  syncVariantsSelectionUi();
}

function showVariantOnCanvas(id) {
  const layers = id
    ? applyVariantOps(currentBaseLayers(), effectiveOpsOf(id))
    : JSON.parse(JSON.stringify(currentBaseLayers()));
  pushHistory();
  state.layers = layers;
  VARIANTS_STATE.activeId = id;
  state.selectedId = null;
  state.selectedIds = [];
  render();
  syncVariantsSelectionUi();
}

function selectVariant(id, ev) {
  if (ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey)) {
    toggleVariantChecked(id, ev);
    return;
  }
  const variant = (VARIANTS_STATE.payload?.variants || []).find((v) => v.id === id);
  if (!variant) return;
  if (variant.stale) {
    showToast(`Variante stantia: manca ${(variant.missingLayers || []).join(', ')}`);
    return;
  }
  // Reset the selection first, and for the already-applied card too: a plain click is
  // what sets the anchor a later shift+click extends from.
  VARIANTS_STATE.checked = new Set([id]);
  VARIANTS_STATE.anchorId = id;
  if (id === VARIANTS_STATE.activeId) {
    syncVariantsSelectionUi();
    return;
  }
  captureCanvasIntoDraft();   // nothing is lost by switching
  showVariantOnCanvas(id);
}

function restoreVariantBase() {
  if (!VARIANTS_STATE.activeId) return;
  captureCanvasIntoDraft();
  VARIANTS_STATE.checked = new Set();
  showVariantOnCanvas(null);
}

/* -------------------------------------------------------------- create / save */

function nextVariantId() {
  const taken = new Set((VARIANTS_STATE.payload?.variants || []).map((v) => v.id));
  for (let i = 1; i < 1000; i += 1) {
    const id = `v${String(i).padStart(2, '0')}`;
    if (!taken.has(id)) return id;
  }
  return `v${Date.now()}`;
}

/** One entry point for writing the set, so every write goes through the same validation. */
async function writeVariants(variants, { thumbnails = true, path = null } = {}) {
  const target = path || state.currentLayoutPath;
  if (!target) throw new Error('Nessun layout su disco: salva prima il layout');
  const res = await fetch('/api/variants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: target, variants, replace: true, thumbnails }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'save variants failed');
  return data;
}

/**
 * New variant = duplicate of what is on screen. Straight off the untouched base its
 * ops are empty and it renders identically; you then edit it and save.
 */
async function createVariantFromCanvas() {
  if (!state.currentLayoutPath) {
    showToast('Salva prima il layout su disco: le varianti gli stanno accanto');
    return;
  }
  const suggested = `Variante ${(VARIANTS_STATE.payload?.variants || []).length + 1}`;
  const label = prompt('Nome della variante:', suggested);
  if (label === null) return;

  captureCanvasIntoDraft();
  const id = nextVariantId();
  const ops = diffLayersToOps(currentBaseLayers(), state.layers);
  const entry = { id, label: label || id, axes: ['manuale'], ops, stale: false, missingLayers: [] };
  const existing = VARIANTS_STATE.payload?.variants || [];

  VARIANTS_STATE.payload = { ...(VARIANTS_STATE.payload || {}), variants: [...existing, entry] };
  VARIANTS_STATE.newIds.add(id);
  VARIANTS_STATE.draftOps.set(id, ops);
  VARIANTS_STATE.activeId = id;
  VARIANTS_STATE.checked = new Set([id]);
  VARIANTS_STATE.anchorId = id;
  renderVariantsBar();
  markDirty();
  showToast(`Variante "${label || id}" creata — modificala e poi Salva Json`);
}

/** The layers that belong in the base .layout.json, whatever is on the canvas. */
function variantsBaseLayersForSave() {
  if (!VARIANTS_STATE.baseLayers) return state.layers;
  captureCanvasIntoDraft();
  return currentBaseLayers();
}

/**
 * Second half of the project save: the base file has just been written, now persist
 * every variant draft and re-baseline. Returns a short summary for the toast.
 */
async function variantsAfterBaseSave() {
  const variants = (VARIANTS_STATE.payload?.variants || []).map((v) => ({
    id: v.id,
    label: v.label,
    note: v.note,
    axes: v.axes,
    promoted: v.promoted,
    ops: effectiveOpsOf(v.id),
  }));
  const savedBase = !!VARIANTS_STATE.draftBase;
  const savedVariants = new Set([...VARIANTS_STATE.draftOps.keys(), ...VARIANTS_STATE.newIds]).size;

  if (variants.length) {
    const data = await writeVariants(variants);
    VARIANTS_STATE.payload = data;
  }
  VARIANTS_STATE.baseLayers = JSON.parse(JSON.stringify(currentBaseLayers()));
  VARIANTS_STATE.draftBase = null;
  VARIANTS_STATE.draftOps.clear();
  VARIANTS_STATE.newIds.clear();
  // The canvas keeps showing whatever was selected, now rebuilt from the saved state.
  if (VARIANTS_STATE.activeId) {
    state.layers = applyVariantOps(VARIANTS_STATE.baseLayers, storedOpsOf(VARIANTS_STATE.activeId));
  } else {
    state.layers = JSON.parse(JSON.stringify(VARIANTS_STATE.baseLayers));
  }
  renderVariantsBar();
  return { savedBase, savedVariants };
}

/** Copy the set onto another layout path, used by "Salva con nome" from the base. */
async function copyVariantsTo(path) {
  const variants = (VARIANTS_STATE.payload?.variants || []).map((v) => ({ ...v, ops: effectiveOpsOf(v.id) }));
  if (!variants.length || !path) return 0;
  await writeVariants(variants, { path });
  return variants.length;
}

async function promoteActiveVariant() {
  const id = VARIANTS_STATE.activeId;
  const path = state.currentLayoutPath;
  if (!id || !path) return;
  if (variantsHaveUnsavedWork()) {
    showToast('Salva il progetto prima di promuovere: si promuove ciò che è su disco');
    return;
  }
  const suggested = (path.split('/').pop() || 'layout').replace(/\.layout\.json$/i, '') + `-${id}.layout.json`;
  const filename = prompt('Nome del nuovo layout (esce dal progetto e diventa indipendente):', suggested);
  if (!filename) return;
  try {
    const res = await fetch('/api/variants/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, id, filename }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'promote failed');
    showToast(`Promossa → ${data.filename} · apri quel layout per modificarlo`);
    await loadVariants();
  } catch (e) {
    showToast('Promozione fallita: ' + (e.message || e));
  }
}

async function deleteCheckedVariants() {
  const path = state.currentLayoutPath;
  const ids = [...VARIANTS_STATE.checked];
  if (!ids.length || !path) return;
  const label = ids.length === 1 ? `la variante "${ids[0]}"` : `${ids.length} varianti (${ids.join(', ')})`;
  if (!confirm(`Eliminare ${label}? L'operazione non è annullabile.`)) return;
  try {
    const res = await fetch('/api/variants/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, ids }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'delete failed');
    ids.forEach((id) => { VARIANTS_STATE.draftOps.delete(id); VARIANTS_STATE.newIds.delete(id); });
    if (ids.includes(VARIANTS_STATE.activeId)) showVariantOnCanvas(null);
    VARIANTS_STATE.checked = new Set();
    VARIANTS_STATE.anchorId = null;
    await loadVariants();
    showToast(ids.length === 1 ? `Variante ${ids[0]} eliminata` : `${ids.length} varianti eliminate`);
  } catch (e) {
    showToast('Eliminazione fallita: ' + (e.message || e));
  }
}

/* ------------------------------------------------------------------ plumbing */

function setVariantsBarOpen(open) {
  const bar = variantsBarEl();
  if (!bar) return;
  bar.classList.toggle('isCollapsed', !open);
  $('variantsToggle')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  localStorage.setItem('robyVariantsBarOpen', open ? '1' : '0');
  renderVariantsBar();
}

function bindVariantsBar() {
  $('variantsToggle')?.addEventListener('click', () => {
    setVariantsBarOpen(variantsBarEl()?.classList.contains('isCollapsed'));
  });
  $('variantsBaseBtn')?.addEventListener('click', restoreVariantBase);
  $('variantsNewBtn')?.addEventListener('click', createVariantFromCanvas);
  $('variantsPromoteBtn')?.addEventListener('click', promoteActiveVariant);
  $('variantsDeleteBtn')?.addEventListener('click', deleteCheckedVariants);
  $('variantsReloadBtn')?.addEventListener('click', () => loadVariants({ quiet: false }));
  setVariantsBarOpen(localStorage.getItem('robyVariantsBarOpen') === '1');
}

/** Loading a different layout starts a different project: drop every draft. */
function onLayoutChangedForVariants() {
  VARIANTS_STATE.activeId = null;
  // The freshly loaded layout IS the base, so snapshot it now rather than lazily: a
  // lazy snapshot would capture the canvas mid-edit and call that the base.
  VARIANTS_STATE.baseLayers = JSON.parse(JSON.stringify(state.layers));
  VARIANTS_STATE.draftBase = null;
  VARIANTS_STATE.draftOps.clear();
  VARIANTS_STATE.newIds.clear();
  VARIANTS_STATE.payload = null;
  VARIANTS_STATE.checked = new Set();
  VARIANTS_STATE.anchorId = null;
  renderVariantsBar();
  loadVariants();
}

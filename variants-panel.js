/**
 * Variants bar: browse alternative versions of the open layout.
 *
 * A variant is ops over the base, never a stored copy, so the bar always applies
 * them to a snapshot of the base taken when the first variant is selected. Applying
 * v02 after v01 must start from the base again, otherwise the two would stack and
 * the canvas would show something no promoted file would ever contain.
 */

const VARIANTS_STATE = {
  payload: null,      // last /api/variants response
  activeId: null,     // variant currently on the canvas, null = base
  baseLayers: null,   // snapshot taken before the first variant was applied
  loading: false,
};

function variantsBarEl() { return $('variantsBar'); }

function variantsApplicableFields() {
  return state.patchableFields && state.patchableFields.length
    ? new Set(state.patchableFields)
    : null; // health unavailable: apply everything rather than silently dropping fields
}

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

async function loadVariants({ quiet = true } = {}) {
  const path = state.currentLayoutPath;
  if (!path) {
    VARIANTS_STATE.payload = null;
    VARIANTS_STATE.activeId = null;
    VARIANTS_STATE.baseLayers = null;
    renderVariantsBar();
    return;
  }
  VARIANTS_STATE.loading = true;
  try {
    const res = await fetch('/api/variants?path=' + encodeURIComponent(path), { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'variants failed');
    VARIANTS_STATE.payload = data;
    // A variant that no longer exists must not stay highlighted.
    if (VARIANTS_STATE.activeId && !(data.variants || []).some((v) => v.id === VARIANTS_STATE.activeId)) {
      VARIANTS_STATE.activeId = null;
    }
  } catch (e) {
    VARIANTS_STATE.payload = null;
    if (!quiet) showToast('Varianti non caricate: ' + (e.message || e));
  } finally {
    VARIANTS_STATE.loading = false;
    renderVariantsBar();
  }
}

/**
 * Selection-only refresh: which card is active, and the buttons that depend on it.
 * Kept apart from renderVariantsBar because rebuilding the list recreates every
 * <img>, and the thumbnails are served no-store — every click would refetch them
 * and the strip would flicker.
 */
function syncVariantsSelectionUi() {
  const activeId = VARIANTS_STATE.activeId;
  const variants = VARIANTS_STATE.payload?.variants || [];

  document.querySelectorAll('.variantCard').forEach((card) => {
    card.classList.toggle('isActive', card.dataset.id === activeId);
  });

  const baseBtn = $('variantsBaseBtn');
  if (baseBtn) baseBtn.classList.toggle('variantActive', !activeId);
  const promote = $('variantsPromoteBtn');
  if (promote) promote.disabled = !activeId;
  const del = $('variantsDeleteBtn');
  if (del) del.disabled = !activeId;

  const hint = $('variantsHint');
  if (hint) {
    const active = variants.find((v) => v.id === activeId);
    hint.textContent = active
      ? (active.note || `${active.label} — non ancora salvata sul layout`)
      : (VARIANTS_STATE.payload?.baseChanged
        ? 'Il layout base è cambiato: le varianti segnate potrebbero non applicarsi più.'
        : 'Clicca una variante per vederla sul canvas. Cmd+Z torna indietro.');
  }
}

function renderVariantsBar() {
  const bar = variantsBarEl();
  if (!bar) return;
  const payload = VARIANTS_STATE.payload;
  const variants = payload?.variants || [];
  bar.classList.toggle('isEmpty', !variants.length);

  const count = $('variantsCount');
  if (count) count.textContent = String(variants.length);
  const stale = $('variantsStale');
  if (stale) stale.hidden = !payload?.baseChanged;
  syncVariantsSelectionUi();

  const list = $('variantsList');
  if (!list) return;
  list.innerHTML = '';
  // Cards are built only while the bar is open. Building them collapsed would put
  // every <img> in a display:none subtree, where the fetch never starts and the
  // thumbnails stay blank after opening.
  if (bar.classList.contains('isCollapsed')) return;
  variants.forEach((variant) => list.appendChild(variantCard(variant)));
}

function variantCard(variant) {
  const card = document.createElement('div');
  card.className = 'variantCard'
    + (variant.id === VARIANTS_STATE.activeId ? ' isActive' : '')
    + (variant.stale ? ' isStale' : '');
  card.dataset.id = variant.id;
  card.title = variant.stale
    ? `Layer mancanti: ${(variant.missingLayers || []).join(', ')}`
    : (variant.note || variant.label || variant.id);

  const path = state.currentLayoutPath || '';
  const img = document.createElement('img');
  img.className = 'variantThumb';
  img.alt = variant.label || variant.id;
  img.src = `/api/variant-thumb?path=${encodeURIComponent(path)}&id=${encodeURIComponent(variant.id)}&t=${variant.id}`;
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

  card.addEventListener('click', () => selectVariant(variant.id));
  return card;
}

function selectVariant(id) {
  const variant = (VARIANTS_STATE.payload?.variants || []).find((v) => v.id === id);
  if (!variant) return;
  if (variant.stale) {
    showToast(`Variante stantia: manca ${(variant.missingLayers || []).join(', ')}`);
    return;
  }
  // Snapshot once: every variant is computed from the base, not from the one on screen.
  if (!VARIANTS_STATE.activeId) {
    VARIANTS_STATE.baseLayers = JSON.parse(JSON.stringify(state.layers));
  }
  pushHistory();
  state.layers = applyVariantOps(VARIANTS_STATE.baseLayers, variant.ops);
  VARIANTS_STATE.activeId = id;
  state.selectedId = null;
  state.selectedIds = [];
  markDirty();
  render();
  syncVariantsSelectionUi();
}

function restoreVariantBase() {
  if (!VARIANTS_STATE.activeId || !VARIANTS_STATE.baseLayers) {
    VARIANTS_STATE.activeId = null;
    syncVariantsSelectionUi();
    return;
  }
  pushHistory();
  state.layers = JSON.parse(JSON.stringify(VARIANTS_STATE.baseLayers));
  VARIANTS_STATE.activeId = null;
  state.selectedId = null;
  state.selectedIds = [];
  markDirty();
  render();
  syncVariantsSelectionUi();
}

async function promoteActiveVariant() {
  const id = VARIANTS_STATE.activeId;
  const path = state.currentLayoutPath;
  if (!id || !path) return;
  const variant = (VARIANTS_STATE.payload?.variants || []).find((v) => v.id === id);
  const suggested = (path.split('/').pop() || 'layout').replace(/\.layout\.json$/i, '') + `-${id}.layout.json`;
  const filename = prompt('Nome del nuovo layout:', suggested);
  if (!filename) return;
  try {
    const res = await fetch('/api/variants/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, id, filename }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'promote failed');
    showToast(`Variante promossa → ${data.filename}`);
    await loadVariants();
  } catch (e) {
    showToast('Promozione fallita: ' + (e.message || e));
  }
}

async function deleteActiveVariant() {
  const id = VARIANTS_STATE.activeId;
  const path = state.currentLayoutPath;
  if (!id || !path) return;
  if (!confirm(`Eliminare la variante "${id}"? L'operazione non è annullabile.`)) return;
  try {
    const res = await fetch('/api/variants/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, ids: [id] }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'delete failed');
    restoreVariantBase();
    await loadVariants();
    showToast(`Variante ${id} eliminata`);
  } catch (e) {
    showToast('Eliminazione fallita: ' + (e.message || e));
  }
}

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
  $('variantsPromoteBtn')?.addEventListener('click', promoteActiveVariant);
  $('variantsDeleteBtn')?.addEventListener('click', deleteActiveVariant);
  $('variantsReloadBtn')?.addEventListener('click', () => loadVariants({ quiet: false }));
  setVariantsBarOpen(localStorage.getItem('robyVariantsBarOpen') === '1');
  renderVariantsBar();
}

/** Loading a different layout invalidates the whole variant context. */
function onLayoutChangedForVariants() {
  VARIANTS_STATE.activeId = null;
  VARIANTS_STATE.baseLayers = null;
  VARIANTS_STATE.payload = null;
  renderVariantsBar();
  loadVariants();
}

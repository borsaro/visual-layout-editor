/**
 * Canvas interaction for the corner distort.
 *
 * Handles live in an overlay, not inside the layer node: the node itself carries
 * the matrix3d, so any child handle would be dragged through the same distortion
 * and stop matching the cursor.
 */

let warpDrag = null;

/** Distort editing is on while the toggle is active, or while Option/Alt is held. */
function warpModeOn() {
  return !!(state.warpMode || state.warpModeTemp);
}

function warpEditActive(layer) {
  return warpModeOn()
    && !!layer
    && warpSupported(layer)
    && isSelected(layer.id)
    && !layerLocked(layer)
    && !vertexEditActive(layer);
}

function warpEditableLayers() {
  return selectedLayers().filter((l) => warpEditActive(l));
}

function setWarpMode(on) {
  state.warpMode = !!on;
  localStorage.setItem('robyWarpMode', state.warpMode ? '1' : '0');
  syncWarpModeUi();
  render();
}

function syncWarpModeUi() {
  const btn = $('warpModeBtn');
  if (btn) {
    btn.classList.toggle('active', warpModeOn());
    btn.setAttribute('aria-pressed', warpModeOn() ? 'true' : 'false');
  }
  const reset = $('warpResetBtn');
  if (reset) reset.disabled = !selectedLayers().some(layerHasWarp);
  const hint = $('warpHint');
  if (hint) {
    hint.textContent = warpModeOn()
      ? 'Trascina i 4 angoli. Shift = solo orizzontale/verticale.'
      : 'Attiva la distorsione, o tieni premuto Option.';
  }
}

/** Option/Alt turns distort on only while held, then restores the previous mode. */
function bindWarpHotkey() {
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Alt' || state.warpModeTemp || state.warpMode) return;
    state.warpModeTemp = true;
    syncWarpModeUi();
    render();
  });
  const release = () => {
    if (!state.warpModeTemp) return;
    state.warpModeTemp = false;
    syncWarpModeUi();
    render();
  };
  window.addEventListener('keyup', (ev) => { if (ev.key === 'Alt') release(); });
  // Alt+Tab and friends steal the keyup, which would leave the mode stuck on.
  window.addEventListener('blur', release);
}

function renderWarpOverlay(canvas) {
  if (warpDrag) return; // the overlay is patched in place while dragging
  const layers = warpEditableLayers();
  if (!layers.length) return;
  const overlay = document.createElement('div');
  overlay.className = 'warpOverlay';
  overlay.id = 'warpOverlay';
  layers.forEach((layer) => overlay.appendChild(warpLayerHandles(layer)));
  canvas.appendChild(overlay);
}

function warpLayerHandles(layer) {
  const group = document.createElement('div');
  group.className = 'warpGroup';
  group.dataset.layer = layer.id;
  const corners = layerWarpCanvasCorners(layer);

  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  outline.setAttribute('class', 'warpOutline');
  outline.setAttribute('width', String(state.canvas.width));
  outline.setAttribute('height', String(state.canvas.height));
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', corners.map((p) => `${p[0]},${p[1]}`).join(' '));
  outline.appendChild(poly);
  group.appendChild(outline);

  corners.forEach((p, index) => {
    const dot = document.createElement('div');
    dot.className = 'warpHandle';
    dot.dataset.corner = String(index);
    dot.style.left = `${p[0]}px`;
    dot.style.top = `${p[1]}px`;
    dot.title = `${WARP_CORNER_LABELS[index]} — trascina per distorcere`;
    dot.addEventListener('mousedown', (ev) => startWarpDrag(ev, layer.id, index));
    group.appendChild(dot);
  });
  return group;
}

function startWarpDrag(ev, id, index) {
  ev.preventDefault();
  ev.stopPropagation();
  const layer = state.layers.find((l) => l.id === id);
  if (!layer || layerLocked(layer)) return;
  pushHistory();
  if (!Array.isArray(layer.warp)) layer.warp = WARP_IDENTITY.map((p) => [p[0], p[1]]);
  warpDrag = {
    id,
    index,
    sx: ev.clientX,
    sy: ev.clientY,
    origin: [layer.warp[index][0], layer.warp[index][1]],
    // Mouse deltas are in screen axes; rotation/skew must be undone to move
    // the corner along the layer's own axes.
    inverse: layerTransformMatrix(layer).inverse(),
  };
  document.addEventListener('mousemove', onWarpMove);
  document.addEventListener('mouseup', endWarpDrag);
}

function onWarpMove(ev) {
  if (!warpDrag) return;
  const layer = state.layers.find((l) => l.id === warpDrag.id);
  if (!layer) return;
  const scale = (Number(state.zoom) || 100) / 100;
  let dx = (ev.clientX - warpDrag.sx) / scale;
  let dy = (ev.clientY - warpDrag.sy) / scale;
  if (ev.shiftKey) {
    if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
  }
  const local = warpDrag.inverse.transformPoint(new DOMPoint(dx, dy));
  const w = Math.max(1, Number(layer.w) || 1);
  const h = Math.max(1, Number(layer.h) || 1);
  layer.warp[warpDrag.index] = [
    clamp(warpDrag.origin[0] + local.x / w, -2, 3),
    clamp(warpDrag.origin[1] + local.y / h, -2, 3),
  ];
  refreshLayerOnStage(layer);
  refreshWarpOverlay(layer);
}

/** Move the handles with the cursor without rebuilding the canvas mid-drag. */
function refreshWarpOverlay(layer) {
  const group = document.querySelector(`.warpGroup[data-layer="${layer.id}"]`);
  if (!group) return;
  const corners = layerWarpCanvasCorners(layer);
  group.querySelector('.warpOutline polygon')
    ?.setAttribute('points', corners.map((p) => `${p[0]},${p[1]}`).join(' '));
  group.querySelectorAll('.warpHandle').forEach((dot) => {
    const p = corners[Number(dot.dataset.corner)];
    if (!p) return;
    dot.style.left = `${p[0]}px`;
    dot.style.top = `${p[1]}px`;
  });
}

function endWarpDrag() {
  const layer = warpDrag ? state.layers.find((l) => l.id === warpDrag.id) : null;
  warpDrag = null;
  document.removeEventListener('mousemove', onWarpMove);
  document.removeEventListener('mouseup', endWarpDrag);
  // A quad with three collinear corners has no inverse: snap back rather than
  // leave the layer in a state neither renderer can draw.
  if (layer && layerHasWarp(layer) && !warpHomography(layer)) {
    layer.warp = WARP_IDENTITY.map((p) => [p[0], p[1]]);
    showToast('Distorsione non valida — angoli ripristinati');
  }
  if (layer && !layerHasWarp(layer)) delete layer.warp;
  markDirty();
  render();
}

function resetWarp(ids) {
  const targets = (ids && ids.length ? ids.map((id) => state.layers.find((l) => l.id === id)) : selectedLayers())
    .filter((l) => l && layerHasWarp(l) && !layerLocked(l));
  if (!targets.length) return;
  pushHistory();
  targets.forEach((l) => { delete l.warp; });
  markDirty();
  render();
}

function bindWarpProps() {
  $('warpModeBtn')?.addEventListener('click', () => setWarpMode(!state.warpMode));
  $('warpResetBtn')?.addEventListener('click', () => resetWarp());
  bindWarpHotkey();
  syncWarpModeUi();
}

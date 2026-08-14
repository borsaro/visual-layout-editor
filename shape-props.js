/** Inspector wiring for shape layers (kind, sides, rounding, fill, stroke, vertices). */

function shapeKindOf(layer) {
  return layer?.shapeKind || 'rect';
}

function shapeSupportsSides(kind) {
  return kind === 'polygon' || kind === 'star';
}

function syncShapeProps(layer) {
  const kind = shapeKindOf(layer);
  setVal('propShapeKind', kind);
  setVal('propShapeSides', Number(layer.sides) || 6);
  setVal('propShapeCorner', Number(layer.corner) || 0);
  setVal('propShapeFill', typeof rgbToHex === 'function' ? rgbToHex(layer.fill || '#eb0029') : (layer.fill || '#eb0029'));
  setVal('propShapeStroke', typeof rgbToHex === 'function' ? rgbToHex(layer.stroke || '#111111') : (layer.stroke || '#111111'));
  setVal('propShapeStrokeWidth', Number(layer.strokeWidth) || 0);

  const fillOn = $('propShapeFillEnabled');
  if (fillOn) fillOn.checked = layer.fillEnabled !== false;

  const sidesField = $('shapeSidesField');
  if (sidesField) sidesField.hidden = !shapeSupportsSides(kind);

  const editBtn = $('shapeEditVerticesBtn');
  if (editBtn) {
    const editing = state.vertexEditId === layer.id;
    editBtn.disabled = kind === 'ellipse' && !shapeHasCustomPoints(layer);
    editBtn.classList.toggle('active', editing);
    editBtn.textContent = editing ? 'Chiudi vertici' : 'Modifica vertici';
  }
  const resetBtn = $('shapeResetPointsBtn');
  if (resetBtn) resetBtn.disabled = !shapeHasCustomPoints(layer);

  const hint = $('shapeVertexHint');
  if (hint) {
    hint.textContent = shapeHasCustomPoints(layer)
      ? 'Forma deformata a mano. Doppio click sulla forma per i vertici, Esc per uscire.'
      : 'Doppio click sulla forma per trascinare i singoli vertici.';
  }
}

/** Preset geometry changes drop the hand-warped vertices, which would mask them. */
function updateShapeGeometry(key, value) {
  const targets = targetLayersForKey(key).filter((l) => !layerLocked(l));
  if (!targets.length) return;
  pushHistory();
  targets.forEach((l) => {
    l[key] = value;
    l.points = null;
  });
  state.vertexEditId = null;
  markDirty();
  render();
}

function bindShapeProps() {
  $('propShapeKind')?.addEventListener('change', () => {
    updateShapeGeometry('shapeKind', $('propShapeKind').value);
  });
  $('propShapeSides')?.addEventListener('change', () => {
    updateShapeGeometry('sides', Math.max(3, Math.min(32, Number($('propShapeSides').value) || 6)));
  });
  $('propShapeCorner')?.addEventListener('input', () => {
    updateProp('corner', Math.max(0, Number($('propShapeCorner').value) || 0), { history: false, debounce: true });
  });
  $('propShapeFillEnabled')?.addEventListener('change', () => {
    updateProp('fillEnabled', !!$('propShapeFillEnabled').checked);
  });
  $('propShapeFill')?.addEventListener('input', () => updateProp('fill', $('propShapeFill').value));
  $('propShapeStroke')?.addEventListener('input', () => updateProp('stroke', $('propShapeStroke').value));
  $('propShapeStrokeWidth')?.addEventListener('input', () => {
    updateProp('strokeWidth', Math.max(0, Number($('propShapeStrokeWidth').value) || 0), { history: false, debounce: true });
  });
  $('shapeEditVerticesBtn')?.addEventListener('click', () => {
    const layer = selected();
    if (!layer || layer.type !== 'shape') return;
    if (state.vertexEditId === layer.id) stopVertexEdit();
    else startVertexEdit(layer.id);
  });
  $('shapeResetPointsBtn')?.addEventListener('click', () => {
    const layer = selected();
    if (!layer || layer.type !== 'shape') return;
    resetShapePoints(layer.id);
  });
}

/* ------------------------------------------------------------- image mask props */

function syncImageMaskProps(layer) {
  const kind = (layer && layer.maskKind) || 'none';
  setVal('propMaskKind', kind);
  setVal('propMaskSides', Number(layer?.maskSides) || 6);
  setVal('propMaskCorner', Number(layer?.maskCorner) || 0);
  const active = kind !== 'none';

  const sides = $('maskSidesField');
  if (sides) sides.hidden = !active || !shapeSupportsSides(kind);
  const cornerField = $('maskCornerField');
  if (cornerField) cornerField.hidden = !active;
  const actions = $('maskVertexActions');
  if (actions) actions.hidden = !active;
  const hint = $('maskVertexHint');
  if (hint) hint.hidden = !active;

  if (!active) return;
  const editBtn = $('maskEditVerticesBtn');
  if (editBtn) {
    const editing = state.vertexEditId === layer.id;
    editBtn.disabled = imageMaskIsEllipse(layer);
    editBtn.classList.toggle('active', editing);
    editBtn.textContent = editing ? 'Chiudi vertici' : 'Modifica vertici';
  }
  const resetBtn = $('maskResetPointsBtn');
  if (resetBtn) resetBtn.disabled = !imageMaskHasCustomPoints(layer);
  if (hint) {
    hint.textContent = imageMaskHasCustomPoints(layer)
      ? 'Maschera deformata a mano. Doppio click sull\'immagine per i vertici, Esc per uscire.'
      : 'Doppio click sull\'immagine per trascinare i singoli vertici della maschera.';
  }
}

/** Preset changes drop hand-warped mask vertices, which would otherwise hide the change. */
function updateImageMaskGeometry(patch) {
  const targets = selectedLayers().filter((l) => l.type === 'image' && !layerLocked(l));
  if (!targets.length) return;
  pushHistory();
  targets.forEach((l) => {
    Object.assign(l, patch);
    l.maskPoints = null;
  });
  if (state.vertexEditId && targets.some((l) => l.id === state.vertexEditId)) state.vertexEditId = null;
  markDirty();
  render();
}

function bindImageMaskProps() {
  $('propMaskKind')?.addEventListener('change', () => {
    const kind = $('propMaskKind').value;
    updateImageMaskGeometry(kind === 'none'
      ? { maskKind: null, maskCorner: 0 }
      : { maskKind: kind });
  });
  $('propMaskSides')?.addEventListener('change', () => {
    updateImageMaskGeometry({ maskSides: Math.max(3, Math.min(32, Number($('propMaskSides').value) || 6)) });
  });
  $('propMaskCorner')?.addEventListener('input', () => {
    // Rounding does not invalidate hand-moved vertices: it composes with them.
    updateProp('maskCorner', Math.max(0, Number($('propMaskCorner').value) || 0), { history: false, debounce: true });
  });
  $('maskEditVerticesBtn')?.addEventListener('click', () => {
    const layer = selected();
    if (!layer || !imageHasMask(layer)) return;
    if (state.vertexEditId === layer.id) stopVertexEdit();
    else startVertexEdit(layer.id);
  });
  $('maskResetPointsBtn')?.addEventListener('click', () => {
    const layer = selected();
    if (!layer || layer.type !== 'image') return;
    resetShapePoints(layer.id);
  });
}

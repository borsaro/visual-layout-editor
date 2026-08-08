/** Photoshop-style vertex warping: drag each corner of a shape independently. */

let vertexDrag = null;

function vertexEditActive(layer) {
  return !!layer && layer.type === 'shape' && state.vertexEditId === layer.id;
}

/**
 * Layer CSS transform as a matrix: rotate(deg) then skew(x, y).
 * Mouse deltas must be inverse-transformed through it, or dragging a vertex on a
 * rotated/skewed shape would follow the screen axes instead of the shape's own.
 */
function layerTransformMatrix(layer) {
  const skx = ((Number(layer.skewX) || 0) * Math.PI) / 180;
  const sky = ((Number(layer.skewY) || 0) * Math.PI) / 180;
  const m = new DOMMatrix();
  m.rotateSelf(Number(layer.rotation) || 0);
  return m.multiply(new DOMMatrix([1, Math.tan(sky), Math.tan(skx), 1, 0, 0]));
}

/** Freeze the current preset into editable points so every vertex can move. */
function ensureShapePoints(layer) {
  if (!shapeHasCustomPoints(layer)) {
    layer.points = shapePoints(layer).map((p) => [p[0], p[1]]);
  }
  return layer.points;
}

function startVertexEdit(id) {
  const layer = state.layers.find((l) => l.id === id);
  if (!layer || layer.type !== 'shape' || layerLocked(layer)) return;
  if (shapeIsEllipse(layer)) return;
  if (!isSelected(id)) selectOnly(id);
  state.vertexEditId = id;
  render();
}

function stopVertexEdit() {
  if (!state.vertexEditId) return;
  state.vertexEditId = null;
  render();
}

function resetShapePoints(id) {
  const layer = state.layers.find((l) => l.id === id);
  if (!layer || !shapeHasCustomPoints(layer) || layerLocked(layer)) return;
  pushHistory();
  layer.points = null;
  markDirty();
  render();
}

function appendVertexHandles(el, layer) {
  const w = Math.max(1, Number(layer.w) || 1);
  const h = Math.max(1, Number(layer.h) || 1);
  shapePoints(layer).forEach((p, index) => {
    const dot = document.createElement('div');
    dot.className = 'vertexHandle';
    dot.dataset.vertex = String(index);
    dot.style.left = `${p[0] * w}px`;
    dot.style.top = `${p[1] * h}px`;
    dot.title = `Vertice ${index + 1}`;
    dot.addEventListener('mousedown', (ev) => startVertexDrag(ev, layer.id, index));
    el.appendChild(dot);
  });
}

function startVertexDrag(ev, id, index) {
  ev.preventDefault();
  ev.stopPropagation();
  const layer = state.layers.find((l) => l.id === id);
  if (!layer || layerLocked(layer)) return;
  const points = ensureShapePoints(layer);
  if (!points[index]) return;
  pushHistory();
  vertexDrag = {
    id,
    index,
    sx: ev.clientX,
    sy: ev.clientY,
    origin: [points[index][0], points[index][1]],
    inverse: layerTransformMatrix(layer).inverse(),
  };
  document.addEventListener('mousemove', onVertexMove);
  document.addEventListener('mouseup', endVertexDrag);
}

function onVertexMove(ev) {
  if (!vertexDrag) return;
  const layer = state.layers.find((l) => l.id === vertexDrag.id);
  if (!layer) return;
  const scale = (Number(state.zoom) || 100) / 100;
  const local = vertexDrag.inverse.transformPoint(
    new DOMPoint((ev.clientX - vertexDrag.sx) / scale, (ev.clientY - vertexDrag.sy) / scale),
  );
  const w = Math.max(1, Number(layer.w) || 1);
  const h = Math.max(1, Number(layer.h) || 1);
  layer.points[vertexDrag.index] = [
    clamp(vertexDrag.origin[0] + local.x / w, -1, 2),
    clamp(vertexDrag.origin[1] + local.y / h, -1, 2),
  ];
  refreshLayerOnStage(layer);
}

function endVertexDrag() {
  vertexDrag = null;
  document.removeEventListener('mousemove', onVertexMove);
  document.removeEventListener('mouseup', endVertexDrag);
  markDirty();
  render();
}

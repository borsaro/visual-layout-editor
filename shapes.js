/** Vector shape layers: presets, path geometry, DOM + canvas rendering. */

const SVG_NS = 'http://www.w3.org/2000/svg';

const SHAPE_LABELS = {
  rect: 'Rettangolo', ellipse: 'Ellisse', triangle: 'Triangolo', diamond: 'Rombo',
  pentagon: 'Pentagono', hexagon: 'Esagono', octagon: 'Ottagono', star: 'Stella',
  polygon: 'Poligono',
};

function shapeKindLabel(kind) {
  return SHAPE_LABELS[kind] || 'Forma';
}

function defaultShape(kind = 'rect') {
  return {
    id: uid(), type: 'shape', name: shapeKindLabel(kind),
    x: 120, y: 260, w: 320, h: 320, z: nextZ(),
    opacity: 1, rotation: 0, skewX: 0, skewY: 0,
    shapeKind: kind, sides: 6, corner: 0,
    fill: '#eb0029', fillEnabled: true, stroke: '#111111', strokeWidth: 0,
    points: null,
  };
}

/** Vertices of a regular n-gon, first point at top, rescaled to fill the 0..1 box. */
function regularShapePoints(sides) {
  const n = Math.max(3, Math.min(64, Number(sides) || 3));
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
  }
  return fitPointsToBox(pts);
}

function starShapePoints(points, innerRatio = 0.42) {
  const n = Math.max(3, Math.min(32, Number(points) || 5));
  const pts = [];
  for (let i = 0; i < n * 2; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 === 0 ? 0.5 : 0.5 * innerRatio;
    pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  return fitPointsToBox(pts);
}

/** Stretch normalized points so their bounds match the layer box exactly. */
function fitPointsToBox(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const dx = Math.max(...xs) - minX || 1;
  const dy = Math.max(...ys) - minY || 1;
  return pts.map(([x, y]) => [(x - minX) / dx, (y - minY) / dy]);
}

function presetShapePoints(kind, sides) {
  switch (kind) {
    case 'triangle': return [[0.5, 0], [1, 1], [0, 1]];
    case 'diamond': return [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
    case 'pentagon': return regularShapePoints(5);
    case 'hexagon': return regularShapePoints(6);
    case 'octagon': return regularShapePoints(8);
    case 'star': return starShapePoints(sides);
    case 'polygon': return regularShapePoints(sides);
    default: return [[0, 0], [1, 0], [1, 1], [0, 1]];
  }
}

function shapeHasCustomPoints(layer) {
  return Array.isArray(layer?.points) && layer.points.length >= 3;
}

/** Normalized (0..1) vertices: warped ones when present, otherwise the preset. */
function shapePoints(layer) {
  if (shapeHasCustomPoints(layer)) {
    return layer.points.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]);
  }
  return presetShapePoints(layer.shapeKind || 'rect', layer.sides);
}

function shapeIsEllipse(layer) {
  return (layer.shapeKind || 'rect') === 'ellipse' && !shapeHasCustomPoints(layer);
}

function ellipsePathD(w, h) {
  const rx = w / 2, ry = h / 2;
  return `M 0 ${ry} A ${rx} ${ry} 0 0 1 ${w} ${ry} A ${rx} ${ry} 0 0 1 0 ${ry} Z`;
}

function pointTowards(from, to, distance) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.min(distance, len) / len;
  return [from[0] + dx * t, from[1] + dy * t];
}

/**
 * Closed polygon path. Corner rounding uses a quadratic through each vertex,
 * which stays correct for concave vertices and any winding order.
 */
function polygonPathD(pts, corner) {
  const n = pts.length;
  if (n < 3) return '';
  if (!(corner > 0)) {
    return `M ${pts.map((p) => `${p[0]} ${p[1]}`).join(' L ')} Z`;
  }
  let d = '';
  for (let i = 0; i < n; i += 1) {
    const cur = pts[i];
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const start = pointTowards(cur, prev, Math.min(corner, Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) / 2));
    const end = pointTowards(cur, next, Math.min(corner, Math.hypot(next[0] - cur[0], next[1] - cur[1]) / 2));
    d += `${i === 0 ? 'M' : ' L'} ${start[0]} ${start[1]}`;
    d += ` Q ${cur[0]} ${cur[1]} ${end[0]} ${end[1]}`;
  }
  return `${d} Z`;
}

/** Path in layer-local pixels (0..w, 0..h). Shared by the DOM svg and canvas export. */
function shapePathD(layer) {
  const w = Math.max(1, Number(layer.w) || 1);
  const h = Math.max(1, Number(layer.h) || 1);
  if (shapeIsEllipse(layer)) return ellipsePathD(w, h);
  const pts = shapePoints(layer).map(([nx, ny]) => [nx * w, ny * h]);
  return polygonPathD(pts, Math.max(0, Number(layer.corner) || 0));
}

function shapeSvgEl(layer) {
  const w = Math.max(1, Number(layer.w) || 1);
  const h = Math.max(1, Number(layer.h) || 1);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('shapeSvg');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', shapePathD(layer));
  path.setAttribute('fill', layer.fillEnabled === false ? 'none' : (layer.fill || '#000000'));
  const sw = Number(layer.strokeWidth) || 0;
  path.setAttribute('stroke', sw > 0 ? (layer.stroke || '#000000') : 'none');
  if (sw > 0) {
    path.setAttribute('stroke-width', String(sw));
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.appendChild(path);
  return svg;
}

function drawCanvasShape(ctx, layer) {
  const path = new Path2D(shapePathD(layer));
  applyCanvasShadow(ctx, layer.shadow);
  ctx.save();
  ctx.translate(Number(layer.x) || 0, Number(layer.y) || 0);
  if (layer.fillEnabled !== false) {
    ctx.fillStyle = layer.fill || '#000000';
    ctx.fill(path);
  }
  const sw = Number(layer.strokeWidth) || 0;
  if (sw > 0) {
    ctx.lineWidth = sw;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = layer.stroke || '#000000';
    ctx.stroke(path);
  }
  ctx.restore();
  clearCanvasShadow(ctx);
}

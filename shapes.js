/** Vector shape layers: presets, path geometry, DOM + canvas rendering. */

const SVG_NS = 'http://www.w3.org/2000/svg';

const SHAPE_LABELS = {
  rect: 'Rettangolo', ellipse: 'Ellisse', triangle: 'Triangolo', diamond: 'Rombo',
  pentagon: 'Pentagono', hexagon: 'Esagono', octagon: 'Ottagono', star: 'Stella',
  polygon: 'Poligono', arrow: 'Freccia',
};

function shapeKindLabel(kind) {
  return SHAPE_LABELS[kind] || 'Forma';
}

function defaultShape(kind = 'rect') {
  const base = {
    id: uid(), type: 'shape', name: shapeKindLabel(kind),
    x: 120, y: 260, w: 320, h: 320, z: nextZ(),
    opacity: 1, rotation: 0, skewX: 0, skewY: 0,
    shapeKind: kind, sides: 6, corner: 0,
    fill: '#eb0029', fillEnabled: true, stroke: '#111111', strokeWidth: 0,
    points: null,
  };
  if (kind === 'arrow') {
    // An arrow is a stroked line, so it needs a visible stroke from birth, and a
    // box shaped like a line rather than a square.
    Object.assign(base, {
      h: 100, stroke: '#eb0029', strokeWidth: 6,
      arrowHead: 'triangle', arrowHeadSize: 26, arrowDash: 0, arrowDouble: false,
    });
  }
  return base;
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
  if (shapeIsArrow(layer)) return arrowSvgEl(layer);
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
  if (shapeIsArrow(layer)) { drawCanvasArrow(ctx, layer); return; }
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

/* ---------------------------------------------------------------- image masks */
/**
 * Shape-crop for image layers: the same geometry as shape layers (presets, hand
 * warped vertices, rounded corners), applied as a clip instead of a fill. Fields
 * live under mask* so they never collide with the rectangular source crop.
 */
function imageHasMask(layer) {
  return !!layer && layer.type === 'image' && !!layer.maskKind && layer.maskKind !== 'none';
}

/** Adapter: lets every shape helper (shapePathD, shapePoints…) read mask fields. */
function imageMaskProxy(layer) {
  return {
    shapeKind: layer.maskKind || 'rect',
    points: layer.maskPoints,
    sides: layer.maskSides,
    corner: layer.maskCorner,
    w: layer.w,
    h: layer.h,
  };
}

function imageMaskPathD(layer) {
  return shapePathD(imageMaskProxy(layer));
}

function imageMaskHasCustomPoints(layer) {
  return Array.isArray(layer?.maskPoints) && layer.maskPoints.length >= 3;
}

/** Vertex editing needs discrete points; a pure ellipse mask has none to drag. */
function imageMaskIsEllipse(layer) {
  return (layer.maskKind || 'rect') === 'ellipse' && !imageMaskHasCustomPoints(layer);
}

/* -------------------------------------------------------------------- arrows */
/**
 * An arrow is not a closed polygon: a shaft that can be dashed, plus heads that
 * are filled or open. It lives inside the box pointing right (rotate the layer to
 * aim it); stroke is the colour, strokeWidth the line weight.
 */
function shapeIsArrow(layer) {
  return (layer?.shapeKind || 'rect') === 'arrow';
}

function arrowGeometry(layer) {
  const w = Math.max(1, Number(layer.w) || 1);
  const h = Math.max(1, Number(layer.h) || 1);
  const cy = h / 2;
  const t = Math.max(1, Number(layer.strokeWidth) || 6);
  const kind = layer.arrowHead || 'triangle';
  const L = Math.max(4, Number(layer.arrowHeadSize) || 26);
  const half = L * 0.6;
  const double = !!layer.arrowDouble;

  // The shaft stops where a solid head begins, or it would poke past the tip.
  const inset = kind === 'none' || kind === 'open' ? 0 : (kind === 'circle' ? L : L * 0.85);
  const heads = [];
  const mk = (tipX, dir) => {
    const back = tipX - dir * L;
    if (kind === 'triangle') return { d: `M ${tipX} ${cy} L ${back} ${cy - half} L ${back} ${cy + half} Z`, fill: true };
    if (kind === 'stealth') return { d: `M ${tipX} ${cy} L ${back} ${cy - half} L ${tipX - dir * L * 0.6} ${cy} L ${back} ${cy + half} Z`, fill: true };
    if (kind === 'open') return { d: `M ${back} ${cy - half} L ${tipX} ${cy} L ${back} ${cy + half}`, fill: false };
    if (kind === 'circle') {
      const cx = tipX - dir * (L / 2);
      const r = L / 2;
      return { d: `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`, fill: true };
    }
    return null;
  };
  if (kind !== 'none') {
    const right = mk(w, 1);
    if (right) heads.push(right);
    if (double) {
      const left = mk(0, -1);
      if (left) heads.push(left);
    }
  }
  // Tail: a plain start, or a dot — only when the start is not already a head.
  let tailInset = 0;
  if (!double && (layer.arrowTail || 'none') === 'circle') {
    const r = Math.max(t * 1.1, L * 0.28);
    heads.push({ d: `M 0 ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`
      .replace('M 0', `M ${0}`), fill: true, cx: r });
    // shaft starts at the dot's centre so the join is clean
    tailInset = r;
  }
  return {
    shaft: { x1: double ? inset : tailInset, x2: w - inset, y: cy },
    heads,
    thickness: t,
    dash: Math.max(0, Number(layer.arrowDash) || 0),
    color: layer.stroke || '#111111',
  };
}

function arrowSvgEl(layer) {
  const w = Math.max(1, Number(layer.w) || 1);
  const h = Math.max(1, Number(layer.h) || 1);
  const g = arrowGeometry(layer);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('shapeSvg');
  const shaft = document.createElementNS(SVG_NS, 'path');
  shaft.setAttribute('d', `M ${g.shaft.x1} ${g.shaft.y} L ${g.shaft.x2} ${g.shaft.y}`);
  shaft.setAttribute('stroke', g.color);
  shaft.setAttribute('stroke-width', String(g.thickness));
  shaft.setAttribute('fill', 'none');
  // Round caps merge dashes into dots; keep them square while dashed.
  shaft.setAttribute('stroke-linecap', g.dash > 0 ? 'butt' : 'round');
  if (g.dash > 0) shaft.setAttribute('stroke-dasharray', `${g.dash} ${Math.max(2, g.dash * 0.7)}`);
  svg.appendChild(shaft);
  g.heads.forEach((head) => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', head.d);
    if (head.fill) {
      p.setAttribute('fill', g.color);
      p.setAttribute('stroke', 'none');
    } else {
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', g.color);
      p.setAttribute('stroke-width', String(g.thickness));
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
    }
    svg.appendChild(p);
  });
  return svg;
}

function drawCanvasArrow(ctx, layer) {
  const g = arrowGeometry(layer);
  applyCanvasShadow(ctx, layer.shadow);
  ctx.save();
  ctx.translate(Number(layer.x) || 0, Number(layer.y) || 0);
  ctx.strokeStyle = g.color;
  ctx.fillStyle = g.color;
  ctx.lineWidth = g.thickness;
  ctx.lineCap = g.dash > 0 ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  if (g.dash > 0) ctx.setLineDash([g.dash, Math.max(2, g.dash * 0.7)]);
  ctx.beginPath();
  ctx.moveTo(g.shaft.x1, g.shaft.y);
  ctx.lineTo(g.shaft.x2, g.shaft.y);
  ctx.stroke();
  ctx.setLineDash([]);
  g.heads.forEach((head) => {
    const p = new Path2D(head.d);
    if (head.fill) ctx.fill(p);
    else ctx.stroke(p);
  });
  ctx.restore();
  clearCanvasShadow(ctx);
}

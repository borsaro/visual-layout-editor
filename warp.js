/**
 * Free corner distort: drag the four corners of a layer independently.
 *
 * The four corners define a projective (not affine) map, so this is a real
 * perspective warp, not a skew. Two renderers must agree on it:
 *   - DOM preview  -> a single matrix3d built from the same homography
 *   - canvas export -> the layer is drawn offscreen, then remapped through a
 *     triangle mesh, because canvas 2D has no projective transform.
 */

const WARP_IDENTITY = [[0, 0], [1, 0], [1, 1], [0, 1]];
const WARP_CORNER_LABELS = ['Alto sx', 'Alto dx', 'Basso dx', 'Basso sx'];
/** Offscreen padding so shadows/glow outside the box still warp instead of being cut. */
const WARP_BLEED = 64;

function normalizeWarp(warp) {
  if (!Array.isArray(warp) || warp.length !== 4) return null;
  const pts = warp.map((p) => [Number(p?.[0]), Number(p?.[1])]);
  if (pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  return pts;
}

function warpIsIdentity(warp) {
  const pts = normalizeWarp(warp);
  if (!pts) return true;
  return pts.every((p, i) => Math.abs(p[0] - WARP_IDENTITY[i][0]) < 1e-6
    && Math.abs(p[1] - WARP_IDENTITY[i][1]) < 1e-6);
}

function layerHasWarp(layer) {
  return !!layer && !warpIsIdentity(layer.warp);
}

function layerWarpPoints(layer) {
  return normalizeWarp(layer?.warp) || WARP_IDENTITY.map((p) => [p[0], p[1]]);
}

function warpSupported(layer) {
  return !!layer && ['text', 'shape', 'rect', 'image', 'gradient'].includes(layer.type);
}

/* ---------------------------------------------------------------- matrices */

function mat3Multiply(a, b) {
  const out = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

function mat3Apply(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  const d = Math.abs(w) < 1e-9 ? 1e-9 : w;
  return [(m[0] * x + m[1] * y + m[2]) / d, (m[3] * x + m[4] * y + m[5]) / d];
}

function mat3Translate(tx, ty) {
  return [1, 0, tx, 0, 1, ty, 0, 0, 1];
}

/** rotate(deg) then skew(x,y) — same order the DOM and canvas renderers already use. */
function rotateSkewMatrix(layer) {
  const rot = ((Number(layer.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const r = [cos, -sin, 0, sin, cos, 0, 0, 0, 1];
  const tx = Math.tan(((Number(layer.skewX) || 0) * Math.PI) / 180);
  const ty = Math.tan(((Number(layer.skewY) || 0) * Math.PI) / 180);
  const k = [1, tx, 0, ty, 1, 0, 0, 0, 1];
  return mat3Multiply(r, k);
}

/**
 * Homography mapping the unit square to the four warp corners (Heckbert's
 * closed form for the square->quad case), then rescaled to box pixels.
 */
function warpHomography(layer) {
  const w = Math.max(1, Number(layer.w) || 1);
  const h = Math.max(1, Number(layer.h) || 1);
  const p = layerWarpPoints(layer).map(([u, v]) => [u * w, v * h]);
  const [x0, y0] = p[0], [x1, y1] = p[1], [x2, y2] = p[2], [x3, y3] = p[3];
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;

  let a, b, c, d, e, f, g, hh;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    // Parallelogram: the map is affine, the projective terms vanish.
    a = x1 - x0; b = x3 - x0; c = x0;
    d = y1 - y0; e = y3 - y0; f = y0;
    g = 0; hh = 0;
  } else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-9) return null; // degenerate quad: three corners collinear
    g = (sx * dy2 - dx2 * sy) / den;
    hh = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + hh * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + hh * y3; f = y0;
  }
  const H = [a, b, c, d, e, f, g, hh, 1];

  // A finite `den` above is not enough: a quad with three collinear corners still
  // solves, but collapses the square onto a line and cannot be inverted.
  const det = a * (e * 1 - f * hh) - b * (d * 1 - f * g) + c * (d * hh - e * g);
  const area = w * h;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-6 * area) return null;

  // The projective denominator must keep one sign across the quad. When it crosses
  // zero a corner has passed the horizon and the layer renders mirrored/exploded.
  const wq = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => g * u + hh * v + 1);
  if (wq.some((n) => !Number.isFinite(n) || n <= 1e-6)) return null;

  // Input is in box pixels, not unit coords, so fold in the 1/w, 1/h scale.
  return mat3Multiply(H, [1 / w, 0, 0, 0, 1 / h, 0, 0, 0, 1]);
}

/** Full local->canvas map: rotation/skew about the centre, composed with the warp. */
function layerFullMatrix(layer) {
  const w = Math.max(1, Number(layer.w) || 1);
  const h = Math.max(1, Number(layer.h) || 1);
  const centred = mat3Multiply(
    mat3Multiply(mat3Translate(w / 2, h / 2), rotateSkewMatrix(layer)),
    mat3Translate(-w / 2, -h / 2),
  );
  const H = layerHasWarp(layer) ? warpHomography(layer) : null;
  return H ? mat3Multiply(centred, H) : centred;
}

/** CSS matrix3d is column-major; a 2D homography rides in rows/cols 1,2 and 4. */
function mat3ToCssMatrix3d(m) {
  const v = [
    m[0], m[3], 0, m[6],
    m[1], m[4], 0, m[7],
    0, 0, 1, 0,
    m[2], m[5], 0, m[8],
  ];
  return `matrix3d(${v.map((n) => (Math.abs(n) < 1e-12 ? 0 : n)).join(',')})`;
}

/** Corner positions in canvas px, for drawing the drag handles outside the layer node. */
function layerWarpCanvasCorners(layer) {
  const w = Math.max(1, Number(layer.w) || 1);
  const h = Math.max(1, Number(layer.h) || 1);
  const centred = mat3Multiply(
    mat3Multiply(mat3Translate(w / 2, h / 2), rotateSkewMatrix(layer)),
    mat3Translate(-w / 2, -h / 2),
  );
  return layerWarpPoints(layer).map(([u, v]) => {
    const [px, py] = mat3Apply(centred, u * w, v * h);
    return [px + (Number(layer.x) || 0), py + (Number(layer.y) || 0)];
  });
}

/* ------------------------------------------------------------------ canvas */

function mat3Invert(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    A / det, (c * h - b * i) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, (c * d - a * f) / det,
    C / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
}

/** Bilinear sample of premultiplied RGBA; out of bounds reads as transparent. */
function samplePremultiplied(data, sw, sh, x, y, acc) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  for (let dy = 0; dy < 2; dy += 1) {
    const sy = y0 + dy;
    if (sy < 0 || sy >= sh) continue;
    const wy = dy ? fy : 1 - fy;
    for (let dx = 0; dx < 2; dx += 1) {
      const sx = x0 + dx;
      if (sx < 0 || sx >= sw) continue;
      const wgt = wy * (dx ? fx : 1 - fx);
      if (wgt <= 0) continue;
      const p = (sy * sw + sx) * 4;
      const al = data[p + 3] / 255;
      acc[0] += data[p] * al * wgt;
      acc[1] += data[p + 1] * al * wgt;
      acc[2] += data[p + 2] * al * wgt;
      acc[3] += data[p + 3] * wgt;
    }
  }
}

/**
 * Draw an already-rendered layer bitmap through the warp, by inverse-mapping every
 * destination pixel back into the source.
 *
 * A forward triangle mesh is the usual trick, but each cell's antialiased clip edge
 * lets the background bleed through and the seams are visible on flat fills. Inverse
 * mapping has no cells, so no seams, and it is exact rather than piecewise-affine.
 *
 * `off` holds the layer drawn at natural size with WARP_BLEED padding on each side.
 */
function drawWarpedBitmap(ctx, layer, off) {
  const H = warpHomography(layer);
  const Hinv = H && mat3Invert(H);
  if (!Hinv) return false;
  const w = Math.max(1, Number(layer.w) || 1);
  const h = Math.max(1, Number(layer.h) || 1);
  const ox = Number(layer.x) || 0;
  const oy = Number(layer.y) || 0;

  // Destination bounds: image of the padded source rect. A projective map sends
  // lines to lines, so the four mapped corners bound the whole region.
  const padded = [
    [-WARP_BLEED, -WARP_BLEED], [w + WARP_BLEED, -WARP_BLEED],
    [w + WARP_BLEED, h + WARP_BLEED], [-WARP_BLEED, h + WARP_BLEED],
  ].map(([px, py]) => mat3Apply(H, px, py));
  const xs = padded.map((p) => p[0]), ys = padded.map((p) => p[1]);
  const bx = Math.floor(Math.min(...xs)), by = Math.floor(Math.min(...ys));
  const bw = Math.ceil(Math.max(...xs)) - bx, bh = Math.ceil(Math.max(...ys)) - by;
  if (!Number.isFinite(bw) || !Number.isFinite(bh) || bw <= 0 || bh <= 0) return false;
  if (bw * bh > 64e6) return false; // runaway quad: refuse rather than hang the export

  const octx = off.getContext('2d');
  const srcData = octx.getImageData(0, 0, off.width, off.height).data;
  const out = ctx.createImageData(bw, bh);
  const dst = out.data;

  // Shrinking the layer undersamples the source; supersample to keep edges clean.
  const scale = Math.sqrt(Math.abs(H[0] * H[4] - H[1] * H[3])) || 1;
  const n = Math.max(1, Math.min(3, Math.ceil(1 / scale)));
  const step = 1 / n;
  const acc = [0, 0, 0, 0];

  for (let py = 0; py < bh; py += 1) {
    for (let px = 0; px < bw; px += 1) {
      let r = 0, g = 0, b = 0, a = 0, taken = 0;
      for (let sy = 0; sy < n; sy += 1) {
        for (let sx = 0; sx < n; sx += 1) {
          const dx = bx + px + (sx + 0.5) * step;
          const dy = by + py + (sy + 0.5) * step;
          const [ux, uy] = mat3Apply(Hinv, dx, dy);
          const fx = ux + WARP_BLEED;
          const fy = uy + WARP_BLEED;
          if (fx < -1 || fy < -1 || fx > off.width || fy > off.height) { taken += 1; continue; }
          acc[0] = acc[1] = acc[2] = acc[3] = 0;
          samplePremultiplied(srcData, off.width, off.height, fx, fy, acc);
          r += acc[0]; g += acc[1]; b += acc[2]; a += acc[3];
          taken += 1;
        }
      }
      if (!taken || a <= 0) continue;
      const alpha = a / taken;
      // Undo premultiplication: ImageData holds straight, not premultiplied, RGBA.
      const k = 255 / alpha;
      const p = (py * bw + px) * 4;
      dst[p] = Math.max(0, Math.min(255, Math.round((r / taken) * k)));
      dst[p + 1] = Math.max(0, Math.min(255, Math.round((g / taken) * k)));
      dst[p + 2] = Math.max(0, Math.min(255, Math.round((b / taken) * k)));
      dst[p + 3] = Math.max(0, Math.min(255, Math.round(alpha)));
    }
  }

  // Via a temp canvas, not putImageData: that would ignore globalAlpha and blend mode.
  const tmp = document.createElement('canvas');
  tmp.width = bw; tmp.height = bh;
  tmp.getContext('2d').putImageData(out, 0, 0);
  ctx.drawImage(tmp, bx + ox, by + oy);
  return true;
}

/**
 * Render one layer offscreen at natural size, then paint it warped.
 * `drawFn(ctx, layer)` must draw the layer at its absolute canvas coords.
 */
async function drawLayerWarped(ctx, layer, drawFn) {
  const w = Math.max(1, Math.round(Number(layer.w) || 1));
  const h = Math.max(1, Math.round(Number(layer.h) || 1));
  const off = document.createElement('canvas');
  off.width = w + WARP_BLEED * 2;
  off.height = h + WARP_BLEED * 2;
  const octx = off.getContext('2d');
  octx.translate(WARP_BLEED - (Number(layer.x) || 0), WARP_BLEED - (Number(layer.y) || 0));
  await drawFn(octx, layer);
  return drawWarpedBitmap(ctx, layer, off);
}

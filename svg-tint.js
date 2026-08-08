/** Recolor inline-SVG image layers: flat tint or two-stop gradient, baked back into src. */

const SVG_TINT_DEF_ID = 'robyTintPaint';
const SVG_PAINTABLE = 'path,rect,circle,ellipse,polygon,polyline,line,text';

function defaultSvgTint() {
  return {
    mode: 'none',
    color: '#0A0714',
    gradientType: 'linear',
    angle: 90,
    stops: [
      { color: '#FF2E63', alpha: 1 },
      { color: '#8A63FF', alpha: 1 },
    ],
  };
}

function normalizeSvgTint(tint) {
  const base = defaultSvgTint();
  const t = tint && typeof tint === 'object' ? tint : {};
  const stops = Array.isArray(t.stops) && t.stops.length >= 2 ? t.stops : base.stops;
  return {
    mode: ['none', 'solid', 'gradient'].includes(t.mode) ? t.mode : base.mode,
    color: t.color || base.color,
    gradientType: t.gradientType === 'radial' ? 'radial' : 'linear',
    angle: Number.isFinite(Number(t.angle)) ? Number(t.angle) : base.angle,
    stops: [0, 1].map((i) => ({
      color: stops[i]?.color || base.stops[i].color,
      alpha: stops[i]?.alpha != null ? Math.max(0, Math.min(1, Number(stops[i].alpha))) : 1,
    })),
  };
}

/** Decode a data:image/svg+xml src (base64 or percent-encoded) back to markup. */
function decodeSvgDataUri(src) {
  const s = String(src || '');
  const m = /^data:image\/svg\+xml([^,]*),(.*)$/is.exec(s);
  if (!m) return '';
  const meta = m[1] || '';
  const body = m[2] || '';
  try {
    if (/;base64/i.test(meta)) return decodeURIComponent(escape(atob(body)));
    return decodeURIComponent(body);
  } catch (e) {
    try { return decodeURIComponent(escape(atob(body))); } catch (e2) { return ''; }
  }
}

function encodeSvgDataUri(svgText) {
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(String(svgText || ''))));
}

/** Only inline SVGs can be recolored: an .svg on disk is not fetched here. */
function isInlineSvgLayer(layer) {
  return !!layer && layer.type === 'image' && /^data:image\/svg\+xml/i.test(String(layer.src || ''));
}

/** Pristine markup: kept on the layer the first time a tint is applied, so 'Originale' can restore it. */
function svgTintBase(layer) {
  if (!layer) return '';
  if (typeof layer.svgBase === 'string' && layer.svgBase.trim()) return layer.svgBase;
  return decodeSvgDataUri(layer.src);
}

/** CSS-style angle (0 = verso l'alto, 90 = destra, 180 = basso) → objectBoundingBox endpoints. */
function svgGradientVector(angleDeg) {
  const a = (Number(angleDeg) || 0) * Math.PI / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  return {
    x1: 0.5 - dx / 2, y1: 0.5 - dy / 2,
    x2: 0.5 + dx / 2, y2: 0.5 + dy / 2,
  };
}

function buildTintPaintNode(doc, tint) {
  const NS = 'http://www.w3.org/2000/svg';
  const stops = tint.stops.map((s, i) => {
    const el = doc.createElementNS(NS, 'stop');
    el.setAttribute('offset', i === 0 ? '0' : '1');
    el.setAttribute('stop-color', s.color);
    if (s.alpha < 1) el.setAttribute('stop-opacity', String(s.alpha));
    return el;
  });
  let node;
  if (tint.gradientType === 'radial') {
    node = doc.createElementNS(NS, 'radialGradient');
    node.setAttribute('cx', '0.5');
    node.setAttribute('cy', '0.5');
    node.setAttribute('r', '0.5');
  } else {
    node = doc.createElementNS(NS, 'linearGradient');
    const v = svgGradientVector(tint.angle);
    node.setAttribute('x1', String(v.x1));
    node.setAttribute('y1', String(v.y1));
    node.setAttribute('x2', String(v.x2));
    node.setAttribute('y2', String(v.y2));
  }
  node.setAttribute('id', SVG_TINT_DEF_ID);
  node.setAttribute('gradientUnits', 'objectBoundingBox');
  stops.forEach((s) => node.appendChild(s));
  return node;
}

/** fill="none" stays untouched: it marks stroke-only artwork we must not flood-fill. */
function elementFillIsNone(el) {
  const attr = (el.getAttribute('fill') || '').trim().toLowerCase();
  if (attr === 'none') return true;
  const style = (el.getAttribute('style') || '').toLowerCase();
  return /(^|;)\s*fill\s*:\s*none\s*(;|$)/.test(style);
}

function stripInlineFillDeclaration(el) {
  const style = el.getAttribute('style');
  if (!style || !/fill\s*:/i.test(style)) return;
  const next = style.split(';').filter((d) => d.trim() && !/^\s*fill\s*:/i.test(d)).join(';');
  if (next.trim()) el.setAttribute('style', next);
  else el.removeAttribute('style');
}

/** Returns recolored markup; on any parse problem returns the source untouched. */
function applySvgTint(svgText, tint) {
  const src = String(svgText || '');
  const t = normalizeSvgTint(tint);
  if (!src.trim() || t.mode === 'none') return src;
  let doc;
  try {
    doc = new DOMParser().parseFromString(src, 'image/svg+xml');
  } catch (e) {
    return src;
  }
  const root = doc.documentElement;
  if (!root || root.nodeName === 'parsererror' || doc.querySelector('parsererror')) return src;

  const paint = t.mode === 'gradient' ? `url(#${SVG_TINT_DEF_ID})` : t.color;

  if (t.mode === 'gradient') {
    doc.getElementById(SVG_TINT_DEF_ID)?.remove();
    let defs = root.querySelector('defs');
    if (!defs) {
      defs = doc.createElementNS('http://www.w3.org/2000/svg', 'defs');
      root.insertBefore(defs, root.firstChild);
    }
    defs.appendChild(buildTintPaintNode(doc, t));
  }

  root.querySelectorAll(SVG_PAINTABLE).forEach((el) => {
    if (elementFillIsNone(el)) return;
    stripInlineFillDeclaration(el);
    el.setAttribute('fill', paint);
  });
  // A fill on a <g> or on the root would override the per-element one we just set.
  root.querySelectorAll('g').forEach((el) => {
    if (!elementFillIsNone(el) && el.hasAttribute('fill')) el.setAttribute('fill', paint);
  });

  return new XMLSerializer().serializeToString(root);
}

/** Recompute src (and remember the pristine markup) for the current tint settings. */
function svgTintedLayerPatch(layer, tint) {
  const base = svgTintBase(layer);
  if (!base) return null;
  const t = normalizeSvgTint(tint);
  const svg = t.mode === 'none' ? base : applySvgTint(base, t);
  return { svgBase: base, svgTint: t, src: encodeSvgDataUri(svg) };
}

function syncSvgTintProps(layer) {
  const t = normalizeSvgTint(layer?.svgTint);
  setVal('propSvgTintMode', t.mode);
  setVal('propSvgTintColor', t.color);
  setVal('propSvgTintGradType', t.gradientType);
  setVal('propSvgTintAngle', t.angle);
  setVal('propSvgTintStopAColor', t.stops[0].color);
  setVal('propSvgTintStopAAlpha', t.stops[0].alpha);
  setVal('propSvgTintStopBColor', t.stops[1].color);
  setVal('propSvgTintStopBAlpha', t.stops[1].alpha);

  const solid = $('svgTintSolidField');
  if (solid) solid.hidden = t.mode !== 'solid';
  const grad = $('svgTintGradientFields');
  if (grad) grad.hidden = t.mode !== 'gradient';
  const angle = $('svgTintAngleField');
  if (angle) angle.hidden = t.gradientType === 'radial';
}

function readSvgTintFromUi() {
  return normalizeSvgTint({
    mode: $('propSvgTintMode')?.value || 'none',
    color: $('propSvgTintColor')?.value || '#0A0714',
    gradientType: $('propSvgTintGradType')?.value || 'linear',
    angle: Number($('propSvgTintAngle')?.value) || 0,
    stops: [
      { color: $('propSvgTintStopAColor')?.value, alpha: Number($('propSvgTintStopAAlpha')?.value) },
      { color: $('propSvgTintStopBColor')?.value, alpha: Number($('propSvgTintStopBAlpha')?.value) },
    ],
  });
}

/** Writes svgTint + a freshly baked src; src stays the single source of truth for render and export. */
function applySvgTintFromUi(opts = {}) {
  const targets = selectedLayers().filter(isInlineSvgLayer);
  if (!targets.length) return;
  const writable = targets.filter((l) => !layerLocked(l));
  if (!writable.length) {
    showToast('Layer bloccato — sblocca per modificare');
    return;
  }
  const tint = readSvgTintFromUi();
  const patches = writable
    .map((l) => ({ layer: l, patch: svgTintedLayerPatch(l, tint) }))
    .filter((p) => p.patch);
  if (!patches.length) {
    showToast('SVG non leggibile: ricolorazione non applicata');
    return;
  }
  if (opts.debounce) {
    beginPropHistory();
    clearTimeout(propHistoryTimer);
    propHistoryTimer = setTimeout(commitPropHistory, 450);
  } else {
    pushHistory();
  }
  patches.forEach(({ layer, patch }) => Object.assign(layer, patch));
  markDirty();
  render();
}

function bindSvgTintProps() {
  $('propSvgTintMode')?.addEventListener('change', () => {
    syncSvgTintProps({ svgTint: readSvgTintFromUi() });
    applySvgTintFromUi();
  });
  $('propSvgTintGradType')?.addEventListener('change', () => {
    syncSvgTintProps({ svgTint: readSvgTintFromUi() });
    applySvgTintFromUi();
  });
  ['propSvgTintColor', 'propSvgTintStopAColor', 'propSvgTintStopBColor'].forEach((id) => {
    $(id)?.addEventListener('input', () => applySvgTintFromUi({ debounce: true }));
    $(id)?.addEventListener('change', () => applySvgTintFromUi());
  });
  ['propSvgTintAngle', 'propSvgTintStopAAlpha', 'propSvgTintStopBAlpha'].forEach((id) => {
    $(id)?.addEventListener('input', () => applySvgTintFromUi({ debounce: true }));
    $(id)?.addEventListener('change', () => applySvgTintFromUi());
  });
}

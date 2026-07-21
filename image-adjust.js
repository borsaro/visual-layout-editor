/** Image color adjust: brightness / contrast / saturate / vivid (DOM + canvas). */

function defaultImageAdjust() {
  return { brightness: 0, contrast: 0, saturate: 0, vivid: 0 };
}

function clampAdjust(n, min, max) {
  const v = Number(n);
  if (Number.isNaN(v)) return 0;
  return Math.max(min, Math.min(max, v));
}

function normalizeImageAdjust(adj) {
  const a = adj && typeof adj === 'object' ? adj : {};
  return {
    brightness: clampAdjust(a.brightness, -100, 100),
    contrast: clampAdjust(a.contrast, -100, 100),
    saturate: clampAdjust(a.saturate, -100, 100),
    vivid: clampAdjust(a.vivid, 0, 100),
  };
}

function imageAdjustActive(adj) {
  const v = normalizeImageAdjust(adj);
  return !!(v.brightness || v.contrast || v.saturate || v.vivid);
}

/** CSS/canvas filter fragments (identity omitted). */
function imageAdjustFilterParts(adj) {
  const v = normalizeImageAdjust(adj);
  const brightness = 1 + v.brightness / 100;
  const contrast = (1 + v.contrast / 100) * (1 + v.vivid / 400);
  const saturate = 1 + v.saturate / 100 + v.vivid / 80;
  const parts = [];
  if (Math.abs(brightness - 1) > 0.001) parts.push(`brightness(${brightness})`);
  if (Math.abs(contrast - 1) > 0.001) parts.push(`contrast(${contrast})`);
  if (Math.abs(saturate - 1) > 0.001) parts.push(`saturate(${saturate})`);
  return parts;
}

function imageAdjustFilterCss(adj) {
  return imageAdjustFilterParts(adj).join(' ');
}

function composeImageDomFilter(layer) {
  const parts = imageAdjustFilterParts(layer && layer.adjust);
  if (typeof shadowCss === 'function') {
    const s = shadowCss(layer && layer.shadow);
    if (s) parts.push(`drop-shadow(${s})`);
  }
  return parts.join(' ');
}

function syncImageAdjustProps(layer) {
  const v = normalizeImageAdjust(layer && layer.adjust);
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  set('propBright', v.brightness);
  set('propContrast', v.contrast);
  set('propSaturate', v.saturate);
  set('propVivid', v.vivid);
}

function readImageAdjustFromUi() {
  const num = (id) => Number(document.getElementById(id)?.value) || 0;
  const adj = normalizeImageAdjust({
    brightness: num('propBright'),
    contrast: num('propContrast'),
    saturate: num('propSaturate'),
    vivid: num('propVivid'),
  });
  if (!imageAdjustActive(adj)) return null;
  return adj;
}

/** Black-key / luminance key for image layers (DOM preview + canvas export). */

function defaultKeyBlack() {
  return { enabled: true, threshold: 16, softness: 40 };
}

function keyBlackEnabled(layer) {
  const k = layer && layer.keyBlack;
  return !!(k && k.enabled === true);
}

function keyBlackParams(layer) {
  const k = layer.keyBlack || {};
  return {
    threshold: Math.max(0, Number(k.threshold) ?? 16),
    softness: Math.max(0, Number(k.softness) ?? 40),
  };
}

function applyBlackKeyToImageData(imageData, threshold, softness) {
  const d = imageData.data;
  const soft = Math.max(1, softness);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let a = (lum - threshold) / soft;
    if (a <= 0) { d[i + 3] = 0; continue; }
    if (a > 1) a = 1;
    // Unpremultiply-style: restore color intensity after alpha from luminance
    if (a < 1 && a > 0) {
      d[i] = Math.min(255, r / a);
      d[i + 1] = Math.min(255, g / a);
      d[i + 2] = Math.min(255, b / a);
    }
    d[i + 3] = Math.round(a * (d[i + 3] / 255) * 255);
  }
  return imageData;
}

function processImageForKey(img, layer) {
  if (!keyBlackEnabled(layer)) return img;
  const { threshold, softness } = keyBlackParams(layer);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  applyBlackKeyToImageData(data, threshold, softness);
  ctx.putImageData(data, 0, 0);
  return c;
}

function syncKeyBlackProps(layer) {
  const on = keyBlackEnabled(layer);
  const en = document.getElementById('propKeyBlackEnabled');
  if (en) en.checked = on;
  const p = layer.keyBlack || defaultKeyBlack();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('propKeyThreshold', Number(p.threshold) ?? 16);
  set('propKeySoftness', Number(p.softness) ?? 40);
}

function readKeyBlackFromUi() {
  const enabled = !!document.getElementById('propKeyBlackEnabled')?.checked;
  if (!enabled) return null;
  return {
    enabled: true,
    threshold: Number(document.getElementById('propKeyThreshold')?.value) || 0,
    softness: Number(document.getElementById('propKeySoftness')?.value) || 0,
  };
}

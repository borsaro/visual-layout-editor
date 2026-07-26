/** Color key for image layers (DOM preview + canvas export). */

function defaultKeyBlack() {
  return { enabled: true, color: '#000000', threshold: 16, softness: 40 };
}

function keyBlackEnabled(layer) {
  const k = layer && layer.keyBlack;
  return !!(k && k.enabled === true);
}

function keyBlackParams(layer) {
  const k = layer.keyBlack || {};
  return {
    color: /^#[0-9a-f]{6}$/i.test(k.color || '') ? k.color : null,
    threshold: Math.max(0, Number(k.threshold) ?? 16),
    softness: Math.max(0, Number(k.softness) ?? 40),
  };
}

function hexToRgb(hex) {
  const n = Number.parseInt(String(hex).slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function applyColorKeyToImageData(imageData, color, threshold, softness) {
  const d = imageData.data;
  const key = hexToRgb(color);
  const soft = Math.max(1, softness);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const dr = r - key.r, dg = g - key.g, db = b - key.b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
    let a = (distance - threshold) / soft;
    if (a <= 0) { d[i + 3] = 0; continue; }
    if (a > 1) a = 1;
    if (a < 1 && a > 0) {
      d[i] = Math.max(0, Math.min(255, (r - key.r * (1 - a)) / a));
      d[i + 1] = Math.max(0, Math.min(255, (g - key.g * (1 - a)) / a));
      d[i + 2] = Math.max(0, Math.min(255, (b - key.b * (1 - a)) / a));
    }
    d[i + 3] = Math.round(a * (d[i + 3] / 255) * 255);
  }
  return imageData;
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
  const { color, threshold, softness } = keyBlackParams(layer);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  if (color) applyColorKeyToImageData(data, color, threshold, softness);
  else applyBlackKeyToImageData(data, threshold, softness);
  ctx.putImageData(data, 0, 0);
  return c;
}

function syncKeyBlackProps(layer) {
  const on = keyBlackEnabled(layer);
  const en = document.getElementById('propKeyBlackEnabled');
  if (en) en.checked = on;
  const p = layer.keyBlack || defaultKeyBlack();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('propKeyColor', p.color || '#000000');
  set('propKeyThreshold', Number(p.threshold) ?? 16);
  set('propKeySoftness', Number(p.softness) ?? 40);
}

function readKeyBlackFromUi() {
  const enabled = !!document.getElementById('propKeyBlackEnabled')?.checked;
  if (!enabled) return null;
  return {
    enabled: true,
    color: document.getElementById('propKeyColor')?.value || '#000000',
    threshold: Number(document.getElementById('propKeyThreshold')?.value) || 0,
    softness: Number(document.getElementById('propKeySoftness')?.value) || 0,
  };
}

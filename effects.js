function defaultShadow() {
  return { color: '#000000', blur: 12, offsetX: 0, offsetY: 4, opacity: 0.55 };
}

function defaultGlow() {
  return { color: '#ffffff', blur: 18, opacity: 0.75 };
}

function effectEnabled(fx) {
  return !!(fx && fx.enabled !== false && (Number(fx.blur) > 0 || Number(fx.offsetX) || Number(fx.offsetY)));
}

function colorWithOpacity(color, opacity) {
  const hex = String(color || '#000000').trim();
  const a = Math.max(0, Math.min(1, Number(opacity) ?? 1));
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return `rgba(0,0,0,${a})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function shadowCss(shadow) {
  if (!effectEnabled(shadow)) return '';
  const c = colorWithOpacity(shadow.color, shadow.opacity);
  return `${Number(shadow.offsetX) || 0}px ${Number(shadow.offsetY) || 0}px ${Number(shadow.blur) || 0}px ${c}`;
}

/** Extra pixels needed so overflow:hidden parents do not box-clip blur/offset. */
function shadowBleedPx(shadow, glow) {
  let bleed = 0;
  if (effectEnabled(shadow)) {
    bleed = Math.max(
      bleed,
      Math.ceil(Math.abs(Number(shadow.offsetX) || 0) + Math.abs(Number(shadow.offsetY) || 0) + (Number(shadow.blur) || 0) * 2 + 2),
    );
  }
  if (effectEnabled(glow)) {
    bleed = Math.max(bleed, Math.ceil((Number(glow.blur) || 0) * 3 + 2));
  }
  return bleed;
}

function glowCss(glow) {
  if (!effectEnabled(glow)) return '';
  const c = colorWithOpacity(glow.color, glow.opacity);
  const b = Number(glow.blur) || 0;
  return `0 0 ${b}px ${c}, 0 0 ${b * 2}px ${c}`;
}

/** Apply DOM effects. For images pass the <img> (or keyed bitmap), not the clipped parent. */
function applyLayerEffectsDom(el, layer) {
  if (!el) return;
  if (layer.type === 'text') {
    const parts = [shadowCss(layer.shadow), glowCss(layer.glow)].filter(Boolean);
    el.style.textShadow = parts.length ? parts.join(', ') : '';
    el.style.filter = '';
    return;
  }
  if (layer.type === 'image' || layer.type === 'rect' || layer.type === 'gradient') {
    const s = shadowCss(layer.shadow);
    el.style.filter = s ? `drop-shadow(${s})` : '';
    el.style.textShadow = '';
  }
}

function applyCanvasShadow(ctx, shadow) {
  if (!effectEnabled(shadow)) {
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    return;
  }
  ctx.shadowColor = colorWithOpacity(shadow.color, shadow.opacity);
  ctx.shadowBlur = Number(shadow.blur) || 0;
  ctx.shadowOffsetX = Number(shadow.offsetX) || 0;
  ctx.shadowOffsetY = Number(shadow.offsetY) || 0;
}

function applyCanvasGlow(ctx, glow) {
  if (!effectEnabled(glow)) return false;
  ctx.shadowColor = colorWithOpacity(glow.color, glow.opacity);
  ctx.shadowBlur = Number(glow.blur) || 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  return true;
}

function clearCanvasShadow(ctx) {
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function effectToHex(color, fallback) {
  const v = color || fallback || '#000000';
  if (typeof rgbToHex === 'function') return rgbToHex(v);
  return String(v).startsWith('#') ? v : fallback || '#000000';
}

function syncEffectInputs(prefix, fx, defaults) {
  const src = fx && fx.enabled !== false ? fx : defaults;
  const en = document.getElementById(prefix + 'Enabled');
  if (en) en.checked = !!(fx && fx.enabled !== false);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set(prefix + 'Color', effectToHex(src.color, defaults.color));
  set(prefix + 'Blur', Number(src.blur) || defaults.blur || 0);
  set(prefix + 'Opacity', src.opacity != null ? Number(src.opacity) : defaults.opacity);
  if (prefix === 'propShadow') {
    set(prefix + 'OffsetX', Number(src.offsetX) || 0);
    set(prefix + 'OffsetY', Number(src.offsetY) || 0);
  }
}

function readEffectFromUi(prefix, withOffset) {
  const enabled = !!document.getElementById(prefix + 'Enabled')?.checked;
  if (!enabled) return null;
  const num = (id, d = 0) => Number(document.getElementById(id)?.value) || d;
  const color = document.getElementById(prefix + 'Color')?.value || '#000000';
  const fx = {
    enabled: true,
    color,
    blur: num(prefix + 'Blur', 0),
    opacity: num(prefix + 'Opacity', 0.5),
  };
  if (withOffset) {
    fx.offsetX = num(prefix + 'OffsetX', 0);
    fx.offsetY = num(prefix + 'OffsetY', 0);
  }
  return fx;
}

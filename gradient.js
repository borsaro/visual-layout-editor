function defaultGradient() {
  return {
    id: uid(),
    type: 'gradient',
    name: 'Gradiente',
    x: 0,
    y: 900,
    w: 1080,
    h: 450,
    z: nextZ(),
    opacity: 1,
    rotation: 0,
    gradientType: 'linear',
    angle: 180,
    stops: [
      { offset: 0, color: '#000000', alpha: 0 },
      { offset: 1, color: '#000000', alpha: 0.72 },
    ],
  };
}

function stopCssColor(stop) {
  const a = stop.alpha != null ? Number(stop.alpha) : 1;
  return colorWithOpacity(stop.color || '#000000', a);
}

function normalizeStops(stops) {
  const list = Array.isArray(stops) && stops.length ? stops : defaultGradient().stops;
  return [...list]
    .map((s) => ({
      offset: Math.max(0, Math.min(1, Number(s.offset) || 0)),
      color: s.color || '#000000',
      alpha: s.alpha != null ? Number(s.alpha) : 1,
    }))
    .sort((a, b) => a.offset - b.offset);
}

function gradientCssBackground(layer) {
  const stops = normalizeStops(layer.stops)
    .map((s) => `${stopCssColor(s)} ${Math.round(s.offset * 100)}%`)
    .join(', ');
  if ((layer.gradientType || 'linear') === 'radial') {
    return `radial-gradient(circle at center, ${stops})`;
  }
  const angle = Number(layer.angle) || 180;
  return `linear-gradient(${angle}deg, ${stops})`;
}

function createCanvasGradient(ctx, layer) {
  const stops = normalizeStops(layer.stops);
  let g;
  if ((layer.gradientType || 'linear') === 'radial') {
    const cx = layer.x + layer.w / 2;
    const cy = layer.y + layer.h / 2;
    const r = Math.max(layer.w, layer.h) / 2;
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  } else {
    const angle = ((Number(layer.angle) || 180) - 90) * Math.PI / 180;
    const cx = layer.x + layer.w / 2;
    const cy = layer.y + layer.h / 2;
    const dx = Math.cos(angle) * layer.w / 2;
    const dy = Math.sin(angle) * layer.h / 2;
    g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  }
  stops.forEach((s) => g.addColorStop(s.offset, stopCssColor(s)));
  return g;
}

function drawCanvasGradient(ctx, layer) {
  applyCanvasShadow(ctx, layer.shadow);
  ctx.fillStyle = createCanvasGradient(ctx, layer);
  const x = layer.x, y = layer.y, w = layer.w, h = layer.h;
  let r = Math.min(Number(layer.radius) || 0, w / 2, h / 2);
  if (r > 0) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
  clearCanvasShadow(ctx);
}

function syncGradientProps(layer) {
  setVal('propGradientType', layer.gradientType || 'linear');
  setVal('propGradientAngle', Number(layer.angle) || 180);
  const stops = normalizeStops(layer.stops);
  const a = stops[0] || { color: '#000000', alpha: 0, offset: 0 };
  const b = stops[stops.length - 1] || { color: '#000000', alpha: 0.7, offset: 1 };
  setVal('propGradStopAColor', typeof rgbToHex === 'function' ? rgbToHex(a.color) : a.color);
  setVal('propGradStopAAlpha', a.alpha);
  setVal('propGradStopBColor', typeof rgbToHex === 'function' ? rgbToHex(b.color) : b.color);
  setVal('propGradStopBAlpha', b.alpha);
}

function readGradientStopsFromUi() {
  return [
    {
      offset: 0,
      color: $('propGradStopAColor')?.value || '#000000',
      alpha: Number($('propGradStopAAlpha')?.value) || 0,
    },
    {
      offset: 1,
      color: $('propGradStopBColor')?.value || '#000000',
      alpha: Number($('propGradStopBAlpha')?.value) || 0,
    },
  ];
}

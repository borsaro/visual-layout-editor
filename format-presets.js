/** Canvas format presets (shared by preset select + duplicate-to-format). */

const FORMAT_PRESETS = [
  { w: 1280, h: 720, label: 'YouTube thumbnail · 1280×720', priority: 'high' },
  { w: 1080, h: 1920, label: 'Shorts / Reels / TikTok · 1080×1920', priority: 'high' },
  { w: 1080, h: 1350, label: 'Instagram feed · 1080×1350', priority: 'high' },
  { w: 1080, h: 1080, label: 'Quadrato · 1080×1080', priority: 'medium' },
  { w: 1200, h: 630, label: 'Anteprima link · 1200×630', priority: 'medium' },
  { w: 2560, h: 1440, label: 'Banner canale YouTube · 2560×1440', priority: 'medium' },
];

function formatKey(w, h) {
  return `${Number(w)}x${Number(h)}`;
}

function findFormatPreset(w, h) {
  return FORMAT_PRESETS.find((p) => p.w === Number(w) && p.h === Number(h)) || null;
}

function populateFormatSelect(selectEl, opts = {}) {
  if (!selectEl) return;
  const {
    includeCustom = false,
    selected = null,
    excludeWh = null,
  } = opts;
  const prev = selected || selectEl.value;
  selectEl.innerHTML = '';
  const high = document.createElement('optgroup');
  high.label = 'Priorità alta';
  const med = document.createElement('optgroup');
  med.label = 'Priorità media';
  FORMAT_PRESETS.forEach((p) => {
    if (excludeWh && p.w === excludeWh.w && p.h === excludeWh.h) return;
    const opt = document.createElement('option');
    opt.value = formatKey(p.w, p.h);
    opt.textContent = p.label;
    (p.priority === 'high' ? high : med).appendChild(opt);
  });
  if (high.childElementCount) selectEl.appendChild(high);
  if (med.childElementCount) selectEl.appendChild(med);
  if (includeCustom) {
    const opt = document.createElement('option');
    opt.value = 'custom';
    opt.textContent = 'Custom';
    selectEl.appendChild(opt);
  }
  if (prev && [...selectEl.options].some((o) => o.value === prev)) selectEl.value = prev;
}

/** Scale layout canvas + layers from current size to target (independent sx/sy). */
function scaleLayoutToFormat(layout, targetW, targetH) {
  const srcW = Number(layout.canvas?.width) || 1;
  const srcH = Number(layout.canvas?.height) || 1;
  const tw = Number(targetW);
  const th = Number(targetH);
  if (!tw || !th || (srcW === tw && srcH === th)) return layout;
  const sx = tw / srcW;
  const sy = th / srcH;
  const sFont = Math.sqrt(sx * sy);

  const scaleNum = (v, s) => Math.round((Number(v) || 0) * s * 1000) / 1000;

  const layers = (layout.layers || []).map((layer) => {
    const l = JSON.parse(JSON.stringify(layer));
    l.x = scaleNum(l.x, sx);
    l.y = scaleNum(l.y, sy);
    l.w = Math.max(1, scaleNum(l.w, sx));
    l.h = Math.max(1, scaleNum(l.h, sy));
    if (l.fontSize != null) l.fontSize = Math.max(1, scaleNum(l.fontSize, sFont));
    if (l.letterSpacing != null) l.letterSpacing = scaleNum(l.letterSpacing, sFont);
    if (l.strokeWidth != null) l.strokeWidth = Math.max(0, scaleNum(l.strokeWidth, sFont));
    if (l.radius != null) l.radius = Math.max(0, scaleNum(l.radius, Math.min(sx, sy)));
    if (l.shadow && typeof l.shadow === 'object') {
      if (l.shadow.blur != null) l.shadow.blur = Math.max(0, scaleNum(l.shadow.blur, sFont));
      if (l.shadow.offsetX != null) l.shadow.offsetX = scaleNum(l.shadow.offsetX, sx);
      if (l.shadow.offsetY != null) l.shadow.offsetY = scaleNum(l.shadow.offsetY, sy);
    }
    if (l.glow && typeof l.glow === 'object' && l.glow.blur != null) {
      l.glow.blur = Math.max(0, scaleNum(l.glow.blur, sFont));
    }
    return l;
  });

  return {
    ...layout,
    canvas: {
      ...(layout.canvas || {}),
      width: tw,
      height: th,
    },
    layers,
  };
}

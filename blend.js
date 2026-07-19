const BLEND_MODES = [
  { value: 'normal', label: 'Normale', css: 'normal', canvas: 'source-over' },
  { value: 'screen', label: 'Schermo', css: 'screen', canvas: 'screen' },
  { value: 'multiply', label: 'Moltiplica', css: 'multiply', canvas: 'multiply' },
  { value: 'overlay', label: 'Sovrapponi', css: 'overlay', canvas: 'overlay' },
  { value: 'lighter', label: 'Più chiaro', css: 'plus-lighter', canvas: 'lighter' },
];

const BLEND_BY_VALUE = Object.fromEntries(BLEND_MODES.map((m) => [m.value, m]));

function normalizeBlendMode(value) {
  if (!value || value === 'source-over') return 'normal';
  return BLEND_BY_VALUE[value] ? value : 'normal';
}

function blendCss(value) {
  return (BLEND_BY_VALUE[normalizeBlendMode(value)] || BLEND_BY_VALUE.normal).css;
}

function blendCanvas(value) {
  return (BLEND_BY_VALUE[normalizeBlendMode(value)] || BLEND_BY_VALUE.normal).canvas;
}

function applyBlendDom(el, layer) {
  const mode = normalizeBlendMode(layer.blendMode);
  el.style.mixBlendMode = mode === 'normal' ? '' : blendCss(mode);
}

function applyBlendCanvas(ctx, layer) {
  ctx.globalCompositeOperation = blendCanvas(layer.blendMode);
}

function populateBlendSelect(selectEl, currentValue) {
  if (!selectEl) return;
  const prev = normalizeBlendMode(currentValue || selectEl.value);
  selectEl.innerHTML = '';
  BLEND_MODES.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    selectEl.appendChild(opt);
  });
  selectEl.value = prev;
}

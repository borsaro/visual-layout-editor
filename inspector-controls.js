/** Inspector-only UI enhancements: linked sliders, segmented controls and icons. */

const INSPECTOR_SLIDERS = {
  propOpacity: [0, 1, 0.01],
  propRotation: [-180, 180, 1],
  propLineHeight: [0.5, 3, 0.05],
  propLetterSpacing: [-20, 100, 0.5],
  propStrokeWidth: [0, 100, 1],
  propRadius: [0, 500, 1],
  propGradientAngle: [0, 360, 1],
  propGradStopAAlpha: [0, 1, 0.01],
  propGradStopBAlpha: [0, 1, 0.01],
  propBright: [-100, 100, 1],
  propContrast: [-100, 100, 1],
  propSaturate: [-100, 100, 1],
  propVivid: [0, 100, 1],
  propKeyThreshold: [0, 255, 1],
  propKeySoftness: [0, 255, 1],
  propShadowOpacity: [0, 1, 0.01],
  propShadowBlur: [0, 100, 1],
  propShadowOffsetX: [-100, 100, 1],
  propShadowOffsetY: [-100, 100, 1],
  propGlowOpacity: [0, 1, 0.01],
  propGlowBlur: [0, 100, 1],
};

const ALIGN_LABELS = {
  left: 'Allinea a sinistra',
  hcenter: 'Centra orizzontalmente',
  right: 'Allinea a destra',
  top: 'Allinea in alto',
  vcenter: 'Centra verticalmente',
  bottom: 'Allinea in basso',
  distributeH: 'Distribuisci orizzontalmente',
  distributeV: 'Distribuisci verticalmente',
};

function alignIcon(name) {
  const lines = {
    left: '<path d="M4 3v18M7 7h11M7 12h7M7 17h9"/>',
    hcenter: '<path d="M12 3v18M6 7h12M8 12h8M7 17h10"/>',
    right: '<path d="M20 3v18M6 7h11M10 12h7M8 17h9"/>',
    top: '<path d="M3 4h18M7 7v11M12 7v7M17 7v9"/>',
    vcenter: '<path d="M3 12h18M7 6v12M12 8v8M17 7v10"/>',
    bottom: '<path d="M3 20h18M7 6v11M12 10v7M17 8v9"/>',
    distributeH: '<path d="M4 3v18M20 3v18M8 7v10M16 7v10M12 5v14"/>',
    distributeV: '<path d="M3 4h18M3 20h18M7 8h10M7 16h10M5 12h14"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${lines[name] || ''}</svg>`;
}

function enhanceNumericInput(input, config) {
  if (!input || input.dataset.sliderBound) return;
  input.dataset.sliderBound = '1';
  const [min, max, step] = config;
  const wrap = document.createElement('span');
  wrap.className = 'quickValue';
  input.before(wrap);
  wrap.appendChild(input);
  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'quickRange';
  Object.assign(range, { min, max, step, value: input.value || min });
  range.setAttribute('aria-label', `${input.closest('label')?.textContent.trim() || input.id} slider`);
  wrap.appendChild(range);
  const syncRange = () => { range.value = String(Math.max(min, Math.min(max, Number(input.value) || 0))); };
  input._syncQuickRange = syncRange;
  input.addEventListener('input', syncRange);
  range.addEventListener('input', () => {
    input.value = range.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  range.addEventListener('change', () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

function enhanceNumberKeys(input) {
  input.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || (!event.shiftKey && !event.altKey)) return;
    event.preventDefault();
    const base = Number(input.step) || 1;
    const step = event.shiftKey ? base * 10 : base / 10;
    const direction = event.key === 'ArrowUp' ? 1 : -1;
    input.value = String((Number(input.value) || 0) + direction * step);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function createSegmentedControl(select, values) {
  if (!select || select.dataset.segmentedBound) return;
  select.dataset.segmentedBound = '1';
  select.classList.add('segmentedSource');
  const group = document.createElement('span');
  group.className = 'segmentedControl';
  values.forEach(([value, label, icon]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.value = value;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = alignIcon(icon);
    button.onclick = () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    group.appendChild(button);
  });
  select.after(group);
  const sync = () => group.querySelectorAll('button').forEach(
    button => button.classList.toggle('active', button.dataset.value === select.value)
  );
  select._syncSegmented = sync;
  select.addEventListener('change', sync);
  sync();
}

function enhanceAlignmentButtons() {
  document.querySelectorAll('[data-canvas-align], [data-align-action]').forEach(button => {
    const action = button.dataset.canvasAlign || button.dataset.alignAction;
    const label = ALIGN_LABELS[action] || button.textContent.trim();
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = alignIcon(action);
  });
}

function bindCollapsibleSections() {
  document.querySelectorAll('.inspectorSection.collapsible').forEach(section => {
    const title = section.querySelector(':scope > .inspectorSectionTitle');
    if (!title) return;
    title.tabIndex = 0;
    title.setAttribute('role', 'button');
    const toggle = () => section.classList.toggle('isCollapsed');
    title.onclick = toggle;
    title.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
    };
  });
}

function initInspectorControls() {
  Object.entries(INSPECTOR_SLIDERS).forEach(([id, config]) => enhanceNumericInput(document.getElementById(id), config));
  document.querySelectorAll('.panel.right input[type="number"]').forEach(enhanceNumberKeys);
  createSegmentedControl(document.getElementById('propAlign'), [
    ['left', 'Testo a sinistra', 'left'], ['center', 'Testo centrato', 'hcenter'], ['right', 'Testo a destra', 'right'],
  ]);
  createSegmentedControl(document.getElementById('propVAlign'), [
    ['top', 'Testo in alto', 'top'], ['middle', 'Testo al centro', 'vcenter'], ['bottom', 'Testo in basso', 'bottom'],
  ]);
  enhanceAlignmentButtons();
  bindCollapsibleSections();
}

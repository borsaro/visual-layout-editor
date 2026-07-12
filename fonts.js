const FONT_CATALOG = [
  { value: 'Arial', label: 'Arial' },
  { value: 'Arial Bold', label: 'Arial Bold' },
  { value: 'DIN Condensed Bold', label: 'DIN Condensed Bold (brand)' },
  { value: 'DIN Condensed', label: 'DIN Condensed (brand)' },
  { value: 'Helvetica Neue', label: 'Helvetica Neue' },
  { value: 'Impact', label: 'Impact' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Times New Roman', label: 'Times New Roman' },
];

function collectLayoutFontFamilies(layers) {
  const values = new Set();
  (layers || []).forEach((layer) => {
    if (layer.type !== 'text') return;
    const ff = layer.fontFamily || layer.font;
    if (ff) values.add(ff);
  });
  return values;
}

function populateFontSelect(currentValue, extraValues) {
  const sel = document.getElementById('propFontFamily');
  if (!sel) return;
  const catalogValues = new Set(FONT_CATALOG.map((f) => f.value));
  const extras = new Set(extraValues || []);
  collectLayoutFontFamilies(window.state?.layers).forEach((v) => extras.add(v));
  if (currentValue) extras.add(currentValue);

  const prev = currentValue || sel.value || 'Arial';
  sel.innerHTML = '';
  FONT_CATALOG.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.value;
    opt.textContent = f.label;
    sel.appendChild(opt);
  });

  [...extras]
    .filter((v) => v && !catalogValues.has(v))
    .sort((a, b) => a.localeCompare(b))
    .forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = `${v} (dal layout)`;
      sel.appendChild(opt);
    });

  sel.value = [...sel.options].some((o) => o.value === prev) ? prev : 'Arial';
}

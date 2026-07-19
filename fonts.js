const FONT_CATALOG = [
  { value: 'Arial', label: 'Arial' },
  { value: 'Arial Bold', label: 'Arial Bold' },
  { value: 'DIN Condensed Bold', label: 'DIN Condensed Bold (brand)' },
  { value: 'DIN Condensed', label: 'DIN Condensed (brand)' },
  { value: 'Oswald', label: 'Oswald', google: 'Oswald:wght@400;500;600;700' },
  { value: 'Montserrat', label: 'Montserrat', google: 'Montserrat:wght@400;600;700;800' },
  { value: 'Roboto Condensed', label: 'Roboto Condensed', google: 'Roboto+Condensed:wght@400;700' },
  { value: 'Bebas Neue', label: 'Bebas Neue', google: 'Bebas+Neue' },
  { value: 'Open Sans', label: 'Open Sans', google: 'Open+Sans:wght@400;600;700' },
  { value: 'Helvetica Neue', label: 'Helvetica Neue' },
  { value: 'Impact', label: 'Impact' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Times New Roman', label: 'Times New Roman' },
];

const _googleLoaded = new Set();

function ensureGoogleFont(familySpec) {
  if (!familySpec || _googleLoaded.has(familySpec)) return;
  _googleLoaded.add(familySpec);
  const id = 'gf-' + familySpec.replace(/[^A-Za-z0-9]+/g, '-');
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${familySpec}&display=swap`;
  document.head.appendChild(link);
}

function ensureCatalogGoogleFonts() {
  FONT_CATALOG.forEach((f) => { if (f.google) ensureGoogleFont(f.google); });
}

function loadCustomFont(family, url) {
  const name = String(family || '').trim();
  const src = String(url || '').trim();
  if (!name || !src) throw new Error('Serve famiglia e URL del font');
  const face = new FontFace(name, `url(${src})`);
  return face.load().then((loaded) => {
    document.fonts.add(loaded);
    if (!FONT_CATALOG.some((f) => f.value === name)) {
      FONT_CATALOG.push({ value: name, label: `${name} (custom)` });
    }
    return name;
  });
}

function fontAvailable(family, sampleSize = 48) {
  const name = String(family || '').trim();
  if (!name) return true;
  try {
    if (document.fonts && typeof document.fonts.check === 'function') {
      // check() can false-negative before load; treat "loaded or local" loosely
      if (document.fonts.check(`${sampleSize}px "${name}"`)) return true;
      if (document.fonts.check(`bold ${sampleSize}px "${name}"`)) return true;
    }
  } catch (_) { /* ignore */ }
  // Fallback: measure vs Arial
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const sample = 'mmmmmmmmmwwwwwww@';
  ctx.font = `${sampleSize}px Arial`;
  const base = ctx.measureText(sample).width;
  ctx.font = `${sampleSize}px "${name}", Arial`;
  const mixed = ctx.measureText(sample).width;
  ctx.font = `${sampleSize}px "${name}"`;
  const only = ctx.measureText(sample).width;
  return Math.abs(mixed - base) > 0.5 || Math.abs(only - base) > 0.5;
}

async function waitForFont(family, timeoutMs = 2500) {
  const name = String(family || '').trim();
  if (!name) return true;
  const entry = FONT_CATALOG.find((f) => f.value === name);
  if (entry?.google) ensureGoogleFont(entry.google);
  try {
    await Promise.race([
      document.fonts.load(`400 48px "${name}"`),
      document.fonts.load(`700 48px "${name}"`),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);
  } catch (_) { /* ignore */ }
  return fontAvailable(name);
}

function updateFontAvailabilityHint(family) {
  const hint = document.getElementById('fontAvailabilityHint');
  if (!hint) return;
  const name = String(family || '').trim();
  if (!name) { hint.textContent = ''; hint.className = 'muted hint'; return; }
  waitForFont(name).then((ok) => {
    if (ok) {
      hint.textContent = `Font disponibile: ${name}`;
      hint.className = 'muted hint fontOk';
    } else {
      hint.textContent = `Font non disponibile: “${name}”. Il browser userà un sostituto. Carica un file locale o Google Font.`;
      hint.className = 'muted hint fontMissing';
    }
  });
}

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
  ensureCatalogGoogleFonts();
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
  updateFontAvailabilityHint(sel.value);
}

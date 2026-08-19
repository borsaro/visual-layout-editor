/** Host Font Book fonts via GET /api/fonts (Docker-mounted Mac fonts). */
let HOST_FONTS = [];
let _hostFontsLoading = null;
const _faceLoads = new Map();

function fontAvailable(family, sampleSize = 48) {
  const name = String(family || '').trim();
  if (!name) return true;
  try {
    if (document.fonts?.check?.(`${sampleSize}px "${name}"`)) return true;
  } catch (_) { /* ignore */ }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const sample = 'mmmmmmmmmwwwwwww@';
  ctx.font = `${sampleSize}px sans-serif`;
  const base = ctx.measureText(sample).width;
  ctx.font = `${sampleSize}px "${name}", sans-serif`;
  const mixed = ctx.measureText(sample).width;
  ctx.font = `${sampleSize}px "${name}"`;
  const only = ctx.measureText(sample).width;
  return Math.abs(mixed - base) > 0.5 || Math.abs(only - base) > 0.5;
}

async function ensureHostFont(family) {
  const name = String(family || '').trim();
  if (!name) return true;
  if (fontAvailable(name)) return true;
  const entry = HOST_FONTS.find((f) => f.family === name);
  if (!entry?.url) return false;
  if (!_faceLoads.has(name)) {
    _faceLoads.set(name, (async () => {
      const face = new FontFace(name, `url(${entry.url})`);
      const loaded = await face.load();
      document.fonts.add(loaded);
      return true;
    })().catch((err) => {
      _faceLoads.delete(name);
      console.warn('Host font load failed:', name, err);
      return false;
    }));
  }
  return _faceLoads.get(name);
}

async function waitForFont(family, timeoutMs = 2500) {
  const name = String(family || '').trim();
  if (!name) return true;
  try {
    await Promise.race([
      ensureHostFont(name),
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
      hint.textContent = `Font non disponibile: “${name}”.`;
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

/** Load local/custom font files declared by editable text layers (legacy layouts). */
async function ensureLayoutCustomFonts(layers) {
  const tasks = [];
  (layers || []).forEach((layer) => {
    if (layer.type !== 'text') return;
    const family = String(layer.fontFamily || layer.font || '').trim();
    const source = String(layer.fontSource || '').trim();
    if (!family || !source) return;
    const url = typeof resolveAssetUrl === 'function' ? resolveAssetUrl(source) : source;
    // Keyed by family alone, not by family+url: a second face registered under a name
    // that is already loaded leaves the canvas resolving that name to nothing, and the
    // text silently falls back to a system font with different metrics. It shows up
    // when one page renders several layouts in a row — the variant thumbnails — where
    // the same family arrives from each layout's own copy of the file.
    const key = `src:${family}`;
    if (!_faceLoads.has(key)) {
      _faceLoads.set(key, (async () => {
        const face = new FontFace(family, `url(${url})`);
        document.fonts.add(await face.load());
        return true;
      })().catch((error) => {
        _faceLoads.delete(key);
        console.warn(`Custom font load failed: ${family}`, error);
        return false;
      }));
    }
    tasks.push(_faceLoads.get(key));
  });
  await Promise.all(tasks);
}

function populateFontSelect(currentValue, extraValues) {
  const sel = document.getElementById('propFontFamily');
  if (!sel) return;
  if (sel.dataset.fontBrowse === '1' && document.activeElement === sel) return;

  const hostValues = new Set(HOST_FONTS.map((f) => f.family));
  const extras = new Set(extraValues || []);
  collectLayoutFontFamilies(window.state?.layers).forEach((v) => extras.add(v));
  if (currentValue) extras.add(currentValue);

  const prev = currentValue || sel.value || (HOST_FONTS[0]?.family || 'Arial');
  const active = document.activeElement === sel;
  const idx = sel.selectedIndex;
  sel.innerHTML = '';

  if (HOST_FONTS.length) {
    const group = document.createElement('optgroup');
    group.label = `Font Mac (${HOST_FONTS.length})`;
    HOST_FONTS.forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f.family;
      opt.textContent = f.family;
      group.appendChild(opt);
    });
    sel.appendChild(group);
  }

  [...extras]
    .filter((v) => v && !hostValues.has(v))
    .sort((a, b) => a.localeCompare(b))
    .forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = `${v} (dal layout)`;
      sel.appendChild(opt);
    });

  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  else if (sel.options.length) sel.selectedIndex = Math.min(Math.max(0, idx), sel.options.length - 1);
  if (active) sel.focus();
  updateFontAvailabilityHint(sel.value);
}

async function loadHostFonts() {
  if (HOST_FONTS.length) return HOST_FONTS;
  if (_hostFontsLoading) return _hostFontsLoading;
  _hostFontsLoading = (async () => {
    try {
      const res = await fetch('/api/fonts');
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || 'fonts api failed');
      HOST_FONTS = data.fonts || [];
      return HOST_FONTS;
    } catch (e) {
      console.warn('loadHostFonts failed:', e);
      HOST_FONTS = [];
      return [];
    } finally {
      _hostFontsLoading = null;
    }
  })();
  return _hostFontsLoading;
}

async function ensureHostFontsInSelect(currentValue) {
  const hint = document.getElementById('fontAvailabilityHint');
  if (hint) {
    hint.textContent = 'Caricamento font Mac…';
    hint.className = 'muted hint';
  }
  await loadHostFonts();
  const sel = document.getElementById('propFontFamily');
  const wasBrowse = sel?.dataset.fontBrowse;
  if (sel) sel.dataset.fontBrowse = '0';
  populateFontSelect(currentValue);
  if (sel && wasBrowse) sel.dataset.fontBrowse = wasBrowse;
  if (hint) {
    hint.textContent = HOST_FONTS.length
      ? `${HOST_FONTS.length} font dal Mac`
      : 'Nessun font host (monta /host-fonts in Docker).';
    hint.className = 'muted hint fontOk';
  }
  return HOST_FONTS.length > 0;
}

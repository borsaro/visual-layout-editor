/** Layout library: list-first, two-phase folder nav, lazy thumbs. */
state.libraryViewMode = localStorage.getItem('robyLibraryViewMode') || 'list';
state.libraryFocusKey = null;
state.libraryFoldersReady = false;
state.libraryItemsReady = false;
state.libraryTagFilter = new Set();
state.libraryAllTags = [];

let libraryLoadId = 0;
let libraryScrollTimer = null;
/** Until this timestamp, scroll events are ours (scrollIntoView) and must not move focus. */
let libraryOwnScrollUntil = 0;
/** While a bulk thumbnail run is going, its button shows progress and nothing else may relabel it. */
let bulkThumbsRunning = false;
const PREVIEW_MAX = 2;
let previewActive = 0;
const previewWait = [];

function libraryItemKey(item){
  if(!item) return '';
  if(item.kind === 'folder') return 'folder:' + (item.rel || item.path || item.name);
  return (item.kind || 'x') + ':' + (item.path || item.rel || item.name);
}
function findLibraryItemByKey(key){
  return visibleLibraryItems().find(it => libraryItemKey(it) === key) || null;
}
function setLibraryViewMode(mode){
  state.libraryViewMode = mode === 'grid' ? 'grid' : 'list';
  localStorage.setItem('robyLibraryViewMode', state.libraryViewMode);
  const ws = $('libraryWorkspace');
  if(ws) ws.classList.toggle('view-grid', state.libraryViewMode === 'grid');
  const btn = $('libraryViewToggleBtn');
  if(btn) btn.textContent = state.libraryViewMode === 'list' ? 'Vista griglia' : 'Vista lista';
  renderLibraryGrid();
}
function syncLibraryViewChrome(){
  const ws = $('libraryWorkspace');
  if(ws) ws.classList.toggle('view-grid', state.libraryViewMode === 'grid');
  const btn = $('libraryViewToggleBtn');
  if(btn) btn.textContent = state.libraryViewMode === 'list' ? 'Vista griglia' : 'Vista lista';
}

/** "Solo JSON" hides images anyway, so there is no reason to make the server find them. */
function libraryWantsImages(){
  return ($('libraryKindFilter')?.value || 'layout') !== 'layout';
}

async function fetchLibraryPhase(folder, phase){
  const folderParam = encodeURIComponent(folder || '');
  const wantImages = libraryWantsImages();
  const res = await fetch(
    '/api/list-layouts?folder=' + folderParam + '&phase=' + phase + '&light=1'
      + (wantImages ? '' : '&include_images=0')
      + '&ts=' + Date.now(),
    { cache: 'no-store' }
  );
  const payload = await res.json();
  if(phase !== 'folders'){
    state.libraryLoadedWithImages = wantImages;
    if(Array.isArray(payload.all_tags)) state.libraryAllTags = payload.all_tags;
  }
  return payload;
}

/**
 * Switching to a filter that needs images has to go back to the server, because the
 * last listing was told not to look for them. Narrowing the filter does not: the
 * client already has everything it needs to hide them.
 */
function onLibraryKindFilterChange(){
  if(libraryWantsImages() && state.libraryLoadedWithImages === false){
    refreshLayoutLibrary().catch(e => showToast('Libreria: ' + (e.message || e)));
    return;
  }
  renderLibraryGrid();
}

async function refreshLayoutLibrary(){
  const loadId = ++libraryLoadId;
  const grid = $('layoutGrid');
  const meta = $('libraryMeta');
  const folderWanted = state.currentLibraryFolder || '';
  state.libraryFoldersReady = false;
  state.libraryItemsReady = false;
  state.libraryFocusKey = null;
  if(grid) grid.innerHTML = '<div class="emptyGrid">Caricamento cartelle…</div>';
  clearLibrarySidePreview();

  let foldersPayload = await fetchLibraryPhase(folderWanted, 'folders');
  if(loadId !== libraryLoadId) return;
  if(!foldersPayload.ok && folderWanted && String(foldersPayload.error || '').includes('Folder not found')){
    state.currentLibraryFolder = '';
    localStorage.setItem('robyLayoutLibraryFolder', '');
    foldersPayload = await fetchLibraryPhase('', 'folders');
    if(loadId !== libraryLoadId) return;
  }
  if(!foldersPayload.ok) throw new Error(foldersPayload.error || 'List folders failed');

  state.libraryFolders = foldersPayload.folders || [];
  state.libraryItems = [];
  state.currentLibraryFolder = foldersPayload.folder || '';
  localStorage.setItem('robyLayoutLibraryFolder', state.currentLibraryFolder);
  if(foldersPayload.campaigns_root) state.campaignsRoot = foldersPayload.campaigns_root;
  state.libraryFoldersReady = true;
  renderLibraryBreadcrumb();
  renderLibraryGrid();

  if(meta){
    const folderLabel = state.currentLibraryFolder ? `/${state.currentLibraryFolder}` : '/';
    const root = foldersPayload.campaigns_root || state.campaignsRoot || '';
    meta.textContent = `root: ${root} · ${foldersPayload.folder_count || 0} cartelle in ${folderLabel} · caricamento elementi…`;
  }

  const itemsPayload = await fetchLibraryPhase(state.currentLibraryFolder, 'items');
  if(loadId !== libraryLoadId) return;
  if(!itemsPayload.ok) throw new Error(itemsPayload.error || 'List items failed');

  state.libraryItems = itemsPayload.items || [];
  state.libraryItemsReady = true;
  const availablePaths = new Set([
    ...state.libraryFolders.map(f => f.path || f.rel),
    ...state.libraryItems.map(x => x.path),
  ].filter(Boolean));
  state.selectedLibraryPaths = state.selectedLibraryPaths.filter(path => availablePaths.has(path));
  if(meta){
    const layouts = state.libraryItems.filter(x => x.kind === 'layout').length;
    const images = state.libraryItems.filter(x => x.kind === 'image').length;
    const folderLabel = state.currentLibraryFolder ? `/${state.currentLibraryFolder}` : '/';
    const root = itemsPayload.campaigns_root || state.campaignsRoot || '';
    meta.textContent = `root: ${root} · ${state.libraryFolders.length} cartelle · ${itemsPayload.count} elementi in ${folderLabel} · ${layouts} layout · ${images} immagini`;
    // Unreadable entries no longer sink the listing, but they must not vanish quietly
    // either: a file the user can see in Finder would just be missing here.
    const skipped = [...(foldersPayload.skipped || []), ...(itemsPayload.skipped || [])];
    if(skipped.length){
      const warn = document.createElement('small');
      warn.className = 'librarySkipped';
      warn.textContent = `⚠ ${skipped.length} non leggibili (link rotti?): ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}`;
      warn.title = skipped.join('\n');
      meta.appendChild(warn);
    }
  }
  renderLibraryGrid();
  ensureLibraryFocus();
}

function renderLibraryBreadcrumb(){
  const box = $('libraryBreadcrumb');
  if(!box) return;
  box.innerHTML = '';
  const rootBtn = document.createElement('button');
  rootBtn.textContent = 'Cartelle';
  rootBtn.className = 'crumbBtn';
  rootBtn.onclick = () => goLibraryFolder('');
  box.appendChild(rootBtn);
  const parts = (state.currentLibraryFolder || '').split('/').filter(Boolean);
  let acc = '';
  parts.forEach((part, idx) => {
    const sep = document.createElement('span');
    sep.className = 'crumbSep';
    sep.textContent = '›';
    box.appendChild(sep);
    acc = acc ? acc + '/' + part : part;
    const btn = document.createElement('button');
    btn.textContent = part;
    btn.className = 'crumbBtn' + (idx === parts.length - 1 ? ' active' : '');
    const target = acc;
    btn.onclick = () => goLibraryFolder(target);
    box.appendChild(btn);
  });
  if(parts.length){
    const back = document.createElement('button');
    back.textContent = '← Indietro';
    back.className = 'crumbBtn back';
    back.onclick = () => goLibraryFolder(parts.slice(0, -1).join('/'));
    box.prepend(back);
  }
  const mk = document.createElement('button');
  mk.textContent = '+ Nuova cartella';
  mk.className = 'crumbBtn newFolder';
  mk.title = 'Crea una cartella qui';
  mk.onclick = createFolderHere;
  box.appendChild(mk);
}

async function createFolderHere(){
  const name = prompt('Nome della nuova cartella:');
  if(!name || !name.trim()) return;
  const rel = (state.currentLibraryFolder ? state.currentLibraryFolder + '/' : '') + name.trim();
  try{
    const res = await fetch('/api/create-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: rel }),
    });
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || 'create failed');
    showToast('Cartella creata: ' + data.folder);
    await refreshLayoutLibrary();
  }catch(e){
    showToast('Cartella non creata: ' + (e.message || e));
  }
}

/* ----------------------------------------------------------------- move */

async function moveSelectedItems(){
  const files = selectedLibraryEntries().filter(it => it.kind !== 'folder');
  if(!files.length){ showToast('Seleziona almeno un file'); return; }
  // Suggestions cover every folder in the tree; typing a path that does not exist
  // yet creates it, so "existing folder" and "new folder" are the same gesture.
  try{
    const res = await fetch('/api/all-folders', { cache: 'no-store' });
    const data = await res.json();
    const dl = $('libraryFoldersDatalist');
    if(dl && data.ok){
      dl.innerHTML = '';
      data.folders.forEach(f => {
        const o = document.createElement('option');
        o.value = f;
        dl.appendChild(o);
      });
    }
  }catch(e){ /* suggestions only */ }

  const bar = $('bulkMoveBtn');
  const panel = document.createElement('div');
  panel.className = 'movePanel';
  panel.innerHTML = `
    <strong>Sposta ${files.length} file in:</strong>
    <input id="moveDestInput" list="libraryFoldersDatalist" placeholder="Cartella/Sottocartella (nuova = la creo)" />
    <div class="movePanelActions">
      <button type="button" id="moveConfirmBtn" class="primary">Sposta</button>
      <button type="button" id="moveCancelBtn">Annulla</button>
    </div>`;
  document.body.appendChild(panel);
  const r = bar.getBoundingClientRect();
  Object.assign(panel.style, { top: (r.bottom + 6) + 'px', left: Math.max(10, r.right - 300) + 'px' });
  const input = panel.querySelector('#moveDestInput');
  input.value = state.currentLibraryFolder || '';
  input.focus();
  input.select();

  const close = () => panel.remove();
  panel.querySelector('#moveCancelBtn').onclick = close;
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if(ev.key === 'Escape') close();
    if(ev.key === 'Enter') panel.querySelector('#moveConfirmBtn').click();
  });
  panel.querySelector('#moveConfirmBtn').onclick = async () => {
    const dest = input.value.trim();
    close();
    try{
      const res = await fetch('/api/move-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: files.map(it => librarySelectPath(it)), dest }),
      });
      const data = await res.json();
      if(!data.ok) throw new Error(data.error || 'move failed');
      state.selectedLibraryPaths = [];
      await refreshLayoutLibrary();
      showToast(data.errors?.length
        ? `${data.moved.length} spostati, ${data.errors.length} no: ${data.errors[0].error}`
        : `${data.moved.length} file spostati in /${data.dest || ''}`);
    }catch(e){
      showToast('Spostamento fallito: ' + (e.message || e));
    }
  };
}

async function tagSelectedItems(){
  const files = selectedLibraryEntries().filter(it => it.kind !== 'folder');
  if(!files.length){ showToast('Seleziona almeno un file'); return; }
  const tag = prompt(`Tag da aggiungere a ${files.length} file:`);
  if(!tag || !tag.trim()) return;
  try{
    const res = await fetch('/api/set-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: files.map(it => ({
        path: librarySelectPath(it),
        tags: [...(it.tags || []), tag.trim()],
      })) }),
    });
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || 'set-tags failed');
    const byPath = new Map(data.items.map(x => [x.path, x.tags]));
    files.forEach(it => { const t = byPath.get(librarySelectPath(it)); if(t) it.tags = t; });
    const known = new Set((state.libraryAllTags || []).map(t => t.toLowerCase()));
    if(!known.has(tag.trim().toLowerCase())) state.libraryAllTags.push(tag.trim());
    renderLibraryGrid();
    showToast(`Tag "${tag.trim()}" su ${files.length} file`);
  }catch(e){
    showToast('Tag non applicato: ' + (e.message || e));
  }
}

/* --------------------------------------------------------------- columns */

/**
 * 1..5 colonne in galleria: meno colonne = anteprime più grandi.
 *
 * The preview keeps the artboard's portrait ratio and is only capped, instead of
 * being pinned to a fixed height: a height that ignores the column width stretches
 * the box out of proportion and pushes the card past its neighbours.
 */
const LIBRARY_PREVIEW_MAX = { 1: 560, 2: 440, 3: 320, 4: 250, 5: 195 };

function applyLibraryColumns(){
  const grid = $('layoutGrid');
  const wrap = $('libraryColsWrap');
  const isGrid = state.libraryViewMode === 'grid';
  if(wrap) wrap.hidden = !isGrid;
  if(!grid) return;
  if(!isGrid){
    grid.style.removeProperty('grid-template-columns');
    grid.style.removeProperty('--previewMax');
    return;
  }
  const n = Math.max(1, Math.min(5, Number(localStorage.getItem('robyLibraryCols')) || 3));
  const range = $('libraryColsRange');
  if(range) range.value = String(n);
  const label = $('libraryColsLabel');
  if(label) label.textContent = String(n);
  // The stylesheet sets the columns with !important, which beats a plain inline
  // style — the slider only takes effect if it declares itself important too.
  grid.style.setProperty('grid-template-columns', `repeat(${n}, minmax(0, 1fr))`, 'important');
  grid.style.setProperty('--previewMax', LIBRARY_PREVIEW_MAX[n] + 'px');
}

function goLibraryFolder(folder){
  libraryLoadId += 1;
  state.currentLibraryFolder = folder || '';
  state.selectedLibraryPaths = [];
  state.libraryFocusKey = null;
  state.libraryFolders = [];
  state.libraryItems = [];
  state.libraryFoldersReady = false;
  state.libraryItemsReady = false;
  localStorage.setItem('robyLayoutLibraryFolder', state.currentLibraryFolder);
  renderLibraryBreadcrumb();
  const grid = $('layoutGrid');
  if(grid) grid.innerHTML = '<div class="emptyGrid">Apro cartella…</div>';
  clearLibrarySidePreview();
  return refreshLayoutLibrary().catch(e => {
    if($('layoutGrid')) $('layoutGrid').innerHTML = `<div class="emptyGrid">Errore: ${escapeHtml(e.message)}</div>`;
  });
}

function openLayoutLibrary(){
  $('layoutLibraryModal').hidden = false;
  syncLibraryViewChrome();
  refreshLayoutLibrary().catch(e => {
    if($('layoutGrid')) $('layoutGrid').innerHTML = `<div class="emptyGrid">Errore: ${escapeHtml(e.message)}</div>`;
  });
}
function closeLayoutLibrary(){ $('layoutLibraryModal').hidden = true; }

function visibleLibraryItems(){
  const q = ($('librarySearch')?.value || '').toLowerCase().trim();
  const kindFilter = $('libraryKindFilter')?.value || 'layout';
  const tagFilter = state.libraryTagFilter || new Set();
  // A tag filter is about files: folders have no tags, so they step aside while it is on.
  const folders = tagFilter.size ? [] :
    (state.libraryFolders || []).filter(f => !q || (f.name + ' ' + f.rel).toLowerCase().includes(q));
  const items = state.libraryItems.filter(it => {
    if(kindFilter !== 'all' && it.kind !== kindFilter) return false;
    const tags = (it.tags || []).map(t => String(t).toLowerCase());
    if(tagFilter.size && ![...tagFilter].every(t => tags.includes(t))) return false;
    const hay = (it.name + ' ' + it.rel + ' ' + it.path + ' ' + (it.kind || '') + ' ' + tags.join(' ')).toLowerCase();
    return !q || hay.includes(q);
  });
  return [...folders, ...items];
}

/* ------------------------------------------------------------------ tags */

function syncTagsDatalist(){
  const dl = $('libraryTagsDatalist');
  if(!dl) return;
  dl.innerHTML = '';
  (state.libraryAllTags || []).forEach(t => {
    const o = document.createElement('option');
    o.value = t;
    dl.appendChild(o);
  });
}

function renderTagFilterRow(){
  const row = $('tagFilterRow');
  if(!row) return;
  const tags = state.libraryAllTags || [];
  row.hidden = tags.length === 0;
  row.innerHTML = '';
  if(!tags.length){
    if(state.libraryTagFilter.size){ state.libraryTagFilter.clear(); }
    return;
  }
  tags.forEach(tag => {
    const chip = document.createElement('button');
    chip.type = 'button';
    const active = state.libraryTagFilter.has(tag.toLowerCase());
    chip.className = 'tagChip filter' + (active ? ' active' : '');
    chip.textContent = tag;
    chip.title = active ? 'Togli dal filtro' : 'Filtra per questo tag';
    chip.onclick = () => {
      const key = tag.toLowerCase();
      if(state.libraryTagFilter.has(key)) state.libraryTagFilter.delete(key);
      else state.libraryTagFilter.add(key);
      renderLibraryGrid();
    };
    row.appendChild(chip);
  });
  if(state.libraryTagFilter.size){
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'tagChip clear';
    clear.textContent = '✕ filtri';
    clear.onclick = () => { state.libraryTagFilter.clear(); renderLibraryGrid(); };
    row.appendChild(clear);
  }
}

async function setItemTags(item, tags){
  const path = librarySelectPath(item);
  if(!path) return;
  const res = await fetch('/api/set-tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ path, tags }] }),
  });
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'set-tags failed');
  item.tags = data.items?.[0]?.tags || [];
  // A brand-new tag must show up in suggestions and in the filter row at once.
  const known = new Set((state.libraryAllTags || []).map(t => t.toLowerCase()));
  item.tags.forEach(t => { if(!known.has(t.toLowerCase())) state.libraryAllTags.push(t); });
  state.libraryAllTags.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/** Chips + inline "+tag" input, shared by list rows and gallery cards. */
function buildTagsStrip(item){
  const strip = document.createElement('div');
  strip.className = 'tagStrip';
  (item.tags || []).forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tagChip';
    const label = document.createElement('span');
    label.textContent = tag;
    label.title = 'Filtra per questo tag';
    label.onclick = (ev) => {
      ev.stopPropagation();
      state.libraryTagFilter.add(tag.toLowerCase());
      renderLibraryGrid();
    };
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'tagRemove';
    x.textContent = '×';
    x.title = 'Rimuovi tag';
    x.onclick = async (ev) => {
      ev.stopPropagation();
      try{
        await setItemTags(item, (item.tags || []).filter(t => t !== tag));
        renderLibraryGrid();
      }catch(e){ showToast('Tag non rimosso: ' + (e.message || e)); }
    };
    chip.append(label, x);
    strip.appendChild(chip);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tagChip add';
  add.textContent = '+ tag';
  add.title = 'Aggiungi un tag';
  add.onclick = (ev) => {
    ev.stopPropagation();
    const input = document.createElement('input');
    input.className = 'tagInput';
    input.setAttribute('list', 'libraryTagsDatalist');
    input.placeholder = 'tag…';
    add.replaceWith(input);
    input.focus();
    let done = false;
    const finish = async (save) => {
      if(done) return;
      done = true;
      const value = input.value.trim();
      input.replaceWith(add);
      if(!save || !value) return;
      try{
        await setItemTags(item, [...(item.tags || []), value]);
        renderLibraryGrid();
      }catch(e){ showToast('Tag non salvato: ' + (e.message || e)); }
    };
    input.addEventListener('keydown', (ev2) => {
      ev2.stopPropagation();
      if(ev2.key === 'Enter') finish(true);
      if(ev2.key === 'Escape') finish(false);
    });
    input.addEventListener('click', ev2 => ev2.stopPropagation());
    input.addEventListener('blur', () => finish(!!input.value.trim()));
  };
  strip.appendChild(add);
  strip.onclick = (ev) => ev.stopPropagation();
  return strip;
}

function isLibraryMultiSelectModifier(ev){
  return !!(ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey));
}
function librarySelectPath(item){
  if(!item) return '';
  if(item.kind === 'folder') return item.rel || item.path || item.name;
  return item.path || item.rel || '';
}
function isLibrarySelected(path){ return state.selectedLibraryPaths.includes(path); }
/** Flip one item and keep row, checkbox and bulk buttons in step, without a full re-render. */
function toggleLibrarySelection(path){
  if(!path) return;
  const next = !isLibrarySelected(path);
  setLibrarySelected(path, next);
  const grid = $('layoutGrid');
  grid?.querySelectorAll(`[data-path]`).forEach(el => {
    if(el.dataset.path !== path) return;
    el.classList.toggle('selectedForExport', next);
    const cb = el.querySelector('input[type="checkbox"]');
    if(cb) cb.checked = next;
  });
  // setLibrarySelected already refreshed the bulk buttons and the select-all state.
}
function setLibrarySelected(path, selected){
  if(!path) return;
  if(selected){
    if(!state.selectedLibraryPaths.includes(path)) state.selectedLibraryPaths.push(path);
  } else {
    state.selectedLibraryPaths = state.selectedLibraryPaths.filter(x => x !== path);
  }
  updateBulkActionButtons();
}
function syncLibrarySelectionUi(path){
  const selected = isLibrarySelected(path);
  const grid = $('layoutGrid');
  if(!grid) return;
  [...grid.querySelectorAll('[data-path]')].forEach(el => {
    if(el.dataset.path !== path) return;
    el.classList.toggle('selectedForExport', selected);
    const cb = el.querySelector('input[type="checkbox"]');
    if(cb) cb.checked = selected;
    const txt = el.querySelector('.librarySelectText');
    if(txt) txt.textContent = selected ? 'Selezionato' : 'Seleziona';
  });
}
function toggleLibrarySelectionByPath(path, key){
  if(!path) return;
  const next = !isLibrarySelected(path);
  setLibrarySelected(path, next);
  syncLibrarySelectionUi(path);
  if(key) focusLibraryItem(key, { scroll: false });
}
function bindLibraryModifierSelect(){
  const grid = $('layoutGrid');
  if(!grid || grid.dataset.modifierSelectBound === '1') return;
  grid.dataset.modifierSelectBound = '1';
  // Capture-phase: one toggle only (avoids label/checkbox/row double-firing).
  grid.addEventListener('click', (ev) => {
    if(!isLibraryMultiSelectModifier(ev)) return;
    if(ev.button != null && ev.button !== 0) return;
    const row = ev.target.closest?.('.libraryRow, .layoutCard');
    if(!row || !grid.contains(row)) return;
    if(ev.target.closest?.('button')) return;
    ev.preventDefault();
    ev.stopPropagation();
    if(typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    toggleLibrarySelectionByPath(row.dataset.path, row.dataset.libKey);
  }, true);
}
function selectedLibraryEntries(){
  const paths = new Set(state.selectedLibraryPaths);
  const all = [...(state.libraryFolders || []), ...(state.libraryItems || [])];
  return all.filter(it => paths.has(librarySelectPath(it)));
}
function updateBulkActionButtons(){
  const count = state.selectedLibraryPaths.length;
  const exportBtn = $('bulkExportBtn');
  if(exportBtn){
    const layoutCount = selectedLibraryEntries().filter(it => it.kind === 'layout').length;
    exportBtn.disabled = layoutCount === 0;
    exportBtn.textContent = layoutCount ? `Export selezionati (${layoutCount})` : 'Export selezionati';
  }
  const editBtn = $('bulkEditBtn');
  if(editBtn){
    const fileCount = selectedLibraryEntries().filter(it => it.kind !== 'folder').length;
    editBtn.disabled = fileCount === 0;
    editBtn.textContent = fileCount ? `Apri in editing (${fileCount})` : 'Apri in editing';
  }
  const delBtn = $('bulkDeleteBtn');
  if(delBtn){
    delBtn.disabled = count === 0;
    delBtn.textContent = count ? `Cancella selezionati (${count})` : 'Cancella selezionati';
  }
  const copyBtn = $('bulkCopyPathsBtn');
  if(copyBtn){
    copyBtn.disabled = count === 0;
    copyBtn.textContent = count ? `Copia (${count})` : 'Copia';
  }
  const fileCount = selectedLibraryEntries().filter(it => it.kind !== 'folder').length;
  const moveBtn = $('bulkMoveBtn');
  if(moveBtn){
    moveBtn.disabled = fileCount === 0;
    moveBtn.textContent = fileCount ? `Sposta (${fileCount})` : 'Sposta';
  }
  const tagBtn = $('bulkTagBtn');
  if(tagBtn){
    tagBtn.disabled = fileCount === 0;
    tagBtn.textContent = fileCount ? `Tag (${fileCount})` : 'Tag';
  }
  const thumbsBtn = $('bulkRefreshThumbsBtn');
  if(thumbsBtn && !bulkThumbsRunning){
    // Only layouts have a preview sidecar to redraw, so images in the selection
    // must not make the button look available.
    const layoutCount = selectedLibraryEntries().filter(it => it.kind === 'layout').length;
    thumbsBtn.disabled = layoutCount === 0;
    thumbsBtn.textContent = layoutCount ? `Rigenera anteprime (${layoutCount})` : 'Rigenera anteprime';
  }
  updateSelectAllControl();
}

/** Selected paths, one per line, ready to paste in a chat as references. */
async function copySelectedLibraryPaths(){
  const entries = selectedLibraryEntries();
  if(!entries.length){ showToast('Nessun elemento selezionato'); return; }
  // Library order, not click order: a pasted list should read like the list on screen.
  const lines = entries.map(it => librarySelectPath(it)).filter(Boolean);
  try{
    await copyTextToClipboard(lines.join('\n'));
    showToast(lines.length === 1
      ? 'Percorso copiato: ' + lines[0]
      : `${lines.length} percorsi copiati (uno per riga)`);
  }catch(e){
    showToast('Copia fallita: ' + (e.message || e));
  }
}
function updateBulkExportButton(){ updateBulkActionButtons(); }
/**
 * Which of the three states the current selection matches.
 *
 * Derived from the selection rather than a click counter, so the cycle stays right
 * when items are ticked by hand in between: what the button does next always follows
 * from what is actually selected.
 */
function librarySelectAllState(){
  const visible = visibleLibraryItems().filter(it => librarySelectPath(it));
  const files = visible.filter(it => it.kind !== 'folder');
  const folders = visible.filter(it => it.kind === 'folder');
  const sel = (it) => isLibrarySelected(librarySelectPath(it));
  const allFiles = files.length > 0 && files.every(sel);
  const allFolders = folders.length > 0 && folders.every(sel);
  const anySelected = visible.some(sel);

  let stage;                       // what the NEXT click will do
  // A partial selection completes rather than clears: that is what an indeterminate
  // checkbox does everywhere else, and clearing someone's half-made selection by
  // accident is the more expensive mistake.
  if(!allFiles) stage = 'files';
  else if(folders.length && !allFolders) stage = 'all';
  else stage = 'none';
  return { visible, files, folders, allFiles, allFolders, anySelected, stage };
}

function updateSelectAllControl(){
  const cb = $('librarySelectAllCheckbox');
  const txt = $('librarySelectAllText');
  if(!cb || !txt) return;
  const s = librarySelectAllState();
  const selectedVisible = s.visible.filter(it => isLibrarySelected(librarySelectPath(it))).length;
  cb.disabled = s.visible.length === 0;
  cb.indeterminate = selectedVisible > 0 && selectedVisible < s.visible.length;
  cb.checked = s.visible.length > 0 && selectedVisible === s.visible.length;
  // The label names the next click, not the current state: this control cycles, and a
  // cycling control that describes where it is leaves you guessing where it goes.
  txt.textContent = s.stage === 'files'
    ? (s.folders.length ? `Seleziona i ${s.files.length} file` : `Seleziona tutto (${s.files.length})`)
    : (s.stage === 'all'
      ? `Aggiungi ${s.folders.length} cartelle`
      : `Deseleziona tutto (${selectedVisible})`);
}

/** File → file + cartelle → niente. */
function cycleLibrarySelection(){
  const s = librarySelectAllState();
  if(!s.visible.length) return;
  const set = (items, on) => items.forEach(it => setLibrarySelected(librarySelectPath(it), on));
  if(s.stage === 'files'){
    set(s.files, true);
    set(s.folders, false);
  } else if(s.stage === 'all'){
    set(s.visible, true);
  } else {
    set(s.visible, false);
  }
  renderLibraryGrid();
}

function toggleVisibleLibrarySelection(forceChecked = null){
  const visible = visibleLibraryItems().filter(it => librarySelectPath(it));
  if(!visible.length) return;
  if(forceChecked === null){ cycleLibrarySelection(); return; }
  visible.forEach(it => setLibrarySelected(librarySelectPath(it), !!forceChecked));
  renderLibraryGrid();
}

function ensureLibraryFocus(){
  const items = visibleLibraryItems();
  if(!items.length){ clearLibrarySidePreview(); return; }
  if(state.libraryFocusKey && findLibraryItemByKey(state.libraryFocusKey)){
    focusLibraryItem(state.libraryFocusKey, { scroll: false });
    return;
  }
  const firstFile = items.find(it => it.kind !== 'folder') || items[0];
  focusLibraryItem(libraryItemKey(firstFile), { scroll: false });
}

function focusLibraryItem(key, opts = {}){
  if(!key) return;
  state.libraryFocusKey = key;
  const grid = $('layoutGrid');
  if(grid){
    grid.querySelectorAll('.libraryRow.focused, .layoutCard.focused').forEach(el => el.classList.remove('focused'));
    const el = [...grid.querySelectorAll('[data-lib-key]')].find(n => n.dataset.libKey === key);
    if(el){
      el.classList.add('focused');
      if(opts.scroll !== false){
        // Claim the scroll events this is about to fire, so the scroll handler does not
        // read them back as "the user scrolled" and drag focus somewhere else.
        libraryOwnScrollUntil = Date.now() + 300;
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }
  const item = findLibraryItemByKey(key);
  updateLibrarySidePreview(item);
}

function isLibraryModalOpen(){
  const modal = $('layoutLibraryModal');
  return !!(modal && !modal.hidden);
}

function moveLibraryFocus(delta){
  if(!isLibraryModalOpen()) return false;
  const items = visibleLibraryItems();
  if(!items.length) return false;
  const keys = items.map(libraryItemKey);
  let idx = keys.indexOf(state.libraryFocusKey);
  if(idx < 0) idx = delta > 0 ? -1 : 0;
  const next = Math.max(0, Math.min(keys.length - 1, idx + delta));
  if(next === idx && state.libraryFocusKey === keys[next]) return true;
  focusLibraryItem(keys[next], { scroll: true });
  return true;
}

function bindLibraryKeyboard(){
  if(window.__robyLibraryKeysBound) return;
  window.__robyLibraryKeysBound = true;
  document.addEventListener('keydown', (ev) => {
    if(!isLibraryModalOpen()) return;
    if(typeof isTypingTarget === 'function' && isTypingTarget(ev.target)) return;
    if(ev.key === 'ArrowDown'){
      ev.preventDefault();
      moveLibraryFocus(1);
      return;
    }
    if(ev.key === 'ArrowUp'){
      ev.preventDefault();
      moveLibraryFocus(-1);
      return;
    }
    // Space ticks the highlighted row, so a set can be picked without leaving the keyboard.
    if(ev.key === ' ' || ev.key === 'Spacebar'){
      if(state.libraryViewMode !== 'list') return;
      const item = findLibraryItemByKey(state.libraryFocusKey);
      const path = item && librarySelectPath(item);
      if(!path) return;
      ev.preventDefault();   // otherwise the modal scrolls a page down
      toggleLibrarySelection(path);
      return;
    }
    if(ev.key === 'Enter'){
      const item = findLibraryItemByKey(state.libraryFocusKey);
      if(!item) return;
      ev.preventDefault();
      if(item.kind === 'folder') goLibraryFolder(item.rel || item.path || item.name);
      else openLibraryItem(item).then(() => closeLayoutLibrary()).catch(e => alert('Errore apertura: ' + e.message));
    }
  });
}

function bindLibraryBackdrop(){
  const modal = $('layoutLibraryModal');
  modal?.addEventListener('click', (ev) => {
    if(ev.target === modal) closeLayoutLibrary();
  });
}

/** Same path bulk "Copia" puts on the clipboard — for LLM / chat paste. */
function copyLibraryItemPath(item){
  const path = librarySelectPath(item);
  if(!path) return Promise.reject(new Error('Nessun percorso'));
  return copyTextToClipboard(path).then(() => {
    showToast('Percorso copiato: ' + path);
    return path;
  });
}

function bindLibraryNameCopy(el, item){
  if(!el || !librarySelectPath(item)) return;
  el.classList.add('libraryNameCopy');
  el.title = 'Clicca per copiare il percorso';
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    copyLibraryItemPath(item).catch(e => showToast('Copia fallita: ' + (e.message || e)));
  });
}

function copyPathLine(item){
  const line = document.createElement('small');
  line.className = 'libraryPathCopy';
  line.title = 'Clicca per copiare il percorso';
  const path = librarySelectPath(item);
  line.textContent = path;
  line.onclick = (ev) => {
    ev.stopPropagation();
    copyLibraryItemPath(item).catch(e => showToast('Copia fallita: ' + (e.message || e)));
  };
  return line;
}

function clearLibrarySidePreview(){
  const frame = $('librarySidePreviewFrame');
  const meta = $('librarySidePreviewMeta');
  const actions = $('librarySidePreviewActions');
  if(frame) frame.innerHTML = '<div class="emptyGrid">Seleziona un elemento</div>';
  if(meta) meta.innerHTML = '';
  if(actions) actions.innerHTML = '';
}

function updateLibrarySidePreview(item){
  const frame = $('librarySidePreviewFrame');
  const meta = $('librarySidePreviewMeta');
  const actions = $('librarySidePreviewActions');
  if(!frame || !meta || !actions) return;
  if(!item){ clearLibrarySidePreview(); return; }

  if(item.kind === 'folder'){
    frame.innerHTML = '<div class="folderIcon sideFolderIcon">📁</div>';
    meta.innerHTML = `<strong>${escapeHtml(item.name)}</strong><small>Cartella progetto</small>`;
    meta.appendChild(copyPathLine(item));
    actions.innerHTML = '';
    const openBtn = document.createElement('button');
    openBtn.className = 'primary';
    openBtn.textContent = 'Apri cartella';
    openBtn.onclick = () => goLibraryFolder(item.rel || item.path || item.name);
    actions.appendChild(openBtn);
    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = 'Cancella';
    delBtn.onclick = () => deleteLibraryItem(item);
    actions.appendChild(delBtn);
    return;
  }

  const badge = item.kind === 'image' ? (item.has_layout ? 'Immagine + layout' : 'Immagine') : 'Layout';
  const size = (item.canvas?.width && item.canvas?.height) ? `${item.canvas.width}×${item.canvas.height}` : '—';
  meta.innerHTML = `<strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(badge)} · ${size} · ${item.mtime_iso || ''}</small>`;
  meta.appendChild(copyPathLine(item));
  actions.innerHTML = '';
  const openBtn = document.createElement('button');
  openBtn.className = 'primary';
  openBtn.textContent = item.kind === 'image' ? (item.has_layout ? 'Apri layout' : 'Crea layout') : 'Apri';
  openBtn.onclick = () => openLibraryItem(item).then(() => closeLayoutLibrary()).catch(e => alert('Errore apertura: ' + e.message));
  actions.appendChild(openBtn);
  const delBtn = document.createElement('button');
  delBtn.className = 'danger';
  delBtn.textContent = 'Cancella';
  delBtn.onclick = () => deleteLibraryItem(item);
  actions.appendChild(delBtn);
  frame.innerHTML = '<div class="emptyGrid">Anteprima…</div>';
  const sideSize = buildCanvasSizeBadge(item, 'onPreview');
  if(sideSize) frame.appendChild(sideSize);
  loadPreviewInto(frame, item, { persist: true, expectKey: libraryItemKey(item) });
}

function deleteConfirmLabel(item){
  if(item.kind === 'folder') return `cartella progetto\n\n/${item.rel || item.path || item.name}\n\n(verrà eliminato tutto il contenuto)`;
  if(item.kind === 'image') return `immagine\n\n${item.rel || item.path}`;
  return `layout\n\n${item.rel || item.path}`;
}

async function deleteLibraryItem(item){
  if(!item) return;
  if(!confirm(`Cancellare definitivamente questo ${deleteConfirmLabel(item)}?`)) return;
  const ok = await deleteLibraryItemsApi([{ kind: item.kind, path: librarySelectPath(item) }]);
  if(ok) await refreshLayoutLibrary();
}

async function deleteSelectedLibraryItems(){
  const selected = pruneNestedLibrarySelection(selectedLibraryEntries());
  if(!selected.length){ alert('Seleziona almeno un file o una cartella.'); return; }
  const folders = selected.filter(it => it.kind === 'folder').length;
  const files = selected.length - folders;
  const msg = [
    `Cancellare definitivamente ${selected.length} elementi?`,
    folders ? `· ${folders} cartelle progetto (con tutto il contenuto)` : '',
    files ? `· ${files} file` : '',
  ].filter(Boolean).join('\n');
  if(!confirm(msg)) return;
  const ok = await deleteLibraryItemsApi(selected.map(it => ({ kind: it.kind, path: librarySelectPath(it) })));
  if(ok){
    state.selectedLibraryPaths = [];
    await refreshLayoutLibrary();
  }
}

function pruneNestedLibrarySelection(selected){
  const folderRels = selected.filter(it => it.kind === 'folder').map(it => librarySelectPath(it)).filter(Boolean);
  return selected.filter(it => {
    const path = librarySelectPath(it);
    if(!path) return false;
    if(it.kind === 'folder'){
      return !folderRels.some(f => f !== path && path.startsWith(f + '/'));
    }
    return !folderRels.some(f => path === f || path.startsWith(f + '/'));
  });
}

async function deleteLibraryItemsApi(items){
  const res = await fetch('/api/delete-library-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const data = await res.json();
  if(data.errors?.length){
    alert('Cancellazione parziale o fallita:\n' + data.errors.join('\n'));
  }
  if(!data.deleted?.length){
    if(!data.errors?.length) alert('Errore cancellazione: ' + (data.error || 'nessun elemento eliminato'));
    return false;
  }
  showToast(`Eliminati ${data.deleted.length} elementi`);
  return true;
}

async function deleteLibraryLayout(item){ return deleteLibraryItem(item); }

function bindLibraryListScroll(){
  const grid = $('layoutGrid');
  if(!grid) return;
  bindLibraryModifierSelect();
  if(grid.dataset.scrollBound) return;
  grid.dataset.scrollBound = '1';
  grid.addEventListener('scroll', () => {
    if(state.libraryViewMode !== 'list') return;
    clearTimeout(libraryScrollTimer);
    libraryScrollTimer = setTimeout(syncFocusFromScroll, 80);
  });
}

/**
 * Keep focus sensible when the user scrolls with wheel or scrollbar.
 * It must not touch focus while the focused row is still on screen: arrow-key stepping
 * scrolls the list, and re-deriving focus from the scroll position would yank it back
 * to whatever sits at the top — which is what made the list jump to the first item as
 * soon as it started scrolling.
 */
function syncFocusFromScroll(){
  const grid = $('layoutGrid');
  if(!grid || state.libraryViewMode !== 'list') return;
  if(Date.now() < libraryOwnScrollUntil) return;
  const rows = [...grid.querySelectorAll('.libraryRow[data-lib-key]')];
  if(!rows.length) return;

  const box = grid.getBoundingClientRect();
  const focused = rows.find(r => r.dataset.libKey === state.libraryFocusKey);
  if(focused){
    const r = focused.getBoundingClientRect();
    if(r.bottom > box.top && r.top < box.bottom) return; // ancora in vista: non toccarlo
  }
  const top = box.top + 28;
  let best = null;
  let bestDist = Infinity;
  rows.forEach(row => {
    const dist = Math.abs(row.getBoundingClientRect().top - top);
    if(dist < bestDist){ bestDist = dist; best = row; }
  });
  if(best){
    const key = best.dataset.libKey;
    if(key && key !== state.libraryFocusKey) focusLibraryItem(key, { scroll: false });
  }
}

function enqueuePreview(task){
  previewWait.push(task);
  drainPreviewQueue();
}
function drainPreviewQueue(){
  while(previewActive < PREVIEW_MAX && previewWait.length){
    const task = previewWait.shift();
    previewActive += 1;
    Promise.resolve()
      .then(task)
      .catch(() => {})
      .finally(() => { previewActive -= 1; drainPreviewQueue(); });
  }
}

function observeGridPreviews(grid){
  if(state.libraryViewMode !== 'grid') return;
  const nodes = grid.querySelectorAll('.previewBox[data-preview-pending="1"]');
  if(!nodes.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(!entry.isIntersecting) return;
      const box = entry.target;
      io.unobserve(box);
      const raw = box.dataset.previewItem;
      if(!raw) return;
      box.dataset.previewPending = '0';
      let item;
      try{ item = JSON.parse(raw); } catch { return; }
      enqueuePreview(() => loadPreviewInto(box, item, { persist: true }));
    });
  }, { root: grid, rootMargin: '120px', threshold: 0.01 });
  nodes.forEach(n => io.observe(n));
}

function renderLibraryGrid(){
  const grid = $('layoutGrid');
  if(!grid) return;
  bindLibraryListScroll();
  syncLibraryViewChrome();
  renderTagFilterRow();
  syncTagsDatalist();
  applyLibraryColumns();
  updateBulkExportButton();
  const items = visibleLibraryItems();
  const listMode = state.libraryViewMode === 'list';
  grid.classList.toggle('libraryList', listMode);
  grid.classList.toggle('layoutGrid', !listMode);

  if(!items.length){
    const msg = !state.libraryFoldersReady
      ? 'Caricamento cartelle…'
      : (!state.libraryItemsReady ? 'Cartelle pronte — caricamento elementi…' : 'Nessun layout o asset trovato con questo filtro.');
    grid.innerHTML = `<div class="emptyGrid">${msg}</div>`;
    if(!state.libraryItemsReady && state.libraryFoldersReady && state.libraryFolders.length === 0){
      /* still loading items in empty-looking folder */
    }
    return;
  }

  grid.innerHTML = '';
  items.forEach(item => {
    if(listMode) grid.appendChild(buildLibraryRow(item));
    else grid.appendChild(buildLibraryCard(item));
  });
  if(listMode) ensureLibraryFocus();
  else observeGridPreviews(grid);
}

/** "1080×1350" for anything whose canvas size the listing knows; '' otherwise. */
function canvasSizeLabel(item){
  const c = item && item.canvas;
  const w = c && Number(c.width), h = c && Number(c.height);
  if(!w || !h) return '';
  return `${Math.round(w)}×${Math.round(h)}`;
}

function buildCanvasSizeBadge(item, cls){
  const label = canvasSizeLabel(item);
  if(!label) return null;
  const el = document.createElement('span');
  el.className = 'canvasSizeBadge' + (cls ? ' ' + cls : '');
  el.textContent = label;
  el.title = 'Dimensioni canvas: ' + label + ' px';
  return el;
}

/** How many variants sit beside a layout — 0 included, so the card always answers. */
function buildVariantCountBadge(item){
  if(!item || item.kind === 'folder') return null;
  if(item.kind === 'image' && !item.has_layout) return null;
  const n = Number(item.variants) || 0;
  const el = document.createElement('span');
  el.className = 'variantCountBadge' + (n ? '' : ' isEmpty');
  el.textContent = n === 1 ? '1 variante' : `${n} varianti`;
  el.title = n
    ? `${n} varianti salvate accanto a questo layout`
    : 'Nessuna variante: solo il layout base';
  return el;
}

function buildLibraryRow(item){
  const key = libraryItemKey(item);
  const selectPath = librarySelectPath(item);
  const row = document.createElement('div');
  row.className = 'libraryRow' + (key === state.libraryFocusKey ? ' focused' : '') + (item.kind === 'folder' ? ' folderRow' : '') + (isLibrarySelected(selectPath) ? ' selectedForExport' : '');
  row.dataset.libKey = key;
  if(selectPath) row.dataset.path = selectPath;

  const check = document.createElement('label');
  check.className = 'libraryRowCheck';
  check.title = item.kind === 'folder' ? 'Seleziona cartella' : 'Seleziona file';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = isLibrarySelected(selectPath);
  cb.addEventListener('click', ev => ev.stopPropagation());
  cb.addEventListener('change', () => {
    setLibrarySelected(selectPath, cb.checked);
    row.classList.toggle('selectedForExport', cb.checked);
  });
  check.appendChild(cb);

  const title = document.createElement('div');
  title.className = 'libraryRowTitle';
  const badge = item.kind === 'folder' ? 'Cartella' : (item.kind === 'image' ? (item.has_layout ? 'Img+JSON' : 'Immagine') : 'Layout');
  const nameEl = document.createElement('strong');
  nameEl.textContent = item.name;
  bindLibraryNameCopy(nameEl, item);
  const metaEl = document.createElement('small');
  metaEl.textContent = `${badge} · ${item.rel || item.name}`;
  title.append(nameEl, metaEl);
  const rowSize = buildCanvasSizeBadge(item);
  if(rowSize) title.appendChild(rowSize);
  const rowVariants = buildVariantCountBadge(item);
  if(rowVariants) title.appendChild(rowVariants);
  if(item.kind !== 'folder') title.appendChild(buildTagsStrip(item));

  const openBtn = document.createElement('button');
  openBtn.className = 'libraryRowOpen';
  openBtn.textContent = item.kind === 'folder' ? 'Apri' : (item.kind === 'image' ? (item.has_layout ? 'Apri' : 'Crea') : 'Apri');
  openBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    if(item.kind === 'folder') goLibraryFolder(item.rel || item.path || item.name);
    else openLibraryItem(item).then(() => closeLayoutLibrary()).catch(e => alert('Errore apertura: ' + e.message));
  });

  // Only real layouts have a preview sidecar to redraw.
  if(item.kind === 'layout' || (item.kind === 'image' && item.has_layout)){
    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'libraryRowReload';
    reloadBtn.textContent = '↻';
    reloadBtn.title = 'Rigenera anteprima dal design aggiornato';
    reloadBtn.setAttribute('aria-label', 'Rigenera anteprima');
    reloadBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      regenerateLayoutPreview(item, reloadBtn);
    });
    row.append(check, title, reloadBtn, openBtn);
  } else {
    row.append(check, title, openBtn);
  }
  row.onclick = (ev) => {
    if(isLibraryMultiSelectModifier(ev)) return;
    focusLibraryItem(key, { scroll: false });
  };
  row.ondblclick = (ev) => {
    if(isLibraryMultiSelectModifier(ev)) return;
    if(item.kind === 'folder') goLibraryFolder(item.rel || item.path || item.name);
    else openLibraryItem(item).then(() => closeLayoutLibrary()).catch(e => alert('Errore apertura: ' + e.message));
  };
  return row;
}

function buildLibraryCard(item){
  const selectPath = librarySelectPath(item);
  if(item.kind === 'folder'){
    const card = document.createElement('div');
    card.className = 'layoutCard folderCard' + (isLibrarySelected(selectPath) ? ' selectedForExport' : '');
    card.dataset.libKey = libraryItemKey(item);
    const preview = document.createElement('div');
    preview.className = 'previewBox folderPreview';
    preview.innerHTML = '<div class="folderIcon">📁</div>';
    const checkboxWrap = document.createElement('label');
    checkboxWrap.className = 'librarySelect';
    checkboxWrap.title = 'Seleziona cartella';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isLibrarySelected(selectPath);
    const checkboxText = document.createElement('span');
    checkboxText.className = 'librarySelectText';
    checkboxText.textContent = checkbox.checked ? 'Selezionato' : 'Seleziona';
    checkbox.addEventListener('click', ev => ev.stopPropagation());
    checkboxWrap.addEventListener('click', ev => ev.stopPropagation());
    checkbox.addEventListener('change', () => {
      setLibrarySelected(selectPath, checkbox.checked);
      card.classList.toggle('selectedForExport', checkbox.checked);
      checkboxText.textContent = checkbox.checked ? 'Selezionato' : 'Seleziona';
    });
    checkboxWrap.append(checkbox, checkboxText);
    const info = document.createElement('div');
    info.className = 'layoutInfo';
    const folderName = document.createElement('strong');
    folderName.textContent = item.name;
    bindLibraryNameCopy(folderName, item);
    const folderMeta = document.createElement('small');
    folderMeta.textContent = `Cartella progetto · ${item.rel || item.name}`;
    info.append(folderName, folderMeta);
    const actions = document.createElement('div');
    actions.className = 'layoutActions';
    const openBtn = document.createElement('button');
    openBtn.textContent = 'Apri cartella';
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Cancella';
    delBtn.className = 'danger';
    actions.append(openBtn, delBtn);
    card.append(preview, checkboxWrap, info, actions);
    const openFolder = () => goLibraryFolder(item.rel || item.path || item.name);
    preview.onclick = (ev) => {
      if(isLibraryMultiSelectModifier(ev)) return;
      openFolder();
    };
    card.ondblclick = (ev) => {
      if(isLibraryMultiSelectModifier(ev)) return;
      openFolder();
    };
    openBtn.onclick = openFolder;
    delBtn.onclick = () => deleteLibraryItem(item);
    return card;
  }

  const card = document.createElement('div');
  card.className = 'layoutCard' + (isLibrarySelected(selectPath) ? ' selectedForExport' : '');
  card.dataset.libKey = libraryItemKey(item);
  const preview = document.createElement('div');
  preview.className = 'previewBox';
  preview.dataset.previewPending = '1';
  preview.dataset.previewItem = JSON.stringify({
    kind: item.kind, path: item.path, name: item.name, preview_src: item.preview_src || null,
  });
  preview.innerHTML = '<small class="muted">Anteprima…</small>';
  const cardSize = buildCanvasSizeBadge(item, 'onPreview');
  if(cardSize) preview.appendChild(cardSize);

  const checkboxWrap = document.createElement('label');
  checkboxWrap.className = 'librarySelect';
  checkboxWrap.title = 'Seleziona per export/cancellazione';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = isLibrarySelected(selectPath);
  const checkboxText = document.createElement('span');
  checkboxText.className = 'librarySelectText';
  checkboxText.textContent = checkbox.checked ? 'Selezionato' : 'Seleziona';
  checkbox.addEventListener('click', ev => ev.stopPropagation());
  checkboxWrap.addEventListener('click', ev => ev.stopPropagation());
  checkbox.addEventListener('change', ev => {
    setLibrarySelected(selectPath, ev.target.checked);
    card.classList.toggle('selectedForExport', ev.target.checked);
    checkboxText.textContent = ev.target.checked ? 'Selezionato' : 'Seleziona';
  });
  checkboxWrap.append(checkbox, checkboxText);

  const info = document.createElement('div');
  info.className = 'layoutInfo';
  const badge = item.kind === 'image' ? (item.has_layout ? 'Immagine + layout' : 'Immagine') : 'Layout';
  const actionLabel = item.kind === 'image' ? (item.has_layout ? 'Apri layout' : 'Crea layout') : 'Apri';
  const nameEl = document.createElement('strong');
  nameEl.textContent = item.name;
  bindLibraryNameCopy(nameEl, item);
  const kindMeta = document.createElement('small');
  kindMeta.textContent = `${badge} · ${item.rel || ''}`;
  const nameRow = document.createElement('div');
  nameRow.className = 'layoutNameRow';
  nameRow.appendChild(nameEl);
  const cardVariants = buildVariantCountBadge(item);
  if(cardVariants) nameRow.appendChild(cardVariants);
  info.append(nameRow, kindMeta);
  if(item.mtime_iso){
    const mtimeMeta = document.createElement('small');
    mtimeMeta.textContent = item.mtime_iso;
    info.appendChild(mtimeMeta);
  }
  info.appendChild(buildTagsStrip(item));
  const actions = document.createElement('div');
  actions.className = 'layoutActions';
  const openBtn = document.createElement('button');
  openBtn.textContent = actionLabel;
  const delBtn = document.createElement('button');
  delBtn.textContent = 'Cancella';
  delBtn.className = 'danger';
  actions.append(openBtn, delBtn);
  card.append(preview, checkboxWrap, info, actions);

  const open = () => openLibraryItem(item).then(() => closeLayoutLibrary()).catch(e => alert('Errore apertura: ' + e.message));
  preview.onclick = (ev) => {
    if(isLibraryMultiSelectModifier(ev)) return;
  };
  card.ondblclick = (ev) => {
    if(isLibraryMultiSelectModifier(ev)) return;
    open();
  };
  openBtn.onclick = open;
  delBtn.onclick = () => deleteLibraryItem(item);
  return card;
}

async function openLibraryItem(item){
  // Opening one file from the library ends the working set: picking something by hand
  // is the way out of the list, so there is nothing to close by hand. The arrows go
  // through here too, which is what the flag keeps apart.
  if(!editQueueNavigating) clearEditQueue();
  if(item.kind === 'image'){
    if(item.has_layout && item.layout_path) return loadLayoutUrl(item.layout_path);
    const res = await fetch('/api/create-layout-from-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: item.path }),
    });
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || 'Create layout failed');
    loadLayoutObject(data.layout, data.path);
    return;
  }
  return loadLayoutUrl(item.path);
}

function mountPreviewNode(box, node){
  [...box.childNodes].forEach(n => {
    const keep = n.classList && (n.classList.contains('librarySelect') || n.classList.contains('libraryRowCheck') || n.classList.contains('canvasSizeBadge'));
    if(!keep) n.remove();
  });
  box.appendChild(node);
}

async function loadPreviewInto(box, item, opts = {}){
  const stillWanted = () => !opts.expectKey || state.libraryFocusKey === opts.expectKey;
  try{
    if(item.kind === 'image'){
      if(!stillWanted()) return;
      const img = document.createElement('img');
      img.src = item.preview_src || ('/api/file?path=' + encodeURIComponent(item.path));
      img.alt = item.name || '';
      img.loading = 'lazy';
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      img.style.objectFit = 'contain';
      mountPreviewNode(box, img);
      return;
    }
    if(item.preview_src){
      if(!stillWanted()) return;
      const img = document.createElement('img');
      img.src = item.preview_src + (item.preview_src.includes('?') ? '&' : '?') + 'v=' + (item.mtime || Date.now());
      img.alt = item.name || '';
      img.loading = 'lazy';
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      img.style.objectFit = 'contain';
      mountPreviewNode(box, img);
      return;
    }
    let layout;
    if(String(item.path || '').startsWith('./')){
      const res = await fetch(item.path, { cache: 'no-store' });
      layout = await res.json();
    } else {
      const res = await fetch('/api/load-layout?path=' + encodeURIComponent(item.path), { cache: 'no-store' });
      const payload = await res.json();
      layout = payload.layout;
    }
    if(!stillWanted()) return;
    const c = document.createElement('canvas');
    const w = layout.canvas?.width || 1080;
    const h = layout.canvas?.height || 1350;
    const maxW = 420, maxH = 520;
    const scale = Math.min(maxW / w, maxH / h);
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    await renderLayoutToCanvas(ctx, layout, w, h);
    if(!stillWanted()) return;
    mountPreviewNode(box, c);
    if(opts.persist && item.path && !String(item.path).startsWith('./')){
      persistLayoutPreview(item.path, c).catch(() => {});
    }
  } catch(e){
    if(stillWanted()) box.innerHTML = '<small class="muted">Preview non disponibile</small>';
  }
}

async function persistLayoutPreview(path, canvas){
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.72);
  if(!blob) return;
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for(let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const image_base64 = btoa(bin);
  await fetch('/api/save-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, image_base64 }),
  });
}

/** Scaled-down render of any layout, at the size the library thumbnails use. */
async function renderLayoutPreviewCanvas(layout){
  const c = document.createElement('canvas');
  const w = layout.canvas?.width || 1080;
  const h = layout.canvas?.height || 1350;
  const scale = Math.min(420 / w, 520 / h);
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  await renderLayoutToCanvas(ctx, layout, w, h);
  return c;
}

async function uploadCurrentLayoutPreview(){
  if(!state.currentLayoutPath) return;
  try{
    // The sidecar is the picture OF THE LAYOUT, and the canvas may be showing a
    // variant: rendering what is on screen filed a variant as the base, in the
    // library and on the base card of the variants strip alike.
    const payload = layoutPayload();
    const baseLayers = typeof currentBaseLayers === 'function' ? currentBaseLayers() : null;
    const c = await renderLayoutPreviewCanvas(
      baseLayers ? { ...payload, layers: baseLayers } : payload,
    );
    await persistLayoutPreview(state.currentLayoutPath, c);
  } catch(e){ /* non-blocking */ }
}

/**
 * Redraw a layout's thumbnail from the JSON on disk, without opening it.
 * The fonts it uses may not be loaded in this page yet, and a preview rendered with
 * a fallback face would look wrong in a way that is easy to mistake for a real change.
 */
/** Redraw one layout's sidecar from the JSON on disk. Throws so callers can count failures. */
async function renderAndPersistPreview(item){
  const path = item?.path || item?.rel;
  if(!path) throw new Error('percorso mancante');
  const res = await fetch('/api/load-layout?path=' + encodeURIComponent(path), { cache: 'no-store' });
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'load failed');
  const layout = data.layout;
  await loadHostFonts?.();
  await ensureLayoutCustomFonts?.(layout.layers || []);
  const families = collectLayoutFontFamilies?.(layout.layers || []) || [];
  await Promise.all([...families].map(f => waitForFont?.(f, 4000)));
  try { await document.fonts.ready; } catch(_){}

  const canvas = await renderLayoutPreviewCanvas(layout);
  await persistLayoutPreview(path, canvas);
  // Sidecars are served with a long cache, so the new bytes need a fresh URL.
  item.mtime = Math.floor(Date.now() / 1000);
  refreshLibraryRowPreview(item);
}

async function regenerateLayoutPreview(item, btn){
  const previous = btn ? btn.textContent : null;
  if(btn){ btn.disabled = true; btn.classList.add('isBusy'); }
  try{
    await renderAndPersistPreview(item);
    showToast('Anteprima rigenerata: ' + (item.name || item.path));
  }catch(e){
    showToast('Rigenerazione anteprima fallita: ' + (e.message || e));
  }finally{
    if(btn){ btn.disabled = false; btn.classList.remove('isBusy'); if(previous !== null) btn.textContent = previous; }
  }
}

/**
 * Redraw every selected layout's thumbnail.
 * Sequential on purpose: each one renders a full-size canvas in this page, so running
 * them at once would fight for the same main thread and finish no sooner, while making
 * the progress count meaningless.
 */
async function refreshSelectedThumbs(){
  const layouts = selectedLibraryEntries().filter(it => it.kind === 'layout');
  if(!layouts.length){ showToast('Nessun layout selezionato'); return; }
  const btn = $('bulkRefreshThumbsBtn');
  bulkThumbsRunning = true;
  if(btn) btn.disabled = true;
  let done = 0;
  const failed = [];
  for(const item of layouts){
    if(btn) btn.textContent = `Anteprime ${done + 1}/${layouts.length}…`;
    try{
      await renderAndPersistPreview(item);
      done += 1;
    }catch(e){
      failed.push(item.name || item.path);
    }
  }
  bulkThumbsRunning = false;
  if(btn) btn.disabled = false;
  updateBulkActionButtons();
  showToast(failed.length
    ? `${done} anteprime rigenerate, ${failed.length} fallite: ${failed.slice(0, 3).join(', ')}`
    : `${done} anteprime rigenerate`);
}

/**
 * Show the freshly written bytes wherever this layout is on screen.
 * Grid cards hold an <img> pointed at the sidecar, which is cached and needs a new
 * URL; the side panel is rebuilt instead, because it may be a client-rendered
 * <canvas> rather than an image.
 */
function refreshLibraryRowPreview(item){
  const key = libraryItemKey(item);
  const base = item.preview_src || ('/api/layout-preview?path=' + encodeURIComponent(item.path));
  const bust = base + (base.includes('?') ? '&' : '?') + 'v=' + Date.now();
  document.querySelectorAll(`[data-lib-key="${CSS.escape(key)}"] img`).forEach(img => { img.src = bust; });
  if(state.libraryFocusKey === key) updateLibrarySidePreview(item);
}

async function loadReadyLayouts(){ /* library loads only when modal opens */ }

bindLibraryKeyboard();
bindLibraryBackdrop();
/* ------------------------------------------------------- working set (edit queue) */

/**
 * A list of files picked in the library, walked one at a time from the toolbar.
 *
 * Entries are library items, not bare paths: an image without a layout has to open the
 * way it does from the gallery, which means creating its sidecar layout on the spot.
 * The queue survives a reload — a review pass over twenty ads should not be lost to an
 * accidental refresh — and drops entries that no longer exist when it is restored.
 */
const EDIT_QUEUE_KEY = 'robyEditQueue';

/** True only while the arrows are moving through the list — see openLibraryItem. */
let editQueueNavigating = false;

function editQueueEntryLabel(entry){
  return entry?.name || (entry?.path || '').split('/').pop() || 'file';
}

function saveEditQueue(){
  try{
    if(!state.editQueue) localStorage.removeItem(EDIT_QUEUE_KEY);
    else localStorage.setItem(EDIT_QUEUE_KEY, JSON.stringify(state.editQueue));
  }catch(_){ /* private mode: the queue just does not survive the reload */ }
}

function restoreEditQueue(){
  try{
    const raw = localStorage.getItem(EDIT_QUEUE_KEY);
    if(!raw) return;
    const queue = JSON.parse(raw);
    if(!queue?.entries?.length) return;
    state.editQueue = queue;
    syncEditQueueUi();
  }catch(_){ /* unreadable: start without a queue */ }
}

function startEditQueue(entries){
  const files = (entries || []).filter(it => it && it.kind !== 'folder' && librarySelectPath(it));
  if(!files.length){ showToast('Seleziona dei file, non solo cartelle'); return; }
  state.editQueue = {
    entries: files.map(it => ({
      kind: it.kind, path: it.path, name: it.name,
      has_layout: !!it.has_layout, layout_path: it.layout_path || null,
    })),
    index: 0,
  };
  saveEditQueue();
  openEditQueueAt(0, { fromStart: true });
}

function clearEditQueue(){
  if(!state.editQueue) return;
  state.editQueue = null;
  saveEditQueue();
  syncEditQueueUi();
}

/** Move by ±1, or to an absolute position. Unsaved work is confirmed before leaving. */
async function openEditQueueAt(index, { fromStart = false } = {}){
  const queue = state.editQueue;
  if(!queue?.entries?.length) return;
  const target = Math.max(0, Math.min(index, queue.entries.length - 1));
  const entry = queue.entries[target];
  try{
    editQueueNavigating = true;
    await openLibraryItem(entry);
    queue.index = target;
    saveEditQueue();
    syncEditQueueUi();
    if(fromStart){
      closeLayoutLibrary();
      showToast(`${queue.entries.length} file in lista — usa le frecce nella barra o Alt+←/→`);
    }
  }catch(e){
    // "Apertura annullata" is the user answering no to the unsaved-changes prompt: the
    // queue must stay exactly where it was, without an error on top of their decision.
    if(String(e?.message || e).includes('annullata')) return;
    showToast('Apertura fallita: ' + (e.message || e));
  }finally{
    editQueueNavigating = false;
  }
}

function stepEditQueue(delta){
  const queue = state.editQueue;
  if(!queue?.entries?.length) return;
  const next = queue.index + delta;
  if(next < 0 || next >= queue.entries.length){
    showToast(delta < 0 ? 'Primo file della lista' : 'Ultimo file della lista');
    return;
  }
  openEditQueueAt(next);
}

function syncEditQueueUi(){
  const nav = $('editQueueNav');
  if(!nav) return;
  const queue = state.editQueue;
  const label = $('editQueueLabel');
  const prev = $('editQueuePrev');
  const next = $('editQueueNext');

  if(!queue?.entries?.length){
    // No working set: the open file is a list of one. Keeping the control on screen,
    // reading 1/1, says where you are instead of leaving a gap that looks like a bug.
    const name = state.currentLayoutPath || state.loadedJsonFilename;
    nav.hidden = !name;
    if(nav.hidden) return;
    if(label){
      label.textContent = `1/1 · ${String(name).split('/').pop()}`;
      label.title = String(name);
    }
    if(prev) prev.disabled = true;
    if(next) next.disabled = true;
    return;
  }

  nav.hidden = false;
  if(label){
    label.textContent = `${queue.index + 1}/${queue.entries.length} · ${editQueueEntryLabel(queue.entries[queue.index])}`;
    label.title = queue.entries.map((e, i) => `${i + 1}. ${editQueueEntryLabel(e)}`).join('\n');
  }
  if(prev) prev.disabled = queue.index <= 0;
  if(next) next.disabled = queue.index >= queue.entries.length - 1;
}

function bindEditQueue(){
  $('editQueuePrev')?.addEventListener('click', () => stepEditQueue(-1));
  $('editQueueNext')?.addEventListener('click', () => stepEditQueue(1));
  restoreEditQueue();
}

if(!window.ROBY_EXPORT_MODE) init();

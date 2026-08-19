const $ = (id) => document.getElementById(id);
const state = {
  canvas: { width: 1080, height: 1350, background: '#fff7ea' },
  layers: [],
  selectedId: null,
  selectedIds: [],
  zoom: 100,
  history: [],
  future: [],
  currentLayoutPath: null,
  libraryItems: [],
  selectedLibraryPaths: [],
  libraryFolders: [],
  currentLibraryFolder: localStorage.getItem('robyLayoutLibraryFolder') || '',
  dirty: false,
  loadedJsonFilename: null,
  localFileHandle: null, // File System Access API handle (Carica JSON → Salva Json)
  showSafeGuides: localStorage.getItem('robyShowSafeGuides') === '1',
  vertexEditId: null, // shape layer currently in per-vertex warp mode
  warpMode: localStorage.getItem('robyWarpMode') === '1', // corner-distort editing on the canvas
  cropMode: localStorage.getItem('robyCropMode') === '1', // handles crop instead of resizing
  marqueeMode: localStorage.getItem('robyMarqueeMode') === '1', // drag always rubber-bands, even over a layer
  warpModeTemp: false, // Option/Alt held: distort until the key is released
  campaignsRoot: '',
  editorRoot: '',
  // Working set: the files picked in the library, walked one at a time with the arrows
  // in the toolbar. Entries are library items, so an image without a layout still opens
  // the way it does from the gallery.
  editQueue: null,      // { entries: [...], index: 0 }
};
window.state = state;
let drag = null;
let marquee = null;
let propHistoryPending = false;
let propHistoryTimer = null;
const uid = () => 'layer_' + Math.random().toString(36).slice(2, 10);
const selected = () => state.layers.find(l => l.id === state.selectedId) || null;
const isSelected = (id) => state.selectedIds.includes(id);
const selectedLayers = () => state.layers.filter(l => isSelected(l.id));
const layerVisible = (l) => l && l.visible !== false;
const layerLocked = (l) => !!(l && l.locked);

function setLayerVisible(id, visible){
  const l = state.layers.find(x => x.id === id);
  if(!l || layerVisible(l) === visible) return;
  pushHistory();
  l.visible = visible;
  markDirty();
  render();
}
function toggleLayerVisible(id){
  const l = state.layers.find(x => x.id === id);
  if(!l) return;
  setLayerVisible(id, !layerVisible(l));
}
function toggleLayerLocked(id){
  const l = state.layers.find(x => x.id === id);
  if(!l) return;
  pushHistory();
  l.locked = !layerLocked(l);
  markDirty();
  render();
}

function markDirty(){ state.dirty = true; }
function clearDirty(){ state.dirty = false; }
function confirmDiscardChanges(){ return !state.dirty || confirm('Ci sono modifiche non salvate. Continuare?'); }
function showToast(msg){
  let t = $('toast');
  if(!t){ t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(() => t.classList.remove('show'), 2600);
}

/** Clipboard: async API when available, execCommand fallback for HTTP LAN (non-secure). */
async function copyTextToClipboard(text){
  const value = String(text ?? '');
  if(!value) throw new Error('testo vuoto');
  if(navigator.clipboard?.writeText && window.isSecureContext){
    await navigator.clipboard.writeText(value);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, value.length);
  const ok = document.execCommand('copy');
  ta.remove();
  if(!ok) throw new Error('execCommand copy failed');
}
function currentLayoutExportName(){
  if(state.currentLayoutPath) return state.currentLayoutPath.split('/').pop();
  return state.loadedJsonFilename || 'layout.layout.json';
}
function currentFileLabel(){
  if(state.currentLayoutPath) return state.currentLayoutPath.split('/').pop();
  if(state.localFileHandle || state.loadedJsonFilename){
    const name = state.loadedJsonFilename || state.localFileHandle?.name || 'layout.json';
    return state.localFileHandle ? name + ' (locale)' : name + ' (locale, solo download)';
  }
  return 'nessun file aperto';
}
function clearLocalFileHandle(){ state.localFileHandle = null; }
async function ensureLocalWritePermission(handle){
  if(!handle) return false;
  const opts = { mode: 'readwrite' };
  if((await handle.queryPermission(opts)) === 'granted') return true;
  if((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}
async function writeJsonToLocalHandle(handle){
  const ok = await ensureLocalWritePermission(handle);
  if(!ok) throw new Error('Permesso di scrittura sul file negato dal browser');
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(layoutPayload(), null, 2));
  await writable.close();
}
function snapshot(){ return JSON.stringify({canvas: state.canvas, layers: state.layers, selectedId: state.selectedId, selectedIds: state.selectedIds}); }
function restoreSnapshot(snap){ const data=JSON.parse(snap); state.canvas=data.canvas; state.layers=data.layers; state.selectedId=data.selectedId || null; state.selectedIds=data.selectedIds || (state.selectedId?[state.selectedId]:[]); syncCanvasInputs(); render(); }
function pushHistory(){ const snap=snapshot(); if(state.history.at(-1)!==snap){ state.history.push(snap); if(state.history.length>120) state.history.shift(); } state.future=[]; }
function undo(){ if(!state.history.length) return; const current=snapshot(); const prev=state.history.pop(); state.future.push(current); restoreSnapshot(prev); }
function redo(){ if(!state.future.length) return; const current=snapshot(); const next=state.future.pop(); state.history.push(current); restoreSnapshot(next); }
function selectOnly(id){ if(state.vertexEditId && state.vertexEditId!==id) state.vertexEditId=null; state.selectedId=id; state.selectedIds=id?[id]:[]; }
function toggleSelect(id){ if(isSelected(id)){ state.selectedIds=state.selectedIds.filter(x=>x!==id); state.selectedId=state.selectedIds.at(-1)||null; } else { state.selectedIds.push(id); state.selectedId=id; } }
function clearLayerSelection(){
  if(!state.selectedId && !state.selectedIds.length) return;
  state.selectedId = null;
  state.selectedIds = [];
  state.vertexEditId = null;
  render();
}
function isSelectionModifier(ev){
  return !!(ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey));
}

function defaultText() {
  return {
    id: uid(), type: 'text', name: 'Testo', x: 80, y: 80, w: 520, h: 90, z: nextZ(), opacity: 1, rotation: 0,
    text: 'Nuovo testo', fontSize: 48, fontWeight: '800', fontFamily: 'Arial', fontStyle: 'normal',
    underline: false, strikethrough: false, textTransform: 'none', letterSpacing: 0,
    color: '#111111', align: 'left', lineHeight: 1.12,
  };
}
function defaultRect() {
  return { id: uid(), type: 'rect', name: 'Box', x: 80, y: 220, w: 360, h: 120, z: nextZ(), opacity: 1, rotation: 0, fill: '#eb0029', stroke: '#eb0029', strokeWidth: 0, radius: 24 };
}
function defaultImage(src, name='Immagine') {
  return { id: uid(), type: 'image', name, x: 120, y: 320, w: 420, h: 420, z: nextZ(), opacity: 1, rotation: 0, src, fit: 'contain' };
}
// defaultGradient() lives in gradient.js
function nextZ(){ return state.layers.length ? Math.max(...state.layers.map(l=>Number(l.z)||0))+1 : 1; }

function updateCanvasInfo(){
  const selCount = state.selectedIds.length ? ` · ${state.selectedIds.length} selezionati` : '';
  // The name is clickable when a server path exists: one click copies the full
  // campaign-relative path, ready to paste in a chat as a reference.
  const fileInfo = state.currentLayoutPath
    ? ` · <span class="fileRefCopy" title="Clicca per copiare il percorso: ${escapeHtml(state.currentLayoutPath)}">${escapeHtml(currentFileLabel())}</span>`
    : ` · ${escapeHtml(currentFileLabel())}`;
  const dirtyInfo = state.dirty ? ' · ● modificato' : '';
  const hiddenCount = state.layers.filter(l => !layerVisible(l)).length;
  const hiddenInfo = hiddenCount ? ` · ${hiddenCount} nascosti` : '';
  const info = $('canvasInfo');
  if(info) info.innerHTML = `${state.canvas.width}×${state.canvas.height} · ${state.layers.length} layer${selCount}${hiddenInfo} · undo ${state.history.length} / redo ${state.future.length}${fileInfo}${dirtyInfo ? `<span class="dirtyMark">${dirtyInfo}</span>` : ''}`;
}

/** Fit the artboard in the visible stage area, and keep the zoom UI honest. */
function zoomToFit(){
  const scroller = document.querySelector('.stageScroller');
  if(!scroller || !state.canvas.width || !state.canvas.height) return;
  // The scroller has 72px padding on each side; leave a small breathing margin too.
  const availW = scroller.clientWidth - 96;
  const availH = scroller.clientHeight - 96;
  if(availW < 50 || availH < 50) return;
  const fit = Math.min(availW / state.canvas.width, availH / state.canvas.height) * 100;
  const range = $('zoomRange');
  const min = range ? Number(range.min) : 15;
  const max = range ? Number(range.max) : 400;
  // Never zoom a small artboard past 100: fit means "see it whole", not "blow it up".
  state.zoom = Math.max(min, Math.min(max, Math.min(fit, 100)));
  if(range) range.value = state.zoom;
  const label = $('zoomLabel');
  if(label) label.textContent = Math.round(state.zoom) + '%';
  // Fit is about the artboard, not overflowing layers: those only extend the
  // scrollable area. But scroll position survives a file change, so without this
  // reset the new file could open staring at the previous file's overflow.
  scroller.scrollTo(0, 0);
}

/** @param {{ skipProps?: boolean }} [opts] skipProps: keep props/select focus (font arrow browse) */
function render(opts = {}) {
  const canvas = $('canvas');
  canvas.style.width = state.canvas.width + 'px';
  canvas.style.height = state.canvas.height + 'px';
  canvas.style.background = state.canvas.background || '#fff';
  $('stage').style.transform = `scale(${state.zoom/100})`;
  updateCanvasInfo();
  canvas.innerHTML = '';
  [...state.layers].sort((a,b)=>(a.z||0)-(b.z||0)).filter(layerVisible).forEach(layer => canvas.appendChild(renderLayer(layer)));
  if(state.showSafeGuides) canvas.appendChild(renderSafeGuides());
  // Mask ABOVE layers so overflow (incl. screen blend) is dimmed; hole = artboard
  canvas.appendChild(renderCanvasOverflowMask());
  renderSelectionOverlay(canvas);
  renderWarpOverlay(canvas);
  if(!opts.skipProps){
    renderLayerList();
    renderProps();
  }
  if(typeof publishLiveState === 'function') publishLiveState();
  // Cheap enough here (render already rebuilt the stage) and keeps the unsaved-edits
  // marker on the active variant honest after every change.
  if(typeof syncVariantsSelectionUi === 'function') syncVariantsSelectionUi();
}

/** Replace one layer node on stage without rebuilding the props panel / font <select>. */
function refreshLayerOnStage(layer){
  if(!layer || !layerVisible(layer)) return;
  const canvas = $('canvas');
  const old = canvas?.querySelector(`.layer[data-id="${layer.id}"]`);
  const next = renderLayer(layer);
  if(old) old.replaceWith(next);
  else {
    // Insert in z-order before mask
    const mask = canvas.querySelector('.canvasOverflowMask');
    if(mask) canvas.insertBefore(next, mask);
    else canvas.appendChild(next);
  }
  updateCanvasInfo();
}
/**
 * Selection outline and resize handles, in an overlay ABOVE the overflow mask.
 * They used to live inside the layer node, where the dimming mask covered every
 * part extending past the artboard: a corner outside the canvas was barely
 * visible and looked dead even though it still worked. A child cannot escape its
 * parent's stacking context, so the only way over the mask is a sibling overlay.
 */
function renderSelectionOverlay(canvas){
  const sel = selectedLayers().filter(layerVisible);
  if(!sel.length) return;
  const ov = document.createElement('div');
  ov.className = 'selectionOverlay';
  sel.forEach((layer)=>{
    const box = document.createElement('div');
    box.className = 'selOverlayBox'
      + (layerLocked(layer) ? ' locked' : '')
      + (layer.type === 'image' ? ' image' : '');
    Object.assign(box.style, {
      left: layer.x + 'px', top: layer.y + 'px', width: layer.w + 'px', height: layer.h + 'px',
      transform: layerHasWarp(layer)
        ? mat3ToCssMatrix3d(layerFullMatrix(layer))
        : `rotate(${Number(layer.rotation)||0}deg) skew(${Number(layer.skewX)||0}deg, ${Number(layer.skewY)||0}deg)`,
      transformOrigin: layerHasWarp(layer) ? '0 0' : 'center center',
    });
    const editingVertices = vertexEditActive(layer) && isSelected(layer.id) && !layerLocked(layer);
    if(!layerLocked(layer) && !editingVertices && !warpEditActive(layer)){
      ['nw','ne','sw','se'].forEach(pos=>{
        const handle = document.createElement('div');
        handle.className = `resizeHandle handle-${pos}`;
        handle.dataset.handle = pos;
        handle.oncontextmenu = (ev) => { ev.preventDefault(); ev.stopPropagation(); return false; };
        handle.addEventListener('mousedown', (ev)=>startDrag(ev, layer.id, pos));
        box.appendChild(handle);
      });
    }
    ov.appendChild(box);
  });
  canvas.appendChild(ov);
}

function renderCanvasOverflowMask(){
  const mask = document.createElement('div');
  mask.className = 'canvasOverflowMask';
  mask.setAttribute('aria-hidden', 'true');
  return mask;
}

/** Mount image content, clipping it through the shape mask when one is set. */
function appendImageContent(el, layer, content, masked){
  if(!masked){ el.appendChild(content); return; }
  const wrap = document.createElement('div');
  wrap.className = 'imageMaskWrap';
  Object.assign(wrap.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  const clipped = document.createElement('div');
  Object.assign(clipped.style, {
    position: 'absolute',
    inset: '0',
    clipPath: `path("${imageMaskPathD(layer)}")`,
  });
  clipped.appendChild(content);
  wrap.appendChild(clipped);
  // Effects on the wrapper: the drop-shadow reads the clipped alpha, so the
  // shadow follows the mask outline instead of being cut off by it.
  applyLayerEffectsDom(wrap, layer);
  el.appendChild(wrap);
}

function renderLayer(layer) {
  const el = document.createElement('div');
  el.className = `layer ${layer.type}` + (isSelected(layer.id) ? ' selected' : '') + (layerLocked(layer) ? ' locked' : '');
  el.dataset.id = layer.id;
  el.oncontextmenu = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openLayerContextMenu(ev, layer.id);
    return false;
  };
  Object.assign(el.style, {
    left: layer.x + 'px', top: layer.y + 'px', width: layer.w + 'px', height: layer.h + 'px',
    zIndex: layer.z || 1, opacity: layer.opacity ?? 1,
    transform: layerHasWarp(layer)
      ? mat3ToCssMatrix3d(layerFullMatrix(layer))
      : `rotate(${Number(layer.rotation)||0}deg) skew(${Number(layer.skewX)||0}deg, ${Number(layer.skewY)||0}deg)`,
    transformOrigin: layerHasWarp(layer) ? '0 0' : 'center center',
  });
  applyBlendDom(el, layer);
  if (layer.type === 'text') {
    // text-shadow must live on the same node as the glyphs, with overflow:visible
    // (inherited text-shadow + child overflow:hidden was boxing the blur).
    const layout = measureTextLayout(layer);
    const padTop = textBlockDomPaddingTop(layer, layout);
    Object.assign(el.style, {
      fontFamily: layer.fontFamily || layer.font || 'Arial',
      fontSize: layer.fontSize + 'px',
      fontWeight: layer.fontWeight || '400',
      color: layer.color || '#000',
      lineHeight: layout.lh + 'px',
      textAlign: layer.align || 'left',
      display: 'block',
      boxSizing: 'border-box',
      height: layer.h + 'px',
      paddingTop: padTop + 'px',
      overflow: 'visible',
    });
    applyTextStyleDom(el, layer, layout.lines);
    applyLayerEffectsDom(el, layer);
    el.addEventListener('dblclick', (ev)=>startInlineTextEdit(ev, layer.id));
  } else if (layer.type === 'rect') {
    Object.assign(el.style, { background: layer.fill || 'transparent', border: `${layer.strokeWidth||0}px solid ${layer.stroke||'transparent'}`, borderRadius: (layer.radius||0)+'px', overflow: 'visible' });
    applyLayerEffectsDom(el, layer);
  } else if (layer.type === 'image') {
    const img = document.createElement('img'); img.alt = layer.name || '';
    const crop = layer.crop ? normalizedCrop(layer) : null;
    // With a shape mask, effects (drop-shadow) must sit on a wrapper OUTSIDE the
    // clip: clip-path applies after filter, so a shadow on the clipped element
    // itself would be cut away with everything else beyond the path.
    const masked = typeof imageHasMask === 'function' && imageHasMask(layer);
    if(!masked) applyLayerEffectsDom(img, layer);
    if(typeof keyBlackEnabled === 'function' && keyBlackEnabled(layer)){
      const loader = new Image();
      loader.onload = ()=>{ img.src = processImageForKey(loader, layer).toDataURL('image/png'); };
      loader.onerror = ()=>{ img.src = resolveAssetUrl(layer.src); };
      loader.src = resolveAssetUrl(layer.src);
    } else {
      img.src = resolveAssetUrl(layer.src);
    }
    if(crop){
      // Pad clip by blur so overflow:hidden does not hard-cut drop-shadow
      const bleed = typeof shadowBleedPx === 'function' ? shadowBleedPx(layer.shadow) : 0;
      const clip = document.createElement('div');
      clip.className = 'imageClip';
      if(bleed > 0){
        Object.assign(clip.style, {
          inset: `-${bleed}px`,
          width: `calc(100% + ${bleed * 2}px)`,
          height: `calc(100% + ${bleed * 2}px)`,
        });
      }
      Object.assign(img.style, {
        position: 'absolute',
        left: (bleed - crop.x / crop.w * layer.w) + 'px',
        top: (bleed - crop.y / crop.h * layer.h) + 'px',
        width: (layer.w / crop.w) + 'px',
        height: (layer.h / crop.h) + 'px',
        objectFit: 'fill',
      });
      clip.appendChild(img);
      appendImageContent(el, layer, clip, masked);
    } else {
      // Direct <img>: drop-shadow follows PNG alpha past the selection box
      Object.assign(img.style, {
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: layer.fit || 'contain',
        pointerEvents: 'none',
      });
      appendImageContent(el, layer, img, masked);
    }
    if(masked) el.addEventListener('dblclick', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); startVertexEdit(layer.id); });
  } else if (layer.type === 'gradient') {
    Object.assign(el.style, {
      background: gradientCssBackground(layer),
      borderRadius: (layer.radius || 0) + 'px',
    });
    applyLayerEffectsDom(el, layer);
  } else if (layer.type === 'shape') {
    el.appendChild(shapeSvgEl(layer));
    applyLayerEffectsDom(el, layer);
    el.addEventListener('dblclick', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); startVertexEdit(layer.id); });
  }
  const editingVertices = vertexEditActive(layer) && isSelected(layer.id) && !layerLocked(layer);
  if(editingVertices){
    el.classList.add('vertexEditing');
    appendVertexHandles(el, layer);
  }
  el.addEventListener('mousedown', (ev) => startDrag(ev, layer.id, ev.target?.dataset?.handle || null));
  return el;
}
function layersSortedTopFirst(){
  return [...state.layers].sort((a,b)=>(b.z||0)-(a.z||0));
}

/** Reorder by list position (top of list = front = highest z). */
function reorderLayerInList(fromId, toId, placeBefore){
  if(!fromId || !toId || fromId === toId) return;
  const order = layersSortedTopFirst().map(l => l.id);
  const fromIdx = order.indexOf(fromId);
  if(fromIdx < 0) return;
  order.splice(fromIdx, 1);
  let insertAt = order.indexOf(toId);
  if(insertAt < 0) return;
  if(!placeBefore) insertAt += 1;
  order.splice(insertAt, 0, fromId);
  pushHistory();
  const n = order.length;
  order.forEach((id, i)=>{
    const layer = state.layers.find(x => x.id === id);
    if(layer) layer.z = n - i;
  });
  markDirty();
  render();
}

function clearLayerListDragMarks(box){
  box?.querySelectorAll('.layerItem.dragOverBefore, .layerItem.dragOverAfter, .layerItem.dragging')
    .forEach((el)=> el.classList.remove('dragOverBefore', 'dragOverAfter', 'dragging'));
}

function renderLayerList(){
  const box=$('layersList'); if(!box) return;
  box.innerHTML='';
  layersSortedTopFirst().forEach((l)=>{
    const row=document.createElement('div');
    row.className='layerItem'+(isSelected(l.id)?' active':'')+(!layerVisible(l)?' hiddenLayer':'')+(layerLocked(l)?' lockedLayer':'');
    row.draggable = true;
    row.dataset.id = l.id;

    const grip=document.createElement('span');
    grip.className='layerDrag';
    grip.title='Trascina per cambiare ordine';
    grip.textContent='⋮⋮';

    const eye=document.createElement('button');
    eye.type='button';
    eye.className='layerEye'+(layerVisible(l)?'':' off');
    eye.title=layerVisible(l)?'Nascondi layer':'Mostra layer';
    eye.textContent=layerVisible(l)?'◉':'○';
    eye.onclick=(ev)=>{ ev.stopPropagation(); toggleLayerVisible(l.id); };

    const lock=document.createElement('button');
    lock.type='button';
    lock.className='layerLock'+(layerLocked(l)?' on':'');
    lock.title=layerLocked(l)?'Sblocca layer':'Blocca layer';
    lock.textContent=layerLocked(l)?'🔒':'🔓';
    lock.onclick=(ev)=>{ ev.stopPropagation(); toggleLayerLocked(l.id); };

    const info=document.createElement('div');
    info.className='layerItemMain';
    info.innerHTML=`<span>${escapeHtml(l.name||l.type)}</span><small>${l.type} · z${l.z||0}</small>`;
    info.onclick=(ev)=>{ if(ev.shiftKey || ev.metaKey || ev.ctrlKey) toggleSelect(l.id); else selectOnly(l.id); render(); };

    row.addEventListener('dragstart', (ev)=>{
      if(ev.target.closest('button')){ ev.preventDefault(); return; }
      ev.dataTransfer.setData('text/layer-id', l.id);
      ev.dataTransfer.setData('text/plain', l.id);
      ev.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
      state._dragLayerId = l.id;
    });
    row.addEventListener('dragend', ()=>{
      clearLayerListDragMarks(box);
      state._dragLayerId = null;
    });
    row.addEventListener('dragover', (ev)=>{
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const before = ev.clientY < rect.top + rect.height / 2;
      row.classList.toggle('dragOverBefore', before);
      row.classList.toggle('dragOverAfter', !before);
      box.querySelectorAll('.layerItem').forEach((el)=>{
        if(el !== row) el.classList.remove('dragOverBefore', 'dragOverAfter');
      });
    });
    row.addEventListener('dragleave', (ev)=>{
      if(!row.contains(ev.relatedTarget)) row.classList.remove('dragOverBefore', 'dragOverAfter');
    });
    row.addEventListener('drop', (ev)=>{
      ev.preventDefault();
      const fromId = ev.dataTransfer.getData('text/layer-id') || ev.dataTransfer.getData('text/plain') || state._dragLayerId;
      const rect = row.getBoundingClientRect();
      const placeBefore = ev.clientY < rect.top + rect.height / 2;
      clearLayerListDragMarks(box);
      reorderLayerInList(fromId, l.id, placeBefore);
    });

    row.append(grip, eye, lock, info);
    box.appendChild(row);
  });
}
/** scope 'single' = solo layer primario; altrimenti tutti i selezionati (filtrati per types). */
const PROP_RULES = {
  z:{scope:'single'}, name:{scope:'single'},
  text:{scope:'single',types:['text']}, src:{scope:'single',types:['image']},
  x:{}, y:{}, w:{}, h:{}, rotation:{}, skewX:{}, skewY:{}, opacity:{}, blendMode:{}, visible:{}, locked:{},
  shadow:{types:['text','image','rect','gradient','shape']},
  shapeKind:{types:['shape']}, sides:{types:['shape']}, corner:{types:['shape']},
  fillEnabled:{types:['shape']}, points:{scope:'single',types:['shape']},
  arrowHead:{types:['shape']}, arrowHeadSize:{types:['shape']}, arrowDash:{types:['shape']},
  arrowDouble:{types:['shape']}, arrowTail:{types:['shape']},
  fontSize:{types:['text']}, fontWeight:{types:['text']}, fontFamily:{types:['text']},
  fontStyle:{types:['text']}, underline:{types:['text']}, strikethrough:{types:['text']},
  textTransform:{types:['text']}, letterSpacing:{types:['text']}, color:{types:['text']},
  align:{types:['text']}, vAlign:{types:['text']}, lineHeight:{types:['text']}, glow:{types:['text']},
  fill:{types:['rect','shape']}, stroke:{types:['rect','shape']}, strokeWidth:{types:['rect','shape']}, radius:{types:['rect']},
  fit:{types:['image']}, adjust:{types:['image']}, keyBlack:{types:['image']},
  maskKind:{types:['image']}, maskSides:{types:['image']}, maskCorner:{types:['image']},
  maskPoints:{scope:'single',types:['image']},
  gradientType:{types:['gradient']}, angle:{types:['gradient']}, stops:{types:['gradient']},
};
const PROP_OBJECT_KEYS = new Set(['shadow','glow','adjust','keyBlack','stops','points','maskPoints']);

function targetLayersForKey(key){
  const rule = PROP_RULES[key] || {};
  const primary = selected();
  if(rule.scope === 'single'){
    if(!primary) return [];
    if(rule.types && !rule.types.includes(primary.type)) return [];
    return [primary];
  }
  let targets = selectedLayers();
  if(rule.types) targets = targets.filter((l) => rule.types.includes(l.type));
  if(!targets.length && primary){
    if(!rule.types || rule.types.includes(primary.type)) targets = [primary];
  }
  return targets;
}

function clonePropValue(key, value){
  if(value == null || !PROP_OBJECT_KEYS.has(key) || typeof value !== 'object') return value;
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function renderProps(){
  const sel = selectedLayers();
  const primary = selected() || sel[0] || null;
  $('emptyProps').hidden = !!sel.length;
  $('props').hidden = !sel.length;
  const context = document.querySelector('.inspectorContext');
  if(context) context.textContent = sel.length > 1 ? `${sel.length} layer` : (primary?.type || 'Inspector');
  if(!sel.length || !primary) return;

  const has = (t) => sel.some((l) => l.type === t);
  const repr = (t) => (primary.type === t ? primary : sel.find((l) => l.type === t));

  setVal('propName', primary.name);
  setVal('propX', Math.round(primary.x));
  setVal('propY', Math.round(primary.y));
  setVal('propW', Math.round(primary.w));
  setVal('propH', Math.round(primary.h));
  setVal('propZ', primary.z || 1);
  setVal('propOpacity', primary.opacity ?? 1);
  setVal('propRotation', primary.rotation || 0);
  setVal('propSkewX', primary.skewX || 0);
  setVal('propSkewY', primary.skewY || 0);
  populateBlendSelect($('propBlendMode'), primary.blendMode);
  const vis = $('propVisible'); if(vis) vis.checked = layerVisible(primary);
  const lockEl = $('propLocked'); if(lockEl) lockEl.checked = layerLocked(primary);

  $('textProps').hidden = !has('text');
  $('boxProps').hidden = !has('rect');
  const shapeProps = $('shapeProps'); if(shapeProps) shapeProps.hidden = !has('shape');
  $('imageProps').hidden = !has('image');
  const gradProps = $('gradientProps'); if(gradProps) gradProps.hidden = !has('gradient');
  const alignObjects = $('alignObjectsProps'); if(alignObjects) alignObjects.hidden = sel.length < 2;

  const textL = repr('text');
  if(textL){
    const ff = textL.fontFamily || textL.font || 'Arial';
    populateFontSelect(ff);
    setVal('propText', textL.text);
    setVal('propFontSize', textL.fontSize);
    syncFontSizeRange(textL.fontSize);
    setVal('propFontWeight', textL.fontWeight || '400');
    setVal('propFontFamily', ff);
    setVal('propColor', textL.color || '#000000');
    setVal('propAlign', textL.align || 'left');
    setVal('propVAlign', textL.vAlign || 'top');
    setVal('propLineHeight', textL.lineHeight || 1.1);
    setVal('propTextTransform', textL.textTransform || 'none');
    setVal('propLetterSpacing', textL.letterSpacing ?? 0);
    syncTextStyleToggles(textL);
  }

  const rectL = repr('rect');
  if(rectL){
    setVal('propFill', rgbToHex(rectL.fill || '#eb0029'));
    setVal('propStroke', rgbToHex(rectL.stroke || '#eb0029'));
    setVal('propStrokeWidth', rectL.strokeWidth || 0);
    setVal('propRadius', rectL.radius || 0);
  }

  const imageL = repr('image');
  if(imageL){
    setVal('propFit', imageL.fit || 'contain');
    setVal('propImageSrc', isEmbeddedSrc(imageL.src) ? '(base64 incorporato)' : (imageL.src || ''));
    const srcHint = $('imageSrcHint');
    if(srcHint) srcHint.textContent = isEmbeddedSrc(imageL.src)
      ? 'Sorgente pesante (data URI). Preferisci un path tipo _assets/…'
      : 'Path relativo alla root campagne (es. _assets/fuoco/file.png).';
    syncKeyBlackProps(imageL);
    syncImageAdjustProps(imageL);
    syncImageMaskProps?.(imageL);
  }

  const warpBox = $('warpProps');
  if(warpBox) warpBox.hidden = !sel.some(warpSupported);
  syncWarpModeUi();

  const svgL = isInlineSvgLayer(primary) ? primary : sel.find(isInlineSvgLayer);
  const svgTintBox = $('svgTintProps');
  if(svgTintBox) svgTintBox.hidden = !svgL;
  if(svgL) syncSvgTintProps(svgL);

  const gradL = repr('gradient');
  if(gradL) syncGradientProps(gradL);

  const shapeL = repr('shape');
  if(shapeL) syncShapeProps(shapeL);

  const fxBox = $('effectProps');
  if(fxBox) fxBox.hidden = !(has('text') || has('image') || has('rect') || has('gradient') || has('shape'));
  const glowBox = $('glowProps');
  if(glowBox) glowBox.hidden = !has('text');
  const shadowSrc = has('text') ? (textL || primary) : (imageL || rectL || gradL || shapeL || primary);
  syncEffectInputs('propShadow', shadowSrc.shadow, defaultShadow());
  if(textL) syncEffectInputs('propGlow', textL.glow, defaultGlow());
}
function setVal(id,v){
  const el=$(id);
  if(!el) return;
  el.value = v ?? '';
  el._syncQuickRange?.();
  el._syncSegmented?.();
  el._syncHexField?.();
}
function syncFontSizeRange(v){
  const range = $('propFontSizeRange');
  if(!range) return;
  const n = Math.max(8, Math.min(400, Number(v) || 48));
  if(Number(v) > 400) range.max = String(Math.ceil(Number(v)));
  else if(Number(range.max) > 400 && n <= 400) range.max = '400';
  range.value = String(n);
}
function beginPropHistory(){ if(!propHistoryPending){ pushHistory(); propHistoryPending = true; } }
function commitPropHistory(){ propHistoryPending = false; if(propHistoryTimer){ clearTimeout(propHistoryTimer); propHistoryTimer = null; } }
function updateProp(key, value, opts={}){
  const targets = targetLayersForKey(key);
  if(!targets.length) return;
  const unlockKeys = key === 'locked' || key === 'visible' || key === 'name';
  const writable = targets.filter((l) => unlockKeys || !layerLocked(l));
  if(!writable.length){
    showToast('Layer bloccato — sblocca per modificare');
    return;
  }
  if(opts.history !== false){
    if(opts.debounce){
      beginPropHistory();
      clearTimeout(propHistoryTimer);
      propHistoryTimer = setTimeout(commitPropHistory, 450);
    } else {
      pushHistory();
    }
  }
  writable.forEach((l) => { l[key] = clonePropValue(key, value); });
  markDirty();
  render();
}

function syncTextStyleToggles(layer){
  document.querySelectorAll('[data-style-toggle]').forEach((btn)=>{
    const key = btn.dataset.styleToggle;
    const on = key === 'italic' ? layer.fontStyle === 'italic' : !!layer[key];
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function startInlineTextEdit(ev, id){
  ev.preventDefault(); ev.stopPropagation();
  const layer = state.layers.find(l=>l.id===id); if(!layer || layer.type!=='text') return;
  selectOnly(id); render();
  const el = document.querySelector(`.layer[data-id="${id}"]`); if(!el) return;
  pushHistory();
  el.classList.add('editing');
  el.textContent = layer.text || '';
  el.style.textTransform = 'none';
  el.style.whiteSpace = 'pre-wrap';
  el.contentEditable = 'true';
  el.focus();
  document.execCommand?.('selectAll', false, null);
  const finish = () => {
    layer.text = el.innerText.replace(/\n$/,'');
    el.contentEditable = 'false';
    el.classList.remove('editing');
    el.removeEventListener('blur', finish);
    el.removeEventListener('keydown', onKey);
    markDirty();
    render();
  };
  const onKey = (e) => {
    if(e.key === 'Escape'){ e.preventDefault(); restoreSnapshot(state.history.pop()); }
    if((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='enter'){ e.preventDefault(); el.blur(); }
  };
  el.addEventListener('blur', finish);
  el.addEventListener('keydown', onKey);
}

function groupBox(layers){
  const xs=layers.map(l=>l.x), ys=layers.map(l=>l.y), x2=layers.map(l=>l.x+l.w), y2=layers.map(l=>l.y+l.h);
  const x=Math.min(...xs), y=Math.min(...ys), r=Math.max(...x2), b=Math.max(...y2);
  return {x,y,w:r-x,h:b-y};
}
const SHIFT_DRAG_THRESHOLD = 3;

/**
 * Shift on a layer: a click that never moves ticks it, a drag moves the selection
 * with the axis locked from the very first pixel.
 */
function beginShiftGesture(ev, id){
  const sx = ev.clientX, sy = ev.clientY;
  let started = false;

  const onMove = (move) => {
    if(started) return;
    if(Math.abs(move.clientX - sx) < SHIFT_DRAG_THRESHOLD
       && Math.abs(move.clientY - sy) < SHIFT_DRAG_THRESHOLD) return;
    started = true;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    // A layer nobody had selected becomes the selection, exactly as a plain drag does.
    if(!isSelected(id)) selectOnly(id);
    // The drag starts from where the press was, not from here, so the first three
    // pixels are not lost.
    if(startMoveDrag(id, sx, sy)) onLayerMove(move);
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if(started) return;
    toggleSelect(id);
    render();
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/** The move half of startDrag, shared with the Shift gesture. Returns false if nothing moves. */
function startMoveDrag(id, sx, sy){
  const target = state.layers.find(l => l.id === id);
  if(layerLocked(target)){
    if(!isSelected(id)){ selectOnly(id); render(); }
    return false;
  }
  const layers = selectedLayers().filter(l => !layerLocked(l));
  if(!layers.length){ render(); return false; }
  pushHistory();
  drag = { id, handle: null, resizing: false, cropMode: false, freeResizeMode: false, sx, sy,
           originals: layers.map(l=>({id:l.id,x:l.x,y:l.y,w:l.w,h:l.h,crop:l.crop?JSON.parse(JSON.stringify(l.crop)):null,type:l.type,fontSize:l.fontSize,letterSpacing:l.letterSpacing,maskKind:l.maskKind||null,maskSides:l.maskSides,maskPoints:l.maskPoints?JSON.parse(JSON.stringify(l.maskPoints)):null})),
           box: groupBox(layers) };
  document.addEventListener('mousemove', onLayerMove);
  document.addEventListener('mouseup', endDrag);
  render();
  return true;
}

function startDrag(ev, id, handle=null){
  // In marquee mode a drag over a layer must reach the canvas, so this bails out
  // WITHOUT stopping propagation — the handles stay live, or resizing would die too.
  if(!handle && state.marqueeMode) return;
  ev.preventDefault(); ev.stopPropagation();
  const target = state.layers.find(l => l.id === id);
  if(!handle && ev.shiftKey && !ev.metaKey && !ev.ctrlKey){
    // Shift+click ticks a layer, Shift+drag moves on one axis: two gestures that only
    // share their first instant, so the choice is made at the drag threshold rather
    // than at mousedown. Deciding early is what forced the axis lock to be pressed
    // late, after the move had already started off-axis.
    beginShiftGesture(ev, id);
    return;
  }
  if(!handle && isSelectionModifier(ev)){
    toggleSelect(id);
    render();
    return;
  }
  if(layerLocked(target)){
    if(!isSelected(id)){
      selectOnly(id);
      render();
    }
    return;
  }
  const resizing = !!handle;
  const cropMode = resizing && (ev.ctrlKey || ev.metaKey || (state.cropMode && target?.type === 'image'));
  const freeResizeMode = resizing && ev.shiftKey;
  // On corner handles, modifier keys control resize/crop behavior, not selection.
  // If the handle target is not already selected, resize only that layer.
  // Ctrl/Cmd crop must always operate on a single image layer.
  if(resizing){
    if(cropMode || !isSelected(id)) selectOnly(id);
  } else if(!isSelected(id)) selectOnly(id);
  const layers=selectedLayers().filter(l => !layerLocked(l));
  if(!layers.length){ render(); return; }
  pushHistory();
  drag={ id, handle, resizing, cropMode, freeResizeMode, sx:ev.clientX, sy:ev.clientY, originals: layers.map(l=>({id:l.id,x:l.x,y:l.y,w:l.w,h:l.h,crop:l.crop?JSON.parse(JSON.stringify(l.crop)):null,type:l.type,fontSize:l.fontSize,letterSpacing:l.letterSpacing,maskKind:l.maskKind||null,maskSides:l.maskSides,maskPoints:l.maskPoints?JSON.parse(JSON.stringify(l.maskPoints)):null})), box: groupBox(layers) };
  document.addEventListener('mousemove', onLayerMove); document.addEventListener('mouseup', endDrag); render();
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function normalizedCrop(l){
  const c=l.crop || {x:0,y:0,w:1,h:1};
  const x=clamp(Number(c.x)||0,0,.98), y=clamp(Number(c.y)||0,0,.98);
  const w=clamp(Number(c.w)||1,.02,1-x), h=clamp(Number(c.h)||1,.02,1-y);
  return {x,y,w,h};
}
function applyImageCropFromHandle(layer, original, handle, dx, dy, keepAspect=false){
  const min=.04;
  const c=original.crop || {x:0,y:0,w:1,h:1};
  const right=c.x+c.w, bottom=c.y+c.h;
  let ddx=dx/Math.max(1, original.w), ddy=dy/Math.max(1, original.h);
  if(keepAspect){
    // The dominant axis leads, the other follows at the crop's own ratio, signed so
    // that every corner handle grows or shrinks both axes together.
    const ratio = c.w / Math.max(1e-6, c.h);
    const sx = handle.includes('w') ? -1 : 1;
    const sy = handle.includes('n') ? -1 : 1;
    if(Math.abs(ddx) >= Math.abs(ddy)) ddy = (sx * ddx) / ratio * sy;
    else ddx = (sy * ddy) * ratio * sx;
  }
  let x=c.x, y=c.y, w=c.w, h=c.h;
  if(handle.includes('w')){ x=clamp(c.x+ddx,0,right-min); w=right-x; }
  if(handle.includes('e')){ w=clamp(c.w+ddx,min,1-c.x); }
  if(handle.includes('n')){ y=clamp(c.y+ddy,0,bottom-min); h=bottom-y; }
  if(handle.includes('s')){ h=clamp(c.h+ddy,min,1-c.y); }
  layer.crop={x,y,w,h};
}
/**
 * Alt-drag on a corner handle in crop mode: move one mask vertex independently.
 * The vertex is picked once, from the ORIGINAL points, as the one nearest the
 * dragged corner — so a mask that is already warped keeps a stable target for the
 * whole drag instead of hopping between vertices mid-move.
 */
function applyMaskVertexFromHandle(layer, original, handle, dx, dy){
  const base = original.maskPoints
    || shapePoints(imageMaskProxy({ maskKind: original.maskKind || 'rect', maskPoints: null,
                                    maskSides: original.maskSides, w: original.w, h: original.h }));
  const target = [handle.includes('e') ? 1 : 0, handle.includes('s') ? 1 : 0];
  let idx = 0, best = Infinity;
  base.forEach((p, i) => {
    const d = (p[0]-target[0])**2 + (p[1]-target[1])**2;
    if(d < best){ best = d; idx = i; }
  });
  const pts = base.map(p => [p[0], p[1]]);
  pts[idx] = [
    clamp(base[idx][0] + dx/Math.max(1, original.w), -1, 2),
    clamp(base[idx][1] + dy/Math.max(1, original.h), -1, 2),
  ];
  if(!layer.maskKind || layer.maskKind === 'none') layer.maskKind = 'rect';
  layer.maskPoints = pts;
}

function resizeBoxFromHandle(original, handle, dx, dy, keepAspect=false){
  let left=original.x, top=original.y, right=original.x+original.w, bottom=original.y+original.h;
  if(handle.includes('w')) left += dx;
  if(handle.includes('e')) right += dx;
  if(handle.includes('n')) top += dy;
  if(handle.includes('s')) bottom += dy;
  let w=Math.max(10,right-left), h=Math.max(10,bottom-top);
  if(keepAspect){
    const aspect=original.w/Math.max(1,original.h);
    const anchorX=handle.includes('w') ? original.x+original.w : original.x;
    const anchorY=handle.includes('n') ? original.y+original.h : original.y;
    if(Math.abs(dx) > Math.abs(dy)) h=w/aspect; else w=h*aspect;
    left=handle.includes('w') ? anchorX-w : anchorX;
    right=handle.includes('w') ? anchorX : anchorX+w;
    top=handle.includes('n') ? anchorY-h : anchorY;
    bottom=handle.includes('n') ? anchorY : anchorY+h;
    w=Math.max(10,right-left); h=Math.max(10,bottom-top);
  }
  return {x:left,y:top,w,h};
}
/**
 * Type follows the box: everything measured in px scales by the same factor the box
 * did, so the block keeps its proportions instead of reflowing into a new shape.
 * The box is resized with its aspect locked, so one factor describes both sides.
 */
function scaleTextWithBox(layer, original){
  const factor = layer.w / Math.max(1, original.w);
  if(!isFinite(factor) || factor <= 0) return;
  const size = Number(original.fontSize);
  if(size) layer.fontSize = Math.max(1, Math.round(size * factor * 10) / 10);
  const spacing = Number(original.letterSpacing);
  if(spacing) layer.letterSpacing = Math.round(spacing * factor * 100) / 100;
}

/** The live drag: resize, crop, warp or move, depending on how it started. */
function onLayerMove(ev){
  if(!drag) return;
  const scale=state.zoom/100; const dx=(ev.clientX-drag.sx)/scale; const dy=(ev.clientY-drag.sy)/scale;
  if(drag.resizing){
    const single = drag.originals.length === 1;
    const orig = drag.originals[0];
    const layer = single ? state.layers.find(x=>x.id===orig.id) : null;
    const toggleCrop = state.cropMode && single && layer?.type === 'image';
    const maskVertexMode = toggleCrop && ev.altKey;
    const cropMode = single && layer?.type === 'image' && !maskVertexMode
      && (drag.cropMode || ev.ctrlKey || ev.metaKey || toggleCrop);
    // In crop mode the natural drag keeps the crop's own ratio; Cmd frees it.
    // Outside crop mode Cmd-crop stays free, exactly as before.
    const cropKeepAspect = toggleCrop && !(ev.ctrlKey || ev.metaKey);
    const freeResizeMode = drag.freeResizeMode || ev.shiftKey;
    // On text, Cmd scales the type with the box: the plain drag reflows the same
    // wording inside a new box, this one blows the whole block up or down.
    const textScaleMode = single && layer?.type === 'text' && (ev.metaKey || ev.ctrlKey);
    const keepAspect = single && !freeResizeMode && !cropMode
      && (layer?.type === 'image' || textScaleMode);
    if(maskVertexMode){
      applyMaskVertexFromHandle(layer, orig, drag.handle, dx, dy);
    } else if(cropMode){
      applyImageCropFromHandle(layer, orig, drag.handle, dx, dy, cropKeepAspect);
    } else if(single){
      Object.assign(layer, resizeBoxFromHandle(orig, drag.handle, dx, dy, keepAspect));
      if(textScaleMode) scaleTextWithBox(layer, orig);
    } else {
      const newBox=resizeBoxFromHandle(drag.box, drag.handle, dx, dy, false);
      const sx=newBox.w/Math.max(1,drag.box.w), sy=newBox.h/Math.max(1,drag.box.h);
      drag.originals.forEach(o=>{ const l=state.layers.find(x=>x.id===o.id); if(!l) return; l.x=newBox.x+(o.x-drag.box.x)*sx; l.y=newBox.y+(o.y-drag.box.y)*sy; l.w=Math.max(10,o.w*sx); l.h=Math.max(10,o.h*sy); });
    }
  } else {
    // Shift locks the move to the axis you have travelled furthest along, for every
    // selected layer at once. It is read live, so it can be pressed and released
    // mid-drag: the object snaps onto the axis and back off it without restarting.
    // (At mousedown Shift means "add to the selection", which is why holding it from
    // the start does not begin a move at all.)
    let mx = dx, my = dy;
    if(ev.shiftKey){
      if(Math.abs(dx) >= Math.abs(dy)) my = 0; else mx = 0;
    }
    drag.originals.forEach(o=>{ const l=state.layers.find(x=>x.id===o.id); if(!l) return; l.x=o.x+mx; l.y=o.y+my; });
  }
  render();
}
function endDrag(){ drag=null; markDirty(); document.removeEventListener('mousemove',onLayerMove); document.removeEventListener('mouseup',endDrag); }

function startMarquee(ev){
  // A drag on a layer moves that layer; the band belongs to everything else: bare
  // canvas and the stage around the artboard, where the listener also sits. The
  // toggle is what turns a drag over a layer into a band instead.
  if(ev.button !== 0) return;
  if(ev.target?.closest?.('.resizeHandle, .vertexHandle, .warpHandle')) return;
  if(ev.target?.closest?.('.layer') && !state.marqueeMode) return;
  if(drag || marquee) return;   // canvas and stage both listen: whoever gets there first wins
  ev.preventDefault();
  const rect=$('canvas').getBoundingClientRect(); const scale=state.zoom/100;
  const sx=(ev.clientX-rect.left)/scale, sy=(ev.clientY-rect.top)/scale;
  const el=document.createElement('div'); el.className='marquee';
  // Sized right away: a click that never moves must still be read as a zero-size band
  // at the cursor, not as an unstyled box parsed back as (0,0).
  Object.assign(el.style,{left:sx+'px',top:sy+'px',width:'0px',height:'0px'});
  $('canvas').appendChild(el);
  marquee={sx,sy,el, additive: ev.shiftKey || ev.metaKey || ev.ctrlKey};
  document.addEventListener('mousemove', onMarqueeMove); document.addEventListener('mouseup', endMarquee);
}
function onMarqueeMove(ev){
  if(!marquee) return; const rect=$('canvas').getBoundingClientRect(); const scale=state.zoom/100;
  const x=(ev.clientX-rect.left)/scale, y=(ev.clientY-rect.top)/scale;
  const left=Math.min(marquee.sx,x), top=Math.min(marquee.sy,y), w=Math.abs(x-marquee.sx), h=Math.abs(y-marquee.sy);
  Object.assign(marquee.el.style,{left:left+'px',top:top+'px',width:w+'px',height:h+'px'});
}
/**
 * A band that ends on bare canvas is followed by a plain click on the canvas, and the
 * click handler clears the selection: the rubber band appeared to do nothing. The
 * click right after a band is therefore swallowed.
 */
let marqueeEndedAt = 0;
function marqueeJustEnded(){ return performance.now() - marqueeEndedAt < 250; }

function endMarquee(){
  if(!marquee) return;
  marqueeEndedAt = performance.now();
  const m={x:parseFloat(marquee.el.style.left)||0,y:parseFloat(marquee.el.style.top)||0,w:parseFloat(marquee.el.style.width)||0,h:parseFloat(marquee.el.style.height)||0};
  // Locked layers are not grabbable on the canvas, so a rubber band must not pick
  // them up either: dragging across one would otherwise pull it into a selection
  // that cannot be moved.
  let hits=state.layers.filter(l=> layerVisible(l) && !layerLocked(l) && intersects(m,l)).map(l=>l.id);
  // A band that never moved is a plain click: it must select the topmost layer under
  // the cursor, not the whole stack the point happens to fall on.
  if(m.w < 3 && m.h < 3) hits = hits.slice(-1);
  if(!marquee.additive) state.selectedIds=[];
  hits.forEach(id=>{ if(!state.selectedIds.includes(id)) state.selectedIds.push(id); });
  state.selectedId=state.selectedIds.at(-1)||null;
  marquee.el.remove(); marquee=null; document.removeEventListener('mousemove',onMarqueeMove); document.removeEventListener('mouseup',endMarquee); render();
}
function intersects(a,b){ return !(b.x > a.x+a.w || b.x+b.w < a.x || b.y > a.y+a.h || b.y+b.h < a.y); }

let fontBrowseHistoryStarted = false;

/** Live font preview while arrowing the <select> — keeps layer selection + select focus. */
function applyFontFamilyLive(family){
  const name = String(family || '').trim();
  const targets = targetLayersForKey('fontFamily').filter((l) => !layerLocked(l));
  if(!name || !targets.length){
    updateFontAvailabilityHint(name);
    return;
  }
  const changed = targets.some((l) => (l.fontFamily || l.font) !== name);
  if(!changed){
    updateFontAvailabilityHint(name);
    return;
  }
  if(!fontBrowseHistoryStarted){
    pushHistory();
    fontBrowseHistoryStarted = true;
  }
  targets.forEach((l) => { l.fontFamily = name; refreshLayerOnStage(l); });
  markDirty();
  updateFontAvailabilityHint(name);
}

function bindFontFamilyLiveBrowse(){
  const sel = $('propFontFamily');
  if(!sel || sel.dataset.liveBound) return;
  sel.dataset.liveBound = '1';

  const applyFromSelect = () => applyFontFamilyLive(sel.value);
  const openList = ()=>{
    sel.dataset.fontBrowse = '1';
    // Inline listbox: arrows change value immediately (native popup often delays change)
    const n = Math.min(16, Math.max(8, sel.options.length));
    sel.size = n;
    sel.classList.add('fontSelectOpen');
  };
  const closeList = ()=>{
    sel.size = 1;
    sel.classList.remove('fontSelectOpen');
    sel.dataset.fontBrowse = '0';
  };

  sel.addEventListener('focus', ()=>{
    fontBrowseHistoryStarted = false;
    openList();
  });
  sel.addEventListener('blur', ()=>{
    closeList();
    fontBrowseHistoryStarted = false;
    commitPropHistory();
  });
  sel.addEventListener('change', ()=>{
    applyFromSelect();
    waitForFont?.(sel.value)?.then(()=>render());
  });
  sel.addEventListener('input', ()=>{
    applyFromSelect();
    waitForFont?.(sel.value)?.then(()=>render());
  });
  sel.addEventListener('keydown', (ev)=>{
    if(ev.key === 'Escape'){ sel.blur(); return; }
    if(ev.key === 'Enter'){ sel.blur(); return; }
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(ev.key)) return;
    sel.dataset.fontBrowse = '1';
    // After browser moves selectedIndex, paint the layer
    requestAnimationFrame(()=> requestAnimationFrame(()=>{
      applyFromSelect();
      waitForFont?.(sel.value)?.then(()=>render());
    }));
  });
}

const WEIGHT_NAMES = {
  100:'Thin', 200:'Extra Light', 300:'Light', 400:'Regular', 500:'Medium',
  600:'Semi Bold', 700:'Bold', 800:'Extra Bold', 900:'Black',
};
function fontInfoString(l){
  const parts = [
    `font: ${l.fontFamily || l.font || 'Arial'}`,
    `Size: ${Number(l.fontSize) || 0}px`,
    WEIGHT_NAMES[Number(l.fontWeight) || 400] || String(l.fontWeight || '400'),
  ];
  if(l.fontStyle === 'italic') parts.push('Italic');
  if(l.underline) parts.push('Underline');
  if(l.strikethrough) parts.push('Strike');
  return parts.join(' - ');
}

function bindProps(){
  const numeric=['X','Y','W','H','Z','Opacity','Rotation','SkewX','SkewY','FontSize','LineHeight','LetterSpacing','StrokeWidth','Radius'];
  numeric.forEach(k=>{
    const id='prop'+k; const el=$(id); if(!el) return;
    const key=k.charAt(0).toLowerCase()+k.slice(1);
    el.addEventListener('focus', beginPropHistory);
    el.addEventListener('input',()=>{
      if(key === 'fontSize') syncFontSizeRange(el.value);
      updateProp(key, Number(el.value), {history:false, debounce:true});
    });
    el.addEventListener('blur', commitPropHistory);
  });
  const fontSizeRange = $('propFontSizeRange');
  if(fontSizeRange){
    fontSizeRange.addEventListener('pointerdown', beginPropHistory);
    fontSizeRange.addEventListener('input', ()=>{
      const n = Number(fontSizeRange.value);
      setVal('propFontSize', n);
      updateProp('fontSize', n, {history:false, debounce:true});
    });
    fontSizeRange.addEventListener('change', commitPropHistory);
  }
  $('propName').oninput=()=>updateProp('name',$('propName').value);
  $('copyLayerRefBtn')?.addEventListener('click', (ev)=>copyLayerRef({nameOnly: ev.altKey}));
  $('propVisible')?.addEventListener('change', ()=>updateProp('visible', $('propVisible').checked));
  $('propLocked')?.addEventListener('change', ()=>updateProp('locked', $('propLocked').checked));
  $('propBlendMode')?.addEventListener('change', ()=>updateProp('blendMode', normalizeBlendMode($('propBlendMode').value)));
  const applyKeyBlack = ()=>updateProp('keyBlack', readKeyBlackFromUi(), {debounce:true});
  ['propKeyBlackEnabled','propKeyColor','propKeyThreshold','propKeySoftness'].forEach((id)=>{
    $(id)?.addEventListener('change', applyKeyBlack);
    $(id)?.addEventListener('input', applyKeyBlack);
  });
  $('propText').oninput=()=>updateProp('text',$('propText').value);
  $('propFontWeight').onchange=()=>updateProp('fontWeight',$('propFontWeight').value);
  bindFontFamilyLiveBrowse();
  $('propTextTransform').onchange=()=>updateProp('textTransform',$('propTextTransform').value);
  $('propColor').oninput=()=>updateProp('color',$('propColor').value);
  $('propAlign').onchange=()=>updateProp('align',$('propAlign').value);
  $('propVAlign').onchange=()=>updateProp('vAlign',$('propVAlign').value);
  $('propFill').oninput=()=>updateProp('fill',$('propFill').value);
  $('propStroke').oninput=()=>updateProp('stroke',$('propStroke').value);
  $('propFit').onchange=()=>updateProp('fit',$('propFit').value);
  const applyImageAdjust = ()=>updateProp('adjust', readImageAdjustFromUi(), {history:false, debounce:true});
  ['propBright','propContrast','propSaturate','propVivid'].forEach((id)=>{
    $(id)?.addEventListener('input', applyImageAdjust);
    $(id)?.addEventListener('change', applyImageAdjust);
  });
  $('propAdjustReset')?.addEventListener('click', ()=>{
    updateProp('adjust', null);
    syncImageAdjustProps({ adjust: null });
  });
  $('propGradientType')?.addEventListener('change', ()=>updateProp('gradientType', $('propGradientType').value));
  $('propGradientAngle')?.addEventListener('input', ()=>updateProp('angle', Number($('propGradientAngle').value), {history:false, debounce:true}));
  ['propGradStopAColor','propGradStopAAlpha','propGradStopBColor','propGradStopBAlpha'].forEach((id)=>{
    $(id)?.addEventListener('input', ()=>updateProp('stops', readGradientStopsFromUi(), {history:false, debounce:true}));
  });
  $('propImageSrcApply')?.addEventListener('click', ()=>{
    const raw = ($('propImageSrc')?.value || '').trim();
    if(!raw || raw.startsWith('(base64')){ alert('Inserisci un path asset, es. _assets/fuoco/file.png'); return; }
    updateProp('src', campaignsRelativeSrc(raw));
  });
  const bindEffect = (prefix, key, withOffset) => {
    const apply = () => updateProp(key, readEffectFromUi(prefix, withOffset), {debounce:true});
    ['Enabled','Color','Blur','Opacity','OffsetX','OffsetY'].forEach((suffix)=>{
      const el = $(prefix + suffix);
      if(!el) return;
      el.addEventListener('change', apply);
      el.addEventListener('input', apply);
    });
  };
  bindEffect('propShadow', 'shadow', true);
  bindEffect('propGlow', 'glow', false);
  bindShapeProps();
  bindImageMaskProps?.();
  bindSvgTintProps();
  bindWarpProps();
  bindBgRemove?.();
  document.querySelectorAll('[data-style-toggle]').forEach((btn)=>{
    btn.onclick=()=>{
      const key=btn.dataset.styleToggle;
      const propKey = key === 'italic' ? 'fontStyle' : key;
      const targets = targetLayersForKey(propKey).filter((l) => !layerLocked(l));
      if(!targets.length) return;
      pushHistory();
      const primary = selected() || targets[0];
      const nextItalic = primary.fontStyle === 'italic' ? 'normal' : 'italic';
      const nextBool = !primary[key];
      targets.forEach((l)=>{
        if(key==='italic') l.fontStyle = nextItalic;
        else l[key] = nextBool;
      });
      markDirty();
      render();
    };
  });
  $('copyFontInfoBtn')?.addEventListener('click', async ()=>{
    const l = selected();
    if(!l || l.type !== 'text') return;
    const text = fontInfoString(l);
    try{
      await copyTextToClipboard(text);
      showToast('Copiato: ' + text);
    }catch(e){
      showToast('Copia fallita: ' + (e.message || e));
    }
  });
}

function layoutPayload(){
  return { version:1, app:'roby-visual-layout-editor', canvas:state.canvas, layers:state.layers };
}
async function saveJsonOverwrite(){
  // 1) Layout da libreria / API (path server) — salva l'intero progetto:
  // il base nel .layout.json e ogni variante modificata nel suo sidecar.
  if(state.currentLayoutPath){
    // Whatever is on screen may be a variant, so the base written here comes from the
    // variants module, not from the canvas.
    const baseLayers = typeof variantsBaseLayersForSave === 'function'
      ? variantsBaseLayersForSave()
      : state.layers;
    const res = await fetch('/api/save-layout', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path: state.currentLayoutPath, layout: {...layoutPayload(), layers: baseLayers}, client: liveClientId?.()}),
    });
    const data = await res.json();
    if(!data.ok){ alert('Errore salvataggio JSON: ' + data.error); return; }
    state.currentLayoutPath = data.path;
    clearLocalFileHandle();
    let summary = null;
    try{
      summary = await variantsAfterBaseSave?.();
    }catch(e){
      alert('Layout salvato, ma le varianti no: ' + (e.message || e));
      return;
    }
    clearDirty();
    render();
    const extra = summary?.savedVariants
      ? ` · ${summary.savedVariants} variant${summary.savedVariants > 1 ? 'i' : 'e'}`
      : '';
    showToast('Progetto salvato: ' + data.path + extra);
    // The strip's base card reads this file: refresh the cards once it is actually
    // written, or they would reload the picture from before the save.
    uploadCurrentLayoutPreview?.().then(() => {
      if (typeof VARIANTS_STATE === 'object') VARIANTS_STATE.thumbsVersion += 1;
      renderVariantsBar?.();
    });
    return;
  }
  // 2) File aperto con Carica JSON (File System Access handle)
  if(state.localFileHandle){
    try{
      await writeJsonToLocalHandle(state.localFileHandle);
      clearDirty();
      render();
      showToast('JSON sovrascritto: ' + (state.loadedJsonFilename || state.localFileHandle.name));
    }catch(e){
      alert('Salvataggio file locale fallito: ' + e.message);
    }
    return;
  }
  // 3) Caricato senza handle → chiedi dove salvare (stesso file se l’utente lo riseleziona)
  if(typeof window.showSaveFilePicker === 'function'){
    try{
      const handle = await window.showSaveFilePicker({
        suggestedName: state.loadedJsonFilename || 'layout.layout.json',
        types: [{ description: 'Layout JSON', accept: { 'application/json': ['.json'] } }],
      });
      state.localFileHandle = handle;
      state.loadedJsonFilename = handle.name;
      await writeJsonToLocalHandle(handle);
      clearDirty();
      render();
      showToast('JSON salvato: ' + handle.name);
      return;
    }catch(e){
      if(e && e.name === 'AbortError') return;
      // fall through to download
    }
  }
  if(state.loadedJsonFilename){
    downloadLayoutJson(state.loadedJsonFilename);
    showToast('Browser senza riscrittura file: JSON scaricato come ' + state.loadedJsonFilename);
    return;
  }
  alert('Nessun file JSON aperto.\nUsa “Carica JSON”, la libreria, oppure “Scarica JSON”.');
}
async function saveLayout(){
  if(!state.currentLayoutPath){
    downloadLayoutJson(currentLayoutExportName());
    return;
  }
  return saveJsonOverwrite();
}
async function saveLayoutAs(){
  if(!state.currentLayoutPath){
    const name = prompt('Nome file JSON:', (state.loadedJsonFilename || 'layout').replace(/\.json$/i, '') + '-copy.layout.json');
    if(!name) return;
    downloadLayoutJson(name);
    return;
  }
  const current = state.currentLayoutPath.split('/').pop().replace(/\.layout\.json$/, '');
  const filename = prompt('Nome nuovo layout nella stessa cartella:', current + '-copy.layout.json');
  if(!filename) return;
  const res = await fetch('/api/save-layout-as', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({path: state.currentLayoutPath, filename, layout: layoutPayload()})});
  const data = await res.json();
  if(!data.ok){ alert('Errore salvataggio con nome: '+data.error); return; }
  const wasOnBase = !VARIANTS_STATE?.activeId;
  state.currentLayoutPath = data.path;
  clearDirty();
  uploadCurrentLayoutPreview?.();
  // From the base, the set still describes these very layers, so it travels with the
  // copy. From a variant, the new file is that variant flattened: carrying the set
  // over would mean ops written against a base that is no longer there.
  let copied = 0;
  if(wasOnBase){
    try{ copied = await copyVariantsTo?.(data.path) || 0; }
    catch(e){ showToast('Varianti non copiate: ' + (e.message || e)); }
  }
  onLayoutChangedForVariants?.();
  render();
  showToast('Layout salvato con nome: ' + data.path
    + (copied ? ` · ${copied} varianti copiate` : (wasOnBase ? '' : ' · variante appiattita in un layout nuovo')));
}
function downloadLayoutJson(filename){
  const name = filename.endsWith('.json') ? filename : filename + '.layout.json';
  downloadBlob(JSON.stringify(layoutPayload(), null, 2), name, 'application/json');
  state.loadedJsonFilename = name;
  clearDirty();
  showToast('JSON scaricato: ' + name);
}
function loadJsonFile(file, handle=null){
  if(!confirmDiscardChanges()) return;
  const r=new FileReader();
  r.onload=()=>{
    clearLocalFileHandle();
    if(handle) state.localFileHandle = handle;
    loadLayoutObject(JSON.parse(r.result), null, file.name);
    showToast(handle
      ? ('JSON locale: ' + file.name + ' — Salva Json riscrive questo file')
      : ('JSON locale: ' + file.name + ' — Salva Json chiederà dove salvare'));
  };
  r.readAsText(file);
}
async function openLocalJson(){
  if(typeof window.showOpenFilePicker === 'function'){
    try{
      if(!confirmDiscardChanges()) return;
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'Layout JSON', accept: { 'application/json': ['.json'] } }],
      });
      const file = await handle.getFile();
      clearLocalFileHandle();
      state.localFileHandle = handle;
      const text = await file.text();
      loadLayoutObject(JSON.parse(text), null, file.name);
      showToast('JSON locale: ' + file.name + ' — Salva Json riscrive questo file');
      return;
    }catch(e){
      if(e && e.name === 'AbortError') return;
      // fallback input
    }
  }
  $('jsonInput')?.click();
}
function loadLayoutObject(data, path=null, localName=null){
  pushHistory();
  state.canvas=data.canvas||state.canvas;
  state.layers=data.layers||[];
  state.selectedId=null;
  state.selectedIds=[];
  state.currentLayoutPath=path;
  if(path){
    clearLocalFileHandle();
    state.loadedJsonFilename = path.split('/').pop();
  } else if(localName){
    state.loadedJsonFilename = localName;
  }
  clearDirty();
  syncCanvasInputs();
  zoomToFit();
  render();
  onLayoutChangedForVariants?.();
  Promise.resolve(loadHostFonts?.())
    .then(() => ensureLayoutCustomFonts?.(state.layers))
    .then(() => {
      const families = collectLayoutFontFamilies?.(state.layers) || [];
      return Promise.all([...families].map((f) => waitForFont?.(f, 4000)));
    })
    .then(() => { populateFontSelect(); render(); })
    .catch((error) => console.warn('Layout fonts failed', error));
}
async function fetchLayoutFromPath(path){
  if(path.startsWith('./')){
    const res = await fetch(path, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status} loading ${path}`);
    return { layout: await res.json(), path };
  }
  const res = await fetch('/api/load-layout?path=' + encodeURIComponent(path), {cache:'no-store'});
  if(!res.ok) throw new Error(`HTTP ${res.status} loading ${path}`);
  const payload = await res.json();
  if(!payload.ok) throw new Error(payload.error || 'Load failed');
  return { layout: payload.layout, path: payload.path };
}
async function loadLayoutUrl(url, opts={}){
  if(!opts.skipConfirm && !confirmDiscardChanges()) throw new Error('Apertura annullata');
  const { layout, path } = await fetchLayoutFromPath(url);
  loadLayoutObject(layout, path);
}
async function reloadCurrentLayout(){
  const path = state.currentLayoutPath;
  if(!path){
    showToast('Nessun layout su disco da ricaricare. Apri un layout dalla libreria.');
    return;
  }
  if(!confirmDiscardChanges()) return;
  const btn = $('reloadBtn');
  btn?.classList.add('spinning');
  try{
    const { layout, path: loadedPath } = await fetchLayoutFromPath(path);
    loadLayoutObject(layout, loadedPath);
    showToast('Layout ricaricato da disco');
  }catch(e){
    alert('Errore ricarica: ' + e.message);
  }finally{
    setTimeout(()=>btn?.classList.remove('spinning'), 600);
  }
}
async function drawLayerOnCanvas(ctx, l){
  if(l.type==='rect') drawRoundRect(ctx,l.x,l.y,l.w,l.h,l.radius||0,l.fill,l.stroke,l.strokeWidth||0,l);
  if(l.type==='text') drawCanvasText(ctx,l);
  if(l.type==='image') await drawCanvasImage(ctx,l);
  if(l.type==='gradient') drawCanvasGradient(ctx,l);
  if(l.type==='shape') drawCanvasShape(ctx,l);
}
async function renderLayoutToCanvas(ctx, layout, w, h){
  ctx.fillStyle=layout.canvas?.background || '#ffffff'; ctx.fillRect(0,0,w,h);
  for(const l of [...(layout.layers||[])].sort((a,b)=>(a.z||0)-(b.z||0))){
    if(l.visible === false) continue;
    ctx.save(); ctx.globalAlpha=l.opacity ?? 1;
    applyBlendCanvas(ctx, l);
    const rot=(Number(l.rotation)||0)*Math.PI/180;
    const skx=(Number(l.skewX)||0)*Math.PI/180, sky=(Number(l.skewY)||0)*Math.PI/180;
    if(rot||skx||sky){
      // Same order as DOM: rotate(...) skew(...) with origin at layer center
      ctx.translate(l.x+l.w/2,l.y+l.h/2);
      if(rot) ctx.rotate(rot);
      if(skx||sky) ctx.transform(1, Math.tan(sky), Math.tan(skx), 1, 0, 0);
      ctx.translate(-(l.x+l.w/2),-(l.y+l.h/2));
    }
    if(layerHasWarp(l)) await drawLayerWarped(ctx, l, drawLayerOnCanvas);
    else await drawLayerOnCanvas(ctx, l);
    ctx.restore();
  }
}
function downloadBlob(content, name, type){ const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),500); }

function exportMimeSettings(){
  const mime = $('exportFormat')?.value || 'image/jpeg';
  const q = Math.max(0.5, Math.min(0.98, (Number($('exportQuality')?.value) || 90) / 100));
  const ext = mime === 'image/jpeg' ? 'jpg' : 'png';
  return { mime, quality: mime === 'image/jpeg' ? q : undefined, ext };
}
function syncExportQualityUi(){
  const wrap = $('exportQualityWrap');
  const mime = $('exportFormat')?.value || 'image/jpeg';
  if(wrap) wrap.hidden = mime !== 'image/jpeg';
  const label = $('exportQualityLabel');
  if(label) label.textContent = String($('exportQuality')?.value || 90);
}
function safeExportName(name, ext='png'){
  const base = (name || 'layout').replace(/\.layout\.json$/i,'').replace(/\.(png|jpe?g)$/i,'').replace(/[^A-Za-z0-9._-]+/g,'_');
  return base + '.' + ext;
}
function formatBytes(n){
  if(n < 1024) return n + ' B';
  if(n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}
function canvasToBlob(canvas, mime='image/png', quality){
  return new Promise((resolve)=> canvas.toBlob(resolve, mime, quality));
}
function delay(ms){ return new Promise(resolve=>setTimeout(resolve, ms)); }
async function loadLayoutByPath(path){
  const res=await fetch('/api/load-layout?path=' + encodeURIComponent(path), {cache:'no-store'});
  const payload=await res.json();
  if(!payload.ok) throw new Error(payload.error || 'Load failed');
  return payload.layout;
}
async function renderLayoutToBlob(layout, mime, quality){
  const w=layout.canvas?.width||1080, h=layout.canvas?.height||1350;
  const out=document.createElement('canvas'); out.width=w; out.height=h;
  const ctx=out.getContext('2d');
  await renderLayoutToCanvas(ctx, layout, w, h);
  const settings = mime ? { mime, quality } : exportMimeSettings();
  return canvasToBlob(out, settings.mime, settings.quality);
}
function downloadBlobObject(blob, name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function exportSelectedLayouts(){
  const selected = state.libraryItems.filter(it=>it.kind==='layout' && state.selectedLibraryPaths.includes(it.path));
  if(!selected.length){ alert('Seleziona almeno un layout JSON dalla libreria.'); return; }
  const btn=$('bulkExportBtn');
  const oldText=btn?.textContent;
  if(btn){ btn.disabled=true; btn.textContent=`Export 0/${selected.length}…`; }
  const failures=[];
  for(let i=0; i<selected.length; i++){
    const item=selected[i];
    try{
      if(btn) btn.textContent=`Export ${i+1}/${selected.length}…`;
      const layout=await loadLayoutByPath(item.path);
      const { mime, quality, ext } = exportMimeSettings();
      const blob=await renderLayoutToBlob(layout, mime, quality);
      if(!blob) throw new Error('Export blob vuoto');
      downloadBlobObject(blob, safeExportName(item.name, ext));
      await delay(250);
    }catch(e){
      failures.push(`${item.name}: ${e.message}`);
    }
  }
  if(btn){ btn.textContent=oldText || 'Export selezionati'; updateBulkExportButton(); }
  if(failures.length) alert('Export completato con errori:\n' + failures.join('\n'));
}
async function exportPng(){
  const { mime, quality, ext } = exportMimeSettings();
  const out=document.createElement('canvas'); out.width=state.canvas.width; out.height=state.canvas.height;
  const ctx=out.getContext('2d');
  // JPEG has no alpha: ensure opaque fill (renderLayoutToCanvas already paints canvas.background)
  await renderLayoutToCanvas(ctx, layoutPayload(), out.width, out.height);
  const name = safeExportName(currentLayoutExportName(), ext);
  const blob = await canvasToBlob(out, mime, quality);
  if(!blob){ alert('Export fallito'); return; }
  downloadBlobObject(blob, name);
  const ytHint = mime === 'image/jpeg' && blob.size > 2 * 1024 * 1024
    ? ' — sopra 2 MB YouTube: abbassa la qualità'
    : '';
  showToast(`Export ${ext.toUpperCase()}: ${name} · ${formatBytes(blob.size)}${ytHint}`);
}

function refreshDuplicateFormatSelect(){
  populateFormatSelect($('duplicateFormatSelect'), {
    excludeWh: { w: state.canvas.width, h: state.canvas.height },
  });
}

function duplicateLayoutToFormat(){
  const raw = $('duplicateFormatSelect')?.value;
  if(!raw || raw === 'custom'){ alert('Scegli un formato di destinazione'); return; }
  const [tw, th] = raw.split('x').map(Number);
  if(!tw || !th){ alert('Formato non valido'); return; }
  if(tw === state.canvas.width && th === state.canvas.height){
    showToast('Stesso formato del canvas attuale');
    return;
  }
  if(!confirm(`Duplicare il layout in ${tw}×${th}?\nI livelli vengono riscalati in proporzione (punto di partenza da ritoccare).`)) return;
  const scaled = scaleLayoutToFormat(layoutPayload(), tw, th);
  pushHistory();
  state.canvas = scaled.canvas;
  state.layers = scaled.layers;
  state.selectedId = null;
  state.selectedIds = [];
  state.currentLayoutPath = null;
  clearLocalFileHandle();
  const base = (state.loadedJsonFilename || 'layout').replace(/\.layout\.json$/i, '').replace(/\.json$/i, '');
  state.loadedJsonFilename = `${base}-${tw}x${th}.layout.json`;
  markDirty();
  syncCanvasInputs();
  const presetSel = $('presetSelect');
  if(presetSel){
    const key = formatKey(tw, th);
    if([...presetSel.options].some((o)=> o.value === key)) presetSel.value = key;
    else presetSel.value = 'custom';
  }
  refreshDuplicateFormatSelect();
  render();
  showToast(`Duplicato in ${tw}×${th} — ritocca composizione a mano se serve`);
}
function drawRoundRect(ctx,x,y,w,h,r,fill,stroke,sw,layer){
  if(layer) applyCanvasShadow(ctx, layer.shadow);
  r=Math.min(r,w/2,h/2); ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  if(fill){ctx.fillStyle=fill; ctx.fill();} if(sw>0){ctx.lineWidth=sw; ctx.strokeStyle=stroke||'#000'; ctx.stroke();}
  if(layer) clearCanvasShadow(ctx);
}
function drawCanvasImage(ctx,l){
  return new Promise((resolve)=>{
    const img=new Image();
    img.onload=()=>{
      const srcImg = (typeof processImageForKey === 'function') ? processImageForKey(img, l) : img;
      // Bake fit/crop (+ color adjust) into alpha canvas, then draw with shadow.
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(l.w));
      off.height = Math.max(1, Math.round(l.h));
      const octx = off.getContext('2d');
      const adjFilter = typeof imageAdjustFilterCss === 'function' ? imageAdjustFilterCss(l.adjust) : '';
      octx.filter = adjFilter || 'none';
      drawImageFit(octx, srcImg, { ...l, x: 0, y: 0, w: off.width, h: off.height });
      octx.filter = 'none';
      if(typeof imageHasMask === 'function' && imageHasMask(l)){
        // Bake the mask into the offscreen alpha: the shadow drawn below then
        // follows the mask outline for free, matching the DOM preview.
        octx.globalCompositeOperation = 'destination-in';
        octx.fill(new Path2D(imageMaskPathD({ ...l, w: off.width, h: off.height })));
        octx.globalCompositeOperation = 'source-over';
      }
      applyCanvasShadow(ctx, l.shadow);
      ctx.drawImage(off, l.x, l.y, l.w, l.h);
      clearCanvasShadow(ctx);
      resolve();
    };
    img.onerror=resolve;
    img.src=resolveAssetUrl(l.src);
  });
}

async function exportLayoutToPngBase64(layout){
  await loadHostFonts?.();
  await ensureLayoutCustomFonts?.(layout.layers || []);
  const families = collectLayoutFontFamilies?.(layout.layers || []) || [];
  await Promise.all([...families].map((f)=>waitForFont?.(f, 4000)));
  try { await document.fonts.ready; } catch(_){}
  const w = layout.canvas?.width || 1080;
  const h = layout.canvas?.height || 1350;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  await renderLayoutToCanvas(out.getContext('2d'), layout, w, h);
  const dataUrl = out.toDataURL('image/png');
  return dataUrl.split(',')[1] || '';
}
window.exportLayoutToPngBase64 = exportLayoutToPngBase64;

/**
 * Small JPEG for the variants bar. Rendered at full size and then downscaled:
 * rendering straight into a small canvas would re-lay-out text at a size nobody
 * will ever export, so the thumbnail would not match the real output.
 */
async function exportLayoutToThumbBase64(layout, maxSide = 320, quality = 0.72){
  await loadHostFonts?.();
  await ensureLayoutCustomFonts?.(layout.layers || []);
  const families = collectLayoutFontFamilies?.(layout.layers || []) || [];
  await Promise.all([...families].map((f)=>waitForFont?.(f, 4000)));
  try { await document.fonts.ready; } catch(_){}
  const w = layout.canvas?.width || 1080;
  const h = layout.canvas?.height || 1350;
  const full = document.createElement('canvas');
  full.width = w; full.height = h;
  await renderLayoutToCanvas(full.getContext('2d'), layout, w, h);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const small = document.createElement('canvas');
  small.width = tw; small.height = th;
  const sctx = small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  // JPEG has no alpha: paint the artboard background first or transparency turns black.
  sctx.fillStyle = layout.canvas?.background || '#ffffff';
  sctx.fillRect(0, 0, tw, th);
  sctx.drawImage(full, 0, 0, tw, th);
  return (small.toDataURL('image/jpeg', quality).split(',')[1]) || '';
}
window.exportLayoutToThumbBase64 = exportLayoutToThumbBase64;
function drawImageFit(ctx,img,l){
  if(l.crop){
    const c=normalizedCrop(l);
    ctx.drawImage(img, c.x*img.width, c.y*img.height, c.w*img.width, c.h*img.height, l.x, l.y, l.w, l.h);
    return;
  }
  const fit=l.fit||'contain'; if(fit==='stretch'){ctx.drawImage(img,l.x,l.y,l.w,l.h); return;}
  const s= fit==='cover' ? Math.max(l.w/img.width,l.h/img.height) : Math.min(l.w/img.width,l.h/img.height);
  const w=img.width*s,h=img.height*s,x=l.x+(l.w-w)/2,y=l.y+(l.h-h)/2; ctx.save(); ctx.beginPath(); ctx.rect(l.x,l.y,l.w,l.h); ctx.clip(); ctx.drawImage(img,x,y,w,h); ctx.restore();
}
function readImageFile(file){ const r=new FileReader(); r.onload=()=>{ pushHistory(); state.layers.push(defaultImage(r.result,file.name)); selectOnly(state.layers.at(-1).id); markDirty(); render(); }; r.readAsDataURL(file); }
function syncCanvasInputs(){
  $('canvasW').value=state.canvas.width;
  $('canvasH').value=state.canvas.height;
  const bg=$('canvasBg');
  if(bg) bg.value = rgbToHex(state.canvas.background || '#ffffff');
  const guides=$('toggleSafeGuides');
  if(guides) guides.checked = !!state.showSafeGuides;
  const presetSel = $('presetSelect');
  if(presetSel && typeof formatKey === 'function'){
    const key = formatKey(state.canvas.width, state.canvas.height);
    presetSel.value = [...presetSel.options].some((o)=> o.value === key) ? key : 'custom';
  }
  if(typeof refreshDuplicateFormatSelect === 'function') refreshDuplicateFormatSelect();
}
function renderSafeGuides(){
  const inset = 48;
  const el = document.createElement('div');
  el.className = 'safeGuides';
  Object.assign(el.style, { left: inset + 'px', top: inset + 'px', width: (state.canvas.width - inset * 2) + 'px', height: (state.canvas.height - inset * 2) + 'px' });
  return el;
}
function escapeHtml(s){ return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function rgbToHex(v){
  if(!v) return '#000000';
  if(v.startsWith('#')){
    if(v.length === 4) return '#' + [...v.slice(1)].map(c => c + c).join('');
    return v.slice(0, 7);
  }
  const m = String(v).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if(!m) return '#000000';
  const hex = (n) => Number(n).toString(16).padStart(2, '0');
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
}


function alignSelectedToCanvas(action){
  const layers=selectedLayers().filter(l=>!layerLocked(l));
  if(!layers.length) return;
  pushHistory();
  const cw=state.canvas.width, ch=state.canvas.height;
  layers.forEach(l=>{
    if(action==='left') l.x=0;
    if(action==='hcenter') l.x=(cw-l.w)/2;
    if(action==='right') l.x=cw-l.w;
    if(action==='top') l.y=0;
    if(action==='vcenter') l.y=(ch-l.h)/2;
    if(action==='bottom') l.y=ch-l.h;
  });
  markDirty();
  render();
}

function alignSelectedLayers(action){
  const layers=selectedLayers().filter(l=>!layerLocked(l));
  if(!layers.length) return;
  pushHistory();
  const box=groupBox(layers);
  const sortedX=[...layers].sort((a,b)=>a.x-b.x);
  const sortedY=[...layers].sort((a,b)=>a.y-b.y);
  if(action==='left') layers.forEach(l=>l.x=box.x);
  if(action==='hcenter') layers.forEach(l=>l.x=box.x+box.w/2-l.w/2);
  if(action==='right') layers.forEach(l=>l.x=box.x+box.w-l.w);
  if(action==='top') layers.forEach(l=>l.y=box.y);
  if(action==='vcenter') layers.forEach(l=>l.y=box.y+box.h/2-l.h/2);
  if(action==='bottom') layers.forEach(l=>l.y=box.y+box.h-l.h);
  if(action==='distributeH' && sortedX.length>2){
    const first=sortedX[0], last=sortedX.at(-1);
    const totalW=sortedX.reduce((s,l)=>s+l.w,0);
    const gap=(last.x+last.w-first.x-totalW)/(sortedX.length-1);
    let x=first.x; sortedX.forEach(l=>{l.x=x; x+=l.w+gap;});
  }
  if(action==='distributeV' && sortedY.length>2){
    const first=sortedY[0], last=sortedY.at(-1);
    const totalH=sortedY.reduce((s,l)=>s+l.h,0);
    const gap=(last.y+last.h-first.y-totalH)/(sortedY.length-1);
    let y=first.y; sortedY.forEach(l=>{l.y=y; y+=l.h+gap;});
  }
  markDirty();
  render();
}

function isTypingTarget(el){
  if(!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function layoutFileRef(){
  if(state.currentLayoutPath) return state.currentLayoutPath;
  if(state.localFileHandle?.name) return state.localFileHandle.name + ' (locale)';
  if(state.loadedJsonFilename) return state.loadedJsonFilename + ' (locale)';
  return '(nessun file aperto)';
}

/** Compact one-line-per-layer reference: what an LLM needs to target the layer, without the full JSON. */
function buildLayerRefClipboard(layers){
  const list = layers || [];
  const lines = list.map((l) => [
    `id: ${l.id}`,
    `tipo: ${l.type}`,
    `nome: "${l.name || ''}"`,
    `box: ${Math.round(l.x)},${Math.round(l.y)} ${Math.round(l.w)}x${Math.round(l.h)}`,
  ].join(' | '));
  lines.push(`file: ${layoutFileRef()}`);
  return lines.join('\n');
}

async function copyLayerRef({nameOnly = false} = {}){
  const layers = selectedLayers();
  if(!layers.length){
    showToast('Nessun layer selezionato');
    return;
  }
  const text = nameOnly
    ? layers.map((l) => l.name || '').join('\n')
    : buildLayerRefClipboard(layers);
  try{
    await copyTextToClipboard(text);
    showToast(nameOnly
      ? `Nome copiato (${layers.length} layer)`
      : `Riferimento copiato (${layers.length} layer) → ${layoutFileRef()}`);
  }catch(e){
    showToast('Copia fallita: ' + (e.message || e));
  }
}

/** Exact layer objects from current layout state (same as layers[] in the .layout.json). */
function buildLlmLayerClipboard(layers){
  const list = (layers || []).map((l) => JSON.parse(JSON.stringify(l)));
  const body = list.length === 1
    ? JSON.stringify(list[0], null, 2)
    : JSON.stringify(list, null, 2);
  const canvas = state.canvas || {};
  return [
    `## Layer selezionati (${list.length})`,
    `canvas: ${canvas.width || '?'}x${canvas.height || '?'}`,
    '```json',
    body,
    '```',
    '',
    `file: ${layoutFileRef()}`,
  ].join('\n');
}

async function copySelectedLayersCode(){
  const layers = selectedLayers();
  if(!layers.length){
    showToast('Nessun layer selezionato');
    return;
  }
  const text = buildLlmLayerClipboard(layers);
  try{
    await copyTextToClipboard(text);
    showToast(`Codice copiato (${layers.length} layer) → ${layoutFileRef()}`);
  }catch(e){
    console.warn('copySelectedLayersCode', e, text.slice(0, 200));
    showToast('Copia codice fallita: ' + (e.message || e));
  }
}

function hideLayerContextMenu(){
  const menu = $('layerContextMenu');
  if(menu) menu.hidden = true;
}

function ensureLayerContextMenu(){
  let menu = $('layerContextMenu');
  if(menu) return menu;
  menu = document.createElement('div');
  menu.id = 'layerContextMenu';
  menu.className = 'layerContextMenu';
  menu.hidden = true;
  menu.innerHTML = '<button type="button" data-action="copy-code">Copia codice</button>';
  document.body.appendChild(menu);
  // pointerdown: evita che il capture mousedown sul document nasconda il menu prima del click
  menu.addEventListener('pointerdown', async (ev) => {
    const btn = ev.target?.closest?.('[data-action="copy-code"]');
    if(!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    hideLayerContextMenu();
    await copySelectedLayersCode();
  });
  return menu;
}

function openLayerContextMenu(ev, layerId){
  if(!isSelected(layerId)){
    selectOnly(layerId);
    render();
  }
  const menu = ensureLayerContextMenu();
  menu.hidden = false;
  const pad = 8;
  const mw = menu.offsetWidth || 160;
  const mh = menu.offsetHeight || 40;
  let left = ev.clientX;
  let top = ev.clientY;
  if(left + mw > window.innerWidth - pad) left = window.innerWidth - mw - pad;
  if(top + mh > window.innerHeight - pad) top = window.innerHeight - mh - pad;
  menu.style.left = Math.max(pad, left) + 'px';
  menu.style.top = Math.max(pad, top) + 'px';
}

function bindKeyboardShortcuts(){
  document.addEventListener('contextmenu', (ev)=>{
    if(ev.target?.closest?.('.layerContextMenu')) return;
    if(ev.target?.closest?.('.layer, .resizeHandle, #canvas')) ev.preventDefault();
  }, true);
  document.addEventListener('mousedown', (ev)=>{
    if(!ev.target?.closest?.('.layerContextMenu')) hideLayerContextMenu();
  }, true);
  document.addEventListener('keydown', (ev)=>{
    if(ev.key === 'Escape'){ hideLayerContextMenu(); stopVertexEdit(); }
    const mod = ev.metaKey || ev.ctrlKey;
    const key = ev.key.toLowerCase();
    // Undo/redo before typing-target guard so panel focus (font select, inputs) still works
    if(mod && (key === 'z' || key === 'y') && !ev.target?.isContentEditable){
      ev.preventDefault();
      if(key === 'z' && !ev.shiftKey) undo(); else redo();
      markDirty();
      return;
    }
    if(isTypingTarget(ev.target)) return;
    if(mod && key === 's'){
      ev.preventDefault();
      saveJsonOverwrite();
      return;
    }
    if(mod && key === 'c' && state.selectedIds.length){
      // Never steal a real text copy: if the user highlighted text, that wins.
      if(String(window.getSelection?.() || '').length) return;
      ev.preventDefault();
      state.layerClipboard = selectedLayers().map(l => JSON.parse(JSON.stringify(l)));
      showToast(state.layerClipboard.length === 1
        ? `Copiato: ${state.layerClipboard[0].name || state.layerClipboard[0].id}`
        : `Copiati ${state.layerClipboard.length} layer`);
      return;
    }
    if(mod && key === 'v' && state.layerClipboard?.length){
      ev.preventDefault();
      pushHistory();
      const pasted = state.layerClipboard.map(src => {
        const copy = JSON.parse(JSON.stringify(src));
        copy.id = uid();
        copy.x = (Number(copy.x) || 0) + 20;
        copy.y = (Number(copy.y) || 0) + 20;
        copy.z = nextZ();
        delete copy.locked;   // a pasted copy should be editable even if the source was locked
        state.layers.push(copy);
        return copy.id;
      });
      state.selectedIds = pasted;
      state.selectedId = pasted.at(-1) || null;
      markDirty();
      render();
      return;
    }
    if(mod && key === 'd'){
      ev.preventDefault();
      $('duplicateBtn')?.click();
      return;
    }
    if((ev.key === 'Delete' || ev.key === 'Backspace') && state.selectedIds.length){
      ev.preventDefault();
      $('deleteBtn')?.click();
      return;
    }
    // Alt+arrows walk the working set. Bare arrows nudge layers, so the modifier is
    // what keeps the two apart.
    if(ev.altKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && state.editQueue){
      ev.preventDefault();
      stepEditQueue(ev.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(ev.key) && state.selectedIds.length){
      if(typeof isLibraryModalOpen === 'function' && isLibraryModalOpen()) return;
      ev.preventDefault();
      const step = ev.shiftKey ? 10 : 1;
      pushHistory();
      selectedLayers().filter(l=>!layerLocked(l)).forEach(l=>{
        if(ev.key === 'ArrowLeft') l.x -= step;
        if(ev.key === 'ArrowRight') l.x += step;
        if(ev.key === 'ArrowUp') l.y -= step;
        if(ev.key === 'ArrowDown') l.y += step;
      });
      markDirty();
      render();
    }
  });
  window.addEventListener('beforeunload', (ev)=>{
    if(!state.dirty) return;
    ev.preventDefault();
    ev.returnValue = '';
  });
}

async function loadServerHealth(){
  try{
    const res = await fetch('/api/health', {cache:'no-store'});
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || 'health failed');
    state.campaignsRoot = data.campaigns_root || '';
    state.editorRoot = data.editor_root || '';
    // Same set the server writes with, so a variant previewed here and a variant
    // baked into a promoted file cannot end up carrying different fields.
    state.patchableFields = Object.keys(data.layer_fields || {}).filter((k) => k !== 'id' && k !== 'type');
  }catch(e){
    state.campaignsRoot = '';
    state.editorRoot = '';
    state.patchableFields = null;
  }
  const label = $('campaignsRootLabel');
  if(label){
    label.textContent = state.campaignsRoot ? `campaigns: ${state.campaignsRoot}` : 'campaigns: (server non raggiungibile)';
    label.title = state.campaignsRoot || 'Avvia scripts/run_server.py per la root campagne';
  }
}

function addImageByPath(){
  const raw = prompt('Path immagine relativo alla root campagne:\n(es. _assets/fuoco/fuoco-keyed-intero.png)', '_assets/');
  if(!raw) return;
  const src = campaignsRelativeSrc(raw.trim());
  pushHistory();
  state.layers.push(defaultImage(src, src.split('/').pop()));
  selectOnly(state.layers.at(-1).id);
  markDirty();
  render();
}

function init(){
  $('canvas').addEventListener('mousedown', startMarquee);
  // Outside the artboard counts too: a band started on the grey around it is often
  // the only way to enclose layers that touch the edges.
  document.querySelector('.stageScroller')?.addEventListener('mousedown', startMarquee);
  $('canvas').addEventListener('contextmenu', (ev)=>{ if(ev.target.closest?.('.layer')) ev.preventDefault(); });
  $('canvas').addEventListener('click', (ev)=>{
    if(ev.target !== $('canvas')) return;
    if(isSelectionModifier(ev) || marqueeJustEnded()) return;
    clearLayerSelection();
  });
  document.querySelector('.stageScroller')?.addEventListener('mousedown', (ev)=>{
    if(isSelectionModifier(ev) || marquee) return;
    if(ev.target.closest?.('#canvas, .layer, .layerContextMenu')) return;
    clearLayerSelection();
  });
  // Click outside the stage (panels/topbar empty chrome) also clears, unless editing a control or holding a modifier.
  document.addEventListener('mousedown', (ev)=>{
    if(isSelectionModifier(ev)) return;
    if(!state.selectedIds.length && !state.selectedId) return;
    const t = ev.target;
    if(!(t instanceof Element)) return;
    if(t.closest?.('#layoutLibraryModal, .modal, .layerContextMenu')) return;
    if(t.closest?.('#canvas, .layer, .layers, #props, .propActions, .stageToolbar, .topbar, .actions, button, input, select, textarea, label, a')) return;
    if(t.closest?.('.stageScroller')) return; // handled above (only empty scroller clears)
    clearLayerSelection();
  });
  const syncZoomUi = ()=>{
    const z = Math.round((Number(state.zoom) || 100) * 2) / 2;
    const range = $('zoomRange');
    if(range) range.value = z;
    const label = $('zoomLabel');
    if(label) label.textContent = (Number.isInteger(z) ? z : z.toFixed(1)) + '%';
  };
  $('zoomRange').oninput=()=>{
    state.zoom = Number($('zoomRange').value);
    syncZoomUi();
    render({ skipProps: true });
  };
  document.querySelector('.stageScroller')?.addEventListener('wheel', (ev)=>{
    if(!ev.metaKey) return;
    ev.preventDefault();
    const range = $('zoomRange');
    const min = Number(range.min);
    const max = Number(range.max);
    state.zoom = Math.max(min, Math.min(max, state.zoom + (ev.deltaY < 0 ? 0.5 : -0.5)));
    syncZoomUi();
    render({ skipProps: true });
  }, { passive: false });
  syncZoomUi();
  $('addTextBtn').onclick=()=>{pushHistory(); state.layers.push(defaultText()); selectOnly(state.layers.at(-1).id); markDirty(); render();};
  $('addRectBtn').onclick=()=>{pushHistory(); state.layers.push(defaultRect()); selectOnly(state.layers.at(-1).id); markDirty(); render();};
  $('addGradientBtn')?.addEventListener('click', ()=>{ pushHistory(); state.layers.push(defaultGradient()); selectOnly(state.layers.at(-1).id); markDirty(); render(); });
  $('addShapeBtn')?.addEventListener('click', ()=>{ pushHistory(); state.layers.push(defaultShape($('newShapeKind')?.value || 'rect')); selectOnly(state.layers.at(-1).id); markDirty(); render(); });
  $('addImagePathBtn')?.addEventListener('click', addImageByPath);
  $('imageInput').onchange=e=>{ if(e.target.files[0]) readImageFile(e.target.files[0]); e.target.value=''; };
  $('openJsonBtn')?.addEventListener('click', ()=>openLocalJson());
  $('jsonInput').onchange=e=>{ if(e.target.files[0]) loadJsonFile(e.target.files[0]); e.target.value=''; };
  $('saveJsonBtn').onclick=saveJsonOverwrite;
  $('saveLayoutBtn').onclick=saveLayout;
  $('saveAsLayoutBtn').onclick=saveLayoutAs;
  $('exportPngBtn').onclick=exportPng;
  $('exportFormat')?.addEventListener('change', syncExportQualityUi);
  $('exportQuality')?.addEventListener('input', syncExportQualityUi);
  syncExportQualityUi();
  $('duplicateFormatBtn')?.addEventListener('click', duplicateLayoutToFormat);
  $('openLibraryBtn').onclick=openLayoutLibrary;
  $('closeLibraryBtn').onclick=closeLayoutLibrary;
  $('refreshLibraryBtn').onclick=()=>refreshLayoutLibrary().catch(e=>alert('Errore aggiornamento libreria: '+e.message));
  $('libraryViewToggleBtn')?.addEventListener('click', ()=>setLibraryViewMode(state.libraryViewMode === 'list' ? 'grid' : 'list'));
  $('bulkEditBtn')?.addEventListener('click', ()=>startEditQueue(selectedLibraryEntries()));
  $('bulkExportBtn').onclick=exportSelectedLayouts;
  $('bulkDeleteBtn')?.addEventListener('click', ()=>deleteSelectedLibraryItems());
  $('bulkCopyPathsBtn')?.addEventListener('click', ()=>copySelectedLibraryPaths());
  $('bulkRefreshThumbsBtn')?.addEventListener('click', ()=>refreshSelectedThumbs());
  $('bulkMoveBtn')?.addEventListener('click', ()=>moveSelectedItems());
  $('bulkTagBtn')?.addEventListener('click', ()=>tagSelectedItems());
  $('libraryColsRange')?.addEventListener('input', ()=>{
    localStorage.setItem('robyLibraryCols', $('libraryColsRange').value);
    applyLibraryColumns?.();
  });
  const syncCropModeUi = ()=>{
    const b = $('cropModeBtn');
    if(!b) return;
    b.classList.toggle('active', !!state.cropMode);
    b.setAttribute('aria-pressed', state.cropMode ? 'true' : 'false');
  };
  const syncMarqueeModeUi = ()=>{
    const b = $('marqueeModeBtn');
    if(!b) return;
    b.classList.toggle('active', !!state.marqueeMode);
    b.setAttribute('aria-pressed', state.marqueeMode ? 'true' : 'false');
  };
  $('marqueeModeBtn')?.addEventListener('click', ()=>{
    state.marqueeMode = !state.marqueeMode;
    localStorage.setItem('robyMarqueeMode', state.marqueeMode ? '1' : '0');
    syncMarqueeModeUi();
  });
  syncMarqueeModeUi();
  $('cropModeBtn')?.addEventListener('click', ()=>{
    state.cropMode = !state.cropMode;
    localStorage.setItem('robyCropMode', state.cropMode ? '1' : '0');
    syncCropModeUi();
  });
  syncCropModeUi();
  // Delegated: updateCanvasInfo rebuilds the span on every render, so the handler
  // must live on the stable parent.
  $('canvasInfo')?.addEventListener('click', async (ev)=>{
    if(!ev.target?.closest?.('.fileRefCopy') || !state.currentLayoutPath) return;
    try{
      await copyTextToClipboard(state.currentLayoutPath);
      showToast('Percorso copiato: ' + state.currentLayoutPath);
    }catch(e){
      showToast('Copia fallita: ' + (e.message || e));
    }
  });
  // Three-state cycle: the checkbox's own checked value is meaningless here.
  $('librarySelectAllCheckbox').onchange=()=>cycleLibrarySelection();
  $('librarySearch').oninput=renderLibraryGrid;
  $('libraryKindFilter').onchange=() => (typeof onLibraryKindFilterChange === 'function' ? onLibraryKindFilterChange() : renderLibraryGrid());
  document.querySelectorAll('[data-align-action]').forEach(btn=>btn.onclick=()=>alignSelectedLayers(btn.dataset.alignAction));
  document.querySelectorAll('[data-canvas-align]').forEach(btn=>btn.onclick=()=>alignSelectedToCanvas(btn.dataset.canvasAlign));
  $('deleteBtn').onclick=()=>{
    if(!state.selectedIds.length) return;
    const locked = selectedLayers().filter(layerLocked);
    if(locked.length){ showToast('Sblocca i layer prima di eliminarli'); return; }
    pushHistory(); state.layers=state.layers.filter(x=>!isSelected(x.id)); state.selectedId=null; state.selectedIds=[]; markDirty(); render();
  };
  $('duplicateBtn').onclick=()=>{ const ls=selectedLayers(); if(!ls.length) return; pushHistory(); const copies=ls.map(l=>{ const c=JSON.parse(JSON.stringify(l)); c.id=uid(); c.name=(c.name||c.type)+' copy'; c.x+=24; c.y+=24; c.z=nextZ(); return c; }); state.layers.push(...copies); state.selectedIds=copies.map(c=>c.id); state.selectedId=state.selectedIds.at(-1); markDirty(); render(); };
  populateFormatSelect($('presetSelect'), { includeCustom: true, selected: formatKey(state.canvas.width, state.canvas.height) });
  refreshDuplicateFormatSelect();
  $('presetSelect').onchange=()=>{ const v=$('presetSelect').value; if(v!=='custom'){ const [w,h]=v.split('x').map(Number); $('canvasW').value=w; $('canvasH').value=h; }};
  $('resizeCanvasBtn').onclick=()=>{
    pushHistory();
    state.canvas.width=Number($('canvasW').value);
    state.canvas.height=Number($('canvasH').value);
    markDirty();
    refreshDuplicateFormatSelect();
    render();
  };
  $('canvasBg')?.addEventListener('input', ()=>{ pushHistory(); state.canvas.background = $('canvasBg').value; markDirty(); render(); });
  $('toggleSafeGuides')?.addEventListener('change', (ev)=>{ state.showSafeGuides = ev.target.checked; localStorage.setItem('robyShowSafeGuides', state.showSafeGuides ? '1' : '0'); render(); });
  $('reloadBtn').onclick=()=>reloadCurrentLayout();
  $('newBtn').onclick=()=>{ if(!confirmDiscardChanges()) return; if(confirm('Creare un nuovo layout vuoto?')){ pushHistory(); state.layers=[]; state.selectedId=null; state.selectedIds=[]; state.currentLayoutPath=null; state.loadedJsonFilename=null; clearLocalFileHandle(); clearDirty(); render(); }};
  initInspectorControls?.();
  if(typeof initLiveBridge === 'function') initLiveBridge();
  bindProps(); bindKeyboardShortcuts(); syncCanvasInputs();
  bindVariantsBar?.();
  bindEditQueue?.();
  loadServerHealth().finally(()=>{
    render();
    // After health: the patchable-field set it carries decides how variants apply.
    loadVariants?.();
    ensureHostFontsInSelect?.().then(()=>{
      const l = selected();
      if(l?.type === 'text') populateFontSelect(l.fontFamily || l.font);
      else populateFontSelect();
    }).catch(()=>{});
  });
}
// init() runs from library.js after library helpers are defined (export mode skips it).
if(window.ROBY_EXPORT_MODE){
  window.__robyExportReady = true;
  document.getElementById('exportStatus') && (document.getElementById('exportStatus').textContent = 'ready');
}

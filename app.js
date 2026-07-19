const $ = (id) => document.getElementById(id);
const state = {
  canvas: { width: 1080, height: 1350, background: '#fff7ea' },
  layers: [],
  selectedId: null,
  selectedIds: [],
  zoom: 42,
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
  campaignsRoot: '',
  editorRoot: '',
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
function selectOnly(id){ state.selectedId=id; state.selectedIds=id?[id]:[]; }
function toggleSelect(id){ if(isSelected(id)){ state.selectedIds=state.selectedIds.filter(x=>x!==id); state.selectedId=state.selectedIds.at(-1)||null; } else { state.selectedIds.push(id); state.selectedId=id; } }

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

function render() {
  const canvas = $('canvas');
  canvas.style.width = state.canvas.width + 'px';
  canvas.style.height = state.canvas.height + 'px';
  canvas.style.background = state.canvas.background || '#fff';
  $('stage').style.transform = `scale(${state.zoom/100})`;
  const selCount = state.selectedIds.length ? ` · ${state.selectedIds.length} selezionati` : '';
  const fileInfo = ` · ${currentFileLabel()}`;
  const dirtyInfo = state.dirty ? ' · ● modificato' : '';
  const hiddenCount = state.layers.filter(l => !layerVisible(l)).length;
  const hiddenInfo = hiddenCount ? ` · ${hiddenCount} nascosti` : '';
  $('canvasInfo').innerHTML = `${state.canvas.width}×${state.canvas.height} · ${state.layers.length} layer${selCount}${hiddenInfo} · undo ${state.history.length} / redo ${state.future.length}${fileInfo}${dirtyInfo ? `<span class="dirtyMark">${dirtyInfo}</span>` : ''}`;
  canvas.innerHTML = '';
  [...state.layers].sort((a,b)=>(a.z||0)-(b.z||0)).filter(layerVisible).forEach(layer => canvas.appendChild(renderLayer(layer)));
  if(state.showSafeGuides) canvas.appendChild(renderSafeGuides());
  // Mask ABOVE layers so overflow (incl. screen blend) is dimmed; hole = artboard
  canvas.appendChild(renderCanvasOverflowMask());
  renderLayerList();
  renderProps();
}
function renderCanvasOverflowMask(){
  const mask = document.createElement('div');
  mask.className = 'canvasOverflowMask';
  mask.setAttribute('aria-hidden', 'true');
  return mask;
}

function renderLayer(layer) {
  const el = document.createElement('div');
  el.className = `layer ${layer.type}` + (isSelected(layer.id) ? ' selected' : '') + (layerLocked(layer) ? ' locked' : '');
  el.dataset.id = layer.id;
  el.oncontextmenu = (ev) => { ev.preventDefault(); ev.stopPropagation(); return false; };
  Object.assign(el.style, {
    left: layer.x + 'px', top: layer.y + 'px', width: layer.w + 'px', height: layer.h + 'px',
    zIndex: layer.z || 1, opacity: layer.opacity ?? 1,
    transform: `rotate(${Number(layer.rotation)||0}deg)`, transformOrigin: 'center center',
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
    applyLayerEffectsDom(img, layer);
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
      el.appendChild(clip);
    } else {
      // Direct <img>: drop-shadow follows PNG alpha past the selection box
      Object.assign(img.style, {
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: layer.fit || 'contain',
        pointerEvents: 'none',
      });
      el.appendChild(img);
    }
  } else if (layer.type === 'gradient') {
    Object.assign(el.style, {
      background: gradientCssBackground(layer),
      borderRadius: (layer.radius || 0) + 'px',
    });
    applyLayerEffectsDom(el, layer);
  }
  if(!layerLocked(layer)){
    ['nw','ne','sw','se'].forEach(pos=>{
      const handle = document.createElement('div');
      handle.className = `resizeHandle handle-${pos}`;
      handle.dataset.handle = pos;
      handle.oncontextmenu = (ev) => { ev.preventDefault(); ev.stopPropagation(); return false; };
      el.appendChild(handle);
    });
  }
  el.addEventListener('mousedown', (ev) => startDrag(ev, layer.id, ev.target?.dataset?.handle || null));
  el.addEventListener('click', (ev) => { ev.stopPropagation(); if(ev.shiftKey || ev.metaKey || ev.ctrlKey) toggleSelect(layer.id); else selectOnly(layer.id); render(); });
  return el;
}
function renderLayerList(){
  const box=$('layersList'); box.innerHTML='';
  [...state.layers].sort((a,b)=>(b.z||0)-(a.z||0)).forEach(l=>{
    const row=document.createElement('div');
    row.className='layerItem'+(isSelected(l.id)?' active':'')+(!layerVisible(l)?' hiddenLayer':'')+(layerLocked(l)?' lockedLayer':'');
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
    row.append(eye, lock, info);
    box.appendChild(row);
  });
}
function renderProps(){
  const l=selected(); $('emptyProps').hidden=!!l; $('props').hidden=!l; if(!l) return;
  setVal('propName',l.name); setVal('propX',Math.round(l.x)); setVal('propY',Math.round(l.y)); setVal('propW',Math.round(l.w)); setVal('propH',Math.round(l.h)); setVal('propZ',l.z||1); setVal('propOpacity',l.opacity ?? 1); setVal('propRotation',l.rotation || 0);
  populateBlendSelect($('propBlendMode'), l.blendMode);
  const vis=$('propVisible'); if(vis) vis.checked = layerVisible(l);
  const lockEl=$('propLocked'); if(lockEl) lockEl.checked = layerLocked(l);
  $('textProps').hidden=l.type!=='text'; $('boxProps').hidden=!(l.type==='rect'); $('imageProps').hidden=l.type!=='image';
  const gradProps=$('gradientProps'); if(gradProps) gradProps.hidden=l.type!=='gradient';
  if(l.type==='text'){
    const ff=l.fontFamily||l.font||'Arial';
    populateFontSelect(ff);
    setVal('propText',l.text); setVal('propFontSize',l.fontSize); setVal('propFontWeight',l.fontWeight||'400'); setVal('propFontFamily',ff); setVal('propColor',l.color||'#000000'); setVal('propAlign',l.align||'left'); setVal('propVAlign',l.vAlign||'top'); setVal('propLineHeight',l.lineHeight||1.1);
    setVal('propTextTransform', l.textTransform || 'none'); setVal('propLetterSpacing', l.letterSpacing ?? 0);
    syncTextStyleToggles(l);
  }
  if(l.type==='rect'){ setVal('propFill',rgbToHex(l.fill||'#eb0029')); setVal('propStroke',rgbToHex(l.stroke||'#eb0029')); setVal('propStrokeWidth',l.strokeWidth||0); setVal('propRadius',l.radius||0); }
  if(l.type==='image'){
    setVal('propFit',l.fit||'contain');
    setVal('propImageSrc', isEmbeddedSrc(l.src) ? '(base64 incorporato)' : (l.src || ''));
    const srcHint=$('imageSrcHint');
    if(srcHint) srcHint.textContent = isEmbeddedSrc(l.src)
      ? 'Sorgente pesante (data URI). Preferisci un path tipo _assets/…'
      : 'Path relativo alla root campagne (es. _assets/fuoco/file.png).';
    syncKeyBlackProps(l);
  }
  if(l.type==='gradient') syncGradientProps(l);
  const fxBox = $('effectProps');
  if(fxBox) fxBox.hidden = !(l.type==='text' || l.type==='image' || l.type==='rect' || l.type==='gradient');
  const glowBox = $('glowProps');
  if(glowBox) glowBox.hidden = l.type!=='text';
  syncEffectInputs('propShadow', l.shadow, defaultShadow());
  if(l.type==='text') syncEffectInputs('propGlow', l.glow, defaultGlow());
}
function setVal(id,v){ const el=$(id); if(el) el.value = v ?? ''; }
function beginPropHistory(){ if(!propHistoryPending){ pushHistory(); propHistoryPending = true; } }
function commitPropHistory(){ propHistoryPending = false; if(propHistoryTimer){ clearTimeout(propHistoryTimer); propHistoryTimer = null; } }
function updateProp(key, value, opts={}){
  const l=selected(); if(!l) return;
  if(layerLocked(l) && key !== 'locked' && key !== 'visible' && key !== 'name'){
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
  l[key]=value;
  markDirty();
  render();
}

function syncTextStyleToggles(layer){
  document.querySelectorAll('[data-style-toggle]').forEach((btn)=>{
    const key = btn.dataset.styleToggle;
    const on = key === 'italic' ? layer.fontStyle === 'italic' : !!layer[key];
    btn.classList.toggle('active', on);
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
function startDrag(ev, id, handle=null){
  ev.preventDefault(); ev.stopPropagation();
  const target = state.layers.find(l => l.id === id);
  if(layerLocked(target)){
    if(!isSelected(id)){
      if(ev.shiftKey || ev.metaKey || ev.ctrlKey) toggleSelect(id); else selectOnly(id);
      render();
    }
    return;
  }
  const resizing = !!handle;
  const cropMode = resizing && (ev.ctrlKey || ev.metaKey);
  const freeResizeMode = resizing && ev.shiftKey;
  // On corner handles, modifier keys control resize/crop behavior, not selection.
  // If the handle target is not already selected, resize only that layer.
  // Ctrl/Cmd crop must always operate on a single image layer.
  if(resizing){
    if(cropMode || !isSelected(id)) selectOnly(id);
  } else if(!isSelected(id)){
    if(ev.shiftKey || ev.metaKey || ev.ctrlKey) toggleSelect(id); else selectOnly(id);
  }
  const layers=selectedLayers().filter(l => !layerLocked(l));
  if(!layers.length){ render(); return; }
  pushHistory();
  drag={ id, handle, resizing, cropMode, freeResizeMode, sx:ev.clientX, sy:ev.clientY, originals: layers.map(l=>({id:l.id,x:l.x,y:l.y,w:l.w,h:l.h,crop:l.crop?JSON.parse(JSON.stringify(l.crop)):null,type:l.type})), box: groupBox(layers) };
  document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', endDrag); render();
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function normalizedCrop(l){
  const c=l.crop || {x:0,y:0,w:1,h:1};
  const x=clamp(Number(c.x)||0,0,.98), y=clamp(Number(c.y)||0,0,.98);
  const w=clamp(Number(c.w)||1,.02,1-x), h=clamp(Number(c.h)||1,.02,1-y);
  return {x,y,w,h};
}
function applyImageCropFromHandle(layer, original, handle, dx, dy){
  const min=.04;
  const c=original.crop || {x:0,y:0,w:1,h:1};
  const right=c.x+c.w, bottom=c.y+c.h;
  const ddx=dx/Math.max(1, original.w), ddy=dy/Math.max(1, original.h);
  let x=c.x, y=c.y, w=c.w, h=c.h;
  if(handle.includes('w')){ x=clamp(c.x+ddx,0,right-min); w=right-x; }
  if(handle.includes('e')){ w=clamp(c.w+ddx,min,1-c.x); }
  if(handle.includes('n')){ y=clamp(c.y+ddy,0,bottom-min); h=bottom-y; }
  if(handle.includes('s')){ h=clamp(c.h+ddy,min,1-c.y); }
  layer.crop={x,y,w,h};
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
function onMove(ev){
  if(!drag) return;
  const scale=state.zoom/100; const dx=(ev.clientX-drag.sx)/scale; const dy=(ev.clientY-drag.sy)/scale;
  if(drag.resizing){
    const single = drag.originals.length === 1;
    const orig = drag.originals[0];
    const layer = single ? state.layers.find(x=>x.id===orig.id) : null;
    const cropMode = single && layer?.type === 'image' && (drag.cropMode || ev.ctrlKey || ev.metaKey);
    const freeResizeMode = drag.freeResizeMode || ev.shiftKey;
    const keepAspect = single && layer?.type === 'image' && !freeResizeMode && !cropMode;
    if(cropMode){
      applyImageCropFromHandle(layer, orig, drag.handle, dx, dy);
    } else if(single){
      Object.assign(layer, resizeBoxFromHandle(orig, drag.handle, dx, dy, keepAspect));
    } else {
      const newBox=resizeBoxFromHandle(drag.box, drag.handle, dx, dy, false);
      const sx=newBox.w/Math.max(1,drag.box.w), sy=newBox.h/Math.max(1,drag.box.h);
      drag.originals.forEach(o=>{ const l=state.layers.find(x=>x.id===o.id); if(!l) return; l.x=newBox.x+(o.x-drag.box.x)*sx; l.y=newBox.y+(o.y-drag.box.y)*sy; l.w=Math.max(10,o.w*sx); l.h=Math.max(10,o.h*sy); });
    }
  } else {
    drag.originals.forEach(o=>{ const l=state.layers.find(x=>x.id===o.id); if(!l) return; l.x=o.x+dx; l.y=o.y+dy; });
  }
  render();
}
function endDrag(){ drag=null; markDirty(); document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',endDrag); }

function startMarquee(ev){
  if(ev.target !== $('canvas')) return;
  ev.preventDefault();
  const rect=$('canvas').getBoundingClientRect(); const scale=state.zoom/100;
  const sx=(ev.clientX-rect.left)/scale, sy=(ev.clientY-rect.top)/scale;
  const el=document.createElement('div'); el.className='marquee'; $('canvas').appendChild(el);
  marquee={sx,sy,el, additive: ev.shiftKey || ev.metaKey || ev.ctrlKey};
  document.addEventListener('mousemove', onMarqueeMove); document.addEventListener('mouseup', endMarquee);
}
function onMarqueeMove(ev){
  if(!marquee) return; const rect=$('canvas').getBoundingClientRect(); const scale=state.zoom/100;
  const x=(ev.clientX-rect.left)/scale, y=(ev.clientY-rect.top)/scale;
  const left=Math.min(marquee.sx,x), top=Math.min(marquee.sy,y), w=Math.abs(x-marquee.sx), h=Math.abs(y-marquee.sy);
  Object.assign(marquee.el.style,{left:left+'px',top:top+'px',width:w+'px',height:h+'px'});
}
function endMarquee(){
  if(!marquee) return;
  const m={x:parseFloat(marquee.el.style.left)||0,y:parseFloat(marquee.el.style.top)||0,w:parseFloat(marquee.el.style.width)||0,h:parseFloat(marquee.el.style.height)||0};
  const hits=state.layers.filter(l=> layerVisible(l) && intersects(m,l)).map(l=>l.id);
  if(!marquee.additive) state.selectedIds=[];
  hits.forEach(id=>{ if(!state.selectedIds.includes(id)) state.selectedIds.push(id); });
  state.selectedId=state.selectedIds.at(-1)||null;
  marquee.el.remove(); marquee=null; document.removeEventListener('mousemove',onMarqueeMove); document.removeEventListener('mouseup',endMarquee); render();
}
function intersects(a,b){ return !(b.x > a.x+a.w || b.x+b.w < a.x || b.y > a.y+a.h || b.y+b.h < a.y); }

function bindProps(){
  const numeric=['X','Y','W','H','Z','Opacity','Rotation','FontSize','LineHeight','LetterSpacing','StrokeWidth','Radius'];
  numeric.forEach(k=>{
    const id='prop'+k; const el=$(id); if(!el) return;
    const key=k.charAt(0).toLowerCase()+k.slice(1);
    el.addEventListener('focus', beginPropHistory);
    el.addEventListener('input',()=>updateProp(key, Number(el.value), {history:false, debounce:true}));
    el.addEventListener('blur', commitPropHistory);
  });
  $('propName').oninput=()=>updateProp('name',$('propName').value);
  $('propVisible')?.addEventListener('change', ()=>updateProp('visible', $('propVisible').checked));
  $('propLocked')?.addEventListener('change', ()=>updateProp('locked', $('propLocked').checked));
  $('propBlendMode')?.addEventListener('change', ()=>updateProp('blendMode', normalizeBlendMode($('propBlendMode').value)));
  const applyKeyBlack = ()=>updateProp('keyBlack', readKeyBlackFromUi(), {debounce:true});
  ['propKeyBlackEnabled','propKeyThreshold','propKeySoftness'].forEach((id)=>{
    $(id)?.addEventListener('change', applyKeyBlack);
    $(id)?.addEventListener('input', applyKeyBlack);
  });
  $('propText').oninput=()=>updateProp('text',$('propText').value);
  $('propFontWeight').onchange=()=>updateProp('fontWeight',$('propFontWeight').value);
  $('propFontFamily').onchange=()=>{
    updateProp('fontFamily',$('propFontFamily').value);
    updateFontAvailabilityHint($('propFontFamily').value);
  };
  $('loadCustomFontBtn')?.addEventListener('click', async ()=>{
    try{
      const name = await loadCustomFont($('customFontName')?.value, $('customFontUrl')?.value);
      populateFontSelect(name);
      updateProp('fontFamily', name);
      showToast('Font caricato: ' + name);
    }catch(e){ alert('Font: ' + e.message); }
  });
  $('customFontFile')?.addEventListener('change', async (ev)=>{
    const file = ev.target.files?.[0]; ev.target.value='';
    if(!file) return;
    const name = ($('customFontName')?.value || file.name.replace(/\.[^.]+$/, '')).trim();
    const url = URL.createObjectURL(file);
    try{
      await loadCustomFont(name, url);
      populateFontSelect(name);
      updateProp('fontFamily', name);
      showToast('Font locale: ' + name);
    }catch(e){ alert('Font: ' + e.message); }
  });
  $('propTextTransform').onchange=()=>updateProp('textTransform',$('propTextTransform').value);
  $('propColor').oninput=()=>updateProp('color',$('propColor').value);
  $('propAlign').onchange=()=>updateProp('align',$('propAlign').value);
  $('propVAlign').onchange=()=>updateProp('vAlign',$('propVAlign').value);
  $('propFill').oninput=()=>updateProp('fill',$('propFill').value);
  $('propStroke').oninput=()=>updateProp('stroke',$('propStroke').value);
  $('propFit').onchange=()=>updateProp('fit',$('propFit').value);
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
  document.querySelectorAll('[data-style-toggle]').forEach((btn)=>{
    btn.onclick=()=>{
      const l=selected(); if(!l || l.type!=='text') return;
      pushHistory();
      const key=btn.dataset.styleToggle;
      if(key==='italic') l.fontStyle = l.fontStyle==='italic' ? 'normal' : 'italic';
      else l[key] = !l[key];
      markDirty();
      render();
    };
  });
}

function layoutPayload(){
  return { version:1, app:'roby-visual-layout-editor', canvas:state.canvas, layers:state.layers };
}
async function saveJsonOverwrite(){
  // 1) Layout da libreria / API (path server)
  if(state.currentLayoutPath){
    const res = await fetch('/api/save-layout', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path: state.currentLayoutPath, layout: layoutPayload()}),
    });
    const data = await res.json();
    if(!data.ok){ alert('Errore salvataggio JSON: ' + data.error); return; }
    state.currentLayoutPath = data.path;
    clearLocalFileHandle();
    clearDirty();
    render();
    showToast('JSON sovrascritto: ' + data.path);
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
  state.currentLayoutPath = data.path;
  clearDirty();
  await refreshLayoutLibrary().catch(()=>{});
  render();
  showToast('Layout salvato con nome: ' + data.path);
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
  render();
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
async function refreshLayoutLibrary(){
  const grid=$('layoutGrid'); const meta=$('libraryMeta');
  if(grid) grid.innerHTML='<div class="emptyGrid">Caricamento libreria…</div>';
  const folderParam = encodeURIComponent(state.currentLibraryFolder || '');
  let res=await fetch('/api/list-layouts?folder='+folderParam+'&ts='+Date.now(), {cache:'no-store'});
  let payload=await res.json();
  if(!payload.ok && state.currentLibraryFolder && String(payload.error || '').includes('Folder not found')){
    // If a browser saved an old/renamed folder in localStorage, never trap the user in an error screen.
    // Reset to the campaigns root so the gallery can show available folders and the Back breadcrumb again.
    state.currentLibraryFolder='';
    localStorage.setItem('robyLayoutLibraryFolder', '');
    res=await fetch('/api/list-layouts?folder=&ts='+Date.now(), {cache:'no-store'});
    payload=await res.json();
  }
  if(!payload.ok) throw new Error(payload.error || 'List failed');
  state.libraryItems=payload.items || [];
  state.libraryFolders=payload.folders || [];
  state.currentLibraryFolder=payload.folder || '';
  localStorage.setItem('robyLayoutLibraryFolder', state.currentLibraryFolder);
  const availablePaths = new Set(state.libraryItems.filter(x=>x.kind==='layout').map(x=>x.path));
  state.selectedLibraryPaths = state.selectedLibraryPaths.filter(path=>availablePaths.has(path));
  if(payload.campaigns_root) state.campaignsRoot = payload.campaigns_root;
  if(meta){
    const layouts=(payload.items||[]).filter(x=>x.kind==='layout').length;
    const images=(payload.items||[]).filter(x=>x.kind==='image').length;
    const folderLabel=state.currentLibraryFolder ? `/${state.currentLibraryFolder}` : '/';
    const root = payload.campaigns_root || state.campaignsRoot || '';
    meta.textContent=`root: ${root} · ${payload.folder_count||0} cartelle · ${payload.count} elementi in ${folderLabel} · ${layouts} layout · ${images} immagini`;
  }
  renderLibraryBreadcrumb();
  renderLibraryGrid();
}
function renderLibraryBreadcrumb(){
  const box=$('libraryBreadcrumb'); if(!box) return;
  box.innerHTML='';
  const rootBtn=document.createElement('button'); rootBtn.textContent='Cartelle'; rootBtn.className='crumbBtn'; rootBtn.onclick=()=>goLibraryFolder(''); box.appendChild(rootBtn);
  const parts=(state.currentLibraryFolder||'').split('/').filter(Boolean);
  let acc='';
  parts.forEach((part,idx)=>{
    const sep=document.createElement('span'); sep.className='crumbSep'; sep.textContent='›'; box.appendChild(sep);
    acc=acc ? acc+'/'+part : part;
    const btn=document.createElement('button'); btn.textContent=part; btn.className='crumbBtn'+(idx===parts.length-1?' active':'');
    const target=acc; btn.onclick=()=>goLibraryFolder(target); box.appendChild(btn);
  });
  if(parts.length){
    const back=document.createElement('button'); back.textContent='← Indietro'; back.className='crumbBtn back';
    back.onclick=()=>goLibraryFolder(parts.slice(0,-1).join('/'));
    box.prepend(back);
  }
}
function goLibraryFolder(folder){
  state.currentLibraryFolder = folder || '';
  state.selectedLibraryPaths = [];
  localStorage.setItem('robyLayoutLibraryFolder', state.currentLibraryFolder);
  return refreshLayoutLibrary().catch(e=>{ $('layoutGrid').innerHTML=`<div class="emptyGrid">Errore: ${escapeHtml(e.message)}</div>`; });
}
function openLayoutLibrary(){
  $('layoutLibraryModal').hidden=false;
  refreshLayoutLibrary().catch(e=>{ $('layoutGrid').innerHTML=`<div class="emptyGrid">Errore: ${escapeHtml(e.message)}</div>`; });
}
function closeLayoutLibrary(){ $('layoutLibraryModal').hidden=true; }
function visibleLibraryItems(){
  const q=($('librarySearch')?.value || '').toLowerCase().trim();
  const kindFilter=$('libraryKindFilter')?.value || 'layout';
  const folders = (state.libraryFolders || []).filter(f => !q || (f.name+' '+f.rel).toLowerCase().includes(q));
  const items = state.libraryItems.filter(it=> {
    if(kindFilter !== 'all' && it.kind !== kindFilter) return false;
    return !q || (it.name+' '+it.rel+' '+it.path+' '+(it.kind||'')).toLowerCase().includes(q);
  });
  return [...folders, ...items];
}
function isLibrarySelected(path){ return state.selectedLibraryPaths.includes(path); }
function setLibrarySelected(path, selected){
  if(selected){
    if(!state.selectedLibraryPaths.includes(path)) state.selectedLibraryPaths.push(path);
  } else {
    state.selectedLibraryPaths = state.selectedLibraryPaths.filter(x=>x!==path);
  }
  updateBulkExportButton();
}
function updateBulkExportButton(){
  const btn=$('bulkExportBtn');
  const count=state.selectedLibraryPaths.length;
  if(btn){
    btn.disabled = count === 0;
    btn.textContent = count ? `Export selezionati (${count})` : 'Export selezionati';
  }
  updateSelectAllControl();
}
function updateSelectAllControl(){
  const cb=$('librarySelectAllCheckbox');
  const txt=$('librarySelectAllText');
  if(!cb || !txt) return;
  const visibleLayouts = visibleLibraryItems().filter(it=>it.kind==='layout');
  const selectedVisible = visibleLayouts.filter(it=>isLibrarySelected(it.path)).length;
  cb.disabled = visibleLayouts.length === 0;
  cb.indeterminate = selectedVisible > 0 && selectedVisible < visibleLayouts.length;
  cb.checked = visibleLayouts.length > 0 && selectedVisible === visibleLayouts.length;
  txt.textContent = cb.checked ? `Deseleziona tutto (${visibleLayouts.length})` : (selectedVisible ? `Selezionati ${selectedVisible}/${visibleLayouts.length}` : 'Seleziona tutto');
}
function toggleVisibleLibrarySelection(forceChecked=null){
  const visibleLayouts = visibleLibraryItems().filter(it=>it.kind==='layout');
  if(!visibleLayouts.length) return;
  const allSelected = visibleLayouts.every(it=>isLibrarySelected(it.path));
  const next = forceChecked === null ? !allSelected : !!forceChecked;
  visibleLayouts.forEach(it=>setLibrarySelected(it.path, next));
  renderLibraryGrid();
}
function renderLibraryGrid(){
  const grid=$('layoutGrid'); if(!grid) return;
  const items=visibleLibraryItems();
  updateBulkExportButton();
  if(!items.length){ grid.innerHTML='<div class="emptyGrid">Nessun layout o asset trovato con questo filtro.</div>'; return; }
  grid.innerHTML='';
  items.forEach(item=>{
    if(item.kind === 'folder'){
      const card=document.createElement('div'); card.className='layoutCard folderCard';
      const preview=document.createElement('div'); preview.className='previewBox folderPreview'; preview.innerHTML='<div class="folderIcon">📁</div>';
      const info=document.createElement('div'); info.className='layoutInfo';
      info.innerHTML=`<strong>${escapeHtml(item.name)}</strong><small>Cartella progetto · ${escapeHtml(item.rel || item.name)}</small><small>${item.layouts||0} layout · ${item.images||0} immagini</small>`;
      const actions=document.createElement('div'); actions.className='layoutActions';
      const openBtn=document.createElement('button'); openBtn.textContent='Apri cartella';
      actions.append(openBtn); card.append(preview, info, actions); grid.appendChild(card);
      const openFolder=()=>goLibraryFolder(item.rel || item.path || item.name);
      preview.onclick=openFolder; card.ondblclick=openFolder; openBtn.onclick=openFolder;
      return;
    }
    const card=document.createElement('div'); card.className='layoutCard' + (isLibrarySelected(item.path) ? ' selectedForExport' : '');
    const preview=document.createElement('div'); preview.className='previewBox'; preview.title=item.kind==='image' ? 'Clicca per creare/aprire layout da immagine' : 'Clicca per aprire layout';
    const checkboxWrap=document.createElement('label'); checkboxWrap.className='librarySelect'; checkboxWrap.title=item.kind==='layout' ? 'Seleziona per export bulk' : 'Export bulk disponibile solo per i JSON layout';
    const checkbox=document.createElement('input'); checkbox.type='checkbox'; checkbox.checked=isLibrarySelected(item.path); checkbox.disabled=item.kind !== 'layout';
    const checkboxText=document.createElement('span'); checkboxText.className='librarySelectText'; checkboxText.textContent=checkbox.checked ? 'Selezionato' : 'Seleziona';
    checkbox.addEventListener('click', ev=>ev.stopPropagation());
    checkboxWrap.addEventListener('click', ev=>ev.stopPropagation());
    checkbox.addEventListener('change', ev=>{ setLibrarySelected(item.path, ev.target.checked); card.classList.toggle('selectedForExport', ev.target.checked); checkboxText.textContent=ev.target.checked ? 'Selezionato' : 'Seleziona'; });
    checkboxWrap.append(checkbox, checkboxText);
    const info=document.createElement('div'); info.className='layoutInfo';
    const badge=item.kind==='image' ? (item.has_layout ? 'Immagine + layout' : 'Immagine') : 'Layout';
    const actionLabel=item.kind==='image' ? (item.has_layout ? 'Apri layout' : 'Crea layout') : 'Apri';
    info.innerHTML=`<strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(badge)} · ${escapeHtml(item.rel)}</small><small>${item.canvas?.width||'?'}×${item.canvas?.height||'?'} · ${item.kind==='layout' ? item.layers+' layer' : 'asset immagine'} · ${item.mtime_iso}</small>`;
    const actions=document.createElement('div'); actions.className='layoutActions';
    const openBtn=document.createElement('button'); openBtn.textContent=actionLabel;
    const delBtn=document.createElement('button'); delBtn.textContent='Cancella'; delBtn.className='danger';
    if(item.kind !== 'layout'){ delBtn.disabled=true; delBtn.title='La cancellazione è abilitata solo sui file .layout.json, non sulle immagini finali.'; }
    actions.append(openBtn,delBtn); card.append(preview, checkboxWrap, info, actions); grid.appendChild(card);
    loadPreviewInto(preview,item);
    const toggleCardSelection=()=>{
      if(item.kind !== 'layout') return;
      const next=!isLibrarySelected(item.path);
      checkbox.checked=next;
      setLibrarySelected(item.path,next);
      checkboxText.textContent=next ? 'Selezionato' : 'Seleziona';
      card.classList.toggle('selectedForExport', next);
    };
    const open=()=>openLibraryItem(item).then(()=>closeLayoutLibrary()).catch(e=>alert('Errore apertura: '+e.message));
    preview.onclick=toggleCardSelection; card.ondblclick=open; openBtn.onclick=open;
    delBtn.onclick=async()=>{
      if(item.kind !== 'layout') return;
      if(!confirm(`Cancellare definitivamente questo layout?\n\n${item.rel}`)) return;
      const res=await fetch('/api/delete-layout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:item.path})});
      const data=await res.json();
      if(!data.ok){ alert('Errore cancellazione: '+data.error); return; }
      await refreshLayoutLibrary();
    };
  });
}
async function openLibraryItem(item){
  if(item.kind === 'image'){
    if(item.has_layout && item.layout_path){
      return loadLayoutUrl(item.layout_path);
    }
    const res=await fetch('/api/create-layout-from-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:item.path})});
    const data=await res.json();
    if(!data.ok) throw new Error(data.error || 'Create layout failed');
    loadLayoutObject(data.layout, data.path);
    await refreshLayoutLibrary().catch(()=>{});
    return;
  }
  return loadLayoutUrl(item.path);
}
async function loadPreviewInto(box,item){
  try{
    if(item.kind === 'image'){
      const img=document.createElement('img');
      const src='/api/file?path='+encodeURIComponent(item.path);
      img.src=src; img.alt=item.name; img.loading='lazy'; img.style.maxWidth='100%'; img.style.maxHeight='200px'; img.style.objectFit='contain';
      [...box.childNodes].forEach(node=>{ if(!node.classList || !node.classList.contains('librarySelect')) node.remove(); }); box.appendChild(img); return;
    }
    let layout;
    if(item.path.startsWith('./')){
      const res=await fetch(item.path,{cache:'no-store'}); layout=await res.json();
    } else {
      const res=await fetch('/api/load-layout?path='+encodeURIComponent(item.path),{cache:'no-store'}); const payload=await res.json(); layout=payload.layout;
    }
    const c=document.createElement('canvas'); const w=layout.canvas?.width||1080, h=layout.canvas?.height||1350;
    const maxW=210, maxH=195, scale=Math.min(maxW/w,maxH/h);
    c.width=Math.round(w*scale); c.height=Math.round(h*scale);
    const ctx=c.getContext('2d'); ctx.scale(scale,scale);
    await renderLayoutToCanvas(ctx, layout, w, h);
    [...box.childNodes].forEach(node=>{ if(!node.classList || !node.classList.contains('librarySelect')) node.remove(); }); box.appendChild(c);
  }catch(e){ box.innerHTML='<small class="muted">Preview non disponibile</small>'; }
}
async function renderLayoutToCanvas(ctx, layout, w, h){
  ctx.fillStyle=layout.canvas?.background || '#ffffff'; ctx.fillRect(0,0,w,h);
  for(const l of [...(layout.layers||[])].sort((a,b)=>(a.z||0)-(b.z||0))){
    if(l.visible === false) continue;
    ctx.save(); ctx.globalAlpha=l.opacity ?? 1;
    applyBlendCanvas(ctx, l);
    const rot=(Number(l.rotation)||0)*Math.PI/180;
    if(rot){ ctx.translate(l.x+l.w/2,l.y+l.h/2); ctx.rotate(rot); ctx.translate(-(l.x+l.w/2),-(l.y+l.h/2)); }
    if(l.type==='rect') drawRoundRect(ctx,l.x,l.y,l.w,l.h,l.radius||0,l.fill,l.stroke,l.strokeWidth||0,l);
    if(l.type==='text') drawCanvasText(ctx,l);
    if(l.type==='image') await drawCanvasImage(ctx,l);
    if(l.type==='gradient') drawCanvasGradient(ctx,l);
    ctx.restore();
  }
}
async function loadReadyLayouts(){ await refreshLayoutLibrary(); }
function downloadBlob(content, name, type){ const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),500); }

function safeExportName(name){ return (name || 'layout').replace(/\.layout\.json$/,'').replace(/[^A-Za-z0-9._-]+/g,'_') + '.png'; }
function canvasToBlob(canvas){ return new Promise(resolve=>canvas.toBlob(resolve, 'image/png')); }
function delay(ms){ return new Promise(resolve=>setTimeout(resolve, ms)); }
async function loadLayoutByPath(path){
  const res=await fetch('/api/load-layout?path=' + encodeURIComponent(path), {cache:'no-store'});
  const payload=await res.json();
  if(!payload.ok) throw new Error(payload.error || 'Load failed');
  return payload.layout;
}
async function renderLayoutToBlob(layout){
  const w=layout.canvas?.width||1080, h=layout.canvas?.height||1350;
  const out=document.createElement('canvas'); out.width=w; out.height=h;
  const ctx=out.getContext('2d');
  await renderLayoutToCanvas(ctx, layout, w, h);
  return canvasToBlob(out);
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
      const blob=await renderLayoutToBlob(layout);
      if(!blob) throw new Error('PNG blob vuoto');
      downloadBlobObject(blob, safeExportName(item.name));
      await delay(250);
    }catch(e){
      failures.push(`${item.name}: ${e.message}`);
    }
  }
  if(btn){ btn.textContent=oldText || 'Export selezionati'; updateBulkExportButton(); }
  if(failures.length) alert('Export completato con errori:\n' + failures.join('\n'));
}
async function exportPng(){
  const out=document.createElement('canvas'); out.width=state.canvas.width; out.height=state.canvas.height; const ctx=out.getContext('2d');
  await renderLayoutToCanvas(ctx, layoutPayload(), out.width, out.height);
  const name = safeExportName(currentLayoutExportName());
  out.toBlob(blob=>{
    if(!blob) return;
    downloadBlobObject(blob, name);
    showToast('PNG esportato: ' + name);
  }, 'image/png');
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
      // Bake fit/crop into an alpha canvas first, then draw with shadow (avoids clip boxing the blur).
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(l.w));
      off.height = Math.max(1, Math.round(l.h));
      const octx = off.getContext('2d');
      drawImageFit(octx, srcImg, { ...l, x: 0, y: 0, w: off.width, h: off.height });
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
  ensureCatalogGoogleFonts?.();
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

function bindKeyboardShortcuts(){
  document.addEventListener('contextmenu', (ev)=>{
    if(ev.target?.closest?.('.layer, .resizeHandle, #canvas')) ev.preventDefault();
  }, true);
  document.addEventListener('keydown', (ev)=>{
    if(isTypingTarget(ev.target)) return;
    const mod = ev.metaKey || ev.ctrlKey;
    const key = ev.key.toLowerCase();
    if(mod && key === 's'){
      ev.preventDefault();
      saveJsonOverwrite();
      return;
    }
    if(mod && key === 'z'){
      ev.preventDefault();
      if(ev.shiftKey) redo(); else undo();
      markDirty();
      return;
    }
    if(mod && key === 'y'){
      ev.preventDefault();
      redo();
      markDirty();
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
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(ev.key) && state.selectedIds.length){
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
  }catch(e){
    state.campaignsRoot = '';
    state.editorRoot = '';
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
  $('canvas').addEventListener('contextmenu', (ev)=>{ if(ev.target.closest?.('.layer')) ev.preventDefault(); });
  $('canvas').addEventListener('click',(ev)=>{ if(ev.target===$('canvas')){state.selectedId=null; state.selectedIds=[]; render();} });
  $('zoomRange').oninput=()=>{state.zoom=Number($('zoomRange').value); render();};
  $('addTextBtn').onclick=()=>{pushHistory(); state.layers.push(defaultText()); selectOnly(state.layers.at(-1).id); markDirty(); render();};
  $('addRectBtn').onclick=()=>{pushHistory(); state.layers.push(defaultRect()); selectOnly(state.layers.at(-1).id); markDirty(); render();};
  $('addGradientBtn')?.addEventListener('click', ()=>{ pushHistory(); state.layers.push(defaultGradient()); selectOnly(state.layers.at(-1).id); markDirty(); render(); });
  $('addImagePathBtn')?.addEventListener('click', addImageByPath);
  $('imageInput').onchange=e=>{ if(e.target.files[0]) readImageFile(e.target.files[0]); e.target.value=''; };
  $('openJsonBtn')?.addEventListener('click', ()=>openLocalJson());
  $('jsonInput').onchange=e=>{ if(e.target.files[0]) loadJsonFile(e.target.files[0]); e.target.value=''; };
  $('saveJsonBtn').onclick=saveJsonOverwrite;
  $('saveLayoutBtn').onclick=saveLayout;
  $('saveAsLayoutBtn').onclick=saveLayoutAs;
  $('exportPngBtn').onclick=exportPng;
  $('openLibraryBtn').onclick=openLayoutLibrary;
  $('closeLibraryBtn').onclick=closeLayoutLibrary;
  $('refreshLibraryBtn').onclick=()=>refreshLayoutLibrary().catch(e=>alert('Errore aggiornamento libreria: '+e.message));
  $('bulkExportBtn').onclick=exportSelectedLayouts;
  $('librarySelectAllCheckbox').onchange=(ev)=>toggleVisibleLibrarySelection(ev.target.checked);
  $('librarySearch').oninput=renderLibraryGrid;
  $('libraryKindFilter').onchange=renderLibraryGrid;
  document.querySelectorAll('[data-align-action]').forEach(btn=>btn.onclick=()=>alignSelectedLayers(btn.dataset.alignAction));
  document.querySelectorAll('[data-canvas-align]').forEach(btn=>btn.onclick=()=>alignSelectedToCanvas(btn.dataset.canvasAlign));
  $('deleteBtn').onclick=()=>{
    if(!state.selectedIds.length) return;
    const locked = selectedLayers().filter(layerLocked);
    if(locked.length){ showToast('Sblocca i layer prima di eliminarli'); return; }
    pushHistory(); state.layers=state.layers.filter(x=>!isSelected(x.id)); state.selectedId=null; state.selectedIds=[]; markDirty(); render();
  };
  $('duplicateBtn').onclick=()=>{ const ls=selectedLayers(); if(!ls.length) return; pushHistory(); const copies=ls.map(l=>{ const c=JSON.parse(JSON.stringify(l)); c.id=uid(); c.name=(c.name||c.type)+' copy'; c.x+=24; c.y+=24; c.z=nextZ(); return c; }); state.layers.push(...copies); state.selectedIds=copies.map(c=>c.id); state.selectedId=state.selectedIds.at(-1); markDirty(); render(); };
  $('presetSelect').onchange=()=>{ const v=$('presetSelect').value; if(v!=='custom'){ const [w,h]=v.split('x').map(Number); $('canvasW').value=w; $('canvasH').value=h; }};
  $('resizeCanvasBtn').onclick=()=>{ pushHistory(); state.canvas.width=Number($('canvasW').value); state.canvas.height=Number($('canvasH').value); markDirty(); render(); };
  $('canvasBg')?.addEventListener('input', ()=>{ pushHistory(); state.canvas.background = $('canvasBg').value; markDirty(); render(); });
  $('toggleSafeGuides')?.addEventListener('change', (ev)=>{ state.showSafeGuides = ev.target.checked; localStorage.setItem('robyShowSafeGuides', state.showSafeGuides ? '1' : '0'); render(); });
  $('reloadBtn').onclick=()=>reloadCurrentLayout();
  $('newBtn').onclick=()=>{ if(!confirmDiscardChanges()) return; if(confirm('Creare un nuovo layout vuoto?')){ pushHistory(); state.layers=[]; state.selectedId=null; state.selectedIds=[]; state.currentLayoutPath=null; state.loadedJsonFilename=null; clearLocalFileHandle(); clearDirty(); render(); }};
  bindProps(); bindKeyboardShortcuts(); syncCanvasInputs(); populateFontSelect();
  loadServerHealth().finally(()=>{ loadReadyLayouts(); render(); });
}
if(!window.ROBY_EXPORT_MODE) init();
else {
  window.__robyExportReady = true;
  document.getElementById('exportStatus') && (document.getElementById('exportStatus').textContent = 'ready');
}

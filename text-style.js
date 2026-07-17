/** Display / transform helpers for text layers (DOM + canvas export). */

function layerTextTransform(layer) {
  return layer.textTransform || 'none';
}

function toCamelCaseLine(line) {
  const parts = String(line).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return line;
  return parts
    .map((p, i) => {
      const lower = p.toLowerCase();
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

function displayText(layer) {
  const raw = String(layer.text ?? '');
  const t = layerTextTransform(layer);
  if (t === 'uppercase') return raw.toUpperCase();
  if (t === 'lowercase') return raw.toLowerCase();
  if (t === 'capitalize') {
    return raw.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }
  if (t === 'camelCase') {
    return raw.split('\n').map(toCamelCaseLine).join('\n');
  }
  return raw;
}

function textDecorationCss(layer) {
  const parts = [];
  if (layer.underline) parts.push('underline');
  if (layer.strikethrough) parts.push('line-through');
  return parts.length ? parts.join(' ') : 'none';
}

function applyTextStyleDom(el, layer) {
  const transform = layerTextTransform(layer);
  const useCssTransform = transform !== 'camelCase';
  el.textContent = useCssTransform ? (layer.text || '') : displayText(layer);
  el.style.fontStyle = layer.fontStyle === 'italic' ? 'italic' : 'normal';
  el.style.textDecoration = textDecorationCss(layer);
  el.style.textTransform = useCssTransform ? transform : 'none';
  el.style.letterSpacing = `${Number(layer.letterSpacing) || 0}px`;
}

function drawTextDecorations(ctx, layer, line, x, baselineY, ascent, descent) {
  if (!layer.underline && !layer.strikethrough) return;
  const width = Math.min(ctx.measureText(line || '\u00a0').width, layer.w);
  let left = x;
  if (layer.align === 'center') left = x - width / 2;
  if (layer.align === 'right') left = x - width;
  ctx.save();
  ctx.strokeStyle = layer.color || '#000';
  ctx.lineWidth = Math.max(1, (Number(layer.fontSize) || 32) * 0.06);
  ctx.beginPath();
  if (layer.underline) {
    const y = baselineY + Math.max(1, descent * 0.35);
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
  }
  if (layer.strikethrough) {
    const y = baselineY - ascent * 0.35;
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
  }
  ctx.stroke();
  ctx.restore();
}

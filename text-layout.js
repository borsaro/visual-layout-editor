let _measureCtx = null;

function getMeasureCtx() {
  if (!_measureCtx) {
    const canvas = document.createElement('canvas');
    _measureCtx = canvas.getContext('2d');
  }
  return _measureCtx;
}

function textFontCss(layer) {
  const family = layer.fontFamily || layer.font || 'Arial';
  const size = Number(layer.fontSize) || 32;
  const weight = layer.fontWeight || 400;
  const style = layer.fontStyle === 'italic' ? 'italic' : 'normal';
  return `${style} ${weight} ${size}px "${family}", Arial, sans-serif`;
}

function applyCanvasLetterSpacing(ctx, layer) {
  const spacing = Number(layer.letterSpacing) || 0;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
}

function prepareMeasureCtx(layer) {
  const ctx = getMeasureCtx();
  ctx.font = textFontCss(layer);
  applyCanvasLetterSpacing(ctx, layer);
  return ctx;
}

/** Soft-wrap one hard line to maxWidth (canvas font metrics). */
function wrapLineToWidth(ctx, line, maxWidth) {
  if (line === '') return [''];
  if (maxWidth <= 0 || ctx.measureText(line).width <= maxWidth) return [line];

  const out = [];
  let rest = line;
  while (rest.length) {
    if (ctx.measureText(rest).width <= maxWidth) {
      out.push(rest);
      break;
    }
    let lo = 1;
    let hi = rest.length;
    let fit = 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ctx.measureText(rest.slice(0, mid)).width <= maxWidth) {
        fit = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const spaceIdx = rest.lastIndexOf(' ', fit);
    if (spaceIdx > 0) {
      out.push(rest.slice(0, spaceIdx));
      rest = rest.slice(spaceIdx + 1);
    } else {
      out.push(rest.slice(0, fit));
      rest = rest.slice(fit);
    }
  }
  return out.length ? out : [''];
}

/** Hard \\n + soft wrap at layer.w — shared by editor measure and canvas export. */
function wrapTextLines(layer) {
  const ctx = prepareMeasureCtx(layer);
  const maxW = Number(layer.w) || 0;
  const lines = [];
  for (const hard of displayText(layer).split('\n')) {
    lines.push(...wrapLineToWidth(ctx, hard, maxW));
  }
  return lines;
}

function measureTextLayout(layer) {
  const fontSize = Number(layer.fontSize) || 32;
  const lineRatio = Number(layer.lineHeight) || 1.1;
  const lh = fontSize * lineRatio;
  const lines = wrapTextLines(layer);
  const ctx = prepareMeasureCtx(layer);

  const metrics = lines.map((line) => {
    const m = ctx.measureText(line || '\u00a0');
    const ascent = m.actualBoundingBoxAscent ?? fontSize * 0.78;
    const descent = m.actualBoundingBoxDescent ?? fontSize * 0.22;
    return { ascent, descent };
  });

  const blockAscent = Math.max(...metrics.map((m) => m.ascent), 0);
  const blockDescent = Math.max(...metrics.map((m) => m.descent), 0);
  const totalH = lines.length <= 1
    ? blockAscent + blockDescent
    : blockAscent + (lines.length - 1) * lh + blockDescent;

  return { lines, lh, fontSize, blockAscent, blockDescent, totalH, metrics };
}

function textBlockOffsetY(layer, layout) {
  const va = layer.vAlign || 'top';
  if (va === 'middle') return Math.max(0, (layer.h - layout.totalH) / 2);
  if (va === 'bottom') return Math.max(0, layer.h - layout.totalH);
  return 0;
}

function textBlockDomPaddingTop(layer, layout) {
  const offsetY = textBlockOffsetY(layer, layout);
  const m0 = layout.metrics[0] || { ascent: layout.fontSize * 0.78, descent: layout.fontSize * 0.22 };
  const halfLeading = Math.max(0, (layout.lh - m0.ascent - m0.descent) / 2);
  return Math.max(0, offsetY - halfLeading);
}

function drawCanvasText(ctx, layer) {
  const layout = measureTextLayout(layer);
  const offsetY = textBlockOffsetY(layer, layout);
  ctx.fillStyle = layer.color || '#000';
  ctx.font = textFontCss(layer);
  applyCanvasLetterSpacing(ctx, layer);
  ctx.textBaseline = 'alphabetic';

  layout.lines.forEach((line, i) => {
    let x = layer.x;
    if (layer.align === 'center') x = layer.x + layer.w / 2;
    if (layer.align === 'right') x = layer.x + layer.w;
    ctx.textAlign = layer.align || 'left';
    const baselineY = layer.y + offsetY + layout.blockAscent + i * layout.lh;
    const m = layout.metrics[i] || { ascent: layout.fontSize * 0.78, descent: layout.fontSize * 0.22 };
    ctx.fillText(line, x, baselineY);
    drawTextDecorations(ctx, layer, line, x, baselineY, m.ascent, m.descent);
  });
}

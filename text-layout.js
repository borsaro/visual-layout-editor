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

  // Font metrics, not the ink of this particular string: they are what the browser
  // lays a line box out with, so they are what the canvas has to use to land on the
  // same baseline. Measured off a fixed probe, so a line of all-caps and one full of
  // accents and descenders sit identically — with the ink metrics they did not.
  const probe = ctx.measureText('Hg');
  const fontAscent = probe.fontBoundingBoxAscent ?? Math.max(...metrics.map((m) => m.ascent), fontSize * 0.78);
  const fontDescent = probe.fontBoundingBoxDescent ?? Math.max(...metrics.map((m) => m.descent), fontSize * 0.22);

  const blockAscent = Math.max(...metrics.map((m) => m.ascent), 0);
  const blockDescent = Math.max(...metrics.map((m) => m.descent), 0);
  const totalH = lines.length <= 1
    ? blockAscent + blockDescent
    : blockAscent + (lines.length - 1) * lh + blockDescent;

  return { lines, lh, fontSize, blockAscent, blockDescent, totalH, metrics, fontAscent, fontDescent };
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

/**
 * Where the browser puts the first baseline, reproduced on the canvas.
 *
 * The DOM node is given a padding-top, then the browser adds half-leading and the
 * font's own ascent. Painting instead at the ink ascent of the text — which is what
 * this did — moved the line by however tall that particular string happened to be:
 * an all-caps headline landed right while a line with accents and descenders sat
 * several pixels off, and the export stopped matching the editor.
 */
function textFirstBaselineY(layer, layout) {
  const padTop = textBlockDomPaddingTop(layer, layout);
  const halfLeading = (layout.lh - layout.fontAscent - layout.fontDescent) / 2;
  return layer.y + padTop + halfLeading + layout.fontAscent;
}

function paintCanvasTextLines(ctx, layer, layout) {
  const firstBaseline = textFirstBaselineY(layer, layout);
  layout.lines.forEach((line, i) => {
    let x = layer.x;
    if (layer.align === 'center') x = layer.x + layer.w / 2;
    if (layer.align === 'right') x = layer.x + layer.w;
    ctx.textAlign = layer.align || 'left';
    const baselineY = firstBaseline + i * layout.lh;
    ctx.fillText(line, x, baselineY);
    drawTextDecorations(ctx, layer, line, x, baselineY, layout.fontAscent, layout.fontDescent);
  });
}

function drawCanvasText(ctx, layer) {
  const layout = measureTextLayout(layer);
  ctx.fillStyle = layer.color || '#000';
  ctx.font = textFontCss(layer);
  applyCanvasLetterSpacing(ctx, layer);
  ctx.textBaseline = 'alphabetic';

  if (typeof applyCanvasGlow === 'function' && applyCanvasGlow(ctx, layer.glow)) {
    paintCanvasTextLines(ctx, layer, layout);
    clearCanvasShadow(ctx);
  }
  if (typeof applyCanvasShadow === 'function') applyCanvasShadow(ctx, layer.shadow);
  paintCanvasTextLines(ctx, layer, layout);
  if (typeof clearCanvasShadow === 'function') clearCanvasShadow(ctx);
}

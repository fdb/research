// render.js — draw fonts on canvas (browser only; core stays DOM-free).

import { measure } from "./font.js";

// Build a Path2D for one glyph (y-up font units → y-down pixels via transform).
function glyphPath(glyph) {
  const path = new Path2D();
  for (const c of glyph.contours) {
    path.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < c.length; i++) path.lineTo(c[i].x, c[i].y);
    path.closePath();
  }
  return path;
}

// Draw `text` with `font` at pixel size, top-left anchored at (x, y).
export function drawText(ctx, font, text, x, y, sizePx, color) {
  const s = sizePx / font.metrics.upm;
  const baseline = y + (font.metrics.ascender / font.metrics.upm) * sizePx;
  ctx.save();
  ctx.fillStyle = color;
  ctx.translate(x, baseline);
  ctx.scale(s, -s);
  for (const ch of text) {
    const g = font.glyphs.get(ch);
    if (g) {
      if (g.contours.length) ctx.fill(glyphPath(g), "nonzero");
      ctx.translate(g.advance, 0);
    } else {
      ctx.translate(250, 0);
    }
  }
  ctx.restore();
}

// Draw text centered in a canvas, auto-sized to fit with padding.
export function drawFitted(canvas, font, text, opts = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cw = canvas.clientWidth || canvas.width;
  const chh = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(cw * dpr)) canvas.width = Math.round(cw * dpr);
  if (canvas.height !== Math.round(chh * dpr)) canvas.height = Math.round(chh * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, chh);

  const pad = opts.pad ?? 10;
  const lines = text.split("\n");
  const upm = font.metrics.upm;
  const lineH = (font.metrics.ascender - font.metrics.descender + font.metrics.lineGap) / upm;
  let maxW = 1;
  for (const line of lines) maxW = Math.max(maxW, measure(font, line) / upm);
  let size = Math.min(
    (cw - pad * 2) / maxW,
    (chh - pad * 2) / (lineH * lines.length),
    opts.maxSize ?? 480
  );
  const color =
    opts.color ||
    getComputedStyle(document.documentElement).getPropertyValue("--fg") ||
    "#000";
  const totalH = lineH * lines.length * size;
  let yy = (chh - totalH) / 2;
  for (const line of lines) {
    const w = (measure(font, line) / upm) * size;
    drawText(ctx, font, line, (cw - w) / 2, yy, size, color);
    yy += lineH * size;
  }
}

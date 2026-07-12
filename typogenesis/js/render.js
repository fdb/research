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

// Anatomy view: metrics lines, filled glyph (faint), outline, skeleton.
export function drawAnatomy(canvas, anatomy, colors) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cw = canvas.clientWidth || canvas.width;
  const chh = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(chh * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, chh);

  const { P, w, strokes, contours } = anatomy;
  const top = Math.max(P.A, P.C) + 40;
  const bot = P.D - 40;
  const s = Math.min((cw * 0.86) / Math.max(w, 1), (chh * 0.92) / (top - bot));
  const ox = (cw - w * s) / 2;
  const oy = chh / 2 + ((top + bot) / 2) * s;
  const X = (x) => ox + x * s;
  const Y = (y) => oy - y * s;

  // Metrics lines
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillStyle = colors.muted;
  for (const [y, label] of [
    [0, "baseline"],
    [P.X, "x-height"],
    [P.C, "cap"],
    [P.A, "asc"],
    [P.D, "desc"],
  ]) {
    ctx.beginPath();
    ctx.moveTo(4, Y(y));
    ctx.lineTo(cw - 4, Y(y));
    ctx.stroke();
    ctx.fillText(label, 6, Y(y) - 3);
  }
  ctx.setLineDash([]);

  // Filled glyph, faint
  const path = new Path2D();
  for (const c of contours) {
    path.moveTo(X(c[0].x), Y(c[0].y));
    for (let i = 1; i < c.length; i++) path.lineTo(X(c[i].x), Y(c[i].y));
    path.closePath();
  }
  ctx.globalAlpha = 0.09;
  ctx.fillStyle = colors.fg;
  ctx.fill(path, "nonzero");
  ctx.globalAlpha = 1;

  // Outline
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 1.2;
  ctx.stroke(path);

  // Skeleton centerlines + nodes
  ctx.strokeStyle = colors.accent;
  ctx.fillStyle = colors.accent;
  ctx.lineWidth = 1.4;
  for (const st of strokes) {
    if (st.blob) continue;
    ctx.beginPath();
    ctx.moveTo(X(st.pts[0].x), Y(st.pts[0].y));
    for (let i = 1; i < st.pts.length; i++)
      ctx.lineTo(X(st.pts[i].x), Y(st.pts[i].y));
    if (st.closed) ctx.closePath();
    ctx.stroke();
    // endpoints
    for (const p of st.closed ? [] : [st.pts[0], st.pts[st.pts.length - 1]]) {
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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

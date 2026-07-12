// ttf.js — a TrueType compiler from scratch.
//
// Takes the outlines produced by font.js and writes a complete, valid,
// installable .ttf: glyf/loca/cmap/hmtx/hhea/head/maxp/name/post/OS2,
// table directory, checksums and all. No dependencies — a tiny homage
// to opentype.js, written the other way round (we only write).
//
// All contours are polylines: every point is an on-curve point, which is
// perfectly legal TrueType (quadratic curves are optional).

// --- Binary writer ----------------------------------------------------------

class Writer {
  constructor() {
    this.buf = new Uint8Array(1024);
    this.len = 0;
  }
  ensure(n) {
    if (this.len + n > this.buf.length) {
      const nb = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
      nb.set(this.buf);
      this.buf = nb;
    }
  }
  u8(v) {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }
  u16(v) {
    this.ensure(2);
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = v & 0xff;
  }
  i16(v) {
    this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v) {
    this.ensure(4);
    this.buf[this.len++] = (v >>> 24) & 0xff;
    this.buf[this.len++] = (v >>> 16) & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = v & 0xff;
  }
  i32(v) {
    this.u32(v < 0 ? v + 0x100000000 : v);
  }
  i64(hi, lo) {
    this.u32(hi);
    this.u32(lo);
  }
  tag(s) {
    for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i));
  }
  bytes(arr) {
    this.ensure(arr.length);
    this.buf.set(arr, this.len);
    this.len += arr.length;
  }
  pad4() {
    while (this.len % 4) this.u8(0);
  }
  data() {
    return this.buf.slice(0, this.len);
  }
}

function checksum(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum =
      (sum +
        (((data[i] || 0) << 24) |
          ((data[i + 1] || 0) << 16) |
          ((data[i + 2] || 0) << 8) |
          (data[i + 3] || 0))) >>>
      0;
  }
  return sum;
}

// --- Table builders ---------------------------------------------------------

function buildGlyf(glyphOrder, glyphData) {
  const glyf = new Writer();
  const offsets = [0];
  for (const entry of glyphOrder) {
    const g = glyphData.get(entry);
    if (g && g.contours.length) {
      const w = glyf;
      const start = w.len;
      w.i16(g.contours.length);
      w.i16(g.bbox.xMin);
      w.i16(g.bbox.yMin);
      w.i16(g.bbox.xMax);
      w.i16(g.bbox.yMax);
      // endPtsOfContours
      let end = -1;
      for (const c of g.contours) {
        end += c.length;
        w.u16(end);
      }
      w.u16(0); // instructionLength
      const pts = g.contours.flat();
      // flags: bit0 = on-curve. Compute per-point x/y deltas + short forms.
      const flags = [];
      const xs = [];
      const ys = [];
      let px = 0,
        py = 0;
      for (const p of pts) {
        let dx = p.x - px;
        let dy = p.y - py;
        px = p.x;
        py = p.y;
        let f = 1; // on-curve
        if (dx === 0) f |= 0x10; // x same
        else if (dx >= -255 && dx <= 255) {
          f |= 0x02; // x short
          if (dx >= 0) f |= 0x10; // short & positive
          xs.push(Math.abs(dx));
        } else xs.push({ long: dx });
        if (dy === 0) f |= 0x20; // y same
        else if (dy >= -255 && dy <= 255) {
          f |= 0x04; // y short
          if (dy >= 0) f |= 0x20;
          ys.push(Math.abs(dy));
        } else ys.push({ long: dy });
        flags.push(f);
      }
      for (const f of flags) w.u8(f);
      for (const v of xs) {
        if (typeof v === "object") w.i16(v.long);
        else w.u8(v);
      }
      for (const v of ys) {
        if (typeof v === "object") w.i16(v.long);
        else w.u8(v);
      }
      // pad to 4 for clean loca offsets
      while ((w.len - start) % 4) w.u8(0);
    }
    offsets.push(glyf.len);
  }
  return { glyf: glyf.data(), offsets };
}

function buildLoca(offsets) {
  const w = new Writer();
  for (const o of offsets) w.u32(o);
  return w.data();
}

function buildCmap(charToGid) {
  // format 4, platform 3 encoding 1 (Windows BMP) + platform 0.
  const codes = [...charToGid.keys()].sort((a, b) => a - b);
  // Build segments of consecutive codes.
  const segs = [];
  let s = null;
  for (const c of codes) {
    if (s && c === s.end + 1) s.end = c;
    else segs.push((s = { start: c, end: c }));
  }
  segs.push({ start: 0xffff, end: 0xffff, final: true });
  const segCount = segs.length;

  const sub = new Writer();
  sub.u16(4); // format
  const idRangeOffsetsStart = 16 + segCount * 8;
  // We always use glyphIdArray via idRangeOffset for simplicity? Simpler:
  // use idDelta when the segment maps consecutively, else glyphIdArray.
  const glyphIdArray = [];
  const segData = segs.map((seg, i) => {
    if (seg.final) return { idDelta: 1, idRangeOffset: 0 };
    // Check if gids are consecutive across the segment.
    let consecutive = true;
    const g0 = charToGid.get(seg.start);
    for (let c = seg.start; c <= seg.end; c++) {
      if (charToGid.get(c) !== g0 + (c - seg.start)) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) {
      return { idDelta: (g0 - seg.start + 0x10000) & 0xffff, idRangeOffset: 0 };
    }
    const offsetWords =
      segCount - i + glyphIdArray.length; // words from this idRangeOffset slot
    for (let c = seg.start; c <= seg.end; c++)
      glyphIdArray.push(charToGid.get(c));
    return { idDelta: 0, idRangeOffset: offsetWords * 2 };
  });

  const length = 16 + segCount * 8 + glyphIdArray.length * 2;
  sub.u16(length);
  sub.u16(0); // language
  sub.u16(segCount * 2);
  let searchRange = 2;
  let entrySelector = 0;
  while (searchRange * 2 <= segCount * 2) {
    searchRange *= 2;
    entrySelector++;
  }
  sub.u16(searchRange);
  sub.u16(entrySelector);
  sub.u16(segCount * 2 - searchRange);
  for (const seg of segs) sub.u16(seg.end);
  sub.u16(0); // reservedPad
  for (const seg of segs) sub.u16(seg.start);
  for (const sd of segData) sub.u16(sd.idDelta);
  for (const sd of segData) sub.u16(sd.idRangeOffset);
  for (const gid of glyphIdArray) sub.u16(gid);
  const subData = sub.data();

  const w = new Writer();
  w.u16(0); // version
  w.u16(2); // numTables
  // platform 0 (Unicode) and platform 3 (Windows) share the same subtable
  w.u16(0);
  w.u16(3);
  w.u32(4 + 2 * 8);
  w.u16(3);
  w.u16(1);
  w.u32(4 + 2 * 8);
  w.bytes(subData);
  return w.data();
}

function buildHead(bbox, upm, indexToLocFormat) {
  const w = new Writer();
  w.u32(0x00010000); // version
  w.u32(0x00010000); // fontRevision
  w.u32(0); // checkSumAdjustment (patched later)
  w.u32(0x5f0f3cf5); // magic
  w.u16(0x000b); // flags: baseline y=0, lsb x=0, instructions may depend on size
  w.u16(upm);
  // created/modified: seconds since 1904-01-01. Fixed date (2026-01-01).
  const secs = 3850444800;
  w.i64(0, secs);
  w.i64(0, secs);
  w.i16(bbox.xMin);
  w.i16(bbox.yMin);
  w.i16(bbox.xMax);
  w.i16(bbox.yMax);
  w.u16(0); // macStyle
  w.u16(8); // lowestRecPPEM
  w.i16(2); // fontDirectionHint
  w.i16(indexToLocFormat);
  w.i16(0); // glyphDataFormat
  return w.data();
}

function buildHhea(metrics, glyphMetrics, bbox) {
  let advanceMax = 0;
  let minLsb = 32767;
  let minRsb = 32767;
  let xMaxExtent = -32768;
  for (const g of glyphMetrics) {
    advanceMax = Math.max(advanceMax, g.advance);
    if (g.bbox) {
      minLsb = Math.min(minLsb, g.bbox.xMin);
      minRsb = Math.min(minRsb, g.advance - g.bbox.xMax);
      xMaxExtent = Math.max(xMaxExtent, g.bbox.xMax);
    }
  }
  const w = new Writer();
  w.u32(0x00010000);
  w.i16(metrics.ascender);
  w.i16(metrics.descender);
  w.i16(metrics.lineGap);
  w.u16(advanceMax);
  w.i16(minLsb === 32767 ? 0 : minLsb);
  w.i16(minRsb === 32767 ? 0 : minRsb);
  w.i16(xMaxExtent === -32768 ? 0 : xMaxExtent);
  w.i16(1); // caretSlopeRise
  w.i16(0); // caretSlopeRun
  w.i16(0); // caretOffset
  w.i16(0);
  w.i16(0);
  w.i16(0);
  w.i16(0);
  w.i16(0); // metricDataFormat
  w.u16(glyphMetrics.length); // numberOfHMetrics
  return w.data();
}

function buildHmtx(glyphMetrics) {
  const w = new Writer();
  for (const g of glyphMetrics) {
    w.u16(g.advance);
    w.i16(g.bbox ? g.bbox.xMin : 0);
  }
  return w.data();
}

function buildMaxp(glyphData, glyphOrder) {
  let maxPts = 0;
  let maxContours = 0;
  for (const entry of glyphOrder) {
    const g = glyphData.get(entry);
    if (!g) continue;
    maxContours = Math.max(maxContours, g.contours.length);
    maxPts = Math.max(
      maxPts,
      g.contours.reduce((s, c) => s + c.length, 0)
    );
  }
  const w = new Writer();
  w.u32(0x00010000);
  w.u16(glyphOrder.length);
  w.u16(maxPts);
  w.u16(maxContours);
  w.u16(0); // maxCompositePoints
  w.u16(0); // maxCompositeContours
  w.u16(2); // maxZones
  w.u16(0); // maxTwilightPoints
  w.u16(0); // maxStorage
  w.u16(0); // maxFunctionDefs
  w.u16(0); // maxInstructionDefs
  w.u16(0); // maxStackElements
  w.u16(0); // maxSizeOfInstructions
  w.u16(0); // maxComponentElements
  w.u16(0); // maxComponentDepth
  return w.data();
}

function buildName(familyName) {
  const version = "Version 1.000";
  const psName = familyName.replace(/[^A-Za-z0-9]/g, "");
  const unique = `typogenesis:${psName}:2026`;
  const records = [
    [1, familyName], // family
    [2, "Regular"], // subfamily
    [3, unique], // unique id
    [4, familyName], // full name
    [5, version],
    [6, psName], // postscript name
    [0, "Bred in the browser at research.enigmeta.com/typogenesis"],
  ].sort((a, b) => a[0] - b[0]);

  const w = new Writer();
  w.u16(0); // format
  w.u16(records.length * 2); // mac + windows for each
  w.u16(6 + records.length * 2 * 12); // string storage offset
  const storage = [];
  let offset = 0;
  const recs = [];
  // Macintosh (platform 1, roman, english) — ASCII bytes
  for (const [id, str] of records) {
    const bytes = [...str].map((c) => c.charCodeAt(0) & 0x7f);
    recs.push([1, 0, 0, id, bytes.length, offset]);
    storage.push(bytes);
    offset += bytes.length;
  }
  // Windows (platform 3, encoding 1, en-US 0x409) — UTF-16BE
  for (const [id, str] of records) {
    const bytes = [];
    for (const c of str) {
      const cc = c.charCodeAt(0);
      bytes.push((cc >> 8) & 0xff, cc & 0xff);
    }
    recs.push([3, 1, 0x409, id, bytes.length, offset]);
    storage.push(bytes);
    offset += bytes.length;
  }
  recs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[3] - b[3]);
  for (const r of recs) {
    w.u16(r[0]);
    w.u16(r[1]);
    w.u16(r[2]);
    w.u16(r[3]);
    w.u16(r[4]);
    w.u16(r[5]);
  }
  for (const bytes of storage) w.bytes(bytes);
  return w.data();
}

function buildPost() {
  const w = new Writer();
  w.u32(0x00030000); // format 3: no glyph names
  w.i32(0); // italicAngle
  w.i16(-75); // underlinePosition
  w.i16(50); // underlineThickness
  w.u32(0); // isFixedPitch
  w.u32(0);
  w.u32(0);
  w.u32(0);
  w.u32(0);
  return w.data();
}

function buildOS2(metrics, glyphMetrics, weightClass, bbox) {
  const avg =
    Math.round(
      glyphMetrics.reduce((s, g) => s + g.advance, 0) / glyphMetrics.length
    ) || 500;
  const w = new Writer();
  w.u16(4); // version
  w.i16(avg);
  w.u16(weightClass);
  w.u16(5); // usWidthClass: medium
  w.u16(0); // fsType: installable
  w.i16(650);
  w.i16(700); // subscript/superscript sizes (x,y pairs follow)
  w.i16(0);
  w.i16(140);
  w.i16(650);
  w.i16(700);
  w.i16(0);
  w.i16(480);
  w.i16(50); // strikeout size
  w.i16(260); // strikeout position
  w.i16(0); // familyClass
  // panose: 10 bytes, all 0 = any
  for (let i = 0; i < 10; i++) w.u8(0);
  w.u32(1); // unicodeRange1: Basic Latin
  w.u32(0);
  w.u32(0);
  w.u32(0);
  w.tag("TGEN"); // vendor
  w.u16(0x0040); // fsSelection: REGULAR
  w.u16(0x0020); // first char (space)
  w.u16(0x2019); // last char (’)
  w.i16(metrics.ascender);
  w.i16(metrics.descender);
  w.i16(metrics.lineGap);
  w.u16(Math.max(bbox.yMax, metrics.ascender)); // usWinAscent
  w.u16(Math.max(-bbox.yMin, -metrics.descender)); // usWinDescent
  w.u32(1); // codePageRange1: Latin 1
  w.u32(0);
  w.i16(metrics.xHeight);
  w.i16(metrics.capHeight);
  w.u16(0); // defaultChar
  w.u16(0x0020); // breakChar
  w.u16(1); // maxContext
  return w.data();
}

// --- Assembly ---------------------------------------------------------------

// font: output of buildFont(); familyName: string. Returns Uint8Array (.ttf).
export function compileTTF(font, familyName) {
  const { glyphs, metrics, P } = font;

  // Glyph order: .notdef first, then charset sorted by codepoint.
  const chars = [...glyphs.keys()].sort(
    (a, b) => a.codePointAt(0) - b.codePointAt(0)
  );
  const glyphOrder = [".notdef", ...chars];

  // .notdef: hollow rectangle.
  const nd = {
    advance: 500,
    contours: [
      [
        { x: 60, y: 0 },
        { x: 440, y: 0 },
        { x: 440, y: 660 },
        { x: 60, y: 660 },
      ],
      [
        { x: 110, y: 50 },
        { x: 110, y: 610 },
        { x: 390, y: 610 },
        { x: 390, y: 50 },
      ],
    ],
    bbox: { xMin: 60, yMin: 0, xMax: 440, yMax: 660 },
  };

  const glyphData = new Map([[".notdef", nd]]);
  for (const ch of chars) glyphData.set(ch, glyphs.get(ch));

  const charToGid = new Map();
  chars.forEach((ch, i) => charToGid.set(ch.codePointAt(0), i + 1));

  // Global bbox
  const bbox = { xMin: 32767, yMin: 32767, xMax: -32768, yMax: -32768 };
  for (const entry of glyphOrder) {
    const g = glyphData.get(entry);
    if (!g || !g.bbox) continue;
    bbox.xMin = Math.min(bbox.xMin, g.bbox.xMin);
    bbox.yMin = Math.min(bbox.yMin, g.bbox.yMin);
    bbox.xMax = Math.max(bbox.xMax, g.bbox.xMax);
    bbox.yMax = Math.max(bbox.yMax, g.bbox.yMax);
  }

  const glyphMetrics = glyphOrder.map((entry) => {
    const g = glyphData.get(entry);
    return { advance: g.advance, bbox: g.bbox };
  });

  const { glyf, offsets } = buildGlyf(glyphOrder, glyphData);
  const weightClass = Math.round(300 + P.genome.weight * 500);

  const tables = {
    "OS/2": buildOS2(metrics, glyphMetrics, weightClass, bbox),
    cmap: buildCmap(charToGid),
    glyf,
    head: buildHead(bbox, metrics.upm, 1),
    hhea: buildHhea(metrics, glyphMetrics, bbox),
    hmtx: buildHmtx(glyphMetrics),
    loca: buildLoca(offsets),
    maxp: buildMaxp(glyphData, glyphOrder),
    name: buildName(familyName),
    post: buildPost(),
  };

  const tags = Object.keys(tables).sort();
  const numTables = tags.length;

  let searchRange = 16;
  let entrySelector = 0;
  while (searchRange * 2 <= numTables * 16) {
    searchRange *= 2;
    entrySelector++;
  }

  const w = new Writer();
  w.u32(0x00010000); // sfnt version: TrueType
  w.u16(numTables);
  w.u16(searchRange);
  w.u16(entrySelector);
  w.u16(numTables * 16 - searchRange);

  let offset = 12 + numTables * 16;
  const entries = [];
  for (const tag of tags) {
    const data = tables[tag];
    entries.push({ tag, checksum: checksum(data), offset, length: data.length });
    offset += Math.ceil(data.length / 4) * 4;
  }
  for (const e of entries) {
    w.tag(e.tag);
    w.u32(e.checksum);
    w.u32(e.offset);
    w.u32(e.length);
  }
  let headOffset = 0;
  for (const e of entries) {
    if (e.tag === "head") headOffset = w.len + 8;
    w.bytes(tables[e.tag]);
    w.pad4();
  }

  const data = w.data();
  // Patch head.checkSumAdjustment.
  const total = checksum(data);
  const adj = (0xb1b0afba - total) >>> 0;
  data[headOffset] = (adj >>> 24) & 0xff;
  data[headOffset + 1] = (adj >>> 16) & 0xff;
  data[headOffset + 2] = (adj >>> 8) & 0xff;
  data[headOffset + 3] = adj & 0xff;
  return data;
}

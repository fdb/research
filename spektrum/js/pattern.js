/*
 * pattern.js — the functional core of spektrum's minimal station.
 *
 * A Pattern is a pure function of time: query(begin, end) returns the
 * events ("haps") whose onsets fall inside that span. Time is measured
 * in cycles. Everything else — mini-notation, transformations, controls —
 * is built by composing these functions. No scheduler, no mutable state,
 * no I/O in this file.
 *
 * This is deliberately the Tidal/Strudel model, rebuilt small enough to
 * read in one sitting (the point of the "primitives" end of the spectrum).
 */

// ---------------------------------------------------------------- helpers

const mod = (a, n) => ((a % n) + n) % n;

// Deterministic pseudo-random in [0,1) from a time value + seed.
// Live coding needs randomness that is *repeatable per cycle position*,
// so patterns sound the same on every loop and on every machine.
export function timeRand(t, seed = 0) {
  let x = Math.imul((t * 536870912) | 0, 668265263) ^ Math.imul(seed + 1, 2246822519);
  x = Math.imul(x ^ (x >>> 15), 2654435761);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ core

export class Pattern {
  constructor(query) {
    this.query = query; // (begin, end) => [{b, e, v}]
  }

  // --- structure ---

  withTime(fout, fin) {
    return new Pattern((b, e) =>
      this.query(fin(b), fin(e)).map((h) => ({ ...h, b: fout(h.b), e: fout(h.e) }))
    );
  }

  withValue(f) {
    return new Pattern((b, e) => this.query(b, e).map((h) => ({ ...h, v: f(h.v) })));
  }

  filterHaps(f) {
    return new Pattern((b, e) => this.query(b, e).filter(f));
  }

  fast(n) {
    n = num(n);
    if (n === 0) return silence;
    return this.withTime((t) => t / n, (t) => t * n);
  }

  slow(n) {
    return this.fast(1 / num(n));
  }

  early(t) {
    t = num(t);
    return this.withTime((x) => x - t, (x) => x + t);
  }

  late(t) {
    return this.early(-num(t));
  }

  // Reverse each cycle in place.
  rev() {
    return new Pattern((b, e) => {
      const out = [];
      for (let c = Math.floor(b); c < e; c++) {
        const refl = (t) => 2 * c + 1 - t;
        for (const h of this.query(Math.max(refl(Math.min(e, c + 1)), c), Math.min(refl(Math.max(b, c)), c + 1))) {
          const hb = refl(h.e), he = refl(h.b);
          if (hb >= b && hb < e) out.push({ ...h, b: hb, e: he });
        }
      }
      return out;
    });
  }

  // Shift start point each cycle: iter(4) plays cycle offsets 0,1/4,2/4,3/4.
  iter(n) {
    n = num(n);
    return slowcat(...Array.from({ length: n }, (_, i) => this.early(i / n)));
  }

  // Apply f every nth cycle.
  every(n, f) {
    n = num(n);
    return slowcat(f(this), ...Array.from({ length: n - 1 }, () => this));
  }

  // Superimpose a transformed, time-shifted copy.
  off(t, f) {
    return stack(this, f(this.late(t)));
  }

  // Repeat each event n times within its span.
  ply(n) {
    n = num(n);
    return new Pattern((b, e) => {
      const out = [];
      // widen the query to catch parents whose onset precedes the span
      for (const h of this.query(Math.floor(b), e)) {
        const w = (h.e - h.b) / n;
        for (let i = 0; i < n; i++) {
          const hb = h.b + i * w;
          if (hb >= b && hb < e) out.push({ b: hb, e: hb + w, v: h.v });
        }
      }
      return out;
    });
  }

  // Randomly drop events with probability p (deterministic per position).
  degradeBy(p = 0.5, seed = 7) {
    return this.filterHaps((h) => timeRand(h.b, seed) >= p);
  }

  degrade() {
    return this.degradeBy(0.5);
  }

  // Apply f with probability p per cycle.
  sometimesBy(p, f) {
    return new Pattern((b, e) => {
      const out = [];
      for (let c = Math.floor(b); c < e; c++) {
        const pat = timeRand(c, 99) < p ? f(this) : this;
        out.push(...pat.query(Math.max(b, c), Math.min(e, c + 1)));
      }
      return out;
    });
  }

  sometimes(f) { return this.sometimesBy(0.5, f); }
  often(f)     { return this.sometimesBy(0.75, f); }
  rarely(f)    { return this.sometimesBy(0.25, f); }

  // Stereo split: original left, transformed right.
  jux(f) {
    return stack(this.pan(0.1), f(this).pan(0.9));
  }

  // Take structure from a boolean pattern, values from this.
  struct(boolPat) {
    boolPat = reify(boolPat);
    const self = this;
    return new Pattern((b, e) =>
      boolPat.query(b, e)
        .filter((h) => truthy(h.v))
        .map((h) => {
          const src = self.query(h.b, h.b + 1e-9);
          const inside = src.length ? src : self.query(Math.floor(h.b), h.b + 1e-9);
          return inside.length ? { b: h.b, e: h.e, v: inside[inside.length - 1].v } : null;
        })
        .filter(Boolean)
    );
  }

  // Euclidean rhythm on this pattern's values.
  euclid(k, n, rot = 0) {
    const bools = bjorklund(num(k), num(n));
    const rotated = bools.map((_, i) => bools[mod(i + num(rot), bools.length)]);
    return this.struct(seq(...rotated));
  }

  // Map a 0..1 signal into [lo, hi].
  range(lo, hi) {
    return this.withValue((v) => lo + v * (hi - lo));
  }

  rangex(lo, hi) {
    return this.withValue((v) => lo * Math.pow(hi / lo, v));
  }

  // Quantize continuous values.
  round() { return this.withValue((v) => Math.round(v)); }

  // Turn degree values into midi notes via a scale (post-hoc, see scale()).
  scale(name) {
    return this.withValue((v) => {
      const obj = typeof v === "object" ? { ...v } : { note: v };
      const deg = obj.note ?? 0;
      obj.note = scaleDegree(deg, name);
      return obj;
    });
  }

  // First value in cycle 0 — used to sample control patterns.
  firstValue(at = 0) {
    const hs = this.query(at, at + 1e-9);
    if (hs.length) return hs[0].v;
    const wide = this.query(Math.floor(at), at + 1e-9);
    return wide.length ? wide[wide.length - 1].v : undefined;
  }
}

const truthy = (v) => v === true || v === 1 || v === "x" || v === "t";

function num(n) {
  if (n instanceof Pattern) {
    const v = n.firstValue();
    return typeof v === "number" ? v : parseFloat(v);
  }
  return typeof n === "string" ? parseFloat(n) : n;
}

// -------------------------------------------------------------- builders

export const silence = new Pattern(() => []);

export function pure(v) {
  return new Pattern((b, e) => {
    const out = [];
    for (let c = Math.floor(b); c < e; c++) {
      if (c >= b) out.push({ b: c, e: c + 1, v });
    }
    return out;
  });
}

// Turn strings (mini-notation), numbers and arrays into Patterns.
export function reify(x) {
  if (x instanceof Pattern) return x;
  if (Array.isArray(x)) return seq(...x);
  if (typeof x === "string") return mini(x);
  return pure(x);
}

export function stack(...xs) {
  const pats = xs.map(reify);
  return new Pattern((b, e) => pats.flatMap((p) => p.query(b, e)));
}

// One pattern per cycle, in rotation.
export function slowcat(...xs) {
  const pats = xs.map(reify);
  const n = pats.length;
  if (n === 0) return silence;
  return new Pattern((b, e) => {
    const out = [];
    for (let c = Math.floor(b); c < e; c++) {
      const pat = pats[mod(c, n)];
      const offset = c - Math.floor(c / n);
      out.push(
        ...pat
          .query(Math.max(b, c) - offset, Math.min(e, c + 1) - offset)
          .map((h) => ({ ...h, b: h.b + offset, e: h.e + offset }))
      );
    }
    return out;
  });
}

export const cat = slowcat;

// All patterns squeezed into a single cycle.
export function seq(...xs) {
  if (xs.length === 0) return silence;
  return slowcat(...xs).fast(xs.length);
}

export const fastcat = seq;

// Weighted sequence: timecat([3, a], [1, b]) — a gets 3/4 of the cycle.
export function timecat(...pairs) {
  const total = pairs.reduce((s, [w]) => s + w, 0);
  let pos = 0;
  const parts = pairs.map(([w, x]) => {
    const p = reify(x).fast(total / w).late(pos / total);
    pos += w;
    // clip to the slot so inner cycles don't leak
    const b0 = (pos - w) / total, e0 = pos / total;
    return p.filterHaps((h) => mod(h.b, 1) >= b0 - 1e-9 && mod(h.b, 1) < e0 - 1e-9);
  });
  return stack(...parts);
}

// ------------------------------------------------------------- signals

export function signal(f) {
  return new Pattern((b, e) => [{ b, e, v: f((b + e) / 2) }]);
}

export const sine = signal((t) => (Math.sin(2 * Math.PI * t) + 1) / 2);
export const cosine = signal((t) => (Math.cos(2 * Math.PI * t) + 1) / 2);
export const saw = signal((t) => mod(t, 1));
export const isaw = signal((t) => 1 - mod(t, 1));
export const tri = signal((t) => 1 - Math.abs(1 - mod(t * 2, 2)));
export const square = signal((t) => (mod(t, 1) < 0.5 ? 0 : 1));
export const rand = signal((t) => timeRand(t, 3));

export function irand(n) {
  return rand.withValue((v) => Math.floor(v * n));
}

export function perlin() {
  // cheap value noise: cosine-interpolated timeRand at integer lattice
  return signal((t) => {
    const i = Math.floor(t), f = t - i;
    const a = timeRand(i, 11), b = timeRand(i + 1, 11);
    const u = (1 - Math.cos(f * Math.PI)) / 2;
    return a * (1 - u) + b * u;
  });
}

export function choose(...vals) {
  return irand(vals.length).withValue((i) => vals[i]);
}

// ------------------------------------------------------- euclidean rhythm

export function bjorklund(k, n) {
  if (k <= 0 || n <= 0 || k > n) return Array(Math.max(n, 0)).fill(false);
  let a = Array.from({ length: k }, () => [true]);
  let b = Array.from({ length: n - k }, () => [false]);
  while (b.length > 1) {
    const m = Math.min(a.length, b.length);
    const next = [];
    for (let i = 0; i < m; i++) next.push([...a[i], ...b[i]]);
    const restA = a.slice(m), restB = b.slice(m);
    a = next;
    b = restA.length ? restA : restB;
  }
  return [...a, ...b].flat();
}

// ----------------------------------------------------------------- notes

const NOTE_BASE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export function noteToMidi(name) {
  if (typeof name === "number") return name;
  const m = /^([a-gA-G])([#sbf]?)(-?\d+)?$/.exec(String(name).trim());
  if (!m) return NaN;
  let v = NOTE_BASE[m[1].toLowerCase()];
  if (m[2] === "#" || m[2] === "s") v += 1;
  if (m[2] === "b" || m[2] === "f") v -= 1;
  const oct = m[3] === undefined ? 3 : parseInt(m[3], 10);
  return v + (oct + 1) * 12;
}

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  penta: [0, 2, 4, 7, 9],
  minpenta: [0, 3, 5, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export function scaleDegree(deg, name) {
  // name like "c3 minor" | "minor" (root defaults to c3)
  const parts = String(name).trim().split(/\s+/);
  const scaleName = parts.length > 1 ? parts[1] : parts[0];
  const root = parts.length > 1 ? noteToMidi(parts[0]) : 48;
  const steps = SCALES[scaleName] || SCALES.minor;
  const d = Math.round(typeof deg === "number" ? deg : parseFloat(deg) || 0);
  const oct = Math.floor(d / steps.length);
  return root + steps[mod(d, steps.length)] + oct * 12;
}

// ---------------------------------------------------------- mini-notation
//
//   "bd sn [hh hh] <a b> ~ bd*2 bd(3,8) bd!2 hh? bd:3"
//
// A tiny recursive-descent parser producing Patterns directly.

export function mini(src) {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (t) => {
    const tok = next();
    if (!tok || tok.t !== t) throw new Error(`mini: expected ${t} at "${src}"`);
    return tok;
  };

  function parseSeq(stopSet) {
    const groups = [[]]; // comma-separated → stack
    while (peek() && !stopSet.has(peek().t)) {
      if (peek().t === ",") { next(); groups.push([]); continue; }
      groups[groups.length - 1].push(parseTerm());
    }
    const pats = groups.map((terms) => {
      const flat = [];
      for (const t of terms) {
        for (let i = 0; i < t.repeat; i++) flat.push(t);
      }
      if (flat.length === 0) return silence;
      if (flat.every((t) => t.weight === 1)) return seq(...flat.map((t) => t.pat));
      return timecat(...flat.map((t) => [t.weight, t.pat]));
    });
    return pats.length === 1 ? pats[0] : stack(...pats);
  }

  function parseTerm() {
    let pat, weight = 1, repeat = 1;
    const tok = next();
    if (!tok) throw new Error(`mini: unexpected end in "${src}"`);
    if (tok.t === "[") {
      pat = parseSeq(new Set(["]"]));
      expect("]");
    } else if (tok.t === "<") {
      const terms = [];
      while (peek() && peek().t !== ">") terms.push(parseTerm());
      expect(">");
      pat = slowcat(...terms.map((t) => t.pat));
    } else if (tok.t === "~") {
      pat = silence;
    } else if (tok.t === "word" || tok.t === "num") {
      pat = pure(tok.v);
    } else {
      throw new Error(`mini: unexpected "${tok.t}" in "${src}"`);
    }
    // modifiers
    for (;;) {
      const m = peek();
      if (!m) break;
      if (m.t === "*") { next(); pat = pat.fast(numTok(next(), src)); }
      else if (m.t === "/") { next(); pat = pat.slow(numTok(next(), src)); }
      else if (m.t === "!") { next(); repeat = numTok(next(), src); }
      else if (m.t === "@") { next(); weight = numTok(next(), src); }
      else if (m.t === "?") { next(); pat = pat.degrade(); }
      else if (m.t === "(") {
        next();
        const k = numTok(next(), src);
        expect(",");
        const n = numTok(next(), src);
        let rot = 0;
        if (peek() && peek().t === ",") { next(); rot = numTok(next(), src); }
        expect(")");
        pat = pat.euclid(k, n, rot);
      } else break;
    }
    return { pat, weight, repeat };
  }

  const result = parseSeq(new Set([]));
  if (pos < tokens.length) throw new Error(`mini: trailing input in "${src}"`);
  return result;
}

function numTok(tok, src) {
  if (!tok || (tok.t !== "num" && tok.t !== "word"))
    throw new Error(`mini: expected number in "${src}"`);
  const n = parseFloat(tok.v);
  if (Number.isNaN(n)) throw new Error(`mini: expected number, got "${tok.v}"`);
  return n;
}

function tokenize(src) {
  const out = [];
  const re = /\s+|(-?(?:\d+\.?\d*|\.\d+))|([a-zA-Z][\w#.:-]*)|([\[\]<>~*\/!@?(),])/g;
  let m, last = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) throw new Error(`mini: bad character "${src[last]}" in "${src}"`);
    last = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: "num", v: parseFloat(m[1]) });
    else if (m[2] !== undefined) out.push({ t: "word", v: m[2] });
    else if (m[3] !== undefined) out.push({ t: m[3] });
  }
  if (last < src.length) throw new Error(`mini: bad character "${src[last]}" in "${src}"`);
  return out;
}

// ---------------------------------------------------------------- controls
//
// Control patterns carry plain objects merged into engine events.
// Structure comes from the left: p.gain("1 .5") samples the gain pattern
// at each of p's onsets. Predictable, and enough for performance.

const asObj = (key) => (v) => {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) return v;
  return { [key]: v };
};

function makeControl(key, coerce = (x) => x) {
  return (x) => reify(x).withValue((v) => asObj(key)(coerce(v)));
}

const setter = (key, coerce = (x) => x) =>
  function (x) {
    const ctrl = reify(x);
    return new Pattern((b, e) =>
      this.query(b, e).map((h) => {
        const mid = (h.b + h.e) / 2;
        let cv = ctrl.firstValue(h.b);
        if (cv === undefined) cv = ctrl.firstValue(mid);
        if (cv === undefined) return h;
        if (typeof cv === "object") cv = cv[key] ?? cv;
        const base = typeof h.v === "object" && h.v !== null ? h.v : { value: h.v };
        return { ...h, v: { ...base, [key]: coerce(cv) } };
      })
    );
  };

// name: [coercion]
const CONTROLS = {
  s: (v) => {
    if (typeof v !== "string") return v;
    const [name, n] = v.split(":");
    return n !== undefined ? { s: name, n: parseFloat(n) } : name;
  },
  n: Number,
  note: (v) => noteToMidi(v),
  gain: Number,
  pan: Number,
  speed: Number,
  cutoff: Number,
  resonance: Number,
  attack: Number,
  decay: Number,
  sustain: Number,
  release: Number,
  delay: Number,
  room: Number,
  legato: Number,
  detune: Number,
  fmh: Number,   // fm harmonicity ratio
  fmi: Number,   // fm modulation index
  crush: Number, // bit depth 1..16
  coarse: Number, // sample-rate divide
};

export const controls = {};
for (const [key, coerce] of Object.entries(CONTROLS)) {
  // s("bd:3") needs its object result spread, not nested
  if (key === "s") {
    controls.s = (x) =>
      reify(x).withValue((v) => {
        const c = CONTROLS.s(v);
        return typeof c === "object" ? c : { s: c };
      });
  } else {
    controls[key] = makeControl(key, coerce);
  }
  Pattern.prototype[key] = setter(key, key === "s" ? (x) => x : coerce);
}

// s() as a method needs the :n split too
Pattern.prototype.s = function (x) {
  const ctrl = reify(x);
  return new Pattern((b, e) =>
    this.query(b, e).map((h) => {
      let cv = ctrl.firstValue(h.b) ?? ctrl.firstValue((h.b + h.e) / 2);
      if (cv === undefined) return h;
      const c = CONTROLS.s(typeof cv === "object" ? cv.s : cv);
      const add = typeof c === "object" ? c : { s: c };
      const base = typeof h.v === "object" && h.v !== null ? h.v : { value: h.v };
      return { ...h, v: { ...base, ...add } };
    })
  );
};

// aliases
export const lpf = controls.cutoff;
Pattern.prototype.lpf = Pattern.prototype.cutoff;
export const sound = controls.s;

export const { s, n, note, gain, pan, speed, cutoff, resonance, attack, decay,
  sustain, release, delay, room, legato, detune, fmh, fmi, crush, coarse } = controls;

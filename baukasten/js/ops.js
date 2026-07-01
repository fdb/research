// Op registry — the single source of truth for every op the tool knows.
//
// Werkkzeug model: a *stack* is a named list of ops evaluated top to bottom.
// Generators start a value, filters transform the value above, combiners pull
// in another stack by reference (no wires — refs are dropdowns).
//
// Param kinds:
//   f      float slider          (min, max, step)
//   i      int slider
//   enum   option list           (options: [...])
//   ref    reference to another stack on a given page
//   pal    iq cosine palette     (stored as 12 floats [a3,b3,c3,d3])
//   expr   animatable float — number OR expression string OR keyframe track
//          (only meaningful on scene/post ops, which are evaluated per frame)

export const PAGES = ['tex', 'mesh', 'scene', 'post', 'music', 'seq'];

const f = (key, label, def, min, max, step = 0.01) =>
  ({ key, label, def, min, max, step, kind: 'f' });
const i = (key, label, def, min, max) =>
  ({ key, label, def, min, max, step: 1, kind: 'i' });
const en = (key, label, def, options) => ({ key, label, def, options, kind: 'enum' });
const ref = (key, label, page) => ({ key, label, def: '', page, kind: 'ref' });
const pal = (key, label, def) => ({ key, label, def, kind: 'pal' });
const ex = (key, label, def, min, max, step = 0.01) =>
  ({ key, label, def, min, max, step, kind: 'expr' });

// A few iq cosine palettes (a, b, c, d — each vec3), used as presets.
export const PALETTES = {
  spectrum: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 1.0, 1.0, 0.0, 0.33, 0.67],
  ember: [0.5, 0.4, 0.3, 0.6, 0.4, 0.2, 1.0, 1.0, 1.0, 0.0, 0.1, 0.2],
  abyss: [0.05, 0.08, 0.15, 0.10, 0.15, 0.25, 1.0, 1.0, 1.0, 0.6, 0.55, 0.5],
  verdigris: [0.45, 0.55, 0.5, 0.3, 0.35, 0.3, 1.0, 1.0, 0.8, 0.1, 0.3, 0.4],
  bone: [0.55, 0.52, 0.48, 0.45, 0.42, 0.38, 1.0, 1.0, 1.0, 0.0, 0.02, 0.05],
  neon: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2.0, 1.0, 0.0, 0.5, 0.2, 0.25],
  amber: [0.6, 0.45, 0.25, 0.5, 0.4, 0.2, 1.0, 0.9, 0.8, 0.0, 0.12, 0.35],
  glacier: [0.35, 0.45, 0.55, 0.35, 0.35, 0.35, 1.0, 1.0, 1.0, 0.5, 0.6, 0.7],
};

export function paletteColor(p, t) {
  const c = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    c[k] = Math.min(1, Math.max(0, p[k] + p[3 + k] * Math.cos(2 * Math.PI * (p[6 + k] * t + p[9 + k]))));
  }
  return c;
}

// --- Texture ops (evaluated in WASM; opcode + fixed param order) -----------

export const TEX_OPS = {
  solid: {
    label: 'solid', cat: 'generate', opcode: 1,
    params: [f('r', 'red', 0.5, 0, 1), f('g', 'green', 0.5, 0, 1), f('b', 'blue', 0.5, 0, 1), f('a', 'alpha', 1, 0, 1)],
  },
  noise: {
    label: 'noise', cat: 'generate', opcode: 2,
    params: [
      f('scale', 'scale', 4, 1, 64, 1),
      i('octaves', 'octaves', 5, 1, 8),
      f('gain', 'gain', 0.5, 0.1, 0.9),
      i('seed', 'seed', 1, 0, 99),
      en('type', 'type', 0, ['fbm', 'ridged', 'turbulence']),
    ],
  },
  shape: {
    label: 'shape', cat: 'generate', opcode: 3,
    params: [
      en('type', 'type', 0, ['circle', 'ring', 'box', 'gradient', 'radial']),
      f('cx', 'center x', 0.5, -0.5, 1.5),
      f('cy', 'center y', 0.5, -0.5, 1.5),
      f('w', 'width', 0.3, 0.001, 2),
      f('h', 'height', 0.3, 0.001, 2),
      f('feather', 'feather', 0.05, 0.001, 1),
      f('rot', 'rotate', 0, -3.14159, 3.14159),
    ],
  },
  cells: {
    label: 'cells', cat: 'generate', opcode: 4,
    params: [f('scale', 'scale', 8, 1, 64, 1), i('seed', 'seed', 1, 0, 99), f('jitter', 'jitter', 1, 0, 1)],
  },
  voronoi: {
    label: 'voronoi', cat: 'generate', opcode: 5,
    params: [
      f('scale', 'scale', 8, 1, 64, 1), i('seed', 'seed', 1, 0, 99), f('jitter', 'jitter', 1, 0, 1),
      en('mode', 'mode', 0, ['edges', 'flat cells', 'shaded cells']),
    ],
  },
  bricks: {
    label: 'bricks', cat: 'generate', opcode: 6,
    params: [
      f('nx', 'columns', 4, 1, 32, 1), f('ny', 'rows', 8, 1, 64, 1),
      f('mortar', 'mortar', 0.04, 0.001, 0.4), f('bevel', 'bevel', 0.03, 0.001, 0.4),
      f('shift', 'row shift', 0.5, 0, 1), i('seed', 'seed', 1, 0, 99),
    ],
  },
  colorize: {
    label: 'colorize', cat: 'filter', opcode: 16,
    params: [pal('pal', 'palette', PALETTES.spectrum.slice())],
  },
  adjust: {
    label: 'adjust', cat: 'filter', opcode: 17,
    params: [f('brightness', 'brightness', 0, -1, 1), f('contrast', 'contrast', 1, 0, 4), f('gamma', 'gamma', 1, 0.1, 4)],
  },
  invert: { label: 'invert', cat: 'filter', opcode: 18, params: [] },
  transform: {
    label: 'transform', cat: 'filter', opcode: 19,
    params: [
      f('sx', 'scale x', 1, 0.1, 8), f('sy', 'scale y', 1, 0.1, 8),
      f('rot', 'rotate', 0, -3.14159, 3.14159),
      f('ox', 'offset x', 0, -1, 1), f('oy', 'offset y', 0, -1, 1),
    ],
  },
  blur: {
    label: 'blur', cat: 'filter', opcode: 20,
    params: [f('radius', 'radius', 2, 0, 32, 1), i('passes', 'passes', 2, 1, 4)],
  },
  distort: {
    label: 'distort', cat: 'filter', opcode: 21,
    params: [f('amount', 'amount', 0.1, 0, 1), f('scale', 'scale', 4, 1, 32, 1), i('seed', 'seed', 1, 0, 99)],
  },
  blend: {
    label: 'blend', cat: 'combine', opcode: 32,
    params: [
      ref('with', 'with stack', 'tex'),
      en('mode', 'mode', 1, ['mix', 'add', 'multiply', 'screen', 'overlay', 'min', 'max', 'subtract']),
      f('amount', 'amount', 1, 0, 1),
    ],
  },
};

// --- Mesh ops ---------------------------------------------------------------

export const MESH_OPS = {
  cube: {
    label: 'cube', cat: 'generate', opcode: 1,
    params: [
      f('sx', 'size x', 1, 0.01, 10), f('sy', 'size y', 1, 0.01, 10), f('sz', 'size z', 1, 0.01, 10),
      i('seg', 'segments', 1, 1, 24),
      f('_p4', '', 0, 0, 0), f('_p5', '', 0, 0, 0), // reserved
    ],
    hidden: ['_p4', '_p5'],
  },
  sphere: {
    label: 'sphere', cat: 'generate', opcode: 2,
    params: [f('r', 'radius', 0.5, 0.01, 10), i('su', 'segments u', 24, 3, 96), i('sv', 'segments v', 16, 2, 96)],
  },
  cylinder: {
    label: 'cylinder', cat: 'generate', opcode: 3,
    params: [
      f('r', 'radius', 0.5, 0.01, 10), f('h', 'height', 1, 0.01, 20),
      i('su', 'segments u', 24, 3, 96), i('sv', 'segments v', 1, 1, 32),
      en('caps', 'caps', 1, ['open', 'capped']),
    ],
  },
  torus: {
    label: 'torus', cat: 'generate', opcode: 4,
    params: [f('R', 'ring radius', 0.6, 0.01, 10), f('r', 'tube radius', 0.2, 0.005, 5), i('su', 'segments u', 32, 3, 96), i('sv', 'segments v', 16, 3, 96)],
  },
  grid: {
    label: 'grid', cat: 'generate', opcode: 5,
    params: [f('w', 'width', 4, 0.1, 100), f('d', 'depth', 4, 0.1, 100), i('su', 'segments x', 16, 1, 128), i('sv', 'segments z', 16, 1, 128)],
  },
  transform: {
    label: 'transform', cat: 'filter', opcode: 16,
    params: [
      f('tx', 'move x', 0, -10, 10), f('ty', 'move y', 0, -10, 10), f('tz', 'move z', 0, -10, 10),
      f('rx', 'rotate x', 0, -3.14159, 3.14159), f('ry', 'rotate y', 0, -3.14159, 3.14159), f('rz', 'rotate z', 0, -3.14159, 3.14159),
      f('sx', 'scale x', 1, 0.01, 10), f('sy', 'scale y', 1, 0.01, 10), f('sz', 'scale z', 1, 0.01, 10),
    ],
  },
  displace: {
    label: 'displace', cat: 'filter', opcode: 17,
    params: [f('amount', 'amount', 0.1, 0, 2), f('scale', 'scale', 2, 0.1, 16), i('octaves', 'octaves', 3, 1, 6), i('seed', 'seed', 1, 0, 99)],
  },
  twist: {
    label: 'twist', cat: 'filter', opcode: 18,
    params: [f('amount', 'amount', 0.5, -6.28, 6.28)],
  },
  array: {
    label: 'array', cat: 'filter', opcode: 19,
    params: [
      en('mode', 'mode', 0, ['linear', 'radial']),
      i('count', 'count', 4, 1, 64),
      f('p0', 'dx / radius', 1, -20, 20), f('p1', 'dy', 0, -20, 20), f('p2', 'dz', 0, -20, 20),
    ],
  },
  merge: {
    label: 'merge', cat: 'combine', opcode: 32,
    params: [ref('with', 'with stack', 'mesh')],
  },
};

// --- Scene ops (evaluated per frame in JS; params are animatable) -----------

export const SCENE_OPS = {
  camera: {
    label: 'camera', cat: 'scene',
    params: [
      ex('px', 'pos x', 0, -50, 50), ex('py', 'pos y', 2, -50, 50), ex('pz', 'pos z', 6, -50, 50),
      ex('tx', 'target x', 0, -50, 50), ex('ty', 'target y', 0, -50, 50), ex('tz', 'target z', 0, -50, 50),
      ex('fov', 'fov', 60, 10, 140, 1), ex('roll', 'roll', 0, -3.14, 3.14),
      ex('shake', 'shake', 0, 0, 1),
    ],
  },
  light: {
    label: 'light', cat: 'scene',
    params: [
      ex('azimuth', 'azimuth', 0.8, -3.14159, 3.14159), ex('elevation', 'elevation', 0.9, 0, 1.5),
      ex('intensity', 'intensity', 1, 0, 3), ex('ambient', 'ambient', 0.15, 0, 1),
      ex('rim', 'rim light', 0.4, 0, 2),
    ],
  },
  env: {
    label: 'environment', cat: 'scene',
    params: [
      pal('pal', 'sky palette', PALETTES.abyss.slice()),
      ex('skyPos', 'sky tone', 0.5, 0, 1),
      ex('fog', 'fog density', 0.02, 0, 0.5),
      ex('fogPos', 'fog tone', 0.4, 0, 1),
    ],
  },
  object: {
    label: 'object', cat: 'scene',
    params: [
      ref('mesh', 'mesh', 'mesh'),
      ref('tex', 'texture', 'tex'),
      ex('px', 'pos x', 0, -50, 50), ex('py', 'pos y', 0, -50, 50), ex('pz', 'pos z', 0, -50, 50),
      ex('rx', 'rot x', 0, -6.28, 6.28), ex('ry', 'rot y', 0, -6.28, 6.28), ex('rz', 'rot z', 0, -6.28, 6.28),
      ex('scale', 'scale', 1, 0.01, 50),
      ex('emissive', 'emissive', 0, 0, 4),
      ex('gloss', 'gloss', 0.4, 0, 1),
    ],
  },
};

// --- Post ops (fullscreen passes, JS/GL; params animatable) -----------------

export const POST_OPS = {
  bloom: {
    label: 'bloom', cat: 'post',
    params: [ex('threshold', 'threshold', 0.6, 0, 1), ex('intensity', 'intensity', 0.8, 0, 4), ex('radius', 'radius', 1, 0.2, 4)],
  },
  grade: {
    label: 'grade', cat: 'post',
    params: [pal('pal', 'palette', PALETTES.spectrum.slice()), ex('amount', 'amount', 0.5, 0, 1), ex('shift', 'shift', 0, -1, 1)],
  },
  lut: {
    label: 'lut', cat: 'post',
    params: [ref('tex', 'lut texture', 'tex'), ex('amount', 'amount', 1, 0, 1)],
  },
  vignette: {
    label: 'vignette', cat: 'post',
    params: [ex('amount', 'amount', 0.5, 0, 1), ex('size', 'size', 0.75, 0.2, 1.5)],
  },
  grain: {
    label: 'grain', cat: 'post',
    params: [ex('amount', 'amount', 0.08, 0, 0.5)],
  },
  aberration: {
    label: 'aberration', cat: 'post',
    params: [ex('amount', 'amount', 0.003, 0, 0.03, 0.0005)],
  },
  fade: {
    label: 'fade', cat: 'post',
    params: [ex('amount', 'amount', 0, 0, 1), en('to', 'to', 0, ['black', 'white'])],
  },
};

export const OPS_BY_PAGE = { tex: TEX_OPS, mesh: MESH_OPS, scene: SCENE_OPS, post: POST_OPS };

export function opDef(page, type) {
  return OPS_BY_PAGE[page]?.[type];
}

export function makeOp(page, type) {
  const def = opDef(page, type);
  const params = {};
  for (const p of def.params) {
    params[p.key] = Array.isArray(p.def) ? p.def.slice() : p.def;
  }
  return { type, params, enabled: true };
}

// Serialize a tex/mesh stack (list of ops) into the flat f32 command stream
// the WASM engine consumes. Combiner refs are inlined recursively (werkkzeug
// "load op" semantics), guarded against cycles.
export function serializeStack(page, stack, resolveRef, visited = new Set()) {
  const defs = OPS_BY_PAGE[page];
  const out = [];
  for (const op of stack.ops) {
    if (op.enabled === false) continue;
    const def = defs[op.type];
    if (!def || def.opcode === undefined) continue;
    // combiners first inline their referenced stack, so it sits on top
    const refParam = def.params.find((p) => p.kind === 'ref');
    if (refParam) {
      const target = resolveRef(page, op.params[refParam.key]);
      if (!target || visited.has(target.id)) continue; // skip broken/cyclic refs
      visited.add(target.id);
      out.push(...serializeStack(page, target, resolveRef, visited));
      visited.delete(target.id);
    }
    const values = [];
    for (const p of def.params) {
      if (p.kind === 'ref') continue;
      const v = op.params[p.key];
      if (p.kind === 'pal') values.push(...v);
      else values.push(typeof v === 'number' ? v : (p.def ?? 0));
    }
    out.push(def.opcode, values.length, ...values);
  }
  return out;
}

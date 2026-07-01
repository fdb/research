// Tiny expression language for animatable params.
//
// A param value can be:
//   number                     — constant
//   "sin(b*pi)*2 + kick"       — expression, recompiled once, cached
//   { kf: [[beat, value, ease], ...] }  — keyframe track (ease: lin|smooth|step)
//
// Context variables available inside expressions:
//   t     seconds since demo start
//   b     beats (float)
//   bar   bars (float)
//   bt    fraction within current beat (0..1)
//   sb    beats since current shot started
//   kick  decaying envelope of the kick pattern  (1 on hit -> 0)
//   snare decaying envelope of the snare pattern
//   hat   decaying envelope of the hat pattern
//   pi, tau
// Functions: sin cos tan abs floor ceil sqrt pow min max exp log sign
//            fract(x) clamp(x,a,b) mix(a,b,t) step(e,x) smooth(a,b,x)
//            tri(x) saw(x) sqr(x) — unit-period oscillators
//            env(x, decay) — exp(-x*decay), handy with bt/sb

const FUNCS = {
  sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan', abs: 'Math.abs',
  floor: 'Math.floor', ceil: 'Math.ceil', sqrt: 'Math.sqrt', pow: 'Math.pow',
  min: 'Math.min', max: 'Math.max', exp: 'Math.exp', log: 'Math.log', sign: 'Math.sign',
  fract: 'F.fract', clamp: 'F.clamp', mix: 'F.mix', step: 'F.step', smooth: 'F.smooth',
  tri: 'F.tri', saw: 'F.saw', sqr: 'F.sqr', env: 'F.env',
};

const VARS = ['t', 'b', 'bar', 'bt', 'sb', 'kick', 'snare', 'hat', 'pi', 'tau'];

export const F = {
  fract: (x) => x - Math.floor(x),
  clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
  mix: (a, b, t) => a + (b - a) * t,
  step: (e, x) => (x < e ? 0 : 1),
  smooth: (a, b, x) => {
    if (a === b) return x < a ? 0 : 1;
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  },
  tri: (x) => Math.abs(((x % 1) + 1) % 1 * 2 - 1),
  saw: (x) => ((x % 1) + 1) % 1,
  sqr: (x) => (((x % 1) + 1) % 1 < 0.5 ? 1 : 0),
  env: (x, decay = 4) => Math.exp(-Math.max(0, x) * decay),
};

// --- compiler ---------------------------------------------------------------

const cache = new Map();

// Tokenize + validate: only numbers, whitelisted identifiers, operators and
// parens survive. Everything else throws. The result is assembled into a JS
// function — safe because no other identifier can appear.
export function compile(src) {
  if (cache.has(src)) return cache.get(src);
  const tokens = src.match(/\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+|[A-Za-z_]\w*|\*\*|[-+*/%(),?:<>=!&|]=?|\|\||&&/g) || [];
  let js = '';
  let consumed = src.replace(/\s+/g, '');
  let check = '';
  for (const tok of tokens) {
    check += tok;
    if (/^[A-Za-z_]/.test(tok)) {
      if (FUNCS[tok]) js += FUNCS[tok];
      else if (tok === 'pi') js += 'Math.PI';
      else if (tok === 'tau') js += '(Math.PI*2)';
      else if (VARS.includes(tok)) js += `c.${tok}`;
      else throw new Error(`unknown name: ${tok}`);
    } else {
      js += tok;
    }
  }
  if (check !== consumed) throw new Error('bad expression');
  // eslint-disable-next-line no-new-func
  const fn = new Function('c', 'F', `return (${js});`);
  const wrapped = (ctx) => {
    const v = fn(ctx, F);
    return Number.isFinite(v) ? v : 0;
  };
  cache.set(src, wrapped);
  return wrapped;
}

function evalKeyframes(kf, beat) {
  if (!kf.length) return 0;
  if (beat <= kf[0][0]) return kf[0][1];
  const last = kf[kf.length - 1];
  if (beat >= last[0]) return last[1];
  let lo = 0;
  let hi = kf.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kf[mid][0] <= beat) lo = mid;
    else hi = mid;
  }
  const [b0, v0, ease = 'smooth'] = kf[lo];
  const [b1, v1] = kf[hi];
  if (ease === 'step') return v0;
  let u = (beat - b0) / (b1 - b0);
  if (ease === 'smooth') u = u * u * (3 - 2 * u);
  return v0 + (v1 - v0) * u;
}

// Evaluate any param value against a context. Returns a finite number.
export function evalParam(value, ctx) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    try {
      return compile(value)(ctx);
    } catch {
      return 0;
    }
  }
  if (value && Array.isArray(value.kf)) return evalKeyframes(value.kf, ctx.b);
  return 0;
}

// Quick validity check for UI feedback.
export function isValidExpr(src) {
  try {
    compile(src);
    return true;
  } catch {
    return false;
  }
}

/*
 * sdf.js — a GLSL toolkit for raymarching from scratch, faster.
 *
 * Live coders love writing raytracers on stage; this gives them the
 * boring 80% (distance functions, normals, shadows, AO, a camera) so
 * the interesting 20% — the scene — fits in a performance.
 *
 * Injection contract (see shader.js):
 *  - SDF_BASE is always prepended: primitives + operators, no deps.
 *  - SDF_MAP is prepended only when the user source defines
 *    `float map(vec3 p)` — its functions call map(), so injecting it
 *    without a definition would fail at link time.
 *  - A `//!nolib` comment on its own line disables both, for the
 *    from-scratch purists. (Line-anchored so merely *mentioning* the
 *    pragma in a comment doesn't trigger it.)
 *
 * Everything is WebGL1-safe (constant loop bounds) and grayscale by
 * default — tint with the audio uniforms.
 */

export const NOLIB_PRAGMA = /^\s*\/\/!nolib\b/m;
export const HAS_MAP = /float\s+map\s*\(/;

export const SDF_BASE = `// ---- spektrum sdf toolkit: primitives & operators (//!nolib to remove)
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float sdRoundBox(vec3 p, vec3 b, float r) { return sdBox(p, b) - r; }
float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}
float sdCylinder(vec3 p, float h, float r) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float sdOctahedron(vec3 p, float s) {
  p = abs(p);
  return (p.x + p.y + p.z - s) * 0.57735027;
}
float sdPlane(vec3 p, float h) { return p.y - h; }

float opU(float a, float b) { return min(a, b); }
float opSub(float a, float b) { return max(-a, b); }
float opI(float a, float b) { return max(a, b); }
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
vec3 opRep(vec3 p, vec3 c) { return mod(p + 0.5 * c, c) - 0.5 * c; }
vec2 opRepXZ(vec2 p, vec2 c) { return mod(p + 0.5 * c, c) - 0.5 * c; }
mat2 rot(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}
// --------------------------------------------------------------------
`;

export const SDF_MAP = `// ---- raymarching pipeline: you define  float map(vec3 p)  ----
float map(vec3 p);

float rayMarch(vec3 ro, vec3 rd) {
  float t = 0.0;
  for (int i = 0; i < 96; i++) {
    float d = map(ro + rd * t);
    if (d < 0.001) return t;
    t += d;
    if (t > 60.0) break;
  }
  return -1.0;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)));
}

float softShadow(vec3 ro, vec3 rd, float k) {
  float res = 1.0, t = 0.02;
  for (int i = 0; i < 32; i++) {
    float d = map(ro + rd * t);
    if (d < 0.001) return 0.0;
    res = min(res, k * d / t);
    t += clamp(d, 0.02, 0.5);
    if (t > 20.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float calcAO(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.02 + 0.11 * float(i);
    occ += (h - map(p + n * h)) * sca;
    sca *= 0.85;
  }
  return clamp(1.0 - 2.0 * occ, 0.0, 1.0);
}

// look-at camera: uv in [-a..a]x[-1..1], fov ~1.2..2.0
vec3 rayDir(vec2 uv, vec3 ro, vec3 ta, float fov) {
  vec3 f = normalize(ta - ro);
  vec3 r = normalize(cross(f, vec3(0.0, 1.0, 0.0)));
  vec3 u = cross(r, f);
  return normalize(f * fov + uv.x * r + uv.y * u);
}

// the whole raytracer in one call: march + lambert + specular +
// soft shadows + AO + distance fog. grayscale — tint it yourself.
vec3 shade(vec3 ro, vec3 rd, vec3 lig) {
  float t = rayMarch(ro, rd);
  if (t < 0.0) return vec3(0.0);
  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);
  vec3 l = normalize(lig);
  float dif = clamp(dot(n, l), 0.0, 1.0);
  float sh = softShadow(p + n * 0.02, l, 16.0);
  float ao = calcAO(p, n);
  float amb = 0.5 + 0.5 * n.y;
  float spe = pow(clamp(dot(reflect(rd, n), l), 0.0, 1.0), 24.0) * sh;
  vec3 col = vec3(0.08) * amb * ao + vec3(0.9) * dif * sh + vec3(0.7) * spe;
  return mix(col, vec3(0.0), 1.0 - exp(-0.0025 * t * t));
}
// --------------------------------------------------------------------
`;

// Build the injected prelude for a given user source.
export function sdfPrelude(src) {
  if (NOLIB_PRAGMA.test(src)) return "";
  return SDF_BASE + (HAS_MAP.test(src) ? SDF_MAP : "");
}

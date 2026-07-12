/*
 * shader.js — audio-reactive fragment shader runtime.
 *
 * One fullscreen quad, one user-supplied fragment shader, a handful of
 * uniforms fed by the audio engine every frame. Compile errors are
 * non-fatal: the last working program keeps rendering, the error is
 * reported to whoever is listening. Live coding rule #1: never go dark.
 */

import { levels, nowCycle } from "./engine.js";
import { sdfPrelude } from "./sdf.js";

const HEADER = `precision highp float;
uniform vec2  u_res;    // canvas size in px
uniform float u_time;   // seconds since start
uniform float u_cycle;  // musical time in cycles (bars)
uniform float u_beat;   // fractional beat 0..4 within the cycle
uniform float u_rms;    // overall level 0..1
uniform float u_bass;   // low band 0..1
uniform float u_mid;    // mid band 0..1
uniform float u_high;   // high band 0..1
`;

export const DEFAULT_SHADER = `// spektrum default scene — replace me
void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / u_res.y;
  float d = length(uv);
  float ring = smoothstep(0.02, 0.0, abs(d - 0.4 - u_bass * 0.35));
  float pulse = 0.5 + 0.5 * sin(u_cycle * 6.28318);
  vec3 col = vec3(ring) + vec3(0.04) * pulse + u_high * 0.15 * (1.0 - d);
  gl_FragColor = vec4(col, 1.0);
}`;

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

export class ShaderScreen {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: false });
    this.program = null;
    this.uniforms = {};
    this.error = null;
    this.onError = null; // (msg|null) => void
    this.startTime = performance.now() / 1000;
    this.running = false;
    this.smoothing = { bass: 0, mid: 0, high: 0, rms: 0 };
    if (this.gl) {
      const gl = this.gl;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.set(DEFAULT_SHADER);
    }
  }

  // Compile new fragment source; keep the old program on failure.
  // The SDF toolkit (js/sdf.js) is prepended automatically — the
  // map-dependent half only when the source defines `float map(vec3 p)`,
  // and `//!nolib` in the source removes all of it.
  set(src) {
    const gl = this.gl;
    if (!gl) return "no webgl";
    const prelude = HEADER + sdfPrelude(src) + "\n";
    const full = prelude + src;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, full);
    if (typeof fs === "string") {
      // adjust line numbers for everything we prepended
      const preludeLines = prelude.split("\n").length;
      this.error = fs.replace(/ERROR: 0:(\d+)/g, (_, l) => `line ${l - preludeLines + 1}`);
      this.onError?.(this.error);
      return this.error;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      this.error = gl.getProgramInfoLog(prog);
      this.onError?.(this.error);
      return this.error;
    }
    if (this.program) gl.deleteProgram(this.program);
    this.program = prog;
    this.error = null;
    this.onError?.(null);
    gl.useProgram(prog);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = {};
    for (const name of ["u_res", "u_time", "u_cycle", "u_beat", "u_rms", "u_bass", "u_mid", "u_high"]) {
      this.uniforms[name] = gl.getUniformLocation(prog, name);
    }
    return null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const frame = () => {
      if (!this.running) return;
      this.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
  }

  draw() {
    const gl = this.gl;
    if (!gl || !this.program) return;
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(c.clientWidth * dpr));
    const h = Math.max(1, Math.floor(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);

    const lv = levels();
    const s = this.smoothing;
    // fast attack, slow release — punchy but not strobing
    for (const k of ["rms", "bass", "mid", "high"]) {
      s[k] = lv[k] > s[k] ? lv[k] : s[k] * 0.92 + lv[k] * 0.08;
    }
    const cycle = nowCycle();
    const u = this.uniforms;
    gl.uniform2f(u.u_res, w, h);
    gl.uniform1f(u.u_time, performance.now() / 1000 - this.startTime);
    gl.uniform1f(u.u_cycle, cycle);
    gl.uniform1f(u.u_beat, (cycle % 1) * 4);
    gl.uniform1f(u.u_rms, s.rms);
    gl.uniform1f(u.u_bass, s.bass);
    gl.uniform1f(u.u_mid, s.mid);
    gl.uniform1f(u.u_high, s.high);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    return log || "shader compile failed";
  }
  return sh;
}

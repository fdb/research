// WebGL2 renderer: draws evaluated scenes (objects + camera + light + env)
// into an offscreen target, then runs the post op stack as fullscreen passes.
// Also renders the TEX / MESH page previews.

// --- tiny mat4 ---------------------------------------------------------------

function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

function mat4LookAt(eye, target, roll = 0) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  const upx = Math.sin(roll), upy = Math.cos(roll), upz = 0;
  let xx = upy * zz - upz * zy, xy = upz * zx - upx * zz, xz = upx * zy - upy * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

function mat4TRS(tx, ty, tz, rx, ry, rz, s) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx, column-major
  const r00 = cz * cy, r01 = sz * cy, r02 = -sy;
  const r10 = cz * sy * sx - sz * cx, r11 = sz * sy * sx + cz * cx, r12 = cy * sx;
  const r20 = cz * sy * cx + sz * sx, r21 = sz * sy * cx - cz * sx, r22 = cy * cx;
  return new Float32Array([
    r00 * s, r01 * s, r02 * s, 0,
    r10 * s, r11 * s, r12 * s, 0,
    r20 * s, r21 * s, r22 * s, 0,
    tx, ty, tz, 1,
  ]);
}

// --- shaders -----------------------------------------------------------------

const OBJ_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
uniform mat4 uProj, uView, uModel;
out vec3 vNrm;
out vec3 vWorld;
out vec2 vUv;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNrm = mat3(uModel) * aNrm;
  vUv = aUv;
  gl_Position = uProj * uView * w;
}`;

const OBJ_FS = `#version 300 es
precision highp float;
in vec3 vNrm;
in vec3 vWorld;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec3 uEye;
uniform vec3 uLightDir;
uniform float uIntensity, uAmbient, uRim;
uniform float uEmissive, uGloss;
uniform vec3 uFogColor;
uniform float uFogDensity;
out vec4 frag;
void main() {
  vec3 n = normalize(vNrm);
  vec3 v = normalize(uEye - vWorld);
  if (dot(n, v) < 0.0) n = -n; // two-sided lighting, keeps interiors sane
  vec3 albedo = texture(uTex, vUv).rgb;
  float diff = max(dot(n, uLightDir), 0.0);
  vec3 h = normalize(uLightDir + v);
  float spec = pow(max(dot(n, h), 0.0), mix(4.0, 96.0, uGloss)) * uGloss;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * uRim;
  vec3 col = albedo * (uAmbient + diff * uIntensity) + (spec + rim) * uIntensity;
  col += albedo * uEmissive;
  float dist = length(uEye - vWorld);
  float fog = 1.0 - exp(-dist * dist * uFogDensity * uFogDensity);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  frag = vec4(col, 1.0);
}`;

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const POST_FS = {
  copy: `
    void main() { frag = texture(uSrc, vUv); }`,
  bright: `
    uniform float uThreshold;
    void main() {
      vec3 c = texture(uSrc, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      frag = vec4(c * smoothstep(uThreshold, uThreshold + 0.2, l), 1.0);
    }`,
  blur: `
    uniform vec2 uDir;
    void main() {
      vec3 acc = vec3(0.0);
      float w[5] = float[](0.227027, 0.194594, 0.121622, 0.054054, 0.016216);
      acc = texture(uSrc, vUv).rgb * w[0];
      for (int i = 1; i < 5; i++) {
        acc += texture(uSrc, vUv + uDir * float(i)).rgb * w[i];
        acc += texture(uSrc, vUv - uDir * float(i)).rgb * w[i];
      }
      frag = vec4(acc, 1.0);
    }`,
  addmix: `
    uniform sampler2D uSrc2;
    uniform float uAmount;
    void main() {
      frag = vec4(texture(uSrc, vUv).rgb + texture(uSrc2, vUv).rgb * uAmount, 1.0);
    }`,
  grade: `
    uniform vec3 uA, uB, uC, uD;
    uniform float uAmount, uShift;
    void main() {
      vec3 c = texture(uSrc, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 g = uA + uB * cos(6.28318 * (uC * (l + uShift) + uD));
      frag = vec4(mix(c, g, uAmount), 1.0);
    }`,
  lut: `
    uniform sampler2D uLut;
    uniform float uAmount;
    void main() {
      vec3 c = texture(uSrc, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 g = texture(uLut, vec2(l, 0.5)).rgb;
      frag = vec4(mix(c, g, uAmount), 1.0);
    }`,
  vignette: `
    uniform float uAmount, uSize;
    void main() {
      vec3 c = texture(uSrc, vUv).rgb;
      float d = length(vUv - 0.5) / uSize;
      c *= 1.0 - uAmount * smoothstep(0.5, 1.2, d);
      frag = vec4(c, 1.0);
    }`,
  grain: `
    uniform float uAmount, uTime;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 43.7) * 43758.5453);
    }
    void main() {
      vec3 c = texture(uSrc, vUv).rgb;
      c += (hash(vUv * 971.0) - 0.5) * uAmount;
      frag = vec4(c, 1.0);
    }`,
  aberration: `
    uniform float uAmount;
    void main() {
      vec2 d = (vUv - 0.5) * uAmount;
      frag = vec4(
        texture(uSrc, vUv + d).r,
        texture(uSrc, vUv).g,
        texture(uSrc, vUv - d).b,
        1.0);
    }`,
  fade: `
    uniform float uAmount, uTo;
    void main() {
      vec3 c = texture(uSrc, vUv).rgb;
      frag = vec4(mix(c, vec3(uTo), uAmount), 1.0);
    }`,
};

// --- renderer ----------------------------------------------------------------

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;

    this.objProg = this.link(OBJ_VS, OBJ_FS);
    this.postProgs = {};
    for (const [name, body] of Object.entries(POST_FS)) {
      const fs = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
out vec4 frag;
${body}`;
      this.postProgs[name] = this.link(QUAD_VS, fs);
    }

    // fullscreen triangle-strip quad
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.textures = new Map(); // stackId -> WebGLTexture
    this.meshes = new Map(); // stackId -> {vao, count}
    this.fbos = null;
    this.fallbackTex = this.makeFallbackTexture();
  }

  link(vsSrc, fsSrc) {
    const gl = this.gl;
    const compileShader = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) + '\n' + src);
      }
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  makeFallbackTexture() {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const px = new Uint8Array([128, 128, 128, 255]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return tex;
  }

  uploadTexture(id, { size, pixels }) {
    const gl = this.gl;
    let tex = this.textures.get(id);
    if (!tex) {
      tex = gl.createTexture();
      this.textures.set(id, tex);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  uploadMesh(id, { vertices, indices }) {
    const gl = this.gl;
    const old = this.meshes.get(id);
    if (old) {
      gl.deleteVertexArray(old.vao);
      gl.deleteBuffer(old.vb);
      gl.deleteBuffer(old.ib);
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    gl.bindVertexArray(null);
    // bounding radius for preview framing
    let r2 = 0;
    for (let i = 0; i < vertices.length; i += 8) {
      const d = vertices[i] * vertices[i] + vertices[i + 1] * vertices[i + 1] + vertices[i + 2] * vertices[i + 2];
      if (d > r2) r2 = d;
    }
    this.meshes.set(id, { vao, vb, ib, count: indices.length, radius: Math.sqrt(r2) || 1 });
  }

  dropTexture(id) {
    const t = this.textures.get(id);
    if (t) { this.gl.deleteTexture(t); this.textures.delete(id); }
  }

  dropMesh(id) {
    const m = this.meshes.get(id);
    if (m) {
      this.gl.deleteVertexArray(m.vao);
      this.gl.deleteBuffer(m.vb);
      this.gl.deleteBuffer(m.ib);
      this.meshes.delete(id);
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.allocTargets(w, h);
    }
  }

  allocTargets(w, h) {
    const gl = this.gl;
    if (this.fbos) {
      for (const f of Object.values(this.fbos)) {
        gl.deleteFramebuffer(f.fb);
        gl.deleteTexture(f.tex);
        if (f.depth) gl.deleteRenderbuffer(f.depth);
      }
    }
    const make = (tw, th, depth) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      let rb = null;
      if (depth) {
        rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, tw, th);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fb, tex, depth: rb, w: tw, h: th };
    };
    const hw = Math.max(2, w >> 1);
    const hh = Math.max(2, h >> 1);
    this.fbos = {
      scene: make(w, h, true),
      pingA: make(w, h, false),
      pingB: make(w, h, false),
      halfA: make(hw, hh, false),
      halfB: make(hw, hh, false),
    };
  }

  // Draw evaluated scene. scene = {camera, light, env, objects:[...]}, all
  // params already numbers. aspect from current target.
  drawScene(scene, target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    const w = target ? target.w : this.canvas.width;
    const h = target ? target.h : this.canvas.height;
    gl.viewport(0, 0, w, h);

    const env = scene.env;
    const sky = env.skyColor;
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const cam = scene.camera;
    const shake = cam.shake || 0;
    const sh = (seed) => (Math.sin(scene.time * 61.7 + seed * 39.9) + Math.sin(scene.time * 47.3 + seed * 17.1)) * 0.5 * shake;
    const eye = [cam.px + sh(1) * 0.3, cam.py + sh(2) * 0.3, cam.pz + sh(3) * 0.3];
    const proj = mat4Perspective((cam.fov * Math.PI) / 180, w / h, 0.05, 300);
    const view = mat4LookAt(eye, [cam.tx, cam.ty, cam.tz], cam.roll || 0);

    const light = scene.light;
    const ldir = [
      Math.cos(light.elevation) * Math.cos(light.azimuth),
      Math.sin(light.elevation),
      Math.cos(light.elevation) * Math.sin(light.azimuth),
    ];

    gl.useProgram(this.objProg);
    const u = (n) => gl.getUniformLocation(this.objProg, n);
    gl.uniformMatrix4fv(u('uProj'), false, proj);
    gl.uniformMatrix4fv(u('uView'), false, view);
    gl.uniform3fv(u('uEye'), eye);
    gl.uniform3fv(u('uLightDir'), ldir);
    gl.uniform1f(u('uIntensity'), light.intensity);
    gl.uniform1f(u('uAmbient'), light.ambient);
    gl.uniform1f(u('uRim'), light.rim);
    gl.uniform3fv(u('uFogColor'), env.fogColor);
    gl.uniform1f(u('uFogDensity'), env.fog);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u('uTex'), 0);

    for (const obj of scene.objects) {
      const mesh = this.meshes.get(obj.mesh);
      if (!mesh || !mesh.count) continue;
      const tex = this.textures.get(obj.tex) || this.fallbackTex;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniformMatrix4fv(u('uModel'), false, mat4TRS(obj.px, obj.py, obj.pz, obj.rx, obj.ry, obj.rz, obj.scale));
      gl.uniform1f(u('uEmissive'), obj.emissive);
      gl.uniform1f(u('uGloss'), obj.gloss);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  runPost(name, src, target, setUniforms) {
    const gl = this.gl;
    const prog = this.postProgs[name];
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex ? src.tex : src);
    gl.uniform1i(gl.getUniformLocation(prog, 'uSrc'), 0);
    if (setUniforms) setUniforms(prog);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  // scene -> post ops -> canvas. postOps: [{type, params(numbers), lutTexId?}]
  render(scene, postOps, time) {
    const gl = this.gl;
    this.resize();
    if (!this.fbos) this.allocTargets(this.canvas.width, this.canvas.height);
    scene.time = time;
    this.drawScene(scene, this.fbos.scene);

    let src = this.fbos.scene;
    let ping = this.fbos.pingA;
    let pong = this.fbos.pingB;
    const swap = () => { const t = ping; ping = pong; pong = t; };
    const uloc = (prog, n) => gl.getUniformLocation(prog, n);

    const active = (postOps || []).filter((op) => op.enabled !== false);
    for (let k = 0; k < active.length; k++) {
      const op = active[k];
      const last = k === active.length - 1;
      const dst = last ? null : ping;
      const p = op.params;
      switch (op.type) {
        case 'bloom': {
          const { halfA, halfB } = this.fbos;
          this.runPost('bright', src, halfA, (prog) => {
            gl.uniform1f(uloc(prog, 'uThreshold'), p.threshold);
          });
          const r = p.radius;
          this.runPost('blur', halfA, halfB, (prog) => {
            gl.uniform2f(uloc(prog, 'uDir'), r / halfA.w, 0);
          });
          this.runPost('blur', halfB, halfA, (prog) => {
            gl.uniform2f(uloc(prog, 'uDir'), 0, r / halfA.h);
          });
          this.runPost('blur', halfA, halfB, (prog) => {
            gl.uniform2f(uloc(prog, 'uDir'), (r * 2) / halfA.w, 0);
          });
          this.runPost('blur', halfB, halfA, (prog) => {
            gl.uniform2f(uloc(prog, 'uDir'), 0, (r * 2) / halfA.h);
          });
          this.runPost('addmix', src, dst, (prog) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, halfA.tex);
            gl.uniform1i(uloc(prog, 'uSrc2'), 1);
            gl.uniform1f(uloc(prog, 'uAmount'), p.intensity);
            gl.activeTexture(gl.TEXTURE0);
          });
          break;
        }
        case 'grade':
          this.runPost('grade', src, dst, (prog) => {
            const pl = op.pal;
            gl.uniform3f(uloc(prog, 'uA'), pl[0], pl[1], pl[2]);
            gl.uniform3f(uloc(prog, 'uB'), pl[3], pl[4], pl[5]);
            gl.uniform3f(uloc(prog, 'uC'), pl[6], pl[7], pl[8]);
            gl.uniform3f(uloc(prog, 'uD'), pl[9], pl[10], pl[11]);
            gl.uniform1f(uloc(prog, 'uAmount'), p.amount);
            gl.uniform1f(uloc(prog, 'uShift'), p.shift);
          });
          break;
        case 'lut':
          this.runPost('lut', src, dst, (prog) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.textures.get(op.lutTexId) || this.fallbackTex);
            gl.uniform1i(uloc(prog, 'uLut'), 1);
            gl.uniform1f(uloc(prog, 'uAmount'), p.amount);
            gl.activeTexture(gl.TEXTURE0);
          });
          break;
        case 'vignette':
          this.runPost('vignette', src, dst, (prog) => {
            gl.uniform1f(uloc(prog, 'uAmount'), p.amount);
            gl.uniform1f(uloc(prog, 'uSize'), p.size);
          });
          break;
        case 'grain':
          this.runPost('grain', src, dst, (prog) => {
            gl.uniform1f(uloc(prog, 'uAmount'), p.amount);
            gl.uniform1f(uloc(prog, 'uTime'), time % 100);
          });
          break;
        case 'aberration':
          this.runPost('aberration', src, dst, (prog) => {
            gl.uniform1f(uloc(prog, 'uAmount'), p.amount);
          });
          break;
        case 'fade':
          this.runPost('fade', src, dst, (prog) => {
            gl.uniform1f(uloc(prog, 'uAmount'), p.amount);
            gl.uniform1f(uloc(prog, 'uTo'), p.to > 0.5 ? 1 : 0);
          });
          break;
        default:
          this.runPost('copy', src, dst);
      }
      src = dst || src;
      if (!last) swap();
    }
    if (!active.length) this.runPost('copy', src, null);
  }

  // TEX page preview: draw the texture unlit on a fullscreen quad.
  renderTexture(texId) {
    const gl = this.gl;
    this.resize();
    const tex = this.textures.get(texId) || this.fallbackTex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.runPost('copy', tex, null);
  }

  // MESH page preview: neutral turntable, framed to the mesh bounds.
  renderMeshPreview(meshId, texId, time) {
    const r = (this.meshes.get(meshId)?.radius || 1) * 1.9;
    const scene = {
      camera: { px: Math.sin(time * 0.4) * r, py: r * 0.5, pz: Math.cos(time * 0.4) * r, tx: 0, ty: 0, tz: 0, fov: 55, roll: 0, shake: 0 },
      light: { azimuth: 0.8, elevation: 0.9, intensity: 1.1, ambient: 0.25, rim: 0.5 },
      env: { skyColor: [0.06, 0.06, 0.07], fogColor: [0.06, 0.06, 0.07], fog: 0.004 },
      objects: [{ mesh: meshId, tex: texId, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, scale: 1, emissive: 0, gloss: 0.4 }],
    };
    this.render(scene, [], time);
  }
}

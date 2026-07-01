// WASM engine bridge. Loads engine.wasm, serializes op stacks into the shared
// command buffer and returns typed views over the results. Results are copied
// out immediately because wasm memory may grow (and detach views) on the next
// call.

import { serializeStack } from './ops.js';

let exports = null;

export async function initEngine(url = new URL('../engine.wasm', import.meta.url)) {
  const res = await fetch(url);
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
  exports = instance.exports;
}

function writeCmds(cmds) {
  const ptr = exports.cmd_ptr();
  new Float32Array(exports.memory.buffer, ptr, cmds.length).set(cmds);
  return cmds.length;
}

// -> { size, pixels: Uint8Array RGBA }
export function evalTexture(stack, resolveRef, size = 256) {
  const cmds = serializeStack('tex', stack, resolveRef, new Set([stack.id]));
  if (!cmds.length) {
    return { size: 4, pixels: new Uint8Array(4 * 4 * 4).fill(20) };
  }
  const n = writeCmds(cmds);
  const ptr = exports.tex_eval(n, size);
  const pixels = new Uint8Array(exports.memory.buffer, ptr, size * size * 4).slice();
  return { size, pixels };
}

// -> { vertices: Float32Array (pos3 nrm3 uv2), indices: Uint32Array }
export function evalMesh(stack, resolveRef) {
  const cmds = serializeStack('mesh', stack, resolveRef, new Set([stack.id]));
  if (!cmds.length) return { vertices: new Float32Array(0), indices: new Uint32Array(0) };
  const n = writeCmds(cmds);
  const ptr = exports.mesh_eval(n);
  const [nv, ni, vptr, iptr] = new Uint32Array(exports.memory.buffer, ptr, 4);
  return {
    vertices: new Float32Array(exports.memory.buffer, vptr, nv * 8).slice(),
    indices: new Uint32Array(exports.memory.buffer, iptr, ni).slice(),
  };
}

export function engineReady() {
  return exports !== null;
}

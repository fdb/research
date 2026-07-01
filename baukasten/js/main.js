// App bootstrap + the per-frame loop that ties everything to one clock:
// AudioContext time -> beats -> expressions -> scene + post params -> GL.

import { initEngine } from './engine.js';
import { Renderer } from './gl.js';
import { AudioEngine } from './audio.js';
import { state, setProject, loadSaved, runEval, evalPartial, undo, currentStack, resolveRef } from './store.js';
import { evalParam } from './expr.js';
import { paletteColor, opDef } from './ops.js';
import { makeDemoProject } from './demo.js';
import { buildUI, updateTransport, updateSeqPlayhead, togglePlay } from './ui.js';

const DEFAULTS = {
  camera: { px: 0, py: 2, pz: 6, tx: 0, ty: 0, tz: 0, fov: 60, roll: 0, shake: 0 },
  light: { azimuth: 0.8, elevation: 0.9, intensity: 1, ambient: 0.15, rim: 0.4 },
  env: { skyColor: [0.05, 0.05, 0.06], fogColor: [0.05, 0.05, 0.06], fog: 0.01 },
};

function exprContext(beat) {
  const p = state.project;
  const a = state.audio;
  const shot = shotAt(beat / 4);
  return {
    t: (beat * 60) / p.bpm,
    b: beat,
    bar: beat / 4,
    bt: beat % 1,
    sb: shot ? beat - shot.start * 4 : beat,
    kick: a.envAt('kick', beat),
    snare: a.envAt('snare', beat),
    hat: a.envAt('hat', beat, 10),
  };
}

function shotAt(bar) {
  const shots = state.project.shots || [];
  return shots.find((s) => bar >= s.start && bar < s.start + s.len) || shots[shots.length - 1] || null;
}

// Evaluate a scene stack's ops into plain numbers for the renderer.
function evalScene(stack, ctx) {
  const scene = {
    camera: { ...DEFAULTS.camera },
    light: { ...DEFAULTS.light },
    env: { ...DEFAULTS.env },
    objects: [],
  };
  if (!stack) return scene;
  for (const op of stack.ops) {
    if (op.enabled === false) continue;
    const def = opDef('scene', op.type);
    if (!def) continue;
    if (op.type === 'object') {
      const o = { mesh: op.params.mesh, tex: op.params.tex };
      for (const p of def.params) {
        if (p.kind === 'ref' || p.kind === 'pal') continue;
        o[p.key] = evalParam(op.params[p.key], ctx);
      }
      scene.objects.push(o);
    } else if (op.type === 'env') {
      const pal = op.params.pal;
      scene.env = {
        skyColor: paletteColor(pal, evalParam(op.params.skyPos, ctx)),
        fogColor: paletteColor(pal, evalParam(op.params.fogPos, ctx)),
        fog: evalParam(op.params.fog, ctx),
      };
    } else {
      const target = scene[op.type];
      for (const p of def.params) {
        if (p.kind === 'pal') continue;
        target[p.key] = evalParam(op.params[p.key], ctx);
      }
    }
  }
  return scene;
}

// Evaluate a post stack's ops into numbers (palettes stay raw, refs resolve).
function evalPost(stack, ctx) {
  if (!stack) return [];
  const out = [];
  for (const op of stack.ops) {
    if (op.enabled === false) continue;
    const def = opDef('post', op.type);
    if (!def) continue;
    const entry = { type: op.type, enabled: true, params: {}, pal: op.params.pal, lutTexId: op.params.tex };
    for (const p of def.params) {
      if (p.kind === 'pal' || p.kind === 'ref') continue;
      entry.params[p.key] = evalParam(op.params[p.key], ctx);
    }
    out.push(entry);
  }
  return out;
}

// --- preview partials: werkkzeug "view at selected op" -------------------------

let lastPartialKey = '';

function previewId(page) {
  const stack = currentStack(page);
  if (!stack) return null;
  if (state.selOp === null || state.selOp >= stack.ops.length - 1) {
    lastPartialKey = '';
    return stack.id;
  }
  const key = `${page}|${stack.id}|${state.selOp}|${state.evalStamp || 0}|${JSON.stringify(stack.ops[state.selOp]?.params)}`;
  if (key !== lastPartialKey) {
    lastPartialKey = key;
    evalPartial(page, stack, state.selOp);
  }
  return '__partial__';
}

// --- main loop -------------------------------------------------------------------

function frame() {
  const r = state.renderer;
  const beat = state.audio.beatNow();
  const ctx = exprContext(beat);
  const inDemo = document.body.classList.contains('demo');
  const page = inDemo ? 'seq' : state.page;

  try {
    if (page === 'tex') {
      r.renderTexture(previewId('tex'));
    } else if (page === 'mesh') {
      r.renderMeshPreview(previewId('mesh'), null, performance.now() / 1000);
    } else if (page === 'scene') {
      const scene = evalScene(currentStack('scene'), ctx);
      window.__dbg = { ctx, scene };
      r.render(scene, [], ctx.t);
    } else if (page === 'post') {
      const shot = shotAt(beat / 4);
      const sceneStack = resolveRef('scene', shot?.scene) || state.project.scenes[0];
      r.render(evalScene(sceneStack, ctx), evalPost(currentStack('post'), ctx), ctx.t);
    } else {
      // music / seq / demo: the full chain, exactly what the demo plays
      const shot = shotAt(beat / 4);
      const sceneStack = resolveRef('scene', shot?.scene) || state.project.scenes[0];
      const postStack = resolveRef('post', shot?.post) || state.project.post[0];
      r.render(evalScene(sceneStack, ctx), evalPost(postStack, ctx), ctx.t);
    }
  } catch (e) {
    // keep the loop alive; broken projects must never brick the tool
    console.warn('render error', e);
  }

  updateTransport(beat);
  if (page === 'seq' && !inDemo) updateSeqPlayhead(beat);
  requestAnimationFrame(frame);
}

// --- boot ------------------------------------------------------------------------

async function boot() {
  await initEngine();
  const audio = new AudioEngine();
  state.audio = audio;
  buildUI(); // safe pre-project: renderEditor guards on state.project
  const canvas = document.getElementById('view');
  state.renderer = new Renderer(canvas);
  setProject(loadSaved() || makeDemoProject());
  runEval();

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'z' && !e.shiftKey) {
      undo();
    }
  });

  requestAnimationFrame(frame);
}

boot().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre class="boot-error">boot failed: ${e.message}\n${e.stack}</pre>`);
  throw e;
});

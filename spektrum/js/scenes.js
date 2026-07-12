/*
 * scenes.js — demo scenes for all three stations.
 *
 * A scene is a set of VFS files plus instructions for what to run.
 * Loading one is exactly what a performer would do by hand: write the
 * files, run them. The agent demo is a recorded session whose tool
 * calls execute for real.
 */

import { REFERENCE_MD } from "./docs.js";
import * as vfs from "./vfs.js";

// ------------------------------------------------------------- shaders

const SHADER_PULSE = `// pulse — concentric rings that breathe with the bass
void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / u_res.y;
  float d = length(uv);
  float ring = smoothstep(0.025, 0.0, abs(d - 0.35 - u_bass * 0.4));
  float ring2 = smoothstep(0.012, 0.0, abs(d - 0.62 - u_mid * 0.25));
  float beatFlash = smoothstep(1.0, 0.0, u_beat) * 0.08;
  vec3 col = vec3(ring + ring2 * 0.6 + beatFlash);
  col += u_high * 0.2 * (1.0 - smoothstep(0.0, 1.2, d));
  gl_FragColor = vec4(col, 1.0);
}`;

const SHADER_TUNNEL = `// tunnel — polar swirl driven by musical time
void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / u_res.y;
  float r = length(uv) + 1e-4;
  float a = atan(uv.y, uv.x);
  float t = u_cycle * 0.5;
  float tunnel = fract(0.25 / r - t * 2.0);
  float spokes = 0.5 + 0.5 * sin(a * 10.0 + t * 6.2831853);
  float v = smoothstep(0.5, 0.42, abs(tunnel - 0.5)) * (0.25 + 0.75 * spokes);
  v *= smoothstep(0.0, 0.35, r);
  v += u_bass * exp(-r * 3.0);
  v += u_high * 0.15 * spokes * exp(-r * 1.5);
  gl_FragColor = vec4(vec3(v), 1.0);
}`;

const SHADER_GRID = `// night drive — perspective grid, sun, beat pulse
void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / u_res.y;
  float h = -0.18;
  vec3 col = vec3(0.02);
  float d = h - uv.y;
  if (d > 0.0) {
    float z = 1.0 / d;
    vec2 g = vec2(uv.x * z, z + u_cycle * 4.0);
    vec2 f = abs(fract(g) - 0.5);
    float line = smoothstep(0.42, 0.5, max(f.x, f.y));
    col += vec3(line) * exp(-z * 0.12) * (0.35 + u_bass * 0.9);
  } else {
    col += vec3(exp(-abs(uv.y - h) * 9.0)) * (0.25 + u_rms * 0.6);
  }
  float sun = smoothstep(0.32, 0.30, length(uv - vec2(0.0, 0.28)));
  float bands = step(0.5, fract((uv.y - 0.28) * 14.0 + u_cycle));
  col += sun * bands * vec3(0.55) * (0.5 + 0.5 * u_high);
  gl_FragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------ patterns

const PATTERN_FIRST = `// station I — first beat
// put the cursor in a block, ctrl+enter. esc = silence. ? = reference.

bpm(120)

d1( s("bd ~ [~ bd] ~, ~ sn ~ sn").gain(.9) )

d2( s("hh*8").gain("0.55 0.2 0.4 0.2").pan(sine.slow(2)) )

// try: change "hh*8" to "hh*16", or add .degradeBy(.3)
// a bare pattern also works — it goes to d1:
// s("bd*4, [~ cp]*2")
`;

const PATTERN_ACID = `// station I — acid
bpm(132)

d1( s("bd*4").gain(.95) )

d2( s("[~ hh]*4").gain(.45).pan(sine.slow(3)) )

d3( n("0 0 12 0 <3 5> 0 12 <7 10>").scale("c2 minpenta").s("saw")
    .cutoff(sine.range(150, 2800).slow(4)).resonance(11)
    .release(.08).legato(.55).gain(.5).delay(.3)
    .every(4, p => p.fast(2).gain(.4)) )

d4( s("~ ~ ~ cp/2").room(.5).gain(.5) )
`;

const PATTERN_NIGHT = `// station I — night drive
bpm(126)

d1( s("bd*4").gain(.9) )

d2( s("~ cp ~ cp").room(.35).gain(.6) )

d3( s("hh*16").gain(saw.range(.45, .12)).degradeBy(.25).pan(rand) )

d4( n("<0 0 3 -2>").scale("a1 minor").s("sub").legato(.9).gain(.75) )

d5( n("0 [~ 3] 7 [10 <12 14>]").scale("a2 minor").s("pluck")
    .every(2, p => p.rev()).gain(.55).delay(.4).room(.25) )

d6( note("[a3,c4,e4] ~ ~ [g3,b3,d4] ~ ~ ~ ~").s("saw")
    .attack(.15).release(.6).legato(2).cutoff(1200)
    .gain(.28).room(.6).slow(2) )
`;

// --------------------------------------------------------- node graphs

const GRAPH_DRUMS = {
  nodes: [
    { id: "n1", type: "seq", x: 30, y: 30, params: { steps: "x...x...x...x...", cycles: 1 } },
    { id: "n2", type: "sampler", x: 330, y: 30, params: { sound: "bd", gain: 0.95, tune: 0 } },
    { id: "n3", type: "seq", x: 30, y: 260, params: { steps: "....x.......x..x", cycles: 1 } },
    { id: "n4", type: "sampler", x: 330, y: 260, params: { sound: "sn", gain: 0.7, tune: 0 } },
    { id: "n5", type: "seq", x: 30, y: 490, params: { steps: "x.xXx.xXx.xXx.xX", cycles: 1 } },
    { id: "n6", type: "sampler", x: 330, y: 490, params: { sound: "hh", gain: 0.4, tune: 0 } },
    { id: "n7", type: "delay", x: 560, y: 250, params: { time: 0.375, feedback: 0.35, mix: 0.25 } },
    { id: "n8", type: "out", x: 750, y: 190, params: { level: 0.9 } },
    { id: "n9", type: "lfo", x: 330, y: 680, params: { shape: "sine", rate: 0.5, sync: "cycle" } },
    { id: "n10", type: "pan", x: 560, y: 480, params: { pos: 0 } },
  ],
  edges: [
    { from: ["n1", "out"], to: ["n2", "trig"] },
    { from: ["n3", "out"], to: ["n4", "trig"] },
    { from: ["n5", "out"], to: ["n6", "trig"] },
    { from: ["n2", "out"], to: ["n8", "in"] },
    { from: ["n4", "out"], to: ["n7", "in"] },
    { from: ["n7", "out"], to: ["n8", "in"] },
    { from: ["n6", "out"], to: ["n10", "in"] },
    { from: ["n10", "out"], to: ["n8", "in"] },
    { from: ["n9", "out"], to: ["n10", "mod"] },
  ],
};

const GRAPH_ACID = {
  nodes: [
    { id: "n1", type: "seq", x: 30, y: 30, params: { steps: "x...x...x...x...", cycles: 1 } },
    { id: "n2", type: "sampler", x: 330, y: 30, params: { sound: "bd", gain: 0.95, tune: 0 } },
    { id: "n3", type: "notes", x: 30, y: 260, params: { notes: "c2 [c2 c3] eb2 <g1 bb1>", cycles: 1 } },
    { id: "n4", type: "synth", x: 330, y: 260, params: { wave: "saw", gain: 0.6, attack: 0.005, release: 0.08, legato: 0.6 } },
    { id: "n5", type: "filter", x: 560, y: 260, params: { type: "lowpass", cutoff: 400, res: 12, amount: 2200 } },
    { id: "n6", type: "lfo", x: 330, y: 500, params: { shape: "sine", rate: 0.25, sync: "cycle" } },
    { id: "n7", type: "delay", x: 560, y: 520, params: { time: 0.28, feedback: 0.45, mix: 0.3 } },
    { id: "n8", type: "out", x: 750, y: 330, params: { level: 0.9 } },
    { id: "n9", type: "seq", x: 30, y: 520, params: { steps: ".x.x.x.x.x.x.x.x", cycles: 1 } },
    { id: "n10", type: "sampler", x: 330, y: 700, params: { sound: "hh", gain: 0.35, tune: 0 } },
  ],
  edges: [
    { from: ["n1", "out"], to: ["n2", "trig"] },
    { from: ["n2", "out"], to: ["n8", "in"] },
    { from: ["n3", "out"], to: ["n4", "note"] },
    { from: ["n4", "out"], to: ["n5", "in"] },
    { from: ["n6", "out"], to: ["n5", "mod"] },
    { from: ["n5", "out"], to: ["n7", "in"] },
    { from: ["n7", "out"], to: ["n8", "in"] },
    { from: ["n9", "out"], to: ["n10", "trig"] },
    { from: ["n10", "out"], to: ["n8", "in"] },
  ],
};

// ------------------------------------------------------ agent replay

const REPLAY_SESSION = [
  {
    user: "give me a groove",
    say: "Reading the reference first, then laying down a kick and hats.",
    tool: "read_file", input: { path: "docs/REFERENCE.md" }, pause: 300,
  },
  {
    tool: "write_file",
    input: {
      path: "scene/pattern.js",
      content: `bpm(128)

d1( s("bd*4").gain(.9) )

d2( s("[~ hh]*4").gain(.5) )
`,
    },
  },
  { tool: "run_file", input: { path: "scene/pattern.js" }, say: "Four to the floor, hats on the off-beats." },
  {
    user: "acid bassline please",
    say: "Adding a squelchy line in C minor pentatonic with a slow filter sweep.",
    tool: "write_file",
    input: {
      path: "scene/pattern.js",
      content: `bpm(128)

d1( s("bd*4").gain(.9) )

d2( s("[~ hh]*4").gain(.5) )

d3( n("0 0 12 0 3 0 12 7").scale("c2 minpenta").s("saw")
    .cutof(sine.range(150, 2500).slow(4)).resonance(10)
    .release(.08).legato(.55).gain(.5).delay(.3) )
`,
    },
  },
  { tool: "run_file", input: { path: "scene/pattern.js" } },
  {
    say: "Typo — .cutof isn't a function. Fixing and re-running; note the beat never stopped.",
    tool: "write_file",
    input: {
      path: "scene/pattern.js",
      content: `bpm(128)

d1( s("bd*4").gain(.9) )

d2( s("[~ hh]*4").gain(.5) )

d3( n("0 0 12 0 3 0 12 7").scale("c2 minpenta").s("saw")
    .cutoff(sine.range(150, 2500).slow(4)).resonance(10)
    .release(.08).legato(.55).gain(.5).delay(.3) )
`,
    },
  },
  { tool: "run_file", input: { path: "scene/pattern.js" }, pause: 1200 },
  {
    user: "make the visuals react to it",
    say: "A tunnel that breathes with the bass and spins with musical time.",
    tool: "write_file",
    input: { path: "scene/visual.glsl", content: SHADER_TUNNEL },
  },
  { tool: "run_file", input: { path: "scene/visual.glsl" } },
  {
    user: "more energy!",
    say: "Faster, a clap, and the bassline doubles up every fourth cycle.",
    tool: "set_bpm", input: { bpm: 136 }, pause: 200,
  },
  {
    tool: "write_file",
    input: {
      path: "scene/pattern.js",
      content: `bpm(136)

d1( s("bd*4").gain(.95) )

d2( s("[~ hh]*4").gain(.5).pan(sine.slow(3)) )

d3( n("0 0 12 0 3 0 12 7").scale("c2 minpenta").s("saw")
    .cutoff(sine.range(150, 2800).slow(4)).resonance(11)
    .release(.08).legato(.55).gain(.5).delay(.3)
    .every(4, p => p.fast(2)) )

d4( s("~ cp ~ cp").room(.4).gain(.55) )

d5( s("hh*16").gain(saw.range(.4, .1)).degradeBy(.4) )
`,
    },
  },
  { tool: "run_file", input: { path: "scene/pattern.js" }, say: "There's the lift. Take over whenever you like — same files, any station.", pause: 800 },
];

// ------------------------------------------------------------- scenes

export const DEFAULT_FILES = {
  "scene/pattern.js": PATTERN_FIRST,
  "scene/visual.glsl": SHADER_PULSE,
  "scene/graph.json": JSON.stringify(GRAPH_DRUMS, null, 2),
  "docs/REFERENCE.md": REFERENCE_MD,
};

export const SCENES = [
  {
    id: "first-beat",
    title: "I · first beat",
    station: "primitives",
    files: { "scene/pattern.js": PATTERN_FIRST, "scene/visual.glsl": SHADER_PULSE },
    run: ["scene/pattern.js", "scene/visual.glsl"],
  },
  {
    id: "acid",
    title: "I · acid",
    station: "primitives",
    files: { "scene/pattern.js": PATTERN_ACID, "scene/visual.glsl": SHADER_TUNNEL },
    run: ["scene/pattern.js", "scene/visual.glsl"],
  },
  {
    id: "night-drive",
    title: "I · night drive",
    station: "primitives",
    files: { "scene/pattern.js": PATTERN_NIGHT, "scene/visual.glsl": SHADER_GRID },
    run: ["scene/pattern.js", "scene/visual.glsl"],
  },
  {
    id: "drum-machine",
    title: "II · drum machine",
    station: "nodes",
    files: {
      "scene/graph.json": JSON.stringify(GRAPH_DRUMS, null, 2),
      "scene/visual.glsl": SHADER_PULSE,
    },
    run: ["scene/graph.json", "scene/visual.glsl"],
  },
  {
    id: "acid-wobble",
    title: "II · acid wobble",
    station: "nodes",
    files: {
      "scene/graph.json": JSON.stringify(GRAPH_ACID, null, 2),
      "scene/visual.glsl": SHADER_TUNNEL,
    },
    run: ["scene/graph.json", "scene/visual.glsl"],
  },
  {
    id: "agent-demo",
    title: "III · demo session (offline replay)",
    station: "agent",
    files: { "scene/visual.glsl": SHADER_PULSE },
    run: ["scene/visual.glsl"],
    replay: REPLAY_SESSION,
  },
];

export function loadScene(scene, { runtime, agentCtl, switchStation }) {
  for (const [path, content] of Object.entries(scene.files)) {
    vfs.write(path, content);
  }
  switchStation?.(scene.station);
  for (const path of scene.run || []) {
    const content = vfs.read(path);
    if (content !== null) runtime.applyFile(path, content);
  }
  if (scene.replay && agentCtl) agentCtl.replay(scene.replay);
}

// ARTEFAKT — the default demo, authored entirely with the tool's ops.
//
// Concept: a system dreams an artefact into being. Four acts, one timeline:
//   SUBSTRAT  (bars  0–8)  raw matter — a dark noise terrain, heartbeat kick
//   SYSTEM    (bars  8–20) order — a ring of megaliths rises, bass + arp enter
//   ARTEFAKT  (bars 20–36) the relic appears, pulsing with the kick, full music
//   ZERFALL   (bars 36–48) dissolution — the camera lets go, grain swallows all
//
// The piece is the "artefact"; the tool that made it is the "system" — the
// distinction the whole experiment is about. Music and image share one clock:
// every visual pulse below is an expression reading the kick/snare patterns.

import { PALETTES } from './ops.js';

const op = (type, params, enabled = true) => ({ type, params, enabled });

export function makeDemoProject() {
  return {
    name: 'ARTEFAKT',
    bpm: 124,
    texSize: 256,

    // ------------------------------------------------------------ textures
    textures: [
      {
        id: 'tx-substrat', name: 'substrat',
        ops: [
          op('noise', { scale: 6, octaves: 6, gain: 0.55, seed: 7, type: 1 }),
          op('distort', { amount: 0.15, scale: 5, seed: 3 }),
          op('colorize', { pal: PALETTES.abyss.slice() }),
          op('adjust', { brightness: 0, contrast: 1.25, gamma: 1 }),
        ],
      },
      {
        id: 'tx-koernung', name: 'körnung',
        ops: [
          op('noise', { scale: 9, octaves: 5, gain: 0.5, seed: 11, type: 0 }),
        ],
      },
      {
        id: 'tx-gestein', name: 'gestein',
        ops: [
          op('bricks', { nx: 3, ny: 7, mortar: 0.045, bevel: 0.035, shift: 0.5, seed: 5 }),
          op('blend', { with: 'tx-koernung', mode: 2, amount: 0.75 }),
          op('colorize', { pal: PALETTES.bone.slice() }),
          op('adjust', { brightness: -0.06, contrast: 1.2, gamma: 1 }),
        ],
      },
      {
        id: 'tx-relikt', name: 'relikt',
        ops: [
          op('voronoi', { scale: 7, seed: 3, jitter: 1, mode: 0 }),
          op('invert', {}),
          op('adjust', { brightness: 0, contrast: 1.7, gamma: 0.8 }),
          op('colorize', { pal: PALETTES.ember.slice() }),
        ],
      },
      {
        id: 'tx-lut', name: 'glut-lut',
        ops: [
          op('shape', { type: 3, cx: 0.5, cy: 0.5, w: 1, h: 1, feather: 0.05, rot: 0 }),
          op('colorize', { pal: PALETTES.ember.slice() }),
        ],
      },
    ],

    // ------------------------------------------------------------ meshes
    meshes: [
      {
        id: 'ms-terrain', name: 'terrain',
        ops: [
          op('grid', { w: 44, d: 44, su: 110, sv: 110 }),
          op('displace', { amount: 2.4, scale: 0.12, octaves: 4, seed: 9 }),
        ],
      },
      {
        id: 'ms-monolith', name: 'monolith',
        ops: [
          op('cube', { sx: 0.7, sy: 6.5, sz: 0.7, seg: 5, _p4: 0, _p5: 0 }),
          op('displace', { amount: 0.05, scale: 2.5, octaves: 3, seed: 4 }),
        ],
      },
      {
        id: 'ms-saeulen', name: 'säulen',
        ops: [
          op('cube', { sx: 0.7, sy: 6.5, sz: 0.7, seg: 5, _p4: 0, _p5: 0 }),
          op('displace', { amount: 0.05, scale: 2.5, octaves: 3, seed: 4 }),
          op('array', { mode: 1, count: 14, p0: 9, p1: 0, p2: 0 }),
          op('merge', { with: 'ms-innenring' }),
        ],
      },
      {
        id: 'ms-innenring', name: 'innenring',
        ops: [
          op('cube', { sx: 0.45, sy: 9, sz: 0.45, seg: 5, _p4: 0, _p5: 0 }),
          op('displace', { amount: 0.04, scale: 3, octaves: 3, seed: 8 }),
          op('array', { mode: 1, count: 7, p0: 4.5, p1: 0, p2: 0 }),
        ],
      },
      {
        id: 'ms-relikt', name: 'relikt',
        ops: [
          op('torus', { R: 1.5, r: 0.45, su: 72, sv: 36 }),
          op('displace', { amount: 0.13, scale: 2.6, octaves: 4, seed: 2 }),
          op('twist', { amount: 0.6 }),
        ],
      },
      {
        id: 'ms-kern', name: 'kern',
        ops: [
          op('sphere', { r: 0.55, su: 48, sv: 32 }),
          op('displace', { amount: 0.05, scale: 5, octaves: 3, seed: 6 }),
        ],
      },
    ],

    // ------------------------------------------------------------ scenes
    scenes: [
      {
        id: 'sc-substrat', name: 'substrat',
        ops: [
          op('env', { pal: PALETTES.abyss.slice(), skyPos: 0.72, fog: 0.045, fogPos: 0.62 }),
          op('light', { azimuth: 0.8, elevation: 0.35, intensity: 0.9, ambient: 0.12, rim: 0.7 }),
          op('camera', {
            px: 'sin(sb*0.03)*12', py: 1.3, pz: '14-sb*0.36',
            tx: 0, ty: -1.2, tz: '-sb*0.36', fov: 66, roll: 0, shake: 0,
          }),
          op('object', {
            mesh: 'ms-terrain', tex: 'tx-substrat',
            px: 0, py: -4, pz: 0, rx: 0, ry: 0, rz: 0, scale: 1,
            emissive: 0.04, gloss: 0.15,
          }),
        ],
      },
      {
        id: 'sc-system', name: 'system',
        ops: [
          op('env', { pal: PALETTES.abyss.slice(), skyPos: 0.68, fog: 0.028, fogPos: 0.58 }),
          op('light', { azimuth: '0.8+sb*0.004', elevation: 0.5, intensity: 1.05, ambient: 0.14, rim: '0.4+kick*0.4' }),
          op('camera', {
            px: 'sin(sb*0.055)*6.5', py: '0.9+sin(sb*0.11)*0.8', pz: 'cos(sb*0.055)*6.5',
            tx: 'sin(sb*0.055+1.2)*2.5', ty: 1.2, tz: 'cos(sb*0.055+1.2)*2.5',
            fov: 72, roll: 0, shake: 0,
          }),
          op('object', {
            mesh: 'ms-terrain', tex: 'tx-substrat',
            px: 0, py: -4, pz: 0, rx: 0, ry: 0, rz: 0, scale: 1,
            emissive: 0.04, gloss: 0.15,
          }),
          op('object', {
            mesh: 'ms-saeulen', tex: 'tx-gestein',
            px: 0, py: -0.9, pz: 0, rx: 0, ry: 'sb*0.002', rz: 0, scale: 1,
            emissive: 0.02, gloss: 0.3,
          }),
        ],
      },
      {
        id: 'sc-artefakt', name: 'artefakt',
        ops: [
          op('env', { pal: PALETTES.abyss.slice(), skyPos: '0.66+kick*0.05', fog: 0.03, fogPos: 0.55 }),
          op('light', { azimuth: '0.8+sb*0.003', elevation: 0.6, intensity: 1.15, ambient: 0.12, rim: '0.5+kick*0.6' }),
          op('camera', {
            px: 'sin(sb*0.045)*5.6', py: '2.3+sin(sb*0.09)*0.9', pz: 'cos(sb*0.045)*5.6',
            tx: 0, ty: 1.7, tz: 0, fov: 56, roll: 0, shake: 'snare*0.12',
          }),
          op('object', {
            mesh: 'ms-terrain', tex: 'tx-substrat',
            px: 0, py: -4, pz: 0, rx: 0, ry: 0, rz: 0, scale: 1,
            emissive: 0.04, gloss: 0.15,
          }),
          op('object', {
            mesh: 'ms-saeulen', tex: 'tx-gestein',
            px: 0, py: -0.9, pz: 0, rx: 0, ry: 0, rz: 0, scale: 1,
            emissive: 0.02, gloss: 0.3,
          }),
          op('object', {
            mesh: 'ms-relikt', tex: 'tx-relikt',
            px: 0, py: '1.8+sin(b*0.196)*0.25', pz: 0,
            rx: 'sin(sb*0.03)*0.35', ry: 'b*0.196', rz: 0, scale: 1,
            emissive: '0.15+kick*0.7', gloss: 0.6,
          }),
          op('object', {
            mesh: 'ms-kern', tex: 'tx-relikt',
            px: 0, py: '1.8+sin(b*0.196)*0.25', pz: 0,
            rx: 0, ry: '-b*0.3', rz: 0, scale: '1+kick*0.15',
            emissive: '1.3+kick*2.6', gloss: 0.2,
          }),
        ],
      },
      {
        id: 'sc-zerfall', name: 'zerfall',
        ops: [
          op('env', { pal: PALETTES.abyss.slice(), skyPos: '0.72-sb*0.002', fog: '0.03+sb*0.0012', fogPos: 0.6 }),
          op('light', { azimuth: 0.9, elevation: 0.55, intensity: '1.1-sb*0.012', ambient: 0.1, rim: 0.5 }),
          op('camera', {
            px: 'sin(sb*0.02+0.8)*(6+sb*0.35)', py: '2+sb*0.18', pz: 'cos(sb*0.02+0.8)*(6+sb*0.35)',
            tx: 0, ty: 1.6, tz: 0, fov: 55, roll: 'sb*0.004', shake: 0,
          }),
          op('object', {
            mesh: 'ms-terrain', tex: 'tx-substrat',
            px: 0, py: -4, pz: 0, rx: 0, ry: 0, rz: 0, scale: 1,
            emissive: 0.04, gloss: 0.15,
          }),
          op('object', {
            mesh: 'ms-saeulen', tex: 'tx-gestein',
            px: 0, py: -0.9, pz: 0, rx: 0, ry: 0, rz: 0, scale: 1,
            emissive: 0.02, gloss: 0.3,
          }),
          op('object', {
            mesh: 'ms-relikt', tex: 'tx-relikt',
            px: 0, py: '1.8+sb*0.06', pz: 0,
            rx: 'sin(sb*0.03)*0.35', ry: 'b*0.196', rz: 0, scale: 1,
            emissive: '0.3+kick*0.5', gloss: 0.6,
          }),
          op('object', {
            mesh: 'ms-kern', tex: 'tx-relikt',
            px: 0, py: '1.8+sb*0.06', pz: 0,
            rx: 0, ry: '-b*0.3', rz: 0, scale: 1,
            emissive: '1+kick*1.5', gloss: 0.2,
          }),
        ],
      },
    ],

    // ------------------------------------------------------------ post
    post: [
      {
        id: 'po-haupt', name: 'haupt',
        ops: [
          op('bloom', { threshold: 0.55, intensity: '0.7+kick*0.5', radius: 1.3 }),
          op('grade', { pal: PALETTES.ember.slice(), amount: 0.38, shift: 0 }),
          op('aberration', { amount: '0.002+snare*0.006' }),
          op('vignette', { amount: 0.45, size: 0.8 }),
          op('grain', { amount: '0.05+smooth(144,192,b)*0.16' }),
          op('fade', { amount: 'max(smooth(4,0,b),smooth(178,192,b))', to: 0 }),
        ],
      },
      {
        id: 'po-roh', name: 'roh',
        ops: [],
      },
    ],

    // ------------------------------------------------------------ timeline
    // Shots sequence scenes over bars; the same clock drives the music.
    shots: [
      { start: 0, len: 8, scene: 'sc-substrat', post: 'po-haupt' },
      { start: 8, len: 12, scene: 'sc-system', post: 'po-haupt' },
      { start: 20, len: 16, scene: 'sc-artefakt', post: 'po-haupt' },
      { start: 36, len: 12, scene: 'sc-zerfall', post: 'po-haupt' },
    ],

    // ------------------------------------------------------------ music
    music: {
      root: 45, // A2
      scale: [0, 3, 5, 7, 10], // minor pentatonic
      gains: { kick: 1, snare: 0.8, hat: 0.5, bass: 0.8, arp: 0.55, pad: 0.9 },
      patterns: {
        void: {
          kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
          snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          hat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          bass: [1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
          arp: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          pad: 1,
        },
        pulse: {
          kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
          snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
          bass: [1, 0, 0, 1, -1, 0, 1, 0, 1, 0, 0, 4, -1, 0, 3, 0],
          arp: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          pad: 1,
        },
        build: {
          kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
          snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2],
          bass: [1, 0, 0, 1, -1, 0, 1, 0, 1, 0, 0, 4, -1, 0, 3, 0],
          arp: [8, 0, 5, 8, 0, 5, 8, 0, 10, 0, 8, 5, 6, 0, 5, 0],
          pad: 4,
        },
        full: {
          kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
          snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
          hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 2, 0],
          bass: [1, 0, 1, 0, 1, 0, 4, 0, 1, 0, 1, 0, 5, 0, 4, 0],
          arp: [8, 0, 5, 8, 0, 10, 0, 8, 5, 0, 8, 0, 12, 0, 10, 8],
          pad: 1,
        },
        peak: {
          kick: [1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0],
          snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
          hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 2, 0],
          bass: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 4, 0, 5, 0],
          arp: [12, 0, 10, 8, 0, 12, 0, 10, 8, 0, 12, 0, 10, 8, 5, 0],
          pad: 6,
        },
        strip: {
          kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
          snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
          bass: [1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
          arp: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          pad: 1,
        },
        outro: {
          kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          hat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          bass: [1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
          arp: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          pad: 1,
        },
      },
      song: [
        'void', 'void', 'void', 'void', 'void', 'void', 'void', 'void',
        'pulse', 'pulse', 'pulse', 'pulse',
        'build', 'build', 'build', 'build', 'build', 'build', 'build', 'build',
        'full', 'full', 'full', 'full', 'full', 'full', 'full', 'full',
        'full', 'peak', 'full', 'peak', 'full', 'peak', 'peak', 'peak',
        'strip', 'strip', 'strip', 'strip', 'strip', 'strip',
        'outro', 'outro', 'outro', 'outro', 'outro', 'outro',
      ],
    },
  };
}

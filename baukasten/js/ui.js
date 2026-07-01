// DOM UI: page tabs, stack editor (op cards), param sheet, music grid, shot
// sequencer, project menu. No framework — small targeted re-renders driven by
// store events. Mobile-first: everything is tappable, sliders are fat, and
// multi-input ops use references instead of wires.

import {
  state, subscribe, emit, currentStack, stacksOf, resolveRef,
  addStack, removeStack, addOp, removeOp, moveOp, setParam, toggleOp,
  mutate, undo, setProject, clearSaved, newId,
} from './store.js';
import { OPS_BY_PAGE, PALETTES, paletteColor, opDef } from './ops.js';
import { isValidExpr } from './expr.js';
import { makeDemoProject } from './demo.js';
import { makeEmptyPattern, STEPS, INSTRUMENTS } from './audio.js';

const $ = (sel, el = document) => el.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

const PAGE_LABELS = { tex: 'tex', mesh: 'mesh', scene: 'scene', post: 'post', music: 'music', seq: 'seq' };

export function buildUI() {
  const app = $('#app');
  app.append(
    buildTopbar(),
    h('div', { id: 'preview-wrap' },
      h('canvas', { id: 'view' }),
      h('div', { id: 'transport' },
        h('input', { id: 'scrub', type: 'range', min: 0, max: 100, step: 0.25, value: 0,
          oninput: (e) => state.audio.seek(parseFloat(e.target.value)) }),
      ),
    ),
    h('main', { id: 'editor' }),
    buildTabbar(),
    h('div', { id: 'sheet', class: 'hidden' }),
    h('div', { id: 'overlay', class: 'hidden' }),
  );
  subscribe((kind) => {
    if (kind === 'param' || kind === 'eval') return;
    renderEditor();
  });
  renderEditor();
}

// --- topbar -------------------------------------------------------------------

function buildTopbar() {
  return h('header', { id: 'topbar' },
    h('span', { class: 'brand' }, 'baukasten'),
    h('button', { id: 'playBtn', class: 'icon-btn', title: 'play/pause (space)',
      onclick: togglePlay }, '▶'),
    h('button', { class: 'icon-btn', title: 'to start',
      onclick: () => state.audio.seek(0) }, '⏮'),
    h('span', { id: 'timecode' }, '001.1'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'ghost-btn', onclick: enterDemoMode }, 'demo'),
    h('button', { class: 'icon-btn', onclick: openMenu }, '≡'),
  );
}

export function togglePlay() {
  const a = state.audio;
  if (a.playing) a.stop();
  else a.play();
  $('#playBtn').textContent = a.playing ? '⏸' : '▶';
}

export function updateTransport(beat) {
  const tc = $('#timecode');
  if (tc) {
    const bar = Math.floor(beat / 4) + 1;
    const bt = Math.floor(beat % 4) + 1;
    tc.textContent = `${String(bar).padStart(3, '0')}.${bt}`;
  }
  const scrub = $('#scrub');
  if (scrub && document.activeElement !== scrub) {
    scrub.max = state.audio.songBars * 4;
    scrub.value = beat;
  }
}

// --- demo mode ------------------------------------------------------------------

export function enterDemoMode() {
  document.body.classList.add('demo');
  state.audio.play(0);
  $('#playBtn').textContent = '⏸';
  const exit = () => {
    document.body.classList.remove('demo');
    $('#view').removeEventListener('click', exit);
  };
  setTimeout(() => $('#view').addEventListener('click', exit), 400);
}

// --- tabbar ---------------------------------------------------------------------

function buildTabbar() {
  return h('nav', { id: 'tabbar' },
    Object.entries(PAGE_LABELS).map(([page, label]) =>
      h('button', {
        class: 'tab', dataset: { page },
        onclick: () => {
          state.page = page;
          state.selOp = null;
          emit('sel');
        },
      }, label),
    ),
  );
}

// --- editor pages ------------------------------------------------------------------

function renderEditor() {
  const editor = $('#editor');
  if (!editor || !state.project) return;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.page === state.page);
  }
  editor.replaceChildren();
  if (['tex', 'mesh', 'scene', 'post'].includes(state.page)) renderStackPage(editor);
  else if (state.page === 'music') renderMusicPage(editor);
  else if (state.page === 'seq') renderSeqPage(editor);
  renderSheet();
}

// --- stack pages -----------------------------------------------------------------

function renderStackPage(editor) {
  const page = state.page;
  const stacks = stacksOf(page);
  const stack = currentStack(page);

  editor.append(
    h('div', { class: 'chips' },
      stacks.map((s) =>
        h('button', {
          class: `chip ${s.id === stack?.id ? 'active' : ''}`,
          // tap selects; tapping the already-active chip renames (touch-friendly)
          onclick: () => {
            if (s.id === stack?.id) renameStack(page, s);
            else { state.sel[page] = s.id; state.selOp = null; emit('sel'); }
          },
        }, s.name),
      ),
      h('button', { class: 'chip add', onclick: () => addStack(page) }, '+'),
      stacks.length > 1 && stack
        ? h('button', { class: 'chip danger', title: 'delete stack', onclick: () => confirmDeleteStack(page, stack) }, '×')
        : null,
    ),
  );

  if (!stack) return;
  const list = h('div', { class: 'op-list' });
  stack.ops.forEach((op, i) => {
    const def = opDef(page, op.type);
    const selected = state.selOp === i;
    const card = h('div', {
      class: `op-card cat-${def?.cat || 'x'} ${selected ? 'selected' : ''} ${op.enabled === false ? 'off' : ''}`,
      onclick: () => { state.selOp = selected ? null : i; emit('sel'); },
    },
      h('span', { class: 'op-name' }, def?.label || op.type),
      h('span', { class: 'op-summary' }, opSummary(page, op)),
      h('span', { class: 'op-actions' },
        h('button', { class: 'mini', title: 'up', onclick: (e) => { e.stopPropagation(); moveOp(page, i, -1); } }, '↑'),
        h('button', { class: 'mini', title: 'down', onclick: (e) => { e.stopPropagation(); moveOp(page, i, 1); } }, '↓'),
        h('button', { class: 'mini', title: 'bypass', onclick: (e) => { e.stopPropagation(); toggleOp(page, i); } }, op.enabled === false ? '○' : '●'),
        h('button', { class: 'mini danger', title: 'delete', onclick: (e) => { e.stopPropagation(); removeOp(page, i); } }, '×'),
      ),
    );
    list.append(card);
    list.append(h('div', { class: 'op-flow' }, '↓'));
  });
  list.append(h('button', { class: 'add-op', onclick: () => openOpPicker(page) }, '+ add op'));
  editor.append(list);
  editor.append(h('p', { class: 'hint' },
    page === 'tex' ? 'ops flow top to bottom - the last op is the texture. tap an op to edit; the preview shows the stack up to the selected op.'
    : page === 'mesh' ? 'stack up primitives and modifiers. merge pulls in another stack by reference - no wires needed.'
    : page === 'scene' ? 'a scene = env + light + camera + objects. params accept numbers or expressions (t, b, sb, kick, snare...).'
    : 'post ops run left to right over the rendered frame. params accept expressions - try kick or snare.'));
}

function opSummary(page, op) {
  const def = opDef(page, op.type);
  if (!def) return '';
  const parts = [];
  for (const p of def.params.slice(0, 3)) {
    if (def.hidden?.includes(p.key)) continue;
    const v = op.params[p.key];
    if (p.kind === 'ref') parts.push(resolveRef(p.page, v)?.name || '?');
    else if (p.kind === 'pal') parts.push('pal');
    else if (p.kind === 'enum') parts.push(p.options[v] ?? v);
    else if (typeof v === 'number') parts.push(+v.toFixed(2));
    else if (typeof v === 'string') parts.push('ƒ');
    else parts.push('kf');
  }
  return parts.join(' · ');
}

function renameStack(page, s) {
  const name = prompt('stack name', s.name);
  if (name) mutate(() => { s.name = name; });
}

function confirmDeleteStack(page, stack) {
  if (confirm(`delete stack "${stack.name}"?`)) removeStack(page, stack.id);
}

// --- op picker --------------------------------------------------------------------

function openOpPicker(page) {
  const overlay = $('#overlay');
  const defs = OPS_BY_PAGE[page];
  const cats = {};
  for (const [type, def] of Object.entries(defs)) {
    (cats[def.cat] = cats[def.cat] || []).push([type, def]);
  }
  overlay.replaceChildren(
    h('div', { class: 'picker', onclick: (e) => e.stopPropagation() },
      h('h3', {}, `add ${page} op`),
      Object.entries(cats).map(([cat, items]) =>
        h('div', { class: 'picker-cat' },
          h('h4', {}, cat),
          h('div', { class: 'picker-grid' },
            items.map(([type, def]) =>
              h('button', {
                class: `pick cat-${def.cat}`,
                onclick: () => { closeOverlay(); addOp(page, type); },
              }, def.label),
            ),
          ),
        ),
      ),
      h('button', { class: 'ghost-btn wide', onclick: closeOverlay }, 'cancel'),
    ),
  );
  overlay.classList.remove('hidden');
  overlay.onclick = closeOverlay;
}

function closeOverlay() {
  $('#overlay').classList.add('hidden');
}

// --- param sheet -------------------------------------------------------------------

function renderSheet() {
  const sheet = $('#sheet');
  const page = state.page;
  if (!['tex', 'mesh', 'scene', 'post'].includes(page) || state.selOp === null) {
    sheet.classList.add('hidden');
    return;
  }
  const stack = currentStack(page);
  const op = stack?.ops[state.selOp];
  if (!op) { sheet.classList.add('hidden'); return; }
  const def = opDef(page, op.type);
  sheet.classList.remove('hidden');
  sheet.replaceChildren(
    h('div', { class: 'sheet-head' },
      h('strong', {}, def.label),
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', onclick: () => { state.selOp = null; emit('sel'); } }, '×'),
    ),
    ...def.params
      .filter((p) => !def.hidden?.includes(p.key))
      .map((p) => paramControl(page, state.selOp, op, p)),
  );
}

function paramControl(page, opIndex, op, p) {
  const value = op.params[p.key];
  if (p.kind === 'pal') return paletteControl(page, opIndex, op, p);
  if (p.kind === 'enum') {
    return h('div', { class: 'param' },
      h('label', {}, p.label),
      h('div', { class: 'seg' },
        p.options.map((optLabel, idx) =>
          h('button', {
            class: `seg-btn ${value === idx ? 'active' : ''}`,
            onclick: () => { setParam(page, opIndex, p.key, idx); renderSheet(); },
          }, optLabel),
        ),
      ),
    );
  }
  if (p.kind === 'ref') {
    const options = stacksOf(p.page).filter((s) => s.id !== currentStack(page)?.id || p.page !== page);
    return h('div', { class: 'param' },
      h('label', {}, p.label),
      h('select', {
        onchange: (e) => setParam(page, opIndex, p.key, e.target.value),
      },
        h('option', { value: '' }, '—'),
        options.map((s) => {
          const o = h('option', { value: s.id }, s.name);
          if (s.id === value) o.selected = true;
          return o;
        }),
      ),
    );
  }
  // numeric / expression
  const isExpr = p.kind === 'expr';
  const isNumber = typeof value === 'number';
  const valLabel = h('span', { class: 'val' }, isNumber ? fmt(value) : 'ƒ(x)');
  const row = h('div', { class: 'param' },
    h('label', {}, p.label, valLabel),
  );
  if (isNumber) {
    row.append(h('input', {
      type: 'range', min: p.min, max: p.max, step: p.step,
      value,
      oninput: (e) => {
        const v = p.kind === 'i' ? Math.round(parseFloat(e.target.value)) : parseFloat(e.target.value);
        valLabel.textContent = fmt(v);
        setParam(page, opIndex, p.key, v);
      },
    }));
  } else {
    const input = h('input', {
      type: 'text', class: 'expr-input', value: typeof value === 'string' ? value : JSON.stringify(value.kf),
      spellcheck: 'false',
      oninput: (e) => {
        const src = e.target.value;
        const ok = isValidExpr(src);
        e.target.classList.toggle('invalid', !ok);
        if (ok) setParam(page, opIndex, p.key, src);
      },
    });
    row.append(input);
  }
  if (isExpr) {
    row.append(h('button', {
      class: `mini fx ${isNumber ? '' : 'active'}`,
      title: 'toggle expression',
      onclick: () => {
        const nv = isNumber ? String(value) : (typeof value === 'string' ? numFromExpr(value, p) : p.def);
        setParam(page, opIndex, p.key, nv);
        renderSheet();
      },
    }, 'ƒ'));
  }
  return row;
}

function numFromExpr(src, p) {
  const n = parseFloat(src);
  return Number.isFinite(n) ? n : p.def;
}

function fmt(v) {
  return Math.abs(v) >= 100 ? v.toFixed(0) : +v.toFixed(3);
}

function paletteControl(page, opIndex, op, p) {
  const value = op.params[p.key];
  const canvas = h('canvas', { class: 'pal-strip', width: 256, height: 24 });
  const draw = () => {
    const ctx = canvas.getContext('2d');
    for (let x = 0; x < 256; x++) {
      const c = paletteColor(op.params[p.key], x / 255);
      ctx.fillStyle = `rgb(${c[0] * 255},${c[1] * 255},${c[2] * 255})`;
      ctx.fillRect(x, 0, 1, 24);
    }
  };
  requestAnimationFrame(draw);
  const presetSel = h('select', {
    onchange: (e) => {
      if (!e.target.value) return;
      setParam(page, opIndex, p.key, PALETTES[e.target.value].slice());
      renderSheet();
    },
  },
    h('option', { value: '' }, 'preset…'),
    Object.keys(PALETTES).map((name) => h('option', { value: name }, name)),
  );
  const detail = h('details', { class: 'pal-detail' },
    h('summary', {}, 'fine-tune (iq cosine: a + b·cos(2π(c·t+d)))'),
    ['a', 'b', 'c', 'd'].map((band, bi) =>
      h('div', { class: 'pal-band' },
        h('span', { class: 'pal-band-label' }, band),
        [0, 1, 2].map((ch) => {
          const idx = bi * 3 + ch;
          return h('input', {
            type: 'range', min: bi === 2 ? 0 : -1, max: bi === 2 ? 4 : 1.5, step: 0.01,
            value: value[idx],
            oninput: (e) => {
              const pal = op.params[p.key].slice();
              pal[idx] = parseFloat(e.target.value);
              setParam(page, opIndex, p.key, pal);
              draw();
            },
          });
        }),
      ),
    ),
  );
  return h('div', { class: 'param pal-param' },
    h('label', {}, p.label),
    canvas, presetSel, detail,
  );
}

// --- music page ------------------------------------------------------------------

let penValue = 1; // degree painted onto bass/arp steps

function renderMusicPage(editor) {
  const m = state.project.music;
  const patNames = Object.keys(m.patterns);
  const sel = state.selPattern || patNames[0];
  state.selPattern = sel;
  const pat = m.patterns[sel];

  editor.append(
    h('div', { class: 'chips' },
      patNames.map((name) =>
        h('button', {
          class: `chip ${name === sel ? 'active' : ''}`,
          onclick: () => {
            if (name === sel) renamePattern(name);
            else { state.selPattern = name; emit('sel'); }
          },
        }, name),
      ),
      h('button', { class: 'chip add', onclick: addPattern }, '+'),
    ),
  );

  // step grid
  const grid = h('div', { class: 'music-grid' });
  for (const inst of INSTRUMENTS) {
    if (inst === 'pad') continue;
    const row = h('div', { class: 'music-row' },
      h('button', {
        class: `inst-label ${state.audio.muted.has(inst) ? 'muted' : ''}`,
        title: 'tap to mute',
        onclick: (e) => {
          if (state.audio.muted.has(inst)) state.audio.muted.delete(inst);
          else state.audio.muted.add(inst);
          e.target.classList.toggle('muted');
        },
      }, inst),
    );
    for (let s = 0; s < STEPS; s++) {
      const v = pat[inst][s];
      const isNote = inst === 'bass' || inst === 'arp';
      const cell = h('button', {
        class: `cell ${v ? 'on' : ''} ${v === -1 ? 'hold' : ''} ${v === 2 && inst === 'hat' ? 'open' : ''} ${s % 4 === 0 ? 'beat' : ''}`,
        onclick: () => {
          mutate(() => {
            const cur = pat[inst][s];
            if (isNote) pat[inst][s] = cur === 0 ? penValue : 0;
            else if (inst === 'hat') pat[inst][s] = cur === 0 ? 1 : cur === 1 ? 2 : 0;
            else pat[inst][s] = cur ? 0 : 1;
          }, { kind: 'param' });
          renderEditor();
        },
      }, isNote && v > 0 ? String(v) : isNote && v === -1 ? '–' : '');
      row.append(cell);
    }
    grid.append(row);
  }
  editor.append(grid);

  // note pen + pad chord
  editor.append(
    h('div', { class: 'music-tools' },
      h('span', { class: 'tool-label' }, 'note pen'),
      h('div', { class: 'seg' },
        [
          ['hold', -1], ['1', 1], ['2', 2], ['3', 3], ['4', 4], ['5', 5],
          ['6', 6], ['8', 8], ['10', 10], ['12', 12],
        ].map(([label, v]) =>
          h('button', {
            class: `seg-btn ${penValue === v ? 'active' : ''}`,
            onclick: (e) => {
              penValue = v;
              for (const b of e.target.parentElement.children) b.classList.remove('active');
              e.target.classList.add('active');
            },
          }, label),
        ),
      ),
      h('span', { class: 'tool-label' }, 'pad chord'),
      h('div', { class: 'seg' },
        ['off', '1', '2', '4', '5', '6'].map((label) => {
          const v = label === 'off' ? 0 : parseInt(label, 10);
          return h('button', {
            class: `seg-btn ${pat.pad === v ? 'active' : ''}`,
            onclick: () => { mutate(() => { pat.pad = v; }, { kind: 'param' }); renderEditor(); },
          }, label);
        }),
      ),
    ),
  );

  // mix
  editor.append(h('h4', { class: 'section-h' }, 'mix'));
  const mix = h('div', { class: 'mix' });
  for (const inst of INSTRUMENTS) {
    const val = m.gains?.[inst] ?? 1;
    mix.append(h('div', { class: 'param' },
      h('label', {}, inst),
      h('input', {
        type: 'range', min: 0, max: 1.5, step: 0.01, value: val,
        oninput: (e) => mutate(() => { m.gains[inst] = parseFloat(e.target.value); }, { kind: 'param' }),
      }),
    ));
  }
  editor.append(mix);

  // song sequence
  editor.append(h('h4', { class: 'section-h' }, `song — ${m.song.length} bars`));
  const song = h('div', { class: 'song-row' });
  m.song.forEach((name, i) => {
    const cell = h('select', {
      class: 'song-cell',
      onchange: (e) => mutate(() => { m.song[i] = e.target.value; }, { kind: 'param' }),
    },
      patNames.map((pn) => {
        const o = h('option', { value: pn }, `${i + 1}: ${pn}`);
        if (pn === name) o.selected = true;
        return o;
      }),
    );
    song.append(cell);
  });
  song.append(
    h('button', { class: 'mini', title: 'add bar', onclick: () => { mutate(() => m.song.push(m.song[m.song.length - 1] || patNames[0])); } }, '+'),
    h('button', { class: 'mini danger', title: 'remove last bar', onclick: () => { if (m.song.length > 1) mutate(() => m.song.pop()); } }, '−'),
  );
  editor.append(song);
  editor.append(h('p', { class: 'hint' }, 'tap cells to toggle steps. bass/arp paint the selected note-pen degree (numbers are scale degrees; hold sustains). one pattern per bar in the song row.'));
}

function addPattern() {
  const m = state.project.music;
  const base = m.patterns[state.selPattern] || makeEmptyPattern();
  let n = 1;
  while (m.patterns[`pat${n}`]) n++;
  const name = `pat${n}`;
  mutate(() => { m.patterns[name] = JSON.parse(JSON.stringify(base)); });
  state.selPattern = name;
  emit('sel');
}

function renamePattern(oldName) {
  const m = state.project.music;
  const name = prompt('pattern name', oldName);
  if (!name || name === oldName || m.patterns[name]) return;
  mutate(() => {
    m.patterns[name] = m.patterns[oldName];
    delete m.patterns[oldName];
    m.song = m.song.map((p) => (p === oldName ? name : p));
  });
  state.selPattern = name;
  emit('sel');
}

// --- seq page ---------------------------------------------------------------------

function renderSeqPage(editor) {
  const p = state.project;
  editor.append(
    h('div', { class: 'seq-globals' },
      h('div', { class: 'param inline' },
        h('label', {}, 'bpm'),
        h('input', {
          type: 'number', min: 40, max: 220, value: p.bpm,
          onchange: (e) => mutate(() => { p.bpm = parseFloat(e.target.value) || 120; }),
        }),
      ),
      h('div', { class: 'param inline' },
        h('label', {}, 'texture size'),
        h('select', {
          onchange: (e) => mutate(() => { p.texSize = parseInt(e.target.value, 10); }, { invalidate: 'tex' }),
        },
          [128, 256, 512].map((s) => {
            const o = h('option', { value: s }, `${s}²`);
            if (s === (p.texSize || 256)) o.selected = true;
            return o;
          }),
        ),
      ),
    ),
  );

  // timeline strip
  const totalBars = Math.max(1, ...p.shots.map((s) => s.start + s.len), p.music.song.length);
  const strip = h('div', { class: 'timeline-strip' });
  for (const shot of p.shots) {
    const scene = resolveRef('scene', shot.scene);
    strip.append(h('div', {
      class: 'strip-shot',
      style: `left:${(shot.start / totalBars) * 100}%;width:${(shot.len / totalBars) * 100}%`,
      onclick: () => state.audio.seek(shot.start * 4),
    }, scene?.name || '?'));
  }
  strip.append(h('div', { id: 'strip-playhead' }));
  editor.append(strip);

  // shot cards
  const list = h('div', { class: 'shot-list' });
  p.shots.forEach((shot, i) => {
    list.append(h('div', { class: 'shot-card' },
      h('span', { class: 'shot-n' }, `#${i + 1}`),
      h('div', { class: 'param inline' },
        h('label', {}, 'start'),
        h('input', { type: 'number', min: 0, value: shot.start, onchange: (e) => mutate(() => { shot.start = parseInt(e.target.value, 10) || 0; }) }),
      ),
      h('div', { class: 'param inline' },
        h('label', {}, 'bars'),
        h('input', { type: 'number', min: 1, value: shot.len, onchange: (e) => mutate(() => { shot.len = Math.max(1, parseInt(e.target.value, 10) || 1); }) }),
      ),
      h('div', { class: 'param inline' },
        h('label', {}, 'scene'),
        stackSelect('scene', shot.scene, (v) => mutate(() => { shot.scene = v; })),
      ),
      h('div', { class: 'param inline' },
        h('label', {}, 'post'),
        stackSelect('post', shot.post, (v) => mutate(() => { shot.post = v; })),
      ),
      h('span', { class: 'op-actions' },
        h('button', { class: 'mini', onclick: () => swapShots(i, i - 1) }, '↑'),
        h('button', { class: 'mini', onclick: () => swapShots(i, i + 1) }, '↓'),
        h('button', { class: 'mini danger', onclick: () => mutate(() => { p.shots.splice(i, 1); }) }, '×'),
      ),
    ));
  });
  list.append(h('button', {
    class: 'add-op',
    onclick: () => mutate(() => {
      const last = p.shots[p.shots.length - 1];
      p.shots.push({
        start: last ? last.start + last.len : 0,
        len: 4,
        scene: p.scenes[0]?.id,
        post: p.post[0]?.id,
      });
    }),
  }, '+ add shot'));
  editor.append(list);
  editor.append(h('p', { class: 'hint' }, 'shots cut between scenes on the bar grid — the same clock drives the music, so image and sound stay locked. inside scene expressions, sb counts beats since the shot began.'));
}

function stackSelect(page, value, onchange) {
  return h('select', { onchange: (e) => onchange(e.target.value) },
    stacksOf(page).map((s) => {
      const o = h('option', { value: s.id }, s.name);
      if (s.id === value) o.selected = true;
      return o;
    }),
  );
}

function swapShots(i, j) {
  const shots = state.project.shots;
  if (j < 0 || j >= shots.length) return;
  mutate(() => {
    const [s] = shots.splice(i, 1);
    shots.splice(j, 0, s);
  });
}

export function updateSeqPlayhead(beat) {
  const ph = $('#strip-playhead');
  if (!ph) return;
  const p = state.project;
  const totalBars = Math.max(1, ...p.shots.map((s) => s.start + s.len), p.music.song.length);
  ph.style.left = `${(beat / 4 / totalBars) * 100}%`;
}

// --- menu ------------------------------------------------------------------------

function openMenu() {
  const overlay = $('#overlay');
  overlay.replaceChildren(
    h('div', { class: 'picker', onclick: (e) => e.stopPropagation() },
      h('h3', {}, state.project.name || 'project'),
      h('div', { class: 'menu-list' },
        h('button', { class: 'ghost-btn wide', onclick: () => { closeOverlay(); exportJson(); } }, 'export project (json)'),
        h('button', { class: 'ghost-btn wide', onclick: () => { closeOverlay(); importJson(); } }, 'import project'),
        h('button', { class: 'ghost-btn wide', onclick: () => { closeOverlay(); undo(); } }, 'undo (z)'),
        h('button', {
          class: 'ghost-btn wide danger',
          onclick: () => {
            if (confirm('discard everything and reload the ARTEFAKT demo?')) {
              closeOverlay();
              clearSaved();
              setProject(makeDemoProject());
            }
          },
        }, 'reset to ARTEFAKT demo'),
      ),
      h('p', { class: 'hint' }, 'projects autosave to this browser. export json to keep or share a piece.'),
      h('p', { class: 'hint' },
        'baukasten is a tiny werkkzeug-style demotool — an experiment in AI as tool-writer rather than artefact-generator. every op is deterministic and inspectable; the artefacts are yours. engine: zig→wasm. ',
        h('a', { href: 'README.md', target: '_blank' }, 'read the concept'),
      ),
      h('button', { class: 'ghost-btn wide', onclick: closeOverlay }, 'close'),
    ),
  );
  overlay.classList.remove('hidden');
  overlay.onclick = closeOverlay;
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state.project, null, 1)], { type: 'application/json' });
  const a = h('a', {
    href: URL.createObjectURL(blob),
    download: `${(state.project.name || 'baukasten').toLowerCase().replace(/\W+/g, '-')}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJson() {
  const input = h('input', { type: 'file', accept: 'application/json' });
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        const proj = JSON.parse(text);
        if (!proj.textures || !proj.music) throw new Error('not a baukasten project');
        setProject(proj);
      } catch (e) {
        alert(`import failed: ${e.message}`);
      }
    });
  };
  input.click();
}

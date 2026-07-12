/*
 * docs.js — the one reference for the whole lab.
 *
 * The same text is (a) shown in the help overlay, (b) seeded into the
 * VFS as docs/REFERENCE.md, and (c) embedded in the agent's system
 * prompt. Human and machine performers read the same manual.
 */

export const REFERENCE_MD = `# spektrum reference

Time is measured in cycles (one cycle = one bar of four beats).
A Pattern is a pure function of time; the engine queries it just ahead
of the playhead. Everything below composes.

## slots & transport

    d1(pattern) … d9(pattern)   assign a pattern to a slot
    d1()                        silence slot 1
    hush()                      silence everything
    bpm(132)                    set tempo (4 beats per cycle)
    visual(\`...glsl...\`)        set the fragment shader (see visuals)

## mini-notation (inside quotes)

    "bd sn"          two events per cycle       "bd*2"      twice as fast
    "bd ~ sn ~"      ~ is a rest                "bd/2"      every 2nd cycle
    "[bd bd] sn"     nest to subdivide          "bd!3 sn"   repeat
    "<bd sn cp>"     alternate per cycle        "bd@3 sn"   weight (3:1)
    "[bd, hh*4]"     comma = stack (layers)     "hh?"       50% chance
    "bd(3,8)"        euclidean: 3 hits / 8      "bd:5"      sample variant

## sounds

Drums (synthesized from scratch, no samples on disk):
    bd sn hh oh cp rim lt mt ht cr click
Synths:
    sine tri saw square sub bass fm pluck noise

## controls (chainable)

    s("bd sn")                  sound name (also: sound)
    note("c3 e3 g3")            pitch by name or midi number
    n("0 3 7").scale("c3 minor") scale degrees; scales: major minor dorian
                                phrygian lydian mixolydian penta minpenta
    .gain(".9 .5") .pan("0 1") .speed(2)
    .cutoff(800) / .lpf(800) .resonance(8)
    .attack(.01) .release(.2) .legato(.5) .sustain(.6) .decay(.1)
    .delay(.3) .room(.4)        fx sends
    .crush(4)                   bitcrush
    .fmh(2) .fmi(8)             fm ratio / index (s("fm"))
    .detune(12)                 cents

## transformations

    .fast(2) .slow(2) .rev() .iter(4)
    .every(4, p => p.rev())     apply f every 4th cycle
    .off(0.125, p => p.gain(.4)) echo a transformed copy
    .ply(2)                     repeat each event
    .degrade() .degradeBy(.3)   random dropout (deterministic per cycle)
    .sometimes(f) .often(f) .rarely(f)
    .jux(p => p.rev())          original left, transformed right
    .struct("x ~ x x")          impose rhythm on a value pattern
    .euclid(3, 8)               euclidean structure

## signals (continuous, sample-at-event-time)

    sine cosine saw isaw tri square rand perlin()
    sine.range(200, 2000).slow(4)    e.g. .cutoff(sine.range(...))
    irand(8) choose("bd", "sn")

## combinators

    stack(a, b)      layers      seq(a, b)   one cycle, in order
    cat(a, b)        one per cycle            silence
    timecat([3,a],[1,b])         weighted     run(8)  0..7

## example

    d1( s("bd*2 [~ bd] sn ~").gain(.9) )
    d2( s("hh*8").gain(saw.range(.5, .15)).pan(sine) )
    d3( n("0 3 7 <10 12>").scale("c2 minpenta").s("bass")
        .cutoff(sine.range(300, 2400).slow(2)).resonance(6)
        .release(.12).legato(.6) )

## visuals

visual(\`...\`) compiles a GLSL fragment shader. Provided uniforms:
    vec2  u_res     resolution        float u_rms   overall level
    float u_time    seconds           float u_bass  low band
    float u_cycle   musical bars      float u_mid   mid band
    float u_beat    beat 0..4         float u_high  high band
Write a full void main() { ... gl_FragColor = ... }.
Compile errors keep the previous shader running.

## project files

    scene/pattern.js   the text program (run: evaluates it)
    scene/visual.glsl  the fragment shader (run: compiles it)
    scene/graph.json   the node patch (run: loads it into station II)
    docs/REFERENCE.md  this file
`;

export const KEYS_MD = `## keys (mod = ctrl or cmd)

  everywhere
    esc  or  mod+.        hush (panic — always works)
    mod+k                 command palette (scenes, stations, snapshots)
    space                 play — run the current scene
    1 / 2 / 3             switch station        t (tap)   tap tempo
    ?                     toggle this help      mod+s     save snapshot

  editor
    mod+enter             run block under cursor
    mod+shift+enter       run whole buffer
    mod+up / mod+down     nudge number ±1 and re-run its block
                          (shift = ×10, alt = ×0.1) — sweep params live
    mod+/                 toggle comment (mute a voice)
    mod+d                 duplicate line / selection
    alt+up / alt+down     move line
    tab / shift+tab       indent / dedent

  nodes
    dbl-click canvas      add node (type to filter, enter to place)
    drag port → port      connect · dbl-click cable: cut
    mod+d                 duplicate node · arrows: nudge (shift: coarse)
    del                   delete selection · paint the step cells
                          (alt-click a cell for an accent)

  agent
    enter                 send · shift+enter newline · up/down history
    click a tool chip     open that file in the editor
`;

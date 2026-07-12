// Run with: node spektrum/test/pattern.test.mjs
import {
  pure, seq, stack, slowcat, silence, mini, sine, timecat,
  s, note, bjorklund, noteToMidi, scaleDegree,
} from "../js/pattern.js";

let failures = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failures++;
    console.error(`FAIL ${name}\n  actual:   ${a}\n  expected: ${b}`);
  } else {
    console.log(`ok ${name}`);
  }
}
const q = (p, b = 0, e = 1) =>
  p.query(b, e).map((h) => [round3(h.b), round3(h.e), h.v]).sort((x, y) => x[0] - y[0]);
const round3 = (x) => Math.round(x * 1000) / 1000;

// pure
eq("pure one cycle", q(pure("bd")), [[0, 1, "bd"]]);
eq("pure two cycles", q(pure("bd"), 0, 2), [[0, 1, "bd"], [1, 2, "bd"]]);

// seq / fast / slow
eq("seq", q(seq("bd", "sn")), [[0, 0.5, "bd"], [0.5, 1, "sn"]]);
eq("fast", q(pure("x").fast(2)), [[0, 0.5, "x"], [0.5, 1, "x"]]);
eq("slow", q(seq("a", "b").slow(2), 0, 2), [[0, 1, "a"], [1, 2, "b"]]);

// slowcat rotation
eq("slowcat", q(slowcat("a", "b"), 0, 2), [[0, 1, "a"], [1, 2, "b"]]);
eq("slowcat cycle 2", q(slowcat("a", "b"), 2, 3), [[2, 3, "a"]]);

// stack
eq("stack", q(stack("a", "b")), [[0, 1, "a"], [0, 1, "b"]]);

// rev
eq("rev", q(seq("a", "b", "c").rev()), [[0, round3(1 / 3), "c"], [round3(1 / 3), round3(2 / 3), "b"], [round3(2 / 3), 1, "a"]]);

// every
const everied = seq("a", "b").every(2, (p) => p.rev());
eq("every c0", q(everied, 0, 1), [[0, 0.5, "b"], [0.5, 1, "a"]]);
eq("every c1", q(everied, 1, 2), [[1, 1.5, "a"], [1.5, 2, "b"]]);

// ply
eq("ply", q(seq("a", "b").ply(2)), [[0, 0.25, "a"], [0.25, 0.5, "a"], [0.5, 0.75, "b"], [0.75, 1, "b"]]);

// timecat
eq("timecat", q(timecat([3, "a"], [1, "b"])), [[0, 0.75, "a"], [0.75, 1, "b"]]);

// mini-notation
eq("mini basic", q(mini("bd sn")), [[0, 0.5, "bd"], [0.5, 1, "sn"]]);
eq("mini rest", q(mini("bd ~ sn ~")), [[0, 0.25, "bd"], [0.5, 0.75, "sn"]]);
eq("mini group", q(mini("bd [sn sn]")), [[0, 0.5, "bd"], [0.5, 0.75, "sn"], [0.75, 1, "sn"]]);
eq("mini fast", q(mini("bd*2 sn")), [[0, 0.25, "bd"], [0.25, 0.5, "bd"], [0.5, 1, "sn"]]);
eq("mini alt c0", q(mini("<a b>")), [[0, 1, "a"]]);
eq("mini alt c1", q(mini("<a b>"), 1, 2), [[1, 2, "b"]]);
eq("mini stack", q(mini("[a, b]")), [[0, 1, "a"], [0, 1, "b"]]);
eq("mini repeat", q(mini("a!2 b")), [[0, round3(1 / 3), "a"], [round3(1 / 3), round3(2 / 3), "a"], [round3(2 / 3), 1, "b"]]);
eq("mini weight", q(mini("a@3 b")), [[0, 0.75, "a"], [0.75, 1, "b"]]);
eq("mini numbers", q(mini("0 3.5")), [[0, 0.5, 0], [0.5, 1, 3.5]]);

// euclid via mini
eq("mini euclid", q(mini("bd(3,8)")).map((h) => h[0]), [0, 0.375, 0.75]);

// bjorklund
eq("bjorklund 3,8", bjorklund(3, 8), [true, false, false, true, false, false, true, false]);

// notes
eq("noteToMidi c3", noteToMidi("c3"), 48);
eq("noteToMidi a4", noteToMidi("a4"), 69);
eq("noteToMidi eb3", noteToMidi("eb3"), 51);
eq("scaleDegree", scaleDegree(2, "c3 minor"), 51);

// controls
eq("s control", q(s("bd sn")), [[0, 0.5, { s: "bd" }], [0.5, 1, { s: "sn" }]]);
eq("s with n", q(s("bd:3")), [[0, 1, { s: "bd", n: 3 }]]);
eq("note control", q(note("c3 e3")), [[0, 0.5, { note: 48 }], [0.5, 1, { note: 52 }]]);
eq("gain chain", q(s("bd sn").gain("1 .5")), [
  [0, 0.5, { s: "bd", gain: 1 }],
  [0.5, 1, { s: "sn", gain: 0.5 }],
]);
eq("chain signal", q(s("bd").cutoff(sine.range(0, 1000)))[0][2].s, "bd");

// signals
const sv = sine.query(0, 1)[0].v;
eq("sine mid", round3(sv), round3((Math.sin(Math.PI) + 1) / 2));

// scale method
eq("scale", q(note("0 2").scale("c3 minor")), [[0, 0.5, { note: 48 }], [0.5, 1, { note: 51 }]]);

// struct
eq("struct", q(pure("bd").struct(mini("t ~ t t"))).map((h) => h[0]), [0, 0.5, 0.75]);

// degrade determinism
const d1 = q(mini("hh*8").degrade(), 0, 4);
const d2 = q(mini("hh*8").degrade(), 0, 4);
eq("degrade deterministic", d1, d2);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall pattern tests passed");

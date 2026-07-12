// names.js — grammar-based font names, ChoiceWords style.
//
// A tiny generative grammar: rules are arrays of alternatives; <token>
// recurses. The genome's hash seeds the RNG, so every genome always
// carries the same name.

import { rng } from "./util.js";
import { genomeSeed } from "./genome.js";

const GRAMMAR = {
  root: ["<first> <suffix>", "<first> <suffix>", "<first> <mod> <suffix>"],
  first: ["<pre>", "<pre>", "<pre>", "<place>", "<pre><tail>"],
  pre: [
    "Vesper", "Okto", "Astra", "Bruta", "Kosmo", "Signa", "Hertz", "Vektor",
    "Nova", "Ratio", "Forma", "Mira", "Selva", "Umbra", "Lumen", "Orbis",
    "Fluor", "Nimbus", "Raster", "Plexus", "Kilo", "Zenit", "Fauna", "Talus",
    "Ipso", "Riga", "Corvo", "Pluto", "Vanta", "Ligne", "Modu", "Tesla",
  ],
  tail: ["na", "ra", "lux", "line", "gram", "graf", "type", "flex"],
  place: [
    "Antwerpen", "Scheldt", "Meridian", "Borealis", "Atlantik", "Pampus",
    "Vondel", "Tundra", "Fjord", "Halifax", "Lisboa", "Kyoto", "Ostend",
  ],
  mod: ["Neue", "Alt", "Pro", "Micro", "Grand", "Super", "Semi"],
};

function expand(token, rules, rand, depth = 0) {
  if (depth > 6) return "";
  const alts = rules[token];
  if (!alts) return token;
  const pick = alts[Math.floor(rand() * alts.length)];
  return pick.replace(/<([a-z]+)>/g, (_, t) => expand(t, rules, rand, depth + 1));
}

export function fontName(genome) {
  const rand = rng(genomeSeed(genome));
  // The suffix tells the truth about the genes.
  const serif = genome.serif > 0.18;
  const wide = genome.width > 0.75;
  const narrow = genome.width < 0.25;
  const italic = genome.slant > 0.75;
  const suffixes = serif
    ? ["Serif", "Slab", "Antiqua", "Text", "Book"]
    : ["Grotesk", "Sans", "Grotesque", "Lineal", "Mono"];
  let suffix = suffixes[Math.floor(rand() * suffixes.length)];
  if (suffix === "Mono") suffix = "Sans"; // we don't actually do mono (yet)
  const rules = { ...GRAMMAR, suffix: [suffix] };
  let name = expand("root", rules, rand);
  if (narrow) name += " Condensed";
  else if (wide) name += " Extended";
  if (italic) name += " Italic";
  return name;
}

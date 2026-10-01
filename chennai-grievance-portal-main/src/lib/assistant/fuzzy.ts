/**
 * Typo-tolerant matching for Ask District IQ: edit distance (Damerau-Levenshtein, so a swapped pair of letters
 * counts as one edit), a best-match picker that refuses to guess between equally close words, and the vegetable
 * names people use in Tamil, Tanglish and Hindi. No imports: it runs anywhere and is unit-tested directly.
 */

/** Edits between two words (insert, delete, substitute, swap neighbours); stops early past `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** How many edits a word of this length may carry and still be read as another: short words must be nearly exact. */
export const allowedEdits = (len: number) => (len <= 3 ? 0 : len <= 5 ? 1 : 2);

/**
 * The candidate closest to `word`, or null when none is close enough or two different candidates are equally close
 * (a guess between "ward" and "word" is worse than no correction).
 */
export function closest(word: string, candidates: Iterable<string>, max = allowedEdits(word.length)): string | null {
  if (max <= 0) return null;
  let bestD = max + 1, best: string[] = [];
  for (const c of candidates) {
    if (Math.abs(c.length - word.length) > max) continue;
    const dist = editDistance(word, c, max);
    // people rarely mistype the first letter: a different one costs the whole allowance ("matter" is not "water")
    if (c[0] !== word[0] && dist > 1) continue;
    if (dist < bestD) { best = [c]; bestD = dist; }
    else if (dist === bestD && !best.includes(c)) best.push(c);
  }
  if (!best.length || bestD > max) return null;
  if (best.length === 1) return best[0];
  // forms of one word ("tomato", "tomatoes") are not a real tie: the base form
  const base = best.reduce((a, b) => (b.length < a.length ? b : a));
  return best.every((c) => c.startsWith(base)) ? base : null;
}

/** Vegetable and fruit names as people say them, to the AGMARKNET commodity they mean. */
export const COMMODITY_ALIAS: Record<string, string> = {
  thakkali: "tomato", thakali: "tomato", tamatar: "tomato", tamaatar: "tomato", "தக்காளி": "tomato",
  vengayam: "onion", vengaayam: "onion", pyaz: "onion", pyaaz: "onion", "வெங்காயம்": "onion", "சின்ன வெங்காயம்": "onion",
  urulaikizhangu: "potato", urulai: "potato", aloo: "potato", alu: "potato", "உருளைக்கிழங்கு": "potato", "உருளை": "potato",
  kathirikai: "brinjal", kathrikai: "brinjal", baingan: "brinjal", eggplant: "brinjal", "கத்தரிக்காய்": "brinjal", "கத்திரிக்காய்": "brinjal",
  vazhaipazham: "banana", vazhai: "banana", "வாழைப்பழம்": "banana", "வாழை": "banana",
  vendakkai: "bhindi", ladiesfinger: "bhindi", okra: "bhindi", "வெண்டைக்காய்": "bhindi",
  murungakkai: "drumstick", "முருங்கைக்காய்": "drumstick", thengai: "coconut", "தேங்காய்": "coconut",
  elumichai: "lemon", "எலுமிச்சை": "lemon", poondu: "garlic", "பூண்டு": "garlic", inji: "ginger", "இஞ்சி": "ginger",
  milagai: "green chilli", pachaimilagai: "green chilli", "பச்சை மிளகாய்": "green chilli", chilli: "green chilli", chili: "green chilli",
  kothamalli: "coriander", "கொத்தமல்லி": "coriander", pudina: "mint", "புதினா": "mint",
  muttaikose: "cabbage", "முட்டைக்கோஸ்": "cabbage", poosanikai: "pumpkin", "பூசணிக்காய்": "pumpkin",
  vellarikkai: "cucumbar", cucumber: "cucumbar", "வெள்ளரிக்காய்": "cucumbar", mullangi: "raddish", radish: "raddish", "முள்ளங்கி": "raddish",
  carrot: "carrot", "கேரட்": "carrot", beans: "beans", "பீன்ஸ்": "beans", avarakkai: "green avare", "அவரைக்காய்": "green avare",
  pavakkai: "bitter gourd", "பாகற்காய்": "bitter gourd", suraikkai: "bottle gourd", "சுரைக்காய்": "bottle gourd",
  "peerkangai": "ridgeguard", "பீர்க்கங்காய்": "ridgeguard", pudalangai: "snakeguard", "புடலங்காய்": "snakeguard"
};

/** A commodity's comparable words: "Bhindi(Ladies Finger)" -> ["bhindi ladies finger", "bhindi", "ladies finger"]. */
function commodityKeys(name: string): string[] {
  const n = name.toLowerCase();
  const inner = n.match(/\(([^)]*)\)/)?.[1]?.trim();
  const outer = n.replace(/\(.*?\)/g, " ").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  return [...new Set([n.replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim(), outer, ...(inner ? [inner.replace(/[^a-z ]+/g, " ").trim()] : [])].filter(Boolean))];
}

/**
 * The commodities a request names, typos and local names included: "tomatoe" -> Tomato, "thakkali" -> Tomato,
 * "onion" -> Onion (not also Onion Green, unless asked), "tomato and onion" -> both. Returns the matched names from
 * `names`, and the words that matched nothing.
 */
export function matchCommodities(request: string, names: string[]): { matched: string[]; unknown: string[] } {
  const keyed = names.map((name) => ({ name, keys: commodityKeys(name) }));
  const parts = request.split(/\s*(?:,|&|\band\b|\bor\b|\/|\+|மற்றும்)\s*/i).map((p) => p.trim()).filter(Boolean);
  const matched: string[] = [], unknown: string[] = [];
  for (const raw of parts) {
    const plain = raw.toLowerCase().replace(/\b(price|prices|rate|rates|vilai|vila|cost|of|the|today|per|kg)\b/g, " ").replace(/\s+/g, " ").trim();
    const want = COMMODITY_ALIAS[plain] ?? COMMODITY_ALIAS[plain.replace(/[^a-z஀-௿]/g, "")] ?? plain.replace(/(es|s)$/, (m) => (plain.length > 5 ? "" : m));
    if (!want) continue;
    // exact name, then a name that starts with it, then the closest name within a typo or two
    const exact = keyed.filter((k) => k.keys.includes(want) || k.keys.includes(plain));
    // every word named, in any order ("green onion" = "Onion Green")
    const words = want.split(" ");
    const allWords = exact.length || words.length < 2 ? [] : keyed.filter((k) => k.keys.some((x) => words.every((w) => x.split(" ").includes(w))));
    const starts = exact.length || allWords.length ? [] : keyed.filter((k) => k.keys.some((x) => x.startsWith(want) || (want.length >= 4 && want.startsWith(x))));
    let hit = exact.length ? exact : allWords.length ? allWords : starts;
    if (!hit.length) {
      const keys = keyed.flatMap((k) => k.keys.map((x) => ({ x, name: k.name })));
      const c = closest(want, keys.map((k) => k.x));
      const byWord = c ? null : closest(want.split(" ")[0], keys.map((k) => k.x.split(" ")[0]));
      const name = c ? keys.find((k) => k.x === c)?.name : byWord ? keys.find((k) => k.x.split(" ")[0] === byWord)?.name : null;
      hit = name ? keyed.filter((k) => k.name === name) : [];
    }
    // "onion" means Onion, not also "Onion Green": the shortest names among several prefix matches
    if (hit.length > 1 && !exact.length) {
      const shortest = Math.min(...hit.map((k) => k.name.length));
      if (hit.some((k) => k.keys.includes(want))) hit = hit.filter((k) => k.keys.includes(want));
      else hit = hit.filter((k) => k.name.length === shortest);
    }
    if (hit.length) for (const k of hit) { if (!matched.includes(k.name)) matched.push(k.name); }
    else unknown.push(raw);
  }
  return { matched, unknown };
}

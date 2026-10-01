/**
 * Reply language for Ask District IQ: English, Tamil (Tamil script) or Tanglish (Tamil
 * written in English letters, usually mixed with English). The answer, refusals, chips,
 * chart labels and the spoken summary all follow the question's language; the language
 * chip in the dialog can override detection.
 *
 * Detection is rules only (Tamil-script share plus a small romanised-Tamil lexicon), so
 * it is instant, free and testable. No model is asked. This module has no imports, so it
 * runs anywhere (server, browser, `node --test`).
 */

export type Lang = "en" | "ta" | "tanglish";
export type LangChoice = Lang | "auto";
export const LANGS: readonly Lang[] = ["en", "ta", "tanglish"];

export interface LangDetection {
  lang: Lang;
  /** 0..1: Tamil-script share for Tamil, lexicon evidence for Tanglish, 1 minus that evidence for English */
  confidence: number;
  /** romanised-Tamil words found (Tanglish evidence), for the "how this was understood" panel */
  hits: string[];
}

const TAMIL_LETTER = /[஀-௿]/g;
const LATIN_LETTER = /[A-Za-z]/g;

export function hasTamilScript(s: string): boolean {
  return /[஀-௿]/.test(s);
}

/** Share of letters that are Tamil script (0..1). */
export function tamilShare(s: string): number {
  const ta = s.match(TAMIL_LETTER)?.length ?? 0;
  const la = s.match(LATIN_LETTER)?.length ?? 0;
  return ta + la ? ta / (ta + la) : 0;
}

/**
 * Romanised Tamil, spelled the many ways people type it. Words are compared after
 * lower-casing and collapsing doubled letters ("irukku" = "iruku", "paaru" = "paru").
 * STRONG words are not English words; WEAK ones are short particles and suffixes
 * ("la", "ku", "nu") that need company before they count.
 */
const STRONG = [
  "enna", "yenna", "ennaa", "evlo", "evalo", "evvalo", "evvalavu", "evalavu", "ethana", "ethanai", "eththana", "yethana",
  "enga", "engae", "yenga", "eppo", "eppothu", "eppadi", "epdi", "yepdi", "yeppadi", "yaar", "yaaru", "yaru",
  "edhu", "ethu", "endha", "entha", "edhukku", "ethukku", "ennachu", "enaachu",
  "indha", "intha", "indhe", "andha", "antha",
  "inniki", "innikku", "innaiku", "innaikku", "inaiku", "nethu", "nethiku", "naalaikku", "vaaram", "vaarathula", "maasam",
  "maasathula", "ippo", "ippa", "appo", "aprom", "apram",
  "iruku", "irukku", "irukka", "irukkaa", "irukudhu", "irukkudhu", "irukkuthu", "irundhuchu", "irundhadhu", "irukkanga",
  "illa", "illai", "illaya", "illaiya", "illama", "venum", "vendum", "venam", "vendam", "venuma",
  "sollu", "sollunga", "sollungo", "sollen", "sonna", "solla", "kaattu", "kaatu", "kaatunga", "kaattunga", "kaaminga",
  "kaamikka", "paaru", "paarunga", "paathu", "parunga", "anuppu", "anupu", "anuppunga", "anupunga", "anuppi",
  "podu", "podunga", "pannu", "pannunga", "panni", "pannalaam", "pannanum", "pannuvom",
  "aagum", "aachu", "aayiduchu", "varudhu", "varuthu", "vandhuchu", "vanthuchu", "theriyuma", "theriyum", "therinja",
  "theriyala", "mudiyuma", "mudiyum", "mudiyadhu", "mudiyathu", "kudunga", "edunga", "vaanga",
  "pathi", "paththi", "patthi", "kitta", "kooda", "mattum", "dhaan", "thaan",
  "romba", "rombha", "konjam", "adhigam", "athigam", "adhigama", "athigama", "kammi", "kuraivu", "kuraiva", "periya",
  "chinna", "pudhu", "puthu", "ellam", "ellaam", "elaam", "ellame", "mothama",
  "kulla", "kulle", "velila", "keezha",
  "naan", "neenga", "avanga", "enakku", "enaku", "unakku", "namma", "nammoda", "ungaloda",
  "thanni", "kuppai", "saalai", "mazhai", "vellam", "veedu",
  "machan", "macha", "muzhusum", "muzhukka", "kelunga", "kekkanum", "keluga"
];
const WEAK = [
  "la", "le", "ku", "kku", "nu", "nnu", "oda", "ode", "laam", "da", "di", "pa", "ma", "um", "ah", "sari", "seri",
  "dei", "yen", "ipo", "epo", "mela", "nee", "inda", "anda", "naal", "naala", "varam", "nga", "kami", "unga", "nalla",
  "panna", "masam"
];

/** lower-case and collapse doubled letters, so spelling variants compare equal */
const fold = (w: string) => w.toLowerCase().replace(/(.)\1+/g, "$1");
const STRONG_SET = new Set(STRONG.map(fold));
const WEAK_SET = new Set(WEAK.map(fold));
/** A romanised-Tamil word (any common spelling): never "corrected" into an English or place word. */
export const isTanglishWord = (w: string) => STRONG_SET.has(fold(w)) || WEAK_SET.has(fold(w)) || GLUED_WORD.test(w) || GLUED.test(w);
/** English words that a folded Tanglish spelling collides with ("thaan" -> "than", "chinna" -> "china", "naan" -> "nan"). */
const ENGLISH = new Set(["than", "china", "nan"]);
/** "9ku", "zone9la": a Tamil case ending glued to a number */
const GLUED = /^[a-z]*\d+(ku|kku|la|le|oda)$/i;
/** "fridaykulla", "officerukku": a Tamil postposition glued to a word */
const GLUED_WORD = /^[a-z]{3,}(kulla|ukku|kitta|pathi|paththi)$/i;

/** Detect the language a question is written (or was spoken) in. */
export function detectLanguage(text: string): LangDetection {
  const s = String(text ?? "");
  const ta = s.match(TAMIL_LETTER)?.length ?? 0;
  const share = tamilShare(s);
  // Any real Tamil-script content means a Tamil reply, even when English words are mixed in.
  if (ta >= 3 && share >= 0.15) return { lang: "ta", confidence: Math.round(Math.min(1, 0.5 + share) * 100) / 100, hits: [] };

  const hits: string[] = [];
  let strong = 0, weak = 0;
  for (const raw of s.split(/[^A-Za-z0-9]+/)) {
    if (!raw || ENGLISH.has(raw.toLowerCase())) continue;
    const w = fold(raw);
    if (STRONG_SET.has(w)) { strong++; hits.push(raw); }
    else if (WEAK_SET.has(w) || GLUED.test(raw) || GLUED_WORD.test(raw)) { weak++; hits.push(raw); }
  }
  const score = strong * 2 + weak;
  if (strong >= 1 || weak >= 2) {
    return { lang: "tanglish", confidence: Math.round(Math.min(1, 0.4 + score / 8) * 100) / 100, hits };
  }
  return { lang: "en", confidence: Math.round((score ? 0.7 : 0.95) * 100) / 100, hits };
}

/** The language to reply in: the chip wins when set; otherwise the question's own language. */
export function replyLanguage(text: string, choice: LangChoice = "auto"): Lang {
  return choice !== "auto" ? choice : detectLanguage(text).lang;
}

/**
 * Voice for the spoken reply. Tanglish is shown in English letters but spoken from a
 * Tamil-script summary: Tamil voices cannot read romanised Tamil.
 */
export function voiceLang(lang: Lang): "en-IN" | "ta-IN" {
  return lang === "en" ? "en-IN" : "ta-IN";
}

/** Language hint for speech-to-text: Tamil for Tamil and Tanglish speech, English otherwise. */
export function sttHint(lang: LangChoice): "ta" | "en" | undefined {
  return lang === "auto" ? undefined : lang === "en" ? "en" : "ta";
}

// -------------------------------------------------------------- numbers --

/** Indian digit grouping: 123456 -> "1,23,456". */
export function formatIndian(n: number, decimals = 0): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ------------------------------------------------------------ UI strings --

type Strings = Record<Lang, string>;

/** Fixed strings the assistant shows or speaks in every language. Everything else is composed per answer. */
export const TEXT = {
  greeting: {
    en: "Hello. Ask me about Chennai's incidents, complaints, weather, market prices or follow-ups.",
    ta: "வணக்கம்! சென்னை மாவட்டத்தின் சம்பவங்கள், புகார்கள், வானிலை, சந்தை விலைகள் பற்றி என்னிடம் கேளுங்கள்.",
    tanglish: "Vanakkam! Chennai district-oda incidents, complaints, weather, market prices pathi kelunga."
  },
  refusal: {
    en: "I can only help with Chennai district data.",
    ta: "சென்னை மாவட்டத் தரவு பற்றி மட்டுமே என்னால் உதவ முடியும்.",
    tanglish: "Naan Chennai district data pathi mattum dhaan help panna mudiyum."
  },
  tryThese: { en: "Try:", ta: "இப்படிக் கேளுங்கள்:", tanglish: "Try pannunga:" },
  testData: { en: "test data", ta: "சோதனைத் தரவு", tanglish: "test data" },
  districtWide: { en: "District-wide", ta: "மாவட்டம் முழுவதும்", tanglish: "District muzhukka" },
  allDepts: { en: "all departments", ta: "அனைத்துத் துறைகளும்", tanglish: "ella departments" },
  asOf: { en: "as of", ta: "தரவு நேரம்", tanglish: "as of" },
  latest: { en: "Latest data", ta: "சமீபத்திய தரவு", tanglish: "Latest data" },
  zone: { en: "Zone", ta: "மண்டலம்", tanglish: "Zone" },
  taluk: { en: "taluk", ta: "வட்டம்", tanglish: "taluk" }
} satisfies Record<string, Strings>;

export const PERIOD_LABEL: Record<"daily" | "weekly" | "monthly" | "quarterly", Strings> = {
  daily: { en: "Last 24 hours", ta: "கடந்த 24 மணி நேரம்", tanglish: "Last 24 hours" },
  weekly: { en: "Last 7 days", ta: "கடந்த 7 நாட்கள்", tanglish: "Last 7 days" },
  monthly: { en: "Last 30 days", ta: "கடந்த 30 நாட்கள்", tanglish: "Last 30 days" },
  quarterly: { en: "Last 90 days", ta: "கடந்த 90 நாட்கள்", tanglish: "Last 90 days" }
};

/** Example questions for the empty dialog and for refusals, one set per language. */
export const EXAMPLES: Record<Lang, string[]> = {
  en: ["Which zone needs attention now?", "Severe incidents this week by department", "Which lakes are more than 90% full?",
    "Prepare today's briefing"],
  ta: ["இப்போது எந்த மண்டலத்திற்கு கவனம் தேவை?", "இந்த வாரம் துறை வாரியாக கடுமையான சம்பவங்கள்",
    "எந்த ஏரிகள் 90%-க்கு மேல் நிரம்பியுள்ளன?", "இன்றைய சுருக்க அறிக்கையைத் தயார் செய்யுங்கள்"],
  tanglish: ["Ippo endha zone-ku attention venum?", "Indha week evlo severe incidents?", "Endha lakes 90% mela full-a irukku?",
    "Innaikku briefing ready pannunga"]
};

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  onnu: 1, rendu: 2, randu: 2, moonu: 3, munu: 3, naalu: 4, nalu: 4, anju: 5, ainthu: 5, aaru: 6, ezhu: 7, ettu: 8, ombodhu: 9, onbadhu: 9, pathu: 10, patthu: 10,
  "ஒன்று": 1, "இரண்டு": 2, "மூன்று": 3, "நான்கு": 4, "ஐந்து": 5, "ஆறு": 6, "ஏழு": 7, "எட்டு": 8, "ஒன்பது": 9, "பத்து": 10
};
const NUM = `(\\d{1,2}|${Object.keys(NUM_WORDS).join("|")})`;
const EDGE_L = "(?:^|[^\\p{L}\\p{M}\\d])", EDGE_R = "(?![\\p{L}\\p{M}\\d])";
// "first 5 days" and "top 10%" are a window and a share, not a count of items
const NOT_ITEMS = "(?!\\s*(?:days?|weeks?|months?|hours?|hrs?|years?|%|percent|நாட்கள்|நாள்|வாரம்|மாதம்|naal|vaaram|maasam))";
const COUNT_RES = [
  new RegExp(`${EDGE_L}(?:top|first|worst|highest|lowest|leading|biggest|largest|busiest|bottom|least|முதல்|டாப்)\\s*-?\\s*${NUM}${EDGE_R}${NOT_ITEMS}`, "iu"),
  // "Zone 13 most affected" names a zone, not a count
  new RegExp(`${EDGE_L}(?<!(?:zone|ward|taluk|no\\.?|number|மண்டலம்|வார்டு)\\s*-?\\s*)${NUM}\\s+(?:most|highest|lowest|worst|top|biggest|busiest|largest|leading|least|smallest)${EDGE_R}`, "iu")
];

/**
 * How many items the question asks for ("top 3", "top three", "first 5", "5 worst", "முதல் 3", "top moonu"), 1-25; null when it
 * names no count. The answer then shows exactly that many, not ten and an "Others" bar.
 */
export function requestedCount(question: string): number | null {
  for (const re of COUNT_RES) {
    const m = re.exec(question);
    if (!m) continue;
    const raw = m[1].toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : NUM_WORDS[raw] ?? NUM_WORDS[m[1]];
    if (n >= 1 && n <= 25) return n;
  }
  return null;
}

/** The question asks for a picture: a chart, graph, diagram, plot or map (English, Tamil, Tanglish). Otherwise the answer is words. */
export const wantsVisual = (q: string) =>
  /\b(visuali[sz]e|visuali[sz]ation|visually|chart|charts|graph|graphs|graphical|diagram|plot|plotted|map|maps|mapped|pie|donut|histogram|heat ?map|infographic|draw|picture|pictorial|pictorially|trend ?line|trend|trends|over time)\b|on (the )?map|வரைபட|விளக்கப்பட|படமாக|graph-?[aā]|chart-?[aā]|map-?la|padam/i.test(q);

/** The Collector wants words, not a picture ("just tell me", "no chart", "in words"). */
export const wantsNoVisual = (q: string) =>
  /\b(no (chart|graph|picture)|without (a |any )?(chart|graph|picture)|in words|just (tell|say|give me the number)|text only|only text|don'?t (draw|show) (a |any )?(chart|graph))\b/i.test(q);

/**
 * The question is best understood as a picture even without asking for one: a ranking ("top 3 worst zones", "which
 * department has the most"), a comparison ("this week vs last"), a breakdown ("by zone", "zone-wise", "share"), a trend
 * ("over time", "rising") or where things are ("hotspots", "location wise"). A single fact, one incident, a count or a
 * definition is not: it is answered in words.
 */
export function wantsVisualByNature(q: string): boolean {
  if (requestedCount(q) != null) return true; // top 3, first 5, முதல் 3, top moonu
  return /\b(top|bottom|worst|best|highest|lowest|leading|busiest|ranks?|ranking|ranked)\b|\b(most|least)\b(?!\s+(recent|recently|of))/i.test(q)
    || /\b(compare|comparison|comparing|vs\.?|versus|side by side|week on week|month on month|against (last|the previous|previous))\b|ஒப்பிடு|ஒப்பீடு/i.test(q)
    || /\bby (zones?|departments?|dept|categor(y|ies)|types?|wards?|taluks?|markets?|localit(y|ies)|areas?|sources?|severity|days?|weeks?|months?)\b|\b(zone|ward|area|location|locality|department|dept|category|taluk|market|place|type)[\s-]*wise\b|\b(breakdown|distribution|share|split|proportion)\b|வாரியாக|wise-?a/i.test(q)
    || /\b(trends?|over time|per day|day by day|week by week|month by month|rising|increasing|decreasing|going up|going down|growth|pattern)\b|போக்கு|அதிகரி/i.test(q)
    || /\b(where (are|is|were|do|did)|hotspots?|clusters?)\b|எங்கே|enga\b/i.test(q)
    || /\bwhich (zones|departments|wards|areas|lakes|markets|localities|taluks|places|categories|hospitals)\b/i.test(q);
}

/** The question asks for a list or a table of records. */
export const wantsTable = (q: string) =>
  /\b(list|lists|table|tabulate|tabular|spreadsheet|show (me )?(all |the )*(incidents|complaints|cases|records|rows)|which incidents)\b|பட்டியல்|list-?a/i.test(q);

/** What the assistant covers, for refusals: said once, not repeated in the headline. */
export const COVERS: Record<Lang, string> = {
  en: "I answer from the Chennai district data on this console: incidents and complaints by zone, ward, taluk and department; lakes, rain, air quality and IMD warnings; hospital beds; market prices; and the day's briefing.",
  ta: "இந்த கன்சோலில் உள்ள சென்னை மாவட்டத் தரவிலிருந்து பதில் தருகிறேன்: மண்டலம், வார்டு, வட்டம், துறை வாரியாகச் சம்பவங்கள் மற்றும் புகார்கள்; ஏரிகள், மழை, காற்றின் தரம், IMD எச்சரிக்கைகள்; மருத்துவமனைப் படுக்கைகள்; சந்தை விலைகள்; அன்றைய சுருக்க அறிக்கை.",
  tanglish: "Indha console-la irukkira Chennai district data-la irundhu dhaan answer pannuven: zone, ward, taluk, department wise incidents and complaints; lakes, rain, air quality, IMD warnings; hospital beds; market prices; innaikku briefing."
};

/** The polite out-of-scope reply: one sentence plus example questions, in the user's language. */
export function refusal(lang: Lang, examples = 2): { text: string; examples: string[] } {
  const ex = EXAMPLES[lang].slice(0, examples);
  return { text: `${TEXT.refusal[lang]} ${TEXT.tryThese[lang]} '${ex[0]}'`, examples: ex };
}

/**
 * Typo correction for Ask District IQ, before anything reads the question: "incidnets in adyr" becomes
 * "incidents in adyar", "tomatoe prifce" becomes "tomato price". Words are corrected only toward the district's own
 * vocabulary (its places, incident categories, market commodities and the console's terms), only when one word is
 * clearly closest, and never when the word is a real English word (274,000-word list from the word-list package) or
 * romanised Tamil. Tamil script is left as typed. The card says what was corrected ("Understood as ..."), as a search
 * engine does.
 */
import fs from "fs";
import path from "path";
import { categoryWords, placeNames } from "@/lib/collector/nlp";
import { COMMODITY_ALIAS, allowedEdits, closest } from "@/lib/assistant/fuzzy";
import { isTanglishWord } from "@/lib/assistant/lang";

/** The console's own terms: what questions to District IQ are made of. */
const DOMAIN = `incident incidents complaint complaints grievance grievances severe severity serious critical department departments zone zones
ward wards taluk taluks district hospital hospitals lake lakes reservoir reservoirs rainfall rain flood floods flooding waterlogging warning
warnings pollution quality weather temperature humidity briefing briefings verification verify verified pending open opened closed resolved
unresolved overdue backlog officer officers official officials contact contacts price prices market markets vegetable vegetables accident
accidents theft crime crimes garbage drainage sewage streetlight streetlights pothole potholes dengue fever malaria cholera water supply power
electricity trend trends weekly monthly quarterly daily today yesterday attention hotspot hotspots location locations locality localities area
areas breakdown compare comparison previous highest lowest average number count total show list which where what when how many much latest
news stories story developing dashboard console filter status priority report reports reported police fire traffic tree trees stray dogs
mosquito sanitation encroachment building collapse drinking contamination outbreak cases beds occupancy oxygen ambulance school schools
tomato tomatoes onion onions potato potatoes brinjal banana carrot beans cabbage cauliflower garlic ginger lemon coconut drumstick pumpkin
cucumber radish beetroot chilli coriander mint mango apple grapes orange papaya pineapple guava pomegranate greens spinach peas
koyambedu uzhavar sandhai aqi imd cpcb gcc chennai tamil nadu corporation collector map chart table pie graph export download`.split(/\s+/);

/**
 * Common English words that sit one edit from a district word ("words"/"wards", "rate"/"date", "like"/"lake"): they
 * are left alone. Words of three letters or fewer are never corrected at all.
 */
const COMMON = new Set(`about above after again against along also always among another answer anyone anything around away back
based because been before being below best better between both bring call came cannot care case cash come could data date dates days
does done down each easy either else even ever every fact fair fall feel file find fine first five form four free from full gave give
given goes going gone good great half hand happen hard have having head hear help here high hold home hope hour hours idea into just
keep kind knew know known large last late later least left less life like line little live long look looking made main make many mean
means might mind miss more most move much must name near need needs never next nice none note nothing number often once only other
over part past pick place plan play plus point post pull push put rate read real reason same save seem seen self send sent seven
share short should side since some something soon sort start state stay still stop such sure take taken talk tell than thank thanks
that their them then there these they thing things think this those though three through till time times told took turn under until
upon used using very wait want wanted wants week weeks were what whatever when where whether which while whom whose wide will wish
with within without word words work world would write wrong year years your yours zero give show tell find please kindly matter matters
problem problems issue issues happened happening update updates people person region city town village street road roads near nearby
recent recently current currently month months overall maximum minimum percent percentage level levels full empty filled amount rise rising
fall falling increase increased decrease decreased change changed changes growth cause causes reasons detail details summary summarise
summarize explain meaning view visual worst major minor medium could would should sorry okay fine great hello thanks morning evening
night noon many more most less least much very really quite since until while during across behind beside beyond inside outside
another other others anyone someone everyone nobody everything something whole part parts piece pieces kind type types sort sorts
wise rates list lists give gives shown showing tells telling asked asking answer answers check checking status reply rupees kilo kilos`.split(/\s+/));

declare global {
  // eslint-disable-next-line no-var
  var __spellVocab: { at: number; words: Set<string>; list: string[] } | undefined;
  // eslint-disable-next-line no-var
  var __englishWords: Set<string> | undefined;
}

/** Real English words ("slowest", "review", "wise"): never corrected, however close to a district word. */
function english(): Set<string> {
  if (!global.__englishWords) {
    try {
      global.__englishWords = new Set(fs.readFileSync(path.join(process.cwd(), "node_modules", "word-list", "words.txt"), "utf8").split(/\r?\n/));
    } catch {
      console.warn("[assistant] word-list not found: typo correction falls back to the short common-word list");
      global.__englishWords = new Set();
    }
  }
  return global.__englishWords;
}

async function vocabulary(): Promise<{ words: Set<string>; list: string[] }> {
  if (global.__spellVocab && Date.now() - global.__spellVocab.at < 6 * 3600_000) return global.__spellVocab;
  const places = await placeNames().catch(() => [] as string[]);
  const words = new Set<string>();
  const add = (s: string) => { for (const w of s.toLowerCase().split(/[^a-z]+/)) if (w.length >= 4) words.add(w); };
  [...DOMAIN, ...places, ...categoryWords(), ...Object.keys(COMMODITY_ALIAS).filter((k) => /^[a-z]+$/.test(k)), ...Object.values(COMMODITY_ALIAS)].forEach(add);
  global.__spellVocab = { at: Date.now(), words, list: [...words] };
  return global.__spellVocab;
}

export interface Spelled { text: string; fixes: { from: string; to: string }[] }

/** The question with its typos corrected toward the district's vocabulary, and what was changed. */
export async function correctSpelling(text: string): Promise<Spelled> {
  const v = await vocabulary();
  const en = english();
  const fixes: Spelled["fixes"] = [];
  const out = text.replace(/[A-Za-z]{3,}/g, (tok, at: number) => {
    const w = tok.toLowerCase();
    // known words, English, Tanglish, codes (INC-..., ZONE13) and words glued to digits stay as typed
    if (v.words.has(w) || en.has(w) || COMMON.has(w) || isTanglishWord(w) || /[\d-]/.test(text[at - 1] ?? "") || /\d/.test(text[at + tok.length] ?? "")) return tok;
    // another form of a known word ("compared", "floods", "reporting") is not a typo
    const stems = [w.replace(/s$/, ""), w.replace(/es$/, ""), w.replace(/ing$/, ""), w.replace(/ing$/, "e"), w.replace(/ed$/, ""), w.replace(/d$/, ""), w.replace(/ly$/, "")];
    if (stems.some((s) => s !== w && (v.words.has(s) || COMMON.has(s)))) return tok;
    // short words are corrected only for a dropped letter ("lak" -> "lake", "adyr" -> "adyar"), never a changed one ("wise" is not "wire");
    // three-letter ones only toward the console's own terms
    const pool = w.length === 3 ? DOMAIN.filter((d) => d.length === 4) : w.length === 4 ? v.list.filter((d) => d.length === 5) : v.list;
    const to = closest(w, pool, w.length <= 4 ? 1 : allowedEdits(w.length));
    if (!to) return tok;
    fixes.push({ from: tok, to });
    return tok[0] === tok[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
  });
  return { text: out, fixes };
}

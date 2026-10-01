/**
 * Checks that run before any model is asked, as a second line behind the router:
 * requests for citizens' personal details, requests to change or delete data, attempts to
 * override the assistant's instructions, and email addresses outside the official
 * directory are refused here, whatever a model would say. Large requests are flagged.
 *
 * offlineRoute() is the fallback when no AI provider is available: simple rules that pick a
 * tool, so the dialog still answers (every number still comes from the tools) and says it
 * is working without the language model.
 */
import { RowDataPacket } from "mysql2";
import intelPool, { ops } from "@/lib/collector/db";
import { looksBulk } from "@/lib/assistant/limits";
import type { RefNames } from "@/lib/assistant/scope";

export type GuardVerdict = { kind: "unsafe"; reason: string } | { kind: "off_topic"; topic: string } | { kind: "bulk" } | null;

/**
 * Questions plainly outside the district data, answered at once without a model: the topic is named in the
 * refusal, so the Collector sees it was understood. Anything that also mentions the district's data goes on to
 * the router, which decides.
 */
const TOPICS: [RegExp, string][] = [
  [/\b(ipl|cricket|football|soccer|world cup|olympics?|kabaddi|tennis|csk|dhoni|kohli|match score|who won the (match|game|cup|series))\b/i, "sports"],
  [/\b(movies?|films?|cinema|songs?|lyrics|actor|actress|celebrit(y|ies)|netflix|web ?series|box office|tv shows?|serial)\b/i, "entertainment"],
  [/\b(python|javascript|typescript|java|c\+\+|html|css|regex|coding|programming|debug|write (a |some |the )?(code|program|script|function))\b/i, "coding"],
  [/\b(write|compose|tell|make|give)\b.{0,20}\b(poem|poetry|story|joke|riddle|essay|song|haiku|rap|shayari)\b|\b(joke|poem|riddle|haiku)s?\b/i, "writing"],
  [/\b(capital of|president of|prime minister of|who invented|who discovered|history of|meaning of life|how far is|tallest|largest (country|planet|ocean))\b/i, "general"],
  [/\b(stocks?|share price|sensex|nifty|bitcoin|crypto(currency)?|mutual funds?|trading|forex|gold rate)\b/i, "finance"],
  [/\b(horoscope|astrology|zodiac|rasi palan|palmistry|numerology|jathagam)\b/i, "astrology"],
  [/\b(recipe|how to cook|cooking)\b/i, "cooking"],
  [/\b(homework|assignment|exam paper|syllabus|solve (this|the|my) (equation|problem|sum))\b/i, "homework"],
  [/\b(which party|vote for|election result|opinion on (the )?(government|minister|cm|pm))\b/i, "politics"],
  [/\b(bangalore|bengaluru|mumbai|delhi|hyderabad|kolkata|pune|coimbatore|madurai|trichy|tiruchirappalli|salem|tirunelveli|kerala|karnataka|andhra|telangana|another district|other districts?)\b/i, "elsewhere"]
];
/** Words that tie a message to the console's data: with one of these, the router decides, never this list. */
const DATA_WORDS = /\b(incidents?|complaints?|grievances?|zones?|wards?|taluks?|departments?|dept|lakes?|reservoirs?|hospitals?|beds?|aqi|air quality|rain(fall)?|floods?|warnings?|imd|mandi|vegetables?|tomato(es)?|onions?|potato(es)?|brinjal|uzhavar|koyambedu|chennai|gcc|police|severe|briefing|verif\w*|officers?|officials?|news|developing|hotspots?|dashboard|console|trend|accidents?|crimes?|theft|fires?|drains?|garbage|water|power|roads?|dengue|cases|reports?|district)\b|சம்பவ|புகார்|மண்டல|வார்டு|ஏரி|மழை|மருத்துவமனை|விலை|சென்னை/i;

/** The topic of a question plainly outside the district data, or null. */
export function offTopic(message: string): string | null {
  const hit = TOPICS.find(([re]) => re.test(message));
  if (!hit) return null;
  // another city is out of scope whatever it asks about; the rest only when nothing ties it to the data
  if (hit[1] !== "elsewhere" && DATA_WORDS.test(message)) return null;
  if (hit[1] === "elsewhere" && /chennai|சென்னை/i.test(message)) return null;
  return hit[1];
}

const UNSAFE: [RegExp, string][] = [
  [/\b(phone|mobile|cell|contact|whatsapp)\s*(no\.?|number|details?)?\b.{0,50}\b(citizen|complainant|resident|reporter|caller|victim|person|people|filed|complained|reported)/i, "personal data"],
  [/\b(citizen|complainant|resident|reporter|caller|victim)s?('s)?\b.{0,50}\b(phone|mobile|number|address|aadhaa?r|email|e-mail|name|identity|details)\b/i, "personal data"],
  [/\bwho (filed|complained|reported|lodged)\b.{0,40}\b(name|phone|number|address)|\b(name|phone|address) of (the )?(person|citizen|complainant)/i, "personal data"],
  [/\baadhaa?r\b|ஆதார்/i, "personal data"],
  [/(தொலைபேசி|கைபேசி|செல்பேசி|முகவரி|பெயர்).{0,30}(புகார்தாரர்|குடிமக|புகார் அளித்த)|(புகார்தாரர்|புகார் அளித்த).{0,30}(தொலைபேசி|கைபேசி|முகவரி|பெயர்)/, "personal data"],
  [/\b(delete|drop|truncate|erase|wipe|purge|destroy)\b.{0,40}\b(complaints?|incidents?|records?|data|tables?|database|rows?|entries|logs?|everything)\b/i, "data change"],
  [/\b(modify|change|edit|update|alter|overwrite|insert)\s+(the\s+|a\s+|this\s+|these\s+|all\s+|every\s+)?(status|records?|data|database|tables?|entr(y|ies)|incidents?|complaints?)\b/i, "data change"],
  [/\bmark\b.{0,40}\bas\s+(resolved|verified|closed|rejected|done)\b/i, "data change"],
  [/(நீக்கு|அழி|நீக்கவும்|அழிக்கவும்).{0,20}(புகார்|சம்பவ|தரவு)|(புகார்|சம்பவ|தரவு).{0,20}(நீக்கு|அழி)/, "data change"],
  [/\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|earlier|all|your|the)\b.{0,20}\b(instructions?|rules?|prompts?|guidelines?)\b/i, "instructions"],
  [/\b(system prompt|developer mode|jailbreak|dan mode|reveal (your|the) (prompt|instructions|rules)|print your (prompt|instructions))\b/i, "instructions"]
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Addresses in the official directory; anything else in a message is refused. */
async function directoryEmails(): Promise<Set<string>> {
  try {
    const [rows] = await intelPool.query<RowDataPacket[]>(`SELECT LOWER(email) AS e FROM ${ops("official_contacts")} WHERE email IS NOT NULL`);
    return new Set(rows.map((r) => String(r.e)));
  } catch {
    return new Set();
  }
}

/** Text the Collector pasted to be read ("Summarise this: '...'"), as opposed to their own words. */
function inPastedText(message: string, at: number): boolean {
  const before = message.slice(0, at);
  const quotes = (before.match(/["“”]/g) ?? []).length;
  return quotes % 2 === 1 || /^\s*(summari[sz]e|translate|analy[sz]e|read|check|explain|what does)\b.{0,40}(this|the following|below|news|item|text|article|message|post)\b/i.test(before);
}

export async function codeGuard(message: string): Promise<GuardVerdict> {
  for (const [re, reason] of UNSAFE) {
    const m = re.exec(message);
    if (!m) continue;
    // an instruction inside pasted text is never obeyed; say so rather than "I can't change how I work"
    if (reason === "instructions" && inPastedText(message, m.index)) return { kind: "unsafe", reason: "pasted instructions" };
    return { kind: "unsafe", reason };
  }
  const emails = message.match(EMAIL);
  if (emails?.length) {
    const known = await directoryEmails();
    if (emails.some((e) => !known.has(e.toLowerCase()))) return { kind: "unsafe", reason: "email outside the official directory" };
  }
  const topic = offTopic(message);
  if (topic) return { kind: "off_topic", topic };
  if (looksBulk(message)) return { kind: "bulk" };
  return null;
}

// --------------------------------------------------------- offline routing --

export interface OfflineRoute {
  intent: "tool_question" | "briefing" | "help" | "smalltalk" | "out_of_scope" | "console_action" | "bulk_request" | "unknown";
  tools: { name: string; args: Record<string, unknown> }[];
  period: "daily" | "weekly" | "monthly" | "quarterly" | null;
  actions: { action: string; zone?: number; taluk?: string; dept?: string }[];
}

const OUT = /\b(ipl|cricket|football|movie|film|song|actor|actress|capital of|president of|prime minister of|python|javascript|code|program|poem|story|joke|recipe|homework|essay|stock|bitcoin|crypto|horoscope)\b/i;

/** Rules that stand in for the router when no model is available. */
export function offlineRoute(message: string, names: RefNames): OfflineRoute {
  const t = message.toLowerCase();
  const period = /\b(today|24 ?hours?|inniki|innaikku)\b|இன்று/.test(t) ? "daily" : /\b(week|weekly|vaaram)\b|வாரம்|வார/.test(t) ? "weekly"
    : /\b(month|monthly|30 days|maasam)\b|மாதம்|மாத/.test(t) ? "monthly" : /\b(quarter|90 days)\b/.test(t) ? "quarterly" : null;
  const r = (name: string, args: Record<string, unknown> = {}): OfflineRoute => ({ intent: "tool_question", tools: [{ name, args }], period, actions: [] });
  if (OUT.test(t)) return { intent: "out_of_scope", tools: [], period, actions: [] };
  if (/^(hi|hello|hey|thanks|thank you|vanakkam|nandri)\b|வணக்கம்|நன்றி/.test(t)) return { intent: "smalltalk", tools: [], period, actions: [] };
  // one specific incident, as a story (before "what is ..." is read as a help question)
  if (/\b(what (is|was) (this|that|the)|tell me (more )?about|explain|details? (of|about)|what happened)\b|enna aachu|\b(case|incident|murder|accident|fire|kolai)\s+(enna|yenna|pathi)\b|என்ன நடந்தது|(வழக்கு|சம்பவம்|கொலை|விபத்து)\s*(என்ன|பற்றி)/.test(t)
    && /\b(case|incident|murder|accident|fire|theft|robbery|snatching|collapse|death|attack|assault)\b|inc-|கொலை|விபத்து/.test(t)) return r("incident_story", { text: message });
  if (/test data|what does|what is|how (do|to)|meaning/.test(t)) return { intent: "help", tools: [], period, actions: [] };
  if (/\bfilter\b|வடிகட்டு/.test(t)) {
    const taluk = [...names.taluks.entries()].find(([, v]) => t.includes(v.name.toLowerCase()));
    const zone = [...names.zones.entries()].find(([, v]) => t.includes(v.name.toLowerCase()));
    const zn = t.match(/zone\s*(\d{1,2})/);
    if (taluk || zone || zn) return { intent: "console_action", tools: [], period, actions: [taluk ? { action: "filter_taluk", taluk: taluk[0] }
      : { action: "filter_zone", zone: zone ? zone[0] : Number(zn![1]) }] };
  }
  if (looksBulk(t)) return { intent: "bulk_request", tools: [], period, actions: [] };
  if (/brief|summar/.test(t)) return { intent: "briefing", tools: [{ name: "briefing", args: {} }], period, actions: [] };
  if (/verif|waiting|my tasks/.test(t)) return r("verification_queue");
  if (/slow|backlog|oldest|delay/.test(t)) return r("dept_backlog");
  if (/hospital|bed/.test(t)) return r("environment", { metric: "bed_occupancy_pct", above: Number(t.match(/(\d{2})\s*%/)?.[1]) || null });
  if (/lake|reservoir|ஏரி/.test(t)) return r("environment", { metric: "lake_pct_full", above: Number(t.match(/(\d{2})\s*%/)?.[1]) || null });
  if (/warning|alert|imd/.test(t)) return r("environment", { metric: "imd_warning_level" });
  if (/rain|மழை/.test(t)) return r("environment", { metric: "rainfall_24h_mm" });
  if (/aqi|air quality|pollution/.test(t)) return r("environment", { metric: "aqi" });
  if (/price|mandi|market|tomato|onion|potato|brinjal|thakkali|vengayam/.test(t)) {
    const commodity = t.match(/\b(tomato|onion|potato|brinjal|banana|thakkali|vengayam)\b/)?.[1] ?? null;
    const market = t.match(/at ([a-z .]+?)(?: uzhavar| market| sandhai|\?|$)/)?.[1]?.trim() ?? (/koyambedu/.test(t) ? "Koyambedu" : null);
    return r("mandi_prices", { commodity, market });
  }
  if (/hotspot|cluster/.test(t)) return r("hotspots");
  if (/\b(list|show)\b.{0,30}\b(incidents|complaints|cases)\b/.test(t) && !/\bby (zone|department|dept|taluk)\b/.test(t))
    return r("incidents", { status: /\bopen|pending\b/.test(t) ? "open" : null });
  if (/(location|area|place|locality|ward)[ -]?wise|which (areas|parts|places|localities|wards)|where exactly|on the map|endha area/.test(t)) return r("place_breakdown");
  if (/stor(y|ies)|developing/.test(t)) return r("developing_stories", { place: t.match(/about ([a-z ]+?)(?: this| last|\?|$)/)?.[1] ?? null });
  if (/news/.test(t) && /(not|no|without|missing)/.test(t)) return r("news_gaps");
  if (/source|feed|fresh/.test(t)) return r("source_health");
  if (/trend|over time|per day|daily count/.test(t)) return r("incident_series");
  if (/taluk/.test(t)) return r("taluks");
  if (/department|dept|துறை/.test(t)) return r("departments");
  if (/zone|attention|where|மண்டல/.test(t)) return r("zones");
  if (/severity|severe|கடுமை/.test(t)) return r("severity");
  if (/incident|complaint|how many|சம்பவ|புகார்|எத்தனை/.test(t)) return r("overview_kpis");
  return { intent: "unknown", tools: [], period, actions: [] };
}

/**
 * Cards that need no model: refusals, clarifications, console-action confirmations,
 * greetings, and the deterministic template answer used when the verifier rejects a
 * model's numbers twice or no model is available. Also the console actions' labels in each
 * language, and their validation against the store's codes.
 */
import crypto from "crypto";
import { COVERS, EXAMPLES, PERIOD_LABEL, TEXT, voiceLang, type Lang } from "@/lib/assistant/lang";
import { fmtValue } from "@/lib/assistant/chartspec";
import { emptySources, type AnswerCard, type ConsoleAction, type ConsoleActionName, type Kpi, type Period, type Scope } from "@/lib/assistant/answer";
import type { RefNames } from "@/lib/assistant/scope";
import type { Presentation } from "@/lib/assistant/datasets";
import type { Fact } from "@/lib/assistant/types";

export function baseCard(lang: Lang, scope: Scope | null, scopeLine: string, asOf: string): AnswerCard {
  return {
    id: crypto.randomUUID(), kind: "answer", language: lang, display: "text", headline: "", answerMarkdown: "", voiceSummary: "", voiceLang: voiceLang(lang),
    chart: null, datasets: [], kpis: [], table: null, followUps: [], chips: [], consoleActions: [], autoActions: [], caveats: [], scope, scopeLine, asOf,
    testData: false, sources: emptySources(), download: null
  };
}

const L = (en: string, ta: string, tanglish: string) => ({ en, ta, tanglish }) as Record<Lang, string>;

// ---------------------------------------------------------------- refusals --

const WHY: Record<string, Record<Lang, string>> = {
  "personal data": L("I can't share citizens' personal details such as names, phone numbers or addresses.",
    "குடிமக்களின் பெயர், தொலைபேசி எண், முகவரி போன்ற தனிப்பட்ட விவரங்களை என்னால் பகிர முடியாது.",
    "Citizens-oda personal details (name, phone number, address) share panna mudiyaadhu."),
  "data change": L("I can only read the data; I can't change or delete records. Decisions are made on the console itself.",
    "என்னால் தரவைப் படிக்க மட்டுமே முடியும்; பதிவுகளை மாற்றவோ நீக்கவோ முடியாது.",
    "Naan data-va padikka mattum dhaan mudiyum; records-a maatha illa delete panna mudiyaadhu."),
  instructions: L("I can't change or reveal how I work.", "என் செயல்முறை விதிகளை மாற்றவோ வெளிப்படுத்தவோ முடியாது.", "En rules-a maatha illa reveal panna mudiyaadhu."),
  "pasted instructions": L("The pasted text contains instructions, and I never act on instructions inside pasted text, news or documents; nothing was sent or changed.",
    "ஒட்டப்பட்ட உரையில் கட்டளைகள் உள்ளன; ஒட்டப்பட்ட உரை, செய்தி அல்லது ஆவணங்களில் உள்ள கட்டளைகளை நான் பின்பற்றுவதில்லை. எதுவும் அனுப்பப்படவில்லை, மாற்றப்படவில்லை.",
    "Paste panna text-la instructions irukku; paste panna text, news, documents-la irukkira instructions-a naan follow panna maatten. Edhuvum send aagala, maaralai."),
  "email outside the official directory": L("I can only draft official follow-ups to officials in the GCC directory.",
    "GCC அதிகாரிகள் பட்டியலில் உள்ளவர்களுக்கு மட்டுமே அதிகாரப்பூர்வ நினைவூட்டல் மின்னஞ்சல் வரைய முடியும்.",
    "GCC directory-la irukkira officials-ku mattum dhaan official follow-up mail draft panna mudiyum.")
};

/** The topic a code check recognised, named in the refusal so the Collector sees the question was understood. */
const TOPIC: Record<string, Record<Lang, string>> = {
  sports: L("Sports results are outside the data I work with.", "விளையாட்டு முடிவுகள் என் தரவில் இல்லை.", "Sports results en data-la illa."),
  entertainment: L("Films and entertainment are outside the data I work with.", "திரைப்படம், பொழுதுபோக்கு பற்றிய தகவல் என் தரவில் இல்லை.", "Movies, entertainment pathi en data-la illa."),
  coding: L("I don't help with programming; I answer from the district's data.", "நிரலாக்க உதவி என்னால் தர முடியாது; மாவட்டத் தரவிலிருந்து மட்டுமே பதில் தருவேன்.", "Coding help panna mudiyaadhu; district data-la irundhu mattum answer pannuven."),
  writing: L("I don't write poems, stories or jokes; I answer from the district's data.", "கவிதை, கதை, நகைச்சுவை எழுத மாட்டேன்; மாவட்டத் தரவிலிருந்து மட்டுமே பதில் தருவேன்.", "Poem, story, joke ezhudha maatten; district data-la irundhu mattum answer pannuven."),
  general: L("General-knowledge questions are outside the data I work with.", "பொது அறிவுக் கேள்விகள் என் தரவில் இல்லை.", "General knowledge kelvigal en data-la illa."),
  finance: L("Markets, shares and crypto are outside the data I work with.", "பங்குச் சந்தை, கிரிப்டோ பற்றிய தகவல் என் தரவில் இல்லை.", "Share market, crypto pathi en data-la illa."),
  astrology: L("Horoscopes are outside the data I work with.", "ஜாதகம், ராசிபலன் என் தரவில் இல்லை.", "Horoscope, rasi palan en data-la illa."),
  cooking: L("Recipes are outside the data I work with.", "சமையல் குறிப்புகள் என் தரவில் இல்லை.", "Recipes en data-la illa."),
  homework: L("I don't do homework or exam questions; I answer from the district's data.", "வீட்டுப்பாடம், தேர்வுக் கேள்விகளுக்கு உதவ மாட்டேன்; மாவட்டத் தரவிலிருந்து மட்டுமே பதில் தருவேன்.", "Homework, exam kelvigalukku help panna maatten; district data mattum."),
  politics: L("I don't give political opinions; I report what the district's data shows.", "அரசியல் கருத்துகள் சொல்ல மாட்டேன்; மாவட்டத் தரவு காட்டுவதை மட்டும் சொல்வேன்.", "Political opinion solla maatten; district data enna kaattudho adhu mattum."),
  elsewhere: L("I only have data for Chennai district, not other cities or districts.", "சென்னை மாவட்டத் தரவு மட்டுமே என்னிடம் உள்ளது; மற்ற நகரங்கள், மாவட்டங்கள் இல்லை.", "Chennai district data mattum dhaan irukku; vera city, district illa.")
};
const OUTSIDE = L("That question is outside the Chennai district data I work with.", "அந்தக் கேள்வி நான் பயன்படுத்தும் சென்னை மாவட்டத் தரவுக்கு வெளியே உள்ளது.",
  "Andha kelvi en Chennai district data-ku veliya irukku.");

/** A refusal: why (a named reason or topic) as the headline, what the assistant covers once below it, and questions to try. */
export function refusalCard(base: AnswerCard, reason: string | null, topic: string | null = null): AnswerCard {
  const lang = base.language;
  const head = reason && WHY[reason] ? WHY[reason][lang] : topic && TOPIC[topic] ? TOPIC[topic][lang] : OUTSIDE[lang];
  return { ...base, kind: "refusal", display: "text", headline: head, answerMarkdown: COVERS[lang], voiceSummary: `${head} ${TEXT.refusal[lang]}`,
    chips: EXAMPLES[lang].slice(0, 3), scope: null, scopeLine: "" };
}

export function clarifyCard(base: AnswerCard, question: string): AnswerCard {
  return { ...base, kind: "clarify", display: "text", headline: question, answerMarkdown: question, voiceSummary: question, chips: EXAMPLES[base.language].slice(0, 3) };
}

export function smalltalkCard(base: AnswerCard): AnswerCard {
  const t = TEXT.greeting[base.language];
  return { ...base, display: "text", headline: t, answerMarkdown: t, voiceSummary: t, chips: EXAMPLES[base.language], scope: null, scopeLine: "" };
}

export function notYetCard(base: AnswerCard): AnswerCard {
  const t = L("Drafting follow-up emails to officials is not switched on yet; it comes with the next release of the assistant.",
    "அதிகாரிகளுக்கு நினைவூட்டல் மின்னஞ்சல் வரைதல் இன்னும் இயக்கப்படவில்லை; உதவியாளரின் அடுத்த பதிப்பில் வரும்.",
    "Officials-ku follow-up email draft panradhu innum on pannala; adutha release-la varum.")[base.language];
  return { ...base, display: "text", headline: t, answerMarkdown: t, voiceSummary: t, chips: EXAMPLES[base.language].slice(0, 2), scope: null, scopeLine: "" };
}

export function errorCard(base: AnswerCard, message: string): AnswerCard {
  return { ...base, kind: "error", display: "text", headline: message, answerMarkdown: message, voiceSummary: message };
}

// ---------------------------------------------------------- console actions --

const ACTION_LABEL: Record<ConsoleActionName, (a: ConsoleAction, n: RefNames, lang: Lang) => string> = {
  filter_zone: (a, n, l) => { const z = n.zones.get(a.zone!); const nm = (l === "ta" ? z?.nameTa : null) ?? z?.name ?? `Zone ${a.zone}`;
    return L(`Filter the console to ${nm}`, `கன்சோலை ${nm} மண்டலத்திற்கு வடிகட்டு`, `Console-a ${nm} ku filter pannu`)[l]; },
  filter_dept: (a, n, l) => { const nm = n.depts.get(a.dept!)?.name ?? a.dept!; return L(`Show ${nm} only`, `${nm} மட்டும் காட்டு`, `${nm} mattum kaattu`)[l]; },
  filter_taluk: (a, n, l) => { const t = n.taluks.get(a.taluk!); const nm = (l === "ta" ? t?.nameTa : null) ?? t?.name ?? a.taluk!;
    return L(`Filter the console to ${nm} taluk`, `கன்சோலை ${nm} வட்டத்திற்கு வடிகட்டு`, `Console-a ${nm} taluk ku filter pannu`)[l]; },
  filter_cat: (a, n, l) => { const nm = n.cats.get(a.cat!)?.label ?? a.cat!; return L(`Show ${nm} only`, `${nm} மட்டும் காட்டு`, `${nm} mattum kaattu`)[l]; },
  set_period: (a, _n, l) => { const p = PERIOD_LABEL[a.period as Period][l]; return L(`Set the console to ${p.toLowerCase()}`, `கன்சோலை ${p} என மாற்று`, `Console-a ${p} ku maathu`)[l]; },
  open_incident: (a, _n, l) => L(`Open ${a.id}`, `${a.id} ஐத் திற`, `${a.id} open pannu`)[l],
  open_story: (_a, _n, l) => L("Open developing stories", "வளரும் செய்திகளைத் திற", "Developing stories open pannu")[l],
  open_briefing: (_a, _n, l) => L("Open the Briefing page", "சுருக்க அறிக்கைப் பக்கத்தைத் திற", "Briefing page open pannu")[l],
  save_briefing: (a, _n, l) => L(`Save this ${a.period ?? "daily"} briefing as a workspace`, "இந்த அறிக்கையைப் பணியிடமாகச் சேமி", "Indha briefing-a workspace-a save pannu")[l],
  show_on_map: (_a, _n, l) => L("Show on the console map", "கன்சோல் வரைபடத்தில் காட்டு", "Console map-la kaattu")[l]
};

/** Keep only actions whose codes exist in the store (and incidents the answer is about), with labels in the reply language. */
export function validActions(raw: Partial<ConsoleAction>[], n: RefNames, lang: Lang, incidentIds: string[]): ConsoleAction[] {
  const out: ConsoleAction[] = [];
  for (const a of raw) {
    // the chat answers in place: no redirect to the Briefing page, no workspace saving from here
    if (!a?.action || a.action === "open_briefing" || a.action === "save_briefing") continue;
    const ok = (a.action === "filter_zone" && a.zone != null && n.zones.has(Number(a.zone))) || (a.action === "filter_dept" && !!a.dept && n.depts.has(a.dept))
      || (a.action === "filter_taluk" && !!a.taluk && n.taluks.has(a.taluk)) || (a.action === "filter_cat" && !!a.cat && n.cats.has(a.cat))
      || (a.action === "set_period" && ["daily", "weekly", "monthly", "quarterly"].includes(String(a.period)))
      || (a.action === "open_incident" && !!a.id && /^INC-[A-Z0-9-]{4,40}$/.test(a.id) && incidentIds.includes(a.id))
      || a.action === "open_story" || (a.action === "show_on_map" && (a.zone == null || n.zones.has(Number(a.zone))));
    if (!ok) continue;
    const act: ConsoleAction = { action: a.action, label: "", zone: a.zone == null ? null : Number(a.zone), dept: a.dept ?? null, taluk: a.taluk ?? null, cat: a.cat ?? null,
      period: (a.period as Period) ?? null, id: a.id ?? null };
    act.label = ACTION_LABEL[a.action](act, n, lang);
    if (!out.some((x) => x.label === act.label)) out.push(act);
  }
  return out.slice(0, 4);
}

export function actionCard(base: AnswerCard, actions: ConsoleAction[]): AnswerCard {
  const lang = base.language;
  if (!actions.length) {
    const t = L("I couldn't find that filter. Pick a zone, taluk, department or period from the console's filters.",
      "அந்த வடிகட்டியைக் கண்டுபிடிக்க முடியவில்லை. கன்சோலில் மண்டலம், வட்டம், துறை அல்லது காலத்தைத் தேர்ந்தெடுக்கவும்.",
      "Andha filter kidaikkala. Console-la zone, taluk, department illa period select pannunga.")[lang];
    return { ...base, kind: "clarify", headline: t, answerMarkdown: t, voiceSummary: t };
  }
  const done = L("Done: ", "முடிந்தது: ", "Aachu: ")[lang];
  const text = `${done}${actions.map((a) => a.label).join("; ")}.`;
  return { ...base, kind: "action", display: "text", headline: text, answerMarkdown: text, voiceSummary: text, autoActions: actions, consoleActions: [] };
}

// --------------------------------------------------------------- templates --

const FRAME = L("Here are the figures", "தரவு விவரம்", "Idho figures");
const RANKED: Record<Lang, (measure: string, low: boolean) => string> = {
  en: (m, low) => `${low ? "Lowest" : "Highest"} ${m.toLowerCase()}`,
  ta: (m, low) => `${low ? "குறைந்த" : "அதிக"} ${m}`,
  tanglish: (m, low) => `${low ? "Kammiyana" : "Adhigamana"} ${m.toLowerCase()}`
};
const kpiText = (k: Kpi) => fmtValue(k.value, k.format ?? (Number.isInteger(k.value) ? "integer" : "decimal1"), k.unit ?? null);

/**
 * The deterministic answer, used when the verifier rejects a model's numbers twice or no model answers: the first tile
 * as the headline, the other tiles in one line, and the chart's leaders in one sentence ("Highest severe incidents:
 * Royapuram (9), Teynampet (6), Adyar (4)."); the key facts as bullets only when there is neither.
 */
export function templateCard(base: AnswerCard, p: Presentation, facts: Fact[], kpis: Kpi[]): AnswerCard {
  const lang = base.language;
  // several subjects: one line each, so no part of the question goes unanswered
  const parts = p.datasets.find((d) => d.id === "parts")?.rows;
  const inside = p.datasets.find((d) => d.id === "part_categories")?.rows ?? [];
  if (parts?.length === 1 && inside.length > 1) {
    const r = parts[0];
    const lines = [`**${r.part}**: ${fmtValue(Number(r.reported))} reported (${fmtValue(Number(r.reported_prev))} the period before), ${fmtValue(Number(r.open))} still open, `
      + `${fmtValue(Number(r.severe))} severe${r.top_zone ? `; most in ${r.top_zone} zone` : r.top_place ? `; most at ${r.top_place}` : ""}.`,
      ...[...inside].sort((a, b) => Number(b.reported) - Number(a.reported)).map((c) => `- ${c.category}: ${fmtValue(Number(c.reported))} (${fmtValue(Number(c.reported_prev))} before), ${fmtValue(Number(c.open))} open`)];
    return { ...base, headline: `${r.part}, by category`, answerMarkdown: lines.join("\n"), voiceSummary: `${r.part}: ${fmtValue(Number(r.reported))} reported.` };
  }
  if (parts?.length) {
    const lines = parts.map((r) => `- **${r.part}**: ${fmtValue(Number(r.reported))} reported (${fmtValue(Number(r.reported_prev))} the period before), `
      + `${fmtValue(Number(r.open))} still open, ${fmtValue(Number(r.severe))} severe${r.top_zone ? `; most in ${r.top_zone} zone (${fmtValue(Number(r.top_zone_n))})`
        : r.top_place ? `; most at ${r.top_place} (${fmtValue(Number(r.top_place_n))})` : ""}.`);
    const head = parts.length > 1 ? parts.map((r) => r.part).join(", ") : `${parts[0].part}, by category`;
    return { ...base, headline: head, answerMarkdown: lines.join("\n"), voiceSummary: head };
  }
  // one incident: its story from the record itself (what, where, when, status, who), then how it was reported
  const rec = p.datasets.find((d) => d.id === "incident")?.rows[0];
  if (rec) {
    const reports = p.datasets.find((d) => d.id === "reports")?.rows ?? [];
    const others = p.datasets.find((d) => d.id === "others")?.rows.length ?? 0;
    const unsure = /closest record/i.test(p.datasets.find((d) => d.id === "incident")?.title ?? "");
    const head = `${unsure ? "Closest match: " : ""}${rec.type ?? "Incident"} at ${rec.place ?? rec.zone_name ?? "an unrecorded place"}`;
    const lines = [
      `**${rec.id}** · ${rec.type ?? "Incident"}${rec.place ? ` at ${rec.place}` : ""}${rec.zone_name ? ` (${rec.zone_name} zone)` : ""}. First reported ${rec.t ?? "at an unrecorded time"}.`,
      `Severity **${rec.sev ?? "not set"}**; status **${rec.status ?? "not recorded"}**${rec.dept_name ? `; handled by ${rec.dept_name}` : ""}.`,
      ...(rec.why ? [`Why it matters: ${rec.why}.`] : []),
      ...(reports.length ? [`Reported ${reports.length === 1 ? "once" : `${reports.length} times`}: ${reports.slice(0, 3).map((r) => `${r.what ?? "report"}${r.publisher ? ` (${r.publisher})` : ""} ${r.t ?? ""}`.trim()).join("; ")}.`] : []),
      ...(others ? [`${others} similar incident${others === 1 ? "" : "s"} matched the description too.`] : [])
    ];
    return { ...base, headline: head, answerMarkdown: lines.join("\n\n"), voiceSummary: `${head}. Status: ${rec.status ?? "not recorded"}.` };
  }
  const lead = kpis[0] ? `${kpis[0].label}: ${kpiText(kpis[0])}` : p.chart?.title ?? FRAME[lang];
  const lines: string[] = [];
  if (kpis.length > 1) lines.push(kpis.slice(1).map((k) => `${k.label} **${kpiText(k)}**`).join(" · "));
  const c = p.chart;
  const ds = c ? p.datasets.find((d) => d.id === c.dataset) : null;
  const yf = ds && c?.y[0] ? ds.fields.find((f) => f.key === c.y[0]) : null;
  const xf = ds && c?.x ? ds.fields.find((f) => f.key === c.x) : null;
  if (c && ds && yf && xf && (xf.kind === "category" || xf.kind === "text")) {
    const low = c.sort === "asc";
    const rows = ds.rows.filter((r) => r[yf.key] != null && Number.isFinite(Number(r[yf.key])))
      .sort((a, b) => (Number(b[yf.key]) - Number(a[yf.key])) * (low ? -1 : 1));
    const top = rows.slice(0, Math.min(5, c.topN || 5)).map((r) => `${r[xf.key]} (${fmtValue(Number(r[yf.key]), yf.format ?? "integer", yf.unit ?? null)})`);
    if (top.length) lines.push(`${RANKED[lang](yf.label, low)}: ${top.join(", ")}.`);
  }
  if (lines.length) {
    const headline = lang === "en" ? lead : `${FRAME[lang]}: ${lead}`;
    return { ...base, headline, answerMarkdown: lines.join("\n\n"), voiceSummary: headline };
  }
  // the most telling facts first: totals, the top three, changes; single rows of a long table last
  const rankOf = new Map(facts.filter((f) => f.id.endsWith(".rank")).map((f) => [f.id.slice(0, -5), f.value]));
  const prio = (f: Fact) => /\.total$/.test(f.id) ? 0 : rankOf.has(f.id) ? (rankOf.get(f.id)! <= 3 ? rankOf.get(f.id)! : 20) : /change_pct$/.test(f.id) ? 5
    : /\.above_zero$/.test(f.id) ? 6 : /\.groups$/.test(f.id) ? 7 : 10;
  const pickFacts = facts.map((f, i) => ({ f, i })).filter(({ f }) => !/\.(rank|share|prev|diff|min|max|lead|avg|rows|total_rows)$/.test(f.id) && !f.id.startsWith("scope."))
    .sort((a, b) => prio(a.f) - prio(b.f) || a.i - b.i).slice(0, 5).map(({ f }) => f);
  const bullets = pickFacts.map((f) => `- ${f.label}: ${fmtValue(f.value, Number.isInteger(f.value) ? "integer" : "decimal1")}${f.unit && f.unit !== "%" ? ` ${f.unit}` : f.unit === "%" ? "%" : ""}`);
  const headline = lang === "en" ? lead : `${FRAME[lang]}: ${lead}`;
  return { ...base, headline, answerMarkdown: bullets.join("\n") || headline, voiceSummary: headline };
}

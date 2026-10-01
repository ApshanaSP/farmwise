/**
 * The subjects a question names, so a question about several ("road accidents, flooding and public-infrastructure
 * complaints") is answered part by part instead of being narrowed to one. A subject is a group of the pipeline's
 * incident categories: a plain word ("flooding", "crime", "public infrastructure") or one category's own keywords.
 * No imports: it runs anywhere and is unit-tested directly.
 */

export interface Part { label: string; codes: string[] }

/** The words people use for groups of incident categories, in English, Tamil and Tanglish. Order: the broader first. */
const GROUPS: { re: RegExp; label: string; codes: string[] }[] = [
  { re: /public[\s-]*infrastructure|civic[\s-]*infrastructure|\binfrastructure\b|உள்கட்டமைப்பு/i, label: "Public infrastructure",
    codes: ["ROAD_DAMAGE", "DRAINAGE_SEWAGE", "DRAIN_WORKS_SAFETY", "STREETLIGHT_ELECTRICAL", "PUBLIC_WORKS", "WATER_SUPPLY", "BUILDING_SAFETY", "CIVIC_FACILITIES"] },
  { re: /\bflood(s|ed|ing)?\b|water[\s-]*logg|inundat|வெள்ள|vellam/i, label: "Flooding", codes: ["FLOOD_WATERLOGGING", "WATERBODY_INFRA", "FLOOD_RELIEF"] },
  { re: /\broad[\s-]*accidents?\b|\baccidents?\b|\bcrash(es)?\b|விபத்து|vibathu/i, label: "Road accidents", codes: ["ROAD_ACCIDENT"] },
  { re: /\bcrimes?\b|குற்ற/i, label: "Crime", codes: ["CRIME_PROPERTY", "CRIME_VIOLENT", "DRUGS_LIQUOR"] },
  { re: /\bmurders?\b|\bassaults?\b|violent|கொலை|kolai/i, label: "Violent crime", codes: ["CRIME_VIOLENT"] },
  { re: /\btheft\b|snatching|robber(y|ies)|burglar|திருட்டு/i, label: "Theft & snatching", codes: ["CRIME_PROPERTY"] },
  { re: /\bhealth\b|diseases?|dengue|malaria|fever|hospital|சுகாதார|மருத்துவ/i, label: "Health", codes: ["VECTOR_DISEASE", "HEALTH_SERVICES", "FOOD_SAFETY"] },
  { re: /sanitation|garbage|\bwaste\b|trash|குப்பை|kuppai/i, label: "Garbage & sanitation", codes: ["SOLID_WASTE", "SANITATION_TOILETS"] },
  { re: /\btraffic\b|parking|போக்குவரத்து/i, label: "Traffic", codes: ["TRAFFIC_OBSTRUCTION"] },
  { re: /street[\s-]*lights?|power[\s-]*cuts?|electric/i, label: "Street lights & power", codes: ["STREETLIGHT_ELECTRICAL"] },
  { re: /drinking[\s-]*water|water[\s-]*supply|water[\s-]*scarcity|குடிநீர்/i, label: "Water supply", codes: ["WATER_SUPPLY"] },
  { re: /pot[\s-]*holes?|road[\s-]*damage|bad[\s-]*roads?|damaged[\s-]*roads?/i, label: "Road damage", codes: ["ROAD_DAMAGE"] },
  { re: /\bdrain(s|age)?\b|sewage|manholes?|கழிவுநீர்/i, label: "Drainage & sewage", codes: ["DRAINAGE_SEWAGE"] },
  { re: /encroach/i, label: "Encroachment", codes: ["ENCROACHMENT"] },
  { re: /stray[\s-]*(dogs?|cattle|animals?)|dog[\s-]*bites?/i, label: "Stray animals", codes: ["STRAY_ANIMALS"] },
  { re: /\bprotests?\b|agitation|dharna|போராட்ட/i, label: "Protests", codes: ["PUBLIC_ORDER"] },
  { re: /\btrees?\b|parks?\b/i, label: "Trees & parks", codes: ["TREES_PARKS"] },
  { re: /missing[\s-]*persons?|\bdrown/i, label: "Missing persons", codes: ["MISSING_PERSON"] }
];

/**
 * The subjects the question names, in the order it names them. A narrower subject inside a broader one it also names
 * ("street lights" with "public infrastructure") is folded into the broader one.
 */
export function questionParts(q: string): Part[] {
  const hits = GROUPS.map((g) => ({ g, at: q.search(g.re) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);
  const out: Part[] = [];
  for (const { g } of hits) {
    const inside = hits.some((o) => o.g !== g && o.g.codes.length > g.codes.length && g.codes.every((c) => o.g.codes.includes(c)));
    if (inside || out.some((p) => p.label === g.label)) continue;
    out.push({ label: g.label, codes: [...g.codes] });
  }
  return out;
}

/** A question about several subjects at once (or one broad group of them), to be answered part by part. */
export function multiPart(q: string): Part[] | null {
  const parts = questionParts(q);
  if (parts.length >= 2) return parts.slice(0, 6);
  // one broad group ("public infrastructure complaints this week"): its categories, each on its own line
  if (parts.length === 1 && parts[0].codes.length >= 3) return parts;
  return null;
}

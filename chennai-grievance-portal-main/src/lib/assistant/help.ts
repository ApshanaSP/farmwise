/**
 * Fixed knowledge the assistant may explain without a query: what the console's terms mean
 * and how to use the assistant. Given to the composer as facts-free context for "help"
 * questions, so explanations stay consistent with the console.
 */
export const HELP_TOPICS: { id: string; match: RegExp; text: string }[] = [
  {
    id: "test_data",
    match: /test data|synthetic|fake|dummy|real data|சோதனை/i,
    text: "Test data: police reports, PWD records, hospital figures and most citizen complaints in this prototype come from generators, not from live department systems. They are flagged is_synthetic in the store, and every answer that uses them carries a 'test data' badge. News, IMD weather, CPCB air quality, CFM-DSS flood data and AGMARKNET prices are real sources."
  },
  {
    id: "attention_score",
    match: /attention|hotspot zone|score|rank/i,
    text: "Attention score: the console ranks zones by 3 points per severe incident plus 1 per high incident reported in the period; the top two are its 'Hotspot zones'."
  },
  {
    id: "severity",
    match: /severity|severe|high|medium|low/i,
    text: "Severity: each incident is scored 0-100 from what happened (deaths, injuries, people affected, hazards, vulnerable groups) and labelled Severe, High, Medium or Low."
  },
  {
    id: "priority",
    match: /priority/i,
    text: "Priority: how urgent an open incident is now: severity plus time past its deadline, new reports in the last 24 hours, repeat problems, news coverage and whether it is verified."
  },
  {
    id: "verification",
    match: /verif|my tasks|waiting/i,
    text: "Awaiting your verification: citizen complaints where the department officer reported the work done and asked the Collector to verify; verifying closes them for the citizen, sending back reopens them."
  },
  {
    id: "news_gaps",
    match: /news|gap|media/i,
    text: "In the news, not in department records: incidents reported by news outlets that no department record matches yet. News rests on headlines (about 98% are snippets) and the news filter scores F1 0.63, so some are misses."
  },
  {
    id: "asof",
    match: /as of|fresh|updated|latest|when/i,
    text: "As of: figures run to the newest record in the store (the pipeline's as-of time), not to the clock; the pipeline refreshes the sources on a schedule and the console reloads when a new build arrives."
  },
  {
    id: "assistant",
    match: /how (do|to|can)|what can you|help|use (you|this)/i,
    text: "Ask District IQ answers questions about Chennai district data: incidents, complaints, police, PWD, hospitals, news, weather, air quality, lakes, market prices, sources and officials. Each answer shows its scope, as-of time and sources; charts can switch type, open a table or filter the console. It uses the console's filters unless the question says otherwise, and it replies in the question's language (English, Tamil or Tanglish)."
  },
  {
    id: "kolathur",
    match: /kolathur|கொளத்தூர்/i,
    text: "Kolathur: an official revenue taluk that the police and PWD sources do not code; only one ward maps to it by majority vote, so taluk-level counts for Kolathur are incomplete. Kolathur is also a locality in Ayanavaram taluk (ward 64, Thiru-Vi-Ka Nagar zone)."
  }
];

/** Whether a message asks about one of the help topics (a question, not a greeting). */
export function isHelpQuestion(text: string): boolean {
  return HELP_TOPICS.some((h) => h.match.test(text));
}

export function helpFor(text: string): string[] {
  const hits = HELP_TOPICS.filter((h) => h.match.test(text)).map((h) => h.text);
  return hits.length ? hits.slice(0, 3) : [HELP_TOPICS.find((h) => h.id === "assistant")!.text];
}

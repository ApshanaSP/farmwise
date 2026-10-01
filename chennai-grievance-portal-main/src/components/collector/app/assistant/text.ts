/* The dialog's own words in English, Tamil and Tanglish. Answers are composed per question; these are the fixed labels. */
import type { ChartType } from "@/lib/assistant/answer";
import type { Lang } from "@/lib/assistant/lang";

type Types = Partial<Record<ChartType, string>>;
interface Strings {
  title: string; subtitle: string; placeholder: string; send: string; stop: string; close: string; maximize: string; restore: string;
  language: string; auto: string; stages: Record<"understanding" | "fetching" | "drawing", string>; tryAsking: string; newChat: string;
  fresh: (asOf: string, ok: number, total: number) => string; aiOff: string;
  testData: string; testTip: string; offline: string; offlineTip: string; prev: string; vsPrev: string; chartTools: string; types: Types; table: string;
  png: string; csv: string; expand: string; shrink: string; usual: string; showing: (n: number, total: number) => string; next: string; helpful: string;
  yes: string; no: string; sources: string; asOf: string; tools: string; data: string; rows: string; incidents: string; testYes: string; testNo: string;
  models: string; numbers: string; template: string; verified: (n: number, again: boolean) => string; noNumbers: string; assumptions: string; notes: string;
  none: string; more: string; busy: string; failed: string; cancelled: string; you: string;
  /** shown when typos were corrected: "Understood as: tomato price" */
  understood: string;
  speak: string; listening: string; micOff: string; readAloud: string; stopReading: string; copy: string; copied: string; views: string;
  visualise: string; hide: string; details: string; hint: string; live: string; hello: (part: string) => string; helpLine: string;
  suggest: [string, string, string, string]; scopeNow: string; insightsNow: string;
  history: string; noHistory: string; question1: string; questionN: string;
}

const typesEn: Types = { horizontal_bar: "Bar chart", bar: "Column chart", line: "Line chart", area: "Area chart", donut: "Donut chart", grouped_bar: "Grouped bars",
  stacked_bar: "Stacked bars", heatmap: "Heatmap", map_zones: "Map by zone", map_wards: "Map by ward", map_points: "Map of points", map_hotspots: "Hotspot map", table: "Table",
  small_multiples: "Small multiples", dumbbell: "This period vs previous",
  rose: "Rose chart", treemap: "Treemap", gauge: "Gauge" };

export const T: Record<Lang, Strings> = {
  en: {
    title: "Ask District IQ", subtitle: "Answers from the district's live data", placeholder: "Ask about incidents, complaints, weather, prices…", send: "Send", stop: "Stop",
    close: "Close", maximize: "Maximise", restore: "Restore", language: "Reply language", auto: "Auto",
    stages: { understanding: "Understanding", fetching: "Fetching data", drawing: "Drawing the answer" }, tryAsking: "Try asking", newChat: "New conversation",
    fresh: (a, ok, n) => `Data as of ${a} · ${ok} of ${n} feeds up to date`, aiOff: "AI provider not configured: answering by rules",
    testData: "Test data", testTip: "Includes synthetic records (police, PWD, hospital, most complaints)", offline: "Without AI",
    offlineTip: "Answered from the data by rules, without the language model", prev: "previous", vsPrev: "vs previous", chartTools: "Chart tools", types: typesEn,
    table: "Table", png: "Download as image", csv: "Download data (CSV)", expand: "Bigger", shrink: "Smaller", usual: "Usual range",
    showing: (n, total) => `Showing ${n.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}.`, next: "Ask next", helpful: "Helpful?", yes: "Yes", no: "No",
    sources: "Sources and how this was calculated", asOf: "Data as of", tools: "Console functions", data: "Data from", rows: "Rows used", incidents: "Incidents",
    testYes: "Yes: some records are synthetic", testNo: "No: real sources only", models: "AI steps", numbers: "Numbers",
    template: "Written by a template from the data (the AI draft was not used)", verified: (n, again) => `${n} checked against the data${again ? " (second draft)" : ""}`,
    noNumbers: "No numbers stated", assumptions: "Assumptions", notes: "Notes", none: "No rows.", more: "Show more (up to 100)",
    busy: "The assistant is busy. Please try again in a moment.", failed: "Something went wrong. Please try again.", cancelled: "Stopped.", you: "You",
    understood: "Understood as",
    speak: "Ask by voice", listening: "Listening… speak now", micOff: "The microphone is blocked. Allow it in the browser to ask by voice.",
    readAloud: "Read aloud", stopReading: "Stop reading", copy: "Copy answer", copied: "Copied", views: "Views",
    visualise: "Visualise", hide: "Hide", details: "Show details", hint: "Answers come from the console's live data · Enter to send · ↑ edits the last question",
    live: "Live data", hello: (p) => `Good ${p}, Collector`, helpLine: "Ask about incidents, places, departments, weather, lakes, hospitals or market prices. In English, தமிழ் or Tanglish.",
    suggest: ["Where to focus", "Severe incidents", "Lakes & reservoirs", "Today's briefing"], scopeNow: "Answering for", insightsNow: "Today's insights",
    history: "Conversation history", noHistory: "No earlier conversations yet.", question1: "question", questionN: "questions"
  },
  ta: {
    title: "District IQ-இடம் கேளுங்கள்", subtitle: "மாவட்டத்தின் நேரடித் தரவிலிருந்து பதில்கள்", placeholder: "சம்பவங்கள், புகார்கள், வானிலை, விலைகள் பற்றி கேளுங்கள்…", send: "அனுப்பு",
    stop: "நிறுத்து", close: "மூடு", maximize: "பெரிதாக்கு", restore: "சிறிதாக்கு", language: "பதில் மொழி", auto: "தானியங்கி",
    stages: { understanding: "புரிந்துகொள்கிறது", fetching: "தரவைப் பெறுகிறது", drawing: "பதிலை வரைகிறது" }, tryAsking: "இப்படிக் கேளுங்கள்", newChat: "புதிய உரையாடல்",
    fresh: (a, ok, n) => `தரவு நேரம் ${a} · ${n} மூலங்களில் ${ok} புதுப்பிக்கப்பட்டவை`, aiOff: "AI வழங்குநர் அமைக்கப்படவில்லை: விதிகளால் பதில்",
    testData: "சோதனைத் தரவு", testTip: "செயற்கைப் பதிவுகள் அடங்கும் (காவல், பொதுப்பணி, மருத்துவமனை, பெரும்பாலான புகார்கள்)", offline: "AI இல்லாமல்",
    offlineTip: "மொழி மாதிரி இல்லாமல் தரவிலிருந்து விதிகளால் பதில்", prev: "முந்தையது", vsPrev: "முந்தைய காலத்துடன்", chartTools: "விளக்கப்படக் கருவிகள்",
    types: { ...typesEn, horizontal_bar: "பட்டை வரைபடம்", line: "கோட்டு வரைபடம்", donut: "வட்ட வரைபடம்", map_zones: "மண்டல வரைபடம்", table: "அட்டவணை" },
    table: "அட்டவணை", png: "படமாகப் பதிவிறக்கு", csv: "தரவைப் பதிவிறக்கு (CSV)", expand: "பெரிதாக", shrink: "சிறிதாக", usual: "வழக்கமான வரம்பு",
    showing: (n, total) => `${total.toLocaleString("en-IN")} இல் ${n.toLocaleString("en-IN")} காட்டப்படுகின்றன.`, next: "அடுத்து கேளுங்கள்", helpful: "பயனுள்ளதா?", yes: "ஆம்", no: "இல்லை",
    sources: "மூலங்களும் கணக்கிட்ட முறையும்", asOf: "தரவு நேரம்", tools: "கன்சோல் செயல்பாடுகள்", data: "தரவு மூலம்", rows: "பயன்படுத்திய வரிசைகள்", incidents: "சம்பவங்கள்",
    testYes: "ஆம்: சில பதிவுகள் செயற்கையானவை", testNo: "இல்லை: உண்மையான மூலங்கள் மட்டும்", models: "AI படிகள்", numbers: "எண்கள்",
    template: "தரவிலிருந்து வார்ப்புருவால் எழுதப்பட்டது", verified: (n, again) => `${n} எண்கள் தரவுடன் சரிபார்க்கப்பட்டன${again ? " (இரண்டாம் வரைவு)" : ""}`,
    noNumbers: "எண்கள் இல்லை", assumptions: "அனுமானங்கள்", notes: "குறிப்புகள்", none: "வரிசைகள் இல்லை.", more: "மேலும் காட்டு (100 வரை)",
    busy: "உதவியாளர் பரபரப்பாக உள்ளது. சற்று நேரத்தில் மீண்டும் முயலவும்.", failed: "ஏதோ தவறு நடந்தது. மீண்டும் முயலவும்.", cancelled: "நிறுத்தப்பட்டது.", you: "நீங்கள்",
    understood: "இப்படிப் புரிந்துகொண்டேன்",
    speak: "குரலில் கேளுங்கள்", listening: "கேட்கிறது… பேசுங்கள்", micOff: "ஒலிவாங்கி தடுக்கப்பட்டுள்ளது. குரலில் கேட்க உலாவியில் அனுமதியுங்கள்.",
    readAloud: "உரக்கப் படி", stopReading: "படிப்பதை நிறுத்து", copy: "பதிலை நகலெடு", copied: "நகலெடுக்கப்பட்டது", views: "காட்சிகள்",
    visualise: "வரைபடமாகக் காட்டு", hide: "மறை", details: "விவரங்கள்", hint: "கன்சோலின் நேரடித் தரவிலிருந்து பதில்கள் · அனுப்ப Enter · ↑ கடைசிக் கேள்வி",
    live: "நேரடித் தரவு", hello: () => "வணக்கம், ஆட்சியர் அவர்களே", helpLine: "சம்பவங்கள், இடங்கள், துறைகள், வானிலை, ஏரிகள், மருத்துவமனைகள், சந்தை விலைகள் பற்றி கேளுங்கள்.",
    suggest: ["கவனம் தேவைப்படும் இடம்", "கடுமையான சம்பவங்கள்", "ஏரிகள்", "இன்றைய அறிக்கை"], scopeNow: "இதற்கான பதில்", insightsNow: "இன்றைய தகவல்கள்",
    history: "உரையாடல் வரலாறு", noHistory: "முந்தைய உரையாடல்கள் இல்லை.", question1: "கேள்வி", questionN: "கேள்விகள்"
  },
  tanglish: {
    title: "District IQ kitta kelunga", subtitle: "District-oda live data-la irundhu answers", placeholder: "Incidents, complaints, weather, prices pathi kelunga…", send: "Send",
    stop: "Stop", close: "Close", maximize: "Perusa", restore: "Chinnadha", language: "Reply language", auto: "Auto",
    stages: { understanding: "Purinjukittu irukku", fetching: "Data edukkudhu", drawing: "Answer ready aagudhu" }, tryAsking: "Ippadi kelunga", newChat: "Pudhu conversation",
    fresh: (a, ok, n) => `Data as of ${a} · ${n} feeds-la ${ok} up to date`, aiOff: "AI provider set pannala: rules vachu answer",
    testData: "Test data", testTip: "Synthetic records irukku (police, PWD, hospital, most complaints)", offline: "AI illama",
    offlineTip: "Language model illama, data-la irundhu rules vachu answer", prev: "munnadi", vsPrev: "munnadi period-oda", chartTools: "Chart tools", types: typesEn,
    table: "Table", png: "Image-a download", csv: "Data download (CSV)", expand: "Perusa", shrink: "Chinnadha", usual: "Usual range",
    showing: (n, total) => `${total.toLocaleString("en-IN")}-la ${n.toLocaleString("en-IN")} kaattudhu.`, next: "Adutha kelvi", helpful: "Useful-a?", yes: "Aamaa", no: "Illa",
    sources: "Sources, epdi calculate pannom", asOf: "Data as of", tools: "Console functions", data: "Data from", rows: "Rows", incidents: "Incidents",
    testYes: "Aamaa: sila records synthetic", testNo: "Illa: real sources mattum", models: "AI steps", numbers: "Numbers",
    template: "Data-la irundhu template vachu ezhudhinadhu", verified: (n, again) => `${n} numbers data-oda check pannom${again ? " (second draft)" : ""}`,
    noNumbers: "Numbers illa", assumptions: "Assumptions", notes: "Notes", none: "Rows illa.", more: "Innum kaattu (100 varai)",
    busy: "Assistant busy-a irukku. Konja neram kazhichu try pannunga.", failed: "Edho thappu nadandhuchu. Thirumba try pannunga.", cancelled: "Stop pannitom.", you: "Neenga",
    understood: "Ippadi purinjukitten",
    speak: "Voice-la kelunga", listening: "Kekkudhu… pesunga", micOff: "Mic block aagirukku. Voice-la kekka browser-la allow pannunga.",
    readAloud: "Padichu kaattu", stopReading: "Stop", copy: "Answer copy pannu", copied: "Copy aachu", views: "Views",
    visualise: "Graph-a kaattu", hide: "Maraikka", details: "Details", hint: "Console-oda live data-la irundhu answers · Enter send · ↑ last question",
    live: "Live data", hello: () => "Vanakkam, Collector", helpLine: "Incidents, places, departments, weather, lakes, hospitals, market prices pathi kelunga.",
    suggest: ["Enga focus pannanum", "Severe incidents", "Lakes", "Innaikku briefing"], scopeNow: "Indha scope-ku", insightsNow: "Innaikku insights",
    history: "Pazhaya conversations", noHistory: "Munnadi conversations illa.", question1: "kelvi", questionN: "kelvigal"
  }
};

/** Pins, insights and story mode. */
export const X: Record<Lang, { insights: string; play: string; stopPlay: string; pinned: string; pin: string; pinnedOk: string; unpin: string; playing: (i: number, n: number) => string }> = {
  en: { insights: "Insights for today", play: "Play today's insights", stopPlay: "Stop", pinned: "Pinned", pin: "Pin this answer (re-runs on fresh data)",
    pinnedOk: "Pinned", unpin: "Remove pin", playing: (i, n) => `Insight ${i} of ${n}` },
  ta: { insights: "இன்றைய முக்கியத் தகவல்கள்", play: "இன்றைய தகவல்களை இயக்கு", stopPlay: "நிறுத்து", pinned: "பின் செய்தவை", pin: "இந்த பதிலைப் பின் செய் (புதிய தரவில் மீண்டும் இயங்கும்)",
    pinnedOk: "பின் செய்யப்பட்டது", unpin: "பின்னை நீக்கு", playing: (i, n) => `${n} இல் ${i}` },
  tanglish: { insights: "Innaikku insights", play: "Innaikku insights play pannu", stopPlay: "Stop", pinned: "Pinned", pin: "Indha answer-a pin pannu (pudhu data-la thirumba run aagum)",
    pinnedOk: "Pin aachu", unpin: "Pin remove pannu", playing: (i, n) => `${n}-la ${i}` }
};

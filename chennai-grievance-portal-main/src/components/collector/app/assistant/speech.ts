/**
 * Voice for Ask District IQ, with the browser's own speech services (no audio leaves for a third party through this
 * code): speech to text for asking (English or Tamil, India), and the answer's spoken summary read aloud in its
 * language. Both are optional: where the browser has no speech service the buttons are not shown.
 */

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};

function recognizer(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = () => !!recognizer();
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/**
 * Listen once. `onText` gets the words so far (to show in the box); `onDone` the final text when the speaker
 * stops, or "" if nothing was heard; `onError` names what went wrong ("not-allowed" when the microphone is blocked).
 * Returns a function that stops listening.
 */
export function listen(lang: "en-IN" | "ta-IN", onText: (t: string) => void, onDone: (t: string) => void, onError: (e: string) => void): () => void {
  const R = recognizer();
  if (!R) { onError("unsupported"); return () => {}; }
  const r = new R();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let final = "";
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) final += res[0].transcript;
      else interim += res[0].transcript;
    }
    onText(`${final}${interim}`.trim());
  };
  r.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") onError(e.error); };
  r.onend = () => onDone(final.trim());
  r.start();
  return () => r.stop();
}

/** Read text aloud in the answer's language; `onEnd` runs when it finishes or is stopped. Returns false where speech is unavailable. */
export function speak(text: string, lang: string, onEnd?: () => void): boolean {
  if (!canSpeak() || !text.trim()) return false;
  const s = window.speechSynthesis;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const voices = s.getVoices();
  const v = voices.find((x) => x.lang === lang) ?? voices.find((x) => x.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  if (v) u.voice = v;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  s.speak(u);
  return true;
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}

/**
 * Decides whether something you just said was a question about your notes or a
 * thought to keep.
 *
 * Two properties matter more than accuracy:
 *
 * 1. The audio is already saved before this runs. A wrong answer costs a junk
 *    note, never a lost thought — which is why a heuristic is good enough and
 *    an LLM round-trip isn't worth the seconds.
 * 2. It is biased toward "thought". Treating a question as a note is a shrug;
 *    treating a thought as a question is the failure the product exists to
 *    prevent, so anything ambiguous falls through to capture.
 */
export interface Intent {
  kind: "question" | "thought";
  confidence: number;
}

/**
 * Hindi / Hinglish recall.
 *
 * Matches on *recall* phrasing, not on question words. A bare क्या or "kya"
 * appears constantly in ordinary speech ("वो क्या है" is thinking out loud, not
 * a query), so these all require a first-person subject plus a saying verb, or
 * an explicit fetch verb. Same bias as the English list: miss rather than
 * misfire.
 */
const RECALL_OPENERS_HI = [
  // मैंने / हमने … क्या … कहा / बोला / बताया  ("what did I say about…")
  /(मैंने|मैने|हमने|हमने|मैं ने)\s+.{0,30}(क्या|कब|कहाँ|कहां)\s*.{0,30}(कहा|बोला|बताया|लिखा|रिकॉर्ड)/,
  /(क्या|कब)\s+(मैंने|मैने|हमने|मैं ने)\s+.{0,30}(कहा|बोला|बताया|रिकॉर्ड)/,
  // दिखाओ / ढूंढो / निकालो / सुनाओ — explicit fetch verbs.
  // No \b here: JavaScript's word boundary is defined over [A-Za-z0-9_], so it
  // never matches beside Devanagari and would silently kill this whole rule.
  /(दिखाओ|दिखाइए|दिखाइये|ढूंढो|ढूँढो|खोजो|निकालो|सुनाओ|बताओ|बताइए)/,
  // romanized Hinglish, same shape
  /\b(maine|humne|hamne|mai ne)\b.{0,30}\b(kya|kab|kahan)\b.{0,30}\b(kaha|bola|bataya)\b/,
  /\b(dikhao|dhundo|dhoondo|khojo|nikalo|sunao|batao)\b/,
];

/** Openers that only really occur when interrogating your own archive. */
const RECALL_OPENERS = [
  /^what (did|do|was|were|have) i\b/,
  /^when (did|do|was|were|have) i\b/,
  /^where (did|do|was|were|have) i\b/,
  /^who (did|do|was|were|have) i\b/,
  /^why (did|do|was|were|have) i\b/,
  /^how (did|do|was|were|have) i\b/,
  // Requires a possessive/determiner after the verb on purpose: "find my
  // meeting notes" is a lookup, but "find a better way to…" is someone
  // thinking, and bare /^find/ would swallow both.
  /^(show|find|search|look up|pull up|bring up|remind)\s+(me|my|the|all|any)\b/,
  /^(did|have) i (ever |already )?(say|said|mention|talk|record|note)/,
  /^what('s| is| are| was| were)? (my|the) .{0,40}(idea|note|thought|plan)s?\b/,
];

/** Phrases that mean "keep this", regardless of anything else in the sentence. */
const CAPTURE_MARKERS = [
  /^(remember|note|capture|save|remind me to)\b/,
  /^i (have|had|just had|keep having) (an?|this) (idea|thought)/,
  /^(idea|thought|note) ?[:—-]/,
];

export function classifyIntent(transcript: string): Intent {
  const text = transcript.trim().toLowerCase();
  if (text.length === 0) return { kind: "thought", confidence: 0 };

  // An explicit "remember this" wins outright, even if the rest is phrased as
  // a question ("remember this — what if we just cached it?").
  if (CAPTURE_MARKERS.some((p) => p.test(text))) return { kind: "thought", confidence: 0.95 };

  // Hindi recall phrases can sit anywhere in the sentence, not just at the
  // front — word order is freer than the English patterns assume.
  const opensWithRecall =
    RECALL_OPENERS.some((p) => p.test(text)) || RECALL_OPENERS_HI.some((p) => p.test(text));
  const endsWithQuestion = /\?\s*$/.test(transcript.trim());

  // Length is the strongest signal available. Nobody asks a 40-word question of
  // their own notes; that's someone thinking out loud who happened to start
  // with "how do I".
  const words = text.split(/\s+/).length;
  const isShort = words <= 15;
  const isVeryLong = words > 30;

  if (isVeryLong) return { kind: "thought", confidence: 0.9 };

  if (opensWithRecall && isShort) {
    return { kind: "question", confidence: endsWithQuestion ? 0.95 : 0.88 };
  }
  if (opensWithRecall) return { kind: "question", confidence: 0.72 };
  if (endsWithQuestion && isShort) return { kind: "question", confidence: 0.6 };

  return { kind: "thought", confidence: 0.9 };
}

/**
 * Only route to search on a confident read. Below this it's saved as a note and
 * nothing is shown — the safe direction, since a note is always recoverable.
 */
export const QUESTION_CONFIDENCE = 0.85;

export function shouldSearch(intent: Intent): boolean {
  return intent.kind === "question" && intent.confidence >= QUESTION_CONFIDENCE;
}

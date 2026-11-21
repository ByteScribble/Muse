/**
 * Pulls a date window out of a spoken query.
 *
 * This runs on the device on purpose: "yesterday" is a fact about the user's
 * clock, and the server runs in UTC. Parsing it here and sending an explicit
 * window keeps the timezone where the timezone is known.
 *
 * Deliberately a small table of the phrases people actually say, not a general
 * date grammar — an unrecognised phrase simply means no filter, which degrades
 * to ordinary search rather than to a wrong answer.
 */
export interface Timeframe {
  after: Date | null;
  before: Date | null;
  /** The query with the time phrase removed — what's left to actually match on. */
  remainder: string;
  label: string;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Most recent Saturday 00:00 through Monday 00:00.
 * getDay() is 0=Sun..6=Sat, so (day + 1) % 7 is the number of days back to
 * Saturday — 6 on a Friday, 1 on a Sunday (i.e. the weekend you're in).
 */
function lastWeekend(today: Date): { after: Date; before: Date } {
  const saturday = addDays(today, -((today.getDay() + 1) % 7));
  return { after: saturday, before: addDays(saturday, 2) };
}

export function parseTimeframe(query: string, now: Date = new Date()): Timeframe {
  const today = startOfDay(now);
  const text = query.toLowerCase();

  const rules: { pattern: RegExp; window: () => { after: Date | null; before: Date | null }; label: string }[] = [
    {
      pattern: /\btoday\b/,
      window: () => ({ after: today, before: addDays(today, 1) }),
      label: "today",
    },
    {
      pattern: /\byesterday\b/,
      window: () => ({ after: addDays(today, -1), before: today }),
      label: "yesterday",
    },
    {
      pattern: /\b(last|past|this)\s+weekend\b/,
      window: () => lastWeekend(today),
      label: "that weekend",
    },
    {
      pattern: /\b(this|the past|last)\s+week\b/,
      window: () => ({ after: addDays(today, -7), before: addDays(today, 1) }),
      label: "the past week",
    },
    {
      pattern: /\b(this|the past|last)\s+month\b/,
      window: () => ({ after: addDays(today, -30), before: addDays(today, 1) }),
      label: "the past month",
    },
    {
      pattern: /\b(this|the past|last)\s+year\b/,
      window: () => ({ after: addDays(today, -365), before: addDays(today, 1) }),
      label: "the past year",
    },
    {
      pattern: /\b(?:last|past)\s+(\d+)\s+days?\b/,
      window: () => {
        const days = Number(text.match(/\b(?:last|past)\s+(\d+)\s+days?\b/)?.[1] ?? 7);
        return { after: addDays(today, -days), before: addDays(today, 1) };
      },
      label: "recently",
    },
  ];

  for (const rule of rules) {
    if (!rule.pattern.test(text)) continue;
    const { after, before } = rule.window();
    return {
      after,
      before,
      remainder: query.replace(new RegExp(rule.pattern.source, "gi"), " ").replace(/\s+/g, " ").trim(),
      label: rule.label,
    };
  }

  return { after: null, before: null, remainder: query, label: "" };
}

/**
 * True when what's left after removing the time phrase carries no topic —
 * "what did I record yesterday" is a request to list a day, not to rank it.
 */
export function isPurelyTemporal(remainder: string): boolean {
  const withoutFiller = remainder
    .toLowerCase()
    .replace(
      // "ideas" and "thoughts" count as filler here: in a tool where every
      // entry is one, "ideas from last weekend" names no topic at all.
      /\b(what|when|did|do|i|me|my|say|said|talk|talked|about|record|recorded|recording|recordings|note|notes|idea|ideas|thought|thoughts|show|tell|find|anything|everything|something|from|any|some|was|were|is|there|of|the|a|an|all)\b/g,
      " ",
    )
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return withoutFiller.length === 0;
}

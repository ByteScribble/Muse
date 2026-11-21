// Thin wrapper around the OpenAI REST API. No SDK — three endpoints:
// transcription, structured enrichment (Responses API), and embeddings.

const API_ROOT = "https://api.openai.com/v1";

function apiKey(): string {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return key;
}

// Override any of these via `supabase secrets set` if OpenAI renames a model
// out from under us — nothing else in the code needs to change.
export const TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") ?? "gpt-transcribe";
export const ENRICHMENT_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
export const EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 768;

export interface Enrichment {
  title: string;
  summary: string;
  keywords: string[];
  topics: string[];
  people: string[];
  projects: string[];
  suggested_collection: string | null;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/m4a": "m4a",
  "audio/mp4": "mp4",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/mpeg": "mp3",
};

export async function transcribeAudio(params: { audioBytes: Uint8Array; mimeType: string }): Promise<string> {
  const extension = EXTENSION_BY_MIME[params.mimeType] ?? "m4a";
  const form = new FormData();
  form.append("file", new Blob([params.audioBytes], { type: params.mimeType }), `audio.${extension}`);
  form.append("model", TRANSCRIBE_MODEL);

  const res = await fetch(`${API_ROOT}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`OpenAI transcription failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (typeof json.text !== "string") throw new Error("OpenAI returned no transcript");
  return json.text;
}

const enrichmentSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "A short, specific title, five words or fewer." },
    summary: { type: "string", description: "One or two sentence summary of the idea." },
    keywords: { type: "array", items: { type: "string" }, description: "3-8 salient keywords." },
    topics: {
      type: "array",
      items: { type: "string" },
      description: "1-3 broad topics, e.g. 'startup idea', 'travel', 'finance'.",
    },
    people: { type: "array", items: { type: "string" }, description: "Names of people mentioned, if any." },
    projects: {
      type: "array",
      items: { type: "string" },
      description: "Named projects, products, or companies mentioned, if any.",
    },
    suggested_collection: {
      type: ["string", "null"],
      description:
        "If this idea clearly continues an existing collection from the provided list, return that exact name. If it starts a new recurring theme, propose a short new collection name. If it's a one-off with no clear thread, return null.",
    },
  },
  required: ["title", "summary", "keywords", "topics", "people", "projects", "suggested_collection"],
  additionalProperties: false,
};

function extractOutputText(json: any): string {
  for (const item of json.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  throw new Error("OpenAI returned no structured output");
}

export async function enrichTranscript(params: {
  transcript: string;
  existingCollections: string[];
}): Promise<Enrichment> {
  const instructions = [
    "You are organizing a personal voice memo — a stream-of-consciousness thought, not a formal recording.",
    "Extract structured metadata from the transcript.",
    params.existingCollections.length > 0
      ? `The speaker's existing collections are: ${params.existingCollections.join(", ")}.`
      : "The speaker has no existing collections yet.",
  ].join("\n");

  const res = await fetch(`${API_ROOT}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ENRICHMENT_MODEL,
      input: [
        { role: "system", content: instructions },
        { role: "user", content: params.transcript },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "enrichment",
          schema: enrichmentSchema,
          strict: true,
        },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI responses failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  return JSON.parse(extractOutputText(json)) as Enrichment;
}

export interface RecalledAnswer {
  answer: string;
  /** Indices of the supplied notes the answer actually leaned on. */
  used: number[];
}

const answerSchema = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description:
        "A direct, second-person answer in 1-3 sentences, as if reminding the speaker what they said. Never invent anything not present in the notes. If the notes don't answer the question, say so plainly.",
    },
    used: {
      type: "array",
      items: { type: "integer" },
      description: "Indices of the notes the answer actually used. Empty if none were relevant.",
    },
  },
  required: ["answer", "used"],
  additionalProperties: false,
};

/**
 * Turns retrieved notes into a reply. Retrieval alone gives a filing cabinet;
 * the product promise is "what do I know about this?", which needs an answer.
 */
export async function answerFromNotes(params: {
  question: string;
  notes: { title: string | null; created_at: string; transcript: string }[];
}): Promise<RecalledAnswer> {
  const context = params.notes
    .map(
      (note, index) =>
        `[${index}] ${note.created_at.slice(0, 10)} — ${note.title ?? "Untitled"}\n${note.transcript}`,
    )
    .join("\n\n");

  const res = await fetch(`${API_ROOT}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ENRICHMENT_MODEL,
      input: [
        {
          role: "system",
          content: [
            "You are the speaker's own memory. They are asking what they previously said.",
            "Answer from the notes only, in the second person (\"You said…\", \"You've come back to…\").",
            "Mention when they said it when that matters. Be brief — this is a reminder, not a report.",
            "If the notes do not actually answer the question, say so instead of stretching.",
          ].join(" "),
        },
        { role: "user", content: `Question: ${params.question}\n\nNotes:\n${context}` },
      ],
      text: {
        format: { type: "json_schema", name: "recalled_answer", schema: answerSchema, strict: true },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI answer failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  return JSON.parse(extractOutputText(json)) as RecalledAnswer;
}

export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${API_ROOT}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const values = json.data?.[0]?.embedding;
  if (!Array.isArray(values)) throw new Error("OpenAI returned no embedding");
  return values;
}

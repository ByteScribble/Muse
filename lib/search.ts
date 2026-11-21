import { File } from "expo-file-system";
import { functionErrorMessage, supabase } from "./supabase";
import { isPurelyTemporal, parseTimeframe } from "./timeframe";
import { SearchResult } from "./types";

export interface Recall {
  /** A direct answer read out of the notes, when the notes support one. */
  answer: string | null;
  results: SearchResult[];
}

export async function searchEntries(query: string): Promise<Recall> {
  // "yesterday" is a fact about this device's clock, so the window is resolved
  // here and sent as explicit timestamps.
  const timeframe = parseTimeframe(query);
  const temporalOnly = timeframe.after !== null && isPurelyTemporal(timeframe.remainder);

  const { data, error } = await supabase.functions.invoke<Recall>("search", {
    body: {
      query,
      // Ranking a listing by relevance to leftover filler words is noise, so a
      // purely temporal query searches on the original phrasing but ignores score.
      search_text: temporalOnly ? query : timeframe.remainder || query,
      after: timeframe.after?.toISOString() ?? null,
      before: timeframe.before?.toISOString() ?? null,
      relevance_optional: temporalOnly,
      timeframe_label: timeframe.label || null,
    },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  return { answer: data?.answer ?? null, results: data?.results ?? [] };
}

/** Spoken query → text. Sent as raw bytes; the query itself is never stored. */
export async function transcribeQuery(fileUri: string): Promise<string> {
  // Same caveat as saveRecording: fetch() cannot read file:// bodies in RN.
  const bytes = await new File(fileUri).bytes();

  // functions.invoke only recognises Blob and ArrayBuffer as binary — a
  // Uint8Array falls through to JSON.stringify and arrives as
  // {"0":26,"1":0,…}, which the transcriber rejects as a corrupt file. The
  // slice is what makes this correct rather than lucky: `.buffer` is the whole
  // backing store, which can be larger than this view.
  const audio = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  const { data, error } = await supabase.functions.invoke<{ text: string }>("transcribe", {
    body: audio,
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  return data?.text?.trim() ?? "";
}

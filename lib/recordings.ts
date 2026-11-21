import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { classifyIntent, shouldSearch } from "./intent";
import { supabase } from "./supabase";
import { transcribeQuery } from "./search";

// Audio lives under a date-partitioned path so the bucket stays browsable as
// it grows — {user_id}/{YYYY}/{MM}/{recording_id}.m4a. The first segment must
// stay the user id: the storage RLS policies match on it.
function audioPath(userId: string, recordingId: string, at: Date): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  return `${userId}/${year}/${month}/${recordingId}.m4a`;
}

export interface Captured {
  recordingId: string;
  transcript: string;
  /** Set when the utterance was confidently a question about existing notes. */
  question: string | null;
}

/**
 * One entry point for everything you say.
 *
 * The order is the whole design: the audio is uploaded and the row inserted
 * *before* anything tries to interpret it. Routing then decides what you see
 * next, never whether the recording survives — so misreading a thought as a
 * question costs a spurious search, not a lost idea.
 */
export async function capture(params: { fileUri: string; durationMs: number }): Promise<Captured> {
  const recordingId = await saveRecording(params);

  let transcript = "";
  try {
    transcript = await transcribeQuery(params.fileUri);
  } catch (err) {
    // Transcription is how we route, not how we store. If it fails, enrichment
    // will transcribe again server-side and the note still lands.
    console.error("routing transcription failed", err);
  }

  // Enrichment runs regardless — a question is still something you said, and
  // keeping it searchable is what makes a misroute recoverable.
  supabase.functions
    .invoke("enrich", { body: { recording_id: recordingId, transcript: transcript || undefined } })
    .catch((err) => console.error("enrich invoke failed", err));

  const intent = classifyIntent(transcript);
  return {
    recordingId,
    transcript,
    question: transcript && shouldSearch(intent) ? transcript : null,
  };
}

// Capture is the whole point of the product — this must never require more
// than an upload and one insert before the button returns to idle.
export async function saveRecording(params: { fileUri: string; durationMs: number }): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const recordingId = randomUUID();
  const path = audioPath(user.id, recordingId, new Date());

  // Read through expo-file-system, NOT fetch(fileUri).arrayBuffer() — React
  // Native's fetch does not read file:// bodies and silently yields a few
  // junk bytes, which storage accepts and transcription then rejects.
  const audio = await new File(params.fileUri).bytes();
  if (audio.byteLength === 0) throw new Error("Recording was empty");

  const { error: uploadError } = await supabase.storage
    .from("recordings")
    .upload(path, audio, { contentType: "audio/m4a" });
  if (uploadError) throw uploadError;

  const { error: insertError } = await supabase.from("recordings").insert({
    id: recordingId,
    user_id: user.id,
    audio_path: path,
    duration_ms: Math.round(params.durationMs),
    status: "pending",
  });
  if (insertError) throw insertError;

  // Deliberately does not kick off enrichment — `capture` owns that, so the
  // transcript it already has can be reused instead of paid for twice.
  return recordingId;
}

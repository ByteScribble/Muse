import { supabase } from "./supabase";
import { RecordingStatus } from "./types";

/** One row in the notes list — a recording plus whatever enrichment exists yet. */
export interface Note {
  recordingId: string;
  entryId: string | null;
  status: RecordingStatus;
  createdAt: string;
  durationMs: number | null;
  title: string | null;
  summary: string | null;
  transcript: string | null;
  keywords: string[];
  topics: string[];
  people: string[];
  projects: string[];
  collections: string[];
}

interface RecordingRow {
  id: string;
  status: RecordingStatus;
  created_at: string;
  duration_ms: number | null;
  audio_path: string;
}

interface EntryRow {
  id: string;
  recording_id: string;
  title: string | null;
  summary: string | null;
  transcript: string;
  keywords: string[];
  topics: string[];
  people: string[];
  projects: string[];
}

function toNote(recording: RecordingRow, entry: EntryRow | undefined, collections: string[]): Note {
  return {
    recordingId: recording.id,
    entryId: entry?.id ?? null,
    status: recording.status,
    createdAt: recording.created_at,
    durationMs: recording.duration_ms,
    title: entry?.title ?? null,
    summary: entry?.summary ?? null,
    transcript: entry?.transcript ?? null,
    keywords: entry?.keywords ?? [],
    topics: entry?.topics ?? [],
    people: entry?.people ?? [],
    projects: entry?.projects ?? [],
    collections,
  };
}

export async function listNotes(): Promise<Note[]> {
  const [{ data: recordings, error: recordingsError }, { data: entries, error: entriesError }] =
    await Promise.all([
      supabase
        .from("recordings")
        .select("id, status, created_at, duration_ms, audio_path")
        .order("created_at", { ascending: false }),
      supabase
        .from("entries")
        .select("id, recording_id, title, summary, transcript, keywords, topics, people, projects"),
    ]);
  if (recordingsError) throw recordingsError;
  if (entriesError) throw entriesError;

  const entryByRecording = new Map((entries ?? []).map((e) => [e.recording_id, e as EntryRow]));
  return (recordings ?? []).map((r) => toNote(r as RecordingRow, entryByRecording.get(r.id), []));
}

export async function getNote(recordingId: string): Promise<Note | null> {
  const { data: recording, error: recordingError } = await supabase
    .from("recordings")
    .select("id, status, created_at, duration_ms, audio_path")
    .eq("id", recordingId)
    .maybeSingle();
  if (recordingError) throw recordingError;
  if (!recording) return null;

  const { data: entry, error: entryError } = await supabase
    .from("entries")
    .select("id, recording_id, title, summary, transcript, keywords, topics, people, projects")
    .eq("recording_id", recordingId)
    .maybeSingle();
  if (entryError) throw entryError;

  let collections: string[] = [];
  if (entry) {
    const { data: links } = await supabase
      .from("collection_entries")
      .select("collections(name)")
      .eq("entry_id", entry.id);
    collections = (links ?? [])
      .map((l) => (l.collections as unknown as { name: string } | null)?.name)
      .filter((name): name is string => Boolean(name));
  }

  return toNote(recording as RecordingRow, (entry ?? undefined) as EntryRow | undefined, collections);
}

/** Private bucket — playback needs a short-lived signed URL, not a public one. */
export async function getAudioUrl(recordingId: string): Promise<string | null> {
  const { data: recording } = await supabase
    .from("recordings")
    .select("audio_path")
    .eq("id", recordingId)
    .maybeSingle();
  if (!recording) return null;

  const { data, error } = await supabase.storage
    .from("recordings")
    .createSignedUrl(recording.audio_path, 60 * 60);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

export function formatDuration(ms: number | null): string {
  if (!ms) return "";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

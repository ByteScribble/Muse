export type RecordingStatus = "pending" | "processing" | "done" | "error";

export interface Recording {
  id: string;
  user_id: string;
  audio_path: string;
  duration_ms: number | null;
  status: RecordingStatus;
  error: string | null;
  created_at: string;
}

export interface Entry {
  id: string;
  recording_id: string;
  user_id: string;
  transcript: string;
  title: string | null;
  summary: string | null;
  keywords: string[];
  topics: string[];
  people: string[];
  projects: string[];
  created_at: string;
}

export interface Collection {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface SearchResult {
  id: string;
  recording_id: string;
  title: string | null;
  summary: string | null;
  transcript: string;
  keywords: string[];
  topics: string[];
  created_at: string;
  similarity: number;
}

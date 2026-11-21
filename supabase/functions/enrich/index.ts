// Called by the app right after a recording finishes uploading.
// Input: { recording_id: string }. Runs as the calling user (RLS-scoped) so
// the service role key never has to leave this function.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { embedText, enrichTranscript, transcribeAudio } from "../_shared/openai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  let recordingId: string | undefined;

  try {
    // `transcript` is optional: the capture flow already transcribes in order
    // to route the utterance, and passing it back avoids paying for the same
    // audio twice.
    const { recording_id, transcript: providedTranscript } = await req.json();
    recordingId = recording_id;
    if (!recording_id) throw new Error("recording_id is required");
    if (!authHeader) throw new Error("Missing Authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { data: recording, error: recordingError } = await supabase
      .from("recordings")
      .select("id, audio_path, status")
      .eq("id", recording_id)
      .single();
    if (recordingError || !recording) throw new Error("Recording not found");

    await supabase.from("recordings").update({ status: "processing" }).eq("id", recording.id);

    let transcript: string = (providedTranscript ?? "").trim();
    if (transcript.length === 0) {
      const { data: audioBlob, error: downloadError } = await supabase.storage
        .from("recordings")
        .download(recording.audio_path);
      if (downloadError || !audioBlob) {
        throw new Error(`Could not download audio: ${downloadError?.message}`);
      }
      const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());
      transcript = (
        await transcribeAudio({ audioBytes, mimeType: audioBlob.type || "audio/m4a" })
      ).trim();
    }

    // Silence, a pocket tap, a mic that never opened — don't spend an
    // enrichment call on it and don't leave an empty note in the list.
    if (transcript.length === 0) throw new Error("Nothing was said in this recording");

    const { data: existing } = await supabase.from("collections").select("name");
    const existingCollections = (existing ?? []).map((c) => c.name);

    const enrichment = await enrichTranscript({ transcript, existingCollections });

    const embedding = await embedText(`${enrichment.title}\n${enrichment.summary}\n${transcript}`);

    const { data: entry, error: entryError } = await supabase
      .from("entries")
      .insert({
        recording_id: recording.id,
        user_id: user.id,
        transcript,
        title: enrichment.title,
        summary: enrichment.summary,
        keywords: enrichment.keywords,
        topics: enrichment.topics,
        people: enrichment.people,
        projects: enrichment.projects,
        embedding,
      })
      // Never select the embedding back — 768 floats the caller has no use for.
      .select("id, recording_id, transcript, title, summary, keywords, topics, people, projects, created_at")
      .single();
    if (entryError || !entry) throw new Error(`Could not save entry: ${entryError?.message}`);

    if (enrichment.suggested_collection) {
      const name = enrichment.suggested_collection.trim();
      let collectionId: string;
      const match = (existing ?? []).find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (match) {
        const { data: full } = await supabase
          .from("collections")
          .select("id")
          .eq("name", match.name)
          .single();
        collectionId = full!.id;
      } else {
        const { data: created, error: createError } = await supabase
          .from("collections")
          .insert({ user_id: user.id, name })
          .select("id")
          .single();
        if (createError || !created) throw new Error(`Could not create collection: ${createError?.message}`);
        collectionId = created.id;
      }
      await supabase.from("collection_entries").insert({ collection_id: collectionId, entry_id: entry.id });
    }

    await supabase.from("recordings").update({ status: "done" }).eq("id", recording.id);

    return new Response(JSON.stringify({ entry }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      if (recordingId && authHeader) {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        await supabase.from("recordings").update({ status: "error", error: message }).eq("id", recordingId);
      }
    } catch {
      // best-effort status update only
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

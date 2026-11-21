// Natural-language recall over the caller's own notes.
// Input:  { query: string, match_count?: number }
// Output: { answer: string | null, results: Entry[] }
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { answerFromNotes, embedText } from "../_shared/openai.ts";

// How many notes the answer is allowed to read. Enough to spot a recurring
// theme, small enough to keep the call fast.
const ANSWER_CONTEXT = 6;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const {
      query,
      match_count,
      search_text,
      after = null,
      before = null,
      relevance_optional = false,
      timeframe_label = null,
    } = await req.json();
    if (!query || typeof query !== "string") throw new Error("query is required");

    // The device resolved any time phrase against its own clock; we just apply it.
    const searchText: string = search_text || query;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const queryEmbedding = await embedText(searchText);

    // Hybrid: embeddings for meaning, full-text for the names and codenames
    // embeddings smear away. See the migration for the measurement.
    const { data: results, error } = await supabase.rpc("search_entries", {
      query_text: searchText,
      query_embedding: queryEmbedding,
      match_count: match_count ?? 10,
      after,
      before,
      relevance_optional,
    });
    if (error) throw new Error(error.message);

    const hits = results ?? [];

    // Nothing cleared the relevance floor. Say nothing rather than dressing up
    // the corpus's nearest unrelated note as an answer.
    if (hits.length === 0) {
      const answer = timeframe_label ? `You didn't record anything ${timeframe_label}.` : null;
      return new Response(JSON.stringify({ answer, results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let answer: string | null = null;
    try {
      const recalled = await answerFromNotes({
        question: query,
        notes: hits.slice(0, ANSWER_CONTEXT),
      });
      answer = recalled.answer;
    } catch (err) {
      // The notes are the substance; the summary is a convenience. If it fails
      // the user still gets their recordings back.
      console.error("answer synthesis failed", err);
    }

    return new Response(JSON.stringify({ answer, results: hits }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

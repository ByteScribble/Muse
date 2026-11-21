// Speech-to-text for spoken search queries. Takes raw audio bytes as the
// request body and returns { text }. Nothing is stored — a query is not a note.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { transcribeAudio } from "../_shared/openai.ts";

const MAX_QUERY_BYTES = 5 * 1024 * 1024; // a spoken query is seconds, not minutes

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
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

    const audioBytes = new Uint8Array(await req.arrayBuffer());
    if (audioBytes.byteLength === 0) throw new Error("Empty audio body");
    if (audioBytes.byteLength > MAX_QUERY_BYTES) throw new Error("Query audio too large");

    const text = await transcribeAudio({ audioBytes, mimeType: "audio/m4a" });

    return new Response(JSON.stringify({ text }), {
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

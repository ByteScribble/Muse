# Muse

Muse is a voice memory app. Hold the mic button, say what is on your mind, and let go. Muse transcribes the recording, gives it a title, summary and keywords, files it into a collection when it belongs to one, and lets you find it again later by asking in plain language, by typing or by voice. It is built with Expo / React Native and Supabase, with OpenAI doing the speech and language work behind two small edge functions.

> **Status:** early-stage. The core capture and recall loop works, but expect rough edges, missing tests and breaking changes to the schema.

## Features

- **Hold-to-record capture.** Audio is recorded as speech-tuned 16 kHz mono AAC (`.m4a`) and uploaded to a private Supabase Storage bucket. Recordings with no detected speech, or that are too short, are rejected on the device.
- **Transcription and enrichment.** Each recording gets a transcript, a short title, a one or two sentence summary, keywords, topics, people and projects.
- **Automatic collections.** Enrichment can attach a note to an existing collection or create a new one when a recurring theme appears.
- **Natural-language search.** Ask things like "what did I say about the pricing idea?" and get a short answer read from your own notes, plus links to the source recordings. Search is hybrid: pgvector embeddings for meaning and Postgres full-text for names and codenames.
- **Time phrases.** Queries such as "yesterday" are resolved on the device against its own clock and sent as an explicit date window.
- **Speak or type a query.** A question spoken into the mic is detected with a conservative on-device heuristic (English plus some Hindi and Hinglish phrasing). Anything ambiguous is saved as a note, so a thought is never lost.
- **Notes list and detail.** Notes are grouped by recency (Today, Yesterday, Previous 7 Days, and so on), update live through Supabase Realtime, and play back through short-lived signed URLs.
- **Email one-time-code sign-in.** No passwords. Every table and the audio bucket are protected by row level security, so each user only sees their own data.

## Architecture

There is no custom backend server. The app talks to Supabase directly, and to edge functions that keep the OpenAI key off the device.

```
Expo app (record, notes, search)
  -> Supabase Storage          private "recordings" bucket, path {user_id}/{yyyy}/{mm}/{id}.m4a
  -> Supabase Postgres         recordings, entries, collections, collection_entries (RLS on)
                               pgvector (768-dim, HNSW cosine index) + full-text index
  -> Edge function  transcribe   audio bytes in  -> text out (used for spoken queries and routing)
  -> Edge function  enrich       recording id in -> transcript, title, summary, keywords, embedding saved
  -> Edge function  search       query in        -> embedding + full-text -> ranked notes + short answer
  -> OpenAI                      transcription, structured output (Responses API), embeddings
```

Edge functions run with the caller's own JWT, so row level security applies to everything they read or write. No service-role key is used. Model names default to `gpt-transcribe`, `gpt-4o-mini` and `text-embedding-3-small`, and can be overridden with function secrets (`OPENAI_TRANSCRIBE_MODEL`, `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`).

## Requirements

- Node.js 20 or newer and npm
- Docker (the Supabase CLI runs the local stack in containers)
- The Supabase CLI. It is a dev dependency, so `npx supabase ...` works after `npm install`.
- An OpenAI API key
- For iOS: macOS with Xcode and a simulator. For Android: Android Studio with an emulator or a device.

The app uses a development build (`expo-dev-client`, native modules), not Expo Go. Expo SDK 57 is used; see the [Expo SDK 57 docs](https://docs.expo.dev/versions/v57.0.0/) when changing anything Expo-specific.

## Local setup

1. **Install dependencies.**

   ```bash
   npm install
   ```

2. **Start the local Supabase stack.** The first run pulls Docker images.

   ```bash
   npx supabase start
   ```

   This applies everything in `supabase/migrations/` automatically. To reapply from scratch later, run `npx supabase db reset`. When it finishes, run `npx supabase status` to see the API URL and the anon (publishable) key.

3. **Set the function secret.** Copy `supabase/functions/.env.example` to `supabase/functions/.env` (git-ignored) and fill it in:

   ```bash
   OPENAI_API_KEY=your-key-here
   ```

   Optional overrides: `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`.

4. **Serve the edge functions** in a separate terminal and leave it running:

   ```bash
   npx supabase functions serve
   ```

5. **Configure the app.** Copy `.env.example` to `.env` in the repo root (git-ignored) and fill it in:

   ```bash
   EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   ```

   Use the values from `npx supabase status`. On a physical device, `127.0.0.1` points at the phone itself, so use your computer's address on the local network instead. The Android emulator reaches the host at `10.0.2.2`.

6. **Run the app.** This builds a native development build the first time.

   ```bash
   npm run ios       # iOS simulator
   npm run android   # Android emulator or device
   ```

7. **Sign in.** Enter an email address. The local stack does not send real mail; open the Mailpit/Inbucket inbox at `http://127.0.0.1:54324`, copy the 6-digit code and enter it in the app. Then hold the mic button and talk.

### Using a hosted Supabase project

```bash
npx supabase login
npx supabase link --project-ref your-project-ref
npx supabase db push
npx supabase secrets set OPENAI_API_KEY=your-key-here
npx supabase functions deploy enrich
npx supabase functions deploy search
npx supabase functions deploy transcribe
```

Then point `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` at the project (Project Settings, API). Email sign-in is enabled by default on new projects.

## Project layout

```
app/                      Expo Router screens
  (tabs)/index.tsx          Home: hold-to-record button, search box, answer card
  (tabs)/notes.tsx          Notes list, live-updating
  note/[id].tsx             Note detail with audio playback
  sign-in.tsx               Email one-time-code sign-in
components/               AnswerCard, Waveform
lib/
  supabase.ts               Client setup and edge-function error helper
  recordings.ts             Upload, insert, trigger enrichment
  audio.ts                  Recording options and silence gate
  search.ts                 Search and spoken-query calls
  intent.ts                 Question-or-thought heuristic
  timeframe.ts              "yesterday"-style date windows
  notes.ts, grouping.ts, types.ts, theme.ts
supabase/
  config.toml               Local stack configuration
  migrations/               Schema, RLS, storage bucket, realtime, hybrid search
  functions/enrich/         Transcript to structured note + embedding
  functions/search/         Hybrid retrieval and answer synthesis
  functions/transcribe/     Audio to text
  functions/_shared/        OpenAI wrapper, CORS headers
```

The `munim-transcribe` function in `supabase/functions/` is not called by the Muse app. It is a separate, unauthenticated speech-to-text endpoint for a different product (dictated shop bills) that shares this Supabase project, so you can ignore it and do not need to deploy it.

## Contributing

Contributions are welcome once the project settles; for now, please open an issue before starting anything large so we can agree on direction. For a change:

1. Fork the repo and create a branch.
2. Run the app against a local Supabase stack as described above and check the flow you touched (record, note appears, search finds it).
3. Run `npx tsc --noEmit` to type-check.
4. Open a pull request describing what changed and why. Schema changes need a new file in `supabase/migrations/`, never an edit to an existing one.

Never commit `.env` files, API keys or other secrets.

## License

MIT. See [LICENSE](LICENSE).

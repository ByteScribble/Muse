import { AudioModule, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AnswerCard } from "../../components/AnswerCard";
import { Waveform, WAVEFORM_BARS } from "../../components/Waveform";
import { levelFromDbfs, PeakMeter, SPEECH_RECORDING } from "../../lib/audio";
import { formatDuration, listNotes, Note } from "../../lib/notes";
import { capture } from "../../lib/recordings";
import { searchEntries, transcribeQuery } from "../../lib/search";
import { colors, radius, spacing } from "../../lib/theme";
import { SearchResult } from "../../lib/types";

const METER_INTERVAL_MS = 100;
const RECENT_COUNT = 4;

/** What the big button is doing right now. Search-by-voice reuses the same recorder. */
type Mode = "idle" | "capturing" | "asking";

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function Home() {
  const recorder = useAudioRecorder(SPEECH_RECORDING);
  const state = useAudioRecorderState(recorder, METER_INTERVAL_MS);
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>([]);
  const meter = useRef(new PeakMeter()).current;

  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showingAnswer, setShowingAnswer] = useState(false);
  const [recent, setRecent] = useState<Note[]>([]);

  useEffect(() => {
    (async () => {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert("Microphone access needed", "Muse can't capture a thought without it.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!state.isRecording) return;
    meter.observe(state.metering);
    setLevels((prev) => [...prev, levelFromDbfs(state.metering)].slice(-WAVEFORM_BARS));
  }, [state.isRecording, state.metering, state.durationMillis, meter]);

  const loadRecent = useCallback(async () => {
    try {
      setRecent((await listNotes()).slice(0, RECENT_COUNT));
    } catch (err) {
      console.error("failed to load recent notes", err);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRecent();
    }, [loadRecent]),
  );

  const flashNotice = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 3000);
  };

  const runSearch = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    Keyboard.dismiss();
    setBusy("Looking through your notes…");
    setShowingAnswer(true);
    setAnswer(null);
    setResults([]);
    try {
      const recall = await searchEntries(trimmed);
      setAnswer(recall.answer);
      setResults(recall.results);
    } catch (err) {
      Alert.alert("Search failed", err instanceof Error ? err.message : String(err));
      setShowingAnswer(false);
    } finally {
      setBusy(null);
    }
  };

  const startRecording = async (next: Mode) => {
    if (!ready || busy) return;
    Keyboard.dismiss();
    setNotice(null);
    setLevels([]);
    meter.reset();
    setMode(next);
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const stopRecording = async () => {
    const durationMs = state.durationMillis;
    const wasSilent = meter.isSilent();
    const asking = mode === "asking";
    await recorder.stop();
    const uri = recorder.uri;
    setLevels([]);
    setMode("idle");

    if (!uri || durationMs < 500) {
      flashNotice("Too short — say a little more.");
      return;
    }
    if (wasSilent) {
      flashNotice("Didn't hear anything — check the mic and try again.");
      return;
    }

    // Asking is transient: a question is not a note, so it is transcribed and
    // answered without ever being stored.
    if (asking) {
      setBusy("Making sense of that…");
      try {
        const text = await transcribeQuery(uri);
        if (!text) {
          flashNotice("Didn't catch that.");
          return;
        }
        setQuery(text);
        await runSearch(text);
      } catch (err) {
        Alert.alert("Couldn't hear that", err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
      return;
    }

    setBusy("Saving…");
    try {
      const { question } = await capture({ fileUri: uri, durationMs });
      // Saved either way. If it was clearly a question about existing notes,
      // answer it here rather than making them ask again.
      if (question) {
        setQuery(question);
        await runSearch(question);
      } else {
        flashNotice("Saved. Muse is transcribing it.");
        loadRecent();
      }
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const dismissAnswer = () => {
    setShowingAnswer(false);
    setAnswer(null);
    setResults([]);
    setQuery("");
    loadRecent();
  };

  const recording = state.isRecording;
  const hint = busy ?? notice ?? (recording ? (mode === "asking" ? "Listening…" : "Listening") : "Tap to record a thought");

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Recording collapses the screen to a timer and a waveform. Nothing to
          read is the point — you should be thinking, not proofreading. */}
      {!recording && (
        <View style={styles.top}>
          <Text style={styles.title}>Muse</Text>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.input}
              placeholder="Ask your memory…"
              placeholderTextColor={colors.textFaint}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => runSearch(query)}
              returnKeyType="search"
              editable={!busy}
            />
            <Pressable
              onPress={() => startRecording("asking")}
              disabled={!ready || !!busy}
              accessibilityRole="button"
              accessibilityLabel="Ask by voice"
              style={({ pressed }) => [styles.askMic, (pressed || !!busy) && styles.dim]}
            >
              <Text style={styles.askMicIcon}>🔍</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {busy && showingAnswer ? (
              <ActivityIndicator style={{ marginTop: spacing.lg }} />
            ) : showingAnswer ? (
              <AnswerCard
                answer={answer}
                results={results}
                onOpen={(id) => router.push(`/note/${id}`)}
                onDismiss={dismissAnswer}
              />
            ) : (
              <>
                <Text style={styles.recentLabel}>Recent</Text>
                {recent.length === 0 ? (
                  <Text style={styles.emptyRecent}>
                    Nothing yet. Tap the button and say what's on your mind.
                  </Text>
                ) : (
                  recent.map((note) => (
                    <Pressable
                      key={note.recordingId}
                      style={({ pressed }) => [styles.noteRow, pressed && styles.dim]}
                      onPress={() => router.push(`/note/${note.recordingId}`)}
                    >
                      <Text style={styles.noteTitle} numberOfLines={1}>
                        {note.title ??
                          (note.status === "error" ? "Couldn't transcribe" : "Transcribing…")}
                      </Text>
                      <Text style={styles.noteMeta}>{formatDuration(note.durationMs)}</Text>
                    </Pressable>
                  ))
                )}
                <Pressable onPress={() => router.push("/notes")}>
                  <Text style={styles.seeAll}>See all notes →</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      )}

      <View style={[styles.stage, recording && styles.stageRecording]}>
        {recording && <Text style={styles.timer}>{formatElapsed(state.durationMillis)}</Text>}

        <Waveform levels={levels} active={recording} />

        <Pressable
          onPress={() => (recording ? stopRecording() : startRecording("capturing"))}
          disabled={!ready || !!busy}
          accessibilityRole="button"
          accessibilityLabel={recording ? "Stop" : "Record a thought"}
          style={({ pressed }) => [
            styles.button,
            recording && (mode === "asking" ? styles.buttonAsking : styles.buttonRecording),
            (!ready || !!busy) && styles.buttonDisabled,
            pressed && styles.dim,
          ]}
        >
          <View style={recording ? styles.iconSquare : styles.iconCircle} />
        </Pressable>

        <Text style={[styles.hint, notice && styles.hintNotice]} numberOfLines={2}>
          {hint}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  top: { flex: 1, paddingHorizontal: spacing.md },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.5,
    paddingTop: spacing.sm,
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: 16,
    color: colors.text,
  },
  askMic: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  askMicIcon: { fontSize: 17 },
  body: { flex: 1, marginTop: spacing.md },
  bodyContent: { paddingBottom: spacing.md },
  recentLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textFaint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  emptyRecent: { fontSize: 14, color: colors.textMuted, lineHeight: 21 },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  noteTitle: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  noteMeta: { fontSize: 11, color: colors.textFaint },
  seeAll: { fontSize: 14, color: colors.textMuted, paddingVertical: spacing.md },

  stage: { alignItems: "center", justifyContent: "flex-end", gap: spacing.sm, paddingBottom: spacing.md },
  stageRecording: { flex: 1, justifyContent: "center", gap: spacing.lg },
  timer: {
    fontSize: 40,
    fontWeight: "200",
    color: colors.text,
    fontVariant: ["tabular-nums"],
    letterSpacing: 1,
  },
  button: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonRecording: { backgroundColor: colors.recording, width: 132, height: 132, borderRadius: 66 },
  buttonAsking: { backgroundColor: colors.text, width: 132, height: 132, borderRadius: 66 },
  buttonDisabled: { backgroundColor: colors.textFaint },
  dim: { opacity: 0.7 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface },
  iconSquare: { width: 42, height: 42, borderRadius: radius.sm, backgroundColor: colors.surface },
  hint: {
    fontSize: 14,
    color: colors.textMuted,
    minHeight: 20,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  hintNotice: { color: colors.error },
});

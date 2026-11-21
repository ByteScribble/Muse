import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getAudioUrl, getNote, Note } from "../../lib/notes";
import { colors, radius, spacing } from "../../lib/theme";

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function Player({ recordingId }: { recordingId: string }) {
  const player = useAudioPlayer(undefined, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = await getAudioUrl(recordingId);
        if (!cancelled && url) player.replace(url);
        else if (!cancelled) setLoadFailed(true);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordingId, player]);

  if (loadFailed) return <Text style={styles.playerError}>Audio unavailable</Text>;

  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;

  return (
    <View style={styles.player}>
      <Pressable
        style={styles.playButton}
        disabled={!status.isLoaded}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? "Pause" : "Play"}
        onPress={() => {
          if (status.playing) {
            player.pause();
          } else {
            // Replaying after it ran to the end needs an explicit rewind.
            if (status.duration > 0 && status.currentTime >= status.duration - 0.15) player.seekTo(0);
            player.play();
          }
        }}
      >
        {status.isLoaded ? (
          <Text style={styles.playIcon}>{status.playing ? "❚❚" : "▶"}</Text>
        ) : (
          <ActivityIndicator size="small" color={colors.surface} />
        )}
      </Pressable>

      <View style={styles.playerBody}>
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${Math.min(100, progress * 100)}%` }]} />
        </View>
        <Text style={styles.playerTime}>
          {formatClock(status.currentTime)} / {formatClock(status.duration)}
        </Text>
      </View>
    </View>
  );
}

function Chips({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <View style={styles.chipsBlock}>
      <Text style={styles.chipsLabel}>{label}</Text>
      <View style={styles.chipsRow}>
        {values.map((value) => (
          <Text key={value} style={styles.chip}>
            {value}
          </Text>
        ))}
      </View>
    </View>
  );
}

export default function NoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getNote(id)
      .then(setNote)
      .catch((err) => console.error("failed to load note", err))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!note) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>This note no longer exists.</Text>
      </View>
    );
  }

  const created = new Date(note.createdAt);

  return (
    <>
      <Stack.Screen options={{ title: note.title ?? "Note" }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{note.title ?? "Untitled"}</Text>
        <Text style={styles.date}>
          {created.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          {" · "}
          {created.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </Text>

        <Player recordingId={note.recordingId} />

        {note.summary ? (
          <View style={styles.summaryBox}>
            <Text style={styles.summary}>{note.summary}</Text>
          </View>
        ) : null}

        {note.transcript ? (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>Transcript</Text>
            <Text style={styles.transcript}>{note.transcript}</Text>
          </View>
        ) : note.status === "error" ? (
          <Text style={styles.error}>Transcription failed for this recording.</Text>
        ) : (
          <Text style={styles.muted}>Still transcribing…</Text>
        )}

        <Chips label="Collections" values={note.collections} />
        <Chips label="Topics" values={note.topics} />
        <Chips label="Keywords" values={note.keywords} />
        <Chips label="People" values={note.people} />
        <Chips label="Projects" values={note.projects} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  title: { fontSize: 26, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  date: { fontSize: 13, color: colors.textFaint, marginTop: spacing.xs },

  player: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: { color: colors.surface, fontSize: 16 },
  playerBody: { flex: 1, gap: spacing.sm },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" },
  trackFill: { height: 4, backgroundColor: colors.accent },
  playerTime: { fontSize: 12, color: colors.textFaint, fontVariant: ["tabular-nums"] },
  playerError: { fontSize: 14, color: colors.error, marginTop: spacing.md },

  summaryBox: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  summary: { fontSize: 15, color: colors.text, lineHeight: 22 },

  block: { marginTop: spacing.lg },
  blockLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textFaint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  transcript: { fontSize: 16, color: colors.text, lineHeight: 26 },

  chipsBlock: { marginTop: spacing.lg },
  chipsLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textFaint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    fontSize: 13,
    color: colors.textMuted,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    overflow: "hidden",
  },
  muted: { fontSize: 14, color: colors.textMuted, marginTop: spacing.md },
  error: { fontSize: 14, color: colors.error, marginTop: spacing.md },
});

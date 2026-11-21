import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { groupByRecency } from "../../lib/grouping";
import { formatDuration, listNotes, Note } from "../../lib/notes";
import { supabase } from "../../lib/supabase";
import { colors, radius, spacing } from "../../lib/theme";

function NoteCard({ note, onPress }: { note: Note; onPress: () => void }) {
  const time = new Date(note.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const pending = note.status === "pending" || note.status === "processing";

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} onPress={onPress}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {note.title ?? (pending ? "New recording" : "Untitled")}
        </Text>
        <Text style={styles.cardTime}>{time}</Text>
      </View>

      {pending ? (
        <View style={styles.pendingRow}>
          <ActivityIndicator size="small" color={colors.textFaint} />
          <Text style={styles.pendingText}>Transcribing…</Text>
        </View>
      ) : note.status === "error" ? (
        <Text style={styles.errorText}>Couldn't transcribe this one</Text>
      ) : (
        <Text style={styles.cardSummary} numberOfLines={2}>
          {note.summary ?? note.transcript ?? ""}
        </Text>
      )}

      <View style={styles.cardFooter}>
        {note.durationMs ? <Text style={styles.badge}>▶ {formatDuration(note.durationMs)}</Text> : null}
        {note.topics.slice(0, 2).map((topic) => (
          <Text key={topic} style={styles.badge}>
            {topic}
          </Text>
        ))}
      </View>
    </Pressable>
  );
}

export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      setNotes(await listNotes());
    } catch (err) {
      console.error("failed to load notes", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Realtime keeps an open list fresh while enrichment lands in the background.
  useEffect(() => {
    const channel = supabase
      .channel("notes-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "recordings" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  // …and a refetch on focus covers the cases realtime can't: a dropped socket,
  // or the app coming back from the background.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const sections = groupByRecency(notes).map((s) => ({ title: s.label, data: s.items }));

  if (loading) {
    return (
      <SafeAreaView style={styles.centered} edges={["top"]}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Text style={styles.screenTitle}>Notes</Text>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.recordingId}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        renderItem={({ item }) => (
          <NoteCard note={item} onPress={() => router.push(`/note/${item.recordingId}`)} />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Nothing captured yet.{"\n"}Tap the mic and say something.</Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  screenTitle: {
    fontSize: 30,
    fontWeight: "700",
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    letterSpacing: -0.5,
  },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textFaint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardPressed: { opacity: 0.7 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.text },
  cardTime: { fontSize: 12, color: colors.textFaint },
  cardSummary: { fontSize: 14, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 20 },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  pendingText: { fontSize: 14, color: colors.textFaint, fontStyle: "italic" },
  errorText: { fontSize: 14, color: colors.error, marginTop: spacing.xs },
  cardFooter: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  badge: {
    fontSize: 11,
    color: colors.textMuted,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    overflow: "hidden",
  },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.xl, lineHeight: 22 },
});

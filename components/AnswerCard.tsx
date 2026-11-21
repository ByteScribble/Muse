import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../lib/theme";
import { SearchResult } from "../lib/types";

export function AnswerCard({
  answer,
  results,
  onOpen,
  onDismiss,
}: {
  answer: string | null;
  results: SearchResult[];
  onOpen: (recordingId: string) => void;
  onDismiss: () => void;
}) {
  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>Answer</Text>
        <Pressable onPress={onDismiss} hitSlop={12}>
          <Text style={styles.clear}>Clear</Text>
        </Pressable>
      </View>

      {answer ? (
        <View style={styles.answerCard}>
          <Text style={styles.answerText}>{answer}</Text>
        </View>
      ) : (
        <Text style={styles.empty}>
          Nothing about that yet.{"\n"}Only what you've actually recorded shows up here.
        </Text>
      )}

      {results.length > 0 && <Text style={styles.sourcesLabel}>From these recordings</Text>}
      {results.map((result) => (
        <Pressable
          key={result.id}
          style={({ pressed }) => [styles.source, pressed && styles.pressed]}
          onPress={() => onOpen(result.recording_id)}
        >
          <Text style={styles.sourceTitle} numberOfLines={1}>
            {result.title ?? "Untitled"}
          </Text>
          <Text style={styles.sourceDate}>
            {new Date(result.created_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  headerLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textFaint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  clear: { fontSize: 13, color: colors.textMuted },
  answerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    padding: spacing.md,
  },
  answerText: { fontSize: 16, color: colors.text, lineHeight: 24 },
  empty: { fontSize: 14, color: colors.textMuted, lineHeight: 21, paddingVertical: spacing.sm },
  sourcesLabel: {
    fontSize: 11,
    color: colors.textFaint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  source: {
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
  pressed: { opacity: 0.7 },
  sourceTitle: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  sourceDate: { fontSize: 11, color: colors.textFaint },
});

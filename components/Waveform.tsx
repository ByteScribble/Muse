import { StyleSheet, View } from "react-native";
import { colors } from "../lib/theme";

export const WAVEFORM_BARS = 44;

/**
 * A scrolling level history — the only thing on screen that reacts to what
 * you're saying. Deliberately not a transcript: seeing words while you think
 * turns thinking into editing.
 */
export function Waveform({ levels, active }: { levels: number[]; active: boolean }) {
  // Right-align a partially-filled history so bars grow in from the left.
  const padded = [...Array(Math.max(0, WAVEFORM_BARS - levels.length)).fill(0), ...levels].slice(
    -WAVEFORM_BARS,
  );

  return (
    <View style={styles.row}>
      {padded.map((level, index) => (
        <View
          key={index}
          style={[
            styles.bar,
            {
              height: Math.max(3, level * 48),
              backgroundColor: active ? colors.recording : colors.border,
              opacity: active ? 0.35 + level * 0.65 : 1,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 56,
    gap: 3,
  },
  bar: { width: 3, borderRadius: 1.5 },
});

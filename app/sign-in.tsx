import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";
import { colors, radius, spacing } from "../lib/theme";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const sendOtp = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setLoading(false);
    if (error) {
      Alert.alert("Couldn't send code", error.message);
      return;
    }
    setSent(true);
  };

  const verifyOtp = async () => {
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otp.trim(),
      type: "email",
    });
    setLoading(false);
    if (error) Alert.alert("Couldn't verify", error.message);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Muse</Text>
      <Text style={styles.subtitle}>The best place to think out loud.</Text>

      {!sent ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="you@email.com"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Pressable
            style={({ pressed }) => [styles.button, (loading || !email) && styles.buttonDisabled, pressed && styles.buttonPressed]}
            onPress={sendOtp}
            disabled={loading || !email}
          >
            <Text style={styles.buttonText}>{loading ? "Sending…" : "Send code"}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.hint}>Enter the code sent to {email}</Text>
          <TextInput
            style={[styles.input, styles.otpInput]}
            placeholder="123456"
            placeholderTextColor={colors.textFaint}
            keyboardType="number-pad"
            value={otp}
            onChangeText={setOtp}
          />
          <Pressable
            style={({ pressed }) => [styles.button, (loading || !otp) && styles.buttonDisabled, pressed && styles.buttonPressed]}
            onPress={verifyOtp}
            disabled={loading || !otp}
          >
            <Text style={styles.buttonText}>{loading ? "Verifying…" : "Verify"}</Text>
          </Pressable>
          <Pressable onPress={() => setSent(false)}>
            <Text style={styles.link}>Use a different email</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.bg },
  title: { fontSize: 38, fontWeight: "700", textAlign: "center", color: colors.text, letterSpacing: -1 },
  subtitle: { fontSize: 15, color: colors.textMuted, textAlign: "center", marginBottom: spacing.lg },
  hint: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  otpInput: { fontSize: 24, letterSpacing: 6, textAlign: "center" },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  buttonDisabled: { backgroundColor: colors.textFaint },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: colors.surface, fontSize: 16, fontWeight: "600" },
  link: { textAlign: "center", color: colors.textMuted, fontSize: 14, paddingTop: spacing.md },
});

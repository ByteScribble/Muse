import { Tabs } from "expo-router";
import { ColorValue, Text } from "react-native";
import { colors } from "../../lib/theme";

function icon(glyph: string) {
  return ({ color }: { color: ColorValue }) => <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      {/* Search used to be its own tab; it now sits on Home beside the mic, so
          speaking and asking are never a navigation apart. */}
      <Tabs.Screen name="index" options={{ title: "Muse", tabBarIcon: icon("●") }} />
      <Tabs.Screen name="notes" options={{ title: "Notes", tabBarIcon: icon("☰") }} />
    </Tabs>
  );
}

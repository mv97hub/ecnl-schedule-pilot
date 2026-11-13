import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Tabs } from "expo-router";

import { colors } from "@/theme";

function tint(color: unknown): string {
  return typeof color === "string" ? color : colors.navy;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.secondary,
        tabBarStyle: { backgroundColor: colors.bone, borderTopColor: colors.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Home", tabBarIcon: ({ color }) => <FontAwesome name="home" color={tint(color)} size={22} /> }}
      />
      <Tabs.Screen
        name="schedules"
        options={{ title: "Schedules", tabBarIcon: ({ color }) => <FontAwesome name="calendar" color={tint(color)} size={20} /> }}
      />
      <Tabs.Screen
        name="tables"
        options={{ title: "Tables", tabBarIcon: ({ color }) => <FontAwesome name="list-ol" color={tint(color)} size={20} /> }}
      />
      <Tabs.Screen
        name="matchup"
        options={{ title: "Matchup", tabBarIcon: ({ color }) => <FontAwesome name="exchange" color={tint(color)} size={20} /> }}
      />
      <Tabs.Screen
        name="club"
        options={{ title: "Club", tabBarIcon: ({ color }) => <FontAwesome name="shield" color={tint(color)} size={20} /> }}
      />
    </Tabs>
  );
}

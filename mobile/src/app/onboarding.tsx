import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FavoritesEditor } from "@/components/FavoritesEditor";
import { GoldButton, OutlineButton } from "@/components/ui";
import { useFavorites } from "@/store/favorites";
import { APP_DESCRIPTION, colors } from "@/theme";

export default function Onboarding() {
  const [step, setStep] = useState<"club" | "teams">("club");
  const complete = useFavorites((state) => state.completeOnboarding);
  const router = useRouter();

  function finish() {
    complete();
    router.replace("/(tabs)");
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bone }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
        <Text style={{ color: colors.navy, fontSize: 34, fontWeight: "800" }}>Soccer Away Day</Text>
        <Text style={{ color: colors.secondary, fontSize: 16, lineHeight: 22 }}>{APP_DESCRIPTION}</Text>
        <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>
          {step === "club" ? "Pick a favorite club. This step is optional." : "Pick up to 4 teams. Slot 1 is the default."}
        </Text>
        <FavoritesEditor section={step} />
        {step === "club" ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <OutlineButton label="Skip" onPress={() => setStep("teams")} />
            </View>
            <View style={{ flex: 1 }}>
              <GoldButton label="Next" onPress={() => setStep("teams")} />
            </View>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <OutlineButton label="Back" onPress={() => setStep("club")} />
            <GoldButton label="Go to Home" onPress={finish} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

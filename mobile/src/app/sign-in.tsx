import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { TermsSignInNote } from "@/components/CommentNotice";
import { SignInButtons } from "@/components/SignInButtons";
import { OutlineButton } from "@/components/ui";
import { safeNext, type SignInFrom } from "@/lib/finishSignIn";
import { useFavorites } from "@/store/favorites";
import { colors } from "@/theme";

export default function SignInScreen() {
  const params = useLocalSearchParams<{ from?: string; next?: string }>();
  const from: SignInFrom = params.from === "field" || params.from === "profile" ? params.from : "gate";
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  const markSeen = useFavorites((state) => state.markSignInSeen);
  const onboarded = useFavorites((state) => state.hasCompletedOnboarding);
  const router = useRouter();

  function skip() {
    markSeen();
    if (onboarded) router.replace("/(tabs)");
    else router.replace("/onboarding");
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bone }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
        <Text style={{ color: colors.navy, fontSize: 34, fontWeight: "800" }}>Premier Gameday HQ</Text>
        <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>Sign in</Text>
        <SignInButtons from={from} next={next} />
        {from === "gate" ? <OutlineButton label="Skip" onPress={skip} /> : <OutlineButton label="Back" onPress={() => router.back()} />}
        <TermsSignInNote />
        <Text style={{ color: colors.secondary, fontSize: 16, lineHeight: 22 }}>
          You can use the app without an account. Sign in to rate a field, write a things-to-do comment, or vote.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

import { Text, View } from "react-native";

import { TermsAgreement } from "@/components/CommentNotice";
import { StandardGoogleButton } from "@/components/StandardGoogleButton";
import { useProviderSignIn } from "@/components/useProviderSignIn";
import type { SignInFrom } from "@/lib/finishSignIn";
import { colors } from "@/theme";

export function SignInButtons({ from, next }: { from: SignInFrom; next: string | null }) {
  const { busy, error, agreed, setAgreed, run } = useProviderSignIn(from, next);

  return (
    <View style={{ gap: 12, alignSelf: "stretch" }}>
      <TermsAgreement checked={agreed} onChange={setAgreed} />
      <StandardGoogleButton disabled={busy != null} onPress={() => void run("google")} />
      {error ? <Text style={{ color: colors.ink, lineHeight: 20, alignSelf: "stretch" }}>{error}</Text> : null}
    </View>
  );
}

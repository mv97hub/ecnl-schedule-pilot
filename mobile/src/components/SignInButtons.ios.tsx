import { AppleAuthenticationButton, AppleAuthenticationButtonStyle, AppleAuthenticationButtonType } from "expo-apple-authentication";
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
      <AppleAuthenticationButton
        buttonType={AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={8}
        style={{ width: "100%", height: 44 }}
        onPress={() => void run("apple")}
      />
      <StandardGoogleButton disabled={busy != null} onPress={() => void run("google")} />
      {error ? <Text style={{ color: colors.ink, lineHeight: 20 }}>{error}</Text> : null}
    </View>
  );
}

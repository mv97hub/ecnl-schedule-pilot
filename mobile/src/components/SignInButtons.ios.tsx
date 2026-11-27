import { GoogleSigninButton } from "@react-native-google-signin/google-signin";
import { AppleAuthenticationButton, AppleAuthenticationButtonStyle, AppleAuthenticationButtonType } from "expo-apple-authentication";
import { Text, View } from "react-native";

import { useProviderSignIn } from "@/components/useProviderSignIn";
import type { SignInFrom } from "@/lib/finishSignIn";
import { colors } from "@/theme";

export function SignInButtons({ from, next }: { from: SignInFrom; next: string | null }) {
  const { busy, error, run } = useProviderSignIn(from, next);

  return (
    <View style={{ gap: 12, alignSelf: "stretch" }}>
      <AppleAuthenticationButton
        buttonType={AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={8}
        style={{ width: "100%", height: 44 }}
        onPress={() => void run("apple")}
      />
      <GoogleSigninButton
        size={GoogleSigninButton.Size.Wide}
        color={GoogleSigninButton.Color.Light}
        disabled={busy != null}
        onPress={() => void run("google")}
        style={{ width: "100%", height: 48 }}
      />
      {error ? <Text style={{ color: colors.ink, lineHeight: 20 }}>{error}</Text> : null}
    </View>
  );
}

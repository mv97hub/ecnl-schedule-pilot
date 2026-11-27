import { useState } from "react";
import { Text, View } from "react-native";

import { Hit } from "@/components/ui";
import { ApiError, postProvider } from "@/lib/api";
import { finishSignIn, type SignInFrom } from "@/lib/finishSignIn";
import { signInWithApple, signInWithGoogle } from "@/lib/signInProviders";
import { colors } from "@/theme";
import type { ProviderSession } from "@/lib/types";

export function SignInButtons({ from, next }: { from: SignInFrom; next: string | null }) {
  const [busy, setBusy] = useState<"apple" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(provider: "apple" | "google") {
    setBusy(provider);
    setError(null);
    try {
      const identity = provider === "apple" ? await signInWithApple() : await signInWithGoogle();
      if (identity.cancelled || !identity.identityToken) return;
      const session: ProviderSession = await postProvider({
        provider: identity.provider,
        identityToken: identity.identityToken,
        nonce: identity.nonce,
        displayName: identity.displayName,
      });
      await finishSignIn(session, from, next);
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : "Sign-in failed.";
      setError(message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Hit
        label="Sign in with Apple"
        disabled={busy != null}
        onPress={() => void run("apple")}
        style={{ backgroundColor: colors.navy, borderRadius: 12, paddingHorizontal: 16, alignItems: "center" }}
      >
        <Text style={{ color: colors.white, fontWeight: "800", fontSize: 16 }}>
          {busy === "apple" ? "Signing in" : "Sign in with Apple"}
        </Text>
      </Hit>
      <Hit
        label="Continue with Google"
        disabled={busy != null}
        onPress={() => void run("google")}
        style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, paddingHorizontal: 16, alignItems: "center" }}
      >
        <Text style={{ color: colors.navy, fontWeight: "800", fontSize: 16 }}>
          {busy === "google" ? "Signing in" : "Continue with Google"}
        </Text>
      </Hit>
      {error ? <Text style={{ color: colors.ink, lineHeight: 20 }}>{error}</Text> : null}
    </View>
  );
}

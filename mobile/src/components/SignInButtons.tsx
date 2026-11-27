import { Image, Text, View } from "react-native";

import { StandardGoogleButton } from "@/components/StandardGoogleButton";
import { Hit } from "@/components/ui";
import { useProviderSignIn } from "@/components/useProviderSignIn";
import type { SignInFrom } from "@/lib/finishSignIn";
import { colors } from "@/theme";

const APPLE_MARK =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTE2LjM3IDEuNDNjMCAxLjE0LS41IDIuMjctMS4xOCAzLjA4LS43NC45LTEuOTkgMS41Ny0yLjk5IDEuNTctLjEyIDAtLjIzLS4wMi0uMy0uMDMtLjAxLS4wNi0uMDQtLjIyLS4wNC0uMzkgMC0xLjE1LjU3LTIuMjcgMS4yLTIuOTguODEtLjk0IDIuMTUtMS42NCAzLjI1LTEuNjguMDMuMTMuMDYuMjguMDYuNDN6TTIwLjk0IDE3LjE0Yy0uMDMuMDctLjQ3IDEuNTgtMS41MiAzLjEyLS45NSAxLjM4LTEuOTIgMi43NS0zLjQ2IDIuNzgtMS41MS4wMy0yIC45OC0zLjczLjk4cy0yLjI4LS45NS0zLjczLS45OGMtMS41Ny0uMDMtMi43Ni0xLjU3LTMuNzEtMi45NS0yLjAyLTIuOTItMy41Ni04LjI1LTEuNDktMTEuODYgMS4wMy0xLjc5IDIuODctMi45MiA0Ljg2LTIuOTUgMS41Mi0uMDMgMi45NSAxLjAyIDMuNzMgMS4wMi43OCAwIDIuMjQtMS4yNiAzLjc4LS45OC42NC4wMyAyLjQ0LjI2IDMuNTkgMS45Ni0uMDkuMDYtMi4xNSAxLjI1LTIuMTMgMy43NC4wMyAyLjk3IDIuNjEgMy45NiAyLjY0IDMuOTctLjAzLjA3LS40MSAxLjQyLTEuMjIgMi4xNXoiLz48L3N2Zz4=";

/**
 * Web stand-in for Apple's button. Both buttons stretch to the same width, with the label centered.
 * Apple stays 44pt black. Google stays the light 48pt sign-in button.
 */
export function SignInButtons({ from, next }: { from: SignInFrom; next: string | null }) {
  const { busy, error, run } = useProviderSignIn(from, next);
  const locked = busy != null;

  return (
    <View style={{ gap: 12, alignSelf: "stretch" }}>
      <Hit
        label="Sign in with Apple"
        disabled={locked}
        onPress={() => void run("apple")}
        style={{ alignSelf: "stretch", height: 44, borderRadius: 8, backgroundColor: "#000000", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}
      >
        <Image source={{ uri: APPLE_MARK }} style={{ width: 16, height: 18 }} />
        <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "600" }}>Sign in with Apple</Text>
      </Hit>
      <StandardGoogleButton disabled={locked} onPress={() => void run("google")} />
      {error ? <Text style={{ color: colors.ink, lineHeight: 20, alignSelf: "stretch" }}>{error}</Text> : null}
    </View>
  );
}

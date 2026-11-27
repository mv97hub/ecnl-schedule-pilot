import { Image, Text, View } from "react-native";

import { Hit } from "@/components/ui";
import { useProviderSignIn } from "@/components/useProviderSignIn";
import type { SignInFrom } from "@/lib/finishSignIn";
import { colors } from "@/theme";

const APPLE_MARK =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTE2LjM3IDEuNDNjMCAxLjE0LS41IDIuMjctMS4xOCAzLjA4LS43NC45LTEuOTkgMS41Ny0yLjk5IDEuNTctLjEyIDAtLjIzLS4wMi0uMy0uMDMtLjAxLS4wNi0uMDQtLjIyLS4wNC0uMzkgMC0xLjE1LjU3LTIuMjcgMS4yLTIuOTguODEtLjk0IDIuMTUtMS42NCAzLjI1LTEuNjguMDMuMTMuMDYuMjguMDYuNDN6TTIwLjk0IDE3LjE0Yy0uMDMuMDctLjQ3IDEuNTgtMS41MiAzLjEyLS45NSAxLjM4LTEuOTIgMi43NS0zLjQ2IDIuNzgtMS41MS4wMy0yIC45OC0zLjczLjk4cy0yLjI4LS45NS0zLjczLS45OGMtMS41Ny0uMDMtMi43Ni0xLjU3LTMuNzEtMi45NS0yLjAyLTIuOTItMy41Ni04LjI1LTEuNDktMTEuODYgMS4wMy0xLjc5IDIuODctMi45MiA0Ljg2LTIuOTUgMS41Mi0uMDMgMi45NSAxLjAyIDMuNzMgMS4wMi43OCAwIDIuMjQtMS4yNiAzLjc4LS45OC42NC4wMyAyLjQ0LjI2IDMuNTkgMS45Ni0uMDkuMDYtMi4xNSAxLjI1LTIuMTMgMy43NC4wMyAyLjk3IDIuNjEgMy45NiAyLjY0IDMuOTctLjAzLjA3LS40MSAxLjQyLTEuMjIgMi4xNXoiLz48L3N2Zz4=";

/** Official four-color G. The native Google button is not available off iOS. */
const GOOGLE_MARK =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCI+PHBhdGggZmlsbD0iI0VBNDMzNSIgZD0iTTI0IDkuNWMzLjU0IDAgNi43MSAxLjIyIDkuMjEgMy42bDYuODUtNi44NUMzNS45IDIuMzggMzAuNDcgMCAyNCAwIDE0LjYyIDAgNi41MSA1LjM4IDIuNTYgMTMuMjJsNy45OCA2LjE5QzEyLjQzIDEzLjcyIDE3Ljc0IDkuNSAyNCA5LjV6Ii8+PHBhdGggZmlsbD0iIzQyODVGNCIgZD0iTTQ2Ljk4IDI0LjU1YzAtMS41Ny0uMTUtMy4wOS0uMzgtNC41NUgyNHY5LjAyaDEyLjk0Yy0uNTggMi45Ni0yLjI2IDUuNDgtNC43OCA3LjE4bDcuNzMgNmM0LjUxLTQuMTggNy4wOS0xMC4zNiA3LjA5LTE3LjY1eiIvPjxwYXRoIGZpbGw9IiNGQkJDMDUiIGQ9Ik0xMC41MyAyOC41OWMtLjQ4LTEuNDUtLjc2LTIuOTktLjc2LTQuNTlzLjI3LTMuMTQuNzYtNC41OWwtNy45OC02LjE5Qy45MiAxNi40NiAwIDIwLjEyIDAgMjRjMCAzLjg4LjkyIDcuNTQgMi41NiAxMC43OGw3Ljk3LTYuMTl6Ii8+PHBhdGggZmlsbD0iIzM0QTg1MyIgZD0iTTI0IDQ4YzYuNDggMCAxMS45My0yLjEzIDE1Ljg5LTUuODFsLTcuNzMtNmMtMi4xNSAxLjQ1LTQuOTIgMi4zLTguMTYgMi4zLTYuMjYgMC0xMS41Ny00LjIyLTEzLjQ3LTkuOTFsLTcuOTggNi4xOUM2LjUxIDQyLjYyIDE0LjYyIDQ4IDI0IDQ4eiIvPjwvc3ZnPg==";

/**
 * Web stand-in for the iOS controls. AppleAuthenticationButton and GoogleSigninButton render nothing here.
 * Sizes follow the official buttons: Apple at 44pt black, Google wide at 312 by 48.
 */
export function SignInButtons({ from, next }: { from: SignInFrom; next: string | null }) {
  const { busy, error, run } = useProviderSignIn(from, next);
  const locked = busy != null;

  return (
    <View style={{ gap: 12, alignSelf: "stretch", alignItems: "center" }}>
      <Hit
        label="Sign in with Apple"
        disabled={locked}
        onPress={() => void run("apple")}
        style={{ alignSelf: "stretch", height: 44, borderRadius: 8, backgroundColor: "#000000", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}
      >
        <Image source={{ uri: APPLE_MARK }} style={{ width: 16, height: 18 }} />
        <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "600" }}>Sign in with Apple</Text>
      </Hit>
      <Hit
        label="Sign in with Google"
        disabled={locked}
        onPress={() => void run("google")}
        style={{ width: 312, height: 48, borderRadius: 4, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#747775", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10 }}
      >
        <Image source={{ uri: GOOGLE_MARK }} style={{ width: 18, height: 18 }} />
        <Text style={{ color: "#1F1F1F", fontSize: 16, fontWeight: "500" }}>Sign in with Google</Text>
      </Hit>
      {error ? <Text style={{ color: colors.ink, lineHeight: 20, alignSelf: "stretch" }}>{error}</Text> : null}
    </View>
  );
}

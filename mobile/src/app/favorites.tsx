import { useRouter, type Href } from "expo-router";
import { useEffect } from "react";
import { Alert, ScrollView, Text, View } from "react-native";

import { FavoritesEditor } from "@/components/FavoritesEditor";
import { ReportIssue } from "@/components/ReportIssue";
import { SignInButtons } from "@/components/SignInButtons";
import { GoldButton, Hit, LegalLinks, Loading, OutlineButton } from "@/components/ui";
import { deleteAccount, logoutSession } from "@/lib/api";
import { retryFavoriteSync } from "@/lib/accountFavorites";
import { useAccount } from "@/store/account";
import { colors } from "@/theme";

function providerLabel(providers: string[]): string {
  return providers.map((provider) => (provider === "apple" ? "Apple" : provider === "google" ? "Google" : provider)).join(", ");
}

export default function FavoritesScreen() {
  const router = useRouter();
  const ready = useAccount((state) => state.ready);
  const token = useAccount((state) => state.token);
  const user = useAccount((state) => state.user);
  const clearSession = useAccount((state) => state.clearSession);

  useEffect(() => {
    retryFavoriteSync();
  }, []);

  async function signOut() {
    if (token) {
      try {
        await logoutSession(token);
      } catch {
        // The phone session still ends. The website cookie, if any, is a different token.
      }
    }
    clearSession();
  }

  function confirmDelete() {
    Alert.alert("Delete account", "Delete this account, including its ratings, tips, votes, home address, and calendar links?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete account",
        style: "destructive",
        onPress: () => {
          void (async () => {
            if (!token) return;
            try {
              await deleteAccount(token);
              clearSession();
            } catch (error) {
              const message = error instanceof Error ? error.message : "Could not delete the account.";
              Alert.alert("Delete account", message);
            }
          })();
        },
      },
    ]);
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: colors.bone }} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
      {!ready ? <Loading label="Opening preferences" /> : null}
      {ready && user ? (
        <View style={{ backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 8 }}>
          <Text style={{ color: colors.navy, fontSize: 22, fontWeight: "800" }}>{user.display_name}</Text>
          <Text style={{ color: colors.ink }}>{user.email || "No email from the provider"}</Text>
          <Text style={{ color: colors.secondary }}>{providerLabel(user.providers) || "Signed in"}</Text>
          <GoldButton label="Sign out" onPress={() => void signOut()} />
          <OutlineButton label="Delete account" onPress={confirmDelete} />
        </View>
      ) : null}
      {ready && token && !user ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.ink, lineHeight: 20 }}>Could not load the account.</Text>
          <OutlineButton label="Sign out" onPress={() => void signOut()} />
        </View>
      ) : null}
      {ready && !token ? (
        <View style={{ gap: 8 }}>
          <SignInButtons from="profile" next={null} />
          <Text style={{ color: colors.secondary, lineHeight: 20 }}>Ratings and comments need an account.</Text>
        </View>
      ) : null}
      {ready && user ? (
        <View style={{ gap: 8 }}>
          <MenuRow label="Favorites" onPress={() => router.push("/profile-favorites" as Href)} />
          <MenuRow label="Home address" onPress={() => router.push("/home-address" as Href)} />
          <MenuRow label="Team calendar" onPress={() => router.push("/team-calendar" as Href)} />
        </View>
      ) : null}
      {ready && !user ? <FavoritesEditor onDone={() => router.back()} doneLabel="Done" /> : null}
      <View>
        <Text style={{ color: colors.secondary, fontSize: 12, lineHeight: 16 }}>
          Independent platform built for youth soccer families. Not affiliated with, endorsed by, or sponsored by the Elite Clubs National League (ECNL), Athlete One, Total Global Sports, or any member clubs.
        </Text>
        <LegalLinks />
      </View>
      <ReportIssue />
    </ScrollView>
  );
}

function MenuRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Hit label={label} onPress={onPress} style={{ backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16 }}>
      <Text style={{ color: colors.ink, fontWeight: "800", fontSize: 16 }}>{label}</Text>
    </Hit>
  );
}

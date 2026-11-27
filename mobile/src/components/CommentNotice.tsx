import { Text, View } from "react-native";

import { openSitePage } from "@/components/ui";
import { colors } from "@/theme";

export const COMMENT_CAPTION = "Write about the place or the fields. Leave out players, coaches, and referees.";

export const RATING_PLACEHOLDER = "About the fields, parking, and the visit. Not about a player, coach, or referee.";

export const TIP_PLACEHOLDER = "About this place. Not about a player, coach, or referee.";

const guidance = "#A8A29E";

export function CommentGuidance() {
  return <Text style={{ color: guidance, fontSize: 14, lineHeight: 20 }}>{COMMENT_CAPTION}</Text>;
}

export function TermsAgreement({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <Text
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={() => onChange(!checked)}
        style={{
          width: 22,
          height: 22,
          marginTop: 1,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: checked ? colors.navy : colors.white,
          color: colors.white,
          textAlign: "center",
          fontWeight: "800",
          lineHeight: 20,
        }}
      >
        {checked ? "✓" : ""}
      </Text>
      <Text style={{ color: colors.ink, flex: 1, fontSize: 15, lineHeight: 22 }}>
        I agree to the{" "}
        <Text onPress={() => openSitePage("/terms")} style={{ color: colors.navy, fontWeight: "700", textDecorationLine: "underline" }}>
          Terms of Use
        </Text>
        .
      </Text>
    </View>
  );
}

export function TermsSignInNote() {
  return (
    <Text style={{ color: colors.secondary, lineHeight: 20 }}>
      Posting a rating or a tip requires the{" "}
      <Text onPress={() => openSitePage("/terms")} style={{ color: colors.navy, fontWeight: "700", textDecorationLine: "underline" }}>
        Terms of Use
      </Text>
      .
    </Text>
  );
}

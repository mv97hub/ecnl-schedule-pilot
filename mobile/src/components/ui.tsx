import { useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, resultColor } from "@/theme";

export function Crest({ uri, name, size = 40 }: { uri?: string | null; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        accessibilityLabel=""
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.white }}
      />
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.line, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.ink, fontWeight: "700", fontSize: Math.max(12, size * 0.32) }}>{initials || "?"}</Text>
    </View>
  );
}

export function ResultBadge({ result, score }: { result: "W" | "D" | "L"; score?: string | null }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ minWidth: 28, minHeight: 28, borderRadius: 8, backgroundColor: resultColor(result), alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}>
        <Text style={{ color: colors.white, fontWeight: "800" }}>{result}</Text>
      </View>
      {score ? <Text style={{ color: colors.ink, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{score}</Text> : null}
    </View>
  );
}

export function Hit({
  label,
  onPress,
  children,
  style,
  disabled,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{ minHeight: 44, justifyContent: "center", opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}

export function GoldButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Hit label={label} onPress={onPress} disabled={disabled} style={{ backgroundColor: colors.gold, borderRadius: 12, paddingHorizontal: 16, alignItems: "center" }}>
      <Text style={{ color: colors.navy, fontWeight: "800", fontSize: 16 }}>{label}</Text>
    </Hit>
  );
}

export function OutlineButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Hit label={label} onPress={onPress} style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, paddingHorizontal: 14, alignItems: "center" }}>
      <Text style={{ color: colors.navy, fontWeight: "700" }}>{label}</Text>
    </Hit>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <View style={{ flexDirection: "row", backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 4, gap: 4 }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{ flex: 1, minHeight: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: selected ? colors.navy : "transparent" }}
          >
            <Text style={{ color: selected ? colors.white : colors.ink, fontWeight: "700" }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: selected ? colors.navy : colors.white, borderWidth: 1, borderColor: selected ? colors.navy : colors.line }}
    >
      <Text style={{ color: selected ? colors.white : colors.ink, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16 }, style]}>{children}</View>;
}

export function Loading({ label = "Loading the published schedule" }: { label?: string }) {
  return (
    <View style={{ padding: 32, alignItems: "center", gap: 12 }}>
      <ActivityIndicator color={colors.navy} />
      <Text style={{ color: colors.secondary }}>{label}</Text>
    </View>
  );
}

export function Notice({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <Card>
      <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "800" }}>{title}</Text>
      <Text style={{ color: colors.secondary, marginTop: 6, lineHeight: 20 }}>{body}</Text>
      {action && onAction ? (
        <View style={{ marginTop: 12 }}>
          <GoldButton label={action} onPress={onAction} />
        </View>
      ) : null}
    </Card>
  );
}

export function ProjectionBar({ points, expected }: { points: number; expected: number }) {
  const now = Math.max(points, 0);
  const rest = Math.max(expected - points, 0);
  const total = Math.max(now + rest, 0.01);
  return (
    <View style={{ height: 12, borderRadius: 6, overflow: "hidden", flexDirection: "row", backgroundColor: colors.line }}>
      <View style={{ flex: now / total, backgroundColor: colors.navy }} />
      <View style={{ flex: rest / total, backgroundColor: colors.gold }} />
    </View>
  );
}

export function EdgeMeter({ value }: { value: number }) {
  const clamped = Math.max(-100, Math.min(100, value));
  const marker = ((clamped + 100) / 200) * 100;
  return (
    <View accessibilityLabel={`Edge meter ${clamped}`}>
      <View style={{ height: 14, borderRadius: 7, backgroundColor: "rgba(255,255,255,0.25)", overflow: "hidden" }}>
        <View style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, backgroundColor: colors.white }} />
        <View style={{ position: "absolute", left: `${marker}%`, marginLeft: -7, top: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.gold }} />
      </View>
    </View>
  );
}

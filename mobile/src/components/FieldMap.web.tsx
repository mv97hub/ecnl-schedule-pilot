import { Text, View } from "react-native";

import { mapRegion, type MapPoint } from "@/components/fieldMap";
import { Hit } from "@/components/ui";
import { colors } from "@/theme";

const KIND_COLOR = {
  field: colors.navy,
  star: colors.gold,
  stay: colors.win,
  eat: colors.loss,
  do: colors.draw,
} as const;

/** Web stand-in. The device build uses the native map in FieldMap.tsx. */
export function FieldMap({
  points,
  focusId,
  onSelect,
  height,
}: {
  points: MapPoint[];
  focusId: string | null;
  onSelect: (id: string) => void;
  height: number;
}) {
  const region = mapRegion(points);
  return (
    <View style={{ height, borderRadius: 16, backgroundColor: "#D7E3D0", overflow: "hidden" }}>
      {region
        ? points.map((point) => {
            const left = ((point.longitude - (region.longitude - region.longitudeDelta / 2)) / region.longitudeDelta) * 100;
            const top = ((region.latitude + region.latitudeDelta / 2 - point.latitude) / region.latitudeDelta) * 100;
            const focused = point.id === focusId;
            return (
              <Hit
                key={point.id}
                label={point.label}
                onPress={() => onSelect(point.id)}
                style={{
                  position: "absolute",
                  left: `${Math.min(92, Math.max(4, left))}%`,
                  top: `${Math.min(88, Math.max(6, top))}%`,
                  minWidth: 44,
                  minHeight: 44,
                  marginLeft: -22,
                  marginTop: -22,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    minWidth: 28,
                    height: 28,
                    paddingHorizontal: 6,
                    borderRadius: 14,
                    backgroundColor: focused ? colors.gold : KIND_COLOR[point.kind],
                    borderWidth: 2,
                    borderColor: focused ? colors.navy : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: point.kind === "star" || focused ? colors.navy : colors.white, fontWeight: "800" }}>
                    {point.kind === "star" ? "★" : point.number ?? ""}
                  </Text>
                </View>
              </Hit>
            );
          })
        : null}
    </View>
  );
}

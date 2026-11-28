import { useMemo } from "react";
import { Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";

import { mapRegion, type MapPoint } from "@/components/fieldMap";
import { colors } from "@/theme";

const KIND_COLOR = {
  field: colors.navy,
  star: colors.gold,
  stay: colors.win,
  eat: colors.loss,
  do: colors.draw,
} as const;

/** Apple Maps on iOS. No Google maps key is stored in the app. */
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
  const region = useMemo(() => mapRegion(points), [points]);
  if (!region) {
    return <View style={{ height, borderRadius: 16, backgroundColor: colors.line }} />;
  }
  return (
    <MapView style={{ height, borderRadius: 16 }} region={region} rotateEnabled={false} pitchEnabled={false}>
      {points.map((point) => {
        const focused = point.id === focusId;
        const color = focused ? colors.gold : KIND_COLOR[point.kind];
        return (
          <Marker
            key={point.id}
            coordinate={{ latitude: point.latitude, longitude: point.longitude }}
            title={point.label}
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={() => onSelect(point.id)}
          >
            <View
              style={{
                minWidth: 28,
                height: 28,
                paddingHorizontal: 6,
                borderRadius: 14,
                backgroundColor: color,
                borderWidth: point.kind === "star" ? 2 : 0,
                borderColor: colors.navy,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: point.kind === "star" ? colors.navy : colors.white, fontWeight: "800" }}>
                {point.kind === "star" ? "★" : point.number ?? ""}
              </Text>
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
}

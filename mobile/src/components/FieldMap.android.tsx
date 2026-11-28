import { useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

import type { MapPoint } from "@/components/fieldMap";
import { OSM_TILE_HOST, allowMapRequest, mapSelection, osmMapHtml } from "@/components/osmMap";
import { colors } from "@/theme";

/** TypeScript 6 treats WebView's default type argument as never. */
type MapWebExtras = { readonly mapTiles?: undefined };

/**
 * OpenStreetMap tiles in a WebView. The shared FieldMap mounts Google Maps on
 * Android, and that widget crashes this build because no Maps key is shipped.
 */
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
  const webRef = useRef<WebView<MapWebExtras>>(null);
  const signature = points
    .map((point) => `${point.id}:${point.latitude}:${point.longitude}:${point.kind}:${point.number ?? ""}:${point.label}`)
    .join("|");
  const html = useMemo(() => osmMapHtml(points, focusId), [signature]);
  useEffect(() => {
    webRef.current?.injectJavaScript(`window.setFocus && window.setFocus(${JSON.stringify(focusId)}); true;`);
  }, [focusId]);
  if (points.length === 0) {
    return <View style={{ height, borderRadius: 16, backgroundColor: colors.line }} />;
  }
  return (
    <View style={{ height, borderRadius: 16, overflow: "hidden", backgroundColor: "#D7E3D0" }}>
      <WebView<MapWebExtras>
        ref={webRef}
        source={{ html, baseUrl: `https://${OSM_TILE_HOST}/` }}
        originWhitelist={["*"]}
        style={{ height, backgroundColor: "transparent" }}
        scrollEnabled={false}
        nestedScrollEnabled
        javaScriptEnabled
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(request) => allowMapRequest(request.url)}
        onMessage={(event) => {
          const id = mapSelection(event.nativeEvent.data);
          if (id) onSelect(id);
        }}
      />
    </View>
  );
}

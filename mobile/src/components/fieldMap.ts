export type MapPoint = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  number?: number;
  kind: "field" | "star" | "stay" | "eat" | "do";
};

export function mapRegion(points: MapPoint[]): {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
} | null {
  if (points.length === 0) return null;
  const lats = points.map((point) => point.latitude);
  const lngs = points.map((point) => point.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.08),
    longitudeDelta: Math.max((maxLng - minLng) * 1.6, 0.08),
  };
}

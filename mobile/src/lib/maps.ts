import { Linking, Platform, Share } from "react-native";

type Place = {
  name: string;
  city: string;
  state: string;
  latitude?: number | null;
  longitude?: number | null;
};

export function openMaps(place: Place): void {
  const query = encodeURIComponent(`${place.name}, ${place.city}, ${place.state}`);
  const lat = place.latitude;
  const lng = place.longitude;
  const hasPoint = lat != null && lng != null;
  const url = Platform.select({
    ios: hasPoint ? `http://maps.apple.com/?ll=${lat},${lng}&q=${query}` : `http://maps.apple.com/?q=${query}`,
    android: hasPoint ? `geo:${lat},${lng}?q=${lat},${lng}(${query})` : `geo:0,0?q=${query}`,
    default: `https://www.google.com/maps/search/?api=1&query=${query}`,
  });
  if (url) void Linking.openURL(url);
}

export async function shareText(message: string): Promise<void> {
  const nav = globalThis.navigator as { share?: (data: { text: string }) => Promise<void>; clipboard?: { writeText: (value: string) => Promise<void> } } | undefined;
  if (Platform.OS === "web" && nav?.share) {
    await nav.share({ text: message });
    return;
  }
  if (Platform.OS === "web" && nav?.clipboard) {
    await nav.clipboard.writeText(message);
    return;
  }
  await Share.share({ message });
}

import type { LocationCard, TipCategory } from "@/lib/types";

export const SCORE_ROWS = [
  ["field_quality", "Field quality"],
  ["referees", "Referees"],
  ["parent_vibe", "Parent and sideline vibe"],
  ["parking_access", "Parking and walkability"],
  ["amenities", "Amenities"],
] as const;

export type ScoreKey = (typeof SCORE_ROWS)[number][0];

/** Hotel and restaurant notes are optional once the place name is present. */
export function tipNoteOptional(category: TipCategory): boolean {
  return category === "HOTEL" || category === "RESTAURANT";
}

export const TIP_CATEGORIES: { id: TipCategory; label: string }[] = [
  { id: "HOTEL", label: "Hotel" },
  { id: "RESTAURANT", label: "Team Food and Dining" },
  { id: "COFFEE_GAP", label: "Between-Game Hangout" },
  { id: "ACTIVITY", label: "Activity" },
  { id: "SIDELINE_TIP", label: "Sideline and Parking Tip" },
];

export const TIP_TABS: { id: string; label: string; categories: TipCategory[] | null }[] = [
  { id: "all", label: "All Tips", categories: null },
  { id: "hotels", label: "Hotels", categories: ["HOTEL"] },
  { id: "food", label: "Team Food and Dining", categories: ["RESTAURANT"] },
  { id: "hangouts", label: "Between-Game Hangouts", categories: ["COFFEE_GAP", "ACTIVITY"] },
  { id: "sideline", label: "Sideline and Parking Tips", categories: ["SIDELINE_TIP"] },
];

export const TIP_TAGS = [
  "Good for Big Teams",
  "Quick Carbs",
  "Close to Fields",
  "Free Breakfast",
  "Paid Parking",
  "Bring Shade",
  "Good for Team Dinner",
  "Within 10 minutes of Fields",
  "Great Wi-Fi",
] as const;

const SURFACE_LABEL: Record<string, string> = { GRASS: "Grass", TURF: "Turf", MIXED: "Mixed" };

export function surfaceLabel(card: Pick<LocationCard, "dominant_surface" | "listed_surface">): string | null {
  const value = card.dominant_surface || card.listed_surface;
  if (!value) return null;
  return SURFACE_LABEL[value] ?? value;
}

export function categoryLabel(category: string): string {
  return TIP_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

export function scoreText(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

export function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

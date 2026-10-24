export type HomeAddress = {
  street: string;
  unit: string;
  city: string;
  state: string;
  postalCode: string;
  formatted: string;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
};

export const US_STATES: ReadonlyArray<readonly [string, string]> = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
];

const KEY = "ecnl-home-address";

export function formatHomeAddress(address: Pick<HomeAddress, "street" | "unit" | "city" | "state" | "postalCode">): string {
  const street = address.unit.trim() ? `${address.street.trim()}, ${address.unit.trim()}` : address.street.trim();
  return `${street}, ${address.city.trim()}, ${address.state} ${address.postalCode.trim()}`;
}

export function saveHomeAddress(input: Pick<HomeAddress, "street" | "unit" | "city" | "state" | "postalCode">): HomeAddress {
  const address: HomeAddress = {
    street: input.street.trim(),
    unit: input.unit.trim(),
    city: input.city.trim(),
    state: input.state,
    postalCode: input.postalCode.trim(),
    formatted: "",
    latitude: null,
    longitude: null,
    placeId: null,
  };
  address.formatted = formatHomeAddress(address);
  sessionStorage.setItem(KEY, JSON.stringify(address));
  return address;
}

export function readHomeAddress(): HomeAddress | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HomeAddress>;
    if (!parsed.street || !parsed.city || !parsed.state || !parsed.postalCode) return null;
    const address: HomeAddress = {
      street: parsed.street,
      unit: parsed.unit ?? "",
      city: parsed.city,
      state: parsed.state,
      postalCode: parsed.postalCode,
      formatted: parsed.formatted || formatHomeAddress({
        street: parsed.street,
        unit: parsed.unit ?? "",
        city: parsed.city,
        state: parsed.state,
        postalCode: parsed.postalCode,
      }),
      latitude: typeof parsed.latitude === "number" ? parsed.latitude : null,
      longitude: typeof parsed.longitude === "number" ? parsed.longitude : null,
      placeId: typeof parsed.placeId === "string" ? parsed.placeId : null,
    };
    return address;
  } catch {
    return null;
  }
}

export function clearHomeAddress() {
  sessionStorage.removeItem(KEY);
}

export function PlaceCredit() {
  return (
    <p className="mt-1 text-[10px] leading-4 text-stone-400">
      <a href="https://www.openstreetmap.org/copyright" className="underline underline-offset-2 hover:text-stone-600">
        © OpenStreetMap contributors
      </a>
      <span> · </span>
      <a href="https://www.geoapify.com/" className="underline underline-offset-2 hover:text-stone-600">
        Powered by Geoapify
      </a>
    </p>
  );
}

export function tipDisplayName(tip: { title: string; matched_name?: string | null }): string {
  const matched = tip.matched_name?.trim();
  return matched || tip.title;
}

export function PlaceAddress({
  tip,
}: {
  tip: { formatted_address?: string | null; place_provider?: string | null };
}) {
  if (!tip.formatted_address && tip.place_provider !== "geoapify") return null;
  return (
    <>
      {tip.formatted_address ? <p className="mt-1 text-sm text-stone-600">{tip.formatted_address}</p> : null}
      {tip.place_provider === "geoapify" ? <PlaceCredit /> : null}
    </>
  );
}

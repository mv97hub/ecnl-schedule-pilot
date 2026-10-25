import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { HeadToHeadBoard } from "@/components/HeadToHeadBoard";
import { fetchHeadToHead } from "@/lib/api";
import { matchupDescription, matchupSearch } from "@/lib/formatShareText";

type HeadToHeadQuery = {
  teamA?: string;
  teamB?: string;
  conferenceOnly?: string;
  conference_only?: string;
  gender?: string;
};

function teamId(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function conferenceOnly(query: HeadToHeadQuery): boolean {
  return query.conferenceOnly === "1" || query.conference_only === "true";
}

function shareGender(query: HeadToHeadQuery): "boys" | "girls" {
  return query.gender === "girls" ? "girls" : "boys";
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<HeadToHeadQuery> }): Promise<Metadata> {
  const query = await searchParams;
  const teamA = teamId(query.teamA);
  const teamB = teamId(query.teamB);
  if (teamA == null || teamB == null || teamA === teamB) {
    return { title: "Head-to-Head | ECNL" };
  }
  try {
    const data = await fetchHeadToHead(teamA, teamB, conferenceOnly(query));
    const image = `/api/og/h2h?${matchupSearch(teamA, teamB, conferenceOnly(query), shareGender(query))}`;
    const title = `${data.team_a_stats.name} vs ${data.team_b_stats.name} | ECNL H2H Scouting`;
    const description = matchupDescription(data);
    return {
      title,
      description,
      openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
      twitter: { card: "summary_large_image", title, description, images: [image] },
    };
  } catch {
    return { title: "Head-to-Head | ECNL" };
  }
}

async function DynamicMarker() {
  await connection();
  return null;
}

export default function HeadToHeadPage() {
  return (
    <>
      <Suspense fallback={null}>
        <DynamicMarker />
      </Suspense>
      <Suspense fallback={null}>
        <HeadToHeadBoard />
      </Suspense>
    </>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter, type Href } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { CommentGuidance, RATING_PLACEHOLDER, TIP_PLACEHOLDER, TermsAgreement } from "@/components/CommentNotice";
import { Card, Chip, GoldButton, Hit, Loading, Notice, OutlineButton } from "@/components/ui";
import { ApiError, acceptTerms, fetchAuthMe, fetchLocationDetail, flagRecommendation, postRating, postRecommendation, postVote } from "@/lib/api";
import { formatKickoff } from "@/lib/format";
import { placePath, signInPath } from "@/lib/finishSignIn";
import { openMaps } from "@/lib/maps";
import { SCORE_ROWS, TIP_CATEGORIES, TIP_TABS, TIP_TAGS, categoryLabel, countLabel, scoreText, surfaceLabel, tipNoteOptional, type ScoreKey } from "@/lib/placeCopy";
import { useAccount } from "@/store/account";
import { colors } from "@/theme";
import type { LocationDetail, LocationGame, LocationTip, SurfaceVote, TipCategory } from "@/lib/types";

const EMPTY: Record<ScoreKey, number> = {
  field_quality: 0,
  referees: 0,
  parent_vibe: 0,
  parking_access: 0,
  amenities: 0,
};

export function PlaceDetail({
  venueKey,
  venueName,
  city,
  state,
}: {
  venueKey?: string;
  venueName?: string;
  city?: string;
  state?: string;
}) {
  const token = useAccount((state) => state.token);
  const signedIn = Boolean(token);
  const sessionToken = token && token !== "preview" ? token : null;
  const router = useRouter();
  const client = useQueryClient();
  const queryKey = ["locations", "detail", venueKey ?? "", venueName ?? "", city ?? "", state ?? "", signedIn] as const;
  const detail = useQuery({
    queryKey,
    queryFn: () => fetchLocationDetail({ venueKey, venueName, city, state }, sessionToken),
    enabled: Boolean(venueKey || (venueName && city && state)),
  });
  const [scores, setScores] = useState<Record<ScoreKey, number>>(EMPTY);
  const [surface, setSurface] = useState<SurfaceVote | "">("");
  const [note, setNote] = useState("");
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [ratingMessage, setRatingMessage] = useState<string | null>(null);
  const [savingRating, setSavingRating] = useState(false);
  const [category, setCategory] = useState<TipCategory>("HOTEL");
  const [title, setTitle] = useState("");
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [review, setReview] = useState("");
  const [tipError, setTipError] = useState<string | null>(null);
  const [savingTip, setSavingTip] = useState(false);
  const [tab, setTab] = useState("all");
  const [agreed, setAgreed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!sessionToken) {
      setTermsAccepted(token === "preview" ? false : null);
      return;
    }
    let active = true;
    setTermsAccepted(null);
    fetchAuthMe(sessionToken)
      .then((me) => {
        if (active) setTermsAccepted(me.terms_accepted === true);
      })
      .catch(() => {
        if (active) setTermsAccepted(false);
      });
    return () => {
      active = false;
    };
  }, [sessionToken, token]);

  const termsReady = !signedIn || termsAccepted !== null;
  const needsTerms = signedIn && termsAccepted === false;

  useEffect(() => {
    const mine = detail.data?.my_rating;
    if (!detail.data) return;
    setScores(
      mine
        ? {
            field_quality: mine.field_quality,
            referees: mine.referees,
            parent_vibe: mine.parent_vibe,
            parking_access: mine.parking_access,
            amenities: mine.amenities,
          }
        : EMPTY,
    );
    setSurface(mine?.surface_vote ?? "");
    setNote(mine?.comment ?? "");
    setTitle((current) => current || detail.data.venue_name);
  }, [detail.data]);

  const visibleTips = useMemo(() => {
    const tips = detail.data?.recommendations ?? [];
    const chosen = TIP_TABS.find((item) => item.id === tab);
    if (!chosen?.categories) return tips;
    const allowed = new Set(chosen.categories);
    return tips.filter((tip) => allowed.has(tip.category));
  }, [detail.data, tab]);

  function askSignIn(place: LocationDetail) {
    const next = placePath({ venueKey: place.venue_key, venueName: place.venue_name, city: place.city, state: place.state });
    router.push(signInPath(next) as Href);
  }

  async function saveRating(place: LocationDetail) {
    if (!token) return askSignIn(place);
    if (SCORE_ROWS.some(([key]) => scores[key] < 1)) {
      setRatingError("Choose 1 to 5 for each part of the complex.");
      return;
    }
    if (needsTerms && !agreed) {
      setRatingError("Agree to the Terms of Use.");
      return;
    }
    setSavingRating(true);
    setRatingError(null);
    setRatingMessage(null);
    try {
      if (needsTerms) {
        await acceptTerms(token);
        setTermsAccepted(true);
      }
      await postRating(token, {
        venue_name: place.venue_name,
        city: place.city,
        state: place.state,
        ...scores,
        surface_vote: surface || null,
        comment: note.trim() || null,
      });
      setRatingMessage("Rating saved.");
      await detail.refetch();
    } catch (error) {
      setRatingError(error instanceof ApiError ? error.message : "Could not save that rating.");
    } finally {
      setSavingRating(false);
    }
  }

  async function saveTip(place: LocationDetail) {
    if (!token) return askSignIn(place);
    const placeName = title.trim();
    const noteText = review.trim();
    const noteOptional = tipNoteOptional(category) && placeName.length > 0;
    if (!placeName || stars < 1 || (!noteOptional && !noteText)) {
      setTipError(tipNoteOptional(category) ? "Add a place name and stars." : "Add a place name, stars, and a note.");
      return;
    }
    if (needsTerms && !agreed) {
      setTipError("Agree to the Terms of Use.");
      return;
    }
    setSavingTip(true);
    setTipError(null);
    try {
      if (needsTerms) {
        await acceptTerms(token);
        setTermsAccepted(true);
      }
      await postRecommendation(token, {
        venue_name: place.venue_name,
        city: place.city,
        state: place.state,
        category,
        title: title.trim(),
        rating: stars,
        review_text: noteText,
        tags,
      });
      setTitle("");
      setStars(0);
      setTags([]);
      setReview("");
      await detail.refetch();
    } catch (error) {
      setTipError(error instanceof ApiError ? error.message : "Could not add that comment.");
    } finally {
      setSavingTip(false);
    }
  }

  function dropTip(id: number) {
    client.setQueryData<LocationDetail>(queryKey, (current) => {
      if (!current) return current;
      return { ...current, recommendations: current.recommendations.filter((item) => item.id !== id) };
    });
  }

  async function vote(place: LocationDetail, tip: LocationTip, choice: "up" | "down") {
    if (!token) return askSignIn(place);
    setTipError(null);
    try {
      const updated = await postVote(token, tip.id, choice);
      client.setQueryData<LocationDetail>(queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          recommendations: current.recommendations.map((item) => (item.id === tip.id ? { ...item, ...updated } : item)),
        };
      });
    } catch (error) {
      setTipError(error instanceof ApiError ? error.message : "Could not save that vote.");
    }
  }

  if (!venueKey && !(venueName && city && state)) {
    return <Notice title="Field unavailable" body="That field link is missing a venue." />;
  }
  if (detail.isPending) return <Loading label="Loading this field" />;
  if (detail.isError || !detail.data) {
    return <Notice title="Field unavailable" body="That complex was not found." action="Try again" onAction={() => void detail.refetch()} />;
  }

  const place = detail.data;
  const surfaceText = surfaceLabel(place);

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.navy, fontSize: 28, fontWeight: "800" }}>{place.venue_name}</Text>
        <Text style={{ color: colors.secondary }}>
          {place.city}, {place.state}
          {surfaceText ? ` · ${surfaceText}` : ""}
          {` · ${countLabel(place.ratings_count, "rating", "ratings")}`}
        </Text>
      </View>
      <OutlineButton
        label="Directions"
        onPress={() => openMaps({ name: place.venue_name, city: place.city, state: place.state })}
      />

      <Card>
        <Text style={{ color: colors.navy, fontSize: 18, fontWeight: "800" }}>Scorecard</Text>
        <Text style={{ color: colors.secondary, marginTop: 4 }}>
          {place.overall == null ? "No family ratings yet" : `${scoreText(place.overall)} overall`}
          {` · ${countLabel(place.recommendations.length, "thing to do", "things to do")}`}
        </Text>
        <View style={{ gap: 10, marginTop: 12 }}>
          {SCORE_ROWS.map(([key, label]) => (
            <ScoreMeter key={key} label={label} value={place[key]} />
          ))}
        </View>
      </Card>

      {!signedIn ? (
        <Card>
          <Text style={{ color: colors.ink, lineHeight: 22 }}>Sign in to rate this field, write a comment, or vote.</Text>
          <View style={{ marginTop: 12 }}>
            <GoldButton label="Sign in" onPress={() => askSignIn(place)} />
          </View>
        </Card>
      ) : null}

      {signedIn ? (
      <Card>
        <Text style={{ color: colors.navy, fontSize: 18, fontWeight: "800" }}>Rate this complex</Text>
        <Text style={{ color: colors.secondary, marginTop: 4 }}>One rating for this account. Saving again updates it.</Text>
          <View style={{ gap: 12, marginTop: 12 }}>
            {SCORE_ROWS.map(([key, label]) => (
              <ScorePicker key={key} label={label} value={scores[key]} onChange={(value) => setScores((current) => ({ ...current, [key]: value }))} />
            ))}
            <Text style={{ color: colors.secondary, fontWeight: "700" }}>Surface</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(["GRASS", "TURF", "MIXED"] as const).map((item) => (
                <Chip key={item} label={item === "GRASS" ? "Grass" : item === "TURF" ? "Turf" : "Mixed"} selected={surface === item} onPress={() => setSurface(surface === item ? "" : item)} />
              ))}
            </View>
            <Text style={{ color: colors.secondary, fontWeight: "700" }}>
              Note{place.my_rating?.edited ? " · Edited" : ""}
            </Text>
            <CommentGuidance />
            <TextInput
              value={note}
              onChangeText={setNote}
              multiline
              placeholder={RATING_PLACEHOLDER}
              placeholderTextColor="#A8A29E"
              style={inputStyle}
            />
            {needsTerms ? <TermsAgreement checked={agreed} onChange={setAgreed} /> : null}
            {ratingError ? <Text style={{ color: colors.ink }}>{ratingError}</Text> : null}
            {ratingMessage ? <Text style={{ color: colors.navy, fontWeight: "700" }}>{ratingMessage}</Text> : null}
            <GoldButton label={savingRating ? "Saving" : "Save rating"} disabled={savingRating || !termsReady || (needsTerms && !agreed)} onPress={() => void saveRating(place)} />
          </View>
      </Card>
      ) : null}

      <View style={{ gap: 10 }}>
        <Text style={{ color: colors.navy, fontSize: 22, fontWeight: "800" }}>Things to do</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {TIP_TABS.map((item) => (
            <Chip key={item.id} label={item.label} selected={tab === item.id} onPress={() => setTab(item.id)} />
          ))}
        </ScrollView>
        {visibleTips.length === 0 ? <Text style={{ color: colors.secondary }}>No things to do in this tab yet.</Text> : null}
        {visibleTips.map((tip) => (
          <TipCard
            key={tip.id}
            tip={tip}
            signedIn={signedIn}
            token={sessionToken}
            onVote={(choice) => void vote(place, tip, choice)}
            onHidden={() => dropTip(tip.id)}
          />
        ))}
        {tipError ? <Text style={{ color: colors.ink }}>{tipError}</Text> : null}
        {signedIn ? (
        <Card>
          <Text style={{ color: colors.navy, fontSize: 18, fontWeight: "800" }}>Add a things-to-do comment</Text>
            <View style={{ gap: 12, marginTop: 12 }}>
              <Text style={{ color: colors.secondary, fontWeight: "700" }}>Category</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {TIP_CATEGORIES.map((item) => (
                  <Chip key={item.id} label={item.label} selected={category === item.id} onPress={() => setCategory(item.id)} />
                ))}
              </View>
              <TextInput value={title} onChangeText={setTitle} placeholder="Place name" placeholderTextColor={colors.secondary} style={inputStyle} />
              <ScorePicker label="Stars" value={stars} onChange={setStars} />
              <Text style={{ color: colors.secondary, fontWeight: "700" }}>Tags</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {TIP_TAGS.map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    selected={tags.includes(tag)}
                    onPress={() => setTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]))}
                  />
                ))}
              </View>
              <CommentGuidance />
              {tipNoteOptional(category) ? (
                <Text style={{ color: colors.secondary }}>A note is optional once the place name is filled in.</Text>
              ) : null}
              <TextInput value={review} onChangeText={setReview} multiline placeholder={TIP_PLACEHOLDER} placeholderTextColor="#A8A29E" style={inputStyle} />
              {needsTerms ? <TermsAgreement checked={agreed} onChange={setAgreed} /> : null}
              <GoldButton label={savingTip ? "Saving" : "Add comment"} disabled={savingTip || !termsReady || (needsTerms && !agreed)} onPress={() => void saveTip(place)} />
            </View>
        </Card>
        ) : null}
      </View>

      <GameList title="Upcoming games" games={place.upcoming} />
      <GameList title="Recent games" games={place.recent} />
    </View>
  );
}

function ScoreMeter({ label, value }: { label: string; value: number | null }) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: colors.ink }}>{label}</Text>
        <Text style={{ color: colors.navy, fontWeight: "700" }}>{scoreText(value)}</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.line, marginTop: 4 }}>
        <View style={{ width: `${width}%`, height: 8, borderRadius: 4, backgroundColor: colors.gold }} />
      </View>
    </View>
  );
}

function ScorePicker({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.secondary, fontWeight: "700" }}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[1, 2, 3, 4, 5].map((score) => (
          <Hit key={score} label={`${label} ${score} of 5`} onPress={() => onChange(score)} style={{ width: 36, borderRadius: 18, backgroundColor: value === score ? colors.gold : colors.white, borderWidth: 1, borderColor: value === score ? colors.gold : colors.line, alignItems: "center" }}>
            <Text style={{ color: colors.navy, fontWeight: "800" }}>{score}</Text>
          </Hit>
        ))}
      </View>
    </View>
  );
}

function TipCard({
  tip,
  signedIn,
  token,
  onVote,
  onHidden,
}: {
  tip: LocationTip;
  signedIn: boolean;
  token: string | null;
  onVote: (choice: "up" | "down") => void;
  onHidden: () => void;
}) {
  const posted = formatKickoff(tip.created_at).day;
  const [reporting, setReporting] = useState(false);
  const [reportNote, setReportNote] = useState<string | null>(null);

  async function report() {
    if (!token) return;
    setReporting(true);
    setReportNote(null);
    try {
      const result = await flagRecommendation(token, tip.id);
      if (result.already_reported) {
        setReportNote("You already reported this tip.");
        return;
      }
      if (result.hidden) {
        onHidden();
        return;
      }
      setReportNote("Reported.");
    } catch (error) {
      setReportNote(error instanceof ApiError ? error.message : "Could not report that tip.");
    } finally {
      setReporting(false);
    }
  }

  return (
    <Card>
      <Text style={{ color: colors.secondary, fontWeight: "700" }}>{categoryLabel(tip.category)}</Text>
      <Text style={{ color: colors.navy, fontSize: 18, fontWeight: "800", marginTop: 4 }}>{tip.title}</Text>
      <Text style={{ color: colors.ink, marginTop: 4 }}>{tip.rating} of 5</Text>
      {tip.tags.length > 0 ? <Text style={{ color: colors.secondary, marginTop: 6 }}>{tip.tags.join(" · ")}</Text> : null}
      {tip.review_text.trim() || tip.edited ? (
        <Text style={{ color: colors.ink, marginTop: 8, lineHeight: 20 }}>
          {tip.review_text.trim()}
          {tip.edited ? `${tip.review_text.trim() ? " · " : ""}Edited` : ""}
        </Text>
      ) : null}
      <Text style={{ color: colors.secondary, marginTop: 8 }}>
        {tip.author_name} · {posted}
      </Text>
      {signedIn ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            <OutlineButton label={`Up ${tip.upvotes}`} onPress={() => onVote("up")} />
          </View>
          <View style={{ flex: 1 }}>
            <OutlineButton label={`Down ${tip.downvotes}`} onPress={() => onVote("down")} />
          </View>
        </View>
      ) : (
        <Text style={{ color: colors.secondary, marginTop: 8 }}>Up {tip.upvotes} · Down {tip.downvotes}</Text>
      )}
      {signedIn ? (
        <View style={{ marginTop: 8 }}>
          <Hit label="Report" disabled={reporting || !token} onPress={() => void report()}>
            <Text style={{ color: colors.navy, fontWeight: "700", opacity: reporting ? 0.6 : 1 }}>Report</Text>
          </Hit>
          {reportNote ? <Text style={{ color: colors.secondary, marginTop: 4 }}>{reportNote}</Text> : null}
        </View>
      ) : null}
    </Card>
  );
}

function GameList({ title, games }: { title: string; games: LocationGame[] }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: open ? 8 : 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        accessibilityLabel={title}
        onPress={() => setOpen((current) => !current)}
        style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
      >
        <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "800" }}>{title}</Text>
        <FontAwesome name={open ? "chevron-down" : "chevron-right"} size={14} color={colors.navy} />
      </Pressable>
      {open && games.length === 0 ? <Text style={{ color: colors.secondary }}>None on the schedule.</Text> : null}
      {open ? games.map((game) => {
        const scored = game.home_score != null && game.away_score != null;
        const when = formatKickoff(game.starts_at);
        return (
          <Card key={game.id}>
            <Text style={{ color: colors.ink, fontWeight: "800" }}>{game.home_team} vs {game.away_team}</Text>
            <Text style={{ color: colors.secondary, marginTop: 4 }}>
              {when.day} · {when.clock}
              {game.field_name ? ` · ${game.field_name}` : ""}
              {scored ? ` · ${game.home_score}–${game.away_score}` : ""}
            </Text>
          </Card>
        );
      }) : null}
    </View>
  );
}

const inputStyle = {
  minHeight: 44,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: colors.line,
  backgroundColor: colors.white,
  paddingHorizontal: 12,
  paddingVertical: 8,
  color: colors.ink,
  fontSize: 16,
} as const;

"""Head-to-head and common-opponent comparison for two published clubs."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.ingestion.normalizer import looks_like_showcase, split_venue
from app.models import ConferenceStanding, ScheduleGame, ScheduleTeam
from app.schemas import (
    CommonGameOut,
    CommonOpponentOut,
    CommonRollupOut,
    CountRecord,
    DirectMatchOut,
    DirectMeetingsOut,
    DirectSummaryOut,
    FormGameOut,
    HeadToHeadOut,
    OpponentMiniOut,
    RollupOut,
    SplitRecord,
    TeamTapeOut,
)
from app.standings import _canonical_name, _ppg, conference_rank, short_conference
from scouting import build_scouting_report

EASTERN = ZoneInfo("America/New_York")


def _zone(game: ScheduleGame) -> ZoneInfo:
    try:
        return ZoneInfo(game.timezone or "America/New_York")
    except Exception:
        return EASTERN


def _local(game: ScheduleGame) -> datetime:
    starts = game.starts_at
    if starts.tzinfo is None:
        starts = starts.replace(tzinfo=EASTERN)
    return starts.astimezone(_zone(game))


def _completed(game: ScheduleGame) -> bool:
    return game.status == "COMPLETED" and game.home_score is not None and game.away_score is not None


def _avg(total: int, games: int) -> float:
    if games <= 0:
        return 0.0
    return float((Decimal(total) / Decimal(games)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _mark(goals_for: int, goals_against: int) -> str:
    if goals_for > goals_against:
        return "W"
    if goals_for < goals_against:
        return "L"
    return "D"


def _perspective(game: ScheduleGame, team_id: int) -> tuple[bool, int | None, int | None]:
    home = game.home_team_id == team_id
    goals_for = game.home_score if home else game.away_score
    goals_against = game.away_score if home else game.home_score
    return home, goals_for, goals_against


def _long_venue(game: ScheduleGame, team_id: int) -> str:
    home, _, _ = _perspective(game, team_id)
    showcase = (not game.is_conference_game) or looks_like_showcase(game.event or "")
    if showcase:
        return "Showcase"
    return "Home" if home else "Away"


def _short_venue(game: ScheduleGame, team_id: int) -> str:
    long = _long_venue(game, team_id)
    return {"Home": "H", "Away": "A", "Showcase": "N"}[long]


def _opponent(game: ScheduleGame, team_id: int) -> ScheduleTeam:
    return game.away_team if game.home_team_id == team_id else game.home_team


def _games_for(session: Session, team_id: int, conference_only: bool) -> list[ScheduleGame]:
    statement = (
        select(ScheduleGame)
        .options(selectinload(ScheduleGame.home_team), selectinload(ScheduleGame.away_team))
        .where(or_(ScheduleGame.home_team_id == team_id, ScheduleGame.away_team_id == team_id))
        .order_by(ScheduleGame.starts_at, ScheduleGame.id)
    )
    if conference_only:
        statement = statement.where(ScheduleGame.is_conference_game.is_(True))
    return list(session.scalars(statement).all())


def _official_ppg(session: Session, team: ScheduleTeam) -> float | None:
    short = short_conference(team.conference).casefold()
    rows = session.scalars(
        select(ConferenceStanding).where(
            func.lower(ConferenceStanding.conference) == short,
            ConferenceStanding.tier == team.tier,
            ConferenceStanding.age_group == team.age_group,
        )
    ).all()
    for row in rows:
        if row.team_id == team.id or _canonical_name(row.team_name) == _canonical_name(team.name):
            return float(row.points_per_game)
    return None


class _Tally:
    def __init__(self) -> None:
        self.w = 0
        self.l = 0
        self.d = 0
        self.gf = 0
        self.ga = 0

    def add(self, goals_for: int, goals_against: int) -> None:
        mark = _mark(goals_for, goals_against)
        if mark == "W":
            self.w += 1
        elif mark == "L":
            self.l += 1
        else:
            self.d += 1
        self.gf += goals_for
        self.ga += goals_against

    @property
    def gp(self) -> int:
        return self.w + self.l + self.d

    @property
    def pts(self) -> int:
        return self.w * 3 + self.d

    @property
    def gd(self) -> int:
        return self.gf - self.ga

    @property
    def ppg(self) -> float:
        return _ppg(self.pts, self.gp)

    def overall(self) -> CountRecord:
        return CountRecord(
            gp=self.gp,
            w=self.w,
            l=self.l,
            d=self.d,
            gf=self.gf,
            ga=self.ga,
            gd=self.gd,
            pts=self.pts,
            ppg=_ppg(self.pts, self.gp),
        )

    def split(self) -> SplitRecord:
        return SplitRecord(gp=self.gp, w=self.w, l=self.l, d=self.d, ppg=_ppg(self.pts, self.gp))

    def mini(self) -> OpponentMiniOut:
        return OpponentMiniOut(gp=self.gp, pts=self.pts, ppg=_ppg(self.pts, self.gp), gf=self.gf, ga=self.ga, gd=self.gd)

    def rollup(self) -> RollupOut:
        return RollupOut(
            gp=self.gp,
            w=self.w,
            l=self.l,
            d=self.d,
            gf=self.gf,
            ga=self.ga,
            gd=self.gd,
            ppg=_ppg(self.pts, self.gp),
        )


def _tape(session: Session, team: ScheduleTeam, games: list[ScheduleGame]) -> TeamTapeOut:
    overall = _Tally()
    home = _Tally()
    away = _Tally()
    completed = [game for game in games if _completed(game)]
    for game in completed:
        is_home, goals_for, goals_against = _perspective(game, team.id)
        if goals_for is None or goals_against is None:
            continue
        overall.add(goals_for, goals_against)
        (home if is_home else away).add(goals_for, goals_against)
    recent = completed[-5:]
    form: list[FormGameOut] = []
    for game in recent:
        _, goals_for, goals_against = _perspective(game, team.id)
        if goals_for is None or goals_against is None:
            continue
        local = _local(game)
        form.append(
            FormGameOut(
                game_id=game.id,
                date=local.date().isoformat(),
                opponent_name=_opponent(game, team.id).name,
                result=_mark(goals_for, goals_against),
                score=f"{goals_for}-{goals_against}",
                venue_type=_long_venue(game, team.id),
            )
        )
    return TeamTapeOut(
        team_id=team.id,
        name=team.name,
        age_group=team.age_group,
        tier=team.tier,
        conference=short_conference(team.conference),
        conference_rank=conference_rank(session, team),
        official_ppg=_official_ppg(session, team),
        overall_record=overall.overall(),
        home_record=home.split(),
        away_record=away.split(),
        avg_gf=_avg(overall.gf, overall.gp),
        avg_ga=_avg(overall.ga, overall.gp),
        last_5_form=form,
    )


def _direct(team_a: ScheduleTeam, team_b: ScheduleTeam, games: list[ScheduleGame]) -> DirectMeetingsOut:
    summary = DirectSummaryOut(team_a_wins=0, team_b_wins=0, draws=0, team_a_goals=0, team_b_goals=0)
    rows: list[DirectMatchOut] = []
    for game in games:
        local = _local(game)
        complex_name, field_number = split_venue(game.venue_name)
        _, goals_for, goals_against = _perspective(game, team_a.id)
        team_a_result = None
        team_b_result = None
        winner = None
        if _completed(game) and goals_for is not None and goals_against is not None:
            team_a_result = _mark(goals_for, goals_against)
            team_b_result = _mark(goals_against, goals_for)
            summary.team_a_goals += goals_for
            summary.team_b_goals += goals_against
            if team_a_result == "W":
                summary.team_a_wins += 1
                winner = "team_a"
            elif team_a_result == "L":
                summary.team_b_wins += 1
                winner = "team_b"
            else:
                summary.draws += 1
                winner = "draw"
        rows.append(
            DirectMatchOut(
                game_id=game.id,
                date=local.date().isoformat(),
                kickoff_time=local.strftime("%H:%M"),
                complex_name=complex_name,
                field_number=field_number or None,
                city=game.city,
                state=game.state,
                status=game.status if game.status in {"SCHEDULED", "COMPLETED", "POSTPONED", "CANCELLED"} else "SCHEDULED",
                home_team_id=game.home_team_id,
                away_team_id=game.away_team_id,
                home_score=game.home_score,
                away_score=game.away_score,
                venue_type=_long_venue(game, team_a.id),
                team_a_result=team_a_result,
                team_b_result=team_b_result,
                winner=winner,
            )
        )
    return DirectMeetingsOut(summary=summary, games=rows)


def _common_game(game: ScheduleGame, team_id: int) -> CommonGameOut:
    local = _local(game)
    _, goals_for, goals_against = _perspective(game, team_id)
    result = None
    team_score = None
    opponent_score = None
    if _completed(game) and goals_for is not None and goals_against is not None:
        result = _mark(goals_for, goals_against)
        team_score = goals_for
        opponent_score = goals_against
    elif game.status == "SCHEDULED":
        result = "Scheduled"
    return CommonGameOut(
        game_id=game.id,
        date=local.date().isoformat(),
        status=game.status if game.status in {"SCHEDULED", "COMPLETED", "POSTPONED", "CANCELLED"} else "SCHEDULED",
        venue_type=_short_venue(game, team_id),
        team_score=team_score,
        opponent_score=opponent_score,
        result=result,
    )


def _summarize(games: list[ScheduleGame], team_id: int) -> _Tally:
    tally = _Tally()
    for game in games:
        if not _completed(game):
            continue
        _, goals_for, goals_against = _perspective(game, team_id)
        if goals_for is None or goals_against is None:
            continue
        tally.add(goals_for, goals_against)
    return tally


def _advantage(left: _Tally, right: _Tally) -> str:
    if left.gp == 0 or right.gp == 0:
        return "incomplete"
    if left.ppg != right.ppg:
        return "team_a" if left.ppg > right.ppg else "team_b"
    left_rate = Decimal(left.gd) / Decimal(left.gp)
    right_rate = Decimal(right.gd) / Decimal(right.gp)
    if left_rate != right_rate:
        return "team_a" if left_rate > right_rate else "team_b"
    return "even"


def _has_completed(games: list[ScheduleGame]) -> bool:
    return any(_completed(game) for game in games)


def _has_live(games: list[ScheduleGame]) -> bool:
    return any(game.status in {"SCHEDULED", "COMPLETED"} and (_completed(game) or game.status == "SCHEDULED") for game in games)


def _group(games: list[ScheduleGame], team_id: int, skip_id: int) -> dict[int, list[ScheduleGame]]:
    grouped: dict[int, list[ScheduleGame]] = defaultdict(list)
    for game in games:
        opponent = _opponent(game, team_id)
        if opponent.id == skip_id:
            continue
        grouped[opponent.id].append(game)
    return grouped


def compare_teams(session: Session, team_a: ScheduleTeam, team_b: ScheduleTeam, conference_only: bool) -> HeadToHeadOut:
    games_a = _games_for(session, team_a.id, conference_only)
    games_b = _games_for(session, team_b.id, conference_only)
    direct_games = [game for game in games_a if team_b.id in {game.home_team_id, game.away_team_id}]
    grouped_a = _group(games_a, team_a.id, team_b.id)
    grouped_b = _group(games_b, team_b.id, team_a.id)
    shared_ids = set(grouped_a) & set(grouped_b)
    opponents: list[CommonOpponentOut] = []
    rollup_a = _Tally()
    rollup_b = _Tally()
    for opponent_id in shared_ids:
        left_games = grouped_a[opponent_id]
        right_games = grouped_b[opponent_id]
        if not (
            _has_completed(left_games)
            or _has_completed(right_games)
            or (_has_live(left_games) and _has_live(right_games))
        ):
            continue
        opponent = _opponent(left_games[0], team_a.id)
        left = _summarize(left_games, team_a.id)
        right = _summarize(right_games, team_b.id)
        for game in left_games:
            if not _completed(game):
                continue
            _, goals_for, goals_against = _perspective(game, team_a.id)
            if goals_for is None or goals_against is None:
                continue
            rollup_a.add(goals_for, goals_against)
        for game in right_games:
            if not _completed(game):
                continue
            _, goals_for, goals_against = _perspective(game, team_b.id)
            if goals_for is None or goals_against is None:
                continue
            rollup_b.add(goals_for, goals_against)
        opponents.append(
            CommonOpponentOut(
                id=opponent.id,
                name=opponent.name,
                conference_rank=conference_rank(session, opponent),
                conference_ppg=_official_ppg(session, opponent),
                team_a_games=[_common_game(game, team_a.id) for game in left_games],
                team_b_games=[_common_game(game, team_b.id) for game in right_games],
                team_a_summary=left.mini(),
                team_b_summary=right.mini(),
                advantage=_advantage(left, right),
            )
        )
    opponents.sort(key=lambda row: (row.conference_ppg is None, -(row.conference_ppg or 0), row.name.casefold()))
    tape_a = _tape(session, team_a, games_a)
    tape_b = _tape(session, team_b, games_b)
    direct = _direct(team_a, team_b, direct_games)
    rollup = CommonRollupOut(team_a_vs_common=rollup_a.rollup(), team_b_vs_common=rollup_b.rollup())
    return HeadToHeadOut(
        team_a_stats=tape_a,
        team_b_stats=tape_b,
        direct_matches=direct,
        common_opponents=opponents,
        common_opponents_rollup=rollup,
        scouting_report=build_scouting_report(tape_a, tape_b, rollup, direct),
    )

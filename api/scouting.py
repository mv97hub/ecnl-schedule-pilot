"""Deterministic pre-game scouting. No model calls."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from app.schemas import ScoutingInsightOut, ScoutingReportOut
from app.standings import _ppg

# A 1.50 PPG gap, a 2.00 goal-difference per game, a 1.50 tactical-goal gap,
# or a 9-point form gap each saturates that signal at +/-100.
_PPG_SPAN = 1.5
_GD_RATE_SPAN = 2.0
_ATTACK_SPAN = 1.5
_FORM_SPAN = 9.0
_SLIGHT = 12
_ADVANTAGE = 35
_HIGH_SCORING = 3.4
_TIGHT = 2.2


def _clamp(value: float, limit: float = 100.0) -> float:
    return max(-limit, min(limit, value))


def _scale(diff: float, span: float) -> float:
    if span <= 0:
        return 0.0
    return _clamp(diff / span * 100.0)


def _ppg_text(value: float) -> str:
    return f"{value:.2f}"


def _side(left: float, right: float) -> str:
    if left > right:
        return "team_a"
    if right > left:
        return "team_b"
    return "even"


def _form_points(team) -> int:
    return sum(3 if game.result == "W" else 1 if game.result == "D" else 0 for game in team.last_5_form)


def _gd_rate(row) -> float:
    if row.gp <= 0:
        return 0.0
    return row.gd / row.gp


def _upcoming(direct_matches, team_a_id: int, team_b_id: int):
    scheduled = [
        game
        for game in direct_matches.games
        if game.status == "SCHEDULED" and {game.home_team_id, game.away_team_id} == {team_a_id, team_b_id}
    ]
    scheduled.sort(key=lambda game: (game.date, game.kickoff_time or "", game.game_id))
    return scheduled[0] if scheduled else None


def _meter(common: float, venue: float, overall: float, tactical: float) -> int:
    raw = 0.40 * common + 0.25 * venue + 0.20 * overall + 0.15 * tactical
    rounded = int(Decimal(raw).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return max(-100, min(100, rounded))


def _transitive(team_a, team_b, rollup) -> tuple[ScoutingInsightOut, float]:
    left = rollup.team_a_vs_common
    right = rollup.team_b_vs_common
    if left.gp <= 0 or right.gp <= 0:
        score = 0.0
        advantage = "even"
    else:
        score = 0.65 * _scale(left.ppg - right.ppg, _PPG_SPAN) + 0.35 * _scale(_gd_rate(left) - _gd_rate(right), _GD_RATE_SPAN)
        if left.ppg != right.ppg:
            advantage = _side(left.ppg, right.ppg)
        elif _gd_rate(left) != _gd_rate(right):
            advantage = _side(_gd_rate(left), _gd_rate(right))
        else:
            advantage = "even"
    headline = "Shared edge" if advantage != "even" else "Shared split"
    detail = f"{_ppg_text(left.ppg)} vs {_ppg_text(right.ppg)} PPG"
    return ScoutingInsightOut(category="Shared", advantage=advantage, headline=headline, detail=detail), score


def _venue(team_a, team_b, direct_matches) -> tuple[ScoutingInsightOut, float]:
    upcoming = _upcoming(direct_matches, team_a.team_id, team_b.team_id)
    if upcoming is not None:
        a_home = upcoming.home_team_id == team_a.team_id
        a_split = team_a.home_record if a_home else team_a.away_record
        b_split = team_b.away_record if a_home else team_b.home_record
        home = (team_a, a_split) if a_home else (team_b, b_split)
        away = (team_b, b_split) if a_home else (team_a, a_split)
        split_label = f"{_ppg_text(home[1].ppg)} vs {_ppg_text(away[1].ppg)} PPG"
    else:
        a_split = team_a.away_record
        b_split = team_b.away_record
        split_label = f"{_ppg_text(a_split.ppg)} vs {_ppg_text(b_split.ppg)} PPG"
    if a_split.gp <= 0 or b_split.gp <= 0:
        missing_away = (upcoming is not None and away[1].gp <= 0) or (upcoming is None and (a_split.gp <= 0 or b_split.gp <= 0))
        return (
            ScoutingInsightOut(
                category="Venue",
                advantage="even",
                headline="No away games" if missing_away else "No home games",
                detail="0 games",
            ),
            0.0,
        )
    advantage = _side(a_split.ppg, b_split.ppg)
    home_is_a = upcoming is not None and upcoming.home_team_id == team_a.team_id
    home_side = "team_a" if home_is_a else "team_b" if upcoming is not None else None
    if upcoming is None:
        headline = "Road edge" if advantage != "even" else "Road split"
    elif advantage == "even":
        headline = "Level split"
    elif advantage == home_side:
        headline = "Home pitch"
    else:
        headline = "Road form"
    return (
        ScoutingInsightOut(category="Venue", advantage=advantage, headline=headline, detail=split_label),
        _scale(a_split.ppg - b_split.ppg, _PPG_SPAN),
    )


def _schedule_or_series(team_a, team_b, rollup, direct_matches) -> tuple[ScoutingInsightOut, float]:
    left = rollup.team_a_vs_common
    right = rollup.team_b_vs_common
    overall = _scale(team_a.overall_record.ppg - team_b.overall_record.ppg, _PPG_SPAN)
    diverges = left.gp > 0 and right.gp > 0 and (
        (team_a.overall_record.ppg < team_b.overall_record.ppg and left.ppg > right.ppg)
        or (team_b.overall_record.ppg < team_a.overall_record.ppg and right.ppg > left.ppg)
    )
    if diverges:
        strength = _scale(left.ppg - right.ppg, _PPG_SPAN)
        blended = _clamp(0.7 * overall + 0.3 * strength)
        advantage = _side(left.ppg, right.ppg)
        return (
            ScoutingInsightOut(
                category="Schedule",
                advantage=advantage,
                headline="Hidden form",
                detail=f"{_ppg_text(left.ppg)} vs {_ppg_text(right.ppg)} PPG",
            ),
            blended,
        )
    team_a_wins = direct_matches.summary.team_a_wins
    team_b_wins = direct_matches.summary.team_b_wins
    draws = direct_matches.summary.draws
    played = team_a_wins + team_b_wins + draws
    if played <= 0:
        advantage = "even"
        headline = "No meetings"
        detail = "0–0"
    else:
        a_ppg = _ppg(team_a_wins * 3 + draws, played)
        b_ppg = _ppg(team_b_wins * 3 + draws, played)
        a_gd = direct_matches.summary.team_a_goals - direct_matches.summary.team_b_goals
        if a_ppg != b_ppg:
            advantage = _side(a_ppg, b_ppg)
        else:
            advantage = _side(a_gd, -a_gd)
        headline = "Series lead" if advantage != "even" else "Series level"
        detail = f"{team_a_wins}–{team_b_wins}" if draws == 0 else f"{team_a_wins}–{team_b_wins}–{draws}"
    return ScoutingInsightOut(category="Series", advantage=advantage, headline=headline, detail=detail), overall


def _tactical(team_a, team_b) -> tuple[ScoutingInsightOut, float]:
    attack_edge = (team_a.avg_gf - team_b.avg_ga) - (team_b.avg_gf - team_a.avg_ga)
    attack = _scale(attack_edge, _ATTACK_SPAN)
    form = _scale(_form_points(team_a) - _form_points(team_b), _FORM_SPAN)
    advantage = _side(attack_edge, 0.0)
    headline = "Sharper attack" if advantage != "even" else "Level attack"
    detail = f"{_ppg_text(team_a.avg_gf)} vs {_ppg_text(team_b.avg_gf)} GF"
    return (
        ScoutingInsightOut(category="Goals", advantage=advantage, headline=headline, detail=detail),
        0.6 * attack + 0.4 * form,
    )


def _tempo(team_a, team_b) -> str:
    projected = ((team_a.avg_gf + team_b.avg_ga) / 2) + ((team_b.avg_gf + team_a.avg_ga) / 2)
    if projected >= _HIGH_SCORING:
        return "High-Scoring"
    if projected <= _TIGHT:
        return "Tight Defensive Battle"
    return "Balanced Matchup"


def _verdict(meter: int) -> tuple[str, str]:
    if abs(meter) >= _ADVANTAGE:
        return "Favored", "team_a" if meter > 0 else "team_b"
    if abs(meter) >= _SLIGHT:
        return "Slight edge", "team_a" if meter > 0 else "team_b"
    return "Little separates them", "even"


def build_scouting_report(team_a_stats, team_b_stats, common_opponents_rollup, direct_matches) -> ScoutingReportOut:
    transitive, common = _transitive(team_a_stats, team_b_stats, common_opponents_rollup)
    venue, venue_score = _venue(team_a_stats, team_b_stats, direct_matches)
    series, overall = _schedule_or_series(team_a_stats, team_b_stats, common_opponents_rollup, direct_matches)
    tactical, tactical_score = _tactical(team_a_stats, team_b_stats)
    meter = _meter(common, venue_score, overall, tactical_score)
    headline, favored = _verdict(meter)
    return ScoutingReportOut(
        verdict_headline=headline,
        favored_team=favored,
        edge_meter=meter,
        projected_tempo=_tempo(team_a_stats, team_b_stats),
        insights=[transitive, venue, series, tactical],
    )

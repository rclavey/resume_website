#!/usr/bin/env python3
"""Build the static March Madness Predictor dashboard payload."""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import random
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any


DEFAULT_PROJECT_ROOT = Path("/Users/richie/Documents/eloSports/MarchMadness")
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "march-madness-dashboard.json"
DEFAULT_SIMULATIONS = 20_000
DEFAULT_RANDOM_SEED = 20260317

REGION_ORDER = ["EAST", "WEST", "SOUTH", "MIDWEST"]
FIRST_FOUR_REGION = {101: "MIDWEST", 102: "WEST", 103: "SOUTH", 104: "MIDWEST"}
ROUND_LABELS = {
    1: "First Four",
    2: "First Round",
    3: "Second Round",
    4: "Sweet 16",
    5: "Elite Eight",
    6: "Final Four",
    7: "Championship",
}

GAME_PATTERN = re.compile(
    r"^\s*(PICK|RESULT) G(\d+): \(([^)]+)\) (.+?) over \(([^)]+)\) (.+?) "
    r"\| team elos \(([^)]+)\) (.+?)=([\d.]+), \(([^)]+)\) (.+?)=([\d.]+) "
    r"\| win p\s+([\d.]+)% \| hist 95% CI\s+([\d.]+)%-\s*([\d.]+)%"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export March Madness Elo data for the resume website.")
    parser.add_argument("--project-root", type=Path, default=DEFAULT_PROJECT_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--simulations", type=int, default=DEFAULT_SIMULATIONS)
    parser.add_argument("--random-seed", type=int, default=DEFAULT_RANDOM_SEED)
    return parser.parse_args()


def load_predictor(project_root: Path) -> Any:
    source = project_root / "scripts" / "predict_march_madness.py"
    spec = importlib.util.spec_from_file_location("march_madness_predictor", source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load predictor module from {source}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def parse_report(report_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    text = report_path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    meta_patterns = {
        "tournamentYear": r"NCAA MEN'S TOURNAMENT ELO REPORT \((\d{4})\)",
        "dataStart": r"Historical games covered: ([\d-]+)",
        "dataEnd": r"Historical games covered: [\d-]+ through ([\d-]+)",
        "cutoff": r"Latest pre-tournament snapshot cutoff: ([\d-]+)",
        "simulations": r"Simulations: ([\d,]+)",
        "predictedChampion": r"Predicted champion: \(\d+\) (.+?) \| Elo",
        "bracketSeasonYear": r"NCAA bracket feed seasonYear: (\d+)",
    }
    meta: dict[str, Any] = {}
    for key, pattern in meta_patterns.items():
        match = re.search(pattern, text)
        if not match:
            raise ValueError(f"Could not parse report metadata field: {key}")
        value: Any = match.group(1)
        if key in {"tournamentYear", "bracketSeasonYear"}:
            value = int(value)
        elif key == "simulations":
            value = int(value.replace(",", ""))
        meta[key] = value

    current_region = "FIRST FOUR"
    games: list[dict[str, Any]] = []
    for line in lines:
        heading = line.strip()
        if heading.endswith(" REGION"):
            current_region = heading.removesuffix(" REGION")
        elif heading == "FINAL FOUR AND TITLE GAME":
            current_region = "NATIONAL"

        match = GAME_PATTERN.match(line)
        if not match:
            continue
        game_id = int(match.group(2))
        winner = match.group(4)
        team_one = match.group(8)
        team_two = match.group(11)
        games.append(
            {
                "id": game_id,
                "status": "completed" if match.group(1) == "RESULT" else "prediction",
                "round": game_id // 100,
                "roundLabel": ROUND_LABELS[game_id // 100],
                "region": FIRST_FOUR_REGION.get(game_id, current_region),
                "winner": winner,
                "loser": match.group(6),
                "winnerSeed": match.group(3),
                "loserSeed": match.group(5),
                "teamOne": team_one,
                "teamOneSeed": match.group(7),
                "teamOneElo": float(match.group(9)),
                "teamTwo": team_two,
                "teamTwoSeed": match.group(10),
                "teamTwoElo": float(match.group(12)),
                "winnerProbability": round(float(match.group(13)) / 100, 6),
                "ciLow": round(float(match.group(14)) / 100, 6),
                "ciHigh": round(float(match.group(15)) / 100, 6),
            }
        )
    if len(games) != 67:
        raise ValueError(f"Expected 67 tournament games, parsed {len(games)}")
    return meta, games


def season_records(input_path: Path, start_date: date, cutoff: date) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = defaultdict(lambda: {"wins": 0, "losses": 0, "pointsFor": 0, "pointsAgainst": 0})
    with input_path.open(newline="", encoding="utf-8", errors="replace") as input_file:
        reader = csv.DictReader(line.replace("\0", "") for line in input_file)
        for row in reader:
            game_date = datetime.strptime(row["date"], "%Y-%m-%d").date()
            if game_date < start_date or game_date >= cutoff:
                continue
            home = row["home_team"]
            away = row["away_team"]
            home_score = int(row["home_score"])
            away_score = int(row["away_score"])
            records[home]["pointsFor"] += home_score
            records[home]["pointsAgainst"] += away_score
            records[away]["pointsFor"] += away_score
            records[away]["pointsAgainst"] += home_score
            if home_score > away_score:
                records[home]["wins"] += 1
                records[away]["losses"] += 1
            else:
                records[away]["wins"] += 1
                records[home]["losses"] += 1
    for record in records.values():
        games = record["wins"] + record["losses"]
        record["games"] = games
        record["winPct"] = round(record["wins"] / games, 6) if games else 0
        record["margin"] = round((record["pointsFor"] - record["pointsAgainst"]) / games, 2) if games else 0
    return records


def expected_score(rating_a: float, rating_b: float) -> float:
    return 1 / (1 + 10 ** ((rating_b - rating_a) / 400))


def simulate_field(
    games: list[dict[str, Any]],
    team_ratings: dict[str, float],
    simulations: int,
    random_seed: int,
) -> dict[str, dict[str, float]]:
    rng = random.Random(random_seed)
    game_map = {game["id"]: game for game in games}
    first_four = [game_map[game_id] for game_id in range(101, 105)]
    region_games = {
        region: sorted(
            (game for game in games if game["region"] == region and game["round"] == 2),
            key=lambda game: game["id"],
        )
        for region in REGION_ORDER
    }
    counters = {stage: Counter() for stage in ("roundOf64", "roundOf32", "sweet16", "eliteEight", "finalFour", "titleGame", "champion")}
    field_names = sorted({team for game in first_four + [g for values in region_games.values() for g in values] for team in (game["teamOne"], game["teamTwo"])})

    def play(team_a: str, team_b: str) -> str:
        probability = expected_score(team_ratings[team_a], team_ratings[team_b])
        return team_a if rng.random() < probability else team_b

    for _ in range(simulations):
        play_in_winners: dict[str, str] = {}
        for game in first_four:
            winner = game["winner"] if game["status"] == "completed" else play(game["teamOne"], game["teamTwo"])
            play_in_winners[game["winner"]] = winner

        for team in field_names:
            if not any(team in (game["teamOne"], game["teamTwo"]) for game in first_four):
                counters["roundOf64"][team] += 1
        for winner in play_in_winners.values():
            counters["roundOf64"][winner] += 1

        regional_champions: dict[str, str] = {}
        for region in REGION_ORDER:
            first_round_winners: list[str] = []
            for game in region_games[region]:
                team_one = play_in_winners.get(game["teamOne"], game["teamOne"])
                team_two = play_in_winners.get(game["teamTwo"], game["teamTwo"])
                winner = play(team_one, team_two)
                first_round_winners.append(winner)
                counters["roundOf32"][winner] += 1

            second_round_winners = [play(first_round_winners[index], first_round_winners[index + 1]) for index in range(0, 8, 2)]
            for winner in second_round_winners:
                counters["sweet16"][winner] += 1
            sweet_sixteen_winners = [play(second_round_winners[index], second_round_winners[index + 1]) for index in range(0, 4, 2)]
            for winner in sweet_sixteen_winners:
                counters["eliteEight"][winner] += 1
            regional_champion = play(sweet_sixteen_winners[0], sweet_sixteen_winners[1])
            counters["finalFour"][regional_champion] += 1
            regional_champions[region] = regional_champion

        finalist_one = play(regional_champions["EAST"], regional_champions["SOUTH"])
        finalist_two = play(regional_champions["WEST"], regional_champions["MIDWEST"])
        counters["titleGame"][finalist_one] += 1
        counters["titleGame"][finalist_two] += 1
        counters["champion"][play(finalist_one, finalist_two)] += 1

    return {
        team: {stage: round(counters[stage][team] / simulations, 6) for stage in counters}
        for team in field_names
    }


def build_payload(project_root: Path, simulations: int, random_seed: int) -> dict[str, Any]:
    predictor = load_predictor(project_root)
    report_path = project_root / "results" / "tournament_prediction_results.txt"
    input_path = project_root / "data" / "player_elo_data.csv"
    meta, games = parse_report(report_path)
    cutoff = datetime.strptime(meta["cutoff"], "%Y-%m-%d").date()
    backtest, snapshots, data_start, data_end = predictor.compute_backtest_and_snapshots(input_path, cutoff)
    records = season_records(input_path, date(cutoff.year - 1, 10, 1), cutoff)

    seeds: dict[str, str] = {}
    regions: dict[str, str] = {}
    for game in games:
        for name, seed in ((game["teamOne"], game["teamOneSeed"]), (game["teamTwo"], game["teamTwoSeed"])):
            seeds.setdefault(name, seed)
            if game["round"] == 2 or game["round"] == 1:
                regions.setdefault(name, game["region"])

    team_names = sorted(seeds)
    dataset_names = {name: predictor.resolve_dataset_team(name, snapshots) for name in team_names}
    team_ratings = {name: snapshots[dataset_names[name]].team_elo for name in team_names}
    simulation = simulate_field(games, team_ratings, simulations, random_seed)

    teams: list[dict[str, Any]] = []
    players: list[dict[str, Any]] = []
    for name in team_names:
        snapshot = snapshots[dataset_names[name]]
        record = records.get(dataset_names[name], {"wins": 0, "losses": 0, "games": 0, "winPct": 0, "margin": 0})
        roster = sorted(snapshot.roster, key=lambda item: item[1], reverse=True)
        team = {
            "name": name,
            "datasetName": dataset_names[name],
            "seed": int(seeds[name]),
            "region": regions[name],
            "rating": round(snapshot.team_elo, 2),
            "lastGame": snapshot.last_game_date.isoformat(),
            "rosterSize": len(roster),
            "record": record,
            "simulation": simulation[name],
        }
        teams.append(team)
        for rank, (player_name, rating) in enumerate(roster, start=1):
            players.append(
                {
                    "name": player_name,
                    "team": name,
                    "seed": int(seeds[name]),
                    "region": regions[name],
                    "rating": round(rating, 2),
                    "teamRank": rank,
                }
            )

    teams.sort(key=lambda team: (-team["rating"], team["name"]))
    players.sort(key=lambda player: (-player["rating"], player["name"]))
    for rank, team in enumerate(teams, start=1):
        team["ratingRank"] = rank
    for rank, player in enumerate(players, start=1):
        player["overallRank"] = rank

    for game in games:
        game["winnerSimulation"] = simulation[game["winner"]]

    generated_at = datetime.fromtimestamp(report_path.stat().st_mtime).astimezone().isoformat(timespec="seconds")
    return {
        "meta": {
            **meta,
            "generatedAt": generated_at,
            "dataStart": data_start,
            "dataEnd": data_end,
            "simulations": simulations,
            "randomSeed": random_seed,
            "teams": len(teams),
            "players": len(players),
        },
        "backtest": {
            "games": backtest["games"],
            "accuracy": round(backtest["accuracy"], 6),
            "accuracyLow": round(backtest["accuracy_ci_low"], 6),
            "accuracyHigh": round(backtest["accuracy_ci_high"], 6),
            "logLoss": round(backtest["log_loss"], 6),
            "brier": round(backtest["brier"], 6),
            "ece": round(backtest["ece"], 6),
            "calibration": [
                {
                    "bucket": item.label,
                    "games": item.games,
                    "averageProbability": round(item.average_probability, 6),
                    "hitRate": round(item.accuracy, 6),
                    "ciLow": round(item.ci_low, 6),
                    "ciHigh": round(item.ci_high, 6),
                }
                for item in backtest["bins"]
            ],
        },
        "teams": teams,
        "players": players,
        "games": games,
        "model": {
            "baseElo": 1000,
            "kFactor": 20,
            "offseasonRegression": 0.10,
            "teamRating": "Mean player Elo for the active game roster",
            "playerAllocation": "Team Elo change allocated by share of player seconds",
            "neutralCourt": True,
            "bracketRatingsFrozen": True,
        },
    }


def main() -> int:
    args = parse_args()
    payload = build_payload(args.project_root, args.simulations, args.random_seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {args.output} with {len(payload['teams'])} teams, "
        f"{len(payload['players'])} players, and {len(payload['games'])} games."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

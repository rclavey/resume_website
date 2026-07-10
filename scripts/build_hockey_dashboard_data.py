#!/usr/bin/env python3
"""Build the static Hockey Elo Engine dashboard payload from generated NHL reports."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any


DEFAULT_NHL_ROOT = Path("/Users/richie/Documents/eloSports/NHL")
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "hockey-dashboard.json"

PERCENT = r"([\d.]+)%"

TEAM_ALIGNMENT = {
    "Anaheim Ducks": ("Western", "Pacific"),
    "Boston Bruins": ("Eastern", "Atlantic"),
    "Buffalo Sabres": ("Eastern", "Atlantic"),
    "Calgary Flames": ("Western", "Pacific"),
    "Carolina Hurricanes": ("Eastern", "Metropolitan"),
    "Chicago Blackhawks": ("Western", "Central"),
    "Colorado Avalanche": ("Western", "Central"),
    "Columbus Blue Jackets": ("Eastern", "Metropolitan"),
    "Dallas Stars": ("Western", "Central"),
    "Detroit Red Wings": ("Eastern", "Atlantic"),
    "Edmonton Oilers": ("Western", "Pacific"),
    "Florida Panthers": ("Eastern", "Atlantic"),
    "Los Angeles Kings": ("Western", "Pacific"),
    "Minnesota Wild": ("Western", "Central"),
    "Montreal Canadiens": ("Eastern", "Atlantic"),
    "Nashville Predators": ("Western", "Central"),
    "New Jersey Devils": ("Eastern", "Metropolitan"),
    "New York Islanders": ("Eastern", "Metropolitan"),
    "New York Rangers": ("Eastern", "Metropolitan"),
    "Ottawa Senators": ("Eastern", "Atlantic"),
    "Philadelphia Flyers": ("Eastern", "Metropolitan"),
    "Pittsburgh Penguins": ("Eastern", "Metropolitan"),
    "San Jose Sharks": ("Western", "Pacific"),
    "Seattle Kraken": ("Western", "Pacific"),
    "St. Louis Blues": ("Western", "Central"),
    "Tampa Bay Lightning": ("Eastern", "Atlantic"),
    "Toronto Maple Leafs": ("Eastern", "Atlantic"),
    "Utah Mammoth": ("Western", "Central"),
    "Vancouver Canucks": ("Western", "Pacific"),
    "Vegas Golden Knights": ("Western", "Pacific"),
    "Washington Capitals": ("Eastern", "Metropolitan"),
    "Winnipeg Jets": ("Western", "Central"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export generated NHL Elo results for the static resume website dashboard."
    )
    parser.add_argument("--nhl-root", type=Path, default=DEFAULT_NHL_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def read_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


def percent(value: str) -> float:
    return round(float(value) / 100.0, 6)


def parse_backtest(lines: list[str]) -> dict[str, Any]:
    text = "\n".join(lines[:28])
    patterns = {
        "games": r"Games evaluated: ([\d,]+)",
        "accuracy": rf"Favorite-pick accuracy:\s+{PERCENT}",
        "accuracyLow": rf"Favorite-pick accuracy:.*95% CI\s+{PERCENT}",
        "accuracyHigh": rf"Favorite-pick accuracy:.*to\s+{PERCENT}",
        "logLoss": r"Log loss: ([\d.]+)",
        "brier": r"Brier score: ([\d.]+)",
        "ece": r"Expected calibration error: ([\d.]+)",
        "auc": r"ROC AUC .*: ([\d.]+)",
        "homeWinRate": rf"Home-win base rate:\s+{PERCENT}",
        "predictedHomeRate": rf"Predicted-home rate:\s+{PERCENT}",
        "precision": rf"Precision:\s+{PERCENT}",
        "recall": rf"Recall/TPR:\s+{PERCENT}",
        "specificity": rf"Specificity/TNR:\s+{PERCENT}",
        "balancedAccuracy": rf"Balanced accuracy:\s+{PERCENT}",
    }
    result: dict[str, Any] = {}
    percentage_keys = {
        "accuracy", "accuracyLow", "accuracyHigh", "homeWinRate",
        "predictedHomeRate", "precision", "recall", "specificity",
        "balancedAccuracy",
    }
    for key, pattern in patterns.items():
        match = re.search(pattern, text)
        if not match:
            raise ValueError(f"Could not parse backtest field: {key}")
        raw = match.group(1)
        if key == "games":
            result[key] = int(raw.replace(",", ""))
        elif key in percentage_keys:
            result[key] = percent(raw)
        else:
            result[key] = float(raw)

    calibration: list[dict[str, Any]] = []
    row_pattern = re.compile(
        rf"^(\d+-\d+%)\s+([\d,]+)\s+{PERCENT}\s+([\d.]+)\s+"
        rf"{PERCENT}\s+{PERCENT}-\s*{PERCENT}$"
    )
    for line in lines:
        match = row_pattern.match(line.strip())
        if not match:
            continue
        calibration.append(
            {
                "bucket": match.group(1),
                "games": int(match.group(2).replace(",", "")),
                "averageProbability": percent(match.group(3)),
                "averageEloDifference": float(match.group(4)),
                "hitRate": percent(match.group(5)),
                "ciLow": percent(match.group(6)),
                "ciHigh": percent(match.group(7)),
            }
        )
    result["calibration"] = calibration
    return result


def parse_teams(lines: list[str]) -> list[dict[str, Any]]:
    start = lines.index("CURRENT TEAM SNAPSHOTS") + 2
    end = lines.index("TOP PLAYER SNAPSHOTS")
    pattern = re.compile(
        r"^\s*(\d+)\.\s+(.+?)\s+Elo\s+([\d.]+)\s+\| roster\s+(\d+)\s+"
        r"\| points\s+(\d+)\s+\| last completed game\s+([\d-]+)$"
    )
    teams: list[dict[str, Any]] = []
    for line in lines[start:end]:
        match = pattern.match(line)
        if not match:
            continue
        name = match.group(2).strip()
        if name not in TEAM_ALIGNMENT:
            raise ValueError(f"Missing conference and division alignment for {name}")
        conference, division = TEAM_ALIGNMENT[name]
        teams.append(
            {
                "rank": int(match.group(1)),
                "name": name,
                "conference": conference,
                "division": division,
                "rating": float(match.group(3)),
                "rosterSize": int(match.group(4)),
                "points": int(match.group(5)),
                "lastGame": match.group(6),
            }
        )
    if len(teams) != 32:
        raise ValueError(f"Expected 32 current NHL teams, parsed {len(teams)}")
    return teams


def parse_current_players(path: Path) -> list[dict[str, Any]]:
    section = ""
    players: list[dict[str, Any]] = []
    pattern = re.compile(
        r"^\s*(\d+)\.\s+(.+?)\s{2,}(.+?)\s+Elo\s+([\d.]+)\s+\| last game\s+([\d-]+)$"
    )
    section_names = {
        "FORWARDS": "Forward",
        "DEFENSEMEN": "Defense",
        "GOALIES": "Goalie",
    }
    for line in read_lines(path):
        if line in section_names:
            section = section_names[line]
            continue
        match = pattern.match(line)
        if not match or not section:
            continue
        players.append(
            {
                "position": section,
                "positionRank": int(match.group(1)),
                "name": match.group(2).strip(),
                "team": match.group(3).strip(),
                "rating": float(match.group(4)),
                "lastGame": match.group(5),
            }
        )
    for rank, player in enumerate(sorted(players, key=lambda item: item["rating"], reverse=True), 1):
        player["overallRank"] = rank
    if len(players) < 500:
        raise ValueError(f"Expected at least 500 current players, parsed {len(players)}")
    return players


def parse_historic_players(path: Path) -> list[dict[str, Any]]:
    section = ""
    players: list[dict[str, Any]] = []
    pattern = re.compile(
        r"^\s*(\d+)\.\s+(.+?)\s{2,}(.+?)\s+([A-Z]{3})\s+Elo\s+([\d.]+)\s+"
        r"\| peak\s+([\d-]+)\s+\| last game\s+([\d-]+)$"
    )
    section_names = {
        "FORWARDS": "Forward",
        "DEFENSEMEN": "Defense",
        "GOALIES": "Goalie",
    }
    for line in read_lines(path):
        if line in section_names:
            section = section_names[line]
            continue
        match = pattern.match(line)
        if not match or not section:
            continue
        players.append(
            {
                "position": section,
                "positionRank": int(match.group(1)),
                "name": match.group(2).strip(),
                "team": match.group(3).strip(),
                "nationality": match.group(4),
                "rating": float(match.group(5)),
                "peakDate": match.group(6),
                "lastGame": match.group(7),
            }
        )
    for rank, player in enumerate(sorted(players, key=lambda item: item["rating"], reverse=True), 1):
        player["overallRank"] = rank
    if len(players) < 5000:
        raise ValueError(f"Expected at least 5,000 historic players, parsed {len(players)}")
    return players


def parse_schedule(lines: list[str]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    start = lines.index("NHL GAME PREDICTIONS")
    end = lines.index("PROJECTED PLAYOFF SIMULATION")
    section = lines[start:end]
    header = "\n".join(section[:8])
    coverage = re.search(r"Historical Elo dataset coverage: ([\d-]+) through ([\d-]+)", header)
    window = re.search(r"Prediction window: ([\d-]+) through ([\d-]+)", header)
    count = re.search(r"Scheduled unplayed regular-season games found: ([\d,]+)", header)
    if not coverage or not window or not count:
        raise ValueError("Could not parse NHL prediction metadata")

    metadata = {
        "dataStart": coverage.group(1),
        "dataEnd": coverage.group(2),
        "startDate": window.group(1),
        "endDate": window.group(2),
        "gameCount": int(count.group(1).replace(",", "")),
    }
    game_date = ""
    games: list[dict[str, Any]] = []
    pattern = re.compile(
        r"^(.+?) \(([\d.]+)\) at (.+?) \(([\d.]+)\) \| elo diff ([\d.]+) \| "
        r"pick: (.+?) \| win p\s+([\d.]+)% \| hist 95% CI\s+([\d.]+)%-\s*([\d.]+)%$"
    )
    for line in section:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", line):
            game_date = line
            continue
        match = pattern.match(line)
        if not match:
            continue
        away, home, pick = match.group(1), match.group(3), match.group(6)
        favorite_probability = percent(match.group(7))
        home_probability = favorite_probability if pick == home else 1.0 - favorite_probability
        games.append(
            {
                "date": game_date,
                "awayTeam": away,
                "awayRating": float(match.group(2)),
                "homeTeam": home,
                "homeRating": float(match.group(4)),
                "ratingDifference": float(match.group(5)),
                "pick": pick,
                "favoriteProbability": favorite_probability,
                "homeProbability": round(home_probability, 6),
                "ciLow": percent(match.group(8)),
                "ciHigh": percent(match.group(9)),
            }
        )
    if len(games) != metadata["gameCount"]:
        raise ValueError(f"Expected {metadata['gameCount']} scheduled games, parsed {len(games)}")
    return metadata, games


def parse_playoffs(lines: list[str]) -> dict[str, Any]:
    start = lines.index("PROJECTED PLAYOFF SIMULATION")
    section = lines[start:]
    text = "\n".join(section[:12])

    def required(pattern: str) -> re.Match[str]:
        match = re.search(pattern, text)
        if not match:
            raise ValueError(f"Could not parse playoff metadata: {pattern}")
        return match

    standings_date = required(r"standings snapshot on ([\d-]+)").group(1)
    regular_season_end = required(r"regular season ends on ([\d-]+)").group(1)
    playoff_end = required(r"playoff end date as ([\d-]+)").group(1)
    remaining_games = int(required(r"Remaining regular-season games simulated per run: ([\d,]+)").group(1).replace(",", ""))
    overtime_rate = percent(required(r"loser-point rate for remaining games:\s+([\d.]+)%").group(1))
    simulations = int(required(r"Monte Carlo playoff simulations: ([\d,]+)").group(1).replace(",", ""))

    field: list[dict[str, Any]] = []
    field_pattern = re.compile(
        r"^([EW])\s+(\d+)\s+(.+?)\s+([AMP C]\d) \| points\s+(\d+) \| RW\s+(\d+) \| ROW\s+(\d+)$".replace(" ", "\\s+")
    )
    for line in section:
        match = field_pattern.match(line.strip())
        if match:
            field.append(
                {
                    "conference": match.group(1),
                    "seed": int(match.group(2)),
                    "team": match.group(3).strip(),
                    "divisionSeed": match.group(4),
                    "points": int(match.group(5)),
                    "regulationWins": int(match.group(6)),
                    "regulationOvertimeWins": int(match.group(7)),
                }
            )

    series: list[dict[str, Any]] = []
    conference = ""
    series_pattern = re.compile(
        r"^(\S+) (.+?) \(([\d.]+)\) at (\S+) (.+?) \(([\d.]+)\) \| pick: (.+?) \| "
        r"series win p\s+([\d.]+)% \| elo diff ([\d.]+)$"
    )
    in_bracket = False
    for line in section:
        if line == "Projected first-round bracket from average simulated final standings":
            in_bracket = True
            continue
        if line == "Projected playoff advancement odds":
            in_bracket = False
        if in_bracket and line in {"Eastern Conference", "Western Conference"}:
            conference = line.split()[0]
            continue
        match = series_pattern.match(line)
        if not match:
            continue
        series.append(
            {
                "conference": conference,
                "awaySeed": match.group(1),
                "awayTeam": match.group(2),
                "awayRating": float(match.group(3)),
                "homeSeed": match.group(4),
                "homeTeam": match.group(5),
                "homeRating": float(match.group(6)),
                "pick": match.group(7),
                "winProbability": percent(match.group(8)),
                "ratingDifference": float(match.group(9)),
            }
        )

    odds: list[dict[str, Any]] = []
    odds_pattern = re.compile(
        r"^(.+?)\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%$"
    )
    odds_heading_seen = False
    for line in section:
        if line == "Team                         Make PO   Round 2   Conf Final   Cup Final   Champion":
            odds_heading_seen = True
            continue
        if not odds_heading_seen:
            continue
        match = odds_pattern.match(line.strip())
        if not match:
            continue
        odds.append(
            {
                "team": match.group(1).strip(),
                "makePlayoffs": percent(match.group(2)),
                "roundTwo": percent(match.group(3)),
                "conferenceFinal": percent(match.group(4)),
                "cupFinal": percent(match.group(5)),
                "champion": percent(match.group(6)),
            }
        )
    if len(field) != 16 or len(series) != 8 or len(odds) != 32:
        raise ValueError(
            f"Expected 16 field teams, 8 series, and 32 odds rows; parsed {len(field)}, {len(series)}, {len(odds)}"
        )
    return {
        "standingsDate": standings_date,
        "regularSeasonEnd": regular_season_end,
        "playoffEnd": playoff_end,
        "remainingGames": remaining_games,
        "overtimeRate": overtime_rate,
        "simulations": simulations,
        "projectedField": field,
        "firstRound": series,
        "advancement": odds,
    }


def build_model(params_path: Path) -> dict[str, Any]:
    payload = json.loads(params_path.read_text(encoding="utf-8"))
    keep = {
        "gamesProcessed": payload["games_processed"],
        "gamesSkippedMissingStats": payload["games_skipped_missing_stats"],
        "trainingSeasons": payload["training_seasons"],
        "validationSeasons": payload["validation_seasons"],
        "holdoutSeasons": payload["holdout_seasons"],
        "completedTrials": payload["completed_trials"],
        "selectedTrial": payload["selected_production_trial_number"],
        "regressionRate": payload["regression_rate"],
        "params": payload["best_params"],
        "validationMetrics": payload["validation_metrics"],
        "holdoutMetrics": payload["holdout_metrics"],
        "fullRunMetrics": payload["full_run_metrics"],
    }
    return keep


def build_payload(nhl_root: Path) -> dict[str, Any]:
    results = nhl_root / "results"
    report_path = results / "nhl_prediction_results.txt"
    current_players_path = results / "nhl_player_rankings.txt"
    historic_players_path = results / "historic_nhl_player_rankings.txt"
    params_path = results / "best_nhl_params.json"
    required_paths = [report_path, current_players_path, historic_players_path, params_path]
    for path in required_paths:
        if not path.exists():
            raise FileNotFoundError(f"Required generated NHL artifact not found: {path}")

    lines = read_lines(report_path)
    schedule_meta, schedule = parse_schedule(lines)
    latest_mtime = max(path.stat().st_mtime for path in required_paths)
    generated_at = datetime.fromtimestamp(latest_mtime).astimezone().isoformat(timespec="seconds")
    return {
        "meta": {
            "generatedAt": generated_at,
            "dataStart": schedule_meta["dataStart"],
            "dataEnd": schedule_meta["dataEnd"],
            "predictionStart": schedule_meta["startDate"],
            "predictionEnd": schedule_meta["endDate"],
        },
        "backtest": parse_backtest(lines),
        "teams": parse_teams(lines),
        "currentPlayers": parse_current_players(current_players_path),
        "historicPlayers": parse_historic_players(historic_players_path),
        "schedule": schedule,
        "playoffs": parse_playoffs(lines),
        "model": build_model(params_path),
    }


def main() -> int:
    args = parse_args()
    payload = build_payload(args.nhl_root.resolve())
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {output} with {len(payload['teams'])} teams, "
        f"{len(payload['currentPlayers'])} current players, "
        f"{len(payload['historicPlayers'])} historic players, and "
        f"{len(payload['schedule'])} scheduled games."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

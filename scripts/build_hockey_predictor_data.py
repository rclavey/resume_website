#!/usr/bin/env python3
"""Build the multi-league Hockey Predictor payload and Monte Carlo forecasts."""

from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path("/Users/richie/Documents/eloSports/GlobalHockey")
DEFAULT_OUTPUT = ROOT / "data" / "hockey-predictor.json"
TODAY = date(2026, 7, 21)
SEASON = "2026–27"
RUNS = 10_000
HOME_ADVANTAGE = 32.0
DAY = 86_400

NHL_TEAMS = {
    "ANA": "Anaheim Ducks", "BOS": "Boston Bruins", "BUF": "Buffalo Sabres",
    "CAR": "Carolina Hurricanes", "CBJ": "Columbus Blue Jackets", "CGY": "Calgary Flames",
    "CHI": "Chicago Blackhawks", "COL": "Colorado Avalanche", "DAL": "Dallas Stars",
    "DET": "Detroit Red Wings", "EDM": "Edmonton Oilers", "FLA": "Florida Panthers",
    "LAK": "Los Angeles Kings", "MIN": "Minnesota Wild", "MTL": "Montreal Canadiens",
    "NJD": "New Jersey Devils", "NSH": "Nashville Predators", "NYI": "New York Islanders",
    "NYR": "New York Rangers", "OTT": "Ottawa Senators", "PHI": "Philadelphia Flyers",
    "PIT": "Pittsburgh Penguins", "SEA": "Seattle Kraken", "SJS": "San Jose Sharks",
    "STL": "St. Louis Blues", "TBL": "Tampa Bay Lightning", "TOR": "Toronto Maple Leafs",
    "UTA": "Utah Mammoth", "VAN": "Vancouver Canucks", "VGK": "Vegas Golden Knights",
    "WPG": "Winnipeg Jets", "WSH": "Washington Capitals",
}

PWHL_EXPANSION = ["Detroit", "Hamilton", "Las Vegas", "San Jose"]

CHL_2026_TEAMS = {
    "Frölunda Gothenburg": "Frölunda HC",
    "Skellefteå AIK": "Skellefteå AIK",
    "Växjö Lakers": "Växjö Lakers",
    "Rögle Ängelholm": "Rögle BK",
    "Graz99ers": "Graz99ers",
    "KAC Klagenfurt": "KAC Klagenfurt",
    "Red Bull Salzburg": "Red Bull Salzburg",
    "Dynamo Pardubice": "Dynamo Pardubice",
    "HC Pilsen": "HC Pilsen",
    "Bílí Tygři Liberec": "Bílí Tygři Liberec",
    "Tappara Tampere": "Tappara Tampere",
    "KooKoo Kouvola": "KooKoo Kouvola",
    "SaiPa Lappeenranta": "SaiPa Lappeenranta",
    "Eisbären Berlin": "Eisbären Berlin",
    "Kölner Haie": "Kölner Haie",
    "Adler Mannheim": "Adler Mannheim",
    "Fribourg-Gottéron": "Fribourg-Gottéron",
    "HC Davos": "HC Davos",
    "Genève-Servette": "Genève-Servette",
    "Herning Blue Fox": "Herning Blue Fox",
    "Bordeaux Boxers": "Bordeaux Boxers",
    "Storhamar Hamar": "Storhamar Hockey",
    "GKS Tychy": "GKS Tychy",
    "HK Nitra": "HK Nitra",
}

AHL_2026_TEAMS = {
    "Abbotsford Canucks": "Abbotsford Canucks", "Bakersfield Condors": "Bakersfield Condors",
    "Belleville Senators": "Belleville Senators", "Calgary Wranglers": "Calgary Wranglers",
    "Charlotte Checkers": "Charlotte Checkers", "Chicago Wolves": "Chicago Wolves",
    "Cleveland Monsters": "Cleveland Monsters", "Coachella Valley Firebirds": "Coachella Valley Firebirds",
    "Colorado Eagles": "Colorado Eagles", "Grand Rapids Griffins": "Grand Rapids Griffins",
    "Hamilton Hammers": "Hamilton Hammers", "Hartford Wolf Pack": "Hartford Wolf Pack",
    "Henderson Silver Knights": "Henderson Silver Knights", "Hershey Bears": "Hershey Bears",
    "Iowa Wild": "Iowa Wild", "Laval Rocket": "Laval Rocket",
    "Lehigh Valley Phantoms": "Lehigh Valley Phantoms", "Manitoba Moose": "Manitoba Moose",
    "Milwaukee Admirals": "Milwaukee Admirals", "Ontario Reign": "Ontario Reign",
    "Providence Bruins": "Providence Bruins", "Rochester Americans": "Rochester Americans",
    "Rockford IceHogs": "Rockford IceHogs", "San Diego Gulls": "San Diego Gulls",
    "San Jose Barracuda": "San Jose Barracuda", "Springfield Thunderbirds": "Springfield Thunderbirds",
    "Syracuse Crunch": "Syracuse Crunch", "Texas Stars": "Texas Stars",
    "Toronto Marlies": "Toronto Marlies", "Tucson Roadrunners": "Tucson Roadrunners",
    "Utica Comets": "Utica Comets", "Wilkes-Barre/Scranton Penguins": "Wilkes-Barre Scranton Penguins",
}

FORMAT = {
    "NHL": (84, 16, 7, "Official 1,344-game NHL schedule"),
    "PWHL": (30, 4, 5, "Balanced schedule; 2026–27 schedule pending"),
    "SHL": (52, 8, 7, "Official 52-game format; balanced opponents"),
    "CHL": (6, 16, 3, "Official six-game league phase; balanced opponents"),
    "AHL": (72, 16, 5, "Official 72-game format; balanced opponents"),
    "ECHL": (72, 16, 7, "Balanced 72-game projection"),
    "OHL": (68, 16, 7, "Balanced 68-game projection"),
    "QMJHL": (64, 16, 7, "Balanced 64-game projection"),
    "WHL": (68, 16, 7, "Balanced 68-game projection"),
    "Liiga": (60, 8, 7, "Balanced 60-game projection"),
    "Czech Extraliga": (52, 8, 7, "Balanced 52-game projection"),
    "DEL": (52, 8, 7, "Balanced 52-game projection"),
    "DEL2": (52, 8, 7, "Balanced 52-game projection"),
    "National League": (52, 8, 7, "Balanced 52-game projection"),
    "Swiss League": (45, 8, 7, "Balanced 45-game projection"),
    "Slovak Extraliga": (54, 8, 7, "Balanced 54-game projection"),
    "EHL": (45, 8, 7, "Balanced 45-game projection"),
    "Metal Ligaen": (48, 8, 7, "Balanced 48-game projection"),
    "ICEHL": (48, 8, 7, "Balanced 48-game projection"),
    "Belarus Extraliga": (55, 8, 7, "Balanced 55-game projection"),
    "HockeyAllsvenskan": (52, 8, 7, "Balanced 52-game projection"),
    "Mestis": (49, 8, 7, "Balanced 49-game projection"),
    "CEHL": (24, 8, 5, "Balanced 24-game projection"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--runs", type=int, default=RUNS)
    parser.add_argument("--offline", action="store_true", help="Skip official NHL roster and schedule refresh.")
    return parser.parse_args()


def canonical(value: str) -> str:
    text = unicodedata.normalize("NFKD", value)
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", "", text.casefold())


def fetch_json(url: str) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": "Richard-Lavey-Hockey-Predictor/1.0"})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def fetch_nhl() -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, str]]]:
    rosters: dict[str, list[dict[str, Any]]] = {}
    schedules: dict[int, dict[str, str]] = {}

    def load(abbreviation: str) -> tuple[str, dict[str, Any], dict[str, Any]]:
        return (
            abbreviation,
            fetch_json(f"https://api-web.nhle.com/v1/roster/{abbreviation}/current"),
            fetch_json(f"https://api-web.nhle.com/v1/club-schedule-season/{abbreviation}/20262027"),
        )

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(load, abbreviation) for abbreviation in NHL_TEAMS]
        for future in as_completed(futures):
            abbreviation, roster, schedule = future.result()
            team_name = NHL_TEAMS[abbreviation]
            players: list[dict[str, Any]] = []
            for source_group, group in (("forwards", "forward"), ("defensemen", "defense"), ("goalies", "goalie")):
                for player in roster.get(source_group, []):
                    players.append({
                        "name": f"{player.get('firstName', {}).get('default', '')} {player.get('lastName', {}).get('default', '')}".strip(),
                        "position": group,
                        "number": player.get("sweaterNumber"),
                    })
            rosters[team_name] = players
            for game in schedule.get("games", []):
                if game.get("gameType") != 2:
                    continue
                schedules[int(game["id"])] = {
                    "date": game["gameDate"],
                    "home": game["homeTeam"]["commonName"]["default"],
                    "away": game["awayTeam"]["commonName"]["default"],
                }

    aliases = {
        "Utah Mammoth": "Utah Mammoth", "Mammoth": "Utah Mammoth",
        "Montréal Canadiens": "Montreal Canadiens", "Canadiens": "Montreal Canadiens",
    }
    name_lookup = {canonical(name): name for name in NHL_TEAMS.values()}
    for short, full in {
        "Ducks": "Anaheim Ducks", "Bruins": "Boston Bruins", "Sabres": "Buffalo Sabres",
        "Hurricanes": "Carolina Hurricanes", "Blue Jackets": "Columbus Blue Jackets", "Flames": "Calgary Flames",
        "Blackhawks": "Chicago Blackhawks", "Avalanche": "Colorado Avalanche", "Stars": "Dallas Stars",
        "Red Wings": "Detroit Red Wings", "Oilers": "Edmonton Oilers", "Panthers": "Florida Panthers",
        "Kings": "Los Angeles Kings", "Wild": "Minnesota Wild", "Devils": "New Jersey Devils",
        "Predators": "Nashville Predators", "Islanders": "New York Islanders", "Rangers": "New York Rangers",
        "Senators": "Ottawa Senators", "Flyers": "Philadelphia Flyers", "Penguins": "Pittsburgh Penguins",
        "Kraken": "Seattle Kraken", "Sharks": "San Jose Sharks", "Blues": "St. Louis Blues",
        "Lightning": "Tampa Bay Lightning", "Maple Leafs": "Toronto Maple Leafs", "Canucks": "Vancouver Canucks",
        "Golden Knights": "Vegas Golden Knights", "Jets": "Winnipeg Jets", "Capitals": "Washington Capitals",
    }.items():
        name_lookup[canonical(short)] = full
    name_lookup.update({canonical(key): value for key, value in aliases.items()})
    normalized: list[dict[str, str]] = []
    for game in schedules.values():
        home = name_lookup.get(canonical(game["home"]))
        away = name_lookup.get(canonical(game["away"]))
        if home and away:
            normalized.append({"date": game["date"], "home": home, "away": away})
    return rosters, sorted(normalized, key=lambda item: (item["date"], item["home"], item["away"]))


def active_team_names(organization: str, values: dict[str, dict[str, Any]]) -> list[str]:
    if organization == "NHL":
        return sorted(NHL_TEAMS.values())
    if not values:
        return []
    most_recent = max(date.fromisoformat(value["date"]) for value in values.values())
    names = [
        name for name, value in values.items()
        if (most_recent - date.fromisoformat(value["date"])).days <= 400
    ]
    return sorted(names)


def rebuild_nhl_ratings(
    teams: dict[str, dict[str, Any]],
    rosters: dict[str, list[dict[str, Any]]],
    players: list[dict[str, Any]],
) -> None:
    player_lookup: dict[str, dict[str, Any]] = {}
    for player in players:
        if player["organization"] == "NHL":
            key = canonical(player["name"])
            if key not in player_lookup or player["date"] > player_lookup[key]["date"]:
                player_lookup[key] = player

    weights = {"forward": 0.447, "defense": 0.276, "goalie": 0.277}
    for team_name, roster in rosters.items():
        if team_name not in teams:
            continue
        fallback = teams[team_name]
        matched = 0
        for player in roster:
            rating = player_lookup.get(canonical(player["name"]))
            if rating:
                matched += 1
                player["combined_elo"] = rating["combined_elo"]
                player["league_elo"] = rating["league_elo"]
                player["last_game"] = rating["date"]
            else:
                player["combined_elo"] = 1000.0
                player["league_elo"] = 1000.0
                player["last_game"] = None

        for strategy in ("combined", "league"):
            means: dict[str, float] = {}
            for group in weights:
                group_ratings = [player[f"{strategy}_elo"] for player in roster if player["position"] == group]
                if group_ratings:
                    means[group] = sum(group_ratings) / len(group_ratings)
            total_weight = sum(weights[group] for group in means)
            player_value = sum(means[group] * weights[group] for group in means) / total_weight
            fallback[f"{strategy}_elo"] = round(0.8 * player_value + 0.2 * fallback[f"{strategy}_elo"], 3)
        fallback["roster_players"] = len(roster)
        fallback["roster_matched"] = matched
        fallback["date"] = TODAY.isoformat()
        fallback["roster_source"] = "Official NHL current roster"


def balanced_schedule(names: list[str], games_per_team: int) -> list[tuple[int, int]]:
    count = len(names)
    if count < 2:
        return []
    target_games = count * games_per_team // 2
    pairs = [(left, right) for left in range(count) for right in range(left + 1, count)]
    schedule: list[tuple[int, int]] = []
    cycle = 0
    while len(schedule) < target_games:
        for left, right in pairs:
            if len(schedule) >= target_games:
                break
            schedule.append((left, right) if cycle % 2 == 0 else (right, left))
        cycle += 1
    return schedule


def series_probability(probability: np.ndarray, best_of: int) -> np.ndarray:
    wins_needed = best_of // 2 + 1
    return sum(
        math.comb(best_of, wins) * probability**wins * (1 - probability) ** (best_of - wins)
        for wins in range(wins_needed, best_of + 1)
    )


def simulate(
    teams: list[dict[str, Any]],
    strategy: str,
    runs: int,
    games_per_team: int,
    playoff_teams: int,
    best_of: int,
    official_schedule: list[dict[str, str]] | None,
    seed: int,
) -> dict[str, Any]:
    names = [team["name"] for team in teams]
    ratings = np.array([float(team[f"{strategy}_elo"]) for team in teams])
    count = len(names)
    if count < 2:
        return {"runs": runs, "teams": []}
    index = {name: position for position, name in enumerate(names)}
    if official_schedule:
        schedule = [
            (index[game["home"]], index[game["away"]])
            for game in official_schedule if game["home"] in index and game["away"] in index
        ]
    else:
        schedule = balanced_schedule(names, games_per_team)

    rng = np.random.default_rng(seed)
    points = np.zeros((runs, count), dtype=np.int16)
    wins = np.zeros((runs, count), dtype=np.int16)
    for home, away in schedule:
        probability = 1 / (1 + 10 ** ((ratings[away] - ratings[home] - HOME_ADVANTAGE) / 400))
        home_wins = rng.random(runs) < probability
        overtime = rng.random(runs) < 0.23
        wins[:, home] += home_wins
        wins[:, away] += ~home_wins
        points[:, home] += home_wins * 2 + (~home_wins & overtime)
        points[:, away] += (~home_wins) * 2 + (home_wins & overtime)

    jitter = rng.random((runs, count)) * 0.01
    ranking = np.argsort(-(points + jitter), axis=1)
    regular_champions = ranking[:, 0]
    regular_counts = np.bincount(regular_champions, minlength=count)
    playoff_size = min(playoff_teams, 2 ** int(math.floor(math.log2(count))))
    playoff_size = max(2, playoff_size)
    playoff_counts = np.zeros(count, dtype=np.int32)

    for run in range(runs):
        field = list(ranking[run, :playoff_size])
        while len(field) > 1:
            pairs = [(field[position], field[-position - 1]) for position in range(len(field) // 2)]
            winners: list[int] = []
            for left, right in pairs:
                game_probability = 1 / (1 + 10 ** ((ratings[right] - ratings[left]) / 400))
                match_probability = float(series_probability(np.array(game_probability), best_of))
                winners.append(left if rng.random() < match_probability else right)
            winners.sort(key=lambda team_index: int(np.where(ranking[run] == team_index)[0][0]))
            field = winners
        playoff_counts[field[0]] += 1

    rows = []
    for position, team in enumerate(teams):
        rows.append({
            "name": team["name"],
            "elo": round(float(ratings[position]), 1),
            "averagePoints": round(float(points[:, position].mean()), 1),
            "averageWins": round(float(wins[:, position].mean()), 1),
            "regularSeasonWinProbability": round(float(regular_counts[position] / runs), 6),
            "playoffWinProbability": round(float(playoff_counts[position] / runs), 6),
            "playoffProbability": round(float(np.mean(np.any(ranking[:, :playoff_size] == position, axis=1))), 6),
        })
    rows.sort(key=lambda item: (-item["regularSeasonWinProbability"], -item["averagePoints"], item["name"]))
    playoff_winner = max(rows, key=lambda item: item["playoffWinProbability"])
    return {
        "runs": runs,
        "games": len(schedule),
        "gamesPerTeam": round(len(schedule) * 2 / count, 1),
        "playoffTeams": playoff_size,
        "bestOf": best_of,
        "regularSeasonWinner": rows[0]["name"],
        "regularSeasonWinnerProbability": rows[0]["regularSeasonWinProbability"],
        "playoffWinner": playoff_winner["name"],
        "playoffWinnerProbability": playoff_winner["playoffWinProbability"],
        "teams": rows,
    }


def main() -> None:
    args = parse_args()
    metrics = json.loads((args.source / "results" / "metrics.json").read_text(encoding="utf-8"))
    ratings = json.loads((args.source / "results" / "latest_ratings.json").read_text(encoding="utf-8"))
    league_config = json.loads((args.source / "config" / "leagues.json").read_text(encoding="utf-8"))
    labels = {item["organization"]: item["display_name"] for item in league_config}
    priorities = {item["organization"]: item.get("priority", 9) for item in league_config}

    nhl_rosters: dict[str, list[dict[str, Any]]] = {}
    nhl_schedule: list[dict[str, str]] = []
    if not args.offline:
        nhl_rosters, nhl_schedule = fetch_nhl()
        rebuild_nhl_ratings(ratings["teams"]["NHL"], nhl_rosters, ratings["players"])

    players_by_team: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for player in ratings["players"]:
        players_by_team[(player["organization"], player["team"])].append({
            "name": player["name"], "position": player["position_group"],
            "combined_elo": player["combined_elo"], "league_elo": player["league_elo"],
            "last_game": player["date"],
        })

    team_rating_pool: dict[str, list[tuple[str, str, str, dict[str, Any]]]] = defaultdict(list)
    for pool_organization, pool_teams in ratings["teams"].items():
        for pool_name, pool_value in pool_teams.items():
            team_rating_pool[canonical(pool_name)].append((pool_value["date"], pool_organization, pool_name, pool_value))

    def projected_field(field: dict[str, str], organization: str) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        organization_teams = ratings["teams"].get(organization, {})
        organization_lookup = {canonical(name): value for name, value in organization_teams.items()}
        for display_name, source_name in field.items():
            sources = team_rating_pool.get(canonical(source_name), [])
            newest = max(sources, default=None, key=lambda item: item[0])
            competition_value = organization_lookup.get(canonical(source_name))
            if newest:
                _, _, _, global_value = newest
                combined_elo = global_value["combined_elo"]
                source_date = global_value["date"]
            else:
                combined_elo = 1000.0
                source_date = TODAY.isoformat()
            result[display_name] = {
                "date": source_date,
                "combined_elo": combined_elo,
                "league_elo": competition_value["league_elo"] if competition_value else 1000.0,
                "roster_players": 0,
                "roster_matched": 0,
                "roster_source": f"{SEASON} field; latest transferable rating" if newest else f"{SEASON} expansion baseline",
            }
        return result

    organizations = sorted(metrics["leagues"], key=lambda item: (0 if item == "NHL" else priorities.get(item, 9), labels.get(item, item)))
    leagues: dict[str, Any] = {}
    for organization_index, organization in enumerate(organizations):
        source_teams = ratings["teams"].get(organization, {})
        if organization == "CHL":
            source_teams = projected_field(CHL_2026_TEAMS, organization)
            names = sorted(source_teams)
        elif organization == "AHL":
            source_teams = projected_field(AHL_2026_TEAMS, organization)
            names = sorted(source_teams)
        else:
            names = active_team_names(organization, source_teams)
        if organization == "SHL":
            source_teams = dict(source_teams)
            source_teams.pop("Leksands IF", None)
            allsvenskan = ratings["teams"].get("HockeyAllsvenskan", {}).get("IF Björklöven", {})
            source_teams["Björklöven"] = {
                "date": TODAY.isoformat(),
                "combined_elo": allsvenskan.get("combined_elo", 1000.0),
                "league_elo": 1000.0,
                "roster_players": 0,
                "roster_matched": 0,
                "roster_source": "2026–27 promoted club; transferable rating",
            }
            names = sorted(name for name in names if name != "Leksands IF") + ["Björklöven"]
            names = sorted(set(names))
        if organization == "PWHL":
            for expansion in PWHL_EXPANSION:
                if expansion not in source_teams:
                    source_teams[expansion] = {
                        "date": TODAY.isoformat(), "combined_elo": 1000.0, "league_elo": 1000.0,
                        "roster_players": 0, "roster_matched": 0, "roster_source": "2026–27 expansion baseline",
                    }
                names.append(expansion)
            names = sorted(set(names))

        teams: list[dict[str, Any]] = []
        roster_rows: list[dict[str, Any]] = []
        for name in names:
            value = source_teams[name]
            team = {"name": name, **value}
            team["combined_elo"] = round(float(team["combined_elo"]), 3)
            team["league_elo"] = round(float(team["league_elo"]), 3)
            teams.append(team)
            if organization == "NHL" and name in nhl_rosters:
                current_players = nhl_rosters[name]
            elif organization == "SHL" and name == "Björklöven":
                current_players = [
                    {**player, "league_elo": 1000.0}
                    for player in players_by_team.get(("HockeyAllsvenskan", "IF Björklöven"), [])
                ]
            else:
                current_players = sorted(
                    players_by_team.get((organization, name), []),
                    key=lambda player: -player["combined_elo"],
                )
            for player in current_players:
                roster_rows.append({"team": name, **player})

        teams.sort(key=lambda item: (-item["combined_elo"], item["name"]))
        games_per_team, playoff_teams, best_of, schedule_basis = FORMAT.get(
            organization, (48, 8, 7, "Balanced schedule projection")
        )
        simulations = {}
        for strategy_index, strategy in enumerate(("combined", "league")):
            simulations[strategy] = simulate(
                teams, strategy, args.runs, games_per_team, playoff_teams, best_of,
                nhl_schedule if organization == "NHL" else None,
                seed=26_270_000 + organization_index * 10 + strategy_index,
            )
        coverage = metrics["coverage"][organization]
        leagues[organization] = {
            "name": labels.get(organization, organization),
            "country": next((item.get("country", "International") for item in league_config if item["organization"] == organization), "International"),
            "season": SEASON,
            "scheduleBasis": schedule_basis,
            "sourceLastGame": coverage["last_date"],
            "coverage": coverage,
            "metrics": metrics["leagues"][organization],
            "teams": teams,
            "players": roster_rows,
            "simulations": simulations,
        }

    payload = {
        "meta": {
            "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "asOf": TODAY.isoformat(), "season": SEASON, "runsPerModel": args.runs,
            "organizations": len(leagues), "historicalGames": metrics["games"],
            "nhlScheduleGames": len(nhl_schedule), "nhlRosterTeams": len(nhl_rosters),
            "method": "Sequential player/team Elo with deterministic Monte Carlo season and playoff simulation",
        },
        "model": metrics["model"],
        "overall": metrics["overall"],
        "identityBridge": metrics["identity_bridge"],
        "leagueOrder": organizations,
        "leagues": leagues,
        "sources": [
            {"label": "NHL 2026–27 schedule", "url": "https://www.nhl.com/news/nhl-releases-2026-27-regular-season-schedule"},
            {"label": "Official NHL current rosters", "url": "https://api-web.nhle.com/v1/roster/CAR/current"},
            {"label": "SHL 2026–27 schedule", "url": "https://www.shl.se/article/8swateo-403dd/stats"},
            {"label": "PWHL 2026 expansion format", "url": "https://www.thepwhl.com/en/news/2026/may/27/pwhl-announces-2026-expansion-player-distribution-process"},
            {"label": "CHL 2026–27 qualified clubs", "url": "https://www.chl.hockey/en/news/who-s-qualified-for-2026-27"},
            {"label": "AHL 2026–27 schedule and teams", "url": "https://theahl.com/news/ahl-unveils-2026-27-schedule"},
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {args.output} ({args.output.stat().st_size:,} bytes; {len(leagues)} leagues)")


if __name__ == "__main__":
    main()

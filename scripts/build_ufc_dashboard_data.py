#!/usr/bin/env python3
"""Build the static UFC dashboard payload from generated Elo project files."""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_SOURCE = Path("/Users/richie/Documents/git_hub/elo_project/ufc")
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "ufc-dashboard.json"
SIGNAL_FIELDS = [
    ("Base logistic", "base_logistic_score"),
    ("Style matchup", "style_matchup_score"),
    ("Recent form (3)", "moving_avg_3_score"),
    ("Recent form (5)", "moving_avg_5_score"),
    ("Recent form (7)", "moving_avg_7_score"),
    ("Recent form (10)", "moving_avg_10_score"),
    ("Gradient boost", "gradient_boost_score"),
    ("Neural network", "multi_layer_perceptron_score"),
]


def number(value, default=None):
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError):
        return default


def rounded(value, digits=2):
    parsed = number(value)
    return round(parsed, digits) if parsed is not None else None


def is_win_type_finish(win_type):
    text = (win_type or "").strip().lower()
    return bool(text) and not text.startswith("decision") and text not in {"draw", "no contest"}


def normalize_weight_class(value):
    text = (value or "").strip() or "Unknown"
    if text.startswith("UFC Interim "):
        text = text.removeprefix("UFC Interim ")
    elif text.startswith("UFC "):
        text = text.removeprefix("UFC ")
    if text.endswith(" Title"):
        text = text.removesuffix(" Title")
    return text


def result_for(fighter, opponent, winner):
    if winner == fighter:
        return "W"
    if winner == opponent:
        return "L"
    return "D"


def derive_streak(results):
    if not results:
        return "-"
    latest = results[-1]
    if latest == "D":
        return "D1"
    count = 0
    for result in reversed(results):
        if result != latest:
            break
        count += 1
    return f"{latest}{count}"


def latest_rating_entry(fighter, histories):
    entries = sorted(histories[fighter], key=lambda item: item[0])
    histories[fighter] = entries
    return entries[-1]


def build_fighters(source):
    fight_path = source / "advanced_stats" / "ensemble" / "ufc_data_with_elo.csv"
    cumulative_path = source / "advanced_stats" / "ensemble" / "cumulative_style.csv"

    histories = defaultdict(list)
    records = defaultdict(lambda: {"wins": 0, "losses": 0, "draws": 0, "finishes": 0})
    results = defaultdict(list)
    weight_classes = {}
    latest_dates = {}

    with fight_path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            date = row.get("date", "")
            fighter_one = row.get("fighter_one", "").strip()
            fighter_two = row.get("fighter_two", "").strip()
            if not date or not fighter_one or not fighter_two:
                continue

            winner = row.get("winner", "").strip()
            win_type = row.get("win_type", "").strip()
            weight_class = normalize_weight_class(row.get("weightclass"))
            pair = [
                (fighter_one, fighter_two, row.get("elo_fighter_one_after")),
                (fighter_two, fighter_one, row.get("elo_fighter_two_after")),
            ]

            for fighter, opponent, rating in pair:
                rating_value = number(rating)
                if rating_value is None:
                    continue
                histories[fighter].append((date, rating_value))
                result = result_for(fighter, opponent, winner)
                results[fighter].append((date, result))
                if result == "W":
                    records[fighter]["wins"] += 1
                    if is_win_type_finish(win_type):
                        records[fighter]["finishes"] += 1
                elif result == "L":
                    records[fighter]["losses"] += 1
                else:
                    records[fighter]["draws"] += 1

                if date >= latest_dates.get(fighter, ""):
                    latest_dates[fighter] = date
                    weight_classes[fighter] = weight_class

    latest_stats = {}
    with cumulative_path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            fighter = row.get("fighter", "").strip()
            date = row.get("date", "")
            if not fighter or not date:
                continue
            if date >= latest_stats.get(fighter, {}).get("date", ""):
                latest_stats[fighter] = row

    fighters = []
    all_dates = []
    for fighter in sorted(histories):
        latest_date, current_rating = latest_rating_entry(fighter, histories)
        all_dates.append(latest_date)
        history = histories[fighter]
        peak_date, peak_rating = max(history, key=lambda item: item[1])
        ordered_results = [result for _, result in sorted(results[fighter], key=lambda item: item[0])]
        record = records[fighter]
        fights = record["wins"] + record["losses"] + record["draws"]
        decided = record["wins"] + record["losses"]
        win_pct = record["wins"] / decided * 100 if decided else 0
        finish_pct = record["finishes"] / record["wins"] * 100 if record["wins"] else 0
        trend_base = history[-4][1] if len(history) >= 4 else history[0][1]
        stats = latest_stats.get(fighter, {})

        strikes_landed = number(stats.get("significant_strikes_landed_per_sec"), 0)
        strikes_attempted = number(stats.get("significant_strikes_attempted_per_sec"), 0)
        takedowns_landed = number(stats.get("takedown_landed_per_sec"), 0)
        takedowns_attempted = number(stats.get("takedown_attempted_per_sec"), 0)
        control = number(stats.get("control_per_sec"), 0)
        absorbed = number(stats.get("opponent_significant_strikes_landed_per_sec"), 0)
        age_days = number(stats.get("fighter_age"))

        fighters.append(
            {
                "name": fighter,
                "weightClass": weight_classes.get(fighter, "Unknown"),
                "currentRating": round(current_rating, 2),
                "peakRating": round(peak_rating, 2),
                "peakDate": peak_date,
                "lastFight": latest_date,
                "fights": fights,
                "wins": record["wins"],
                "losses": record["losses"],
                "draws": record["draws"],
                "winPct": round(win_pct, 1),
                "finishPct": round(finish_pct, 1),
                "streak": derive_streak(ordered_results),
                "form": "".join(ordered_results[-5:]),
                "ratingTrend": round(current_rating - trend_base, 2),
                "style": (stats.get("style") or "Unclassified").replace("_", " "),
                "ageAtLastFight": round(age_days / 365.25, 1) if age_days else None,
                "strikesLandedPerMin": round(strikes_landed * 60, 2),
                "strikesAbsorbedPerMin": round(absorbed * 60, 2),
                "strikingAccuracy": round(strikes_landed / strikes_attempted * 100, 1)
                if strikes_attempted
                else None,
                "takedownsPer15": round(takedowns_landed * 900, 2),
                "takedownAccuracy": round(takedowns_landed / takedowns_attempted * 100, 1)
                if takedowns_attempted
                else None,
                "submissionAttemptsPer15": round(
                    number(stats.get("submission_attempt_per_sec"), 0) * 900, 2
                ),
                "controlPct": round(control * 100, 1),
                "history": [[date, round(rating, 2)] for date, rating in history],
            }
        )

    return fighters, max(all_dates) if all_dates else None


def build_cards(source):
    prediction_path = source / "advanced_stats" / "ensemble" / "gradient_predictions.csv"
    grouped = defaultdict(list)
    with prediction_path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            fighter = row.get("fighter", "").strip()
            opponent = row.get("opponent", "").strip()
            date = row.get("date", "")
            if fighter and opponent and date:
                grouped[(date, *sorted([fighter, opponent]))].append(row)

    cards = defaultdict(lambda: {"predicted": [], "insufficient": []})
    for (date, fighter_one, fighter_two), rows in sorted(grouped.items()):
        by_name = {row["fighter"]: row for row in rows}
        row_one = by_name.get(fighter_one, {})
        row_two = by_name.get(fighter_two, {})
        score_one = number(row_one.get("final_prediction_score"))
        score_two = number(row_two.get("final_prediction_score"))

        if score_one is None and score_two is None:
            cards[date]["insufficient"].append(
                {
                    "fighterOne": fighter_one,
                    "fighterTwo": fighter_two,
                    "reason": "Not enough UFC fight history for a scenario prediction.",
                }
            )
            continue

        if score_one is None:
            score_one = 1 - score_two
        if score_two is None:
            score_two = 1 - score_one
        # Reconcile the two directional model scores into one complementary pair.
        probability_one = (score_one + (1 - score_two)) / 2
        probability_one = min(1, max(0, probability_one))
        probability_two = 1 - probability_one
        favorite = fighter_one if probability_one >= probability_two else fighter_two
        favorite_row = row_one if favorite == fighter_one else row_two
        favorite_probability = max(probability_one, probability_two)

        signals = []
        agreement = 0
        available = 0
        for label, field in SIGNAL_FIELDS:
            value = number(favorite_row.get(field))
            signals.append({"label": label, "value": round(value, 4) if value is not None else None})
            if value is not None:
                available += 1
                if value >= 0.5:
                    agreement += 1

        cards[date]["predicted"].append(
            {
                "fighterOne": fighter_one,
                "fighterTwo": fighter_two,
                "probabilityOne": round(probability_one, 4),
                "probabilityTwo": round(probability_two, 4),
                "favorite": favorite,
                "favoriteProbability": round(favorite_probability, 4),
                "probabilityGap": round(abs(probability_one - probability_two) * 100, 1),
                "agreement": agreement,
                "availableSignals": available,
                "signals": signals,
            }
        )

    output = []
    for date in sorted(cards):
        cards[date]["predicted"].sort(key=lambda fight: fight["probabilityGap"], reverse=True)
        cards[date]["insufficient"].sort(key=lambda fight: fight["fighterOne"])
        output.append(
            {
                "date": date,
                "predicted": cards[date]["predicted"],
                "insufficient": cards[date]["insufficient"],
            }
        )
    return output, datetime.fromtimestamp(prediction_path.stat().st_mtime, timezone.utc).isoformat()


def build_elo_bins(source):
    path = source / "elo_predictive_statistics.csv"
    bins = []
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            bins.append(
                {
                    "range": row.get("elo_diff_bin"),
                    "fights": int(number(row.get("count"), 0)),
                    "winPct": rounded(row.get("win_percentage"), 1),
                    "lower": rounded(row.get("ci_lower"), 1),
                    "upper": rounded(row.get("ci_upper"), 1),
                }
            )
    return bins


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    fighters, latest_fight = build_fighters(args.source)
    cards, generated_at = build_cards(args.source)
    predicted_count = sum(len(card["predicted"]) for card in cards)
    insufficient_count = sum(len(card["insufficient"]) for card in cards)

    payload = {
        "meta": {
            "generatedAt": generated_at,
            "latestFightDate": latest_fight,
            "fighterCount": len(fighters),
            "cardCount": len(cards),
            "predictedFightCount": predicted_count,
            "insufficientFightCount": insufficient_count,
            "source": "Generated UFC Elo and advanced ensemble outputs",
        },
        "fighters": fighters,
        "cards": cards,
        "eloBins": build_elo_bins(args.source),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"), ensure_ascii=True)
    print(
        f"Wrote {args.output} with {len(fighters)} fighters, "
        f"{predicted_count} predictions, and {insufficient_count} insufficient-data fights."
    )


if __name__ == "__main__":
    main()

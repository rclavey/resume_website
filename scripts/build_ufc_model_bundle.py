#!/usr/bin/env python3
"""Export the trained UFC ensemble and current fighter features for browser inference."""

from __future__ import annotations

import argparse
import json
import math
import pickle
import re
import sys
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import statsmodels.api as sm
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import OneHotEncoder

DEFAULT_SOURCE = Path("/Users/richie/Documents/git_hub/elo_project/ufc")
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "ufc-model.json"
ENSEMBLE_DIR = Path("advanced_stats/ensemble")
LOOKBACKS = (3, 5, 7, 10)
PERFORMANCE_METRICS = (
    "knockdowns_per_sec",
    "significant_strikes_landed_per_sec",
    "significant_strikes_attempted_per_sec",
    "takedown_attempted_per_sec",
    "takedown_landed_per_sec",
    "strike_landed_to_head_per_sec",
    "strike_landed_to_body_per_sec",
    "strike_landed_to_leg_per_sec",
    "submission_attempt_per_sec",
    "control_per_sec",
    "knocked_down_per_sec",
    "opponent_significant_strikes_landed_per_sec",
    "opponent_significant_strikes_attempted_per_sec",
    "opponent_takedown_attempted_per_sec",
    "opponent_takedown_landed_per_sec",
    "opponent_strike_landed_to_head_per_sec",
    "opponent_strike_landed_to_body_per_sec",
    "opponent_strike_landed_to_leg_per_sec",
    "opponent_submission_attempt_per_sec",
    "opponent_control_per_sec",
)


def finite(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def rounded(value, digits=10):
    number = finite(value)
    return round(number, digits) if number is not None else None


def remove_multicollinearity(frame, threshold=10.0):
    from statsmodels.stats.outliers_influence import variance_inflation_factor

    columns = list(frame.columns)
    while True:
        vif = pd.DataFrame({
            "feature": columns,
            "vif": [variance_inflation_factor(frame[columns].values, i) for i in range(len(columns))],
        })
        maximum = vif["vif"].max()
        if maximum <= threshold:
            return frame[columns], columns
        feature = vif.loc[vif["vif"].idxmax(), "feature"]
        if feature == "const":
            return frame[columns], columns
        columns.remove(feature)


def serialize_tree(tree):
    data = tree.tree_
    return {
        "l": data.children_left.tolist(),
        "r": data.children_right.tolist(),
        "f": data.feature.tolist(),
        "t": [rounded(value, 12) for value in data.threshold],
        "v": [rounded(value[0][0], 12) for value in data.value],
    }


def serialize_gradient_model(model, columns):
    prior = float(model.init_.class_prior_[1])
    return {
        "features": list(columns),
        "initial": math.log(prior / (1 - prior)),
        "learningRate": float(model.learning_rate),
        "trees": [serialize_tree(item[0]) for item in model.estimators_],
    }


def serialize_mlp(model, columns):
    return {
        "features": list(columns),
        "activation": model.activation,
        "outputActivation": model.out_activation_,
        "weights": [[[rounded(value, 12) for value in row] for row in matrix] for matrix in model.coefs_],
        "biases": [[rounded(value, 12) for value in vector] for vector in model.intercepts_],
    }


def parse_logit_coefficients(path):
    pattern = re.compile(r"^([A-Za-z0-9_]+)\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)", re.I)
    coefficients = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = pattern.match(line.strip())
        if match:
            coefficients[match.group(1)] = float(match.group(2))
    return coefficients


def parse_basic_metrics(path):
    text = path.read_text(encoding="utf-8")
    auc = re.search(r"^AUC:\s*([0-9.]+)", text, re.M)
    accuracy = re.search(r"^Accuracy:\s*([0-9.]+)", text, re.M)
    observations = re.search(r"No\. Observations:\s*(\d+)", text)
    return {
        "auc": rounded(auc.group(1), 4) if auc else None,
        "accuracy": rounded(accuracy.group(1), 4) if accuracy else None,
        "observations": int(observations.group(1)) if observations else None,
    }


def parse_scenario_metrics(path):
    text = path.read_text(encoding="utf-8")
    auc = re.search(r"AUC \(test\):\s*([0-9.]+)", text)
    accuracy = re.search(r"Accuracy \(test\):\s*([0-9.]+)", text)
    size = re.search(r"Test set size:\s*(\d+)", text)
    importance_block = text.split("Feature Importances:", 1)[-1]
    importances = {}
    for line in importance_block.splitlines():
        if ":" not in line:
            continue
        name, value = line.rsplit(":", 1)
        number = finite(value.strip())
        if number is not None:
            importances[name.strip()] = round(number, 5)
    return {
        "auc": rounded(auc.group(1), 4) if auc else None,
        "accuracy": rounded(accuracy.group(1), 4) if accuracy else None,
        "testSize": int(size.group(1)) if size else None,
        "importances": importances,
    }


def build_training_rows(frame, groups, numeric_columns):
    eligible = set(frame["fighter"].value_counts()[lambda values: values >= 3].index)
    rows = []
    for row in frame.itertuples(index=False):
        if row.fighter not in eligible or row.opponent not in eligible or row.opponent not in groups:
            continue
        fighter_previous = groups[row.fighter][groups[row.fighter]["date"] < row.date]
        opponent_previous = groups[row.opponent][groups[row.opponent]["date"] < row.date]
        if fighter_previous.empty or opponent_previous.empty:
            continue
        fighter_stats = fighter_previous.iloc[-1]
        opponent_stats = opponent_previous.iloc[-1]
        values = {f"{column}_difference": fighter_stats[column] - opponent_stats[column] for column in numeric_columns}
        values.update({
            "fighter_elo_before": row.fighter_elo_before,
            "opponent_elo_before": row.opponent_elo_before,
            "stance_combo": f"{row.fighter_stance}_{row.opponent_stance}",
            "winner": 1 if row.winner else 0,
        })
        rows.append(values)
    return rows


def prepare_component_training(frame, groups, numeric_columns):
    model_data = pd.DataFrame(build_training_rows(frame, groups, numeric_columns))
    difference_columns = [column for column in model_data if column.endswith("_difference")]
    model_data.dropna(subset=difference_columns, inplace=True)
    encoder = OneHotEncoder(drop="first", sparse_output=False, handle_unknown="ignore")
    encoded = encoder.fit_transform(model_data[["stance_combo"]])
    stance_columns = encoder.get_feature_names_out(["stance_combo"])
    encoded_frame = pd.DataFrame(encoded, columns=stance_columns, index=model_data.index)
    model_data = pd.concat([model_data.drop(columns=["stance_combo"]), encoded_frame], axis=1)
    feature_columns = [
        column for column in model_data
        if column.endswith("_difference") or column.startswith("stance_combo_")
        or column in ("fighter_elo_before", "opponent_elo_before")
    ]
    return model_data, feature_columns, list(stance_columns)


def train_gradient_component(model_data, feature_columns):
    features = model_data[feature_columns].apply(pd.to_numeric)
    labels = pd.to_numeric(model_data["winner"])
    train_x, _, train_y, _ = train_test_split(features, labels, test_size=0.3, random_state=42)
    model = GradientBoostingClassifier(n_estimators=100, learning_rate=0.1, max_depth=3, random_state=42)
    model.fit(train_x.values, train_y.values)
    return model


def train_base_logistic(model_data, feature_columns, future_rows):
    if future_rows:
        extra = pd.DataFrame(future_rows)
        for column in feature_columns:
            if column.startswith("stance_combo_"):
                extra[column] = (extra["stance_combo"] == column.removeprefix("stance_combo_")).astype(float)
        extra.drop(columns=["stance_combo"], inplace=True)
        for column in model_data.columns:
            if column not in extra:
                extra[column] = 0
        model_data = pd.concat([model_data, extra[model_data.columns]], ignore_index=True)

    features = model_data[feature_columns].apply(pd.to_numeric)
    labels = pd.to_numeric(model_data["winner"])
    train_x, _, train_y, _ = train_test_split(features, labels, test_size=0.3, random_state=42)
    zero_variance = [column for column in train_x if train_x[column].nunique() <= 1]
    train_x.drop(columns=zero_variance, inplace=True)
    reduced, final_columns = remove_multicollinearity(sm.add_constant(train_x).astype(float), threshold=10.0)
    result = sm.Logit(train_y.astype(float), reduced).fit(disp=False)
    return {"features": final_columns, "coefficients": [float(result.params[column]) for column in final_columns]}


def build_future_rows(predictions, historical_keys, latest, numeric_columns):
    rows = []
    for row in predictions.itertuples(index=False):
        if (row.fighter, row.date, row.opponent) in historical_keys:
            continue
        if row.fighter not in latest or row.opponent not in latest:
            continue
        fighter = latest[row.fighter]
        opponent = latest[row.opponent]
        values = {f"{column}_difference": fighter[column] - opponent[column] for column in numeric_columns}
        values.update({
            "fighter_elo_before": fighter["fighter_elo_after"],
            "opponent_elo_before": opponent["fighter_elo_after"],
            "stance_combo": f"{fighter['fighter_stance']}_{opponent['fighter_stance']}",
            "winner": 0,
        })
        rows.append(values)
    return rows


def fighter_feature_rows(groups, styles, numeric_columns):
    output = {}
    for fighter, history in groups.items():
        current = history.iloc[-1]
        raw = [rounded(current[column]) for column in numeric_columns]
        if any(value is None for value in raw):
            continue
        item = {
            "r": raw,
            "e": rounded(current["fighter_elo_after"]),
            "s": str(current.get("fighter_stance") or "Missing Stance"),
            "os": str(current.get("opponent_stance") or "Missing Stance"),
            "c": int(len(history)),
            "style": styles.get(fighter),
        }
        for lookback in LOOKBACKS:
            if len(history) < lookback + 1:
                continue
            previous = history.iloc[-(lookback + 1)]
            delta = [rounded(current[metric] - previous[metric]) for metric in PERFORMANCE_METRICS]
            if all(value is not None for value in delta):
                item[f"d{lookback}"] = delta
        output[fighter] = item
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    ensemble = args.source / ENSEMBLE_DIR
    sys.path.insert(0, str(ensemble))
    warnings.filterwarnings("ignore")

    frame = pd.read_csv(ensemble / "cumulative.csv")
    frame["date"] = pd.to_datetime(frame["date"])
    frame.sort_values(["fighter", "date"], inplace=True)
    frame.reset_index(drop=True, inplace=True)
    groups = {name: group.reset_index(drop=True) for name, group in frame.groupby("fighter", sort=False)}
    latest = {name: group.iloc[-1] for name, group in groups.items()}

    excluded_after = [column for column in frame if "elo_after" in column or column == "time_in_fight"]
    excluded = set([
        "fighter", "date", "opponent", "winner", "win_type", "fighter_stance",
        "opponent_stance", "matching_stance", *excluded_after,
    ])
    numeric_columns = [
        column for column in frame if column not in excluded
        and frame[column].dtype in (np.float64, np.float32, np.int64, np.int32)
    ]

    style_frame = pd.read_csv(ensemble / "cumulative_style.csv")
    styles = {}
    for row in style_frame.itertuples(index=False):
        if row.fighter not in styles and pd.notna(row.style):
            styles[row.fighter] = row.style
    for row in style_frame.itertuples(index=False):
        if row.opponent not in styles and pd.notna(row.opponent_style):
            styles[row.opponent] = row.opponent_style

    model_data, component_features, stance_columns = prepare_component_training(frame, groups, numeric_columns)
    gradient_component = train_gradient_component(model_data, component_features)

    predictions = pd.read_csv(ensemble / "predictions_data.csv", dtype={"date": str})
    historical_keys = set(zip(frame["fighter"], frame["date"].dt.strftime("%Y-%m-%d"), frame["opponent"]))
    future_rows = build_future_rows(predictions, historical_keys, latest, numeric_columns)
    base_logistic = train_base_logistic(model_data.copy(), component_features, future_rows)

    mlp, _, mlp_features, _ = joblib.load(ensemble / "models/multi_layer_perceptron_model_test.pkl")
    final_models = {}
    for scenario in ("3to5", "5to7", "7to10", "over10"):
        with (ensemble / f"models/gradient_master_{scenario}.pkl").open("rb") as handle:
            model, columns = pickle.load(handle)
        final_models[scenario] = serialize_gradient_model(model, columns)

    model_metrics = {
        "base_logistic_score": parse_basic_metrics(ensemble / "model_data/base_logistic.txt"),
        "style_matchup_score": parse_basic_metrics(ensemble / "model_data/style_matchup_logistic.txt"),
        "gradient_boost_score": parse_basic_metrics(ensemble / "model_data/gradient_boosting.txt"),
        "multi_layer_perceptron_score": parse_basic_metrics(ensemble / "model_data/multi_layer_perceptron_test.txt"),
    }
    for lookback in LOOKBACKS:
        model_metrics[f"moving_avg_{lookback}_score"] = parse_basic_metrics(ensemble / f"model_data/moving_avg_{lookback}.txt")

    scenario_metrics = {
        scenario: parse_scenario_metrics(ensemble / f"model_data/gradient_master_{scenario}.txt")
        for scenario in ("3to5", "5to7", "7to10", "over10")
    }

    payload = {
        "meta": {
            "source": "Trained UFC ensemble model artifacts and cumulative fighter features",
            "fighterCount": len(groups),
            "componentCount": 8,
            "scenarioCount": 4,
        },
        "features": {
            "numeric": numeric_columns,
            "performance": list(PERFORMANCE_METRICS),
            "stance": stance_columns,
        },
        "fighters": fighter_feature_rows(groups, styles, numeric_columns),
        "models": {
            "base": base_logistic,
            "style": {"coefficients": parse_logit_coefficients(ensemble / "model_data/style_matchup_logistic.txt")},
            "moving": {
                str(lookback): {"coefficients": parse_logit_coefficients(ensemble / f"model_data/moving_avg_{lookback}.txt")}
                for lookback in LOOKBACKS
            },
            "gradient": serialize_gradient_model(gradient_component, component_features),
            "mlp": serialize_mlp(mlp, mlp_features),
            "ensemble": final_models,
        },
        "metrics": model_metrics,
        "scenarios": scenario_metrics,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(f"Wrote {args.output} with {len(payload['fighters']):,} fighter feature rows.")


if __name__ == "__main__":
    main()

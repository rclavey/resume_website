(function exposeUfcModel(global) {
    'use strict';

    const SCORE_KEYS = [
        'cross_promotion_score',
        'ensemble_score',
        'elo_score',
        'base_logistic_score',
        'style_matchup_score',
        'moving_avg_3_score',
        'moving_avg_5_score',
        'moving_avg_7_score',
        'moving_avg_10_score',
        'gradient_boost_score',
        'multi_layer_perceptron_score'
    ];

    const SCORE_LABELS = {
        cross_promotion_score: 'Universal MMA model',
        ensemble_score: 'Final ensemble',
        elo_score: 'Elo baseline',
        base_logistic_score: 'Base logistic',
        style_matchup_score: 'Style matchup',
        moving_avg_3_score: '3-fight window',
        moving_avg_5_score: '5-fight window',
        moving_avg_7_score: '7-fight window',
        moving_avg_10_score: '10-fight window',
        gradient_boost_score: 'Gradient boost',
        multi_layer_perceptron_score: 'Neural network'
    };

    function sigmoid(value) {
        return 1 / (1 + Math.exp(-Math.max(-700, Math.min(700, value))));
    }

    function activate(value, name) {
        if (name === 'identity') return value;
        if (name === 'tanh') return Math.tanh(value);
        if (name === 'logistic') return sigmoid(value);
        if (name === 'relu') return Math.max(0, value);
        return value;
    }

    function validProbability(value) {
        return Number.isFinite(value) && value >= 0 && value <= 1;
    }

    class UfcModelEngine {
        constructor(bundle, fighterMap = new Map()) {
            this.bundle = bundle;
            this.fighterMap = fighterMap;
            this.numericIndexes = new Map(bundle.features.numeric.map((name, index) => [name, index]));
            this.performanceIndexes = new Map(bundle.features.performance.map((name, index) => [name, index]));
        }

        fighter(name) {
            return this.bundle.fighters[name] || null;
        }

        rawDifference(fighter, opponent, featureName) {
            const baseName = featureName.replace(/_difference$/, '');
            const index = this.numericIndexes.get(baseName);
            if (index === undefined) return null;
            const fighterValue = fighter.r[index];
            const opponentValue = opponent.r[index];
            return Number.isFinite(fighterValue) && Number.isFinite(opponentValue)
                ? fighterValue - opponentValue
                : null;
        }

        componentFeature(featureName, fighter, opponent, stanceOpponentField = 'os') {
            if (featureName === 'const') return 1;
            if (featureName === 'fighter_elo_before') return fighter.e;
            if (featureName === 'opponent_elo_before') return opponent.e;
            if (featureName.startsWith('stance_combo_')) {
                return featureName === `stance_combo_${fighter.s}_${opponent[stanceOpponentField]}` ? 1 : 0;
            }
            if (featureName.endsWith('_difference')) {
                return this.rawDifference(fighter, opponent, featureName);
            }
            return null;
        }

        logistic(features, coefficients, valueForFeature) {
            let total = 0;
            for (let index = 0; index < features.length; index += 1) {
                const value = valueForFeature(features[index]);
                if (!Number.isFinite(value)) return null;
                total += value * coefficients[index];
            }
            return sigmoid(total);
        }

        baseScore(fighter, opponent) {
            const model = this.bundle.models.base;
            return this.logistic(
                model.features,
                model.coefficients,
                feature => this.componentFeature(feature, fighter, opponent, 's')
            );
        }

        styleScore(fighter, opponent) {
            if (!fighter.style || !opponent.style) return null;
            const coefficients = this.bundle.models.style.coefficients;
            const interaction = `style_interaction_${fighter.style}_${opponent.style}`;
            let linear = coefficients.const || 0;
            if (coefficients[interaction]) linear += coefficients[interaction];
            return sigmoid(linear);
        }

        movingScore(lookback, fighter, opponent) {
            const model = this.bundle.models.moving[String(lookback)];
            const fighterDelta = fighter[`d${lookback}`];
            const opponentDelta = opponent[`d${lookback}`];
            if (!model || !fighterDelta || !opponentDelta) return null;
            let linear = model.coefficients.const || 0;
            for (const [feature, coefficient] of Object.entries(model.coefficients)) {
                if (feature === 'const') continue;
                const match = feature.match(/^moving_avg_(\d+)_(.+)_diff$/);
                if (!match) continue;
                const featureLookback = Number(match[1]);
                const metricIndex = this.performanceIndexes.get(match[2]);
                const fighterValues = fighter[`d${featureLookback}`];
                const opponentValues = opponent[`d${featureLookback}`];
                if (!fighterValues || !opponentValues || metricIndex === undefined) return null;
                const value = fighterValues[metricIndex] - opponentValues[metricIndex];
                if (!Number.isFinite(value)) return null;
                linear += coefficient * value;
            }
            return sigmoid(linear);
        }

        treeValue(tree, values) {
            let node = 0;
            while (tree.l[node] !== -1) {
                const featureValue = values[tree.f[node]];
                if (!Number.isFinite(featureValue)) return null;
                node = featureValue <= tree.t[node] ? tree.l[node] : tree.r[node];
            }
            return tree.v[node];
        }

        gradientProbability(model, values) {
            if (!model || values.some(value => !Number.isFinite(value))) return null;
            let raw = model.initial;
            for (const tree of model.trees) {
                const value = this.treeValue(tree, values);
                if (!Number.isFinite(value)) return null;
                raw += model.learningRate * value;
            }
            return sigmoid(raw);
        }

        inactivityDays(lastFight, fightDate) {
            if (!lastFight) return 180;
            const latest = new Date(`${lastFight}T00:00:00`);
            const event = new Date(`${fightDate}T00:00:00`);
            if (Number.isNaN(latest.getTime()) || Number.isNaN(event.getTime())) return 180;
            return Math.min(1825, Math.max(0, Math.round((event - latest) / 86400000)));
        }

        universalFeatureVector(fighter, opponent, organizer, fightDate) {
            const model = this.bundle.universal;
            if (!model || !fighter || !opponent) return null;
            const fightsOne = Number(fighter.fights || 0);
            const fightsTwo = Number(opponent.fights || 0);
            const inactiveOne = this.inactivityDays(fighter.lastFight, fightDate);
            const inactiveTwo = this.inactivityDays(opponent.lastFight, fightDate);
            const eloDifference = Number(fighter.currentRating) - Number(opponent.currentRating);
            const eloProbability = 1 / (1 + (10 ** (-eloDifference / 400)));
            const row = {
                elo_difference: eloDifference,
                elo_probability_fighter_one: eloProbability,
                fighter_one_fights_before: fightsOne,
                fighter_two_fights_before: fightsTwo,
                experience_difference: fightsOne - fightsTwo,
                log_experience_difference: Math.log1p(fightsOne) - Math.log1p(fightsTwo),
                recent_win_rate_difference: Number(fighter.recentWinRate ?? 0.5) - Number(opponent.recentWinRate ?? 0.5),
                fighter_one_days_inactive: inactiveOne,
                fighter_two_days_inactive: inactiveTwo,
                inactivity_difference: inactiveOne - inactiveTwo,
                organizer,
                fighter_one_first_organizer: fighter.firstOrganizer || organizer,
                fighter_two_first_organizer: opponent.firstOrganizer || organizer
            };
            const values = model.numericFeatures.map((feature, index) => (
                (Number(row[feature]) - model.numericMean[index]) / model.numericScale[index]
            ));
            model.categoricalFeatures.forEach((feature, index) => {
                model.categories[index].forEach(category => {
                    values.push(row[feature] === category ? 1 : 0);
                });
            });
            return values;
        }

        universalDirectionalScore(fighterName, opponentName, organizer, fightDate) {
            const fighter = this.fighterMap.get(fighterName);
            const opponent = this.fighterMap.get(opponentName);
            const values = this.universalFeatureVector(fighter, opponent, organizer, fightDate);
            return values ? this.gradientProbability(this.bundle.universal.model, values) : null;
        }

        gradientScore(fighter, opponent) {
            const model = this.bundle.models.gradient;
            const values = model.features.map(feature => this.componentFeature(feature, fighter, opponent, 'os'));
            return this.gradientProbability(model, values);
        }

        mlpScore(fighter, opponent) {
            const model = this.bundle.models.mlp;
            let layer = model.features.map(feature => this.componentFeature(feature, fighter, opponent, 'os'));
            if (layer.some(value => !Number.isFinite(value))) return null;
            for (let level = 0; level < model.weights.length; level += 1) {
                const weights = model.weights[level];
                const biases = model.biases[level];
                const next = biases.map((bias, outputIndex) => {
                    let value = bias;
                    for (let inputIndex = 0; inputIndex < layer.length; inputIndex += 1) {
                        value += layer[inputIndex] * weights[inputIndex][outputIndex];
                    }
                    const activation = level === model.weights.length - 1 ? model.outputActivation : model.activation;
                    return activate(value, activation);
                });
                layer = next;
            }
            return layer[0];
        }

        directionalScores(fighterName, opponentName) {
            const fighter = this.fighter(fighterName);
            const opponent = this.fighter(opponentName);
            if (!fighter || !opponent) return null;
            const scores = {
                elo_score: 1 / (1 + (10 ** ((opponent.e - fighter.e) / 400))),
                base_logistic_score: this.baseScore(fighter, opponent),
                style_matchup_score: this.styleScore(fighter, opponent),
                moving_avg_3_score: this.movingScore(3, fighter, opponent),
                moving_avg_5_score: this.movingScore(5, fighter, opponent),
                moving_avg_7_score: this.movingScore(7, fighter, opponent),
                moving_avg_10_score: this.movingScore(10, fighter, opponent),
                gradient_boost_score: this.gradientScore(fighter, opponent),
                multi_layer_perceptron_score: this.mlpScore(fighter, opponent)
            };
            const scenario = scores.moving_avg_10_score !== null ? 'over10'
                : scores.moving_avg_7_score !== null ? '7to10'
                    : scores.moving_avg_5_score !== null ? '5to7'
                        : scores.moving_avg_3_score !== null ? '3to5'
                            : null;
            scores.scenario = scenario;
            scores.ensemble_score = null;
            if (scenario) {
                const model = this.bundle.models.ensemble[scenario];
                const values = model.features.map(feature => scores[feature]);
                scores.ensemble_score = this.gradientProbability(model, values);
            }
            return scores;
        }

        scoreMatchup(fighterName, opponentName, organizer = 'UFC', fightDate = new Date().toISOString().slice(0, 10)) {
            const forward = this.directionalScores(fighterName, opponentName);
            const reverse = this.directionalScores(opponentName, fighterName);
            const fighter = this.fighterMap.get(fighterName);
            const opponent = this.fighterMap.get(opponentName);
            if (!fighter || !opponent) return null;
            const probabilities = {};
            const universalForward = this.universalDirectionalScore(
                fighterName,
                opponentName,
                organizer,
                fightDate
            );
            const universalReverse = this.universalDirectionalScore(
                opponentName,
                fighterName,
                organizer,
                fightDate
            );
            probabilities.cross_promotion_score = validProbability(universalForward) && validProbability(universalReverse)
                ? (universalForward + (1 - universalReverse)) / 2
                : null;
            probabilities.elo_score = 1 / (
                1 + (10 ** ((opponent.currentRating - fighter.currentRating) / 400))
            );
            const advancedAvailable = organizer === 'UFC' && forward && reverse;
            for (const key of SCORE_KEYS.filter(key => !['cross_promotion_score', 'elo_score'].includes(key))) {
                if (!advancedAvailable) {
                    probabilities[key] = null;
                    continue;
                }
                const forwardValue = forward[key];
                const reverseValue = reverse[key];
                probabilities[key] = validProbability(forwardValue) && validProbability(reverseValue)
                    ? (forwardValue + (1 - reverseValue)) / 2
                    : validProbability(forwardValue) ? forwardValue
                        : validProbability(reverseValue) ? 1 - reverseValue
                            : null;
            }
            return {
                fighterOne: fighterName,
                fighterTwo: opponentName,
                scenario: advancedAvailable ? (forward.scenario || reverse.scenario) : null,
                probabilities,
                organizer,
                directional: { forward, reverse, universalForward, universalReverse }
            };
        }
    }

    global.UfcModelEngine = UfcModelEngine;
    global.UFC_SCORE_KEYS = SCORE_KEYS;
    global.UFC_SCORE_LABELS = SCORE_LABELS;
}(window));

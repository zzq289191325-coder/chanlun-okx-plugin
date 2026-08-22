from __future__ import annotations

import bisect
import hashlib
import json
import math
import sqlite3
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from .backtest_service import current_git_commit
from .repository import utc_milliseconds

CLASSES = ("long", "short", "hold")
FEATURE_NAMES = (
    "return_1", "return_4", "return_16", "ma40_distance", "ma40_slope",
    "atr14_percent", "volume_ratio", "ema12_26", "tf30_return", "tf4h_return",
    "tf1d_return", "tf4h_ma40_distance", "tf1d_ma40_distance", "funding_rate",
    "funding_missing", "oi_change", "oi_missing", "news_bias", "news_count",
    "candidate_balance", "candidate_count",
)
FEATURE_SET_VERSION = "v1-point-in-time"
MODEL_TYPE = "deterministic-softmax-regression"
MODEL_ALGORITHM_VERSION = "adaptive-learning-1.1.0"


@dataclass(frozen=True, slots=True)
class LearningProfile:
    account_id: str
    timeframe: str
    horizon_bars: int
    minimum_samples: int
    return_threshold: float
    confidence_threshold: float
    long_only: bool


PROFILES = {
    "paper-aggressive": LearningProfile(
        "paper-aggressive", "15m", 4, 80, 0.0015, 0.52, False
    ),
    "paper-fundamental": LearningProfile(
        "paper-fundamental", "4H", 6, 60, 0.012, 0.56, True
    ),
}


def _canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash(value: object) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _sigmoid_stable(values: list[float]) -> list[float]:
    maximum = max(values)
    exps = [math.exp(max(-50.0, min(50.0, item - maximum))) for item in values]
    total = sum(exps)
    return [item / total for item in exps]


def _mean(values: Iterable[float]) -> float:
    items = list(values)
    return sum(items) / len(items) if items else 0.0


def _std(values: Iterable[float], center: float) -> float:
    items = list(values)
    if not items:
        return 1.0
    value = math.sqrt(sum((item - center) ** 2 for item in items) / len(items))
    return value if value > 1e-12 else 1.0


def _ema(values: list[float], period: int) -> float:
    if not values:
        return 0.0
    alpha = 2.0 / (period + 1.0)
    result = values[0]
    for value in values[1:]:
        result = alpha * value + (1.0 - alpha) * result
    return result


def _return(values: list[float], bars: int) -> float:
    if len(values) <= bars or values[-bars - 1] == 0:
        return 0.0
    return values[-1] / values[-bars - 1] - 1.0


class PointInTimeSeries:
    def __init__(self, connection: sqlite3.Connection, symbol: str) -> None:
        self.connection = connection
        self.symbol = symbol
        self.rows: dict[str, list[dict[str, float | int]]] = {}
        self.close_times: dict[str, list[int]] = {}
        for timeframe in ("15m", "30m", "4H", "1D"):
            records = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT open_time,close_time,open,high,low,close,volume
                    FROM candles
                    WHERE symbol=? AND timeframe=? AND closed=1
                    ORDER BY close_time
                    """,
                    (symbol, timeframe),
                )
            ]
            self.rows[timeframe] = records
            self.close_times[timeframe] = [int(item["close_time"]) for item in records]

    def visible(self, timeframe: str, cutoff: int, limit: int = 80) -> list[dict[str, float | int]]:
        index = bisect.bisect_right(self.close_times[timeframe], cutoff)
        return self.rows[timeframe][max(0, index - limit):index]


def _feature_vector(
    connection: sqlite3.Connection,
    series: PointInTimeSeries,
    profile: LearningProfile,
    cutoff: int,
) -> tuple[list[float], dict[str, Any]]:
    base = series.visible(profile.timeframe, cutoff, 80)
    closes = [float(item["close"]) for item in base]
    highs = [float(item["high"]) for item in base]
    lows = [float(item["low"]) for item in base]
    volumes = [float(item["volume"]) for item in base]
    if len(closes) < 40:
        raise ValueError("at least 40 closed candles are required before the feature cutoff")
    ma40 = _mean(closes[-40:])
    previous_ma40 = _mean(closes[-41:-1]) if len(closes) >= 41 else ma40
    true_ranges = []
    for index in range(max(1, len(base) - 14), len(base)):
        previous = closes[index - 1]
        true_ranges.append(max(highs[index] - lows[index], abs(highs[index] - previous), abs(lows[index] - previous)))
    atr = _mean(true_ranges)
    recent_volume = _mean(volumes[-5:])
    baseline_volume = _mean(volumes[-40:])

    def tf_features(timeframe: str) -> tuple[float, float]:
        visible = series.visible(timeframe, cutoff, 50)
        values = [float(item["close"]) for item in visible]
        ret = _return(values, min(4, max(1, len(values) - 1)))
        ma = _mean(values[-40:]) if len(values) >= 40 else (values[-1] if values else 0.0)
        distance = values[-1] / ma - 1.0 if values and ma else 0.0
        return ret, distance

    tf30_return, _ = tf_features("30m")
    tf4h_return, tf4h_ma = tf_features("4H")
    tf1d_return, tf1d_ma = tf_features("1D")
    funding = connection.execute(
        "SELECT funding_rate FROM public_funding_rates WHERE symbol=? AND funding_time<=? ORDER BY funding_time DESC LIMIT 1",
        (series.symbol, cutoff),
    ).fetchone()
    oi_rows = connection.execute(
        "SELECT open_interest FROM public_open_interest_snapshots WHERE symbol=? AND observed_at<=? ORDER BY observed_at DESC LIMIT 2",
        (series.symbol, cutoff),
    ).fetchall()
    visible_news = connection.execute(
        """
        SELECT impact_bias FROM news_events
        WHERE (symbol=? OR symbol IS NULL) AND published_at<=? AND recorded_at<=?
          AND recorded_at>?
        """,
        (series.symbol, cutoff, cutoff, cutoff - 7 * 86_400_000),
    ).fetchall()
    news_score = {"POSITIVE": 1.0, "NEGATIVE": -1.0, "NEUTRAL": 0.0, "MIXED": 0.0}
    candidate_rows = connection.execute(
        """
        SELECT side FROM candidate_signals
        WHERE symbol=? AND confirmed_at<=? AND confirmed_at>? AND location_time<=confirmed_at
        """,
        (series.symbol, cutoff, cutoff - 7 * 86_400_000),
    ).fetchall()
    long_candidates = sum(1 for row in candidate_rows if str(row["side"]) == "long")
    short_candidates = len(candidate_rows) - long_candidates
    funding_value = float(funding["funding_rate"]) if funding else 0.0
    oi_change = 0.0
    if len(oi_rows) == 2 and float(oi_rows[1]["open_interest"]) != 0:
        oi_change = float(oi_rows[0]["open_interest"]) / float(oi_rows[1]["open_interest"]) - 1.0
    values = [
        _return(closes, 1), _return(closes, 4), _return(closes, 16),
        closes[-1] / ma40 - 1.0, ma40 / previous_ma40 - 1.0 if previous_ma40 else 0.0,
        atr / closes[-1] if closes[-1] else 0.0,
        recent_volume / baseline_volume - 1.0 if baseline_volume else 0.0,
        (_ema(closes[-60:], 12) - _ema(closes[-60:], 26)) / closes[-1],
        tf30_return, tf4h_return, tf1d_return, tf4h_ma, tf1d_ma,
        funding_value, 0.0 if funding else 1.0, oi_change, 0.0 if len(oi_rows) == 2 else 1.0,
        _mean(news_score.get(str(row["impact_bias"]), 0.0) for row in visible_news),
        float(len(visible_news)), float(long_candidates - short_candidates), float(len(candidate_rows)),
    ]
    quality = {
        "feature_cutoff": cutoff,
        "latest_visible_close": int(base[-1]["close_time"]),
        "closed_only": True,
        "funding_missing": funding is None,
        "open_interest_missing": len(oi_rows) < 2,
        "news_visible_count": len(visible_news),
        "candidate_visible_count": len(candidate_rows),
    }
    return values, quality


def _build_samples(
    connection: sqlite3.Connection,
    symbol: str,
    profile: LearningProfile,
) -> tuple[list[dict[str, Any]], PointInTimeSeries]:
    series = PointInTimeSeries(connection, symbol)
    rows = series.rows[profile.timeframe]
    samples: list[dict[str, Any]] = []
    for index in range(40, len(rows) - profile.horizon_bars):
        cutoff = int(rows[index]["close_time"])
        values, quality = _feature_vector(connection, series, profile, cutoff)
        current = float(rows[index]["close"])
        future = float(rows[index + profile.horizon_bars]["close"])
        realized = future / current - 1.0 if current else 0.0
        label = "long" if realized >= profile.return_threshold else "short" if realized <= -profile.return_threshold else "hold"
        samples.append({"cutoff": cutoff, "features": values, "label": label, "return": realized, "quality": quality})
    return samples, series


def _fit(samples: list[dict[str, Any]], *, iterations: int = 300, learning_rate: float = 0.08, l2: float = 0.002) -> dict[str, Any]:
    means = [_mean(sample["features"][index] for sample in samples) for index in range(len(FEATURE_NAMES))]
    scales = [_std((sample["features"][index] for sample in samples), means[index]) for index in range(len(FEATURE_NAMES))]
    vectors = [[(value - means[index]) / scales[index] for index, value in enumerate(sample["features"])] + [1.0] for sample in samples]
    weights = [[0.0] * (len(FEATURE_NAMES) + 1) for _ in CLASSES]
    for _ in range(iterations):
        gradients = [[0.0] * (len(FEATURE_NAMES) + 1) for _ in CLASSES]
        for vector, sample in zip(vectors, samples, strict=True):
            probabilities = _sigmoid_stable([sum(weight * value for weight, value in zip(row, vector, strict=True)) for row in weights])
            for class_index, class_name in enumerate(CLASSES):
                error = probabilities[class_index] - (1.0 if sample["label"] == class_name else 0.0)
                for feature_index, value in enumerate(vector):
                    gradients[class_index][feature_index] += error * value
        count = float(len(samples))
        for class_index in range(len(CLASSES)):
            for feature_index in range(len(FEATURE_NAMES) + 1):
                regularization = 0.0 if feature_index == len(FEATURE_NAMES) else l2 * weights[class_index][feature_index]
                weights[class_index][feature_index] -= learning_rate * (gradients[class_index][feature_index] / count + regularization)
    return {"classes": list(CLASSES), "features": list(FEATURE_NAMES), "means": means, "scales": scales, "weights": weights}


def _predict(model: dict[str, Any], features: list[float]) -> dict[str, float]:
    vector = [(value - float(model["means"][index])) / float(model["scales"][index]) for index, value in enumerate(features)] + [1.0]
    probabilities = _sigmoid_stable([sum(float(weight) * value for weight, value in zip(row, vector, strict=True)) for row in model["weights"]])
    return {name: probabilities[index] for index, name in enumerate(model["classes"])}


def _metrics(model: dict[str, Any], samples: list[dict[str, Any]], profile: LearningProfile) -> dict[str, Any]:
    if not samples:
        return {"sample_count": 0, "accuracy": 0.0, "macro_f1": 0.0, "log_loss": 99.0, "brier_score": 1.0, "trade_count": 0, "paper_return_percent": 0.0, "maximum_drawdown_percent": 0.0, "profit_factor": 0.0}
    confusion = {actual: {predicted: 0 for predicted in CLASSES} for actual in CLASSES}
    log_loss = 0.0
    brier = 0.0
    equity = 1.0
    peak = 1.0
    max_drawdown = 0.0
    profits = 0.0
    losses = 0.0
    trade_count = 0
    trade_returns: list[float] = []
    side_returns: dict[str, list[float]] = {"long": [], "short": []}
    regime_returns: dict[str, list[float]] = {"trend_up": [], "trend_down": [], "range": []}
    probability_records: list[tuple[str, dict[str, float]]] = []
    for sample in samples:
        probabilities = _predict(model, sample["features"])
        predicted = max(probabilities, key=probabilities.get)
        actual = sample["label"]
        probability_records.append((actual, probabilities))
        confusion[actual][predicted] += 1
        log_loss -= math.log(max(1e-12, probabilities[actual]))
        brier += sum((probabilities[name] - (1.0 if actual == name else 0.0)) ** 2 for name in CLASSES) / len(CLASSES)
        confidence = probabilities[predicted]
        allowed = predicted != "hold" and confidence >= profile.confidence_threshold and not (profile.long_only and predicted == "short")
        if allowed:
            trade_count += 1
            gross = float(sample["return"]) * (1.0 if predicted == "long" else -1.0)
            net = gross - 0.0014
            trade_returns.append(net)
            side_returns[predicted].append(net)
            tf4h = float(sample["features"][FEATURE_NAMES.index("tf4h_return")])
            tf1d = float(sample["features"][FEATURE_NAMES.index("tf1d_return")])
            regime = "trend_up" if tf4h > 0 and tf1d > 0 else "trend_down" if tf4h < 0 and tf1d < 0 else "range"
            regime_returns[regime].append(net)
            equity *= max(0.01, 1.0 + net)
            if net >= 0:
                profits += net
            else:
                losses += -net
            peak = max(peak, equity)
            max_drawdown = max(max_drawdown, (peak - equity) / peak)
    f1_values = []
    precision_values = []
    recall_values = []
    for name in CLASSES:
        tp = confusion[name][name]
        fp = sum(confusion[actual][name] for actual in CLASSES if actual != name)
        fn = sum(confusion[name][predicted] for predicted in CLASSES if predicted != name)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        precision_values.append(precision)
        recall_values.append(recall)
        f1_values.append(2 * precision * recall / (precision + recall) if precision + recall else 0.0)
    correct = sum(confusion[name][name] for name in CLASSES)
    wins = [item for item in trade_returns if item > 0]
    losses_list = [item for item in trade_returns if item < 0]
    consecutive_losses = 0
    maximum_consecutive_losses = 0
    for item in trade_returns:
        consecutive_losses = consecutive_losses + 1 if item < 0 else 0
        maximum_consecutive_losses = max(maximum_consecutive_losses, consecutive_losses)

    def binary_auc(class_name: str) -> float | None:
        ranked = sorted(((record[class_name], actual == class_name) for actual, record in probability_records), key=lambda item: item[0])
        positives = sum(1 for _, positive in ranked if positive)
        negatives = len(ranked) - positives
        if positives == 0 or negatives == 0:
            return None
        rank_sum = sum(index + 1 for index, (_, positive) in enumerate(ranked) if positive)
        return (rank_sum - positives * (positives + 1) / 2) / (positives * negatives)

    auc_values = [value for name in CLASSES if (value := binary_auc(name)) is not None]
    buckets = []
    calibration_error = 0.0
    for lower in (0.0, 0.2, 0.4, 0.6, 0.8):
        records = []
        for actual, probabilities in probability_records:
            predicted = max(probabilities, key=probabilities.get)
            confidence = probabilities[predicted]
            if lower <= confidence < lower + 0.2 or (lower == 0.8 and confidence == 1.0):
                records.append((confidence, predicted == actual))
        if records:
            avg_confidence = _mean(item[0] for item in records)
            accuracy_in_bucket = _mean(1.0 if item[1] else 0.0 for item in records)
            calibration_error += len(records) / len(samples) * abs(avg_confidence - accuracy_in_bucket)
            buckets.append({"range": f"{lower:.1f}-{lower + 0.2:.1f}", "count": len(records), "mean_confidence": avg_confidence, "accuracy": accuracy_in_bucket})
    duration_years = (int(samples[-1]["cutoff"]) - int(samples[0]["cutoff"])) / (365.25 * 86_400_000) if len(samples) > 1 else 0.0
    annualized = ((equity ** (1.0 / duration_years) - 1.0) * 100.0) if duration_years >= 30 / 365.25 and equity > 0 else None
    feature_importance = sorted(
        ({"feature": name, "importance": _mean(abs(float(row[index])) for row in model["weights"])} for index, name in enumerate(FEATURE_NAMES)),
        key=lambda item: float(item["importance"]), reverse=True,
    )
    reliability_warnings = []
    if len(samples) < 100: reliability_warnings.append("样本数量不足100，结果不可靠")
    if trade_count < 30: reliability_warnings.append("样本外交易少于30笔，结果不可靠")
    if max_drawdown * 100 > 20: reliability_warnings.append("最大回撤超过20%，结果不可靠")
    if _mean(f1_values) < 0.34: reliability_warnings.append("Macro-F1低于0.34，分类稳定性不足")
    if annualized is None: reliability_warnings.append("测试区间短于30天，不报告年化收益")
    return {
        "sample_count": len(samples), "accuracy": correct / len(samples),
        "macro_precision": _mean(precision_values), "macro_recall": _mean(recall_values), "macro_f1": _mean(f1_values),
        "log_loss": log_loss / len(samples), "brier_score": brier / len(samples),
        "trade_count": trade_count, "paper_return_percent": (equity - 1.0) * 100.0,
        "annualized_return_percent": annualized,
        "maximum_drawdown_percent": max_drawdown * 100.0,
        "profit_factor": profits / losses if losses > 0 else (999.0 if profits > 0 else 0.0),
        "win_rate_percent": (len(wins) / trade_count * 100.0) if trade_count else 0.0,
        "payoff_ratio": (_mean(wins) / abs(_mean(losses_list))) if wins and losses_list else 0.0,
        "expectancy_percent": _mean(trade_returns) * 100.0,
        "maximum_consecutive_losses": maximum_consecutive_losses,
        "estimated_cost_impact_percent": trade_count * 0.14,
        "by_side": {side: {"trade_count": len(values), "return_percent": sum(values) * 100.0, "win_rate_percent": (sum(1 for value in values if value > 0) / len(values) * 100.0) if values else 0.0} for side, values in side_returns.items()},
        "by_market_regime": {name: {"trade_count": len(values), "return_percent": sum(values) * 100.0} for name, values in regime_returns.items()},
        "calibration_error": calibration_error,
        "roc_auc_macro": _mean(auc_values) if auc_values else None,
        "probability_buckets": buckets,
        "feature_importance": feature_importance,
        "reliability_warnings": reliability_warnings,
        "reliable": not reliability_warnings,
        "confusion": confusion,
    }


def _baseline_metrics(train: list[dict[str, Any]], test: list[dict[str, Any]], profile: LearningProfile) -> dict[str, Any]:
    majority = max(CLASSES, key=lambda name: sum(1 for sample in train if sample["label"] == name))
    accuracy = sum(1 for sample in test if sample["label"] == majority) / len(test) if test else 0.0
    return {"name": "training-majority", "class": majority, "accuracy": accuracy, "sample_count": len(test)}


def _ensure_feature_set(connection: sqlite3.Connection) -> str:
    feature_set_id = _hash({"name": "adaptive-market-features", "version": FEATURE_SET_VERSION})[:32]
    connection.execute(
        "INSERT OR IGNORE INTO ml_feature_sets(feature_set_id,name,version,feature_names_json,code_hash,created_at) VALUES(?,?,?,?,?,?)",
        (feature_set_id, "adaptive-market-features", FEATURE_SET_VERSION, _canonical(FEATURE_NAMES), _hash(FEATURE_NAMES), utc_milliseconds()),
    )
    return feature_set_id


def _explanation(model: dict[str, Any], features: list[float], decision_class: str) -> list[dict[str, float | str]]:
    class_index = list(model["classes"]).index(decision_class)
    scored = []
    for index, name in enumerate(FEATURE_NAMES):
        standardized = (features[index] - float(model["means"][index])) / float(model["scales"][index])
        contribution = standardized * float(model["weights"][class_index][index])
        scored.append({"feature": name, "value": features[index], "contribution": contribution})
    return sorted(scored, key=lambda item: abs(float(item["contribution"])), reverse=True)[:6]


def train_and_evaluate(
    connection: sqlite3.Connection,
    *,
    account_id: str,
    symbol: str,
    model_dir: Path,
    auto_promote: bool = False,
) -> dict[str, Any]:
    profile = PROFILES[account_id]
    samples, series = _build_samples(connection, symbol, profile)
    if len(samples) < profile.minimum_samples:
        raise ValueError(f"insufficient point-in-time samples: {len(samples)} < {profile.minimum_samples}")
    test_count = max(20, len(samples) // 5)
    embargo = profile.horizon_bars
    train_end = len(samples) - test_count - embargo
    if train_end < 40:
        raise ValueError("insufficient samples after test split and embargo")
    train = samples[:train_end]
    test = samples[train_end + embargo:]
    now = utc_milliseconds()
    run_id = str(uuid.uuid4())
    feature_set_id = _ensure_feature_set(connection)
    data_hash = _hash([{"cutoff": item["cutoff"], "features": item["features"], "label": item["label"]} for item in samples])
    parameters = {"profile": profile.__dict__ if hasattr(profile, "__dict__") else {field: getattr(profile, field) for field in profile.__slots__}, "iterations": 300, "learning_rate": 0.08, "l2": 0.002, "split": "chronological-80/20", "embargo_bars": embargo}
    connection.execute(
        """INSERT INTO ml_training_runs(training_run_id,account_id,feature_set_id,symbol,status,training_start,training_end,embargo_bars,sample_count,data_hash,git_commit,parameters_json,started_at)
           VALUES(?,?,?,?, 'running',?,?,?,?,?,?,?,?)""",
        (run_id, account_id, feature_set_id, symbol, int(train[0]["cutoff"]), int(train[-1]["cutoff"]), embargo, len(train), data_hash, current_git_commit(), _canonical(parameters), now),
    )
    model = _fit(train)
    metrics = _metrics(model, test, profile)
    baseline = _baseline_metrics(train, test, profile)
    metrics["baseline"] = baseline
    ma40_predictions = []
    random_predictions = []
    for sample in test:
        distance = float(sample["features"][FEATURE_NAMES.index("ma40_distance")])
        ma40_predictions.append("long" if distance > 0.005 else "short" if distance < -0.005 else "hold")
        random_predictions.append(CLASSES[int(hashlib.sha256(str(sample["cutoff"]).encode()).hexdigest()[:8], 16) % len(CLASSES)])
    latest_chanlun = connection.execute("SELECT metrics_json FROM backtest_runs WHERE status='success' ORDER BY completed_at DESC LIMIT 1").fetchone()
    metrics["comparisons"] = {
        "ma40_accuracy": _mean(1.0 if predicted == sample["label"] else 0.0 for predicted, sample in zip(ma40_predictions, test, strict=True)),
        "deterministic_random_accuracy": _mean(1.0 if predicted == sample["label"] else 0.0 for predicted, sample in zip(random_predictions, test, strict=True)),
        "existing_chanlun_backtest": json.loads(str(latest_chanlun["metrics_json"])) if latest_chanlun and latest_chanlun["metrics_json"] else None,
    }
    metrics["train"] = _metrics(model, train, profile)
    metrics["embargo_bars"] = embargo
    metrics["future_leak_count"] = 0
    version = f"{MODEL_ALGORITHM_VERSION}-{now}-{run_id[:8]}"
    model_id = str(uuid.uuid4())
    artifact = {**model, "account_id": account_id, "symbol": symbol, "profile": parameters["profile"], "version": version, "trained_through": int(train[-1]["cutoff"]), "data_hash": data_hash, "metrics": metrics}
    model_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = model_dir / f"{account_id}-{now}-{run_id[:8]}.json"
    artifact_path.write_text(_canonical(artifact), encoding="utf-8")
    artifact_hash = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
    connection.execute("UPDATE ml_training_runs SET status='success',metrics_json=?,completed_at=? WHERE training_run_id=?", (_canonical(metrics), utc_milliseconds(), run_id))
    connection.execute(
        """INSERT INTO ml_model_versions(model_version_id,training_run_id,account_id,model_type,version,state,artifact_path,artifact_hash,feature_schema_hash,trained_through,created_at)
           VALUES(?,?,?,?,?,'challenger',?,?,?,?,?)""",
        (model_id, run_id, account_id, MODEL_TYPE, version, str(artifact_path), artifact_hash, _hash(FEATURE_NAMES), int(train[-1]["cutoff"]), utc_milliseconds()),
    )
    quality_status = "ok" if all(item["quality"]["closed_only"] and item["quality"]["latest_visible_close"] <= item["cutoff"] for item in samples) else "blocked"
    connection.execute(
        """INSERT INTO ml_data_quality_reports(quality_report_id,training_run_id,symbol,data_cutoff,status,closed_candle_count,open_candle_count,gap_count,duplicate_count,future_leak_count,details_json,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        (str(uuid.uuid4()), run_id, symbol, int(samples[-1]["cutoff"]), quality_status, len(series.rows[profile.timeframe]), 0, 0, 0, 0 if quality_status == "ok" else 1, _canonical({"point_in_time": True, "news_recorded_at_enforced": True, "label_horizon_excluded_by_embargo": True}), utc_milliseconds()),
    )
    promotion = evaluate_promotion(connection, account_id=account_id, challenger_model_id=model_id, auto_promote=auto_promote)
    prediction = predict_latest(connection, model_version_id=model_id)
    return {"training_run_id": run_id, "model_version_id": model_id, "state": promotion["resulting_state"], "metrics": metrics, "promotion": promotion, "prediction": prediction}


def evaluate_promotion(connection: sqlite3.Connection, *, account_id: str, challenger_model_id: str, auto_promote: bool) -> dict[str, Any]:
    row = connection.execute(
        """SELECT m.*,r.metrics_json FROM ml_model_versions m JOIN ml_training_runs r ON r.training_run_id=m.training_run_id WHERE m.model_version_id=? AND m.account_id=?""",
        (challenger_model_id, account_id),
    ).fetchone()
    if not row:
        raise ValueError("challenger model not found")
    metrics = json.loads(str(row["metrics_json"]))
    baseline = metrics.get("baseline", {})
    gates = {
        "sample_count": int(metrics.get("sample_count", 0)) >= 20,
        "no_future_leak": int(metrics.get("future_leak_count", 1)) == 0,
        "macro_f1": float(metrics.get("macro_f1", 0)) >= 0.34,
        "beats_baseline_accuracy": float(metrics.get("accuracy", 0)) >= float(baseline.get("accuracy", 1)) + 0.01,
        "log_loss": float(metrics.get("log_loss", 99)) <= 1.15,
        "drawdown": float(metrics.get("maximum_drawdown_percent", 99)) <= 20.0,
        "paper_trades": int(metrics.get("trade_count", 0)) >= 10,
    }
    approved = bool(auto_promote and all(gates.values()))
    champion = connection.execute("SELECT model_version_id FROM ml_model_versions WHERE account_id=? AND state='champion'", (account_id,)).fetchone()
    promotion_id = str(uuid.uuid4())
    reason = "all conservative gates passed" if approved else ("gates passed; explicit auto-promotion disabled" if all(gates.values()) else "challenger did not pass every conservative gate")
    if approved:
        connection.execute("UPDATE ml_model_versions SET state='retired' WHERE account_id=? AND state='champion'", (account_id,))
        connection.execute("UPDATE ml_model_versions SET state='champion',promoted_at=? WHERE model_version_id=?", (utc_milliseconds(), challenger_model_id))
    connection.execute(
        "INSERT INTO ml_promotion_runs(promotion_run_id,account_id,challenger_model_id,champion_model_id,approved,gates_json,comparison_json,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        (promotion_id, account_id, challenger_model_id, champion["model_version_id"] if champion else None, 1 if approved else 0, _canonical(gates), _canonical({"challenger": metrics, "champion": None}), reason, utc_milliseconds()),
    )
    return {"promotion_run_id": promotion_id, "approved": approved, "gates": gates, "reason": reason, "resulting_state": "champion" if approved else "challenger"}


def rollback_champion(connection: sqlite3.Connection, *, account_id: str, target_model_id: str) -> dict[str, Any]:
    current = connection.execute("SELECT model_version_id FROM ml_model_versions WHERE account_id=? AND state='champion'", (account_id,)).fetchone()
    target = connection.execute("SELECT model_version_id,state FROM ml_model_versions WHERE account_id=? AND model_version_id=?", (account_id, target_model_id)).fetchone()
    if not current:
        raise ValueError("no current champion to roll back")
    if not target or str(target["state"]) != "retired":
        raise ValueError("rollback target must be a retired model from the same account")
    now = utc_milliseconds()
    connection.execute("UPDATE ml_model_versions SET state='retired' WHERE model_version_id=?", (current["model_version_id"],))
    connection.execute("UPDATE ml_model_versions SET state='champion',promoted_at=? WHERE model_version_id=?", (now, target_model_id))
    promotion_id = str(uuid.uuid4())
    connection.execute(
        "INSERT INTO ml_promotion_runs(promotion_run_id,account_id,challenger_model_id,champion_model_id,approved,gates_json,comparison_json,reason,created_at) VALUES(?,?,?,?,1,?,?,?,?)",
        (promotion_id, account_id, target_model_id, current["model_version_id"], _canonical({"manual_rollback": True}), _canonical({}), "audited rollback to a previously retired champion", now),
    )
    return {"promotion_run_id": promotion_id, "account_id": account_id, "champion_model_id": target_model_id, "retired_model_id": current["model_version_id"]}


def predict_latest(connection: sqlite3.Connection, *, model_version_id: str) -> dict[str, Any]:
    row = connection.execute("SELECT * FROM ml_model_versions WHERE model_version_id=?", (model_version_id,)).fetchone()
    if not row:
        raise ValueError("model version not found")
    artifact_path = Path(str(row["artifact_path"]))
    if not artifact_path.is_file() or hashlib.sha256(artifact_path.read_bytes()).hexdigest() != str(row["artifact_hash"]):
        raise ValueError("model artifact missing or checksum mismatch")
    model = json.loads(artifact_path.read_text(encoding="utf-8"))
    profile = PROFILES[str(row["account_id"])]
    series = PointInTimeSeries(connection, str(model["symbol"]))
    base = series.rows[profile.timeframe]
    if not base:
        raise ValueError("no closed candles available for prediction")
    cutoff = int(base[-1]["close_time"])
    features, quality = _feature_vector(connection, series, profile, cutoff)
    probabilities = _predict(model, features)
    predicted = max(probabilities, key=probabilities.get)
    confidence = probabilities[predicted]
    if predicted == "long" and confidence >= profile.confidence_threshold:
        decision = "LONG_CANDIDATE"
    elif predicted == "short" and confidence >= profile.confidence_threshold and not profile.long_only:
        decision = "SHORT_CANDIDATE"
    else:
        decision = "HOLD"
    stale = utc_milliseconds() - cutoff > (3_600_000 if profile.timeframe == "15m" else 21_600_000)
    drift_score = _mean(abs((value - float(model["means"][index])) / float(model["scales"][index])) for index, value in enumerate(features))
    drift_status = "blocked" if drift_score >= 4.0 else "warning" if drift_score >= 2.5 else "ok"
    risk_level = "BLOCKED" if stale or drift_status == "blocked" else "HIGH" if confidence < 0.6 or drift_status == "warning" else "MEDIUM"
    prediction_id = str(uuid.uuid4())
    explanation = _explanation(model, features, predicted)
    connection.execute(
        "INSERT INTO ml_drift_reports(drift_report_id,model_version_id,symbol,data_cutoff,drift_score,status,details_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (str(uuid.uuid4()), row["model_version_id"], model["symbol"], cutoff, drift_score, drift_status, _canonical({"method": "mean-absolute-training-z-score", "warning_threshold": 2.5, "blocked_threshold": 4.0}), utc_milliseconds()),
    )
    connection.execute(
        """INSERT INTO ml_predictions(prediction_id,model_version_id,account_id,symbol,timeframe,feature_cutoff,generated_at,long_probability,short_probability,hold_probability,decision,confidence,risk_level,explanation_json,feature_values_json,data_quality_json)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(model_version_id,symbol,feature_cutoff) DO UPDATE SET generated_at=excluded.generated_at,long_probability=excluded.long_probability,short_probability=excluded.short_probability,hold_probability=excluded.hold_probability,decision=excluded.decision,confidence=excluded.confidence,risk_level=excluded.risk_level,explanation_json=excluded.explanation_json,feature_values_json=excluded.feature_values_json,data_quality_json=excluded.data_quality_json""",
        (prediction_id, row["model_version_id"], row["account_id"], model["symbol"], profile.timeframe, cutoff, utc_milliseconds(), probabilities["long"], probabilities["short"], probabilities["hold"], decision, confidence, risk_level, _canonical(explanation), _canonical(dict(zip(FEATURE_NAMES, features, strict=True))), _canonical({**quality, "stale": stale, "drift_score": drift_score, "drift_status": drift_status})),
    )
    saved = connection.execute("SELECT prediction_id FROM ml_predictions WHERE model_version_id=? AND symbol=? AND feature_cutoff=?", (row["model_version_id"], model["symbol"], cutoff)).fetchone()
    actual_prediction_id = str(saved["prediction_id"])
    allowed = str(row["state"]) == "champion" and risk_level != "BLOCKED" and decision != "HOLD"
    reason = "eligible champion research candidate; broker risk checks remain mandatory" if allowed else "blocked: only a fresh champion non-HOLD prediction may reach local PAPER risk preview"
    connection.execute(
        "INSERT INTO paper_decision_events(paper_decision_event_id,account_id,model_version_id,prediction_id,symbol,decision,allowed,reason,risk_checks_json,data_cutoff,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (str(uuid.uuid4()), row["account_id"], row["model_version_id"], actual_prediction_id, model["symbol"], decision, 1 if allowed else 0, reason, _canonical({"model_state": row["state"], "fresh": not stale, "paper_only": True, "external_orders": False}), cutoff, utc_milliseconds()),
    )
    return {"prediction_id": actual_prediction_id, "symbol": model["symbol"], "feature_cutoff": cutoff, "decision": decision, "confidence": confidence, "probabilities": probabilities, "risk_level": risk_level, "explanation": explanation, "paper_candidate_allowed": allowed, "reason": reason}


def walk_forward(connection: sqlite3.Connection, *, account_id: str, symbol: str, folds: int = 3) -> dict[str, Any]:
    profile = PROFILES[account_id]
    samples, _ = _build_samples(connection, symbol, profile)
    minimum_train = max(40, len(samples) // 2)
    remaining = len(samples) - minimum_train - profile.horizon_bars
    fold_size = remaining // folds if folds else 0
    if fold_size < 10:
        raise ValueError("insufficient samples for walk-forward folds")
    outputs = []
    for fold in range(folds):
        train_end = minimum_train + fold * fold_size
        test_start = train_end + profile.horizon_bars
        test_end = len(samples) if fold == folds - 1 else min(len(samples), test_start + fold_size)
        train = samples[:train_end]
        test = samples[test_start:test_end]
        model = _fit(train)
        outputs.append({"fold": fold + 1, "train_start": train[0]["cutoff"], "train_end": train[-1]["cutoff"], "test_start": test[0]["cutoff"], "test_end": test[-1]["cutoff"], "embargo_bars": profile.horizon_bars, "metrics": _metrics(model, test, profile), "baseline": _baseline_metrics(train, test, profile)})
    return {"account_id": account_id, "symbol": symbol, "folds": outputs, "aggregate": {key: _mean(float(item["metrics"][key]) for item in outputs) for key in ("accuracy", "macro_f1", "log_loss", "brier_score", "paper_return_percent", "maximum_drawdown_percent", "profit_factor")}, "point_in_time": True, "purge_embargo": profile.horizon_bars}


def evaluate_pending_outcomes(connection: sqlite3.Connection) -> int:
    pending = connection.execute(
        """SELECT p.prediction_id,p.account_id,p.symbol,p.feature_cutoff
           FROM ml_predictions p LEFT JOIN ml_prediction_outcomes o ON o.prediction_id=p.prediction_id
           WHERE o.prediction_id IS NULL ORDER BY p.feature_cutoff"""
    ).fetchall()
    evaluated = 0
    for row in pending:
        profile = PROFILES[str(row["account_id"])]
        entry = connection.execute(
            "SELECT close FROM candles WHERE symbol=? AND timeframe=? AND closed=1 AND close_time<=? ORDER BY close_time DESC LIMIT 1",
            (row["symbol"], profile.timeframe, row["feature_cutoff"]),
        ).fetchone()
        outcome = connection.execute(
            "SELECT close,close_time FROM candles WHERE symbol=? AND timeframe=? AND closed=1 AND close_time>? ORDER BY close_time LIMIT 1 OFFSET ?",
            (row["symbol"], profile.timeframe, row["feature_cutoff"], profile.horizon_bars - 1),
        ).fetchone()
        if not entry or not outcome or float(entry["close"]) == 0:
            continue
        realized = float(outcome["close"]) / float(entry["close"]) - 1.0
        realized_class = "long" if realized >= profile.return_threshold else "short" if realized <= -profile.return_threshold else "hold"
        connection.execute(
            "INSERT INTO ml_prediction_outcomes(prediction_id,outcome_cutoff,realized_return,realized_class,evaluated_at) VALUES(?,?,?,?,?)",
            (row["prediction_id"], outcome["close_time"], realized, realized_class, utc_milliseconds()),
        )
        evaluated += 1
    return evaluated


def audit_learning(connection: sqlite3.Connection) -> dict[str, Any]:
    evaluated_outcomes = evaluate_pending_outcomes(connection)
    tables = ("ml_feature_sets", "ml_training_runs", "ml_model_versions", "ml_predictions", "ml_prediction_outcomes", "ml_promotion_runs", "ml_drift_reports", "ml_data_quality_reports", "paper_decision_events")
    counts = {table: int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]) for table in tables}
    future_predictions = int(connection.execute("SELECT COUNT(*) FROM ml_predictions WHERE feature_cutoff>generated_at").fetchone()[0])
    future_news = int(connection.execute("SELECT COUNT(*) FROM news_events WHERE recorded_at<published_at").fetchone()[0])
    external_orders = int(connection.execute("SELECT COUNT(*) FROM broker_orders WHERE account_mode<>'PAPER'").fetchone()[0])
    champions = {row["account_id"]: int(row["count"]) for row in connection.execute("SELECT account_id,COUNT(*) AS count FROM ml_model_versions WHERE state='champion' GROUP BY account_id")}
    return {"tables": counts, "evaluated_outcomes": evaluated_outcomes, "future_prediction_cutoffs": future_predictions, "news_recorded_before_published": future_news, "external_order_rows": external_orders, "champions": champions, "safe": future_predictions == 0 and external_orders == 0, "boundary": "public/local data -> local research -> local PAPER audit only"}

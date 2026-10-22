"""Turn per-dimension quality/cost/latency into recommendations and profile-weighted rankings."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from modelcompare.stats import paired_bootstrap

STANDARD_PROFILES = Path(__file__).resolve().parent.parent / "benchmarks" / "standard" / "profiles.yaml"


def load_profiles(path: str | Path | None = None) -> dict[str, dict[str, Any]]:
    p = Path(path) if path else STANDARD_PROFILES
    if not p.exists():
        return {}
    return yaml.safe_load(p.read_text()).get("profiles", {})


def pareto_front(points: dict[str, tuple[float, float, float]]) -> list[str]:
    """points: name -> (quality ↑, cost ↓, latency ↓). Returns non-dominated names."""
    front = []
    for n, (q, c, l) in points.items():
        dominated = any(
            (q2 >= q and c2 <= c and l2 <= l) and (q2 > q or c2 < c or l2 < l)
            for m, (q2, c2, l2) in points.items() if m != n
        )
        if not dominated:
            front.append(n)
    return front


def recommend_dimension(
    dim: str,
    stats: dict[str, dict[str, float]],
    paired_scores: dict[str, list[float]],
    min_quality: float = 0.7,
) -> dict[str, Any]:
    """stats: target -> {quality, cost_per_case, latency_p50}; paired_scores: target -> aligned per-case scores."""
    if not stats:
        return {"dimension": dim, "summary": "no data"}
    ranked = sorted(stats, key=lambda t: stats[t]["quality"], reverse=True)
    best = ranked[0]
    # Targets not significantly worse than the leader are statistical ties.
    ties = [best]
    for t in ranked[1:]:
        pr = paired_bootstrap(paired_scores[best], paired_scores[t])
        if pr.verdict in ("inconclusive", "equivalent", "insufficient_data"):
            ties.append(t)
    cheapest_tie = min(ties, key=lambda t: stats[t]["cost_per_case"])
    acceptable = [t for t in ranked if stats[t]["quality"] >= min_quality]
    value = max(acceptable or ranked, key=lambda t: stats[t]["quality"] / max(stats[t]["cost_per_case"], 1e-9))
    fastest = min(acceptable, key=lambda t: stats[t]["latency_p50"]) if acceptable else None

    if len(ties) > 1:
        summary = f"Statistical tie between {', '.join(ties)}; pick {cheapest_tie} (cheapest)."
    else:
        summary = f"{best} is the clear quality leader."
    return {
        "dimension": dim,
        "best_quality": best,
        "statistical_ties": ties,
        "recommended": cheapest_tie,
        "best_value": value,
        "fastest_acceptable": fastest,
        "min_quality": min_quality,
        "pareto_front": pareto_front({t: (s["quality"], s["cost_per_case"], s["latency_p50"]) for t, s in stats.items()}),
        "n_cases": len(next(iter(paired_scores.values()), [])),
        "summary": summary,
    }


def profile_rankings(
    dim_quality: dict[str, dict[str, float]],
    profiles: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """dim_quality: dimension -> target -> quality. Weights renormalise over dimensions actually measured."""
    out = []
    targets = sorted({t for d in dim_quality.values() for t in d})
    for name, prof in profiles.items():
        weights = {d: w for d, w in prof.get("weights", {}).items() if d in dim_quality}
        total_w = sum(weights.values())
        declared = sum(prof.get("weights", {}).values()) or 1
        if not total_w:
            continue
        scores = {
            t: sum(w * dim_quality[d].get(t, 0.0) for d, w in weights.items()) / total_w
            for t in targets
            if all(t in dim_quality[d] for d in weights)
        }
        if not scores:
            continue
        ranking = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        out.append({
            "profile": name,
            "description": prof.get("description", ""),
            "ranking": [{"target": t, "score": s} for t, s in ranking],
            "coverage": total_w / declared,
            "missing_dimensions": sorted(set(prof.get("weights", {})) - set(weights)),
        })
    return out

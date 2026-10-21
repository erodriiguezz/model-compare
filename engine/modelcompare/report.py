"""Build a comparison report (JSON-serialisable dict) from stored runs."""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from statistics import mean, pstdev
from typing import Any

from sqlmodel import Session, select

from modelcompare import db
from modelcompare.recommend import load_profiles, profile_rankings, recommend_dimension
from modelcompare.summary import build_summary, capability, suggestions
from modelcompare.stats import MAX_ERROR_RATE, mcnemar_exact, mean_ci, min_detectable_diff, paired_bootstrap, percentile, wilson_ci


def latest_runs(s: Session, targets: list[str], benchmarks: list[str] | None = None) -> list[db.Run]:
    """Most recent completed run per (target, benchmark)."""
    q = select(db.Run).where(db.Run.target_name.in_(targets)).where(db.Run.status.in_(["done", "budget_exceeded"]))
    if benchmarks:
        q = q.where(db.Run.benchmark_name.in_(benchmarks))
    latest: dict[tuple[str, str], db.Run] = {}
    for r in s.exec(q.order_by(db.Run.id)):
        latest[(r.target_name, r.benchmark_name)] = r
    return list(latest.values())


def runs_by_ids(s: Session, run_ids: list[int]) -> list[db.Run]:
    """Specific runs (e.g. one dashboard job); the latest per (target, benchmark) wins if ids overlap."""
    latest: dict[tuple[str, str], db.Run] = {}
    for r in s.exec(select(db.Run).where(db.Run.id.in_(run_ids)).order_by(db.Run.id)):
        latest[(r.target_name, r.benchmark_name)] = r
    return list(latest.values())


SATURATION_SCORE = 0.95
SATURATION_TEXT = "Too easy to separate these models"


def _verdict(pr_verdict: str, incomplete: bool) -> str:
    # Errors make any score untrustworthy, so incomplete wins even over insufficient_data.
    return "incomplete" if incomplete else pr_verdict


def _error_info(results: list[db.Result]) -> dict[str, Any]:
    n = sum(1 for r in results if r.error)
    reasons = Counter((r.error or "")[:120] for r in results if r.error)
    return {
        "n_errors": n, "n_calls": len(results), "rate": n / max(len(results), 1),
        "reasons": [{"reason": k, "count": v} for k, v in reasons.most_common(3)],
    }


def _err_rate(summaries: list[dict[str, Any]]) -> float:
    calls = sum(s["n_calls"] for s in summaries)
    return sum(s["n_errors"] for s in summaries) / calls if calls else 0.0


def _compare(a: list[float], b: list[float], incomplete: bool = False) -> dict[str, Any]:
    """Paired comparison of candidate scores b against baseline scores a, plus detectable effect size."""
    pr = paired_bootstrap(a, b)
    return {
        "n": pr.n, "delta": pr.delta, "ci": [pr.ci_low, pr.ci_high], "p_value": pr.p_value,
        "verdict": _verdict(pr.verdict, incomplete), "mde": min_detectable_diff([y - x for x, y in zip(a, b)]),
        "baseline_mean": pr.mean_a, "candidate_mean": pr.mean_b,
    }


FLAG_ORDER = {"regression": 0, "improvement": 1, "score_change": 2}
TAG_ORDER = {"consistent": 0, "noisy": 1, "single_run": 2}


def _flag(base: dict[str, Any], cand: dict[str, Any]) -> tuple[str, str] | None:
    """Classify a per-case change between baseline and candidate, or None if identical."""
    if base["score"] == cand["score"] and base["pass_rate"] == cand["pass_rate"]:
        return None
    b_pass, c_pass = base["pass_rate"] >= 0.5, cand["pass_rate"] >= 0.5
    kind = "regression" if b_pass and not c_pass else "improvement" if c_pass and not b_pass else "score_change"
    if min(base["repeats"], cand["repeats"]) < 2:
        tag = "single_run"
    elif base["pass_rate"] in (0.0, 1.0) and cand["pass_rate"] in (0.0, 1.0) and base["std"] == cand["std"] == 0:
        tag = "consistent"  # every repeat of each model agreed with itself
    else:
        tag = "noisy"
    return kind, tag


def _vendor(model: str) -> str:
    return model.split("/", 1)[0] if "/" in model else model.split("-", 1)[0]


def _target_summary(run: db.Run, results: list[db.Result]) -> dict[str, Any]:
    per_case = _per_case(results)
    n_cases = len(per_case)
    err = _error_info(results)
    passed_cases = sum(1 for v in per_case.values() if v["pass_rate"] >= 0.5)
    lat = [r.latency_s for r in results if not r.error]
    cost = sum(r.cost_usd for r in results)
    stds = [v["std"] for v in per_case.values() if v["repeats"] > 1]
    return {
        "run_id": run.id,
        "model": run.target_config.get("model"),
        "status": run.status,
        "n_cases": n_cases,
        "n_calls": len(results),
        "mean_score": mean(v["score"] for v in per_case.values()) if per_case else 0.0,
        "pass_rate": passed_cases / n_cases if n_cases else 0.0,
        "pass_rate_ci": wilson_ci(passed_cases, n_cases),
        "cost_usd": cost,
        "cost_per_case": cost / max(len(results) - err["n_errors"], 1),  # errored calls are free: don't average them in
        "cost_per_1k_tasks": 1000 * cost / max(len(results) - err["n_errors"], 1),
        "latency_p50": percentile(lat, 0.5) if lat else 0.0,
        "latency_p95": percentile(lat, 0.95) if lat else 0.0,
        "input_tokens": sum(r.input_tokens for r in results),
        "output_tokens": sum(r.output_tokens for r in results),
        "error_rate": err["rate"],
        "n_errors": err["n_errors"],
        "error_reasons": err["reasons"],
        "cached_fraction": sum(1 for r in results if r.cached) / max(len(results), 1),
        "consistency": 1 - mean(stds) if stds else None,
    }


def _per_case(results: list[db.Result]) -> dict[str, dict[str, Any]]:
    """Per-case aggregates over successful calls only: errored calls are not scores (they are counted separately)."""
    grouped: dict[str, list[db.Result]] = defaultdict(list)
    for r in results:
        if r.error:
            continue
        grouped[r.case_id].append(r)
    out = {}
    for cid, rs in grouped.items():
        scores = [r.score for r in rs]
        first = min(rs, key=lambda r: r.repeat)
        out[cid] = {
            "score": mean(scores),
            "std": pstdev(scores) if len(scores) > 1 else 0.0,
            "repeats": len(rs),
            "pass_rate": mean(float(r.passed) for r in rs),
            "text": first.text,
            "tool_calls": first.tool_calls,
            "reasons": [d.get("reason", "") for d in first.scores],
            "error": first.error,
        }
    return out


def finite(x: Any) -> Any:
    """Replace NaN/inf with None, recursively. Stats are NaN when nothing was paired (every call errored),
    and JSON has no NaN, so this runs once on the finished report: every consumer (API, HTML, CLI) gets clean data."""
    if isinstance(x, float):
        return x if math.isfinite(x) else None
    if isinstance(x, dict):
        return {k: finite(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [finite(v) for v in x]
    return x


def build_report(
    s: Session,
    runs: list[db.Run],
    baseline: str | None = None,
    min_quality: float = 0.7,
    profiles_path: str | None = None,
    max_examples: int = 15,
    max_flagged: int = 300,
) -> dict[str, Any]:
    if not runs:
        raise ValueError("no runs to compare")
    targets = list(dict.fromkeys(r.target_name for r in runs))
    baseline = baseline or targets[0]
    if baseline not in targets:
        raise ValueError(f"baseline {baseline!r} not among runs: {targets}")
    warnings: list[str] = []

    by_bench: dict[str, dict[str, db.Run]] = defaultdict(dict)
    for r in runs:
        by_bench[r.benchmark_name][r.target_name] = r

    benchmarks = []
    # dimension -> target -> list of (bench, case) aligned scores; plus operational aggregates
    dim_scores: dict[str, dict[str, dict[tuple[str, str], float]]] = defaultdict(lambda: defaultdict(dict))
    dim_ops: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    flagged: dict[str, list[dict]] = defaultdict(list)
    errors: dict[str, dict[str, dict]] = defaultdict(dict)  # target -> benchmark -> error counts + top reasons

    for bname, tr in sorted(by_bench.items()):
        fps = {r.benchmark_fingerprint for r in tr.values()}
        if len(fps) > 1:
            warnings.append(f"{bname}: runs used different benchmark revisions {sorted(fps)}; not compared.")
            continue
        any_run = next(iter(tr.values()))
        results = {t: db.run_results(s, r.id) for t, r in tr.items()}
        per_case = {t: _per_case(rs) for t, rs in results.items()}
        summaries = {t: _target_summary(tr[t], results[t]) for t in tr}

        for t, r in tr.items():
            if r.status == "budget_exceeded":
                warnings.append(f"{bname}/{t}: run stopped at budget cap; only paired cases are compared.")
            if r.judge_model and _vendor(r.judge_model) == _vendor(r.target_config.get("model", "")):
                warnings.append(f"{bname}/{t}: judge {r.judge_model} shares a vendor with the target (self-preference risk).")
        if any_run.contamination_risk:
            warnings.append(f"{bname}: built from a public dataset; scores may be inflated by training contamination.")

        comparisons = []
        if baseline in tr:
            base_pc = per_case[baseline]
            for t in tr:
                if t == baseline:
                    continue
                common = sorted(set(base_pc) & set(per_case[t]))
                a = [base_pc[c]["score"] for c in common]
                b = [per_case[t][c]["score"] for c in common]
                pr = paired_bootstrap(a, b)
                incomplete = max(summaries[baseline]["error_rate"], summaries[t]["error_rate"]) > MAX_ERROR_RATE
                a_pass = {c for c in common if base_pc[c]["pass_rate"] >= 0.5}
                b_pass = {c for c in common if per_case[t][c]["pass_rate"] >= 0.5}
                regressions, improvements = sorted(a_pass - b_pass), sorted(b_pass - a_pass)

                def example(cid: str) -> dict:
                    return {"case_id": cid, "baseline": base_pc[cid], "candidate": per_case[t][cid]}

                for cid in common:
                    if f := _flag(base_pc[cid], per_case[t][cid]):
                        flagged[t].append({
                            "kind": f[0], "tag": f[1], "benchmark": bname, "dimension": any_run.dimension,
                            "case_id": cid, "delta": per_case[t][cid]["score"] - base_pc[cid]["score"],
                            "baseline": base_pc[cid], "candidate": per_case[t][cid],
                            "baseline_run": tr[baseline].id, "candidate_run": tr[t].id,
                        })

                comparisons.append({
                    "candidate": t,
                    "n": pr.n,
                    "delta": pr.delta,
                    "ci": [pr.ci_low, pr.ci_high],
                    "p_value": pr.p_value,
                    "mcnemar_p": mcnemar_exact(len(improvements), len(regressions)),
                    "verdict": _verdict(pr.verdict, incomplete),
                    "error_rates": {baseline: summaries[baseline]["error_rate"], t: summaries[t]["error_rate"]},
                    "wins": sum(1 for x, y in zip(a, b) if y > x),
                    "ties": sum(1 for x, y in zip(a, b) if y == x),
                    "losses": sum(1 for x, y in zip(a, b) if y < x),
                    "regressions": [example(c) for c in regressions[:max_examples]],
                    "improvements": [example(c) for c in improvements[:max_examples]],
                    "n_regressions": len(regressions),
                    "n_improvements": len(improvements),
                })

        for t in tr:
            for cid, v in per_case[t].items():
                dim_scores[any_run.dimension][t][(bname, cid)] = v["score"]
            dim_ops[any_run.dimension][t].append(summaries[t])

        saturated = len(summaries) >= 2 and all(sm["n_cases"] and sm["mean_score"] >= SATURATION_SCORE for sm in summaries.values())
        if saturated:
            warnings.append(f"{bname}: {SATURATION_TEXT}.")
        for t, sm in summaries.items():
            if sm["n_errors"]:
                errors[t][bname] = {"n_errors": sm["n_errors"], "n_calls": sm["n_calls"], "rate": sm["error_rate"], "reasons": sm["error_reasons"]}
                warnings.append(f"{bname}/{t}: {sm['n_errors']} of {sm['n_calls']} calls errored and are not scored"
                                f" ({sm['error_reasons'][0]['reason']}).")

        benchmarks.append({
            "name": bname,
            "version": any_run.benchmark_version,
            "fingerprint": any_run.benchmark_fingerprint,
            "dimension": any_run.dimension,
            "source": any_run.source,
            "summaries": summaries,
            "comparisons": comparisons,
            "saturated": saturated,
            "saturation_message": SATURATION_TEXT if saturated else None,
        })

    # Dimension roll-up on cases every target shares, so quality numbers are comparable.
    dimensions = {}
    dimension_comparisons: dict[str, dict[str, dict]] = {}
    recommendations = []
    for dim, per_t in sorted(dim_scores.items()):
        shared = set.intersection(*(set(v) for v in per_t.values()))
        if not shared:
            continue
        keys = sorted(shared)
        aligned = {t: [per_t[t][k] for k in keys] for t in per_t}
        stats = {}
        for t, scores in aligned.items():
            ops = dim_ops[dim][t]
            calls = sum(o["n_calls"] - o["n_errors"] for o in ops) or 1
            stats[t] = {
                "quality": mean(scores),
                "quality_ci": mean_ci(scores),
                "vendor": _vendor(next(iter(dim_ops[dim][t]))["model"] or t),
                "cost_per_case": sum(o["cost_usd"] for o in ops) / calls,
                "latency_p50": mean(o["latency_p50"] for o in ops),
                "latency_p95": max(o["latency_p95"] for o in ops),
                "error_rate": _err_rate(ops),
                "incomplete": _err_rate(ops) > MAX_ERROR_RATE,
            }
        dimensions[dim] = {"n_cases": len(keys), "label": capability(dim)["label"], "targets": stats}
        if baseline in aligned:
            dimension_comparisons[dim] = {
                t: _compare(aligned[baseline], aligned[t],
                            max(_err_rate(dim_ops[dim][baseline]), _err_rate(dim_ops[dim][t])) > MAX_ERROR_RATE)
                for t in aligned if t != baseline
            }
        recommendations.append(_recommend(dim, stats, aligned, min_quality))
        if len(keys) < 10:
            warnings.append(f"{dim}: only {len(keys)} shared cases; verdicts need at least 10.")

    dim_quality = {d: {t: v["quality"] for t, v in info["targets"].items()} for d, info in dimensions.items()}
    profiles = profile_rankings(dim_quality, load_profiles(profiles_path))

    # Overall: every case the candidate shares with the baseline, pooled across dimensions.
    overall = {}
    base_all = {(d, k): v for d, per_t in dim_scores.items() for k, v in per_t.get(baseline, {}).items()}
    for t in targets:
        if t == baseline:
            continue
        cand_all = {(d, k): v for d, per_t in dim_scores.items() for k, v in per_t.get(t, {}).items()}
        keys = sorted(set(base_all) & set(cand_all))
        if keys:
            err = max(_err_rate([o for d in dim_ops.values() for o in d.get(x, [])]) for x in (baseline, t))
            overall[t] = _compare([base_all[k] for k in keys], [cand_all[k] for k in keys], err > MAX_ERROR_RATE)

    flagged_out = {}
    for t, items in flagged.items():
        items.sort(key=lambda f: (FLAG_ORDER[f["kind"]], TAG_ORDER[f["tag"]], -abs(f["delta"])))
        counts: dict[str, int] = defaultdict(int)
        for f in items:
            counts[f["kind"]] += 1
            counts[f"{f['kind']}_{f['tag']}"] += 1
        flagged_out[t] = {"counts": dict(counts), "items": items[:max_flagged]}

    total_cost = {t: sum(b["summaries"][t]["cost_usd"] for b in benchmarks if t in b["summaries"]) for t in targets}
    rep = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "baseline": baseline,
        "errors": errors,
        "headline": _headline(baseline, benchmarks),
        "targets": {t: next(r.target_config for r in runs if r.target_name == t) for t in targets},
        "benchmarks": benchmarks,
        "dimensions": dimensions,
        "dimension_comparisons": dimension_comparisons,
        "overall": overall,
        "flagged": flagged_out,
        "recommendations": recommendations,
        "profiles": profiles,
        "total_cost_usd": total_cost,
        "warnings": sorted(set(warnings)),
    }
    rep["summary"] = build_summary(rep)
    rep["suggestions"] = suggestions(rep)
    return finite(rep)


def _recommend(dim: str, stats: dict, aligned: dict, min_quality: float) -> dict[str, Any]:
    """Recommend only among targets with a trustworthy error rate: a failing model is not "cheap and good"."""
    ok = [t for t in stats if stats[t]["error_rate"] <= MAX_ERROR_RATE]
    out = {"not_recommendable": [t for t in stats if t not in ok]}
    if not ok:
        return {**out, "dimension": dim, "recommended": "—", "best_quality": "—", "best_value": "—",
                "fastest_acceptable": None, "n_cases": len(next(iter(aligned.values()), [])),
                "summary": "Every target has too many errors to recommend one. Fix errors and re-run."}
    rec = recommend_dimension(dim, {t: stats[t] for t in ok}, {t: aligned[t] for t in ok}, min_quality=min_quality)
    return {**rec, **out}


def _headline(baseline: str, benchmarks: list[dict]) -> list[dict]:
    """Per candidate: count of dimensions where it is better / worse / inconclusive vs baseline."""
    tally: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for b in benchmarks:
        for c in b["comparisons"]:
            tally[c["candidate"]][c["verdict"]].append(b["name"])
    out = []
    for cand, v in tally.items():
        better, worse, incomplete = v.get("better", []), v.get("worse", []), v.get("incomplete", [])
        if incomplete:
            overall = "incomplete"  # errors make every other verdict untrustworthy
        elif better and not worse:
            overall = "better"
        elif worse and not better:
            overall = "worse"
        elif better and worse:
            overall = "mixed"
        elif v.get("equivalent") and not (v.get("inconclusive") or v.get("insufficient_data")):
            overall = "equivalent"
        else:
            overall = "inconclusive"
        out.append({
            "candidate": cand,
            "baseline": baseline,
            "overall": overall,
            "better_on": better,
            "worse_on": worse,
            "equivalent_on": v.get("equivalent", []),
            "incomplete_on": incomplete,
            "inconclusive_on": v.get("inconclusive", []) + v.get("insufficient_data", []),
        })
    return out

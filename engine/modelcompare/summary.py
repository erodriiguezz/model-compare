"""Plain-language layer over a comparison report: a decision line, markers and capability verdicts.

Written for readers who won't parse confidence intervals (CTO, PM). Every number here is derived
from the statistical report, so the evidence section and the summary can never disagree.
"""

from __future__ import annotations

import math
from typing import Any

from modelcompare.runner import price_per_million
from modelcompare.schema import TargetConfig
from modelcompare.stats import EQUIV_MARGIN, MAX_ERROR_RATE, wilson_ci

CAPABILITIES: dict[str, tuple[str, str]] = {
    "reasoning": ("Solves multi-step problems", "Math word problems, date arithmetic and logic puzzles with one right answer."),
    "knowledge": ("Knows established facts", "Closed-book multiple choice on stable facts."),
    "coding": ("Writes working code", "Implements functions that must pass hidden unit tests."),
    "software_delivery": ("Handles SDLC work", "Turns specs into acceptance criteria, builds features, fixes bugs, writes tests that catch bugs, reviews diffs."),
    "instruction_following": ("Follows instructions exactly", "Meets every formatting and content constraint in the prompt."),
    "structured_output": ("Produces valid structured data", "Extracts fields from messy text into schema-valid JSON."),
    "tool_calling": ("Uses tools correctly", "Calls the right function with the right arguments, and none when no tool fits."),
    "long_context": ("Finds facts in long documents", "Locates and combines details buried in documents of 8k–60k tokens."),
    "factuality": ("Sticks to the source", "Answers only from the given document and says so when the answer isn't there."),
    "calibration": ("Knows when it's unsure", "Confidence matches how often it's actually right."),
    "summarization": ("Summarises faithfully", "Keeps the key facts, respects length limits and invents nothing."),
    "safety_over_refusal": ("Helps with legitimate requests", "Doesn't refuse benign questions that merely sound risky."),
    "safety_harmful": ("Refuses harmful requests", "Declines clearly dangerous asks."),
    "robustness": ("Unshaken by noise", "Gives the same answer despite typos, distractors and reordering."),
    "multilingual": ("Works across languages", "Reasoning and extraction in Spanish, French, German, Portuguese, Japanese and Chinese."),
    "agentic": ("Completes multi-step tasks", "Drives tools over several turns to finish a task."),
    "custom": ("Your own tasks", "Benchmarks from benchmarks/custom/."),
}

VERDICT_WORDS = {
    "better": "Better",
    "worse": "Worse",
    "equivalent": "Equivalent (within 3 points)",
    "inconclusive": "No measurable difference",
    "insufficient_data": "Not enough tests to tell",
    "incomplete": "Incomplete: Fix errors and re-run",
}


def capability(dim: str) -> dict[str, str]:
    label, desc = CAPABILITIES.get(dim, (dim.replace("_", " ").capitalize(), ""))
    return {"dimension": dim, "label": label, "description": desc}


def _markers(rep: dict[str, Any], t: str) -> dict[str, Any]:
    sums = [b["summaries"][t] for b in rep["benchmarks"] if t in b["summaries"]]
    n_cases = sum(s["n_cases"] for s in sums)
    passed = round(sum(s["pass_rate"] * s["n_cases"] for s in sums))
    calls = sum(s["n_calls"] for s in sums) or 1
    ok_calls = sum(s["n_calls"] - s["n_errors"] for s in sums) or 1
    tin, tout = sum(s["input_tokens"] for s in sums), sum(s["output_tokens"] for s in sums)
    p_in, p_out = price_per_million(TargetConfig.model_validate(rep["targets"][t]))
    # List-price cost from tokens, so cached (free) re-runs don't make a model look cheaper.
    cost_per_1k = 1000 * (tin * p_in + tout * p_out) / 1e6 / ok_calls
    consist = [s["consistency"] for s in sums if s["consistency"] is not None]
    lo, hi = wilson_ci(passed, n_cases)
    return {
        "incomplete": any(e["rate"] > MAX_ERROR_RATE for e in rep.get("errors", {}).get(t, {}).values()),
        "task_success": passed / n_cases if n_cases else 0.0,
        "task_success_range": [lo, hi],
        "n_cases": n_cases,
        "cost_per_1k_tasks": cost_per_1k,
        "latency_p50": sum(s["latency_p50"] * s["n_calls"] for s in sums) / calls,
        "error_rate": sum(s["error_rate"] * s["n_calls"] for s in sums) / calls,
        "consistency": sum(consist) / len(consist) if consist else None,
        "regressions": rep.get("flagged", {}).get(t, {}).get("counts", {}).get("regression", 0) if t != rep["baseline"] else None,
        "sensitivity": rep.get("overall", {}).get(t, {}).get("mde") if t != rep["baseline"] else None,
    }


def _confidence(overall: dict[str, Any] | None, caps: list[dict]) -> str:
    if not overall:
        return "Low"
    unclear = sum(1 for c in caps if c["verdict"] in ("insufficient_data", "incomplete"))
    if overall["n"] >= 300 and unclear == 0:
        return "High"
    if overall["n"] >= 100 and unclear <= len(caps) // 3:
        return "Medium"
    return "Low"


def _pct_change(new: float, old: float) -> float | None:
    return None if not old else (new - old) / old


def build_summary(rep: dict[str, Any]) -> dict[str, Any]:
    base = rep["baseline"]
    markers = {t: _markers(rep, t) for t in rep["targets"]}
    decisions = []
    for t in rep["targets"]:
        if t == base:
            continue
        caps = []
        for dim, per_cand in rep.get("dimension_comparisons", {}).items():
            if t in per_cand:
                c = per_cand[t]
                caps.append({**capability(dim), "verdict": c["verdict"], "verdict_text": VERDICT_WORDS[c["verdict"]],
                             "delta_points": 100 * c["delta"], "n": c["n"], "mde_points": 100 * c["mde"] if c["mde"] == c["mde"] else None})
        caps.sort(key=lambda c: ({"worse": 0, "better": 1, "equivalent": 2, "inconclusive": 3, "insufficient_data": 4, "incomplete": 5}[c["verdict"]], c["label"]))
        overall = rep.get("overall", {}).get(t)
        m, mb = markers[t], markers[base]
        better = [c["label"] for c in caps if c["verdict"] == "better"]
        worse = [c["label"] for c in caps if c["verdict"] == "worse"]
        same = sum(1 for c in caps if c["verdict"] == "inconclusive")
        unclear = sum(1 for c in caps if c["verdict"] == "insufficient_data")
        tied = sum(1 for c in caps if c["verdict"] == "equivalent")
        incomplete = sum(1 for c in caps if c["verdict"] == "incomplete")
        cost_change = _pct_change(m["cost_per_1k_tasks"], mb["cost_per_1k_tasks"])
        speed_change = m["latency_p50"] - mb["latency_p50"]

        parts = []
        if better:
            parts.append("better at " + ", ".join(better))
        if worse:
            parts.append("worse at " + ", ".join(worse))
        if same:
            parts.append(f"no measurable difference in {same} other area{'s' if same != 1 else ''}")
        if tied:
            parts.append(f"equivalent in {tied} area{'s' if tied != 1 else ''} (within 3 points)")
        if unclear:
            parts.append(f"too few tests to judge {unclear} area{'s' if unclear != 1 else ''}")
        if incomplete:
            parts.append(f"{incomplete} area{'s' if incomplete != 1 else ''} incomplete because of errors. Fix errors and re-run")
        line = f"{t} vs {base}: " + ("; ".join(parts) if parts else "no shared tests to compare")
        if cost_change is not None:
            line += f". Cost per task {cost_change:+.0%}"
        line += f", {abs(speed_change):.1f} s {'slower' if speed_change > 0 else 'faster'} per response."

        decisions.append({
            "candidate": t,
            "baseline": base,
            "line": line,
            "overall_verdict": overall["verdict"] if overall else "insufficient_data",
            "overall_verdict_text": VERDICT_WORDS[overall["verdict"]] if overall else VERDICT_WORDS["insufficient_data"],
            "overall_delta_points": 100 * overall["delta"] if overall else None,
            "overall_range_points": [100 * overall["ci"][0], 100 * overall["ci"][1]] if overall else None,
            "sensitivity_points": 100 * overall["mde"] if overall and overall["mde"] == overall["mde"] else None,
            "confidence": _confidence(overall, caps),
            "cost_change": cost_change,
            "latency_change_s": speed_change,
            "capabilities": caps,
            "flag_counts": rep.get("flagged", {}).get(t, {}).get("counts", {}),
        })
    return {"baseline": base, "markers": markers, "decisions": decisions}


MAX_ADD_CASES = 500
MIN_ADD_CASES = 5  # an inconclusive comparison is never fixed by one more case, so don't promise it


def cases_needed(n: int, mde: float, delta: float) -> int:
    """Extra cases so the detectable difference shrinks to max(|delta|, EQUIV_MARGIN).

    MDE scales with 1/sqrt(n), so n' = n * (mde / target)^2 and the answer is ceil(n' - n), at least
    MIN_ADD_CASES. This is an approximation: it assumes the spread of per-case differences and the
    observed delta stay as they are, so treat the number as a planning estimate, not a guarantee.
    """
    target = max(abs(delta), EQUIV_MARGIN)
    return max(MIN_ADD_CASES, math.ceil(n * (mde / target) ** 2 - n))


def _money(x: float) -> str:
    return f"${x:.2f}" if x >= 0.01 else f"${x:.4f}"


def _names(labels: list[str]) -> str:
    return ", ".join(labels)


def _decision_suggestion(rep: dict[str, Any], d: dict[str, Any]) -> dict[str, Any] | None:
    t, base = d["candidate"], d["baseline"]
    caps = d["capabilities"]
    better = [c["label"] for c in caps if c["verdict"] == "better"]
    worse = [c["label"] for c in caps if c["verdict"] == "worse"]
    tied = [c for c in caps if c["verdict"] == "equivalent"]
    incomplete = any(c["verdict"] == "incomplete" for c in caps)
    data = {"better": better, "worse": worse, "equivalent": len(tied)}
    if better and worse:
        return {"kind": "tradeoff", "target": t, "data": data,
                "text": f"{t} is better at {_names(better)} but worse at {_names(worse)}. Choose by the capability you need."}
    if worse:
        return {"kind": "stay", "target": base, "data": data,
                "text": f"Stay on {base}: {t} is worse at {_names(worse)}."}
    if better and not incomplete:
        cost = d["cost_change"]
        extra = f" It costs {cost:+.0%} per task." if cost is not None else ""
        return {"kind": "switch", "target": t, "data": {**data, "cost_change": cost},
                "text": f"Switch to {t}: better at {_names(better)} and not worse anywhere else.{extra}"}
    if tied and len(tied) == len(caps):  # any open capability means no tie yet: add-cases advice covers it
        m = rep["summary"]["markers"]
        cost_t, cost_b = m[t]["cost_per_1k_tasks"], m[base]["cost_per_1k_tasks"]
        cheaper, other = (t, base) if cost_t < cost_b else (base, t)
        saving = abs(cost_t - cost_b)
        if not saving:
            return {"kind": "tie", "target": base, "data": {**data, "saving_per_1k": 0.0},
                    "text": f"Tie: {t} and {base} are equivalent and cost the same."}
        return {"kind": "tie", "target": cheaper, "data": {**data, "saving_per_1k": saving},
                "text": f"Tie: {t} and {base} are equivalent; cheaper is {cheaper} (saves {_money(saving)} / 1k tasks vs {other})."}
    return None


def suggestions(rep: dict[str, Any]) -> list[dict[str, Any]]:
    """Ordered next steps: errors first, then decisions, then advice on collecting more data."""
    fixes, decisions, advice = [], [], []
    for t, per_bench in rep.get("errors", {}).items():
        for bname, e in sorted(per_bench.items()):
            if e["rate"] > MAX_ERROR_RATE:
                reason = e["reasons"][0]["reason"] if e["reasons"] else "unknown error"
                fixes.append({
                    "kind": "fix_errors", "target": t, "benchmark": bname,
                    "text": f"Fix errors: {t} failed {e['n_errors']} of {e['n_calls']} calls in {bname} (top reason: {reason}). Re-run after fixing.",
                    "data": {"n_errors": e["n_errors"], "n_calls": e["n_calls"], "rate": e["rate"], "reason": reason},
                })
    for d in rep["summary"]["decisions"]:
        if s := _decision_suggestion(rep, d):
            decisions.append(s)
        for c in d["capabilities"]:
            if c["verdict"] not in ("inconclusive", "insufficient_data"):
                continue
            benches = [b for b in rep["benchmarks"] if b["dimension"] == c["dimension"] and d["candidate"] in b["summaries"]]
            bench = min(benches, key=lambda b: (b["summaries"][d["candidate"]]["n_cases"], b["name"]))["name"] if benches else None
            data = {"dimension": c["dimension"], "candidate": d["candidate"], "n": c["n"], "delta_points": c["delta_points"], "mde_points": c["mde_points"]}
            if c["verdict"] == "insufficient_data" or c["mde_points"] is None:
                add = max(1, 10 - c["n"])  # too few to judge at all: reach the 10-case minimum first
            else:
                add = cases_needed(c["n"], c["mde_points"] / 100, c["delta_points"] / 100)
            if add > MAX_ADD_CASES:
                advice.append({"kind": "too_small", "target": d["candidate"], "benchmark": bench, "data": {**data, "add": add},
                               "text": f"{c['label']}: the difference between {d['candidate']} and {d['baseline']} is too small to measure here."})
            else:
                advice.append({"kind": "add_cases", "target": d["candidate"], "benchmark": bench, "data": {**data, "add": add},
                               "text": f"To decide {d['candidate']} vs {d['baseline']} on {c['label'].lower()}, add {add} more cases to {bench}."})
    for b in rep["benchmarks"]:
        if b["saturated"]:
            advice.append({"kind": "saturated", "benchmark": b["name"], "data": {},
                           "text": f"Benchmark saturated: {b['name']} is too easy to separate these models. Add harder cases."})
    return fixes + decisions + advice

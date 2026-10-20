"""Render a report dict as a single self-contained HTML file (no external assets)."""

from __future__ import annotations

import json
import math
from html import escape
from typing import Any

from modelcompare.summary import capability

PALETTE = ["#2f6fdf", "#e0782f", "#2e9e6b", "#b04fc4", "#c9a227", "#d64555"]

CSS = """
:root{--bg:#fbfbfa;--fg:#1d1d1f;--muted:#6b6b70;--card:#fff;--line:#e4e4e7;--good:#1f8a4c;--bad:#c23a3a;--warn:#a86b00;--chip:#f1f1f3}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececef;--muted:#9a9aa2;--card:#1c1c20;--line:#2c2c33;--good:#4cc27f;--bad:#f0706b;--warn:#e2a93b;--chip:#26262c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px 80px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:40px 0 12px}h3{font-size:16px;margin:24px 0 8px}
.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:12px 0}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}.scroll{overflow-x:auto}
.v{display:inline-block;padding:1px 9px;border-radius:99px;font-size:12.5px;font-weight:600;background:var(--chip)}
.v.better{color:var(--good)}.v.worse{color:var(--bad)}.v.mixed{color:var(--warn)}.v.inconclusive,.v.insufficient_data,.v.equivalent{color:var(--muted)}.v.incomplete{color:var(--warn)}
.big{font-size:22px;font-weight:650}.warn{border-left:3px solid var(--warn)}ul{margin:6px 0;padding-left:20px}
details{border-top:1px solid var(--line);padding:8px 0}summary{cursor:pointer}pre{white-space:pre-wrap;word-break:break-word;background:var(--chip);padding:10px;border-radius:8px;font-size:12.5px;max-height:320px;overflow:auto}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media (max-width:700px){.pair{grid-template-columns:1fr}}
.legend span{display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:13px}.dot{width:10px;height:10px;border-radius:50%}
svg text{fill:var(--muted);font-size:11px}
.small{font-size:12.5px}.lead{font-size:16.5px;margin:10px 0}.bad{color:var(--bad)}dd{margin:0 0 8px}
details.evidence>summary{font-weight:600;padding:6px 0}
"""


def _f(x: Any, digits: int = 3) -> str:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "—"
    return f"{x:.{digits}f}" if isinstance(x, float) else str(x)


def _pct(x: float | None) -> str:
    return "—" if x is None else f"{100 * x:.1f}%"


def _usd(x: float) -> str:
    return f"${x:.4f}" if x < 1 else f"${x:,.2f}"


def _chip(v: str, text: str | None = None) -> str:
    return f'<span class="v {escape(v)}">{escape(text or v.replace("_", " "))}</span>'


def radar(dimensions: dict[str, dict], targets: list[str]) -> str:
    dims = list(dimensions)
    if len(dims) < 3:
        return ""
    size, cx, cy, r = 420, 210, 205, 150
    angle = lambda i: -math.pi / 2 + 2 * math.pi * i / len(dims)  # noqa: E731
    pt = lambda i, v: (cx + r * v * math.cos(angle(i)), cy + r * v * math.sin(angle(i)))  # noqa: E731
    parts = [f'<svg viewBox="0 0 {size} {size}" width="100%" style="max-width:460px" role="img" aria-label="Quality by dimension">']
    for ring in (0.25, 0.5, 0.75, 1.0):
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in (pt(i, ring) for i in range(len(dims))))
        parts.append(f'<polygon points="{pts}" fill="none" stroke="currentColor" stroke-opacity=".15"/>')
    for i, d in enumerate(dims):
        x, y = pt(i, 1.0)
        lx, ly = pt(i, 1.17)
        anchor = "middle" if abs(lx - cx) < 20 else ("start" if lx > cx else "end")
        parts.append(f'<line x1="{cx}" y1="{cy}" x2="{x:.1f}" y2="{y:.1f}" stroke="currentColor" stroke-opacity=".15"/>')
        parts.append(f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="{anchor}" dominant-baseline="middle">{escape(d.replace("_", " "))}</text>')
    for k, t in enumerate(targets):
        color = PALETTE[k % len(PALETTE)]
        vals = [dimensions[d]["targets"].get(t, {}).get("quality", 0.0) for d in dims]
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in (pt(i, v) for i, v in enumerate(vals)))
        parts.append(f'<polygon points="{pts}" fill="{color}" fill-opacity=".12" stroke="{color}" stroke-width="2"/>')
    parts.append("</svg>")
    return "".join(parts)


def _output_block(label: str, v: dict) -> str:
    body = v.get("text") or ""
    if v.get("tool_calls"):
        body += ("\n" if body else "") + "tool_calls: " + json.dumps(v["tool_calls"], indent=1)
    if v.get("error"):
        body = f"ERROR: {v['error']}"
    reasons = "; ".join(r for r in v.get("reasons", []) if r)
    return f'<div><div class="muted">{escape(label)} · score {v["score"]:.2f}{" · " + escape(reasons) if reasons else ""}</div><pre>{escape(body)}</pre></div>'


def _signed(x: float | None, unit: str = "", digits: int = 1) -> str:
    return "—" if x is None else f"{x:+.{digits}f}{unit}"


def _decision(rep: dict[str, Any]) -> list[str]:
    sm = rep["summary"]
    base = rep["baseline"]
    h = ["<h2>Decision</h2>"]
    for d in sm["decisions"]:
        rng = d["overall_range_points"]
        h.append(f'<div class="card decision"><div class="muted small">{escape(d["candidate"])} compared with {escape(base)} (baseline)</div>')
        detail = ""
        if rng:
            detail = f" <span class='muted'>({_signed(d['overall_delta_points'], ' pts')}, likely between {rng[0]:+.1f} and {rng[1]:+.1f})</span>"
        h.append(f'<div class="big">{_chip(d["overall_verdict"], d["overall_verdict_text"])} overall{detail}</div>')
        h.append(f'<p class="lead">{escape(d["line"])}</p>')
        sens = d["sensitivity_points"]
        sens_text = f" · this run can detect overall changes of about {sens:.1f} points or more; smaller changes may exist but are within noise" if sens is not None else ""
        h.append(f'<div class="muted small">Confidence: <b>{escape(d["confidence"])}</b>{sens_text}.</div></div>')
    if not sm["decisions"]:
        h.append('<div class="card muted">Only one target in this report. Add a second target to get a verdict.</div>')

    h.append("<h3>Markers</h3><div class='scroll'><table><tr><th>Target</th><th class='num'>Task success</th><th class='num'>Cost / 1k tasks</th>"
             "<th class='num'>Typical response</th><th class='num'>Errors</th><th class='num'>Consistency</th><th class='num'>Regressions</th></tr>")
    for t, m in sm["markers"].items():
        lo, hi = m["task_success_range"]
        h.append(f"<tr><td><b>{escape(t)}</b>{' <span class=muted>(baseline)</span>' if t == base else ''}</td>"
                 f"<td class='num'>{_pct(m['task_success'])} <span class='muted small'>({_pct(lo)}–{_pct(hi)})</span></td>"
                 f"<td class='num'>{_usd(m['cost_per_1k_tasks'])}</td><td class='num'>{m['latency_p50']:.1f}s</td>"
                 f"<td class='num {'bad' if m['error_rate'] > 0.02 else ''}'>{_pct(m['error_rate'])}</td>"
                 f"<td class='num'>{_pct(m['consistency'])}</td><td class='num'>{'—' if m['regressions'] is None else m['regressions']}</td></tr>")
    h.append("</table></div><div class='muted small'>Task success: share of tasks fully passed (range = 95% interval). Cost uses list prices on the tokens actually used, so cached re-runs don't distort it. Consistency: how often repeats of the same task agree. Regressions: tasks the baseline passed that this model failed.</div>")
    return h


def _capabilities(rep: dict[str, Any]) -> list[str]:
    h = []
    for d in rep["summary"]["decisions"]:
        if not d["capabilities"]:
            continue
        h.append(f"<h2>Capabilities · {escape(d['candidate'])} vs {escape(d['baseline'])}</h2><div class='card scroll'><table>"
                 "<tr><th>Capability</th><th>Verdict</th><th class='num'>Change</th><th class='num'>Detectable</th><th class='num'>Tests</th></tr>")
        for c in d["capabilities"]:
            mde = "—" if c["mde_points"] is None else "≥ {:.0f} pts".format(c["mde_points"])
            h.append(f"<tr><td><b>{escape(c['label'])}</b><div class='muted small'>{escape(c['description'])}</div></td>"
                     f"<td>{_chip(c['verdict'], c['verdict_text'])}</td><td class='num'>{_signed(c['delta_points'], ' pts')}</td>"
                     f"<td class='num'>{mde}</td><td class='num'>{c['n']}</td></tr>")
        h.append("</table><div class='muted small'>Change: difference in average score (0–100). Detectable: the smallest change these tests can reliably see; a \"no measurable difference\" verdict only rules out changes larger than this.</div></div>")
    return h


TAG_TEXT = {"consistent": "every repeat agrees", "noisy": "repeats disagree", "single_run": "one run each"}


def _flagged(rep: dict[str, Any], show: int = 40) -> list[str]:
    h = []
    base = rep["baseline"]
    for t, fl in rep.get("flagged", {}).items():
        c = fl["counts"]
        h.append(f"<h2>Flagged changes · {escape(t)}</h2><div class='card'>")
        h.append(f"<p>{c.get('regression', 0)} regressions ({c.get('regression_consistent', 0)} consistent) · "
                 f"{c.get('improvement', 0)} improvements ({c.get('improvement_consistent', 0)} consistent) · "
                 f"{c.get('score_change', 0)} partial score changes. Consistent flips are the ones to read first; noisy ones may be chance.</p>")
        for f in fl["items"][:show]:
            label = {"regression": "Regression", "improvement": "Improvement", "score_change": "Score change"}[f["kind"]]
            h.append(f'<details><summary><span class="v {"worse" if f["kind"] == "regression" else "better" if f["kind"] == "improvement" else "inconclusive"}">{label}</span> '
                     f'{escape(capability(f["dimension"])["label"])} · <b>{escape(f["case_id"])}</b> '
                     f'<span class="muted small">{escape(f["benchmark"])} · {_signed(100 * f["delta"], " pts", 0)} · {TAG_TEXT[f["tag"]]}</span></summary>'
                     f'<div class="pair">{_output_block(base, f["baseline"])}{_output_block(t, f["candidate"])}</div></details>')
        if len(fl["items"]) > show:
            h.append(f"<p class='muted small'>{len(fl['items']) - show} more in the JSON report and the dashboard's case view.</p>")
        h.append("</div>")
    return h


GLOSSARY = [
    ("Better / Worse", "The difference is larger than chance would explain (95% confidence), in that direction."),
    ("No measurable difference", "Any difference is smaller than these tests can detect. It does not mean identical."),
    ("Equivalent", "The 90% range of the difference sits inside +/-3 points: the models are close enough to treat as a tie."),
    ("Incomplete", "More than 10% of calls errored on either side. Errors are not scored; fix them and re-run."),
    ("Not enough tests to tell", "Fewer than 10 shared tests; no verdict is attempted."),
    ("Points", "Average task score on a 0–100 scale. +3 pts means the candidate scores 3 points higher on average."),
    ("Consistent flip", "A task where every repeat of each model agreed, and the outcome changed between models. Likely a real change."),
    ("Baseline", "The model you use today. Every other model is judged relative to it."),
]


def render_html(rep: dict[str, Any]) -> str:
    targets = list(rep["targets"])
    base = rep["baseline"]
    h: list[str] = [f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>ModelCompare Report</title><style>{CSS}</style></head><body><main>"]
    h.append("<h1>Model comparison report</h1>")
    h.append(f'<div class="muted">Baseline <b>{escape(base)}</b> · {len(targets)} targets · {len(rep["benchmarks"])} benchmarks · generated {escape(rep["generated_at"][:19])} UTC</div>')
    h.append('<div class="legend" style="margin-top:10px">' + "".join(
        f'<span><i class="dot" style="background:{PALETTE[i % len(PALETTE)]}"></i>{escape(t)} <span class="muted">({escape(rep["targets"][t].get("model", ""))})</span></span>'
        for i, t in enumerate(targets)) + "</div>")

    h += _decision(rep)
    h += _capabilities(rep)
    h += _flagged(rep)

    if rep["warnings"]:
        h.append("<h2>Caveats</h2><div class='card warn'><ul>" + "".join(f"<li>{escape(w)}</li>" for w in rep["warnings"]) + "</ul></div>")

    h.append("<h2>Evidence for engineers</h2><p class='muted small'>Per-benchmark statistics, recommendations, decision profiles and side-by-side outputs.</p><details class='evidence'><summary>Show the full statistical detail</summary>")
    h += _evidence(rep, targets, base)
    h.append("</details>")

    h.append("<h2>Glossary</h2><div class='card'><dl>" + "".join(f"<dt><b>{escape(k)}</b></dt><dd class='muted'>{escape(v)}</dd>" for k, v in GLOSSARY) + "</dl></div>")
    h.append("</main></body></html>")
    return "".join(h)


def _evidence(rep: dict[str, Any], targets: list[str], base: str) -> list[str]:
    h: list[str] = []
    # Verdict
    h.append("<h3>Verdict tally by benchmark</h3><div class='grid'>")
    for hd in rep["headline"]:
        h.append(f'<div class="card"><div class="muted">{escape(hd["candidate"])} vs {escape(hd["baseline"])}</div><div class="big">{_chip(hd["overall"])}</div><ul>')
        if hd["better_on"]:
            h.append(f'<li>Better on: {escape(", ".join(hd["better_on"]))}</li>')
        if hd["worse_on"]:
            h.append(f'<li>Worse on: {escape(", ".join(hd["worse_on"]))}</li>')
        if hd["inconclusive_on"]:
            h.append(f'<li class="muted">No significant difference: {escape(", ".join(hd["inconclusive_on"]))}</li>')
        if hd.get("equivalent_on"):
            h.append(f'<li class="muted">Equivalent (within 3 points): {escape(", ".join(hd["equivalent_on"]))}</li>')
        if hd.get("incomplete_on"):
            h.append(f'<li>Incomplete, fix errors and re-run: {escape(", ".join(hd["incomplete_on"]))}</li>')
        h.append("</ul></div>")
    h.append("</div>")

    # Recommendations
    if rep["recommendations"]:
        h.append("<h3>Recommendations by dimension</h3><div class='card scroll'><table><tr><th>Dimension</th><th>Recommended</th><th>Best quality</th><th>Best value</th><th>Fastest ≥ threshold</th><th class='num'>n</th><th>Why</th></tr>")
        for r in rep["recommendations"]:
            h.append(f'<tr><td>{escape(r["dimension"])}</td><td><b>{escape(r["recommended"])}</b></td><td>{escape(r["best_quality"])}</td><td>{escape(r["best_value"])}</td><td>{escape(r["fastest_acceptable"] or "—")}</td><td class="num">{r["n_cases"]}</td><td class="muted">{escape(r["summary"])}</td></tr>')
        h.append("</table></div>")

    # Profiles
    if rep["profiles"]:
        h.append("<h3>Decision profiles</h3><div class='grid'>")
        for p in rep["profiles"]:
            rows = "".join(f'<tr><td>{i + 1}. {escape(x["target"])}</td><td class="num">{x["score"]:.3f}</td></tr>' for i, x in enumerate(p["ranking"]))
            miss = f'<div class="muted" style="font-size:12.5px">Coverage {_pct(p["coverage"])}; not measured: {escape(", ".join(p["missing_dimensions"]))}</div>' if p["missing_dimensions"] else ""
            h.append(f'<div class="card"><b>{escape(p["profile"])}</b><div class="muted" style="font-size:13px">{escape(p["description"])}</div><table>{rows}</table>{miss}</div>')
        h.append("</div>")

    # Scorecard
    if rep["dimensions"]:
        h.append("<h3>Scorecard</h3><div class='card'>" + radar(rep["dimensions"], targets) + "<div class='scroll'><table><tr><th>Dimension</th>")
        h.append("".join(f"<th class='num'>{escape(t)}</th>" for t in targets) + "</tr>")
        for d, info in rep["dimensions"].items():
            h.append(f"<tr><td>{escape(d)} <span class='muted'>(n={info['n_cases']})</span></td>")
            h.append("".join(f"<td class='num'>{_f(info['targets'].get(t, {}).get('quality'))}</td>" for t in targets) + "</tr>")
        h.append("</table></div></div>")

    # Operational
    h.append("<h3>Cost & latency</h3><div class='card scroll'><table><tr><th>Target</th><th class='num'>Total cost</th><th class='num'>Cost / 1k tasks</th><th class='num'>p50 latency</th><th class='num'>p95 latency</th><th class='num'>Error rate</th></tr>")
    for t in targets:
        sums = [b["summaries"][t] for b in rep["benchmarks"] if t in b["summaries"]]
        calls = sum(s["n_calls"] for s in sums) or 1
        cost = sum(s["cost_usd"] for s in sums)
        p50 = sum(s["latency_p50"] * s["n_calls"] for s in sums) / calls
        p95 = max((s["latency_p95"] for s in sums), default=0.0)
        err = sum(s["error_rate"] * s["n_calls"] for s in sums) / calls
        h.append(f"<tr><td>{escape(t)}</td><td class='num'>{_usd(cost)}</td><td class='num'>{_usd(1000 * cost / calls)}</td><td class='num'>{p50:.2f}s</td><td class='num'>{p95:.2f}s</td><td class='num'>{_pct(err)}</td></tr>")
    h.append("</table><div class='muted' style='font-size:12.5px;margin-top:6px'>Cached responses count as $0; rerun with --no-cache for true spend.</div></div>")

    # Per-benchmark detail
    h.append("<h3>Benchmarks</h3>")
    for b in rep["benchmarks"]:
        h.append(f'<div class="card"><h3 style="margin-top:0">{escape(b["name"])} <span class="muted">· {escape(b["dimension"])} · v{escape(b["version"])} · {escape(b["fingerprint"])}</span></h3>')
        h.append("<div class='scroll'><table><tr><th>Target</th><th class='num'>Mean score</th><th class='num'>Pass rate (95% CI)</th><th class='num'>Consistency</th><th class='num'>Cost</th><th class='num'>p50</th><th class='num'>Errors</th></tr>")
        for t, sm in b["summaries"].items():
            lo, hi = sm["pass_rate_ci"]
            h.append(f"<tr><td>{escape(t)}</td><td class='num'>{sm['mean_score']:.3f}</td><td class='num'>{_pct(sm['pass_rate'])} ({_pct(lo)}–{_pct(hi)})</td><td class='num'>{_f(sm['consistency'])}</td><td class='num'>{_usd(sm['cost_usd'])}</td><td class='num'>{sm['latency_p50']:.2f}s</td><td class='num'>{_pct(sm['error_rate'])}</td></tr>")
        h.append("</table></div>")
        for c in b["comparisons"]:
            h.append(f'<p>{escape(c["candidate"])} vs {escape(base)}: {_chip(c["verdict"])} Δ {c["delta"]:+.3f} (95% CI {c["ci"][0]:+.3f} to {c["ci"][1]:+.3f}, p={c["p_value"]:.3f}, McNemar p={c["mcnemar_p"]:.3f}) · W/T/L {c["wins"]}/{c["ties"]}/{c["losses"]}</p>')
            for kind, label in (("regressions", "Regressions (baseline passed, candidate failed)"), ("improvements", "Improvements")):
                if c[kind]:
                    h.append(f'<details><summary>{label}: {c["n_" + kind]}</summary>')
                    for ex in c[kind]:
                        h.append(f'<h3>{escape(ex["case_id"])}</h3><div class="pair">{_output_block(base, ex["baseline"])}{_output_block(c["candidate"], ex["candidate"])}</div>')
                    h.append("</details>")
        h.append("</div>")

    return h

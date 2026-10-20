"""Plain-language summary, flagged changes, sensitivity and cancellation (mock targets, no network)."""

import math

from test_end_to_end import N, bench, mock

from modelcompare import db
from modelcompare.html_report import render_html
from modelcompare.report import _flag, build_report, latest_runs
from modelcompare.runner import run_benchmark
from modelcompare.stats import min_detectable_diff


async def _report(db_url, base_correct, cand_correct, n_bench=2, **kw):
    for i in range(n_bench):
        b = bench(f"b{i}", ["reasoning", "coding"][i % 2])
        await run_benchmark(mock("base", base_correct), b, db_url=db_url)
        await run_benchmark(mock("cand", cand_correct), b, db_url=db_url)
    with db.session(db_url) as s:
        return build_report(s, latest_runs(s, ["base", "cand"]), baseline="base", **kw)


def _decision(rep):
    (d,) = rep["summary"]["decisions"]
    return d


async def test_better_candidate_reads_as_better(db_url):
    rep = await _report(db_url, set(range(8)), set(range(N)))
    d = _decision(rep)
    assert d["overall_verdict"] == "better" and d["overall_verdict_text"] == "Better"
    assert {c["label"] for c in d["capabilities"] if c["verdict"] == "better"} == {"Solves multi-step problems", "Writes working code"}
    assert d["line"].startswith("cand vs base: better at")
    assert rep["flagged"]["cand"]["counts"]["improvement"] == 2 * (N - 8)
    assert rep["summary"]["markers"]["cand"]["task_success"] == 1.0
    assert rep["summary"]["markers"]["cand"]["regressions"] == 0


async def test_worse_candidate_lists_regressions_first(db_url):
    rep = await _report(db_url, set(range(N)), set(range(5)))
    d = _decision(rep)
    assert d["overall_verdict"] == "worse"
    items = rep["flagged"]["cand"]["items"]
    assert items[0]["kind"] == "regression" and items[0]["tag"] == "single_run"
    assert rep["summary"]["markers"]["cand"]["regressions"] == 2 * (N - 5)


async def test_identical_models_are_equivalent_with_sensitivity(db_url):
    rep = await _report(db_url, set(range(10)), set(range(10)))
    d = _decision(rep)
    assert d["overall_verdict"] == "equivalent" and d["overall_verdict_text"].startswith("Equivalent")
    assert "equivalent in 2 areas" in d["line"]
    assert "cand" not in rep["flagged"]
    assert d["sensitivity_points"] > 0  # never claims infinite precision


async def test_too_few_cases_says_so(db_url):
    for name, correct in (("base", {0}), ("cand", {1})):
        await run_benchmark(mock(name, correct), bench("tiny").model_copy(update={"cases": bench().cases[:5]}), db_url=db_url)
    with db.session(db_url) as s:
        rep = build_report(s, latest_runs(s, ["base", "cand"]), baseline="base")
    d = _decision(rep)
    assert d["overall_verdict"] == "insufficient_data" and d["confidence"] == "Low"
    html = render_html(rep)
    assert "Not enough tests to tell" in html and "Decision" in html and "Glossary" in html


def test_flag_tags():
    def pc(score, pass_rate, repeats=3, std=0.0):
        return {"score": score, "pass_rate": pass_rate, "repeats": repeats, "std": std}

    assert _flag(pc(1, 1), pc(1, 1)) is None
    assert _flag(pc(1, 1), pc(0, 0)) == ("regression", "consistent")
    assert _flag(pc(1, 1), pc(1 / 3, 1 / 3, std=0.47)) == ("regression", "noisy")
    assert _flag(pc(0, 0), pc(1, 1, repeats=1)) == ("improvement", "single_run")
    assert _flag(pc(0.5, 1), pc(0.75, 1)) == ("score_change", "consistent")


def test_min_detectable_diff():
    assert math.isnan(min_detectable_diff([0.0]))
    # 100 cases, 10% disagree one way: spread ~0.3 -> about 0.084
    diffs = [1.0] * 10 + [0.0] * 90
    assert 0.07 < min_detectable_diff(diffs) < 0.1
    # More cases, smaller detectable change.
    assert min_detectable_diff(diffs * 4) < min_detectable_diff(diffs) / 1.9
    # All-agree runs fall back to the one-in-n floor instead of zero.
    assert min_detectable_diff([0.0] * 100) > 0


async def test_should_stop_cancels_run(db_url):
    seen = []
    out = await run_benchmark(mock("m", set()), bench(), db_url=db_url, concurrency=1,
                              on_result=seen.append, should_stop=lambda: len(seen) >= 3)
    assert out.status == "cancelled" and len(out.results) == 3


def test_mark_interrupted(db_url):
    with db.session(db_url) as s:
        s.add(db.Run(target_name="t", target_config={}, benchmark_name="b", benchmark_version="1",
                     benchmark_fingerprint="x", dimension="reasoning"))
        s.add(db.Job(id="j1", status="running"))
        s.commit()
        assert db.mark_interrupted(s) == 2
        assert s.get(db.Job, "j1").status == "interrupted"

"""Full run -> compare -> report flow with mock targets (no network, no API keys)."""

import json

import pytest

from typer.testing import CliRunner

from modelcompare import db
from modelcompare.cli import app
from modelcompare.html_report import render_html
from modelcompare.report import build_report, latest_runs
from modelcompare.runner import run_benchmark
from modelcompare.schema import Benchmark, TargetConfig

N = 20


def bench(name="arith", dimension="reasoning"):
    return Benchmark(
        name=name, dimension=dimension,
        scorers=[{"type": "numeric"}],
        cases=[{"id": f"q{i}", "input": f"What is {i} + {i}?", "expected": 2 * i} for i in range(N)],
    )


def mock(name, correct: set[int], price=(1.0, 2.0), latency=0.0):
    responses = {f"q{i}": f"ANSWER: {2 * i if i in correct else -1}" for i in range(N)}
    return TargetConfig(name=name, kind="mock", model=f"mock/{name}",
                        extra={"responses": responses, "latency_s": latency},
                        pricing={"input": price[0], "output": price[1]})


async def test_candidate_better_with_regressions(db_url):
    old = mock("old", correct=set(range(0, 10)) | {15})       # 11/20
    new = mock("new", correct=set(range(1, 20)) - {15})       # 18/20, regresses on q0 and q15
    b = bench()
    r_old = await run_benchmark(old, b, db_url=db_url)
    r_new = await run_benchmark(new, b, db_url=db_url)
    assert r_old.status == r_new.status == "done"

    with db.session(db_url) as s:
        rep = build_report(s, latest_runs(s, ["old", "new"]), baseline="old")

    cmp = rep["benchmarks"][0]["comparisons"][0]
    assert cmp["verdict"] == "better"
    assert {e["case_id"] for e in cmp["regressions"]} == {"q0", "q15"}
    assert cmp["n_improvements"] == 9
    assert rep["headline"][0]["overall"] == "better"
    rec = rep["recommendations"][0]
    assert rec["best_quality"] == "new" and rec["recommended"] == "new"
    html = render_html(rep)
    assert "Regressions" in html and "new vs old" in html
    json.dumps(rep, default=str)  # serialisable


async def test_tie_recommends_cheaper(db_url):
    same = set(range(N)) - {3, 7}
    pricey = mock("pricey", same, price=(10.0, 30.0))
    cheap = mock("cheap", same, price=(0.1, 0.4))
    b = bench()
    await run_benchmark(pricey, b, db_url=db_url)
    await run_benchmark(cheap, b, db_url=db_url)
    with db.session(db_url) as s:
        rep = build_report(s, latest_runs(s, ["pricey", "cheap"]))
    rec = rep["recommendations"][0]
    assert set(rec["statistical_ties"]) == {"pricey", "cheap"}
    assert rec["recommended"] == "cheap"
    assert rep["headline"][0]["overall"] == "equivalent"
    assert rep["benchmarks"][0]["comparisons"][0]["verdict"] == "equivalent"


async def test_cache_hits_cost_nothing(db_url):
    t, b = mock("m", set(range(N))), bench()
    first = await run_benchmark(t, b, db_url=db_url)
    second = await run_benchmark(t, b, db_url=db_url)
    assert first.cost_usd > 0 and second.cost_usd == 0
    assert all(r.completion.cached for r in second.results)


async def test_budget_cap_stops_run(db_url):
    t = mock("m", set(range(N)), price=(1000.0, 1000.0))
    out = await run_benchmark(t, bench(), budget_usd=0.01, concurrency=1, use_cache=False, db_url=db_url)
    assert out.status == "budget_exceeded" and len(out.results) < N


async def test_changed_benchmark_is_not_compared(db_url):
    t1, t2 = mock("a", set(range(N))), mock("b", set(range(N)))
    b1 = bench()
    b2 = b1.model_copy(update={"version": "2"})
    await run_benchmark(t1, b1, db_url=db_url)
    await run_benchmark(t2, b2, db_url=db_url)
    with db.session(db_url) as s:
        rep = build_report(s, latest_runs(s, ["a", "b"]))
    assert rep["benchmarks"] == [] and any("different benchmark revisions" in w for w in rep["warnings"])


async def test_profiles_rank_across_dimensions(db_url):
    good_reason, bad_reason = mock("reasoner", set(range(N))), mock("other", set(range(5)))
    await run_benchmark(good_reason, bench(), db_url=db_url)
    await run_benchmark(bad_reason, bench(), db_url=db_url)
    await run_benchmark(good_reason, bench("code", "coding"), db_url=db_url)
    await run_benchmark(bad_reason, bench("code", "coding"), db_url=db_url)
    with db.session(db_url) as s:
        rep = build_report(s, latest_runs(s, ["other", "reasoner"]))
    coding = next(p for p in rep["profiles"] if p["profile"] == "coding_assistant")
    assert coding["ranking"][0]["target"] == "reasoner"
    assert 0 < coding["coverage"] < 1 and "tool_calling" in coding["missing_dimensions"]


def test_cli_run_and_compare(db_url, tmp_path):
    targets = tmp_path / "targets.yaml"
    bench_file = tmp_path / "b.yaml"
    bench_file.write_text(json.dumps(bench().model_dump(mode="json")))  # JSON is valid YAML
    targets.write_text(json.dumps({"targets": [mock("old", set(range(8))).model_dump(), mock("new", set(range(N))).model_dump()]}))
    runner = CliRunner()
    res = runner.invoke(app, ["run", "-f", str(targets), "-t", "old", "-t", "new", "-b", str(bench_file), "-y"])
    assert res.exit_code == 0, res.output
    out = tmp_path / "r.html"
    res = runner.invoke(app, ["compare", "-t", "old", "-t", "new", "-o", str(out)])
    assert res.exit_code == 0, res.output
    assert "new vs old: BETTER" in res.output
    assert out.exists() and out.with_suffix(".json").exists()


def with_errors(t: TargetConfig, cases: set[int], msg="BadRequestError: temperature unsupported") -> TargetConfig:
    t.extra["errors"] = {f"q{i}": msg for i in cases}
    return t


async def test_errors_excluded_and_incomplete(db_url):
    """AC-1.1 / AC-1.2: errored calls are not scored or paired; >10% errors on a side is incomplete."""
    base = mock("base", set(range(N)))
    flaky = with_errors(mock("flaky", set(range(N))), set(range(5)))  # 25% errors, all others correct
    b = bench()
    await run_benchmark(base, b, db_url=db_url)
    await run_benchmark(flaky, b, db_url=db_url)
    with db.session(db_url) as s:
        rep = build_report(s, latest_runs(s, ["base", "flaky"]), baseline="base")

    bm = rep["benchmarks"][0]
    sm = bm["summaries"]["flaky"]
    assert sm["n_errors"] == 5 and sm["n_cases"] == 15 and sm["mean_score"] == 1.0  # errors are not zeros
    assert sm["error_reasons"][0] == {"reason": "BadRequestError: temperature unsupported", "count": 5}
    assert rep["errors"]["flaky"]["arith"]["n_errors"] == 5 and "base" not in rep["errors"]
    cmp = bm["comparisons"][0]
    assert cmp["n"] == 15 and cmp["delta"] == 0
    assert cmp["verdict"] == "incomplete" and rep["headline"][0]["overall"] == "incomplete"
    assert rep["overall"]["flaky"]["verdict"] == "incomplete"
    dec = rep["summary"]["decisions"][0]
    assert "Fix errors and re-run" in dec["line"] and "Fix errors and re-run" in dec["overall_verdict_text"]
    assert "Fix errors and re-run" in render_html(rep)


async def test_few_errors_stay_comparable(db_url):
    """AC-1.2: at or under 10% errors the comparison is still scored, on non-errored pairs only."""
    base = mock("base", set(range(N)))
    flaky = with_errors(mock("flaky", set(range(N))), {0, 1})  # exactly 10%
    b = bench()
    await run_benchmark(base, b, db_url=db_url)
    await run_benchmark(flaky, b, db_url=db_url)
    with db.session(db_url) as s:
        rep = build_report(s, latest_runs(s, ["base", "flaky"]), baseline="base")
    cmp = rep["benchmarks"][0]["comparisons"][0]
    assert cmp["n"] == 18 and cmp["verdict"] != "incomplete"
    assert rep["errors"]["flaky"]["arith"]["n_errors"] == 2


async def test_saturation_flag(db_url):
    """AC-1.4: every compared target at >=0.95 flags the benchmark as too easy."""
    easy_a, easy_b = mock("a", set(range(N))), mock("b", set(range(N)))
    hard = mock("c", set(range(10)))
    b = bench()
    for t in (easy_a, easy_b, hard):
        await run_benchmark(t, b, db_url=db_url)
    with db.session(db_url) as s:
        sat = build_report(s, latest_runs(s, ["a", "b"]), baseline="a")
        mixed = build_report(s, latest_runs(s, ["a", "c"]), baseline="a")
    assert sat["benchmarks"][0]["saturated"] is True
    assert sat["benchmarks"][0]["saturation_message"] == "Too easy to separate these models"
    assert any("Too easy to separate these models" in w for w in sat["warnings"])
    assert "Too easy to separate these models" in render_html(sat)
    assert mixed["benchmarks"][0]["saturated"] is False


async def test_single_target_is_never_saturated(db_url):
    """AC-1.4: saturation needs at least two compared targets."""
    await run_benchmark(mock("solo", set(range(N))), bench(), db_url=db_url)
    with db.session(db_url) as s:
        rep = build_report(s, latest_runs(s, ["solo"]))
    assert rep["benchmarks"][0]["saturated"] is False


async def test_run_records_temperature_fallback_even_when_cached(db_url):
    """AC-1.5: the run's target_config records the fallback, also on a cached replay."""
    t = mock("m", set(range(N)))
    t.extra["temperature_fallback"] = True
    plain = mock("plain", set(range(N)))
    b = bench()
    for target, expected in ((t, True), (t, True), (plain, None)):  # second pass replays from cache
        out = await run_benchmark(target, b, db_url=db_url)
        with db.session(db_url) as s:
            assert s.get(db.Run, out.run_id).target_config.get("temperature_fallback") is expected
    assert out.results and not any(r.completion.temperature_fallback for r in out.results)


async def test_headline_incomplete_caps_other_verdicts(db_url):
    """AC-1.2: one incomplete benchmark makes the candidate's headline incomplete, even if another is better."""
    base_ok = mock("base", set(range(10)))
    cand = mock("cand", set(range(N)))
    cand_flaky = with_errors(mock("cand", set(range(N))), set(range(5)))
    for name, c in (("good", cand), ("broken", cand_flaky)):
        b = bench(name)
        await run_benchmark(base_ok, b, db_url=db_url)
        await run_benchmark(c, b, db_url=db_url)
    with db.session(db_url) as s:
        rep = build_report(s, latest_runs(s, ["base", "cand"]), baseline="base")
    verdicts = {b["name"]: b["comparisons"][0]["verdict"] for b in rep["benchmarks"]}
    assert verdicts == {"good": "better", "broken": "incomplete"}
    assert rep["headline"][0]["overall"] == "incomplete"


async def test_failing_target_is_not_recommended_or_cheap(db_url):
    """Errored calls cost nothing, so a failing model must not look cheap or get recommended."""
    ok = mock("ok", set(range(N)), price=(10.0, 30.0))
    dead = with_errors(mock("dead", set(range(N)), price=(0.1, 0.1)), set(range(15)))
    b = bench()
    await run_benchmark(ok, b, db_url=db_url)
    await run_benchmark(dead, b, db_url=db_url)
    with db.session(db_url) as s:
        rep = build_report(s, latest_runs(s, ["ok", "dead"]), baseline="ok")
    rec = rep["recommendations"][0]
    assert rec["recommended"] == "ok" and rec["not_recommendable"] == ["dead"]
    sm = rep["benchmarks"][0]["summaries"]["dead"]
    assert sm["cost_per_case"] == pytest.approx(sm["cost_usd"] / 5)  # per successful call

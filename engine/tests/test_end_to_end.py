"""Full run -> compare -> report flow with mock targets (no network, no API keys)."""

import json

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
    assert rep["headline"][0]["overall"] == "inconclusive"


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

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


def _kinds(rep):
    return [s["kind"] for s in rep["suggestions"]]


def _by_kind(rep, kind):
    return [s for s in rep["suggestions"] if s["kind"] == kind]


async def _priced(db_url, base_correct, cand_correct, base_price=(1.0, 2.0), cand_price=(1.0, 2.0), cand_errors=None, bname="b0"):
    b = bench(bname)
    cand = mock("cand", cand_correct, price=cand_price)
    cand.extra["errors"] = cand_errors or {}
    await run_benchmark(mock("base", base_correct, price=base_price), b, db_url=db_url)
    await run_benchmark(cand, b, db_url=db_url)
    with db.session(db_url) as s:
        return build_report(s, latest_runs(s, ["base", "cand"]), baseline="base")


async def test_suggestions_tie_names_the_cheaper_model_and_saving(db_url):
    same = set(range(N)) - {3, 7}
    rep = await _priced(db_url, same, same, base_price=(10.0, 30.0), cand_price=(0.1, 0.4))
    (tie,) = _by_kind(rep, "tie")
    assert tie["target"] == "cand" and "cheaper is cand" in tie["text"] and "saves $" in tie["text"] and "/ 1k tasks" in tie["text"]
    assert tie["data"]["saving_per_1k"] > 0
    assert "switch" not in _kinds(rep)


async def test_suggestions_switch_when_better_everywhere_and_stay_when_worse(db_url):
    rep = await _priced(db_url, set(range(8)), set(range(N)))
    (sw,) = _by_kind(rep, "switch")
    assert sw["target"] == "cand" and "Solves multi-step problems" in sw["text"]
    rep = await _priced(db_url, set(range(N)), set(range(5)))
    (st,) = _by_kind(rep, "stay")
    assert st["target"] == "base" and "worse" in st["text"] and "switch" not in _kinds(rep)


async def test_suggestions_wide_ci_asks_for_n_more_cases_from_the_mde(db_url):
    rep = await _priced(db_url, set(range(0, 14)), set(range(6, 18)))
    (add,) = _by_kind(rep, "add_cases")
    d = add["data"]
    assert add["benchmark"] == "b0" and f"add {d['add']} more cases to b0" in add["text"]
    target = max(abs(d["delta_points"]), 3.0)
    assert d["add"] == math.ceil(d["n"] * (d["mde_points"] / target) ** 2 - d["n"]) and d["add"] > 0


async def test_suggestions_tiny_difference_is_called_unmeasurable(db_url):
    from modelcompare.summary import MAX_ADD_CASES, cases_needed

    assert cases_needed(20, 0.40, 0.0) > MAX_ADD_CASES
    rep = await _priced(db_url, set(range(0, 12)), set(range(4, 16)))
    (small,) = _by_kind(rep, "too_small")
    assert "too small to measure" in small["text"] and "add_cases" not in _kinds(rep)
    assert cases_needed(20, 0.40, 0.30) == math.ceil(20 * (0.40 / 0.30) ** 2 - 20)


async def test_suggestions_saturated_benchmark_gets_its_own_line(db_url):
    rep = await _priced(db_url, set(range(N)), set(range(N)))
    (sat,) = _by_kind(rep, "saturated")
    assert sat["benchmark"] == "b0" and "too easy" in sat["text"].lower()


async def test_suggestions_errors_come_first_and_name_the_top_reason(db_url):
    errs = {f"q{i}": "provider unavailable" for i in range(5)}
    rep = await _priced(db_url, set(range(10)), set(range(10)), cand_errors=errs)
    assert _kinds(rep)[0] == "fix_errors"
    fix = rep["suggestions"][0]
    assert fix["target"] == "cand" and "provider unavailable" in fix["text"] and fix["data"]["n_errors"] == 5
    assert "switch" not in _kinds(rep) and "tie" not in _kinds(rep)


async def test_suggestions_order_is_errors_decisions_then_data_advice(db_url):
    rep = await _priced(db_url, set(range(N)), set(range(N)))
    order = {"fix_errors": 0, "switch": 1, "stay": 1, "tradeoff": 1, "tie": 1, "add_cases": 2, "too_small": 2, "saturated": 2}
    ranks = [order[k] for k in _kinds(rep)]
    assert ranks == sorted(ranks)


async def test_dimension_chart_data_has_ci_and_vendor(db_url):
    rep = await _priced(db_url, set(range(8)), set(range(N)))
    assert rep["dimensions"]["reasoning"]["label"] == "Solves multi-step problems"
    t = rep["dimensions"]["reasoning"]["targets"]["cand"]
    lo, hi = t["quality_ci"]
    assert lo <= t["quality"] <= hi and t["vendor"] == "mock"


async def test_suggestions_no_tie_while_a_capability_is_still_open(db_url):
    same = set(range(N)) - {3, 7}
    for name, base, cand, dim in (("b0", same, same, "reasoning"), ("b1", set(range(0, 14)), set(range(6, 18)), "coding")):
        b = bench(name, dim)
        await run_benchmark(mock("base", base, price=(10.0, 30.0)), b, db_url=db_url)
        await run_benchmark(mock("cand", cand, price=(0.1, 0.4)), b, db_url=db_url)
    with db.session(db_url) as s:
        rep = build_report(s, latest_runs(s, ["base", "cand"]), baseline="base")
    verdicts = {d: c["cand"]["verdict"] for d, c in rep["dimension_comparisons"].items()}
    assert verdicts == {"reasoning": "equivalent", "coding": "inconclusive"}
    assert "tie" not in _kinds(rep) and _kinds(rep).count("add_cases") == 1


async def test_incomplete_flag_on_dimension_targets_and_markers(db_url):
    errs = {f"q{i}": "provider unavailable" for i in range(5)}
    rep = await _priced(db_url, set(range(10)), set(range(10)), cand_errors=errs)
    dim = rep["dimensions"]["reasoning"]["targets"]
    assert dim["cand"]["incomplete"] is True and dim["base"]["incomplete"] is False
    marks = rep["summary"]["markers"]
    assert marks["cand"]["incomplete"] is True and marks["base"]["incomplete"] is False
    assert "cost_per_1k_tasks" not in dim["cand"]  # the scatter uses list-price markers, not spend


def test_cases_needed_never_suggests_a_token_handful():
    from modelcompare.summary import MIN_ADD_CASES, cases_needed

    assert cases_needed(40, 0.031, 0.03) == MIN_ADD_CASES == 5

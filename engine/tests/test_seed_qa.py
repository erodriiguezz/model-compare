"""The QA seed covers every verdict and can be re-run without duplicating rows."""

import importlib.util
from pathlib import Path

from modelcompare import db
from modelcompare.report import build_report, runs_by_ids

SPEC = importlib.util.spec_from_file_location("seed_qa", Path(__file__).parent.parent / "scripts" / "seed_qa.py")


def _seed():
    mod = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(mod)
    mod.seed()


def test_seed_is_idempotent_and_covers_every_verdict(db_url):
    _seed()
    _seed()
    with db.session(db_url) as s:
        assert len(db.list_runs(s)) == 27
        job = s.get(db.Job, "qa-every-verdict")
        rep = build_report(s, runs_by_ids(s, job.run_ids), baseline=job.baseline)
        inc = s.get(db.Job, "qa-incomplete")
        inc_rep = build_report(s, runs_by_ids(s, inc.run_ids), baseline=inc.baseline)
    verdicts = {c["verdict"] for per in rep["dimension_comparisons"].values() for c in per.values()}
    assert {"better", "worse", "equivalent", "inconclusive", "incomplete"} <= verdicts
    assert any(b["saturated"] for b in rep["benchmarks"])
    assert {c["verdict"] for per in inc_rep["dimension_comparisons"].values() for c in per.values()} == {"incomplete"}
    assert [x["kind"] for x in inc_rep["suggestions"]] == ["fix_errors"]

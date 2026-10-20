"""Seed the QA database with finished comparisons that cover every verdict. Idempotent.

Run with MODELCOMPARE_HOME pointing at the QA data dir (the QA app recipe sets it). Writes straight
through modelcompare.db with mock targets, so no network, keys or engine run is involved.

  qa-every-verdict  better, worse, equivalent (tie), inconclusive and incomplete cells, plus one
                    saturated benchmark, at different prices so the cost scatter has a Pareto front.
                    A small "tool_calling" benchmark (6 cases, two models) gives an insufficient_data cell.
  qa-incomplete     one candidate whose errors make every comparison incomplete.
"""

from __future__ import annotations

import os

from modelcompare import db
from modelcompare.schema import TargetConfig

N = 40
BASE = "qa-base"
# name -> (model, (usd per 1M in, out))
TARGETS = {
    BASE: ("openai/qa-base", (3.0, 15.0)),
    "qa-better": ("anthropic/qa-better", (8.0, 40.0)),
    "qa-worse": ("google/qa-worse", (0.5, 2.5)),
    "qa-tie": ("openai/qa-tie", (1.5, 7.5)),
    "qa-flaky": ("mistral/qa-flaky", (2.0, 10.0)),
}
# dimension -> benchmark; correct cases per target (cases are q0..q39); the baseline solves q0..q19.
BENCHMARKS = {"reasoning": "qa-reasoning", "coding": "qa-coding", "knowledge": "qa-knowledge",
              "instruction_following": "qa-instructions", "multilingual": "qa-easy"}
HALF = set(range(20))
CORRECT = {
    "reasoning": {BASE: HALF, "qa-better": set(range(38)), "qa-worse": set(range(4)), "qa-tie": HALF, "qa-flaky": HALF},
    "coding": {BASE: HALF, "qa-better": set(range(36)), "qa-worse": HALF, "qa-tie": HALF, "qa-flaky": HALF},
    "knowledge": {BASE: HALF, "qa-better": HALF, "qa-worse": set(range(10, 30)), "qa-tie": HALF, "qa-flaky": HALF},
    "instruction_following": {BASE: HALF, "qa-better": set(range(5, 30)), "qa-worse": HALF, "qa-tie": HALF, "qa-flaky": HALF},
    "multilingual": {t: set(range(N)) for t in TARGETS},
}
ERRORS = {("coding", "qa-flaky"): 12}  # errored calls per run, out of N: 30%, over the 10% limit


def _run(s, target: str, bench: str, dim: str, correct: set[int], n_errors: int = 0, n: int = N) -> db.Run:
    model, (p_in, p_out) = TARGETS[target]
    cfg = TargetConfig(name=target, kind="mock", model=model, pricing={"input": p_in, "output": p_out})
    run = db.Run(target_name=target, target_config=cfg.model_dump(mode="json"), benchmark_name=bench, benchmark_version="1",
                 benchmark_fingerprint=f"seed-{bench}", dimension=dim, source="qa", status="done")
    s.add(run)
    s.flush()
    cost = (100 * p_in + 60 * p_out) / 1e6
    for i in range(n):
        err = i < n_errors  # errors hit the cases this model would have solved
        ok = i in correct and not err
        s.add(db.Result(run_id=run.id, case_id=f"q{i}", repeat=0, score=float(ok), passed=ok, text="" if err else f"ANSWER: {i}",
                        input_tokens=0 if err else 100, output_tokens=0 if err else 60, latency_s=0.4, cost_usd=0.0 if err else cost,
                        error="provider unavailable" if err else None))
    return run


def _job(s, job_id: str, targets: list[str], runs: list[db.Run]) -> None:
    totals = db.run_summaries(s)
    s.add(db.Job(id=job_id, targets=targets, baseline=BASE, benchmarks=sorted({r.benchmark_name for r in runs}), total_calls=sum(totals[r.id]["n_results"] for r in runs),
                 done_calls=sum(totals[r.id]["n_results"] for r in runs), run_ids=[r.id for r in runs], status="done",
                 runs=[{"run_id": r.id, "status": "done", "target": r.target_name, "benchmark": r.benchmark_name, "cost_usd": totals.get(r.id, {}).get("cost_usd", 0.0),
                        "passed": totals.get(r.id, {}).get("passed", 0), "n_results": totals[r.id]["n_results"], "n_errors": totals.get(r.id, {}).get("n_errors", 0),
                        "dimension": r.dimension,
                        "first_error": "provider unavailable" if totals.get(r.id, {}).get("n_errors") else None} for r in runs]))


def seed() -> None:
    with db.session() as s:
        for job_id in ("qa-every-verdict", "qa-incomplete"):
            if old := s.get(db.Job, job_id):
                _delete(s, old)
        s.commit()
        runs = [_run(s, t, BENCHMARKS[d], d, CORRECT[d][t], ERRORS.get((d, t), 0)) for d in BENCHMARKS for t in TARGETS]
        # Under 10 shared cases no verdict is possible, whatever the scores.
        runs += [_run(s, BASE, "qa-tools-small", "tool_calling", {0, 1, 2}, n=6), _run(s, "qa-better", "qa-tools-small", "tool_calling", set(range(6)), n=6)]
        s.commit()
        _job(s, "qa-every-verdict", list(TARGETS), runs)
        s.commit()
        inc = [_run(s, t, "qa-incomplete-math", "reasoning", HALF, 12 if t == "qa-flaky" else 0) for t in (BASE, "qa-flaky")]
        s.commit()
        _job(s, "qa-incomplete", [BASE, "qa-flaky"], inc)
        s.commit()


def _delete(s, job: db.Job) -> None:
    for rid in job.run_ids:
        for r in db.run_results(s, rid):
            s.delete(r)
        if run := s.get(db.Run, rid):
            s.delete(run)
    s.delete(job)


def main() -> None:
    if not (os.getenv("MODELCOMPARE_HOME") or os.getenv("MODELCOMPARE_DB_URL")):
        raise SystemExit("seed_qa.py writes to the database: set MODELCOMPARE_HOME (the QA data dir) or MODELCOMPARE_DB_URL first, so it never touches your real data.")
    seed()
    print("seeded qa-every-verdict and qa-incomplete")


if __name__ == "__main__":
    main()

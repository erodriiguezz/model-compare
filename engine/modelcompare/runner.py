"""Execute a benchmark against a target: concurrency, response cache, budget cap, scoring."""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

from modelcompare import db
from modelcompare.schema import Benchmark, Case, CaseResult, Completion, ScoreDetail, TargetConfig
from modelcompare.scorers import ScoreContext, ScorerError, run_scorer
from modelcompare.targets import Target, build_target

ASSUMED_OUTPUT_TOKENS = 400


def build_messages(target: TargetConfig, bench: Benchmark, case: Case) -> list[dict]:
    system = "\n\n".join(p for p in (target.system_prompt, bench.system_prompt) if p)
    msgs = [{"role": "system", "content": system}] if system else []
    content = f"{bench.documents[case.document]}\n\n{case.input}" if case.document else case.input
    msgs.append({"role": "user", "content": content})
    return msgs


def cache_key(target: TargetConfig, messages: list[dict], tools: list[dict], repeat: int) -> str:
    payload = {
        "model": target.model,
        "kind": target.kind,
        "temperature": target.temperature,
        "max_tokens": target.max_tokens,
        "extra": target.extra,
        "messages": messages,
        "tools": tools,
        "repeat": repeat,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


async def score_case(completion: Completion, case: Case, bench: Benchmark, ctx: ScoreContext) -> tuple[list[ScoreDetail], float, str | None]:
    """Weighted score plus a scoring error. If any scorer cannot grade (e.g. the judge failed) the whole case is
    unscored: averaging the remaining scorers would silently reward or punish the model for a grader failure."""
    specs = case.scorers or bench.scorers
    details = []
    for spec in specs:
        try:
            d = await run_scorer(spec.type, completion, case, spec.params, ctx)
        except ScorerError as e:
            return details, 0.0, str(e)
        d.weight = spec.weight
        details.append(d)
    total_w = sum(d.weight for d in details) or 1.0
    return details, sum(d.score * d.weight for d in details) / total_w, None


def benchmarks_needing_judge(benches: list[Benchmark]) -> list[str]:
    """Names of benchmarks with an llm_judge scorer at benchmark or case level."""
    return [
        b.name for b in benches
        if any(s.type == "llm_judge" for s in b.scorers + [s for c in b.cases for s in (c.scorers or [])])
    ]


def price_per_million(target: TargetConfig) -> tuple[float, float]:
    """(input, output) USD per 1M tokens: explicit pricing, else LiteLLM's registry, else 0."""
    price_in, price_out = target.pricing.input, target.pricing.output
    if (price_in is None or price_out is None) and target.kind != "mock":
        from modelcompare.targets.litellm_target import model_metadata

        meta = model_metadata(target.model)
        price_in = (meta.get("input_cost_per_token") or 0) * 1e6 if price_in is None else price_in
        price_out = (meta.get("output_cost_per_token") or 0) * 1e6 if price_out is None else price_out
    return price_in or 0.0, price_out or 0.0


def price_unknown(target: TargetConfig) -> bool:
    """True when a paid target has no known price (neither explicit nor in LiteLLM), so estimates read $0."""
    if target.kind == "mock" or (target.pricing.input is not None and target.pricing.output is not None):
        return False
    from modelcompare.targets.litellm_target import model_metadata

    meta = model_metadata(target.model)
    return (target.pricing.input is None and meta.get("input_cost_per_token") is None) or (
        target.pricing.output is None and meta.get("output_cost_per_token") is None)


def estimate_cost(target: TargetConfig, bench: Benchmark) -> float:
    """Rough pre-run USD estimate (chars/4 tokens in, fixed assumption out)."""
    price_in, price_out = price_per_million(target)
    total = 0.0
    for case in bench.cases:
        in_tok = sum(len(m["content"]) for m in build_messages(target, bench, case)) // 4
        total += (in_tok * price_in + ASSUMED_OUTPUT_TOKENS * price_out) / 1e6
    return total * bench.repeats


@dataclass
class RunOutcome:
    run_id: int
    status: str
    results: list[CaseResult]
    cost_usd: float


async def run_benchmark(
    target_cfg: TargetConfig,
    bench: Benchmark,
    judge_cfg: TargetConfig | None = None,
    concurrency: int = 8,
    budget_usd: float | None = None,
    use_cache: bool = True,
    db_url: str | None = None,
    on_progress: Callable[[int, int], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    on_result: Callable[[CaseResult], None] | None = None,
) -> RunOutcome:
    target: Target = build_target(target_cfg)
    ctx = ScoreContext(judge=build_target(judge_cfg) if judge_cfg else None)
    tools = [t.to_openai() for t in bench.tools]
    jobs = [(case, r) for case in bench.cases for r in range(bench.repeats)]

    with db.session(db_url) as s:
        run = db.Run(
            target_name=target_cfg.name,
            target_config=target_cfg.model_dump(mode="json"),
            benchmark_name=bench.name,
            benchmark_version=bench.version,
            benchmark_fingerprint=bench.fingerprint,
            dimension=bench.dimension,
            source=bench.source,
            contamination_risk=bench.contamination_risk,
            pass_threshold=bench.pass_threshold,
            judge_model=judge_cfg.model if judge_cfg else None,
        )
        s.add(run)
        s.commit()
        s.refresh(run)

        sem = asyncio.Semaphore(concurrency)
        lock = asyncio.Lock()
        spent = 0.0
        done = 0
        stopped = False
        cancelled = False
        results: list[CaseResult] = []

        async def one(case: Case, repeat: int) -> None:
            nonlocal spent, done, stopped, cancelled
            async with sem:
                if should_stop and should_stop():
                    stopped = cancelled = True
                if stopped:
                    return
                msgs = build_messages(target_cfg, bench, case)
                key = cache_key(target_cfg, msgs, tools, repeat)
                cached = db.cache_get(s, key) if use_cache else None
                if cached:
                    completion = Completion.model_validate({**cached, "cached": True})
                else:
                    completion = await target.complete(msgs, tools or None, case_id=case.id)
                details, score, score_error = await score_case(completion, case, bench, ctx)
                error = completion.error or score_error
                cr = CaseResult(
                    case_id=case.id, repeat=repeat, completion=completion, scores=details,
                    score=score, passed=not error and score >= bench.pass_threshold, error=error,
                )
                async with lock:
                    if use_cache and not cached and not completion.error:
                        db.cache_put(s, key, completion.model_dump(exclude={"cached"}))
                    s.add(db.Result(
                        run_id=run.id, case_id=case.id, repeat=repeat, score=score, passed=cr.passed,
                        text=completion.text, tool_calls=completion.tool_calls,
                        scores=[d.model_dump() for d in details],
                        input_tokens=completion.input_tokens, output_tokens=completion.output_tokens,
                        latency_s=completion.latency_s, cost_usd=0.0 if cached else completion.cost_usd,
                        error=error, cached=bool(cached),
                    ))
                    s.commit()
                    results.append(cr)
                    if not cached:
                        spent += completion.cost_usd
                    done += 1
                    if budget_usd is not None and spent >= budget_usd:
                        stopped = True
                    if on_progress:
                        on_progress(done, len(jobs))
                    if on_result:
                        on_result(cr)

        try:
            await asyncio.gather(*(one(c, r) for c, r in jobs))
            run.status = "cancelled" if cancelled else "budget_exceeded" if stopped else "done"
        except Exception:
            run.status = "failed"
            raise
        finally:
            run.finished_at = datetime.now(timezone.utc)
            if any(r.completion.temperature_fallback for r in results):
                run.target_config = {**run.target_config, "temperature_fallback": True}
            s.add(run)
            s.commit()

    return RunOutcome(run_id=run.id, status=run.status, results=results, cost_usd=spent)

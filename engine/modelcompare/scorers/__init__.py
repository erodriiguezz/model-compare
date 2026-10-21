"""Scorer registry. A scorer maps (completion, case, params, ctx) -> ScoreDetail with score in [0, 1]."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable

from modelcompare.schema import Case, Completion, ScoreDetail
from modelcompare.targets.base import Target


class ScorerError(Exception):
    """The scorer could not grade this answer (e.g. the judge failed). The case is unscored, not zero."""


@dataclass
class ScoreContext:
    judge: Target | None = None


ScorerFn = Callable[[Completion, Case, dict, ScoreContext], Awaitable[ScoreDetail]]
REGISTRY: dict[str, ScorerFn] = {}


def scorer(name: str):
    def deco(fn: ScorerFn) -> ScorerFn:
        REGISTRY[name] = fn
        return fn

    return deco


async def run_scorer(kind: str, completion: Completion, case: Case, params: dict, ctx: ScoreContext) -> ScoreDetail:
    if kind not in REGISTRY:
        raise KeyError(f"unknown scorer '{kind}'. Known: {sorted(REGISTRY)}")
    if completion.error:
        return ScoreDetail(type=kind, score=0.0, reason=f"target error: {completion.error}")
    return await REGISTRY[kind](completion, case, params, ctx)


# Register built-ins.
from modelcompare.scorers import code_exec, deterministic, judge  # noqa: E402,F401

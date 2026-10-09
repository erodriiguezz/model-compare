"""LLM-as-judge scoring. Pick a judge from a different vendor than the targets being compared."""

from __future__ import annotations

import re

from modelcompare.schema import ScoreDetail
from modelcompare.scorers import scorer

JUDGE_PROMPT = """You are a strict evaluator. Grade the RESPONSE to the TASK against the RUBRIC.

TASK:
{task}

{reference}RUBRIC:
{rubric}

RESPONSE:
{response}

Think briefly about how well the response meets each rubric point, then end with a final line
exactly of the form `SCORE: <integer 1-10>`."""


@scorer("llm_judge")
async def llm_judge(c, case, params, ctx):
    if ctx.judge is None:
        raise RuntimeError("llm_judge scorer needs a judge target (--judge)")
    rubric = params.get("rubric") or case.vars.get("rubric") or "Correct, complete, concise, and helpful."
    reference = f"REFERENCE ANSWER:\n{case.expected}\n\n" if case.expected is not None else ""
    prompt = JUDGE_PROMPT.format(task=case.input, reference=reference, rubric=rubric, response=c.text)
    out = await ctx.judge.complete([{"role": "user", "content": prompt}])
    if out.error:
        return ScoreDetail(type="llm_judge", score=0.0, reason=f"judge error: {out.error}")
    m = re.findall(r"SCORE:\s*(\d+(?:\.\d+)?)", out.text)
    if not m:
        return ScoreDetail(type="llm_judge", score=0.0, reason="judge gave no score")
    raw = min(10.0, max(1.0, float(m[-1])))
    return ScoreDetail(type="llm_judge", score=(raw - 1) / 9, reason=f"{raw:g}/10")

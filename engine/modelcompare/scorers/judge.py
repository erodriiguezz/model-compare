"""LLM-as-judge scoring. Pick a judge from a different vendor than the targets being compared."""

from __future__ import annotations

import re

from modelcompare.schema import ScoreDetail
from modelcompare.scorers import ScorerError, scorer

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
    for attempt in range(2):  # one extra try when the reply has no parsable score
        out = await ctx.judge.complete([{"role": "user", "content": prompt}])
        if out.error:
            raise ScorerError(f"judge error: {out.error}")
        if (raw := parse_score(out.text)) is not None:
            break
    else:
        raise ScorerError("judge gave no score")
    raw = min(10.0, max(1.0, raw))
    return ScoreDetail(type="llm_judge", score=(raw - 1) / 9, reason=f"{raw:g}/10")


_NUM = r"(\d+(?:\.\d+)?)"
_SCORE_PATTERNS = [
    rf"score\W{{1,4}}{_NUM}",  # SCORE: 7, Score - 7, "score": 7
    rf"{_NUM}\s*/\s*10\b",  # 7/10
]


def parse_score(text: str) -> float | None:
    """Last judge score in the reply: `SCORE: 7`, `Score: 7/10`, `{"score": 7}`, `**7**/10`."""
    text = text.replace("*", "")
    for pat in _SCORE_PATTERNS:
        if m := re.findall(pat, text, re.IGNORECASE):
            return float(m[-1])
    return None

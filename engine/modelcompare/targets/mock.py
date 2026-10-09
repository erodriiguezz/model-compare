from __future__ import annotations

import asyncio

from modelcompare.schema import Completion
from modelcompare.targets.base import Target


class MockTarget(Target):
    """Deterministic target for tests and dry runs; no network.

    extra:
      responses: {case_id: text | {"text": ..., "tool_calls": [...]}}
      default: fallback text
      latency_s: simulated latency
    """

    async def complete(self, messages, tools=None, case_id=None) -> Completion:
        extra = self.cfg.extra
        latency = float(extra.get("latency_s", 0.0))
        if latency:
            await asyncio.sleep(latency)
        resp = extra.get("responses", {}).get(case_id, extra.get("default", ""))
        if isinstance(resp, dict):
            text, tool_calls = resp.get("text", ""), resp.get("tool_calls", [])
        else:
            text, tool_calls = str(resp), []
        in_tok = sum(len(str(m.get("content", ""))) for m in messages) // 4
        out_tok = max(1, len(text) // 4)
        return Completion(
            text=text,
            tool_calls=tool_calls,
            input_tokens=in_tok,
            output_tokens=out_tok,
            latency_s=latency,
            cost_usd=self.estimate_cost(in_tok, out_tok),
        )

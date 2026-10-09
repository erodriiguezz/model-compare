from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from modelcompare.schema import Completion, TargetConfig


class Target(ABC):
    """Anything that turns a chat request into a Completion. Agents plug in here later."""

    def __init__(self, cfg: TargetConfig):
        self.cfg = cfg

    @abstractmethod
    async def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        case_id: str | None = None,
    ) -> Completion: ...

    def estimate_cost(self, input_tokens: int, output_tokens: int) -> float:
        p = self.cfg.pricing
        if p.input is None or p.output is None:
            return 0.0
        return (input_tokens * p.input + output_tokens * p.output) / 1_000_000

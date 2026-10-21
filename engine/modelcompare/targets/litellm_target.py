from __future__ import annotations

import json
import time
from typing import Any

from modelcompare.schema import Completion
from modelcompare.targets.base import Target


class LiteLLMTarget(Target):
    """Calls any provider LiteLLM supports (OpenAI, Anthropic, Gemini, Together, Groq, ...)."""

    async def complete(self, messages, tools=None, case_id=None) -> Completion:
        import litellm

        kwargs: dict[str, Any] = {
            "model": self.cfg.model,
            "messages": messages,
            "max_tokens": self.cfg.max_tokens,
            "num_retries": 3,
            "drop_params": True,
            **self.cfg.extra,
        }
        if self.cfg.temperature is not None:
            kwargs["temperature"] = self.cfg.temperature
        if tools:
            kwargs["tools"] = tools

        start = time.perf_counter()
        fallback = False
        try:
            try:
                resp = await litellm.acompletion(**kwargs)
            except Exception as e:
                if "temperature" not in kwargs or not _temperature_unsupported(litellm, e):
                    raise
                kwargs.pop("temperature")
                fallback = True
                resp = await litellm.acompletion(**kwargs)
        except Exception as e:  # provider errors are results, not crashes
            return Completion(error=f"{type(e).__name__}: {e}", latency_s=time.perf_counter() - start)
        latency = time.perf_counter() - start

        msg = resp.choices[0].message
        tool_calls = []
        for tc in getattr(msg, "tool_calls", None) or []:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {"__raw__": tc.function.arguments}
            tool_calls.append({"name": tc.function.name, "arguments": args})

        usage = getattr(resp, "usage", None)
        in_tok = getattr(usage, "prompt_tokens", 0) or 0
        out_tok = getattr(usage, "completion_tokens", 0) or 0

        cost = self.estimate_cost(in_tok, out_tok)
        if not cost:
            try:
                cost = float(litellm.completion_cost(completion_response=resp) or 0.0)
            except Exception:
                cost = 0.0

        return Completion(
            text=msg.content or "",
            tool_calls=tool_calls,
            input_tokens=in_tok,
            output_tokens=out_tok,
            latency_s=latency,
            cost_usd=cost,
            finish_reason=getattr(resp.choices[0], "finish_reason", None),
            temperature_fallback=fallback,
        )


def _temperature_unsupported(litellm: Any, e: Exception) -> bool:
    msg = str(e).lower()
    if "temperature" not in msg:
        return False
    unsupported = getattr(litellm, "UnsupportedParamsError", None)
    if unsupported and isinstance(e, unsupported):
        return True
    return any(p in msg for p in ("unsupported", "not support", "does not support", "not supported"))


def model_metadata(model: str) -> dict[str, Any]:
    """Context window and list pricing from LiteLLM's registry, when known."""
    try:
        import litellm

        info = litellm.get_model_info(model)
    except Exception:
        return {}
    keys = ("max_input_tokens", "max_output_tokens", "input_cost_per_token", "output_cost_per_token")
    return {k: info.get(k) for k in keys if info.get(k) is not None}

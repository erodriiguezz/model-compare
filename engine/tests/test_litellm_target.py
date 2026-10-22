"""LiteLLM target behaviour with litellm mocked out (no network)."""

import sys
import types

import pytest

from modelcompare.schema import TargetConfig
from modelcompare.targets.litellm_target import LiteLLMTarget


class UnsupportedParamsError(Exception):
    pass


def fake_litellm(fail_first: Exception | None):
    calls: list[dict] = []

    async def acompletion(**kw):
        calls.append(kw)
        if fail_first and len(calls) == 1:
            raise fail_first
        msg = types.SimpleNamespace(content="hi", tool_calls=None)
        return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)],
                                     usage=types.SimpleNamespace(prompt_tokens=3, completion_tokens=1))

    mod = types.SimpleNamespace(acompletion=acompletion, UnsupportedParamsError=UnsupportedParamsError,
                                completion_cost=lambda **kw: 0.0)
    return mod, calls


def target(temperature=0.0):
    return LiteLLMTarget(TargetConfig(name="t", model="x/y", temperature=temperature))


@pytest.mark.parametrize("err", [
    UnsupportedParamsError("x does not support parameters: ['temperature']"),
    Exception("BadRequestError: temperature is not supported with this model"),
])
async def test_temperature_fallback(monkeypatch, err):
    """AC-1.5: a target that rejects temperature is retried without it and the fallback is recorded."""
    mod, calls = fake_litellm(err)
    monkeypatch.setitem(sys.modules, "litellm", mod)
    out = await target().complete([{"role": "user", "content": "q"}])
    assert out.error is None and out.text == "hi" and out.temperature_fallback is True
    assert len(calls) == 2 and "temperature" in calls[0] and "temperature" not in calls[1]
    assert all(c["drop_params"] is True for c in calls)


async def test_no_fallback_on_other_errors(monkeypatch):
    mod, calls = fake_litellm(Exception("AuthenticationError: bad key"))
    monkeypatch.setitem(sys.modules, "litellm", mod)
    out = await target().complete([{"role": "user", "content": "q"}])
    assert out.error and "AuthenticationError" in out.error and out.temperature_fallback is False
    assert len(calls) == 1


async def test_no_retry_when_temperature_unset(monkeypatch):
    mod, calls = fake_litellm(UnsupportedParamsError("temperature"))
    monkeypatch.setitem(sys.modules, "litellm", mod)
    out = await target(temperature=None).complete([{"role": "user", "content": "q"}])
    assert out.error and len(calls) == 1

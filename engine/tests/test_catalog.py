"""Model catalog: fixtures instead of HTTP, mocked httpx for the cache and error paths, fake keys only."""

import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from modelcompare import catalog, keys
from modelcompare.api import create_app

FIXTURES = Path(__file__).parent / "fixtures" / "catalog"
FAKE = {"OPENAI_API_KEY": "sk-fake-openai-0001", "TOGETHERAI_API_KEY": "tg-fake-0001", "GROQ_API_KEY": "gq-fake-0001",
        "OPENROUTER_API_KEY": "or-fake-0001", "GEMINI_API_KEY": "gm-fake-0001", "ANTHROPIC_API_KEY": "an-fake-0001"}


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    catalog._cache.clear()
    for var in keys.PROVIDERS.values():
        monkeypatch.delenv(var, raising=False)
    monkeypatch.delenv("MODELCOMPARE_CATALOG_FIXTURES", raising=False)
    yield
    catalog._cache.clear()


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path / "no-web-out"))


def by_provider(res):
    return {p["provider"]: p for p in res.json()["providers"]}


class FakeHttp:
    """httpx.get stand-in serving the recorded fixtures; counts calls."""

    def __init__(self, monkeypatch, fail=()):
        self.calls, self.fail = [], set(fail)
        monkeypatch.setattr(httpx, "get", self)

    def __call__(self, url, headers=None, timeout=None):
        self.calls.append(url)
        provider = next(p for p, u in catalog._URLS.items() if u == url)
        if provider in self.fail:
            return httpx.Response(500, request=httpx.Request("GET", url))
        return httpx.Response(200, json=json.loads((FIXTURES / f"{provider}.json").read_text()),
                              request=httpx.Request("GET", url))


def test_ac_5_1_lists_chat_models_with_price_and_context(client, monkeypatch):
    for var, v in FAKE.items():
        monkeypatch.setenv(var, v)
    monkeypatch.setenv("MODELCOMPARE_CATALOG_FIXTURES", str(FIXTURES))
    res = client.get("/api/models")
    assert res.status_code == 200
    p = by_provider(res)
    assert all(r["key_ok"] for r in p.values())
    ids = {prov: {m["id"] for m in r["models"]} for prov, r in p.items()}
    assert ids["openai"] == {"gpt-4o", "gpt-4o-mini"}
    assert ids["gemini"] == {"gemini-2.0-flash"}
    assert ids["togetherai"] == {"meta-llama/Llama-3.3-70B-Instruct-Turbo"}
    assert ids["groq"] == {"llama-3.3-70b-versatile"}
    assert ids["openrouter"] == {"openai/gpt-4o-mini"}
    assert ids["anthropic"] == {"claude-sonnet-4-5", "claude-haiku-4-5"}
    gpt = next(m for m in p["openai"]["models"] if m["id"] == "gpt-4o")  # enriched from litellm.model_cost
    assert gpt["target"] == "openai/gpt-4o" and gpt["price_in"] > 0 and gpt["price_out"] > gpt["price_in"] and gpt["context"] > 0
    orr = p["openrouter"]["models"][0]  # provider-reported per-token prices -> per 1M
    assert (orr["price_in"], orr["price_out"], orr["context"]) == (0.15, 0.6, 128000)
    assert p["togetherai"]["models"][0]["price_in"] == 0.88
    assert p["gemini"]["models"][0]["context"] == 1048576
    assert FAKE["OPENAI_API_KEY"] not in res.text


@pytest.mark.parametrize("provider,mid,meta,expected", [
    ("openai", "gpt-4o", {}, True),
    ("openai", "text-embedding-3-small", {}, False),
    ("openai", "gpt-image-1", {}, False),
    ("openai", "gpt-4o-realtime-preview", {}, False),
    ("openai", "omni-moderation-latest", {}, False),
    ("groq", "whisper-large-v3", {}, False),
    ("groq", "playai-tts", {}, False),
    ("togetherai", "x/chat-model", {"type": "chat"}, True),
    ("togetherai", "x/other", {"type": "rerank"}, False),
    ("gemini", "gemini-2.0-flash", {"supportedGenerationMethods": ["generateContent"]}, True),
    ("gemini", "something", {"supportedGenerationMethods": ["embedContent"]}, False),
    ("openrouter", "a/b", {"architecture": {"modality": "text+image->text"}}, True),
    ("openrouter", "a/c", {"architecture": {"modality": "text->image"}}, False),
])
def test_ac_5_1_chat_filter(provider, mid, meta, expected):
    assert catalog.is_chat(provider, mid, meta) is expected


def test_ac_5_2_no_key_and_failure_are_per_provider(client, monkeypatch):
    http = FakeHttp(monkeypatch, fail={"groq"})
    monkeypatch.setenv("GROQ_API_KEY", FAKE["GROQ_API_KEY"])
    monkeypatch.setenv("OPENAI_API_KEY", FAKE["OPENAI_API_KEY"])
    res = client.get("/api/models")
    assert res.status_code == 200
    p = by_provider(res)
    assert p["anthropic"]["key_ok"] is False and p["anthropic"]["reason"] == "no key"
    assert p["groq"]["key_ok"] is False and "500" in p["groq"]["error"]
    assert p["openai"]["key_ok"] is True and p["openai"]["models"]
    assert len(http.calls) == 2  # providers without a key make no request
    assert FAKE["GROQ_API_KEY"] not in res.text


def test_ac_5_2_network_and_parse_errors_never_500(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", FAKE["OPENAI_API_KEY"])
    monkeypatch.setenv("GROQ_API_KEY", FAKE["GROQ_API_KEY"])

    def get(url, headers=None, timeout=None):
        if "groq" in url:
            return httpx.Response(200, text="not json", request=httpx.Request("GET", url))
        raise httpx.ConnectError(f"boom {headers}", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", get)
    res = client.get("/api/models")
    p = by_provider(res)
    assert "ConnectError" in p["openai"]["error"] and p["groq"]["error"] == "Unexpected response from the provider."
    assert FAKE["OPENAI_API_KEY"] not in res.text


def test_ac_5_3_cache_refresh_and_key_change(client, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(catalog, "clock", lambda: now[0])
    http = FakeHttp(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", FAKE["OPENAI_API_KEY"])
    client.get("/api/models")
    assert len(http.calls) == 1
    now[0] += 599
    client.get("/api/models")
    assert len(http.calls) == 1  # within 10 minutes: served from memory
    client.get("/api/models?refresh=1")
    assert len(http.calls) == 2
    monkeypatch.setenv("OPENAI_API_KEY", "sk-fake-openai-0002")
    client.get("/api/models")
    assert len(http.calls) == 3  # a replaced key invalidates
    now[0] += 601
    client.get("/api/models")
    assert len(http.calls) == 4  # expired


def test_no_root_alias_for_models(client):
    assert client.get("/models").status_code == 404

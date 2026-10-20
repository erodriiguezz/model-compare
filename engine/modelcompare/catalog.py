"""Model catalog: the chat models each configured provider key can reach, with LiteLLM price and context.

Keys are sent only to their own provider's list endpoint and never appear in results or errors.
Set MODELCOMPARE_CATALOG_FIXTURES=<dir> to read <dir>/<provider>.json (a recorded provider response) instead.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import httpx

from modelcompare import keys

TTL_S = 600.0
clock = time.monotonic  # replaced in tests

_URLS = {
    "openai": "https://api.openai.com/v1/models",
    "anthropic": "https://api.anthropic.com/v1/models",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/models",
    "togetherai": "https://api.together.xyz/v1/models",
    "groq": "https://api.groq.com/openai/v1/models",
    "openrouter": "https://openrouter.ai/api/v1/models",  # keys.py probes /key instead
}
_PAGE_PARAMS = {"anthropic": {"limit": 1000}, "gemini": {"pageSize": 1000}}
_KEY_CHECK = {"openrouter": "https://openrouter.ai/api/v1/key"}  # its models list is public
MAX_PAGES = 5
_NOT_CHAT = re.compile(
    r"embed|moderation|rerank|whisper|tts|transcribe|speech|audio|realtime|image|dall-e|imagen|veo|sora"
    r"|davinci|babbage|guard|diffusion|flux",
    re.I,
)
# provider -> (fingerprint of the key, fetched at (clock), wall time, models)
_lock = threading.Lock()
_cache: dict[str, tuple[str, float, str, list[dict]]] = {}


class FetchError(Exception):
    """A short message that is safe to show: it never contains the key."""


def is_chat(provider: str, model_id: str, meta: dict) -> bool:
    """Provider metadata where it exists, else id patterns."""
    if meta.get("active") is False:
        return False
    if provider == "togetherai" and meta.get("type") not in (None, "chat"):
        return False
    if provider == "gemini" and "generateContent" not in meta.get("supportedGenerationMethods", ["generateContent"]):
        return False
    if provider == "openrouter":
        out = (meta.get("architecture") or {}).get("modality", "text->text").partition("->")[2]
        if out and out != "text":
            return False
    return not _NOT_CHAT.search(model_id)


def _num(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _per_m(v, scale: float = 1e6) -> float | None:
    n = _num(v)
    return None if n is None or n < 0 else round(n * scale, 6)


def _normalise(provider: str, body) -> list[dict]:
    """Provider response -> [{id, name?, context?, price_in?, price_out?, meta}]; price per 1M tokens in USD."""
    rows = body if isinstance(body, list) else body.get("models" if provider == "gemini" else "data", [])
    out = []
    for m in rows:
        if provider == "gemini":
            mid = m["name"].removeprefix("models/")
            row = {"id": mid, "name": m.get("displayName"), "context": m.get("inputTokenLimit")}
        elif provider == "openrouter":
            p = m.get("pricing") or {}
            row = {"id": m["id"], "name": m.get("name"), "context": m.get("context_length"),
                   "price_in": _per_m(p.get("prompt")), "price_out": _per_m(p.get("completion"))}
        elif provider == "togetherai":
            p = m.get("pricing") or {}
            row = {"id": m["id"], "name": m.get("display_name"), "context": m.get("context_length"),
                   "price_in": _per_m(p.get("input"), 1), "price_out": _per_m(p.get("output"), 1)}
        elif provider == "groq":
            row = {"id": m["id"], "context": m.get("context_window")}
        elif provider == "anthropic":
            row = {"id": m["id"], "name": m.get("display_name")}
        else:
            row = {"id": m["id"]}
        if is_chat(provider, row["id"], m):
            out.append(row)
    return out


def _enrich(provider: str, row: dict) -> dict | None:
    import litellm

    cost = litellm.model_cost
    info = cost.get(f"{keys.LITELLM_PREFIX.get(provider, provider)}/{row['id']}") or cost.get(row["id"]) or {}
    if info.get("mode") not in (None, "chat"):  # the runner calls chat completions: no completion/responses-only
        return None
    if provider == "openrouter":  # always reports its own prices; a negative one (auto router) means "varies"
        row["target"] = f"{provider}/{row['id']}"
        return {k: v for k, v in row.items() if v is not None}
    if row.get("price_in") is None:
        row["price_in"] = _per_m(info.get("input_cost_per_token"))
    if row.get("price_out") is None:
        row["price_out"] = _per_m(info.get("output_cost_per_token"))
    if not row.get("context"):
        row["context"] = info.get("max_input_tokens") or info.get("max_tokens")
    row["target"] = f"{provider}/{row['id']}"
    return {k: v for k, v in row.items() if v is not None}


def _get(url: str, key: str, provider: str, params: dict | None = None):
    resp = httpx.get(url, headers=keys.auth_headers(provider, key), params=params, timeout=10.0)
    if resp.status_code >= 300:
        raise FetchError(f"The provider returned HTTP {resp.status_code}.")
    return resp.json()


def _next_params(provider: str, body) -> dict | None:
    if provider == "anthropic" and body.get("has_more") and body.get("last_id"):
        return {**_PAGE_PARAMS[provider], "after_id": body["last_id"]}
    if provider == "gemini" and body.get("nextPageToken"):
        return {**_PAGE_PARAMS[provider], "pageToken": body["nextPageToken"]}
    return None


def _fetch(provider: str, key: str) -> list[dict]:
    fixtures = os.environ.get("MODELCOMPARE_CATALOG_FIXTURES")
    rows: dict[str, dict] = {}
    try:
        if fixtures:
            pages = [json.loads((Path(fixtures) / f"{provider}.json").read_text())]
        else:
            if provider in _KEY_CHECK:
                _get(_KEY_CHECK[provider], key, provider)
            pages, params = [], _PAGE_PARAMS.get(provider)
            for _ in range(MAX_PAGES):
                body = _get(_URLS[provider], key, provider, params)
                pages.append(body)
                nxt = _next_params(provider, body)
                if not nxt or nxt == params:
                    break
                params = nxt
        for body in pages:
            for r in _normalise(provider, body):
                if (m := _enrich(provider, r)) is not None:
                    rows[m["id"]] = m
    except FetchError:
        raise
    except httpx.HTTPError as e:
        raise FetchError(f"Could not reach the provider ({type(e).__name__}).")
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        raise FetchError("Unexpected response from the provider.")
    return sorted(rows.values(), key=lambda m: m["id"])


def _provider(provider: str, refresh: bool) -> tuple[dict, str | None]:
    var = keys.PROVIDERS[provider]
    row = {"provider": provider, "var": var}
    key = os.environ.get(var)
    if not key:
        with _lock:
            _cache.pop(provider, None)
        return {**row, "key_ok": False, "reason": "no key", "models": []}, None
    fp = hashlib.sha256(key.encode()).hexdigest()
    with _lock:
        hit = _cache.get(provider)
    if hit and not refresh and hit[0] == fp and clock() - hit[1] < TTL_S:
        return {**row, "key_ok": True, "models": hit[3]}, hit[2]
    try:
        models = _fetch(provider, key)
    except FetchError as e:
        return {**row, "key_ok": False, "error": str(e), "models": []}, None
    at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with _lock:
        _cache[provider] = (fp, clock(), at, models)
    return {**row, "key_ok": True, "models": models}, at


def list_models(refresh: bool = False) -> dict:
    with ThreadPoolExecutor(max_workers=len(keys.PROVIDERS)) as pool:
        results = list(pool.map(lambda p: _provider(p, refresh), keys.PROVIDERS))
    stamps = [at for _, at in results if at]
    return {"providers": [r for r, _ in results],
            "cached_at": min(stamps) if stamps else datetime.now(timezone.utc).isoformat(timespec="seconds")}


def price_for(provider: str, model_id: str) -> tuple[float | None, float | None]:
    """(input, output) USD per 1M tokens the catalog reports for a model; (None, None) when the provider has no
    key, the catalog is unavailable or the model is not listed (the runner then falls back to LiteLLM)."""
    row = next((m for m in _provider(provider, False)[0]["models"] if m["id"] == model_id), {})
    return row.get("price_in"), row.get("price_out")

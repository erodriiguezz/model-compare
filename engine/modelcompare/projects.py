"""Custom benchmarks ("projects") as YAML files in the custom dir, plus the AI draft of a new one."""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError

from modelcompare import bench_loader
from modelcompare.schema import Benchmark, TargetConfig
from modelcompare.scorers import REGISTRY
from modelcompare.targets import build_target

SLUG = re.compile(r"[a-z0-9-]{1,64}")
MAX_BODY = 1_000_000


def scorer_list() -> list[dict[str, str]]:
    return [{"name": n, "description": ((fn.__doc__ or "").strip().splitlines() or [""])[0]} for n, fn in sorted(REGISTRY.items())]


def _errors(e: ValidationError) -> list[dict[str, Any]]:
    return [{"loc": [str(x) for x in err["loc"]], "msg": err["msg"]} for err in e.errors()]


def parse_body(raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "Body is over 1 MB.")
    try:
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(422, [{"loc": ["body"], "msg": "Body must be JSON."}])
    if not isinstance(data, dict):
        raise HTTPException(422, [{"loc": ["body"], "msg": "Body must be a JSON object."}])
    return data


def validate(data: dict[str, Any]) -> Benchmark:
    """Schema errors, no cases and unknown scorers all come back as 422 field errors."""
    try:
        b = Benchmark.model_validate(data)
    except ValidationError as e:
        raise HTTPException(422, _errors(e))
    errs = [] if b.cases else [{"loc": ["cases"], "msg": "At least one case is required."}]
    specs = [("scorers", i, s) for i, s in enumerate(b.scorers)]
    specs += [(f"cases.{c.id}.scorers", i, s) for c in b.cases for i, s in enumerate(c.scorers or [])]
    errs += [{"loc": [w, str(i), "type"], "msg": f"Unknown scorer '{s.type}'."} for w, i, s in specs if s.type not in REGISTRY]
    if errs:
        raise HTTPException(422, errs)
    return b


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:64].strip("-")


def _path(slug: str) -> Path:
    root = bench_loader.custom_dir().resolve()
    path = (root / f"{slug}.yaml").resolve()
    if not SLUG.fullmatch(slug) or not path.is_relative_to(root) or path.parent != root:
        raise HTTPException(400, "Slug must be 1-64 characters of a-z, 0-9 and '-'.")
    return path


def _summary(path: Path) -> dict[str, Any]:
    row: dict[str, Any] = {"slug": path.stem, "updated_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()}
    try:
        b = Benchmark.load(path)
        return {**row, "name": b.name, "dimension": b.dimension, "n_cases": len(b.cases), "valid": True, "error": None}
    except Exception as e:  # a broken file must not hide the others
        return {**row, "name": path.stem, "dimension": None, "n_cases": 0, "valid": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}


def list_projects() -> list[dict[str, Any]]:
    d = bench_loader.custom_dir()
    return [_summary(p) for p in sorted(d.glob("*.yaml"))] if d.is_dir() else []


def get(slug: str) -> dict[str, Any]:
    path = _path(slug)
    if not path.is_file():
        raise HTTPException(404, "Project not found.")
    try:
        return {"slug": slug, **bench_loader.load(path).model_dump(mode="json")}
    except Exception as e:
        raise HTTPException(422, [{"loc": ["file"], "msg": f"{type(e).__name__}: {str(e)[:200]}"}])


def _check_name(b: Benchmark, own: Path) -> None:
    """Two benchmarks with one name make every `standard`+`custom` resolve fail, so refuse it here."""
    taken = [p for p in bench_loader._yaml_files(bench_loader.BENCH_ROOT / "standard") + bench_loader._yaml_files(bench_loader.custom_dir())
             if p.resolve() != own]
    for p in taken:
        try:
            if bench_loader.load(p).name == b.name:
                raise HTTPException(409, f"A benchmark named '{b.name}' already exists.")
        except HTTPException:
            raise
        except Exception:
            continue


def _write(path: Path, b: Benchmark) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = yaml.safe_dump(b.model_dump(mode="json", exclude_defaults=True), sort_keys=False, allow_unicode=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    bench_loader._CACHE.pop(path, None)


def create(data: dict[str, Any]) -> dict[str, Any]:
    slug = data.pop("slug", None)
    b = validate(data)
    slug = slug if slug is not None else _slugify(b.name)
    path = _path(slug)
    if path.exists():
        raise HTTPException(409, f"Project '{slug}' already exists.")
    _check_name(b, path)
    _write(path, b)
    return get(slug)


def update(slug: str, data: dict[str, Any]) -> dict[str, Any]:
    path = _path(slug)
    if not path.is_file():
        raise HTTPException(404, "Project not found.")
    data.pop("slug", None)
    b = validate(data)
    _check_name(b, path)
    _write(path, b)
    return get(slug)


def delete(slug: str) -> None:
    path = _path(slug)
    if not path.is_file():
        raise HTTPException(404, "Project not found.")
    path.unlink()
    bench_loader._CACHE.pop(path, None)


class Example(BaseModel):
    input: str = Field(max_length=20_000)
    expected: Any = None


class DraftRequest(BaseModel):
    target: str
    description: str = Field(max_length=10_000)
    examples: list[Example] = Field(default_factory=list, max_length=50)
    n_cases: int = Field(12, ge=1, le=50)
    scorer_hint: str | None = Field(None, max_length=500)


def _prompt(req: DraftRequest) -> list[dict[str, str]]:
    scorers = "\n".join(f"- {s['name']}: {s['description']}".rstrip(": ") for s in scorer_list())
    system = (
        "You design evaluation benchmarks for comparing language models. Reply with one JSON object only, no prose, "
        "matching the Benchmark JSON schema. Each case needs a unique `id`, an `input` prompt and, for deterministic "
        "scorers, an `expected` answer. Put the scorers in the top-level `scorers` list as {\"type\": <name>, "
        "\"params\": {...}}. Use only these scorer types:\n" + scorers
    )
    parts = [f"Description of what to measure:\n{req.description}", f"Write exactly {req.n_cases} cases."]
    if req.scorer_hint:
        parts.append(f"Preferred scorer: {req.scorer_hint}")
    if req.examples:
        parts.append("Examples from the user (follow their style):\n" + "\n".join(
            json.dumps(e.model_dump(exclude_none=True), ensure_ascii=False) for e in req.examples))
    return [{"role": "system", "content": system}, {"role": "user", "content": "\n\n".join(parts)}]


def _extract_json(text: str) -> Any:
    t = text.strip()
    if m := re.search(r"```(?:json)?\s*(.*?)```", t, re.S):
        t = m.group(1).strip()
    try:
        return json.loads(t)
    except ValueError:
        i, j = t.find("{"), t.rfind("}")
        if i < 0 or j <= i:
            raise
        return json.loads(t[i : j + 1])


async def draft(req: DraftRequest, cfg: TargetConfig) -> dict[str, Any]:
    """Ask the model for a Benchmark and validate it. Nothing is written; examples are never logged."""
    messages = _prompt(req)
    if cfg.kind == "litellm":
        fmt = {"type": "json_schema", "json_schema": {"name": "benchmark", "schema": Benchmark.model_json_schema()}}
        structured = cfg.model_copy(update={"max_tokens": max(cfg.max_tokens, 8192), "extra": {**cfg.extra, "response_format": fmt}})
        comp = await build_target(structured).complete(messages)
        if comp.error:  # the provider may reject response_format: plain JSON instruction
            comp = await build_target(structured.model_copy(update={"extra": cfg.extra})).complete(messages)
    else:
        comp = await build_target(cfg).complete(messages)
    if comp.error:
        raise HTTPException(502, f"The model call failed: {comp.error[:300]}")
    try:
        data = _extract_json(comp.text)
        if not isinstance(data, dict):
            raise ValueError
    except ValueError:
        raise HTTPException(422, [{"loc": ["model_output"], "msg": "The model did not return a JSON object."}])
    if isinstance(data.get("cases"), list):
        data["cases"] = data["cases"][: req.n_cases]
    data["source"] = "custom"
    b = validate(data)
    return {"benchmark": b.model_dump(mode="json"), "cost_usd": comp.cost_usd,
            "input_tokens": comp.input_tokens, "output_tokens": comp.output_tokens}

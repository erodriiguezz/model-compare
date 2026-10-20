"""Core data shapes: targets, benchmarks, cases, and per-case results."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, model_validator

Dimension = Literal[
    "reasoning",
    "knowledge",
    "coding",
    "instruction_following",
    "structured_output",
    "tool_calling",
    "long_context",
    "factuality",
    "calibration",
    "summarization",
    "safety_over_refusal",
    "safety_harmful",
    "robustness",
    "multilingual",
    "software_delivery",
    "agentic",
    "custom",
]


class Pricing(BaseModel):
    """USD per 1M tokens. Leave unset to use LiteLLM's model registry."""

    input: float | None = None
    output: float | None = None


class TargetConfig(BaseModel):
    """A model under test. `model` is any LiteLLM model string, e.g. `anthropic/claude-sonnet-5-5`."""

    name: str
    kind: Literal["litellm", "mock"] = "litellm"
    model: str
    temperature: float | None = 0.0
    max_tokens: int = 2048
    system_prompt: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)
    pricing: Pricing = Field(default_factory=Pricing)

    @property
    def vendor(self) -> str:
        return self.model.split("/", 1)[0] if "/" in self.model else self.model.split("-", 1)[0]


class ScorerSpec(BaseModel):
    type: str
    weight: float = 1.0
    params: dict[str, Any] = Field(default_factory=dict)


class ToolSpec(BaseModel):
    """OpenAI-style function tool definition (LiteLLM translates per provider)."""

    name: str
    description: str
    parameters: dict[str, Any]

    def to_openai(self) -> dict[str, Any]:
        return {"type": "function", "function": self.model_dump()}


class Case(BaseModel):
    id: str
    input: str
    expected: Any = None
    vars: dict[str, Any] = Field(default_factory=dict)
    scorers: list[ScorerSpec] | None = None  # overrides benchmark-level scorers
    tags: list[str] = Field(default_factory=list)
    document: str | None = None  # key into Benchmark.documents, sent before the input


class Benchmark(BaseModel):
    name: str
    version: str = "1"
    dimension: Dimension = "custom"
    description: str = ""
    system_prompt: str | None = None
    tools: list[ToolSpec] = Field(default_factory=list)
    documents: dict[str, str] = Field(default_factory=dict)  # shared long texts, referenced by Case.document
    scorers: list[ScorerSpec] = Field(default_factory=list)
    repeats: int = 1
    pass_threshold: float = 1.0
    cases: list[Case]
    source: str = "custom"  # "standard" | "custom" | "public:<dataset>"
    contamination_risk: bool = False

    @model_validator(mode="after")
    def _check(self) -> "Benchmark":
        ids = [c.id for c in self.cases]
        if len(ids) != len(set(ids)):
            raise ValueError(f"benchmark {self.name}: duplicate case ids")
        for c in self.cases:
            if not (c.scorers or self.scorers):
                raise ValueError(f"benchmark {self.name}: case {c.id} has no scorers")
            if c.document and c.document not in self.documents:
                raise ValueError(f"benchmark {self.name}: case {c.id} references unknown document {c.document!r}")
        return self

    @property
    def fingerprint(self) -> str:
        """Content hash, so comparisons can refuse to mix benchmark revisions."""
        payload = json.dumps(self.model_dump(mode="json"), sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()[:12]

    @classmethod
    def load(cls, path: str | Path) -> "Benchmark":
        loader = getattr(yaml, "CSafeLoader", yaml.SafeLoader)  # libyaml: the full deck is several MB
        data = yaml.load(Path(path).read_text(), Loader=loader)
        return cls.model_validate(data)


class Completion(BaseModel):
    text: str = ""
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    latency_s: float = 0.0
    cost_usd: float = 0.0
    error: str | None = None
    cached: bool = False
    temperature_fallback: bool = False  # provider rejected `temperature`; the call was retried without it


class ScoreDetail(BaseModel):
    type: str
    score: float  # 0..1
    weight: float = 1.0
    reason: str = ""


class CaseResult(BaseModel):
    case_id: str
    repeat: int
    completion: Completion
    scores: list[ScoreDetail]
    score: float
    passed: bool


def load_targets(path: str | Path) -> dict[str, TargetConfig]:
    data = yaml.safe_load(Path(path).read_text())
    items = data.get("targets", data) if isinstance(data, dict) else data
    targets = [TargetConfig.model_validate(t) for t in items]
    return {t.name: t for t in targets}


# LiteLLM's provider prefix where it differs from the name used for the key (keys.PROVIDERS).
_LITELLM_PREFIX = {"togetherai": "together_ai"}


def resolve_target(name: str, configured: dict[str, TargetConfig]) -> TargetConfig | None:
    """A targets.yaml name wins. Otherwise a catalog id `<provider>/<model-id>` (as listed by /api/models in
    each model's `target`), or a bare model id from the cached catalog, becomes an ad-hoc target."""
    if name in configured:
        return configured[name]
    from modelcompare import catalog, keys

    if "/" not in name:
        name = catalog.find_cached(name) or name
    provider, _, model_id = name.partition("/")
    if provider not in keys.PROVIDERS or not model_id:
        return None
    return TargetConfig(name=name, model=f"{_LITELLM_PREFIX.get(provider, provider)}/{model_id}", temperature=None)

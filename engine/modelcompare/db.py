"""Persistence: runs, per-case results, and a response cache. SQLite by default, Postgres via URL."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Integer
from sqlmodel import JSON, Column, Field, Session, SQLModel, create_engine, func, select

DEFAULT_URL = f"sqlite:///{Path(os.getenv('MODELCOMPARE_HOME', '.modelcompare')) / 'modelcompare.db'}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Run(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    target_name: str = Field(index=True)
    target_config: dict = Field(sa_column=Column(JSON))
    benchmark_name: str = Field(index=True)
    benchmark_version: str
    benchmark_fingerprint: str
    dimension: str
    source: str = "custom"
    contamination_risk: bool = False
    pass_threshold: float = 1.0
    judge_model: str | None = None
    status: str = "running"  # running | done | budget_exceeded | cancelled | failed | interrupted
    started_at: datetime = Field(default_factory=_now)
    finished_at: datetime | None = None


class Result(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="run.id", index=True)
    case_id: str
    repeat: int
    score: float
    passed: bool
    text: str
    tool_calls: list = Field(default_factory=list, sa_column=Column(JSON))
    scores: list = Field(default_factory=list, sa_column=Column(JSON))
    input_tokens: int = 0
    output_tokens: int = 0
    latency_s: float = 0.0
    cost_usd: float = 0.0
    error: str | None = None
    cached: bool = False


class Job(SQLModel, table=True):
    """A comparison started from the dashboard: one run per (target, benchmark)."""

    id: str = Field(primary_key=True)
    targets: list = Field(default_factory=list, sa_column=Column(JSON))
    baseline: str | None = None
    benchmarks: list = Field(default_factory=list, sa_column=Column(JSON))
    judge: str | None = None
    repeats: int | None = None
    total_calls: int = 0
    done_calls: int = 0
    run_ids: list = Field(default_factory=list, sa_column=Column(JSON))
    runs: list = Field(default_factory=list, sa_column=Column(JSON))  # per-run summaries
    status: str = "queued"  # queued | running | done | cancelled | failed | interrupted
    current: str | None = None
    error: str | None = None
    started_at: datetime = Field(default_factory=_now)
    finished_at: datetime | None = None


class CacheEntry(SQLModel, table=True):
    key: str = Field(primary_key=True)
    completion: str  # JSON-encoded Completion


_engines: dict[str, object] = {}


def get_engine(url: str | None = None):
    url = url or os.getenv("MODELCOMPARE_DB_URL") or DEFAULT_URL
    if url not in _engines:
        if url.startswith("sqlite:///"):
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        engine = create_engine(url)
        SQLModel.metadata.create_all(engine)
        _engines[url] = engine
    return _engines[url]


def session(url: str | None = None) -> Session:
    return Session(get_engine(url), expire_on_commit=False)


def cache_get(s: Session, key: str) -> dict | None:
    row = s.get(CacheEntry, key)
    return json.loads(row.completion) if row else None


def cache_put(s: Session, key: str, completion: dict) -> None:
    s.merge(CacheEntry(key=key, completion=json.dumps(completion)))


def list_runs(s: Session) -> list[Run]:
    return list(s.exec(select(Run).order_by(Run.id.desc())))


def run_results(s: Session, run_id: int) -> list[Result]:
    return list(s.exec(select(Result).where(Result.run_id == run_id)))


def run_summaries(s: Session) -> dict[int, dict]:
    """Per-run counts: results, passed, errors and spend."""
    q = select(
        Result.run_id,
        func.count(Result.id),
        func.sum(func.cast(Result.passed, Integer)),
        func.count(Result.error),
        func.sum(Result.cost_usd),
    ).group_by(Result.run_id)
    return {
        rid: {"n_results": n, "passed": passed or 0, "n_errors": errors, "cost_usd": cost or 0.0}
        for rid, n, passed, errors, cost in s.exec(q)
    }


def mark_interrupted(s: Session) -> int:
    """Runs and jobs left `running` by a previous process can never finish; say so."""
    n = 0
    for model in (Run, Job):
        for row in s.exec(select(model).where(model.status.in_(["running", "queued"]))):
            row.status = "interrupted"
            s.add(row)
            n += 1
    s.commit()
    return n

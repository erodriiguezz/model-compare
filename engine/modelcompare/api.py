"""HTTP API and web dashboard. Mirrors the CLI."""

from __future__ import annotations

import asyncio
import os
import re
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import yaml
from fastapi import APIRouter, BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError
from sqlmodel import select

from modelcompare import db
from modelcompare.bench_loader import resolve_benchmarks
from modelcompare import catalog, keys, projects
from modelcompare.html_report import render_html
from modelcompare.recommend import load_profiles
from modelcompare.report import build_report, latest_runs, runs_by_ids
from modelcompare.runner import benchmarks_needing_judge, build_messages, cache_key, estimate_cost, price_unknown, run_benchmark
from modelcompare.schema import Benchmark, TargetConfig, load_targets, resolve_target
from modelcompare.summary import capability

def _warm_litellm() -> None:
    """Importing litellm costs over a second; pay it at startup so the first /models call doesn't."""
    try:
        import litellm  # noqa: F401
    except Exception:  # a broken optional dependency must not stop the server
        pass


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # Runs left `running` by a previous server process can never finish.
    with db.session() as s:
        db.mark_interrupted(s)
    threading.Thread(target=_warm_litellm, daemon=True).start()
    yield


router = APIRouter()
WEB_OUT = Path(__file__).resolve().parents[2] / "web" / "out"


def _targets_file() -> Path:
    return Path(os.getenv("MODELCOMPARE_TARGETS", "targets.yaml"))


def _targets(required: bool = True) -> dict[str, TargetConfig]:
    path = _targets_file()
    if not path.exists():
        if not required:
            return {}
        raise HTTPException(404, f"{path} not found; copy targets.example.yaml to {path.name} and edit the model ids")
    try:
        return load_targets(path)
    except (yaml.YAMLError, ValueError, AttributeError, TypeError) as e:
        raise HTTPException(400, f"{path} is not a valid targets file: {type(e).__name__}")


def _benchmarks(specs: list[str]) -> list[Benchmark]:
    try:
        return resolve_benchmarks(specs)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(400, str(e))


@router.get("/targets")
def targets():
    # Configs hold model names and params only; API keys come from the environment.
    return [t.model_dump() for t in _targets().values()]


@router.get("/targets/status")
def targets_status():
    """Whether each target's provider key is set. Reports variable names only, never values."""
    import litellm

    out = []
    for t in _targets().values():
        missing: list[str] = []
        if t.kind != "mock":
            try:
                missing = litellm.validate_environment(t.model).get("missing_keys", [])
            except Exception as e:
                missing = [f"unknown provider ({type(e).__name__})"]
        out.append({"name": t.name, "model": t.model, "kind": t.kind, "keys_ok": not missing, "missing_keys": missing})
    return out


def models(refresh: bool = False):
    """Chat models each configured key can reach, by provider, with LiteLLM price and context where known."""
    return catalog.list_models(refresh=refresh)


@router.get("/benchmarks")
def benchmarks(spec: list[str] = Query(["standard", "custom"])):
    return [
        {"name": b.name, "dimension": b.dimension, "version": b.version, "fingerprint": b.fingerprint,
         "cases": len(b.cases), "repeats": b.repeats, "description": b.description,
         "needs_judge": bool(benchmarks_needing_judge([b])), "capability": capability(b.dimension)["label"],
         "capability_description": capability(b.dimension)["description"]}
        for b in _benchmarks(spec)
    ]


@router.get("/profiles")
def profiles():
    return load_profiles()


@router.get("/runs")
def runs(limit: int | None = Query(None, ge=1)):
    """Newest first. `limit` keeps it cheap (the dashboard only asks whether any run exists)."""
    with db.session() as s:
        rows = db.list_runs(s, limit)
        summaries = db.run_summaries(s, [r.id for r in rows] if limit else None)
        empty = {"n_results": 0, "passed": 0, "n_errors": 0, "cost_usd": 0.0}
        return [{**r.model_dump(), **summaries.get(r.id, empty)} for r in rows]


@router.get("/runs/{run_id}")
def run_detail(run_id: int):
    with db.session() as s:
        run = s.get(db.Run, run_id)
        if not run:
            raise HTTPException(404)
        return {"run": run, "results": db.run_results(s, run_id)}


class RunRequest(BaseModel):
    targets: list[str]
    benchmarks: list[str] = ["standard"]
    baseline: str | None = None
    judge: str | None = None
    repeats: int | None = None  # overrides each benchmark's own repeat count
    budget_usd: float | None = None  # per run (target x benchmark), as in the CLI
    concurrency: int = 8  # in-flight calls per target
    use_cache: bool = True


ASSUMED_LATENCY_S = 8.0  # per call, for the time estimate only


def _resolve(req: RunRequest) -> tuple[dict[str, TargetConfig], list[Benchmark]]:
    """Validate a run request the way the CLI does: known targets, and a judge when a benchmark needs one."""
    all_t = _targets(required=False)  # catalog ids run without a targets file
    if not req.targets:
        raise HTTPException(400, "pick at least one target")
    extra = [x for x in (req.judge, req.baseline) if x]
    resolved = {t: resolve_target(t, all_t) for t in dict.fromkeys(req.targets + extra)}
    if unknown := [t for t, cfg in resolved.items() if cfg is None]:
        raise HTTPException(400, f"unknown targets {unknown}")
    all_t = {**all_t, **resolved}
    if req.baseline and req.baseline not in req.targets:
        raise HTTPException(400, "the baseline must be one of the selected targets")
    benches = _benchmarks(req.benchmarks)
    if req.repeats:
        benches = [b.model_copy(update={"repeats": req.repeats}) for b in benches]
    if (needs := benchmarks_needing_judge(benches)) and not req.judge:
        raise HTTPException(400, f"a judge is required for {needs}")
    return all_t, benches


def _calls(benches: list[Benchmark]) -> int:
    return sum(len(b.cases) * b.repeats for b in benches)


@router.post("/runs/estimate")
def estimate(req: RunRequest):
    """Upper-bound cost and duration, counting only calls that aren't already cached."""
    all_t, benches = _resolve(req)
    usd = judge_usd = 0.0
    cached = total = 0
    judged = set(benchmarks_needing_judge(benches))
    with db.session() as s:
        for t in req.targets:
            cfg = all_t[t]
            for b in benches:
                tools = [x.to_openai() for x in b.tools]
                per_call = estimate_cost(cfg, b) / max(len(b.cases) * b.repeats, 1)
                for case in b.cases:
                    msgs = build_messages(cfg, b, case)
                    for r in range(b.repeats):
                        total += 1
                        if req.use_cache and db.cache_get(s, cache_key(cfg, msgs, tools, r)):
                            cached += 1
                        else:
                            usd += per_call
                if b.name in judged and req.judge:
                    judge_usd += 2 * estimate_cost(all_t[req.judge], b)  # judge reads the task and the answer
    fresh = total - cached
    per_target = fresh / max(len(req.targets), 1)  # targets run side by side
    return {
        "usd": usd + judge_usd,
        "judge_usd": judge_usd,
        "unpriced": [t for t in dict.fromkeys([*req.targets, *([req.judge] if judged and req.judge else [])]) if price_unknown(all_t[t])],
        "total_calls": total,
        "cached_calls": cached,
        "minutes": per_target * ASSUMED_LATENCY_S / max(req.concurrency, 1) / 60,
    }


ACTIVE: dict[str, db.Job] = {}  # live state of running jobs; persisted at each milestone
LIVE: dict[str, dict[str, dict]] = {}  # job id -> target -> counters for the benchmark in progress
CANCEL: set[str] = set()


def _save(job: db.Job) -> None:
    with db.session() as s:
        s.merge(job)
        s.commit()


def _job_dict(job: db.Job) -> dict:
    return job.model_dump(mode="json")


@router.post("/runs", status_code=202)
def start_runs(req: RunRequest, bg: BackgroundTasks):
    all_t, benches = _resolve(req)
    job = db.Job(
        id=uuid.uuid4().hex[:8], targets=req.targets, baseline=req.baseline or req.targets[0],
        benchmarks=[b.name for b in benches], judge=req.judge, repeats=req.repeats,
        total_calls=len(req.targets) * _calls(benches),
    )
    ACTIVE[job.id] = job
    LIVE[job.id] = {}
    _save(job)
    judge = all_t.get(req.judge) if req.judge else None

    async def run_one(t: str, b: Benchmark) -> None:
        live = {"target": t, "benchmark": b.name, "dimension": b.dimension, "done": 0,
                "total": len(b.cases) * b.repeats, "passed": 0, "errors": 0}
        LIVE[job.id][t] = live

        def on_result(cr) -> None:
            live["done"] += 1
            live["passed"] += cr.passed
            live["errors"] += bool(cr.completion.error)
            job.done_calls += 1

        out = await run_benchmark(all_t[t], b, judge, concurrency=req.concurrency, budget_usd=req.budget_usd,
                                  use_cache=req.use_cache, on_result=on_result, should_stop=lambda: job.id in CANCEL)
        job.run_ids = [*job.run_ids, out.run_id]
        job.runs = [*job.runs, {
            "run_id": out.run_id, "target": t, "benchmark": b.name, "dimension": b.dimension, "status": out.status,
            "passed": sum(r.passed for r in out.results), "n_results": len(out.results),
            "n_errors": sum(1 for r in out.results if r.completion.error),
            "first_error": next((r.completion.error for r in out.results if r.completion.error), None),
            "cost_usd": out.cost_usd,
        }]

    async def work():
        job.status = "running"
        _save(job)
        try:
            # Benchmark by benchmark, all targets side by side: partial results stay comparable.
            for b in benches:
                if job.id in CANCEL:
                    break
                job.current = b.name
                await asyncio.gather(*(run_one(t, b) for t in req.targets))
                _save(job)
            job.status = "cancelled" if job.id in CANCEL else "done"
        except Exception as e:
            job.status, job.error = "failed", f"{type(e).__name__}: {e}"
        finally:
            job.current = None
            job.finished_at = datetime.now(timezone.utc)
            _save(job)
            ACTIVE.pop(job.id, None)
            LIVE.pop(job.id, None)
            CANCEL.discard(job.id)

    bg.add_task(work)
    return {"job_id": job.id, "total_calls": job.total_calls}


@router.get("/jobs")
def jobs():
    with db.session() as s:
        rows = list(s.exec(select(db.Job).order_by(db.Job.started_at.desc())))
    return [_job_dict(ACTIVE.get(j.id, j)) for j in rows]


@router.get("/jobs/{job_id}")
def job(job_id: str):
    if job_id in ACTIVE:
        j = ACTIVE[job_id]
        return {**_job_dict(j), "live": list(LIVE.get(job_id, {}).values())}
    with db.session() as s:
        j = s.get(db.Job, job_id)
    if not j:
        raise HTTPException(404, "unknown job")
    return {**_job_dict(j), "live": []}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    if job_id not in ACTIVE:
        raise HTTPException(409, "job is not running")
    CANCEL.add(job_id)
    return {"cancelling": job_id}


def _job_report(job_id: str) -> dict:
    with db.session() as s:
        j = s.get(db.Job, job_id)
        if not j:
            raise HTTPException(404, "unknown job")
        rs = runs_by_ids(s, j.run_ids)
        if not rs:
            raise HTTPException(404, "this job has no finished runs yet")
        names = {r.target_name for r in rs}
        return build_report(s, rs, baseline=j.baseline if j.baseline in names else None)


@router.get("/jobs/{job_id}/report")
def job_report(job_id: str):
    return _job_report(job_id)


@router.get("/jobs/{job_id}/report.html", response_class=HTMLResponse)
def job_report_html(job_id: str):
    return render_html(_job_report(job_id))


class CompareRequest(BaseModel):
    targets: list[str]
    baseline: str | None = None
    benchmarks: list[str] | None = None
    min_quality: float = 0.7


@router.post("/compare")
def compare(req: CompareRequest):
    with db.session() as s:
        rs = latest_runs(s, req.targets, req.benchmarks)
        if not rs:
            raise HTTPException(404, "no completed runs for those targets")
        return build_report(s, rs, baseline=req.baseline or req.targets[0], min_quality=req.min_quality)


@router.post("/compare.html", response_class=HTMLResponse)
def compare_html(req: CompareRequest):
    return render_html(compare(req))


_LOCAL_HOST = re.compile(r"(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?")


def _local_only(request: Request) -> None:
    """DNS-rebinding and cross-site defence for routes that write secrets: loopback Host, and Origin if sent."""
    if not _LOCAL_HOST.fullmatch(request.headers.get("host", "").lower()):
        raise HTTPException(403, "Only available from localhost.")
    origin = request.headers.get("origin")
    if origin is not None:
        scheme, sep, netloc = origin.lower().partition("://")
        if not sep or scheme not in ("http", "https") or not _LOCAL_HOST.fullmatch(netloc):
            raise HTTPException(403, "Cross-origin requests are not allowed.")


settings = APIRouter(prefix="/settings", dependencies=[Depends(_local_only)])


def _provider(provider: str) -> str:
    if provider not in keys.PROVIDERS:
        raise HTTPException(404, "Unknown provider")
    return provider


@settings.get("/keys")
def keys_list():
    return keys.all_status()


@settings.put("/keys/{provider}")
async def keys_put(provider: str, request: Request):
    _provider(provider)
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        raise HTTPException(415, "Content-Type must be application/json.")
    try:
        body = await request.json()
        keys.set_key(provider, body.get("value") if isinstance(body, dict) else None)
    except (ValueError, UnicodeDecodeError) as e:  # InvalidKey and bad JSON; messages never hold the value
        raise HTTPException(422, str(e) if isinstance(e, keys.InvalidKey) else 'Body must be JSON {"value": string}.')
    return keys.status(provider)


@settings.delete("/keys/{provider}")
def keys_delete(provider: str):
    try:
        keys.remove_key(_provider(provider))
    except keys.EnvironmentOnly:
        raise HTTPException(409, "This key is set in the server environment and cannot be removed here.")
    return keys.status(provider)


@settings.post("/keys/{provider}/test")
def keys_test(provider: str):
    return keys.probe(_provider(provider))


async def _json_body(request: Request) -> dict:
    cl = request.headers.get("content-length")
    if cl is not None:
        if not cl.isdigit():
            raise HTTPException(400, "Content-Length must be an integer.")
        if int(cl) > projects.MAX_BODY:
            raise HTTPException(413, "Body is over 1 MB.")
    raw = bytearray()
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > projects.MAX_BODY:
            raise HTTPException(413, "Body is over 1 MB.")
    return projects.parse_body(bytes(raw))


projects_api = APIRouter(prefix="/projects", dependencies=[Depends(_local_only)])


@projects_api.get("")
def projects_list():
    return projects.list_projects()


@projects_api.post("", status_code=201)
async def projects_create(request: Request):
    return projects.create(await _json_body(request))


@projects_api.post("/draft")
async def projects_draft(request: Request):
    try:
        req = projects.DraftRequest.model_validate(await _json_body(request))
    except ValidationError as e:
        raise HTTPException(422, projects._errors(e))
    cfg = resolve_target(req.target, _targets(required=False))
    if cfg is None:
        raise HTTPException(400, f"unknown target: {req.target}")
    return await projects.draft(req, cfg)


@projects_api.get("/{slug}")
def projects_get(slug: str):
    return projects.get(slug)


@projects_api.put("/{slug}")
async def projects_update(slug: str, request: Request):
    return projects.update(slug, await _json_body(request))


@projects_api.delete("/{slug}", status_code=204)
def projects_delete(slug: str):
    projects.delete(slug)


def create_app(web_out: Path | None = None) -> FastAPI:
    """API under /api and at the root (old aliases); the exported Next app at / (503 with build instructions if missing)."""
    app = FastAPI(title="ModelCompare", lifespan=_lifespan)
    app.include_router(router, prefix="/api")
    app.add_api_route("/api/models", models, methods=["GET"], dependencies=[Depends(_local_only)])  # no root alias: /models/ is a Next page
    app.include_router(settings, prefix="/api")  # no root alias: secrets stay under /api
    app.include_router(projects_api, prefix="/api")  # no root alias: /projects/ is a Next page
    app.add_api_route("/api/scorers", lambda: projects.scorer_list(), methods=["GET"], dependencies=[Depends(_local_only)])
    app.include_router(router, include_in_schema=False)
    # The export is not packaged with the wheel: it is resolved from the checkout (or MODELCOMPARE_WEB_OUT).
    out = web_out or Path(os.getenv("MODELCOMPARE_WEB_OUT", WEB_OUT))

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    def api_not_found(rest: str):
        raise HTTPException(404, "Not Found")

    if out.is_dir():
        app.mount("/", StaticFiles(directory=out, html=True), name="web")
    else:
        app.add_api_route("/", lambda: PlainTextResponse(
            "The dashboard is not built. Run: cd web && npm ci && npm run build", status_code=503), include_in_schema=False)
    return app


api = create_app()

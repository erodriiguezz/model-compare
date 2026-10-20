"""HTTP API used by the web dashboard, with mock targets (no network, no API keys)."""

from pathlib import Path
import json

import pytest
from fastapi.testclient import TestClient

from modelcompare.api import create_app
from modelcompare.schema import Benchmark, TargetConfig
from test_end_to_end import N, bench, mock


@pytest.fixture
def client(db_url, tmp_path, monkeypatch):
    bench_file = tmp_path / "b.yaml"
    bench_file.write_text(json.dumps(bench().model_dump(mode="json")))  # JSON is valid YAML
    judged = Benchmark(name="judged", scorers=[{"type": "llm_judge"}], cases=[{"id": "j1", "input": "hi"}])
    (tmp_path / "judged.yaml").write_text(json.dumps(judged.model_dump(mode="json")))
    paid = TargetConfig(name="paid", model="openai/gpt-test")
    targets = tmp_path / "targets.yaml"
    targets.write_text(json.dumps({"targets": [
        mock("good", set(range(N))).model_dump(), mock("bad", set()).model_dump(), paid.model_dump(),
    ]}))
    monkeypatch.setenv("MODELCOMPARE_TARGETS", str(targets))
    c = TestClient(create_app(tmp_path / "no-web-out"))
    c.bench_file, c.judged_file = str(bench_file), str(tmp_path / "judged.yaml")
    return c


def test_missing_targets_file_explains_setup(client, monkeypatch, tmp_path):
    monkeypatch.setenv("MODELCOMPARE_TARGETS", str(tmp_path / "nope.yaml"))
    res = client.get("/targets")
    assert res.status_code == 404 and "targets.example.yaml" in res.json()["detail"]


def test_key_status_names_missing_vars(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    status = {t["name"]: t for t in client.get("/targets/status").json()}
    assert status["good"]["keys_ok"] and status["good"]["missing_keys"] == []
    assert not status["paid"]["keys_ok"] and "OPENAI_API_KEY" in status["paid"]["missing_keys"]


def test_bad_requests_are_rejected(client):
    assert client.post("/runs", json={"targets": ["nope"], "benchmarks": [client.bench_file]}).status_code == 400
    assert client.post("/runs", json={"targets": ["good"], "benchmarks": ["no/such.yaml"]}).status_code == 400
    res = client.post("/runs", json={"targets": ["good"], "benchmarks": [client.judged_file]})
    assert res.status_code == 400 and "judge" in res.json()["detail"]


def test_run_job_reports_progress_and_summaries(client):
    req = {"targets": ["good", "bad"], "benchmarks": [client.bench_file]}
    assert client.post("/runs/estimate", json=req).json()["total_calls"] == 2 * N
    res = client.post("/runs", json=req)
    assert res.status_code == 202
    job = client.get(f"/jobs/{res.json()['job_id']}").json()
    assert job["status"] == "done" and job["done_calls"] == job["total_calls"] == 2 * N
    by_target = {r["target"]: r for r in job["runs"]}
    assert by_target["good"]["passed"] == N and by_target["bad"]["passed"] == 0

    runs = {r["target_name"]: r for r in client.get("/runs").json()}
    assert runs["good"]["n_results"] == N and runs["good"]["passed"] == N and runs["bad"]["n_errors"] == 0

    html = client.post("/compare.html", json={"targets": ["bad", "good"], "baseline": "bad"})
    assert html.status_code == 200 and "<html" in html.text.lower()


def test_unknown_job_is_404(client):
    assert client.get("/jobs/nope").status_code == 404
    assert client.post("/jobs/nope/cancel").status_code == 409


def test_job_is_persisted_with_its_own_report(client):
    req = {"targets": ["bad", "good"], "baseline": "bad", "benchmarks": [client.bench_file], "repeats": 2}
    job_id = client.post("/runs", json=req).json()["job_id"]
    job = client.get(f"/jobs/{job_id}").json()  # served from the database once finished
    assert job["status"] == "done" and job["baseline"] == "bad" and len(job["run_ids"]) == 2
    assert job["total_calls"] == job["done_calls"] == 2 * 2 * N
    assert [j["id"] for j in client.get("/jobs").json()] == [job_id]

    rep = client.get(f"/jobs/{job_id}/report").json()
    assert rep["baseline"] == "bad" and rep["summary"]["decisions"][0]["overall_verdict"] == "better"
    assert rep["flagged"]["good"]["items"][0]["tag"] == "consistent"  # two repeats agreed
    html = client.get(f"/jobs/{job_id}/report.html").text
    assert "Decision" in html and "Capabilities" in html


def test_estimate_counts_cached_calls(client):
    req = {"targets": ["good"], "benchmarks": [client.bench_file]}
    assert client.post("/runs/estimate", json=req).json()["cached_calls"] == 0
    client.post("/runs", json=req)
    est = client.post("/runs/estimate", json=req).json()
    assert est["cached_calls"] == est["total_calls"] == N


def test_baseline_must_be_selected(client):
    res = client.post("/runs", json={"targets": ["good"], "baseline": "bad", "benchmarks": [client.bench_file]})
    assert res.status_code == 400 and "baseline" in res.json()["detail"]


def test_api_prefix_and_alias(client):
    """[AC-2.1] /api/* and the old root paths return the same JSON."""
    res = client.get("/api/targets")
    assert res.status_code == 200 and res.json() == client.get("/targets").json()


def test_missing_export_explains_build(tmp_path):
    """[AC-3.4] With no web export, / is a clear 503, and the old page is gone."""
    res = TestClient(create_app(tmp_path / "missing")).get("/")
    assert res.status_code == 503 and "npm run build" in res.text
    assert not (Path(__file__).parents[1] / "modelcompare" / "web" / "index.html").exists()


def test_root_serves_next(tmp_path):
    """[AC-3.4] / and /history/ come from the Next export."""
    (tmp_path / "history").mkdir()
    (tmp_path / "index.html").write_text("<title>Next home</title>")
    (tmp_path / "history" / "index.html").write_text("<title>Next history</title>")
    c = TestClient(create_app(tmp_path))
    assert "Next home" in c.get("/").text and "Next history" in c.get("/history/").text


def test_next_export_served_and_compare_post_still_hits_api(client, tmp_path):
    """[AC-2.1] GET /compare serves the exported page while POST /compare stays the API."""
    out = tmp_path / "out"
    out.mkdir()
    (out / "index.html").write_text("<title>Next home</title>")
    (out / "compare").mkdir()
    (out / "compare" / "index.html").write_text("<title>Next compare</title>")
    c = TestClient(create_app(out))
    assert "Next home" in c.get("/").text
    assert "Next compare" in c.get("/compare/").text
    assert "Next compare" in c.get("/compare").text  # redirected to /compare/
    res = c.post("/compare", json={"targets": ["nobody"]})
    assert res.status_code == 404 and "no completed runs" in res.json()["detail"]
    assert c.post("/api/compare", json={"targets": ["nobody"]}).status_code == 404


def test_unknown_api_path_is_json_404(client):
    out = client.get("/api/nope")
    assert out.status_code == 404 and out.json() == {"detail": "Not Found"}
    assert client.post("/api/nope", json={}).status_code == 404


def test_unknown_api_path_is_json_404_with_web_export(tmp_path):
    (tmp_path / "index.html").write_text("<title>Next home</title>")
    c = TestClient(create_app(tmp_path))
    assert c.get("/api/nope").json() == {"detail": "Not Found"}
    assert c.post("/api/nope", json={}).status_code == 404


def test_run_catalog_target(client, monkeypatch):
    """AC-5.4: a catalog id not in targets.yaml runs; a targets.yaml name wins over a catalog id."""
    from modelcompare import api

    seen = {}

    async def fake_run(cfg, b, judge, **kw):
        seen[cfg.name] = cfg
        from types import SimpleNamespace
        return SimpleNamespace(run_id=1, status="complete", results=[], cost_usd=0.0)

    monkeypatch.setattr(api, "run_benchmark", fake_run)
    req = {"targets": ["groq/llama-3.3-70b-versatile", "togetherai/meta-llama/Llama-3.3-70B-Instruct-Turbo", "good"],
           "benchmarks": [client.bench_file]}
    assert client.post("/runs/estimate", json=req).status_code == 200
    res = client.post("/runs", json=req)
    assert res.status_code == 202
    assert seen["groq/llama-3.3-70b-versatile"].model == "groq/llama-3.3-70b-versatile"
    assert seen["groq/llama-3.3-70b-versatile"].temperature is None
    assert seen["togetherai/meta-llama/Llama-3.3-70B-Instruct-Turbo"].model == "together_ai/meta-llama/Llama-3.3-70B-Instruct-Turbo"
    assert seen["good"].kind == "mock"  # the targets.yaml entry, not an ad-hoc one
    assert client.post("/runs", json={**req, "targets": ["nope/x"]}).status_code == 400
    assert client.post("/runs", json={**req, "targets": ["plain-name"]}).status_code == 400

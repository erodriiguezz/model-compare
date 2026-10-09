"""HTTP API used by the web dashboard, with mock targets (no network, no API keys)."""

import json

import litellm  # noqa: F401  # imported first: it loads ./.env, which would undo monkeypatch.delenv
import pytest
from fastapi.testclient import TestClient

from modelcompare.api import api
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
    c = TestClient(api)
    c.bench_file, c.judged_file = str(bench_file), str(tmp_path / "judged.yaml")
    return c


def test_dashboard_is_served(client):
    res = client.get("/")
    assert res.status_code == 200 and "<title>ModelCompare</title>" in res.text


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

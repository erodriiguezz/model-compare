"""Projects API: CRUD on a tmp custom dir, validation, slug safety, size limit, mock-target draft."""

import json

import pytest
from fastapi.testclient import TestClient

from modelcompare.api import create_app
from modelcompare.bench_loader import resolve_benchmarks
from modelcompare.schema import TargetConfig

LOCAL = {"host": "127.0.0.1"}
BENCH = {"name": "capitals", "scorers": [{"type": "contains"}],
         "cases": [{"id": "c1", "input": "Capital of France?", "expected": "Paris"}]}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MODELCOMPARE_CUSTOM_DIR", str(tmp_path / "custom"))
    drafter = TargetConfig(name="drafter", kind="mock", model="mock/d", extra={"default": json.dumps(BENCH)})
    junk = TargetConfig(name="junk", kind="mock", model="mock/j", extra={"default": '{"name":"x","scorers":[{"type":"nope"}],"cases":[]}'})
    prose = TargetConfig(name="prose", kind="mock", model="mock/p", extra={"default": "sorry, no"})
    t = tmp_path / "targets.yaml"
    t.write_text(json.dumps({"targets": [x.model_dump() for x in (drafter, junk, prose)]}))
    monkeypatch.setenv("MODELCOMPARE_TARGETS", str(t))
    c = TestClient(create_app(tmp_path / "no-web-out"))
    c.dir = tmp_path / "custom"
    return c


def test_ac_8_1_create_read_update_delete(client):
    res = client.post("/api/projects", json=BENCH, headers=LOCAL)
    assert res.status_code == 201 and res.json()["slug"] == "capitals"
    assert (client.dir / "capitals.yaml").is_file()
    assert [b.name for b in resolve_benchmarks(["custom"])] == ["capitals"]
    assert [b.name for b in resolve_benchmarks(["capitals"])] == ["capitals"]

    row = client.get("/api/projects", headers=LOCAL).json()[0]
    assert (row["slug"], row["n_cases"], row["valid"]) == ("capitals", 1, True)
    assert client.get("/api/projects/capitals", headers=LOCAL).json()["cases"][0]["expected"] == "Paris"
    assert client.post("/api/projects", json=BENCH, headers=LOCAL).status_code == 409

    two = {**BENCH, "cases": BENCH["cases"] + [{"id": "c2", "input": "Capital of Spain?", "expected": "Madrid"}]}
    assert client.put("/api/projects/capitals", json=two, headers=LOCAL).status_code == 200
    assert len(resolve_benchmarks(["capitals"])[0].cases) == 2  # cache invalidated on write

    assert client.delete("/api/projects/capitals", headers=LOCAL).status_code == 204
    assert not (client.dir / "capitals.yaml").exists()
    assert client.get("/api/projects/capitals", headers=LOCAL).status_code == 404
    assert not list(client.dir.glob("*.tmp"))


def test_ac_8_1_broken_file_is_listed_not_fatal(client):
    client.dir.mkdir()
    (client.dir / "bad.yaml").write_text("name: x\n")
    row = client.get("/api/projects", headers=LOCAL).json()[0]
    assert row["valid"] is False and row["error"]


def test_ac_8_2_invalid_benchmark_gets_field_errors(client):
    unknown = client.post("/api/projects", json={**BENCH, "scorers": [{"type": "nope"}]}, headers=LOCAL)
    assert unknown.status_code == 422 and "nope" in unknown.json()["detail"][0]["msg"]
    empty = client.post("/api/projects", json={**BENCH, "cases": []}, headers=LOCAL)
    assert empty.status_code == 422 and empty.json()["detail"][0]["loc"] == ["cases"]
    missing = client.post("/api/projects", json={"scorers": []}, headers=LOCAL)
    assert missing.status_code == 422 and missing.json()["detail"][0]["loc"]
    assert not client.dir.exists() or not list(client.dir.iterdir())


@pytest.mark.parametrize("slug", ["../x", "a/b", "A", "a" * 65, "..", "a.b"])
def test_ac_8_2_bad_slug_is_400(client, slug):
    assert client.post("/api/projects", json={**BENCH, "slug": slug}, headers=LOCAL).status_code == 400
    assert client.get(f"/api/projects/{slug.replace('/', '%2F')}", headers=LOCAL).status_code in (400, 404)
    assert not (client.dir.parent / "x.yaml").exists()


def test_ac_8_2_body_over_1mb_is_413(client):
    big = {**BENCH, "description": "x" * 1_100_000}
    assert client.post("/api/projects", json=big, headers=LOCAL).status_code == 413
    raw = json.dumps(big).encode()
    res = client.post("/api/projects", content=raw, headers={**LOCAL, "content-length": "10"})
    assert res.status_code in (413, 400, 422)


def test_foreign_host_is_403_on_projects(client):
    for method, url in (("get", "/api/projects"), ("post", "/api/projects"), ("get", "/api/scorers"), ("post", "/api/projects/draft")):
        assert getattr(client, method)(url, headers={"host": "evil.example"}).status_code == 403


def draft(client, target="drafter", **kw):
    return client.post("/api/projects/draft", json={"target": target, "description": "capitals", "examples": [{"input": "q", "expected": "a"}], **kw}, headers=LOCAL)


def test_ac_8_3_draft_returns_unsaved_benchmark(client):
    res = draft(client)
    assert res.status_code == 200
    body = res.json()
    assert body["benchmark"]["name"] == "capitals" and body["benchmark"]["source"] == "custom"
    assert {"cost_usd", "input_tokens", "output_tokens"} <= body.keys()
    assert not client.dir.exists() or not list(client.dir.iterdir())


def test_ac_8_3_invalid_model_output_is_422_with_reason(client):
    res = draft(client, "junk")
    assert res.status_code == 422 and "nope" in json.dumps(res.json()["detail"])
    assert "JSON" in draft(client, "prose").json()["detail"][0]["msg"]
    assert draft(client, "missing").status_code == 400
    assert draft(client, n_cases=51).status_code == 422


def test_ac_8_4_scorers_lists_the_registry(client):
    from modelcompare.scorers import REGISTRY

    res = client.get("/api/scorers", headers=LOCAL)
    assert res.status_code == 200 and {s["name"] for s in res.json()} == set(REGISTRY)

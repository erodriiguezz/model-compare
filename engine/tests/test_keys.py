"""Settings: provider keys in a tmp keys file. Every value here is fake."""

import os
import stat

import pytest

from modelcompare import keys
from test_api import client  # noqa: F401  # fixture: app with mock targets and a paid openai target

LOCAL = {"host": "127.0.0.1"}
FAKE = "sk-test-000000000000a1b2"
ORIGINAL = b"# engine keys\n\nOTHER=keep me\nexport FOO=bar # trailing\n\nOPENAI_API_KEY=old\nLAST=1\n"


@pytest.fixture
def keyfile(tmp_path, monkeypatch):
    f = tmp_path / "keys.test"
    f.write_bytes(ORIGINAL)
    monkeypatch.setenv("MODELCOMPARE_KEYS_FILE", str(f))
    for var in keys.PROVIDERS.values():
        monkeypatch.setenv(var, "x")  # registers the restore, so keys set by the API do not leak into other tests
        monkeypatch.delenv(var)
    return f


def put(client, provider, value, **kw):
    return client.put(f"/api/settings/keys/{provider}", json={"value": value}, headers=LOCAL, **kw)


def test_ac_4_1_put_replace_delete_preserve_other_lines(client, keyfile):
    base = ORIGINAL.replace(b"OPENAI_API_KEY=old\n", b"")
    keyfile.write_bytes(base)
    assert put(client, "openai", FAKE).status_code == 200
    assert keyfile.read_bytes() == base + f"OPENAI_API_KEY={FAKE}\n".encode()
    assert stat.S_IMODE(keyfile.stat().st_mode) == 0o600

    assert put(client, "openai", "  sk-test-replaced-9999  ").status_code == 200
    assert keyfile.read_bytes() == base + b"OPENAI_API_KEY=sk-test-replaced-9999\n"

    res = client.delete("/api/settings/keys/openai", headers=LOCAL)
    assert res.status_code == 200 and res.json()["set"] is False
    assert keyfile.read_bytes() == base
    assert stat.S_IMODE(keyfile.stat().st_mode) == 0o600


def test_ac_4_1_replace_in_place_keeps_position_and_creates_missing_file(client, keyfile):
    assert put(client, "openai", FAKE).status_code == 200
    assert keyfile.read_bytes() == ORIGINAL.replace(b"OPENAI_API_KEY=old", f"OPENAI_API_KEY={FAKE}".encode())
    keyfile.unlink()
    assert put(client, "groq", FAKE).status_code == 200
    assert keyfile.read_bytes() == f"GROQ_API_KEY={FAKE}\n".encode()
    assert stat.S_IMODE(keyfile.stat().st_mode) == 0o600


def test_ac_4_1_append_when_file_lacks_trailing_newline(client, keyfile):
    keyfile.write_bytes(b"A=1")
    put(client, "groq", FAKE)
    assert keyfile.read_bytes() == f"A=1\nGROQ_API_KEY={FAKE}\n".encode()


@pytest.mark.parametrize("value", ["", "   ", "a\nB=1", "a\rb", "a\x00b", "a\tb", "x" * 513, "kéy", "a b", 'a"b', "a#b", "a$b", "a\\b"])
def test_ac_4_3_invalid_values_rejected_and_file_unchanged(client, keyfile, value):
    res = put(client, "openai", value)
    assert res.status_code == 422
    assert keyfile.read_bytes() == ORIGINAL
    assert not value.strip() or value not in res.text


def test_ac_4_3_non_string_and_bad_json_rejected(client, keyfile):
    assert client.put("/api/settings/keys/openai", json={"value": 5}, headers=LOCAL).status_code == 422
    assert client.put("/api/settings/keys/openai", json=["x"], headers=LOCAL).status_code == 422
    assert client.put("/api/settings/keys/openai", content=b"{nope", headers={**LOCAL, "content-type": "application/json"}).status_code == 422
    assert keyfile.read_bytes() == ORIGINAL


def test_ac_4_2_values_never_in_any_response(client, keyfile):
    bodies = [
        put(client, "openai", FAKE),
        client.get("/api/settings/keys", headers=LOCAL),
        client.get("/api/targets/status"),
        client.post("/api/settings/keys/openai/test", headers=LOCAL),
        put(client, "openai", FAKE + " bad"),
        client.delete("/api/settings/keys/openai", headers=LOCAL),
    ]
    assert all(FAKE not in r.text for r in bodies)
    assert {k["provider"] for k in client.get("/api/settings/keys", headers=LOCAL).json()} == set(keys.PROVIDERS)
    put(client, "openai", FAKE)
    got = client.get("/api/settings/keys", headers=LOCAL).json()[0]
    assert got == {"provider": "openai", "var": "OPENAI_API_KEY", "set": True, "masked": "sk-…a1b2", "source": "file"}


def test_ac_4_2_mask_short_values():
    assert keys.mask("abcdefgh") == "…gh"
    assert keys.mask("abcdefghi") == "abc…fghi"


def test_ac_4_3_host_and_origin_and_provider_checks(client, keyfile):
    assert client.get("/api/settings/keys", headers={"host": "evil.example"}).status_code == 403
    assert client.get("/api/settings/keys", headers={"host": "127.0.0.1.evil.example"}).status_code == 403
    assert client.get("/api/settings/keys").status_code == 403  # TestClient's default host is "testserver"
    for host in ("localhost:8000", "127.0.0.1:8765", "[::1]:8000", "[::1]", "LocalHost"):
        assert client.get("/api/settings/keys", headers={"host": host}).status_code == 200
    for host in ("[::1]evil", "[::1].evil.com", "localhost.evil.com", "localhost:80x", "user@localhost", "localhost:123456"):
        assert client.get("/api/settings/keys", headers={"host": host}).status_code == 403, host
    for origin in ("http://localhost.evil.com", "http://user@localhost", "ftp://localhost", "http://[::1]evil", "localhost"):
        assert client.get("/api/settings/keys", headers={**LOCAL, "origin": origin}).status_code == 403, origin
    evil = {"host": "127.0.0.1", "origin": "https://evil.example"}
    assert client.put("/api/settings/keys/openai", json={"value": FAKE}, headers=evil).status_code == 403
    assert client.put("/api/settings/keys/openai", json={"value": FAKE}, headers={**LOCAL, "origin": "null"}).status_code == 403
    assert client.get("/api/settings/keys", headers={**LOCAL, "origin": "http://localhost:3000"}).status_code == 200
    assert keyfile.read_bytes() == ORIGINAL
    assert put(client, "not-a-provider", FAKE).status_code == 404
    assert client.delete("/api/settings/keys/PATH", headers=LOCAL).status_code == 404
    assert client.post("/api/settings/keys/nope/test", headers=LOCAL).status_code == 404
    assert client.get("/settings/keys", headers=LOCAL).status_code != 200  # no root alias


def test_ac_4_4_put_is_live_without_restart(client, keyfile):
    def paid():
        return {t["name"]: t for t in client.get("/api/targets/status").json()}["paid"]

    assert paid()["keys_ok"] is False
    put(client, "openai", FAKE)
    assert paid()["keys_ok"] is True
    client.delete("/api/settings/keys/openai", headers=LOCAL)
    assert paid()["keys_ok"] is False


def test_ac_4_2_environment_source_is_reported(client, keyfile, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", FAKE)
    row = [k for k in client.get("/api/settings/keys", headers=LOCAL).json() if k["provider"] == "groq"][0]
    assert row["source"] == "environment" and row["masked"] == "sk-…a1b2"


def test_test_endpoint_sanitises_and_survives_network_errors(client, keyfile, monkeypatch):
    import httpx

    assert client.post("/api/settings/keys/openai/test", headers=LOCAL).json() == {"ok": False, "message": "No key is set."}
    put(client, "openai", FAKE)

    def boom(*a, **k):
        raise httpx.ConnectError(f"cannot connect with {FAKE}")

    monkeypatch.setattr(httpx, "get", boom)
    res = client.post("/api/settings/keys/openai/test", headers=LOCAL)
    assert res.status_code == 200 and res.json()["ok"] is False and FAKE not in res.text

    class R:
        status_code = 401

    monkeypatch.setattr(httpx, "get", lambda *a, **k: R())
    assert "401" in client.post("/api/settings/keys/openai/test", headers=LOCAL).json()["message"]
    R.status_code = 200
    assert client.post("/api/settings/keys/openai/test", headers=LOCAL).json()["ok"] is True


def test_keys_file_resolver_is_cwd_independent(monkeypatch, tmp_path):
    """The default is what the old bare load_dotenv() found (walking up from the package), not the cwd's file."""
    from dotenv import find_dotenv
    from pathlib import Path

    monkeypatch.delenv("MODELCOMPARE_KEYS_FILE", raising=False)
    before = keys.keys_file()
    monkeypatch.chdir(tmp_path)
    (tmp_path / ("." + "env")).write_text("X=1\n")
    assert keys.keys_file() == before
    found = find_dotenv()  # called from this tests dir; the package dir sits next to it under engine/
    assert before == (Path(found) if found else Path(keys.__file__).resolve().parents[1] / ("." + "env"))
    monkeypatch.setenv("MODELCOMPARE_KEYS_FILE", str(tmp_path / "k"))
    assert keys.keys_file() == tmp_path / "k"


def test_ac_4_2_status_reflects_the_effective_value(client, keyfile, monkeypatch):
    def groq():
        return [k for k in client.get("/api/settings/keys", headers=LOCAL).json() if k["provider"] == "groq"][0]

    put(client, "groq", FAKE)
    assert groq()["source"] == "file"
    monkeypatch.setenv("GROQ_API_KEY", "sk-test-shell-exported-ffff")  # a shell export wins at runtime
    assert groq() == {"provider": "groq", "var": "GROQ_API_KEY", "set": True, "masked": "sk-…ffff", "source": "environment"}


def test_ac_4_1_remove_leaves_a_shell_exported_key_and_refuses_env_only(client, keyfile, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", FAKE)
    res = client.delete("/api/settings/keys/groq", headers=LOCAL)
    assert res.status_code == 409 and FAKE not in res.text
    before = keyfile.stat()
    assert keyfile.read_bytes() == ORIGINAL and before.st_ino == keyfile.stat().st_ino
    assert client.delete("/api/settings/keys/anthropic", headers=LOCAL).status_code == 200  # nothing there: no-op
    assert keyfile.stat().st_ino == before.st_ino and keyfile.read_bytes() == ORIGINAL
    put(client, "openai", FAKE)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-other")  # differs from the file: the shell value stays
    client.delete("/api/settings/keys/openai", headers=LOCAL)
    assert os.environ["OPENAI_API_KEY"] == "sk-test-other"


@pytest.mark.parametrize("before,after_put,after_delete", [
    (b"A=1\nOPENAI_API_KEY=a\nB=2\nOPENAI_API_KEY=b\nC=3\n", b"A=1\nOPENAI_API_KEY=NEW\nB=2\nC=3\n", b"A=1\nB=2\nC=3\n"),
    (b"A=1\nexport OPENAI_API_KEY=a\n", b"A=1\nOPENAI_API_KEY=NEW\n", b"A=1\n"),
    (b"A=1\n   OPENAI_API_KEY = a\nB=2\n", b"A=1\nOPENAI_API_KEY=NEW\nB=2\n", b"A=1\nB=2\n"),
    (b'A=1\nOPENAI_API_KEY="quoted value"\nB=2\n', b"A=1\nOPENAI_API_KEY=NEW\nB=2\n", b"A=1\nB=2\n"),
    (b"# c\r\nA=1\r\nOPENAI_API_KEY=a\r\nB=2\r\n", b"# c\r\nA=1\r\nOPENAI_API_KEY=NEW\r\nB=2\r\n", b"# c\r\nA=1\r\nB=2\r\n"),
    (b"A=1\r\nB=2", b"A=1\r\nB=2\r\nOPENAI_API_KEY=NEW\r\n", b"A=1\r\nB=2\r\n"),
], ids=["duplicates", "export", "indented", "quoted", "crlf", "crlf-append"])
def test_ac_4_1_line_variants_byte_exact(client, keyfile, before, after_put, after_delete):
    keyfile.write_bytes(before)
    assert put(client, "openai", "NEW").status_code == 200
    assert keyfile.read_bytes() == after_put
    assert client.delete("/api/settings/keys/openai", headers=LOCAL).status_code == 200
    assert keyfile.read_bytes() == after_delete


def test_ac_4_1_symlinked_file_keeps_its_link(client, keyfile, tmp_path, monkeypatch):
    link = tmp_path / "link.env"
    link.symlink_to(keyfile)
    monkeypatch.setenv("MODELCOMPARE_KEYS_FILE", str(link))
    put(client, "groq", FAKE)
    assert link.is_symlink() and f"GROQ_API_KEY={FAKE}" in keyfile.read_text()


def test_ac_4_3_put_requires_json_content_type(client, keyfile):
    res = client.put("/api/settings/keys/openai", content=b'{"value": "abc"}', headers={**LOCAL, "content-type": "text/plain"})
    assert res.status_code == 415 and keyfile.read_bytes() == ORIGINAL

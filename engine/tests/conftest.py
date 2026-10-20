import os

# Before anything imports litellm: it would otherwise load a real env file from the working directory.
os.environ.setdefault("LITELLM_MODE", "PRODUCTION")

import httpx  # noqa: E402
import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Real HTTP transports raise; TestClient uses its own transport and is unaffected. Patch httpx.get where a probe is tested."""
    def refuse(self, request, *a, **k):
        raise httpx.ConnectError("network is blocked in tests", request=request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", refuse)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", refuse)


@pytest.fixture
def db_url(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'test.db'}"
    monkeypatch.setenv("MODELCOMPARE_DB_URL", url)
    return url

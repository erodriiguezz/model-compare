"""Provider API keys in the engine env file: read, mask, replace and remove one line at a time.

Only the allowlisted variables below are ever written. Values are never logged, returned in full,
or included in exceptions.
"""

from __future__ import annotations

import os
import re
import tempfile
import threading
from pathlib import Path

import httpx
from dotenv import dotenv_values, find_dotenv

PROVIDERS = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "togetherai": "TOGETHERAI_API_KEY",
    "groq": "GROQ_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}
MAX_LEN = 512
# Characters that python-dotenv would treat specially (quotes, comments, escapes, interpolation) are rejected,
# so a value is always written bare and reads back unchanged.
_BAD = re.compile(r"[^\x21-\x7e]|[\"'\\#$]")
_lock = threading.Lock()


class InvalidKey(ValueError):
    """The submitted value cannot be stored. The message never contains the value."""


def keys_file() -> Path:
    """MODELCOMPARE_KEYS_FILE, else the file the old bare load_dotenv() in cli.py found.

    find_dotenv() without usecwd starts from the directory of the calling module and walks up, so calling it
    here (same package directory as cli.py) gives the same file regardless of the cwd. With no file anywhere,
    fall back to the engine directory, where that walk would have found one.
    """
    override = os.getenv("MODELCOMPARE_KEYS_FILE")
    if override:
        return Path(override)
    found = find_dotenv()
    return Path(found) if found else Path(__file__).resolve().parents[1] / ".env"


def validate(value: object) -> str:
    if not isinstance(value, str):
        raise InvalidKey("Key must be a string.")
    v = value.strip()
    if not v:
        raise InvalidKey("Key must not be empty.")
    if len(v) > MAX_LEN:
        raise InvalidKey(f"Key must be at most {MAX_LEN} characters.")
    if _BAD.search(v):
        raise InvalidKey("Key may only contain printable ASCII without spaces, quotes, #, $ or backslashes.")
    return v


def mask(value: str) -> str:
    return "…" + value[-2:] if len(value) <= 8 else value[:3] + "…" + value[-4:]


class EnvironmentOnly(Exception):
    """The key is set in the process environment, not in the keys file, so this page cannot remove it."""


def _is_line_for(line: bytes, var: str) -> bool:
    return re.match(rb"\s*(?:export\s+)?" + re.escape(var.encode()) + rb"\s*=", line) is not None


def _read_lines(path: Path) -> list[bytes]:
    return path.read_bytes().splitlines(keepends=True) if path.exists() else []


def _ending(line: bytes) -> bytes:
    return b"\r\n" if line.endswith(b"\r\n") else b"\n" if line.endswith(b"\n") else b""


def _write(path: Path, lines: list[bytes]) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(b"".join(lines))
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _rewrite(path: Path, var: str, value: str | None) -> None:
    """Replace the first `var` line (dropping duplicates), append it, or with value None remove every such line.

    The written line uses the file's own line ending; every other byte is kept.
    """
    lines = _read_lines(path)
    eol = next((_ending(line) for line in lines if _ending(line)), b"\n")
    out: list[bytes] = []
    done = False
    for line in lines:
        if not _is_line_for(line, var):
            out.append(line)
        elif value is not None and not done:
            out.append(f"{var}={value}".encode() + (_ending(line) or b""))
            done = True
    if value is not None and not done:
        if out and not _ending(out[-1]):
            out[-1] += eol
        out.append(f"{var}={value}".encode() + eol)
    _write(path, out)


def set_key(provider: str, value: object) -> None:
    v = validate(value)
    var = PROVIDERS[provider]
    with _lock:
        path = keys_file().resolve()  # a symlinked env file keeps its link: the target is rewritten
        path.parent.mkdir(parents=True, exist_ok=True)
        _rewrite(path, var, v)
        os.environ[var] = v


def _file_value(path: Path, var: str) -> str | None:
    return dotenv_values(path, interpolate=False).get(var) if path.exists() else None


def remove_key(provider: str) -> None:
    """Remove the key from the file. The process env is cleared only if it held the file's value."""
    var = PROVIDERS[provider]
    with _lock:
        path = keys_file().resolve()
        if not any(_is_line_for(line, var) for line in _read_lines(path)):
            if os.environ.get(var):
                raise EnvironmentOnly
            return
        file_value = _file_value(path, var)
        _rewrite(path, var, None)
        if os.environ.get(var) == file_value:
            os.environ.pop(var, None)


def status(provider: str) -> dict:
    """What the server will actually use: the process env wins (load_dotenv never overrides it)."""
    var = PROVIDERS[provider]
    in_file = _file_value(keys_file().resolve(), var)
    effective = os.environ.get(var) or in_file
    if not effective:
        return {"provider": provider, "var": var, "set": False, "masked": None, "source": None}
    source = "file" if in_file is not None and effective == in_file else "environment"
    return {"provider": provider, "var": var, "set": True, "masked": mask(effective), "source": source}


def all_status() -> list[dict]:
    return [status(p) for p in PROVIDERS]


# provider -> (url, header name, header value prefix): a cheap authenticated read.
_PROBES = {
    "openai": ("https://api.openai.com/v1/models", "Authorization", "Bearer "),
    "anthropic": ("https://api.anthropic.com/v1/models", "x-api-key", ""),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/models", "x-goog-api-key", ""),
    "togetherai": ("https://api.together.xyz/v1/models", "Authorization", "Bearer "),
    "groq": ("https://api.groq.com/openai/v1/models", "Authorization", "Bearer "),
    "openrouter": ("https://openrouter.ai/api/v1/key", "Authorization", "Bearer "),
}


def probe(provider: str) -> dict:
    """Call the provider with the stored key. Returns {ok, message}; the message never contains the key."""
    key = os.environ.get(PROVIDERS[provider])
    if not key:
        return {"ok": False, "message": "No key is set."}
    url, header, prefix = _PROBES[provider]
    headers = {header: prefix + key}
    if provider == "anthropic":
        headers["anthropic-version"] = "2023-06-01"
    try:
        code = httpx.get(url, headers=headers, timeout=10.0).status_code
    except httpx.HTTPError as e:
        return {"ok": False, "message": f"Could not reach the provider ({type(e).__name__})."}
    if code < 300:
        return {"ok": True, "message": "Key accepted."}
    if code in (401, 403):
        return {"ok": False, "message": f"Key rejected by the provider ({code})."}
    return {"ok": False, "message": f"The provider returned HTTP {code}."}

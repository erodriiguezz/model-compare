"""Run generated Python against unit tests in a subprocess.

This is isolation from the evaluator process, not a security sandbox. Only benchmark code you
trust, and run untrusted suites inside a container.
"""

from __future__ import annotations

import asyncio
import re
import sys
import tempfile
from pathlib import Path

from modelcompare.schema import ScoreDetail
from modelcompare.scorers import scorer


def extract_code(text: str) -> str:
    blocks = re.findall(r"```(?:python|py)?\s*\n(.*?)```", text, re.S)
    return max(blocks, key=len) if blocks else text


async def _run_python(files: dict[str, str], main: str, timeout: float) -> tuple[bool, str]:
    """Write `files` to a temp dir and run `main` with an isolated interpreter.

    Returns (succeeded, reason): success means exit code 0 and the __ALL_PASSED__ sentinel on stdout.
    """
    with tempfile.TemporaryDirectory() as tmp:
        for name, body in files.items():
            (Path(tmp) / name).write_text(body)
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-I", str(Path(tmp) / main),
            cwd=tmp, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return False, f"timeout after {timeout}s"
    if proc.returncode == 0 and b"__ALL_PASSED__" in out:
        return True, "tests passed"
    return False, (err.decode(errors="replace").strip().splitlines() or ["failed"])[-1][:300]


@scorer("code_exec")
async def code_exec(c, case, params, ctx):
    tests = params.get("tests") or case.vars.get("tests")
    if not tests:
        raise ValueError(f"case {case.id}: code_exec needs vars.tests")
    timeout = float(params.get("timeout_s", 10))
    program = f"{extract_code(c.text)}\n\n# ---- tests ----\n{tests}\nprint('__ALL_PASSED__')\n"
    ok, reason = await _run_python({"solution.py": program}, "solution.py", timeout)
    return ScoreDetail(type="code_exec", score=float(ok), reason=reason)


# Minimal stand-in so model-written tests may use pytest.raises / pytest.approx without pytest installed.
PYTEST_SHIM = """
import math, re
class _Raises:
    def __init__(self, exc, match=None):
        self.exc, self.match = exc, match
    def __enter__(self):
        return self
    def __exit__(self, et, ev, tb):
        if et is None:
            raise AssertionError(f"DID NOT RAISE {self.exc}")
        if not issubclass(et, self.exc):
            return False
        if self.match and not re.search(self.match, str(ev)):
            raise AssertionError(f"{ev!r} does not match {self.match!r}")
        return True
def raises(exc, match=None):
    return _Raises(exc, match)
class _Approx:
    def __init__(self, v, rel=1e-6, abs=1e-12):
        self.v, self.rel, self.abs = v, rel, abs
    def __eq__(self, other):
        return math.isclose(other, self.v, rel_tol=self.rel, abs_tol=self.abs)
def approx(v, rel=1e-6, abs=1e-12):
    return _Approx(v, rel, abs)
def fixture(*a, **k):
    return a[0] if a and callable(a[0]) else (lambda f: f)
"""

# Runs top-level asserts on import, then every test_* function; any failure exits non-zero.
TEST_HARNESS = """
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I drops the script dir from sys.path
import tests_under_eval as t
failed = []
for name in sorted(dir(t)):
    fn = getattr(t, name)
    if name.startswith("test") and callable(fn) and getattr(fn, "__module__", "") == "tests_under_eval":
        try:
            fn()
        except Exception as e:
            failed.append(f"{name}: {type(e).__name__}: {e}"[:200])
if failed:
    print("; ".join(failed), file=sys.stderr)
    sys.exit(1)
print("__ALL_PASSED__")
"""


def apply_mutant(reference: str, mutant: dict) -> str:
    if reference.count(mutant["find"]) != 1:
        raise ValueError(f"mutant {mutant.get('name')}: 'find' must occur exactly once in the reference")
    return reference.replace(mutant["find"], mutant["replace"])


@scorer("test_quality")
async def test_quality(c, case, params, ctx):
    """Model writes tests. They must pass on the reference implementation; score = share of planted bugs caught."""
    module = case.vars.get("module", "solution")
    reference = case.vars["reference_impl"]
    mutants = case.vars["mutants"]
    timeout = float(params.get("timeout_s", 10))
    tests = extract_code(c.text)

    def files(impl: str) -> dict[str, str]:
        return {f"{module}.py": impl, "tests_under_eval.py": f"from {module} import *\n{tests}\n",
                "pytest.py": PYTEST_SHIM, "harness.py": TEST_HARNESS}

    ok, reason = await _run_python(files(reference), "harness.py", timeout)
    if not ok:
        return ScoreDetail(type="test_quality", score=0.0, reason=f"tests fail on the correct implementation: {reason}")
    results = await asyncio.gather(*(_run_python(files(apply_mutant(reference, m)), "harness.py", timeout) for m in mutants))
    missed = [m["name"] for m, (passed, _) in zip(mutants, results) if passed]
    killed = len(mutants) - len(missed)
    return ScoreDetail(type="test_quality", score=killed / len(mutants),
                       reason=f"caught {killed}/{len(mutants)} planted bugs" + (f"; missed: {', '.join(missed)}" if missed else ""))

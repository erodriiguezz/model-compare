from __future__ import annotations

import os
from pathlib import Path

from modelcompare.schema import Benchmark

BENCH_ROOT = Path(__file__).resolve().parent.parent / "benchmarks"


def custom_dir() -> Path:
    """Where saved projects live; MODELCOMPARE_CUSTOM_DIR points QA and tests elsewhere."""
    return Path(os.getenv("MODELCOMPARE_CUSTOM_DIR") or BENCH_ROOT / "custom")


_CACHE: dict[Path, tuple[int, Benchmark]] = {}


def load(path: Path) -> Benchmark:
    """Benchmark.load, memoised on modification time (the dashboard resolves the deck on every request)."""
    path = path.resolve()
    mtime = path.stat().st_mtime_ns
    hit = _CACHE.get(path)
    if hit and hit[0] == mtime:
        return hit[1]
    b = Benchmark.load(path)
    _CACHE[path] = (mtime, b)
    return b


def _yaml_files(d: Path) -> list[Path]:
    if not d.is_dir():
        return []
    return sorted(p for p in d.rglob("*.y*ml") if p.name != "profiles.yaml")


def resolve_benchmarks(specs: list[str]) -> list[Benchmark]:
    """Each spec is: 'standard', 'custom', a dimension name inside standard/, a directory, a YAML file,
    or the name of a benchmark in standard/ or custom/."""
    paths: list[Path] = []
    names: list[str] = []
    for spec in specs:
        p = Path(spec)
        if spec in ("standard", "custom"):
            paths += _yaml_files(custom_dir() if spec == "custom" else BENCH_ROOT / spec)
        elif (BENCH_ROOT / "standard" / spec).is_dir():
            paths += _yaml_files(BENCH_ROOT / "standard" / spec)
        elif p.is_dir():
            paths += _yaml_files(p)
        elif p.is_file():
            paths.append(p)
        else:
            names.append(spec)
    if names:
        by_name = {load(p).name: p for p in _yaml_files(BENCH_ROOT / "standard") + _yaml_files(custom_dir())}
        if missing := [n for n in names if n not in by_name]:
            raise FileNotFoundError(f"benchmark spec not found: {', '.join(missing)}")
        paths += [by_name[n] for n in names]
    seen, out = set(), []
    for p in paths:
        b = load(p)
        if b.name in seen:
            raise ValueError(f"duplicate benchmark name '{b.name}' ({p})")
        seen.add(b.name)
        out.append(b)
    return out

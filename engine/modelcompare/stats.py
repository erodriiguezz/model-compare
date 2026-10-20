"""Statistics for paired model comparisons. Pure Python so results are reproducible and dependency-free."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from statistics import mean
from typing import Literal

MIN_CASES_FOR_VERDICT = 10
EQUIV_MARGIN = 0.03  # a tie is "equivalent" when the 90% CI of the paired delta sits inside +/- this
Verdict = Literal["better", "worse", "equivalent", "inconclusive", "insufficient_data", "incomplete"]


@dataclass
class PairedResult:
    n: int
    mean_a: float
    mean_b: float
    delta: float  # b - a
    ci_low: float
    ci_high: float
    p_value: float
    verdict: Verdict  # from B's perspective relative to A
    ci90_low: float = math.nan  # TOST-style equivalence interval
    ci90_high: float = math.nan


def percentile(xs: list[float], q: float) -> float:
    if not xs:
        return float("nan")
    s = sorted(xs)
    k = (len(s) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def paired_bootstrap(a: list[float], b: list[float], iters: int = 5000, seed: int = 0, alpha: float = 0.05) -> PairedResult:
    """Bootstrap CI of mean(b - a) over paired cases. Two-sided p from the bootstrap distribution."""
    if len(a) != len(b):
        raise ValueError("paired samples must be the same length")
    n = len(a)
    if n == 0:
        return PairedResult(0, math.nan, math.nan, math.nan, math.nan, math.nan, 1.0, "insufficient_data")
    diffs = [y - x for x, y in zip(a, b)]
    d = mean(diffs)
    if all(x == diffs[0] for x in diffs):
        lo = hi = lo90 = hi90 = d
        p = 1.0 if d == 0 else 0.0
    else:
        rng = random.Random(seed)
        boots = sorted(mean(rng.choices(diffs, k=n)) for _ in range(iters))
        lo, hi = percentile(boots, alpha / 2), percentile(boots, 1 - alpha / 2)
        lo90, hi90 = percentile(boots, 0.05), percentile(boots, 0.95)
        # Shift-to-null: fraction of centred bootstrap means at least as extreme as observed.
        extreme = sum(1 for m in boots if abs(m - d) >= abs(d))
        p = max(extreme / iters, 1 / iters)
    return PairedResult(n, mean(a), mean(b), d, lo, hi, p, _verdict(n, lo, hi, lo90, hi90), lo90, hi90)


def _verdict(n: int, lo: float, hi: float, lo90: float | None = None, hi90: float | None = None) -> Verdict:
    if n < MIN_CASES_FOR_VERDICT:
        return "insufficient_data"
    if lo > 0:
        return "better"
    if hi < 0:
        return "worse"
    if lo90 is not None and hi90 is not None and lo90 >= -EQUIV_MARGIN and hi90 <= EQUIV_MARGIN:
        return "equivalent"
    return "inconclusive"


def mcnemar_exact(b_only: int, a_only: int) -> float:
    """Exact two-sided McNemar p-value from discordant pair counts (binomial test, p=0.5)."""
    n = b_only + a_only
    if n == 0:
        return 1.0
    k = min(b_only, a_only)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / 2**n
    return min(1.0, 2 * tail)


def wilson_ci(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = successes / n
    denom = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def min_detectable_diff(diffs: list[float], z_alpha: float = 1.96, z_power: float = 0.84) -> float:
    """Smallest mean paired difference this sample could reliably detect (two-sided 5%, 80% power).

    Uses the observed spread of per-case differences, floored at the spread one disagreeing case
    in n would give, so a run where both models agree everywhere doesn't claim infinite precision.
    """
    n = len(diffs)
    if n < 2:
        return math.nan
    m = mean(diffs)
    sd = math.sqrt(sum((d - m) ** 2 for d in diffs) / (n - 1))
    sd = max(sd, math.sqrt(1 / n))
    return (z_alpha + z_power) * sd / math.sqrt(n)

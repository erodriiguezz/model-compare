import pytest

from modelcompare.stats import EQUIV_MARGIN, mcnemar_exact, paired_bootstrap, percentile, wilson_ci


def test_mcnemar_exact_known_values():
    assert mcnemar_exact(0, 0) == 1.0
    assert mcnemar_exact(5, 0) == pytest.approx(2 / 32)
    assert mcnemar_exact(3, 3) == 1.0


def test_bootstrap_clear_improvement_is_better():
    a = [0.0] * 20
    b = [1.0] * 15 + [0.0] * 5
    r = paired_bootstrap(a, b)
    assert r.delta == pytest.approx(0.75)
    assert r.ci_low > 0 and r.verdict == "better"
    assert r.p_value < 0.01


def test_bootstrap_regression_is_worse():
    r = paired_bootstrap([1.0] * 12, [0.0] * 6 + [1.0] * 6)
    assert r.verdict == "worse"


def test_bootstrap_identical_is_equivalent():
    xs = [0.2, 0.5, 1.0] * 5
    r = paired_bootstrap(xs, xs)
    assert r.delta == 0 and r.verdict == "equivalent" and r.p_value == 1.0


def test_equivalence_tight_ci():
    """AC-1.3: 90% CI of the paired delta inside +/-EQUIV_MARGIN gives equivalent."""
    a = [0.5] * 60
    b = [0.5] * 59 + [0.51]
    r = paired_bootstrap(a, b)
    assert -EQUIV_MARGIN <= r.ci90_low and r.ci90_high <= EQUIV_MARGIN
    assert r.verdict == "equivalent"


def test_equivalent_when_only_the_90_percent_ci_fits():
    """AC-1.3: TOST uses the 90% CI, so a 95% CI that pokes outside the margin can still be equivalent."""
    a = [0.5] * 100
    b = [0.67] * 50 + [0.33] * 50  # mean delta 0, se about 0.017
    r = paired_bootstrap(a, b)
    assert -EQUIV_MARGIN <= r.ci90_low and r.ci90_high <= EQUIV_MARGIN
    assert r.ci_low < -EQUIV_MARGIN or r.ci_high > EQUIV_MARGIN
    assert r.verdict == "equivalent"


def test_small_real_difference_is_not_equivalent():
    """AC-1.3: a 0.04 delta is outside the margin, so never equivalent."""
    assert paired_bootstrap([0.5] * 60, [0.54] * 60).verdict != "equivalent"
    noisy = paired_bootstrap([0.5] * 40, [0.9, 0.5, 0.31, 0.5] * 10)  # delta about 0.04, wide CI
    assert abs(noisy.delta - 0.05) < 0.02 and noisy.verdict != "equivalent"


def test_wide_ci_inconclusive():
    """AC-1.3: a wide CI that straddles 0 stays inconclusive, not equivalent."""
    a = [0.0, 1.0] * 6
    b = [1.0, 0.0, 0.0, 1.0] * 3
    r = paired_bootstrap(a, b)
    assert r.ci90_high - r.ci90_low > 2 * EQUIV_MARGIN
    assert r.verdict == "inconclusive"


def test_bootstrap_small_sample_refuses_verdict():
    assert paired_bootstrap([0.0] * 5, [1.0] * 5).verdict == "insufficient_data"


def test_bootstrap_is_deterministic():
    a, b = [0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0], [1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1]
    assert paired_bootstrap(a, b) == paired_bootstrap(a, b)


def test_percentile_and_wilson():
    assert percentile([1, 2, 3, 4], 0.5) == 2.5
    lo, hi = wilson_ci(8, 10)
    assert 0.44 < lo < 0.5 and 0.94 < hi < 0.97

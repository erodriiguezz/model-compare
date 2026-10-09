import pytest

from modelcompare.stats import mcnemar_exact, paired_bootstrap, percentile, wilson_ci


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


def test_bootstrap_identical_is_inconclusive():
    xs = [0.2, 0.5, 1.0] * 5
    r = paired_bootstrap(xs, xs)
    assert r.delta == 0 and r.verdict == "inconclusive" and r.p_value == 1.0


def test_bootstrap_small_sample_refuses_verdict():
    assert paired_bootstrap([0.0] * 5, [1.0] * 5).verdict == "insufficient_data"


def test_bootstrap_is_deterministic():
    a, b = [0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0], [1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1]
    assert paired_bootstrap(a, b) == paired_bootstrap(a, b)


def test_percentile_and_wilson():
    assert percentile([1, 2, 3, 4], 0.5) == 2.5
    lo, hi = wilson_ci(8, 10)
    assert 0.44 < lo < 0.5 and 0.94 < hi < 0.97

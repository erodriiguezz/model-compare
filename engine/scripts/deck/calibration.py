"""Calibration: answer plus a confidence; a good model is confident when right and unsure when it might be wrong."""

from __future__ import annotations

import json
from datetime import date, timedelta

from .common import benchmark, rng_for


def _primes_below(n: int) -> list[int]:
    sieve = bytearray([1]) * n
    sieve[0:2] = b"\x00\x00"
    for i in range(2, int(n**0.5) + 1):
        if sieve[i]:
            sieve[i * i :: i] = bytearray(len(sieve[i * i :: i]))
    return [i for i in range(n) if sieve[i]]


PRIMES = _primes_below(60000)


def _fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a


def _distinct_prime_factors(n: int) -> int:
    count, p = 0, 2
    while p * p <= n:
        if n % p == 0:
            count += 1
            while n % p == 0:
                n //= p
        p += 1
    return count + (n > 1)


def question(rng, level: str) -> tuple[str, object]:
    kind = rng.randrange(3)
    if level == "easy":
        if kind == 0:
            a, b = rng.randint(12, 99), rng.randint(12, 99)
            return f"What is {a} × {b}?", a * b
        if kind == 1:
            pct, base = rng.choice([10, 20, 25, 50]), rng.randrange(40, 400, 4)
            return f"What is {pct}% of {base}?", base * pct // 100
        d = date(2026, 1, 1) + timedelta(days=rng.randrange(365))
        return f"How many days are there in {d:%B %Y}?", ((date(d.year + (d.month == 12), d.month % 12 + 1, 1) - date(d.year, d.month, 1)).days)
    if level == "medium":
        if kind == 0:
            a, b = rng.randint(101, 999), rng.randint(101, 999)
            return f"What is {a} × {b}?", a * b
        if kind == 1:
            d = date(2030, 1, 1) + timedelta(days=rng.randrange(3650))
            return f"On which day of the week does {d:%d %B %Y} fall?", f"{d:%A}"
        n = rng.randint(20, 30)
        return f"What is the {n}th Fibonacci number, with F(1) = 1 and F(2) = 1?", _fib(n)
    if level == "hard":
        if kind == 0:
            a, b = rng.randint(10001, 99999), rng.randint(1001, 9999)
            return f"What is {a} × {b}?", a * b
        if kind == 1:
            n = rng.randrange(2000, 9000)
            return f"How many prime numbers are less than {n}?", sum(1 for p in PRIMES if p < n)
        k = rng.randint(40, 80)
        return f"What is the sum of the decimal digits of 3^{k}?", sum(int(c) for c in str(3**k))
    # very hard
    if kind == 0:
        n = rng.randint(1500, 5000)
        return f"What is the {n}th prime number (2 is the 1st)?", PRIMES[n - 1]
    if kind == 1:
        n = rng.randint(10**11, 10**12)
        return f"How many distinct prime factors does {n} have?", _distinct_prime_factors(n)
    k, m = rng.randint(200, 900), rng.randint(1000, 9999)
    return f"What is 7^{k} mod {m}?", pow(7, k, m)


def build() -> dict[str, dict]:
    rng = rng_for("calibration")
    levels = ["easy"] * 15 + ["medium"] * 15 + ["hard"] * 20 + ["very_hard"] * 10
    cases = []
    for i, level in enumerate(levels):
        q, a = question(rng, level)
        cases.append({"id": f"cal-{level}-{i:02d}", "input": q, "expected": a, "tags": [level],
                      "vars": {"reference": json.dumps({"answer": a, "confidence": 1.0})}})
    return {"calibration/generated.yaml": benchmark(
        "std-confidence", "calibration",
        "Questions from easy to very hard, answered without tools, with a stated confidence. Brier-scored: confident and right "
        "scores 1, confident and wrong scores 0, honest uncertainty scores in between.",
        cases,
        system_prompt=("Answer without using tools or code. Then estimate the probability (0 to 1) that your answer is exactly right. "
                       'Respond with only JSON: {"answer": <answer>, "confidence": <probability>}.'),
        scorers=[{"type": "calibration"}],
        pass_threshold=0.75,
    )}

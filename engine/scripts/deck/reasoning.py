"""Reasoning: multi-step shopping maths, calendar arithmetic and seating puzzles, all solved in code."""

from __future__ import annotations

import itertools
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from .common import ANSWER_LINE, benchmark, rng_for

ITEMS = [
    ("desk lamp", "34.99"), ("office chair", "189.00"), ("notebook", "4.25"), ("monitor arm", "62.50"),
    ("USB-C cable", "12.99"), ("keyboard", "79.95"), ("mouse pad", "9.40"), ("webcam", "54.00"),
    ("headset", "118.75"), ("desk mat", "27.30"), ("stapler", "15.60"), ("whiteboard", "88.20"),
    ("marker set", "11.85"), ("laptop stand", "44.90"), ("power strip", "23.15"),
]
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
NAMES = ["Ava", "Ben", "Chloe", "Dev", "Elena", "Farid", "Grace", "Hugo", "Ines", "Jonah"]

CENT = Decimal("0.01")


def money(x: Decimal) -> Decimal:
    return x.quantize(CENT, rounding=ROUND_HALF_UP)


def shopping(rng, i: int) -> dict:
    picks = rng.sample(ITEMS, rng.randint(3, 5))
    bogo_name = picks[rng.randrange(len(picks))][0]
    lines = [(n, Decimal(p), rng.randint(4, 9) if n == bogo_name else rng.randint(1, 6)) for n, p in picks]
    line_pct = rng.choice([10, 15, 20])
    line_over = Decimal(rng.choice([50, 75, 100]))
    coupon, coupon_over = Decimal(rng.choice([10, 15, 25])), Decimal(rng.choice([150, 200, 250]))
    tax = Decimal(rng.choice(["6.5", "7.25", "8.25", "9.5"]))
    ship, free_over = Decimal("7.99"), Decimal(rng.choice([75, 100]))

    subtotal = Decimal(0)
    for name, price, qty in lines:
        paid_units = qty - qty // 4 if name == bogo_name else qty
        line = price * paid_units
        if line > line_over:
            line -= line * line_pct / 100
        subtotal += line
    if subtotal > coupon_over:
        subtotal -= coupon
    shipping = Decimal(0) if subtotal >= free_over else ship
    total = money(subtotal * (1 + tax / 100) + shipping)

    order = "\n".join(f"- {qty} × {name} at ${price} each" for name, price, qty in lines)
    prompt = (
        f"An office-supply order contains:\n{order}\n\nPricing rules, applied in this order:\n"
        f"1. {bogo_name}: for every 4 units bought, 1 unit is free.\n"
        f"2. Any single item line whose cost (after rule 1) is over ${line_over} gets {line_pct}% off that line.\n"
        f"3. If the order subtotal after rules 1–2 is over ${coupon_over}, a ${coupon} coupon is subtracted.\n"
        f"4. Sales tax of {tax}% applies to the subtotal after rule 3.\n"
        f"5. Shipping is ${ship}, untaxed, unless the subtotal after rule 3 is at least ${free_over}, in which case it is free.\n\n"
        "What is the final amount charged, in dollars? Do not round until the final answer, then round to the nearest cent."
    )
    return {"id": f"shop-{i:02d}", "input": prompt, "expected": float(total), "tags": ["shopping", "multi-step"],
            "vars": {"reference": f"ANSWER: {total}"}}


def calendar(rng, i: int) -> dict:
    kind = i % 3
    start = date(2026, 1, 1) + timedelta(days=rng.randrange(0, 700))
    if kind == 0:
        n = rng.randint(90, 900)
        answer = WEEKDAYS[(start + timedelta(days=n)).weekday()]
        prompt = (f"A warranty period starts on {start:%A, %d %B %Y} and the claim deadline is exactly {n} days later. "
                  "On which day of the week does the deadline fall?")
        return {"id": f"cal-{i:02d}", "input": prompt, "expected": answer, "tags": ["calendar"],
                "scorers": [{"type": "exact"}], "vars": {"reference": f"ANSWER: {answer}"}}
    if kind == 1:
        end = start + timedelta(days=rng.randint(20, 75))
        span = [start + timedelta(days=k) for k in range((end - start).days + 1)]
        weekdays = [d for d in span if d.weekday() < 5]
        holidays = sorted(rng.sample(weekdays, 3) + [rng.choice([d for d in span if d.weekday() >= 5])])
        answer = sum(1 for d in weekdays if d not in holidays)
        hol = ", ".join(f"{d:%d %B %Y} ({d:%A})" for d in holidays)
        prompt = (f"How many working days are there from {start:%d %B %Y} to {end:%d %B %Y}, counting both of those dates? "
                  f"Working days are Monday to Friday, excluding these company holidays: {hol}.")
        return {"id": f"cal-{i:02d}", "input": prompt, "expected": answer, "tags": ["calendar"],
                "vars": {"reference": f"ANSWER: {answer}"}}
    day = rng.choice([29, 30, 31])
    k = rng.randint(3, 14)
    y, m = start.year, start.month
    first = _renewal(y, m, day)
    for _ in range(k):
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    answer = _renewal(y, m, day).isoformat()
    prompt = (f"A subscription first renews on {first:%d %B %Y} and then on day {day} of every following month; "
              f"in months without a day {day} it renews on that month's last day instead. "
              f"What is the date of renewal number {k + 1}, counting the first renewal as number 1? Give it as YYYY-MM-DD.")
    return {"id": f"cal-{i:02d}", "input": prompt, "expected": answer, "tags": ["calendar"],
            "scorers": [{"type": "exact"}], "vars": {"reference": f"ANSWER: {answer}"}}


def _renewal(y: int, m: int, day: int) -> date:
    last = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
    return date(y, m, min(day, last))


def _clue_holds(clue, perm) -> bool:
    pos = {p: k for k, p in enumerate(perm)}
    kind, a, b = clue
    n = len(perm)
    match kind:
        case "left_adj":
            return pos[a] + 1 == pos[b]
        case "left":
            return pos[a] < pos[b]
        case "not_end":
            return 0 < pos[a] < n - 1
        case "at":
            return pos[a] == b
        case "one_between":
            return abs(pos[a] - pos[b]) == 2
        case "not_adj":
            return abs(pos[a] - pos[b]) != 1
    raise ValueError(kind)


def _clue_text(clue) -> str:
    kind, a, b = clue
    return {
        "left_adj": f"{a} sits immediately to the left of {b}.",
        "left": f"{a} sits somewhere to the left of {b}.",
        "not_end": f"{a} does not sit at either end of the row.",
        "at": f"{a} sits in seat {b + 1}." if kind == "at" else "",
        "one_between": f"Exactly one person sits between {a} and {b}.",
        "not_adj": f"{a} and {b} do not sit next to each other.",
    }[kind]


def puzzle(rng, i: int) -> dict:
    n = rng.choice([5, 6, 6])
    people = rng.sample(NAMES, n)
    truth = people[:]
    rng.shuffle(truth)
    perms = list(itertools.permutations(people))

    def random_true_clue():
        while True:
            kind = rng.choice(["left_adj", "left", "not_end", "one_between", "not_adj", "left"])  # no "at": answers must be deduced
            a, b = rng.sample(people, 2)
            if kind == "at":
                clue = ("at", a, truth.index(a))
            elif kind == "not_end":
                clue = ("not_end", a, None)
            else:
                clue = (kind, a, b)
            if _clue_holds(clue, truth):
                return clue

    clues: list = []
    while sum(all(_clue_holds(c, p) for c in clues) for p in perms) > 1:
        c = random_true_clue()
        if c not in clues:
            clues.append(c)
    # Drop redundant clues so the puzzle needs real deduction.
    for c in clues[:]:
        rest = [x for x in clues if x != c]
        if sum(all(_clue_holds(x, p) for x in rest) for p in perms) == 1:
            clues = rest
    seat = rng.randrange(n)
    answer = truth[seat]
    prompt = (f"{n} colleagues — {', '.join(sorted(people))} — sit in a single row of seats numbered 1 to {n} from left to right.\n"
              + "\n".join(f"- {_clue_text(c)}" for c in clues)
              + f"\nThese clues have exactly one solution. Who sits in seat {seat + 1}? Answer with the name only.")
    return {"id": f"seat-{i:02d}", "input": prompt, "expected": answer, "tags": ["logic"],
            "scorers": [{"type": "exact"}], "vars": {"reference": f"ANSWER: {answer}", "solution": truth}}


def build() -> dict[str, dict]:
    rng = rng_for("reasoning")
    cases = [shopping(rng, i) for i in range(15)] + [calendar(rng, i) for i in range(15)] + [puzzle(rng, i) for i in range(15)]
    return {"reasoning/generated.yaml": benchmark(
        "std-reasoning-multistep", "reasoning",
        "Generated multi-step problems with code-verified answers: order pricing with stacked rules, calendar arithmetic, seating puzzles.",
        cases, system_prompt=f"Solve the problem carefully. {ANSWER_LINE}", scorers=[{"type": "numeric", "params": {"tolerance": 1e-9}}],
    )}

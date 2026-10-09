"""Software delivery: five SDLC stages built on four small codebases (see sdlc_modules.py).

1. requirements  feature request -> acceptance criteria (shape + judge rubric)
2. implement     ticket + module -> full updated module (hidden tests incl. regression)
3. bugfix        buggy module + failing test + real traceback -> fixed module (full hidden suite)
4. write tests   module + target -> tests (must pass on it and catch hidden planted bugs)
5. review        PR diff with planted defects -> findings with line numbers
"""

from __future__ import annotations

import difflib
import json
import re
import traceback

from .common import benchmark, rng_for
from .sdlc_modules import MODULES


def patch(source: str, edits: list[tuple[str, str]]) -> str:
    for find, replace in edits:
        assert source.count(find) == 1, f"edit target must be unique: {find[:60]!r}"
        source = source.replace(find, replace)
    return source


def run_suite(source: str, tests: str, filename: str = "module.py") -> list[tuple[str, str]]:
    """(name, traceback) for each failing test. Tracebacks are rendered from our own sources only, so the
    generated deck is identical on every machine and Python version."""
    test_file = f"test_{filename}"
    ns: dict = {}
    exec(compile(source, filename, "exec"), ns)
    exec(compile(tests, test_file, "exec"), ns)
    sources = {filename: source.splitlines(), test_file: tests.splitlines()}
    failures = []
    for name in [k for k in ns if k.startswith("test_")]:
        try:
            ns[name]()
        except Exception as e:
            lines = ["Traceback (most recent call last):"]
            for fr in traceback.extract_tb(e.__traceback__):
                if fr.filename in sources:
                    lines.append(f'  File "{fr.filename}", line {fr.lineno}, in {fr.name}')
                    lines.append(f"    {sources[fr.filename][fr.lineno - 1].strip()}")
            msg = re.sub(r"^day \d+ must be in range .*", "day is out of range for month", str(e))  # 3.14 reworded it
            lines.append(f"{type(e).__name__}: {msg}" if msg else type(e).__name__)
            failures.append((name, "\n".join(lines)))
    return failures


def fence(code: str) -> str:
    return f"```python\n{code.strip()}\n```"


# ---------------------------------------------------------------- 2. implement

FEATURES = [
    ("cart", "bulk-coupon",
     "Add a coupon code `BULK15`: 15% off the subtotal, but only when the subtotal is at least 200.00. Below that the coupon "
     "stays applied but gives no discount (so it starts working if more items are added). Existing coupons must behave as before.",
     [('COUPONS = {"SAVE10": ("percent", Decimal("10")), "FIVEOFF": ("fixed", Decimal("5.00"))}',
       'COUPONS = {"SAVE10": ("percent", Decimal("10")), "FIVEOFF": ("fixed", Decimal("5.00")), "BULK15": ("percent", Decimal("15"))}\n'
       'MIN_SUBTOTAL = {"BULK15": Decimal("200")}'),
      ("        sub = self.subtotal()\n        if kind",
       "        sub = self.subtotal()\n        if sub < MIN_SUBTOTAL.get(self.coupon, Decimal(\"0\")):\n            return Decimal(\"0\")\n        if kind")],
     '''
def test_bulk15():
    c = Cart(D("10"))
    c.add("A", D("199.99"))
    c.apply_coupon("BULK15")
    assert c.discount() == D("0")
    c.add("B", D("0.01"))
    assert c.discount() == D("30.00")
    assert c.total() == D("187.00")
    c.remove("B")
    assert c.discount() == D("0")
'''),
    ("cart", "max-quantity",
     "Limit each SKU to at most 10 units in the cart. `add` must raise ValueError if the resulting quantity for that SKU would "
     "exceed 10 (including when merging into an existing line), and leave the cart unchanged in that case.",
     [('CENT = Decimal("0.01")', 'CENT = Decimal("0.01")\nMAX_QTY = 10'),
      ("        if sku in self.items:\n            if self.items[sku].unit_price",
       "        held = self.items[sku].quantity if sku in self.items else 0\n        if held + quantity > MAX_QTY:\n"
       "            raise ValueError(f\"at most {MAX_QTY} units per item\")\n        if sku in self.items:\n            if self.items[sku].unit_price")],
     '''
def test_max_quantity():
    c = Cart()
    c.add("A", D("1"), 10)
    for args in (("A", D("1"), 1), ("B", D("1"), 11)):
        try:
            c.add(*args)
        except ValueError:
            pass
        else:
            raise AssertionError(args)
    assert c.items["A"].quantity == 10 and "B" not in c.items
    c.remove("A", 4)
    c.add("A", D("1"), 4)
    assert c.items["A"].quantity == 10
'''),
    ("cart", "to-dict",
     "Add `Cart.to_dict()` returning a JSON-serialisable summary: `{\"items\": [{\"sku\", \"unit_price\", \"quantity\"}...] sorted by sku, "
     "\"coupon\": code or None, \"subtotal\", \"discount\", \"tax\", \"total\"}`. All money values are strings with exactly two decimals "
     "(e.g. \"5.00\"); quantity stays an int.",
     [("    def total(self) -> Decimal:\n        return to_cents(self.subtotal() - self.discount() + self.tax())\n",
       "    def total(self) -> Decimal:\n        return to_cents(self.subtotal() - self.discount() + self.tax())\n\n"
       "    def to_dict(self) -> dict:\n        return {\n"
       "            \"items\": [{\"sku\": i.sku, \"unit_price\": str(to_cents(i.unit_price)), \"quantity\": i.quantity}\n"
       "                      for i in sorted(self.items.values(), key=lambda i: i.sku)],\n"
       "            \"coupon\": self.coupon,\n"
       "            \"subtotal\": str(to_cents(self.subtotal())),\n            \"discount\": str(to_cents(self.discount())),\n"
       "            \"tax\": str(self.tax()),\n            \"total\": str(self.total()),\n        }\n")],
     '''
def test_to_dict():
    import json
    c = Cart(D("10"))
    c.add("B", D("5"), 2)
    c.add("A", D("2.5"))
    c.apply_coupon("FIVEOFF")
    d = c.to_dict()
    assert d == {"items": [{"sku": "A", "unit_price": "2.50", "quantity": 1}, {"sku": "B", "unit_price": "5.00", "quantity": 2}],
                 "coupon": "FIVEOFF", "subtotal": "12.50", "discount": "5.00", "tax": "0.75", "total": "8.25"}
    json.dumps(d)
    assert Cart().to_dict()["items"] == [] and Cart().to_dict()["coupon"] is None
'''),
    ("ratelimit", "cost-over-capacity",
     "A request whose cost is larger than the bucket's capacity can never succeed. Make `TokenBucket.allow` and "
     "`TokenBucket.wait_time` raise ValueError in that case instead of returning False / a wait time. Costs must also be positive "
     "(ValueError for 0 or negative). Valid requests behave exactly as before.",
     [("    def allow(self, cost: int = 1) -> bool:\n        self._refill()",
       "    def _check_cost(self, cost: int) -> None:\n        if cost <= 0 or cost > self.capacity:\n"
       "            raise ValueError(\"cost must be between 1 and the bucket capacity\")\n\n"
       "    def allow(self, cost: int = 1) -> bool:\n        self._check_cost(cost)\n        self._refill()"),
      ("        \"\"\"Seconds until `cost` tokens will be available (0 if they already are).\"\"\"\n        self._refill()",
       "        \"\"\"Seconds until `cost` tokens will be available (0 if they already are).\"\"\"\n        self._check_cost(cost)\n        self._refill()")],
     '''
def test_cost_bounds():
    clk = FakeClock()
    b = TokenBucket(3, 1.0, clk)
    for fn in (b.allow, b.wait_time):
        for cost in (4, 0, -1):
            try:
                fn(cost)
            except ValueError:
                pass
            else:
                raise AssertionError((fn, cost))
    assert b.allow(3) is True and b.wait_time(3) == 3.0
'''),
    ("ratelimit", "remaining",
     "Add `KeyedLimiter.remaining(key) -> int`: the number of whole tokens currently available for `key` (after refilling). "
     "For a key that has no bucket yet, return the full capacity without creating a bucket and without affecting eviction order.",
     [("    def allow(self, key: str, cost: int = 1) -> bool:\n        bucket = self.buckets.get(key)",
       "    def remaining(self, key: str) -> int:\n        bucket = self.buckets.get(key)\n        if bucket is None:\n"
       "            return self.capacity\n        bucket._refill()\n        return int(bucket._tokens)\n\n"
       "    def allow(self, key: str, cost: int = 1) -> bool:\n        bucket = self.buckets.get(key)")],
     '''
def test_remaining():
    clk = FakeClock()
    lim = KeyedLimiter(5, 1.0, max_keys=2, clock=clk)
    assert lim.remaining("new") == 5 and "new" not in lim.buckets
    lim.allow("a", 3)
    assert lim.remaining("a") == 2
    clk.t += 1.7
    assert lim.remaining("a") == 3
    lim.allow("b")
    lim.remaining("a")
    lim.allow("c")
    assert list(lim.buckets) == ["b", "c"]
'''),
    ("ratelimit", "reset",
     "Add `KeyedLimiter.reset(key)`: forget the bucket for `key` so its next request starts with a full bucket. Resetting an "
     "unknown key is a no-op (no error).",
     [("    def allow(self, key: str, cost: int = 1) -> bool:\n        bucket = self.buckets.get(key)",
       "    def reset(self, key: str) -> None:\n        self.buckets.pop(key, None)\n\n"
       "    def allow(self, key: str, cost: int = 1) -> bool:\n        bucket = self.buckets.get(key)")],
     '''
def test_reset():
    clk = FakeClock()
    lim = KeyedLimiter(2, 0.001, clock=clk)
    assert lim.allow("a", 2) and not lim.allow("a")
    lim.reset("a")
    assert "a" not in lim.buckets
    assert lim.allow("a", 2)
    lim.reset("never-seen")
'''),
    ("billing", "interval",
     "Let `billing_periods` take an optional `interval_months` (default 1) so we can bill quarterly (3) or yearly (12). Periods "
     "must still be contiguous and anchored to the start date (clamped like add_months). Raise ValueError if interval_months < 1.",
     [("def billing_periods(start: date, count: int) -> list[tuple[date, date]]:",
       "def billing_periods(start: date, count: int, interval_months: int = 1) -> list[tuple[date, date]]:"),
      ("    if count < 0:\n        raise ValueError(\"count cannot be negative\")",
       "    if count < 0:\n        raise ValueError(\"count cannot be negative\")\n    if interval_months < 1:\n"
       "        raise ValueError(\"interval_months must be at least 1\")"),
      ("        begin = add_months(start, k)\n        end = add_months(start, k + 1) - timedelta(days=1)",
       "        begin = add_months(start, k * interval_months)\n        end = add_months(start, (k + 1) * interval_months) - timedelta(days=1)")],
     '''
def test_interval():
    assert billing_periods(Dt(2026, 1, 31), 2, interval_months=3) == [(Dt(2026, 1, 31), Dt(2026, 4, 29)), (Dt(2026, 4, 30), Dt(2026, 7, 30))]
    assert billing_periods(Dt(2028, 2, 29), 2, 12) == [(Dt(2028, 2, 29), Dt(2029, 2, 27)), (Dt(2029, 2, 28), Dt(2030, 2, 27))]
    try:
        billing_periods(Dt(2026, 1, 1), 1, 0)
    except ValueError:
        pass
    else:
        raise AssertionError("interval 0")
'''),
    ("billing", "next-start",
     "Add `next_period_start(start: date, today: date) -> date`: the first monthly period start (as produced by billing_periods "
     "from `start`) that is strictly after `today`. If `today` is before `start`, return `start`.",
     [("def days_in(", "def next_period_start(start: date, today: date) -> date:\n    if today < start:\n        return start\n"
       "    k = 1\n    while add_months(start, k) <= today:\n        k += 1\n    return add_months(start, k)\n\n\ndef days_in(")],
     '''
def test_next_period_start():
    s = Dt(2026, 1, 31)
    assert next_period_start(s, Dt(2026, 1, 1)) == s
    assert next_period_start(s, s) == Dt(2026, 2, 28)
    assert next_period_start(s, Dt(2026, 2, 27)) == Dt(2026, 2, 28)
    assert next_period_start(s, Dt(2026, 2, 28)) == Dt(2026, 3, 31)
    assert next_period_start(s, Dt(2027, 1, 30)) == Dt(2027, 1, 31)
'''),
    ("billing", "plan-change",
     "Add `change_plan(old_price, new_price, period, change_date) -> Decimal`: the net amount to charge when a customer switches "
     "plan on `change_date` within `period`: the new plan prorated from change_date to period end, minus a credit for the old plan "
     "over the same days. Negative means a credit. Round to cents (half up).",
     [("    return (amount * used / days_in(period)).quantize(CENT, rounding=ROUND_HALF_UP)\n",
       "    return (amount * used / days_in(period)).quantize(CENT, rounding=ROUND_HALF_UP)\n\n\n"
       "def change_plan(old_price: Decimal, new_price: Decimal, period: tuple[date, date], change_date: date) -> Decimal:\n"
       "    return prorate(new_price, period, change_date) - prorate(old_price, period, change_date)\n")],
     '''
def test_change_plan():
    p = (Dt(2026, 4, 1), Dt(2026, 4, 30))
    assert change_plan(D("30"), D("60"), p, Dt(2026, 4, 16)) == D("15.00")
    assert change_plan(D("60"), D("30"), p, Dt(2026, 4, 16)) == D("-15.00")
    assert change_plan(D("30"), D("60"), p, Dt(2026, 5, 2)) == D("0.00")
    assert change_plan(D("10"), D("10"), p, Dt(2026, 4, 3)) == D("0.00")
'''),
    ("csv_import", "seats",
     "Support an optional `seats` column. When the file has it, each imported row gets an int `seats` (blank means 1); values "
     "that are not whole numbers from 1 to 500 make the row an error \"invalid seats\". When the file has no seats column, rows "
     "must look exactly as before (no seats key).",
     [("        seen.add(email)\n        result.rows.append({\"email\": email, \"name\": row[\"name\"], \"plan\": plan})",
       "        out = {\"email\": email, \"name\": row[\"name\"], \"plan\": plan}\n        if \"seats\" in reader.fieldnames:\n"
       "            raw_seats = row.get(\"seats\") or \"1\"\n            if not raw_seats.isdigit() or not 1 <= int(raw_seats) <= 500:\n"
       "                result.errors.append((line_no, \"invalid seats\"))\n                continue\n"
       "            out[\"seats\"] = int(raw_seats)\n        seen.add(email)\n        result.rows.append(out)")],
     '''
def test_seats():
    r = parse_users("email,name,plan,seats\\na@ex.com,A,team,5\\nb@ex.com,B,team,\\nc@ex.com,C,team,0\\nd@ex.com,D,team,2.5\\ne@ex.com,E,team,501\\n")
    assert [(x["email"], x["seats"]) for x in r.rows] == [("a@ex.com", 5), ("b@ex.com", 1)]
    assert r.errors == [(4, "invalid seats"), (5, "invalid seats"), (6, "invalid seats")]
    r = parse_users("email,name,plan,seats\\nc@ex.com,C,team,0\\nc@ex.com,C2,team,3\\n")
    assert r.rows == [{"email": "c@ex.com", "name": "C2", "plan": "team", "seats": 3}]
'''),
    ("csv_import", "semicolons",
     "Spreadsheet exports from some locales use `;` as the separator. Detect it: if the header line contains `;` and no `,`, parse "
     "the file as semicolon-separated; otherwise keep comma parsing. Everything else (validation, line numbers) is unchanged.",
     [("    reader = csv.DictReader(io.StringIO(text))",
       "    header = text.split(\"\\n\", 1)[0]\n    delimiter = \";\" if \";\" in header and \",\" not in header else \",\"\n"
       "    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)")],
     '''
def test_semicolons():
    r = parse_users("email;name;plan\\na@ex.com;Ana, Jr.;team\\nbad;X;free\\n")
    assert r.rows == [{"email": "a@ex.com", "name": "Ana, Jr.", "plan": "team"}]
    assert r.errors == [(3, "invalid email")]
    assert parse_users("email,name,plan\\nb@ex.com,B;C,free\\n").rows[0]["name"] == "B;C"
'''),
    ("csv_import", "strict",
     "Add a keyword argument `strict=False` to `parse_users`. With `strict=True`, the first row error raises ValueError with the "
     "message `line <n>: <error>` (e.g. `line 3: duplicate email`) instead of being collected. Header errors also raise in strict "
     "mode. Default behaviour is unchanged.",
     [("def parse_users(text: str) -> ImportResult:", "def parse_users(text: str, strict: bool = False) -> ImportResult:"),
      ("    result = ImportResult()\n",
       "    result = ImportResult()\n\n    class _Errors(list):\n        def append(self, item):\n            if strict:\n"
       "                raise ValueError(f\"line {item[0]}: {item[1]}\")\n            super().append(item)\n\n"
       "    result.errors = _Errors()\n")],
     '''
def test_strict():
    text = "email,name,plan\\na@ex.com,A,free\\nA@ex.com,B,free\\n"
    assert parse_users(text).errors == [(3, "duplicate email")]
    for t, msg in ((text, "line 3: duplicate email"), ("email,name\\n", "line 1: missing columns: plan")):
        try:
            parse_users(t, strict=True)
        except ValueError as e:
            assert str(e) == msg, str(e)
        else:
            raise AssertionError("strict did not raise")
    assert parse_users("email,name,plan\\na@ex.com,A,free\\n", strict=True).rows[0]["email"] == "a@ex.com"
'''),
]


def implement_cases() -> list[dict]:
    cases = []
    for mod, fid, ticket, edits, new_tests in FEATURES:
        m = MODULES[mod]
        reference = patch(m["source"], edits)
        tests = m["tests"] + "\n" + new_tests
        assert not run_suite(reference, tests), (fid, run_suite(reference, tests))
        assert run_suite(m["source"], m["tests"] + "\n" + new_tests), f"{fid}: new tests already pass on the old module"
        prompt = (f"You maintain `{m['file']}`, {m['what']}. Here is the current file:\n\n{fence(m['source'])}\n\n"
                  f"Ticket: {ticket}\n\nReturn the complete updated `{m['file']}` in a single ```python block. Keep existing behaviour "
                  "and public names unless the ticket says otherwise. Hidden tests will cover the new behaviour, edge cases and the existing behaviour.")
        cases.append({"id": f"implement-{mod}-{fid}", "input": prompt, "tags": ["implement", mod],
                      "scorers": [{"type": "code_exec", "params": {"timeout_s": 20}}],
                      "vars": {"tests": tests, "reference": fence(reference)}})
    return cases


# ---------------------------------------------------------------- 3. bug fix

BUGS = [
    ("cart", "tax-ignores-discount", "Customers with a coupon are overcharged on tax.",
     ("        return to_cents((self.subtotal() - self.discount()) * self.tax_rate / 100)", "        return to_cents(self.subtotal() * self.tax_rate / 100)")),
    ("cart", "fixed-coupon-negative", "Small orders with the FIVEOFF coupon show a negative total.",
     ("        return min(value, sub)", "        return value")),
    ("cart", "zero-quantity-line", "Removing every unit of an item leaves an empty line in the cart.",
     ("        if quantity is None or quantity == item.quantity:", "        if quantity is None:")),
    ("ratelimit", "refill-uncapped", "After a quiet period, clients can burst far beyond the configured capacity.",
     ("        self._tokens = min(self.capacity, self._tokens + elapsed * self.refill_per_sec)", "        self._tokens = self._tokens + elapsed * self.refill_per_sec")),
    ("ratelimit", "negative-wait", "Retry-After headers sometimes contain negative numbers.",
     ("        return max(0.0, missing / self.refill_per_sec)", "        return missing / self.refill_per_sec")),
    ("ratelimit", "evicts-active-clients", "Busy clients lose their limiter state while idle ones are kept.",
     ("        else:\n            self.buckets.move_to_end(key)\n", "")),
    ("billing", "month-end-crash", "Subscriptions that start on the 31st crash the invoice job.",
     ("    return date(year, month, min(d.day, last))", "    return date(year, month, d.day)")),
    ("billing", "proration-short", "Prorated charges are consistently one day short.",
     ("    used = (end - active_from).days + 1", "    used = (end - active_from).days")),
    ("billing", "overlapping-periods", "Customers are billed twice for the first day of each period.",
     ("        end = add_months(start, k + 1) - timedelta(days=1)", "        end = add_months(start, k + 1)")),
    ("csv_import", "case-sensitive-emails", "The same person is imported twice when their email differs only in capitals.",
     ("        email = row[\"email\"].lower()", "        email = row[\"email\"]")),
    ("csv_import", "line-numbers", "Error messages point at the wrong line of the spreadsheet.",
     ("    for line_no, raw in enumerate(reader, start=2):", "    for line_no, raw in enumerate(reader, start=1):")),
    ("csv_import", "plan-case", "Rows with plan 'Team' or 'FREE' are rejected as unknown plans.",
     ("        plan = row[\"plan\"].lower()", "        plan = row[\"plan\"]")),
]


def bugfix_cases() -> list[dict]:
    cases = []
    for mod, bid, report, (find, replace) in BUGS:
        m = MODULES[mod]
        buggy = patch(m["source"], [(find, replace)])
        failures = run_suite(buggy, m["tests"], m["file"])
        assert failures, bid
        name, tb = failures[0]
        test_src = m["tests"].split(f"def {name}(")[1].split("\ndef ")[0]
        prompt = (f"Bug report for `{m['file']}`: {report}\n\nThis test fails:\n\n{fence('def ' + name + '(' + test_src)}\n\n"
                  f"Traceback:\n```\n{tb.strip()}\n```\n\nCurrent `{m['file']}`:\n\n{fence(buggy)}\n\n"
                  f"Fix the root cause. Return the complete corrected `{m['file']}` in a single ```python block. "
                  "Hidden tests cover this bug, related paths and all existing behaviour.")
        cases.append({"id": f"bugfix-{mod}-{bid}", "input": prompt, "tags": ["bugfix", mod],
                      "scorers": [{"type": "code_exec", "params": {"timeout_s": 20}}],
                      "vars": {"tests": m["tests"], "reference": fence(m["source"])}})
    return cases


# ---------------------------------------------------------------- 4. write tests

TEST_TASKS = [
    ("cart", "discount", "`Cart.discount()` for every coupon type, including rounding of half cents and the cap on fixed coupons",
     [("rounding", "            return to_cents(sub * value / 100)", "            return (sub * value / 100).quantize(CENT)"),
      ("no-cap", "        return min(value, sub)", "        return value"),
      ("percent-scale", "            return to_cents(sub * value / 100)", "            return to_cents(sub * value / 1000)")],
     '''
from decimal import Decimal as D
def test_discount():
    c = Cart()
    assert c.discount() == D("0")
    c.add("A", D("0.25"))
    c.apply_coupon("SAVE10")
    assert c.discount() == D("0.03")
    c.add("B", D("100"))
    assert c.discount() == D("10.03")
    c2 = Cart()
    c2.add("A", D("3"))
    c2.apply_coupon("FIVEOFF")
    assert c2.discount() == D("3")
'''),
    ("cart", "add-remove", "`Cart.add` and `Cart.remove`, including validation and error cases",
     [("price-mismatch", "            if self.items[sku].unit_price != unit_price:\n                raise ValueError(f\"price mismatch for {sku}\")\n", ""),
      ("zero-qty", "        if quantity <= 0:", "        if quantity < 0:"),
      ("silent-missing", "            raise KeyError(sku)", "            return")],
     '''
from decimal import Decimal as D
import pytest
def test_add_remove():
    c = Cart()
    c.add("A", D("1"), 2)
    with pytest.raises(ValueError):
        c.add("A", D("2"))
    with pytest.raises(ValueError):
        c.add("B", D("1"), 0)
    with pytest.raises(KeyError):
        c.remove("Z")
    c.remove("A", 1)
    assert c.items["A"].quantity == 1
'''),
    ("cart", "tax-total", "`Cart.tax()` and `Cart.total()`, including coupons and the tax-rate validation",
     [("tax-before-discount", "        return to_cents((self.subtotal() - self.discount()) * self.tax_rate / 100)", "        return to_cents(self.subtotal() * self.tax_rate / 100)"),
      ("half-even", "def to_cents(x: Decimal) -> Decimal:\n    return x.quantize(CENT, rounding=ROUND_HALF_UP)", "def to_cents(x: Decimal) -> Decimal:\n    return x.quantize(CENT)"),
      ("negative-rate", "        if tax_rate < 0:\n            raise ValueError(\"tax rate cannot be negative\")\n", "")],
     '''
from decimal import Decimal as D
import pytest
def test_tax_total():
    c = Cart(D("8.25"))
    c.add("A", D("19.99"), 3)
    c.apply_coupon("SAVE10")
    assert c.tax() == D("4.45") and c.total() == D("58.42")
    c2 = Cart(D("10"))
    c2.add("A", D("0.25"))
    assert c2.tax() == D("0.03")
    with pytest.raises(ValueError):
        Cart(D("-1"))
'''),
    ("ratelimit", "bucket", "`TokenBucket.allow`, including refilling over time, the capacity cap, exact-cost requests and a clock that goes backwards",
     [("uncapped", "        self._tokens = min(self.capacity, self._tokens + elapsed * self.refill_per_sec)", "        self._tokens = self._tokens + elapsed * self.refill_per_sec"),
      ("strict-gt", "        if self._tokens >= cost:", "        if self._tokens > cost:"),
      ("backwards", "        elapsed = max(0.0, now - self._last)", "        elapsed = abs(now - self._last)")],
     '''
class Clk:
    t = 0.0
    def __call__(self):
        return self.t
def test_bucket():
    k = Clk()
    b = TokenBucket(2, 1.0, k)
    assert b.allow(2) and not b.allow()
    k.t = 10
    assert b.allow() and b.allow() and not b.allow()
    k.t = 5
    assert not b.allow()
'''),
    ("ratelimit", "wait", "`TokenBucket.wait_time`",
     [("negative", "        return max(0.0, missing / self.refill_per_sec)", "        return missing / self.refill_per_sec"),
      ("by-capacity", "        return max(0.0, missing / self.refill_per_sec)", "        return max(0.0, missing / self.capacity)"),
      ("no-refill", "        \"\"\"Seconds until `cost` tokens will be available (0 if they already are).\"\"\"\n        self._refill()\n",
       "        \"\"\"Seconds until `cost` tokens will be available (0 if they already are).\"\"\"\n")],
     '''
class Clk:
    t = 0.0
    def __call__(self):
        return self.t
def test_wait():
    k = Clk()
    b = TokenBucket(4, 2.0, k)
    assert b.wait_time(1) == 0.0
    b.allow(4)
    assert b.wait_time(3) == 1.5
    k.t = 1.0
    assert b.wait_time(3) == 0.5
'''),
    ("ratelimit", "keyed", "`KeyedLimiter`, including per-key isolation and least-recently-used eviction",
     [("no-lru", "        else:\n            self.buckets.move_to_end(key)\n", ""),
      ("evict-newest", "                self.buckets.popitem(last=False)", "                self.buckets.popitem(last=True)"),
      ("evict-early", "            if len(self.buckets) > self.max_keys:", "            if len(self.buckets) >= self.max_keys:")],
     '''
def test_keyed():
    lim = KeyedLimiter(1, 0.001, max_keys=2, clock=lambda: 0.0)
    assert lim.allow("a") and not lim.allow("a") and lim.allow("b")
    lim.allow("a")
    lim.allow("c")
    assert list(lim.buckets) == ["a", "c"]
'''),
    ("billing", "add-months", "`add_months`, including month-end clamping, leap years, year boundaries and negative offsets",
     [("no-clamp", "    return date(year, month, min(d.day, last))", "    return date(year, month, min(d.day, 28) if d.day > last else d.day)"),
      ("year-roll", "    year, month = d.year + month_index // 12, month_index % 12 + 1", "    year, month = d.year + n // 12, month_index % 12 + 1"),
      ("clamp-28", "    return date(year, month, min(d.day, last))", "    return date(year, month, min(d.day, 28))")],
     '''
from datetime import date as Dt
def test_add_months():
    assert add_months(Dt(2028, 1, 31), 1) == Dt(2028, 2, 29)
    assert add_months(Dt(2026, 11, 15), 3) == Dt(2027, 2, 15)
    assert add_months(Dt(2026, 1, 30), 2) == Dt(2026, 3, 30)
    assert add_months(Dt(2026, 3, 31), -1) == Dt(2026, 2, 28)
'''),
    ("billing", "periods", "`billing_periods`, including contiguity after month-end clamping and invalid counts",
     [("overlap", "        end = add_months(start, k + 1) - timedelta(days=1)", "        end = add_months(start, k + 1)"),
      ("drift", "        end = add_months(start, k + 1) - timedelta(days=1)", "        end = add_months(begin, 1) - timedelta(days=1)"),
      ("no-validation", "    if count < 0:\n        raise ValueError(\"count cannot be negative\")\n", "")],
     '''
from datetime import date as Dt
import pytest
def test_periods():
    ps = billing_periods(Dt(2026, 1, 31), 3)
    assert ps[0] == (Dt(2026, 1, 31), Dt(2026, 2, 27))
    assert ps[1] == (Dt(2026, 2, 28), Dt(2026, 3, 30))
    with pytest.raises(ValueError):
        billing_periods(Dt(2026, 1, 1), -1)
'''),
    ("billing", "prorate", "`prorate`, including activation before, on the first day of, on the last day of and after the period",
     [("off-by-one", "    used = (end - active_from).days + 1", "    used = (end - active_from).days"),
      ("no-clamp", "    active_from = max(active_from, begin)\n", ""),
      ("last-day", "    if active_from > end:", "    if active_from >= end:")],
     '''
from datetime import date as Dt
from decimal import Decimal as D
def test_prorate():
    p = (Dt(2026, 4, 1), Dt(2026, 4, 30))
    assert prorate(D("30"), p, Dt(2026, 4, 16)) == D("15.00")
    assert prorate(D("30"), p, Dt(2026, 3, 1)) == D("30.00")
    assert prorate(D("30"), p, Dt(2026, 4, 30)) == D("1.00")
    assert prorate(D("30"), p, Dt(2026, 5, 1)) == D("0.00")
'''),
    ("csv_import", "emails", "email validation and normalisation in `parse_users`",
     [("no-lower", "        email = row[\"email\"].lower()", "        email = row[\"email\"]"),
      ("no-strip", "        row = {k: (v or \"\").strip() for k, v in raw.items() if k}", "        row = {k: (v or \"\") for k, v in raw.items() if k}"),
      ("no-tld", "EMAIL = re.compile(r\"^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$\", re.I)", "EMAIL = re.compile(r\"^[^@\\s]+@[^@\\s]+$\", re.I)")],
     '''
def test_emails():
    r = parse_users("email,name,plan\\n  Ana@Example.COM ,Ana,free\\nbob@localhost,Bob,free\\n")
    assert r.rows == [{"email": "ana@example.com", "name": "Ana", "plan": "free"}]
    assert r.errors == [(3, "invalid email")]
'''),
    ("csv_import", "duplicates", "duplicate handling and error line numbers in `parse_users`",
     [("case-dupes", "        if email in seen:", "        if row[\"email\"] in seen:"),
      ("no-dupes", "        if email in seen:", "        if False:"),
      ("line-start", "    for line_no, raw in enumerate(reader, start=2):", "    for line_no, raw in enumerate(reader, start=1):")],
     '''
def test_duplicates():
    r = parse_users("email,name,plan\\na@ex.com,A,free\\nA@EX.COM,B,free\\n")
    assert len(r.rows) == 1 and r.errors == [(3, "duplicate email")]
'''),
    ("csv_import", "header-plan", "header handling and plan validation in `parse_users`",
     [("header-case", "    reader.fieldnames = [h.strip().lower() for h in reader.fieldnames]", "    reader.fieldnames = [h.strip() for h in reader.fieldnames]"),
      ("plan-case", "        plan = row[\"plan\"].lower()", "        plan = row[\"plan\"]"),
      ("no-missing-check", "    if missing:\n        result.errors.append((1, f\"missing columns: {', '.join(missing)}\"))\n        return result\n", "")],
     '''
def test_header_plan():
    r = parse_users("Email,NAME,Plan\\na@ex.com,A,Team\\nb@ex.com,B,gold\\n")
    assert r.rows == [{"email": "a@ex.com", "name": "A", "plan": "team"}]
    assert r.errors == [(3, "unknown plan")]
    assert parse_users("email,name\\na@ex.com,A\\n").errors == [(1, "missing columns: plan")]
'''),
]


def write_tests_cases() -> list[dict]:
    cases = []
    for mod, tid, target, mutants, ref_tests in TEST_TASKS:
        m = MODULES[mod]
        module = m["file"][:-3]
        muts = [{"name": n, "find": f, "replace": r} for n, f, r in mutants]
        for mu in muts:
            patch(m["source"], [(mu["find"], mu["replace"])])  # every mutant must apply cleanly
        prompt = (f"Here is `{m['file']}`, {m['what']}:\n\n{fence(m['source'])}\n\nWrite tests for {target}. Your tests will run against "
                  "this implementation and against versions containing subtle bugs: they must pass here and should fail on as many buggy "
                  f"versions as possible. Put them in functions named `test_*` using plain `assert` (pytest.raises is available). Everything "
                  f"in the module is already imported with `from {module} import *`. Return a single ```python block.")
        cases.append({"id": f"tests-{mod}-{tid}", "input": prompt, "tags": ["write_tests", mod],
                      "scorers": [{"type": "test_quality", "params": {"timeout_s": 20}}],
                      "vars": {"module": module, "reference_impl": m["source"], "mutants": muts, "reference": fence(ref_tests)}})
    return cases


# ---------------------------------------------------------------- 5. review

PLANT = "  # @@PLANT:"

REVIEWS = [
    ("cart", "case-insensitive-coupons", "Accept coupon codes in any case and trim spaces.",
     [("    def apply_coupon(self, code: str) -> None:\n        if code not in COUPONS:\n            raise ValueError(f\"unknown coupon {code}\")\n        self.coupon = code\n",
       "    def apply_coupon(self, code: str) -> None:\n        code = code.strip().upper()\n        self.coupon = code" + PLANT + "correctness\n"
       "        if code not in COUPONS:\n            raise ValueError(f\"unknown coupon {code}\")\n"),
      ("            return to_cents(sub * value / 100)", "            return Decimal(int(sub * value / 100))" + PLANT + "correctness")]),
    ("cart", "subtotal-cache", "Cache the subtotal because carts are re-priced on every page view.",
     [("        self.coupon: str | None = None\n", "        self.coupon: str | None = None\n        self._subtotal: Decimal | None = None\n"),
      ("    def subtotal(self) -> Decimal:\n        return sum((i.amount for i in self.items.values()), Decimal(\"0\"))",
       "    def subtotal(self) -> Decimal:\n        if self._subtotal is None:" + PLANT + "correctness\n"
       "            self._subtotal = sum((i.amount for i in self.items.values()), Decimal(\"0\"))\n        return self._subtotal"),
      ("        if sku not in self.items:\n            raise KeyError(sku)\n        item = self.items[sku]",
       "        try:\n            item = self.items[sku]\n        except KeyError:\n            return" + PLANT + "error_handling")]),
    ("cart", "add-many", "Add `add_many` for importing saved carts.",
     [("    def remove(self, sku: str, quantity: int | None = None) -> None:",
       "    def add_many(self, lines: list[tuple[str, Decimal, int]]) -> None:\n        for sku, price, qty in lines:\n            try:\n"
       "                self.add(sku, price, qty)\n            except Exception:\n                pass" + PLANT + "error_handling\n\n"
       "    def remove(self, sku: str, quantity: int | None = None) -> None:"),
      ("        if unit_price < 0:", "        if unit_price < 0 and quantity > 1:" + PLANT + "correctness")]),
    ("ratelimit", "thread-safety", "Make TokenBucket safe to share between threads.",
     [("import time\n", "import threading\nimport time\n"),
      ("        self._last = clock()\n", "        self._last = clock()\n        self._lock = threading.Lock()\n"),
      ("    def allow(self, cost: int = 1) -> bool:\n        self._refill()\n        if self._tokens >= cost:\n            self._tokens -= cost\n            return True\n        return False",
       "    def allow(self, cost: int = 1) -> bool:\n        self._refill()" + PLANT + "concurrency\n        with self._lock:\n"
       "            if self._tokens > cost:" + PLANT + "correctness\n                self._tokens -= cost\n                return True\n            return False")]),
    ("ratelimit", "per-key-overrides", "Allow per-key capacity overrides for partner API keys.",
     [("    def __init__(self, capacity: int, refill_per_sec: float, max_keys: int = 1000, clock: Callable[[], float] = time.monotonic):\n        self.capacity = capacity",
       "    def __init__(self, capacity: int, refill_per_sec: float, max_keys: int = 1000, clock: Callable[[], float] = time.monotonic,\n"
       "                 overrides: dict[str, int] | None = None):\n        self.overrides = overrides or {}\n        self.capacity = capacity"),
      ("            bucket = TokenBucket(self.capacity, self.refill_per_sec, self.clock)",
       "            cap = self.overrides.get(key, self.capacity)\n            bucket = TokenBucket(cap, self.overrides.get(key, self.refill_per_sec), self.clock)" + PLANT + "correctness"),
      ("            if len(self.buckets) > self.max_keys:\n                self.buckets.popitem(last=False)",
       "            if len(self.buckets) > self.max_keys:\n                oldest = sorted(self.buckets, key=lambda k: self.buckets[k]._last)[0]" + PLANT + "performance\n"
       "                del self.buckets[oldest]")]),
    ("ratelimit", "retry-after", "Add a helper that formats the Retry-After header.",
     [("class KeyedLimiter:", "def retry_after_header(bucket: TokenBucket, cost: int = 1) -> str:\n"
       "    return str(int(bucket.wait_time(cost)))" + PLANT + "correctness\n\n\nclass KeyedLimiter:"),
      ("        now = self.clock()\n        elapsed = max(0.0, now - self._last)\n        self._tokens = min(self.capacity, self._tokens + elapsed * self.refill_per_sec)\n        self._last = now",
       "        elapsed = max(0.0, self.clock() - self._last)\n        self._tokens = min(self.capacity, self._tokens + elapsed * self.refill_per_sec)\n"
       "        self._last = self.clock()" + PLANT + "correctness")]),
    ("billing", "quarterly", "Support quarterly billing periods.",
     [("def billing_periods(start: date, count: int) -> list[tuple[date, date]]:",
       "def billing_periods(start: date, count: int, interval_months: int = 1) -> list[tuple[date, date]]:"),
      ("    if count < 0:", "    if count <= 0:" + PLANT + "correctness"),
      ("        begin = add_months(start, k)\n        end = add_months(start, k + 1) - timedelta(days=1)",
       "        begin = add_months(start, k * interval_months)\n        end = add_months(begin, interval_months) - timedelta(days=1)" + PLANT + "correctness")]),
    ("billing", "faster-proration", "Simplify proration maths.",
     [("    if active_from > end:", "    if active_from >= end:" + PLANT + "correctness"),
      ("    return (amount * used / days_in(period)).quantize(CENT, rounding=ROUND_HALF_UP)",
       "    return Decimal(float(amount) * used / days_in(period)).quantize(CENT, rounding=ROUND_HALF_UP)" + PLANT + "correctness")]),
    ("billing", "safe-proration", "Never let a proration error break the invoice run.",
     [("def prorate(amount: Decimal, period: tuple[date, date], active_from: date) -> Decimal:\n    \"\"\"Charge for the part of the period from active_from to the period end, inclusive.\"\"\"\n    begin, end = period",
       "def prorate(amount: Decimal, period: tuple[date, date], active_from: date) -> Decimal:\n    \"\"\"Charge for the part of the period from active_from to the period end, inclusive.\"\"\"\n"
       "    try:\n        return _prorate(amount, period, active_from)\n    except Exception:\n        return Decimal(\"0.00\")" + PLANT + "error_handling\n\n\n"
       "def _prorate(amount: Decimal, period: tuple[date, date], active_from: date) -> Decimal:\n    begin, end = period"),
      ("    last = calendar.monthrange(year, month)[1]", "    last = calendar.monthrange(year, month)[1] - 1" + PLANT + "correctness")]),
    ("csv_import", "seats-column", "Read an optional seats column.",
     [("        seen.add(email)\n        result.rows.append({\"email\": email, \"name\": row[\"name\"], \"plan\": plan})",
       "        seen.add(email)\n        seats = eval(row.get(\"seats\") or \"1\")" + PLANT + "security\n"
       "        result.rows.append({\"email\": email, \"name\": row[\"name\"], \"plan\": plan, \"seats\": seats})"),
      ("        if email in seen:\n            result.errors.append((line_no, \"duplicate email\"))\n            continue\n",
       "        if email in seen:\n            result.errors.append((line_no, \"duplicate email\"))\n            continue\n        seen.add(email)" + PLANT + "correctness\n")]),
    ("csv_import", "faster-import", "Speed up large imports.",
     [("    seen: set[str] = set()", "    seen: list[str] = []" + PLANT + "performance"),
      ("        seen.add(email)", "        seen.append(email)"),
      ("    for line_no, raw in enumerate(reader, start=2):\n        row = {k: (v or \"\").strip() for k, v in raw.items() if k}",
       "    for line_no, raw in enumerate(reader, start=2):\n        try:\n            row = {k: (v or \"\").strip() for k, v in raw.items() if k}\n"
       "        except Exception:\n            continue" + PLANT + "error_handling")]),
    ("csv_import", "export", "Add an export of imported rows for the admin download.",
     [("def parse_users(text: str) -> ImportResult:",
       "def rows_to_csv(rows: list[dict]) -> str:\n    out = io.StringIO()\n    writer = csv.writer(out)\n    writer.writerow(REQUIRED)\n"
       "    for r in rows:\n        writer.writerow([r[\"email\"], r[\"name\"], r[\"plan\"]])" + PLANT + "security\n"
       "        print(f\"exported {r['email']} {r['name']}\")" + PLANT + "security\n    return out.getvalue()\n\n\n"
       "def parse_users(text: str) -> ImportResult:")]),
]


def review_diff(old: str, new: str, filename: str) -> str:
    """Unified-style diff whose left column is the line number in the NEW file."""
    a, b = old.splitlines(), new.splitlines()
    out = [f"--- a/{filename}", f"+++ b/{filename}"]
    for group in difflib.SequenceMatcher(None, a, b).get_grouped_opcodes(5):
        for tag, i1, i2, j1, j2 in group:
            if tag == "equal":
                out += [f"{j + 1:>4}   {b[j]}" for j in range(j1, j2)]
                continue
            out += [f"       - {a[i]}" for i in range(i1, i2)]
            out += [f"{j + 1:>4} + {b[j]}" for j in range(j1, j2)]
        out.append("   ...")
    return "\n".join(out)


def review_cases() -> list[dict]:
    cases = []
    for mod, rid, description, edits in REVIEWS:
        m = MODULES[mod]
        planted_src = patch(m["source"], edits)
        expected, lines = [], []
        for n, line in enumerate(planted_src.splitlines(), start=1):
            if PLANT in line:
                code, cat = line.split(PLANT)
                expected.append({"line": n, "category": cat.strip()})
                lines.append(code)
            else:
                lines.append(line)
        new = "\n".join(lines) + "\n"
        assert expected, rid
        diff = review_diff(m["source"], new, m["file"])
        prompt = (f"Review this pull request to `{m['file']}` ({m['what']}).\nPR description: {description}\n\n```diff\n{diff}\n```\n\n"
                  "Report every real defect the change introduces (bugs, security, error handling, performance, concurrency), not style. "
                  "Respond with only JSON: {\"findings\": [{\"line\": <line number in the new file, from the left column>, "
                  "\"category\": \"correctness\" | \"security\" | \"performance\" | \"error_handling\" | \"concurrency\", \"explanation\": \"...\"}]}.")
        cases.append({"id": f"review-{mod}-{rid}", "input": prompt, "expected": expected, "tags": ["review", mod],
                      "scorers": [{"type": "review_findings"}],
                      "vars": {"reference": json.dumps({"findings": [{**e, "explanation": "planted"} for e in expected]})}})
    return cases


# ---------------------------------------------------------------- 1. requirements

REQUESTS = [
    ("cart", "gift-cards", "Customers should be able to pay part of an order with a gift card.",
     ["partial and full payment with a gift card balance", "gift card cannot reduce the total below zero / leftover balance is kept",
      "tax is computed before the gift card is applied", "invalid, expired or already-used cards are rejected with a clear message",
      "an open question about combining gift cards with coupons or multiple gift cards"]),
    ("cart", "coupon-limits", "Each customer may use a promotional coupon only once.",
     ["the second use of the same coupon by the same customer is rejected", "different customers can each use the coupon once",
      "what counts as the same customer (account vs email vs guest checkout)", "behaviour when an order using the coupon is cancelled or refunded",
      "an open question about concurrency or two simultaneous checkouts"]),
    ("cart", "currencies", "Show cart prices in the customer's local currency.",
     ["prices converted with a stated exchange-rate source and timestamp", "rounding rules per currency (e.g. JPY has no decimals)",
      "the charged currency and amount match what was displayed", "what happens if the rate changes between viewing and paying",
      "an open question about which currencies are supported"]),
    ("ratelimit", "plan-limits", "Rate limits should depend on the customer's plan (free vs pro).",
     ["free and pro limits as specific numbers or a reference to where they are configured", "a plan change takes effect within a defined time",
      "requests over the limit get HTTP 429 with Retry-After", "unauthenticated requests get the strictest limit",
      "an open question about the actual limit values or burst size"]),
    ("ratelimit", "burst", "Let clients burst briefly above their steady rate.",
     ["the steady rate and the burst size are distinct and specified", "after a burst the client is throttled until tokens refill",
      "idle clients never accumulate more than the burst size", "a measurable example (e.g. N requests in M seconds)",
      "an open question about per-endpoint or global limits"]),
    ("ratelimit", "admin-override", "Support staff need to temporarily lift a customer's rate limit.",
     ["who is allowed to lift a limit (authorisation)", "overrides expire automatically after a set time",
      "overrides are audit-logged with who, when and why", "the customer's normal limit returns after expiry",
      "an open question about the maximum override duration or size"]),
    ("billing", "pause", "Customers want to pause their subscription for up to three months.",
     ["no charges while paused", "pause length limited to three months; behaviour at the limit", "how the billing date changes after resuming",
      "what happens to a pause requested mid-period (proration or credit)", "an open question about access to the product while paused"]),
    ("billing", "upgrade-proration", "Upgrades mid-cycle should be charged fairly.",
     ["immediate charge for the prorated difference for the remaining days", "downgrades take effect at the next period or give credit (stated)",
      "rounding to cents is defined", "multiple changes in one period are handled", "an open question about refunds for downgrades"]),
    ("billing", "annual", "Offer annual plans with a discount.",
     ["annual price or discount stated or referenced", "renewal date and renewal reminder before charging",
      "cancellation mid-year: refund or no refund stated", "switching between monthly and annual", "an open question about the discount size"]),
    ("csv_import", "preview", "Admins want to preview a CSV import before anything is saved.",
     ["preview shows valid rows and per-line errors without saving", "admin can confirm or cancel after preview",
      "the confirmed import uses exactly the previewed data (file unchanged)", "large files: preview limit or pagination",
      "an open question about how long a preview is kept"]),
    ("csv_import", "upsert", "Re-importing a file should update existing users instead of failing.",
     ["existing users matched by email (case-insensitive) are updated", "new users are created", "which fields can be updated (e.g. plan, name)",
      "users missing from the file are left unchanged (or the rule is stated)", "an open question about downgrades or plan changes triggering billing"]),
    ("csv_import", "big-files", "Support importing files with up to 100,000 users.",
     ["a stated performance target (time or throughput)", "progress reporting during the import", "partial failure behaviour (all-or-nothing vs per row)",
      "the import can be retried safely without duplicates", "an open question about file size limits or upload method"]),
]

AC_SCHEMA = {"type": "object", "required": ["acceptance_criteria", "open_questions"], "properties": {
    "acceptance_criteria": {"type": "array", "minItems": 3, "items": {"type": "object", "required": ["id", "given", "when", "then"],
                            "properties": {"id": {"type": "string"}, "given": {"type": "string"}, "when": {"type": "string"}, "then": {"type": "string"}}}},
    "open_questions": {"type": "array", "items": {"type": "string"}}}}


def requirements_cases() -> list[dict]:
    cases = []
    for mod, rid, request, must in REQUESTS:
        m = MODULES[mod]
        rubric = ("Score how well the acceptance criteria would let an engineer build and test this feature. Award points for each of "
                  "these being covered by a specific, testable criterion or open question:\n" + "\n".join(f"- {x}" for x in must) +
                  "\nDeduct for vague criteria (e.g. 'works correctly'), implementation details instead of behaviour, or contradictions. "
                  "10 = all covered precisely; 5 = about half; 1 = unusable.")
        prompt = (f"Product request for the team that owns {m['what']}: \"{request}\"\n\n"
                  "Write the acceptance criteria an engineer and QA would work from. Cover the main behaviour, edge cases and failure cases, "
                  "and list open questions for anything the request leaves ambiguous. Respond with only JSON: "
                  "{\"acceptance_criteria\": [{\"id\": \"AC-1\", \"given\": ..., \"when\": ..., \"then\": ...}], \"open_questions\": [...]}.")
        reference = {"acceptance_criteria": [{"id": f"AC-{k + 1}", "given": "context", "when": "action", "then": x} for k, x in enumerate(must[:-1])],
                     "open_questions": [must[-1]]}
        cases.append({"id": f"requirements-{mod}-{rid}", "input": prompt, "tags": ["requirements", mod],
                      "scorers": [{"type": "json_schema", "weight": 1}, {"type": "llm_judge", "weight": 3, "params": {"rubric": rubric}}],
                      "vars": {"schema": AC_SCHEMA, "reference": json.dumps(reference)}})
    return cases


def build() -> dict[str, dict]:
    rng_for("software_delivery")  # all content is fixed; kept for symmetry with other generators
    common = {"dimension": "software_delivery"}
    return {
        "software_delivery/requirements.yaml": benchmark(
            "std-sdlc-requirements", common["dimension"], "Turn a product request into testable acceptance criteria and open questions (judge-graded).",
            requirements_cases(), pass_threshold=0.75),
        "software_delivery/implement.yaml": benchmark(
            "std-sdlc-implement", common["dimension"], "Implement a ticket in an existing module; hidden tests cover the feature, edge cases and regressions.",
            implement_cases()),
        "software_delivery/bugfix.yaml": benchmark(
            "std-sdlc-bugfix", common["dimension"], "Fix a reported bug from a failing test and real traceback; hidden tests cover related paths.",
            bugfix_cases()),
        "software_delivery/write_tests.yaml": benchmark(
            "std-sdlc-write-tests", common["dimension"], "Write tests that pass on correct code and catch hidden planted bugs (mutation score).",
            write_tests_cases(), pass_threshold=1.0),
        "software_delivery/review.yaml": benchmark(
            "std-sdlc-review", common["dimension"], "Review a pull request diff and locate planted defects by line and category.",
            review_cases(), pass_threshold=1.0),
    }

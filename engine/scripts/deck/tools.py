"""Tool calling: pick the right tool, resolve arguments (dates, codes, units), call in parallel, or abstain."""

from __future__ import annotations

from datetime import date, timedelta

from .common import benchmark, rng_for

TOOLS = [
    {"name": "get_weather", "description": "Current weather for a city.",
     "parameters": {"type": "object", "required": ["city", "unit"], "properties": {
         "city": {"type": "string", "description": "City name, e.g. Paris"},
         "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}}}},
    {"name": "convert_currency", "description": "Convert an amount between currencies at today's rate.",
     "parameters": {"type": "object", "required": ["amount", "from_currency", "to_currency"], "properties": {
         "amount": {"type": "number"},
         "from_currency": {"type": "string", "description": "ISO 4217 code, e.g. EUR"},
         "to_currency": {"type": "string", "description": "ISO 4217 code, e.g. USD"}}}},
    {"name": "create_event", "description": "Create a calendar event.",
     "parameters": {"type": "object", "required": ["title", "date", "start_time", "duration_minutes"], "properties": {
         "title": {"type": "string"}, "date": {"type": "string", "description": "YYYY-MM-DD"},
         "start_time": {"type": "string", "description": "24-hour HH:MM"}, "duration_minutes": {"type": "integer"}}}},
    {"name": "search_flights", "description": "Search flights between two airports.",
     "parameters": {"type": "object", "required": ["origin", "destination", "date", "passengers", "cabin"], "properties": {
         "origin": {"type": "string", "description": "IATA airport code"}, "destination": {"type": "string", "description": "IATA airport code"},
         "date": {"type": "string", "description": "YYYY-MM-DD"}, "passengers": {"type": "integer"},
         "cabin": {"type": "string", "enum": ["economy", "premium_economy", "business"]}}}},
    {"name": "get_stock_price", "description": "Latest price for a stock ticker.",
     "parameters": {"type": "object", "required": ["ticker"], "properties": {"ticker": {"type": "string", "description": "e.g. AAPL"}}}},
    {"name": "lookup_order", "description": "Fetch an order's status by its id.",
     "parameters": {"type": "object", "required": ["order_id"], "properties": {"order_id": {"type": "string"}}}},
    {"name": "send_email", "description": "Send an email.",
     "parameters": {"type": "object", "required": ["to", "subject", "body"], "properties": {
         "to": {"type": "string"}, "subject": {"type": "string"}, "body": {"type": "string"}}}},
]

CURRENCY_NAMES = [("yen", "JPY"), ("euros", "EUR"), ("US dollars", "USD"), ("pounds sterling", "GBP"), ("Swiss francs", "CHF"),
                  ("Canadian dollars", "CAD"), ("Australian dollars", "AUD"), ("Mexican pesos", "MXN"), ("Indian rupees", "INR")]
CITIES = ["Paris", "Tokyo", "Nairobi", "Lima", "Oslo", "Seoul", "Cape Town", "Montreal", "Hanoi", "Reykjavik"]
AIRPORTS = [("Lisbon", "LIS"), ("Boston", "BOS"), ("Frankfurt", "FRA"), ("Singapore", "SIN"), ("Madrid", "MAD"),
            ("Toronto", "YYZ"), ("Dubai", "DXB"), ("Sydney", "SYD"), ("Chicago O'Hare", "ORD"), ("Amsterdam", "AMS")]
TICKERS = [("Apple", "AAPL"), ("Microsoft", "MSFT"), ("Nvidia", "NVDA"), ("Alphabet", "GOOGL"), ("Amazon", "AMZN"), ("Netflix", "NFLX")]
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _today(rng) -> date:
    return date(2026, 1, 5) + timedelta(days=rng.randrange(360))


def _call(name, **args):
    return {"name": name, "arguments": args}


def relative_event(rng, today):
    kind = rng.randrange(4)
    if kind == 0:
        target = rng.choice([d for d in range(7) if d != today.weekday()])  # same weekday would be ambiguous
        delta = (target - today.weekday()) % 7
        phrase, d = f"this coming {WEEKDAYS[target]}", today + timedelta(days=delta)
    elif kind == 1:
        n = rng.randint(9, 40)
        phrase, d = f"{n} days from today", today + timedelta(days=n)
    elif kind == 2:
        nxt = date(today.year + (today.month == 12), today.month % 12 + 1, 1)
        phrase, d = "on the last day of this month", nxt - timedelta(days=1)
        if d == today:
            phrase, d = "tomorrow", today + timedelta(days=1)
    else:
        phrase, d = "two weeks from tomorrow", today + timedelta(days=15)
    h, m = rng.randint(7, 19), rng.choice([0, 15, 30, 45])
    dur = rng.choice([25, 30, 45, 50, 60, 90, 120])
    title = rng.choice(["Design sync", "Dentist", "1:1 with Mara", "Budget review", "Pottery class", "Car service"])
    ampm = f"{h - 12 if h > 12 else h}:{m:02d} {'pm' if h >= 12 else 'am'}"
    hours = f"{dur // 60}h{dur % 60:02d}" if dur >= 60 else f"{dur} minutes"
    text = f"Put \"{title}\" in my calendar {phrase} at {ampm}, lasting {hours}."
    return text, _call("create_event", title=title, date=d.isoformat(), start_time=f"{h:02d}:{m:02d}", duration_minutes=dur)


def conversion(rng, today):
    (fn, fc), (tn, tc) = rng.sample(CURRENCY_NAMES, 2)
    amount = rng.choice([45, 120, 2500, 999.99, 18000, 75.5, 3200])
    text = rng.choice([f"How much is {amount:,} {fn} in {tn}?", f"Convert {amount:,} {fn} to {tn} for me.",
                       f"I'm paying {amount:,} {fn} — what's that in {tn}?"])
    return text, _call("convert_currency", amount=amount, from_currency=fc, to_currency=tc)


def parallel(rng, today):
    if rng.random() < 0.5:
        a, b = rng.sample(CITIES, 2)
        unit = rng.choice(["celsius", "fahrenheit"])
        text = f"What's the weather like right now in {a} and in {b}? Give me {unit.capitalize()}."
        return text, [_call("get_weather", city=a, unit=unit), _call("get_weather", city=b, unit=unit)]
    (n1, t1), (n2, t2), (n3, t3) = rng.sample(TICKERS, 3)
    text = f"Quick check on {n1}, {n2} and {n3} stock prices please."
    return text, [_call("get_stock_price", ticker=t) for t in (t1, t2, t3)]


def flights(rng, today):
    (oc, o), (dc, dcode) = rng.sample(AIRPORTS, 2)
    d = today + timedelta(days=rng.randint(10, 120))
    adults, kids = rng.randint(1, 3), rng.randint(0, 2)
    cabin = rng.choice([("economy", "economy"), ("business class", "business"), ("premium economy", "premium_economy")])
    who = f"{adults} adult{'s' if adults > 1 else ''}" + (f" and {kids} child{'ren' if kids > 1 else ''}" if kids else "")
    text = f"Find {cabin[0]} flights from {oc} ({o}) to {dc} ({dcode}) on {d:%d %B %Y} for {who}."
    return text, _call("search_flights", origin=o, destination=dcode, date=d.isoformat(), passengers=adults + kids, cabin=cabin[1])


def lookup(rng, today):
    oid = f"A{rng.randint(10, 99)}-{rng.randint(100000, 999999)}"
    old = f"A{rng.randint(10, 99)}-{rng.randint(100000, 999999)}"
    text = rng.choice([f"My last order {old} arrived fine, but where is {oid}? It's late.",
                       f"Can you check order {oid}? (Not {old}, that one was refunded.)"])
    return text, _call("lookup_order", order_id=oid)


def email(rng, today):
    to = rng.choice(["finance@example.com", "maria.lopez@example.org", "ops-team@example.net"])
    subject = rng.choice(["Q2 invoice approval", "Server maintenance window", "Offsite dates confirmed"])
    text = f"Email {to} with the subject \"{subject}\" saying I'll send the details by Friday."
    return text, _call("send_email", to=to, subject=subject)


ABSTAIN = [
    "What is 15% of 80?",
    "Book me a hotel room in Rome for next weekend.",
    "Translate 'good morning' into Portuguese.",
    "What's the capital of Australia?",
    "Order me a pizza with mushrooms.",
    "Explain the difference between a stock and a bond in two sentences.",
    "Cancel my gym membership.",
    "Write a haiku about autumn.",
]


def build() -> dict[str, dict]:
    rng = rng_for("tool_calling")
    plan = ([relative_event] * 10 + [conversion] * 8 + [parallel] * 8 + [flights] * 7 + [lookup] * 3 + [email] * 3)
    cases = []
    for i, fn in enumerate(plan):
        today = _today(rng)
        text, expected = fn(rng, today)
        calls = expected if isinstance(expected, list) else [expected]
        cases.append({"id": f"{fn.__name__}-{i:02d}", "input": f"(Today is {today:%A, %d %B %Y}.)\n{text}", "expected": expected,
                      "tags": [fn.__name__], "vars": {"reference_tool_calls": calls}})
    for k, text in enumerate(ABSTAIN):
        today = _today(rng)
        cases.append({"id": f"abstain-{k:02d}", "input": f"(Today is {today:%A, %d %B %Y}.)\n{text}", "expected": "none",
                      "tags": ["abstain"], "vars": {"reference_tool_calls": []}})
    return {"tool_calling/generated.yaml": benchmark(
        "std-tool-routing", "tool_calling",
        "Generated tool use: relative-date resolution, currency names to ISO codes, parallel calls, flight search arguments, "
        "and requests where no available tool fits.",
        cases,
        system_prompt=("You are an assistant with tools. Call a tool when the request needs one; call several at once when the "
                       "request needs several. If no available tool fits, or none is needed, answer directly without calling any tool."),
        tools=TOOLS,
        scorers=[{"type": "tool_call"}],
    )}

"""Structured output: messy business text → schema-valid JSON, with deliberate traps in every document."""

from __future__ import annotations

import json
from datetime import date, timedelta

from .common import benchmark, rng_for

VENDORS = ["Nordlicht GmbH", "Atelier Fabre SARL", "Pinecrest Supply Co.", "Okabe Trading K.K.", "Lumen & Vale Ltd.",
           "Costa Verde Lda.", "Brightwater Analytics Inc.", "Kestrel Logistics AB"]
CURRENCIES = [("€", "EUR", "eu"), ("£", "GBP", "uk"), ("$", "USD", "us"), ("CHF ", "CHF", "eu"), ("¥", "JPY", "jp")]
CARRIERS = ["DHL Express", "UPS", "FedEx", "Royal Mail", "PostNL"]
CITIES = ["Lisbon", "Austin", "Toronto", "Berlin", "Singapore", "Leeds", "Melbourne", "Denver"]
PEOPLE = ["Priya Natarajan", "Tomasz Wójcik", "Amara Okafor", "Lucas Ferreira", "Hannah Lindqvist", "Kenji Mori", "Sofia Rossi"]
PRODUCTS = ["AirFlow 300 purifier", "Trailhead 2 backpack", "Quartz smart scale", "Nimbus desk fan", "Atlas e-reader"]


def fmt_money(x: float, style: str) -> str:
    if style == "eu":
        whole, frac = f"{x:,.2f}".split(".")
        return whole.replace(",", ".") + "," + frac
    if style == "jp":
        return f"{round(x):,}"
    return f"{x:,.2f}"


def fmt_date(d: date, rng) -> str:
    return rng.choice([
        f"{d.day} {d:%B %Y}", f"{d:%B} {d.day}, {d.year}", f"{d:%d/%m/%Y} (DD/MM/YYYY)", f"{d:%A} the {d.day}{_suffix(d.day)} of {d:%B %Y}",
    ])


def _suffix(n: int) -> str:
    return "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


ISO_DATE = {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"}


def invoice(rng, i):
    vendor = rng.choice(VENDORS)
    sym, code, style = rng.choice(CURRENCIES)
    issued = date(2026, 1, 5) + timedelta(days=rng.randrange(300))
    due = issued + timedelta(days=rng.choice([14, 30, 45]))
    net = round(rng.uniform(800, 48000), 0 if code == "JPY" else 2)
    vat = rng.choice([0, 7, 19, 20, 21, 23])
    total = round(net * (1 + vat / 100), 0 if code == "JPY" else 2)
    revised = rng.random() < 0.4
    final_total = round(total - rng.choice([50, 120, 300]), 0 if code == "JPY" else 2) if revised else total
    number = f"{rng.choice(['INV', 'RE', 'FAC', 'BILL'])}-{rng.randint(2026000, 2026999)}"
    text = (f"From: accounts@{vendor.split()[0].lower()}.example\nSubject: Invoice {number}\n\n"
            f"Please find our invoice {number}, issued {fmt_date(issued, rng)}.\n"
            f"Net amount {sym}{fmt_money(net, style)}; VAT {vat}%; total {sym}{fmt_money(total, style)}.\n"
            f"Payment terms: due {fmt_date(due, rng)}. Our previous invoice {number[:-3]}{rng.randint(100, 999)} has been settled, thank you.\n")
    if revised:
        text += f"\nUPDATE: after the agreed goodwill credit, the total now due is {sym}{fmt_money(final_total, style)}. Other details unchanged.\n"
    expected = {"vendor": vendor, "invoice_number": number, "issue_date": issued.isoformat(), "due_date": due.isoformat(),
                "total": final_total, "currency": code, "vat_rate": vat}
    schema = {"type": "object", "required": list(expected), "properties": {
        "vendor": {"type": "string"}, "invoice_number": {"type": "string"}, "issue_date": ISO_DATE, "due_date": ISO_DATE,
        "total": {"type": "number"}, "currency": {"type": "string", "pattern": "^[A-Z]{3}$"}, "vat_rate": {"type": "number"}}}
    note = "total = the amount currently due, after any corrections; vat_rate as a number of percent (e.g. 19)"
    return text, expected, schema, note


def shipping(rng, i):
    carrier = rng.choice(CARRIERS)
    tracking = "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789") for _ in range(12))
    shipped = date(2026, 2, 1) + timedelta(days=rng.randrange(300))
    eta = shipped + timedelta(days=rng.randint(2, 9))
    pounds = rng.random() < 0.5
    kg = round(rng.uniform(0.4, 38), 1)
    weight = f"{round(kg / 0.45359237, 1)} lb" if pounds else f"{kg} kg"
    kg_expected = round(round(kg / 0.45359237, 1) * 0.45359237, 1) if pounds else kg
    count = rng.randint(1, 6)
    text = (f"Your order is on its way! 📦\nCarrier: {carrier} — tracking no. {tracking}\n"
            f"Dispatched {fmt_date(shipped, rng)} in {count} {'parcel' if count == 1 else 'parcels'} (combined weight {weight}).\n"
            f"Originally expected {fmt_date(eta - timedelta(days=2), rng)}; due to a depot delay the new estimated delivery is {fmt_date(eta, rng)}.\n"
            f"Questions? Reply to this message, quoting order #{rng.randint(10000, 99999)}.")
    expected = {"carrier": carrier, "tracking_number": tracking, "ship_date": shipped.isoformat(),
                "estimated_delivery": eta.isoformat(), "package_count": count, "weight_kg": kg_expected}
    schema = {"type": "object", "required": list(expected), "properties": {
        "carrier": {"type": "string"}, "tracking_number": {"type": "string"}, "ship_date": ISO_DATE, "estimated_delivery": ISO_DATE,
        "package_count": {"type": "integer"}, "weight_kg": {"type": "number"}}}
    note = "estimated_delivery = the latest estimate; weight_kg in kilograms (1 lb = 0.45359237 kg), rounded to 1 decimal place"
    return text, expected, schema, note


def job(rng, i):
    title = rng.choice(["Senior Backend Engineer", "Product Designer", "Data Engineer", "Engineering Manager", "Site Reliability Engineer"])
    company = rng.choice(VENDORS)
    city = rng.choice(CITIES)
    remote = rng.choice(["fully remote", "hybrid", "on-site"])
    lo = rng.randrange(70, 160) * 1000
    hi = lo + rng.randrange(10, 50) * 1000
    sym, code, _ = rng.choice(CURRENCIES[:3])
    etype = rng.choice([("full-time", "full_time"), ("12-month contract", "contract"), ("part-time (24h/week)", "part_time")])
    text = (f"{company} is hiring! ✨\nRole: {title} ({etype[0]})\nLocation: {city} — {remote}"
            f"{' (2 office days a week)' if remote == 'hybrid' else ''}\n"
            f"Comp: {sym}{lo // 1000}k–{sym}{hi // 1000}k base + equity. Last year's posting said {sym}{(lo - 15000) // 1000}k, ignore that.\n"
            "Apply by sending a CV to careers@example.com.")
    expected = {"title": title, "company": company, "location": city, "remote": remote == "fully remote",
                "salary_min": lo, "salary_max": hi, "currency": code, "employment_type": etype[1]}
    schema = {"type": "object", "required": list(expected), "properties": {
        "title": {"type": "string"}, "company": {"type": "string"}, "location": {"type": "string"}, "remote": {"type": "boolean"},
        "salary_min": {"type": "integer"}, "salary_max": {"type": "integer"}, "currency": {"type": "string", "pattern": "^[A-Z]{3}$"},
        "employment_type": {"enum": ["full_time", "part_time", "contract"]}}}
    note = "location = city only; remote = true only if fully remote; salaries as whole numbers (e.g. 120000)"
    return text, expected, schema, note


def meeting(rng, i):
    organizer, other = rng.sample(PEOPLE, 2)
    d1 = date(2026, 3, 2) + timedelta(days=rng.randrange(250))
    d2 = d1 + timedelta(days=rng.randint(1, 6))
    h1, h2 = rng.randint(8, 16), rng.randint(8, 16)
    m2 = rng.choice([0, 15, 30, 45])
    dur = rng.choice([30, 45, 60, 90])
    tz = rng.choice(["CET", "UTC", "EST", "JST", "BST"])
    title = rng.choice(["Q3 roadmap review", "Vendor security assessment", "Hiring panel debrief", "Pricing experiment readout"])
    pm = h2 >= 12
    h12 = h2 - 12 if h2 > 12 else h2
    text = (f"From: {organizer}\nSubject: {title}\n\nHi all — let's meet {fmt_date(d1, rng)} at {h1}:00 {tz} for an hour.\n\n"
            f"---\nFrom: {other}\nThat clashes with the board call, can we move it?\n\n"
            f"---\nFrom: {organizer}\nSure. New time: {fmt_date(d2, rng)}, {h12}:{m2:02d} {'pm' if pm else 'am'} {tz}. "
            f"Let's keep it to {dur} minutes this time.")
    expected = {"title": title, "date": d2.isoformat(), "start_time": f"{h2:02d}:{m2:02d}", "duration_minutes": dur,
                "timezone": tz, "organizer": organizer}
    schema = {"type": "object", "required": list(expected), "properties": {
        "title": {"type": "string"}, "date": ISO_DATE, "start_time": {"type": "string", "pattern": r"^\d{2}:\d{2}$"},
        "duration_minutes": {"type": "integer"}, "timezone": {"type": "string"}, "organizer": {"type": "string"}}}
    note = "the final agreed meeting; start_time in 24-hour HH:MM; timezone as written (e.g. CET)"
    return text, expected, schema, note


def transaction(rng, i):
    sym, code, style = rng.choice(CURRENCIES[:4])
    amount = round(rng.uniform(4, 2400), 2)
    merchant = rng.choice(["BLUE BOTTLE COFFEE", "IKEA ALFAFAR", "TFL TRAVEL CH", "AMZN MKTP DE", "SHELL 0471"])
    last4 = f"{rng.randint(0, 9999):04d}"
    balance = round(rng.uniform(100, 9000), 2)
    d = date(2026, 1, 1) + timedelta(days=rng.randrange(330))
    refund = rng.random() < 0.3
    text = (f"Bank alert: card ending {last4} was {'credited with a refund of' if refund else 'charged'} {sym}{fmt_money(amount, style)} "
            f"at {merchant} on {d:%d %b}. Available balance: {sym}{fmt_money(balance, style)}. "
            f"Not you? Call us on 0800 {rng.randint(100, 999)} {rng.randint(1000, 9999)}. (Statement year {d.year}.)")
    expected = {"amount": amount if refund else -amount, "currency": code, "merchant": merchant, "card_last4": last4,
                "date": d.isoformat(), "balance_after": balance}
    schema = {"type": "object", "required": list(expected), "properties": {
        "amount": {"type": "number"}, "currency": {"type": "string", "pattern": "^[A-Z]{3}$"}, "merchant": {"type": "string"},
        "card_last4": {"type": "string", "pattern": r"^\d{4}$"}, "date": ISO_DATE, "balance_after": {"type": "number"}}}
    note = "amount is negative for a charge and positive for a refund; card_last4 as a 4-digit string"
    return text, expected, schema, note


def ticket(rng, i):
    name = rng.choice(PEOPLE)
    order = f"ORD-{rng.randint(100000, 999999)}"
    product = rng.choice(PRODUCTS)
    cat = rng.choice(["billing", "shipping", "defect", "account"])
    urgent = rng.random() < 0.4
    refund = rng.random() < 0.5
    issue = {
        "billing": "I was charged twice for the same order",
        "shipping": "the parcel has been stuck in transit for nine days",
        "defect": f"the {product.split()[0]} stopped working after a week",
        "account": "I can't log in since the password reset email never arrives",
    }[cat]
    text = (f"Hello, this is {name}. Re: order {order} ({product}). {issue.capitalize()}. "
            f"{'This is urgent — I need it sorted today. ' if urgent else ''}"
            f"{'I would like my money back.' if refund else 'Please just fix it, I do not want a refund.'} "
            f"(My previous order ORD-{rng.randint(100000, 999999)} was fine.)")
    expected = {"customer_name": name, "order_id": order, "product": product, "issue_category": cat,
                "refund_requested": refund, "priority": "high" if urgent else "normal"}
    schema = {"type": "object", "required": list(expected), "properties": {
        "customer_name": {"type": "string"}, "order_id": {"type": "string"}, "product": {"type": "string"},
        "issue_category": {"enum": ["billing", "shipping", "defect", "account"]}, "refund_requested": {"type": "boolean"},
        "priority": {"enum": ["normal", "high"]}}}
    note = "priority is high only if the customer says it is urgent; order_id = the order this ticket is about"
    return text, expected, schema, note


KINDS = [invoice, shipping, job, meeting, transaction, ticket]


def build() -> dict[str, dict]:
    rng = rng_for("structured_output")
    cases = []
    for i in range(48):
        kind = KINDS[i % len(KINDS)]
        text, expected, schema, note = kind(rng, i)
        prompt = f"Fields: {', '.join(expected)}.\nNotes: {note}.\n---\n{text}"
        cases.append({"id": f"{kind.__name__}-{i:02d}", "input": prompt, "expected": expected, "tags": [kind.__name__],
                      "vars": {"schema": schema, "reference": json.dumps(expected)}})
    return {"structured_output/generated.yaml": benchmark(
        "std-structured-traps", "structured_output",
        "Generated extraction from invoices, shipping notices, job ads, email threads, bank alerts and tickets, each with a trap "
        "(revisions, rescheduling, unit conversion, European number formats, decoy values).",
        cases,
        system_prompt=("Extract the requested fields from the text. Respond with only a JSON object (no prose). "
                       "Dates must be ISO YYYY-MM-DD. Currency must be an ISO 4217 code. Numbers must be JSON numbers."),
        scorers=[{"type": "json_schema"}],
    )}

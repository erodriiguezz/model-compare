"""Factuality: answer only from an invented document; say NOT IN DOCUMENT when it doesn't say."""

from __future__ import annotations

from datetime import date, timedelta

from .common import benchmark, rng_for

NOT_FOUND = "NOT IN DOCUMENT"


def _d(rng) -> date:
    return date(2026, 1, 1) + timedelta(days=rng.randrange(365))


def product_policy(rng):
    lite, pro = rng.sample(range(14, 61), 2)
    w_lite, w_pro = rng.sample([1, 2, 3, 5], 2)
    fee = rng.choice([9, 12, 15, 19])
    launch = _d(rng)
    support = rng.choice(["Odile Marchetti", "Kwame Asante", "Ingrid Solberg"])
    doc = (f"VELTRA HOME AIR — CUSTOMER POLICY (rev. {launch:%B %Y})\n\n"
           f"Veltra sells two purifiers: the Veltra Lite and the Veltra Pro. The Veltra Lite may be returned within {lite} days of delivery; "
           f"the Veltra Pro within {pro} days. Returns of opened units carry a restocking fee of {fee} euros, waived for defective units.\n"
           f"The Lite carries a {w_lite}-year limited warranty and the Pro a {w_pro}-year limited warranty, both covering the motor and sensors "
           f"but not filters. Replacement filters are sold separately.\n"
           f"Both models launched in the EU on {launch:%d %B %Y}. Escalations go to the head of customer care, {support}.\n"
           "Units bought from unauthorised resellers are not covered by this policy.")
    qa = [
        ("How many days does a customer have to return a Veltra Pro?", pro, "numeric"),
        ("How many days does a customer have to return a Veltra Lite?", lite, "numeric"),
        ("How long, in years, is the warranty on the Veltra Lite?", w_lite, "numeric"),
        ("What restocking fee, in euros, applies to an opened, non-defective return?", fee, "numeric"),
        ("On what date did the models launch in the EU? Give YYYY-MM-DD.", launch.isoformat(), "exact"),
        ("Who is the head of customer care?", support, "exact"),
        ("Does the warranty cover replacement filters? Answer yes or no.", "no", "exact"),
    ]
    unknown = ["What is the return window for the Veltra Max?", "How much does a replacement filter cost?",
               "When did the models launch in the UK? Give YYYY-MM-DD."]
    return doc, qa, unknown


def travel_policy(rng):
    hotel_cap, hotel_cap_hc = rng.sample(range(140, 320, 10), 2)
    per_diem = rng.choice([45, 55, 60, 70])
    advance = rng.choice([14, 21, 28])
    approver = rng.choice(["the department head", "the CFO", "the travel desk"])
    rail_limit = rng.choice([4, 5, 6])
    doc = ("NORTHWIND ROBOTICS — BUSINESS TRAVEL POLICY\n\n"
           f"Hotel stays are reimbursed up to {hotel_cap} US dollars per night, or up to {hotel_cap_hc} dollars per night in designated "
           f"high-cost cities (currently New York, London, Zurich and Tokyo). The meal per diem is {per_diem} dollars per day regardless of city.\n"
           f"International flights must be booked at least {advance} days before departure; exceptions require approval by {approver}.\n"
           f"Employees should take the train instead of flying for any journey under {rail_limit} hours by rail.\n"
           "Business class is permitted only on flights longer than 9 hours.")
    qa = [
        ("What is the nightly hotel limit in a city that is not designated high-cost, in dollars?", hotel_cap, "numeric"),
        ("What is the nightly hotel limit in Zurich, in dollars?", hotel_cap_hc, "numeric"),
        ("What is the daily meal per diem in London, in dollars?", per_diem, "numeric"),
        ("How many days in advance must international flights be booked?", advance, "numeric"),
        ("Under how many hours of rail travel should employees take the train?", rail_limit, "numeric"),
        ("Is business class allowed on a 7-hour flight? Answer yes or no.", "no", "exact"),
        ("Which city in this list is NOT designated high-cost: Tokyo, Paris, London?", "Paris", "exact"),
    ]
    unknown = ["What is the mileage reimbursement rate for personal cars?", "Who must approve a business-class upgrade on a 6-hour flight?",
               "What is the hotel limit in Singapore, in dollars?"]
    return doc, qa, unknown


def lab_protocol(rng):
    temp = rng.choice([4, 18, 22, 37])
    minutes = rng.choice([12, 20, 25, 40])
    rpm = rng.choice([3000, 4500, 6000])
    ratio = rng.choice([2, 3, 5])
    lead = rng.choice(["Dr. Anneli Virtanen", "Dr. Tobias Ehrlich", "Dr. Ramona Iordache"])
    doc = (f"PROTOCOL QX-7 — SAMPLE PREPARATION (owner: {lead})\n\n"
           f"1. Thaw samples at {temp} °C. Do not refreeze.\n"
           f"2. Mix buffer and sample at a {ratio}:1 ratio (buffer:sample).\n"
           f"3. Centrifuge at {rpm} rpm for {minutes} minutes. If the pellet is not visible, repeat once at the same settings.\n"
           "4. Discard any sample stored for more than 48 hours after thawing.\n"
           "5. Record lot numbers in the lab notebook before step 3.")
    qa = [
        ("At what temperature, in °C, are samples thawed?", temp, "numeric"),
        ("For how many minutes are samples centrifuged in step 3?", minutes, "numeric"),
        ("At how many rpm are samples centrifuged?", rpm, "numeric"),
        ("How many parts buffer are used per part sample?", ratio, "numeric"),
        ("Who owns protocol QX-7?", lead, "exact"),
        ("After how many hours post-thaw must a sample be discarded?", 48, "numeric"),
        ("What is the maximum number of centrifuge runs for one sample, including the repeat?", 2, "numeric"),
    ]
    unknown = ["What centrifuge model must be used?", "How long can buffer be stored after opening?",
               "At what temperature should the buffer be stored, in °C?"]
    return doc, qa, unknown


def sla(rng):
    uptime = rng.choice(["99.9", "99.95", "99.5"])
    credit_1, credit_2 = rng.sample([5, 10, 15, 25, 30], 2)
    p1 = rng.choice([15, 30, 60])
    p2 = rng.choice([4, 8, 12])
    claim = rng.choice([30, 45, 60])
    doc = ("CIRRUSDB MANAGED SERVICE — SERVICE LEVEL AGREEMENT\n\n"
           f"CirrusDB commits to {uptime}% monthly uptime for production clusters. Development clusters carry no uptime commitment.\n"
           f"If monthly uptime falls below the commitment, the customer receives a service credit of {credit_1}% of that month's fee; "
           f"below 99.0% the credit is {credit_2}%.\n"
           f"Priority 1 incidents receive a first response within {p1} minutes, 24/7. Priority 2 incidents receive a first response within "
           f"{p2} business hours.\nCredits must be claimed within {claim} days of the end of the affected month.")
    qa = [
        ("What monthly uptime percentage is committed for production clusters? Give the number only.", float(uptime), "numeric"),
        ("What service credit percentage applies if uptime is 98.7%?", credit_2, "numeric"),
        ("Within how many minutes do Priority 1 incidents get a first response?", p1, "numeric"),
        ("Within how many business hours do Priority 2 incidents get a first response?", p2, "numeric"),
        ("Within how many days must credits be claimed?", claim, "numeric"),
        ("What uptime commitment, as a percentage, applies to development clusters? Answer 0 if none.", 0, "numeric"),
        (f"What credit percentage applies if production uptime is between 99.0% and {uptime}%?", credit_1, "numeric"),
    ]
    unknown = ["What is the first-response time for Priority 3 incidents?", "What is the maximum total credit per year?",
               "In which regions are production clusters available?"]
    return doc, qa, unknown


def ordinance(rng):
    quiet_start, quiet_end = rng.choice([(22, 7), (23, 6), (21, 8)])
    fine_1, fine_2 = rng.sample(range(100, 900, 50), 2)
    permit = rng.choice([10, 15, 20])
    eff = _d(rng)
    doc = (f"CITY OF ALDERMOOR — NOISE ORDINANCE No. {rng.randint(100, 999)}\n\n"
           f"This ordinance takes effect on {eff:%d %B %Y}. Quiet hours run from {quiet_start}:00 to {quiet_end}:00 every day.\n"
           f"A first violation carries a fine of {fine_1} crowns; any repeat violation within twelve months carries a fine of {fine_2} crowns.\n"
           f"Construction outside permitted hours requires a permit requested at least {permit} working days in advance.\n"
           "Emergency repairs by utilities are exempt.")
    qa = [
        ("At what hour do quiet hours start? Give the hour on a 24-hour clock as a number.", quiet_start, "numeric"),
        ("At what hour do quiet hours end? Give the hour on a 24-hour clock as a number.", quiet_end, "numeric"),
        ("What is the fine, in crowns, for a first violation?", fine_1, "numeric"),
        ("What is the fine, in crowns, for a second violation eight months after the first?", fine_2, "numeric"),
        ("How many working days in advance must a construction permit be requested?", permit, "numeric"),
        ("On what date does the ordinance take effect? Give YYYY-MM-DD.", eff.isoformat(), "exact"),
        ("Are emergency repairs by utilities exempt? Answer yes or no.", "yes", "exact"),
    ]
    unknown = ["How much does a construction permit cost, in crowns?",
               "What decibel level counts as a violation?", "Who enforces the ordinance?"]
    return doc, qa, unknown


def onboarding(rng):
    laptop_days = rng.choice([2, 3, 5])
    buddy_weeks = rng.choice([4, 6, 8])
    review_day = rng.choice([30, 60, 90])
    stipend = rng.choice([300, 450, 600])
    contact = rng.choice(["Beatriz Moura", "Felix Hartmann", "Aiko Shimizu"])
    doc = ("PELICAN LABS — NEW STARTER GUIDE\n\n"
           f"Laptops are shipped to arrive {laptop_days} working days before your start date. Every new starter is paired with a buddy "
           f"for their first {buddy_weeks} weeks. Your first formal check-in with your manager happens on day {review_day}.\n"
           f"A one-off home-office stipend of {stipend} euros is paid with your first salary. For anything about onboarding, contact {contact} in People Ops.")
    qa = [
        ("How many working days before the start date should the laptop arrive?", laptop_days, "numeric"),
        ("For how many weeks does the buddy pairing last?", buddy_weeks, "numeric"),
        ("On which day is the first formal manager check-in?", review_day, "numeric"),
        ("How large is the home-office stipend, in euros?", stipend, "numeric"),
        ("Who in People Ops handles onboarding questions?", contact, "exact"),
        ("Is the stipend paid every month? Answer yes or no.", "no", "exact"),
        ("Does the laptop arrive before or after the start date? Answer before or after.", "before", "exact"),
    ]
    unknown = ["How many vacation days do new starters get?", "Which laptop model is provided?", "Where is the Pelican Labs head office?"]
    return doc, qa, unknown


DOCS = [product_policy, travel_policy, lab_protocol, sla, ordinance, onboarding]


def build() -> dict[str, dict]:
    rng = rng_for("factuality")
    documents, cases = {}, []
    for fn in DOCS:
        doc, qa, unknown = fn(rng)
        key = fn.__name__
        documents[key] = doc
        for k, (q, a, scorer) in enumerate(qa):
            cases.append({"id": f"{key}-{k}", "document": key, "input": q, "expected": a, "scorers": [{"type": scorer}],
                          "tags": ["answerable"], "vars": {"reference": f"ANSWER: {a}"}})
        for k, q in enumerate(unknown):
            cases.append({"id": f"{key}-unknown-{k}", "document": key, "input": q, "expected": NOT_FOUND, "scorers": [{"type": "exact"}],
                          "tags": ["unanswerable"], "vars": {"reference": f"ANSWER: {NOT_FOUND}"}})
    return {"factuality/generated.yaml": benchmark(
        "std-grounded-answers", "factuality",
        "Questions about invented documents (prior knowledge can't help); 30% are not answered by the document and must be declined.",
        cases,
        system_prompt=("Answer the question using only the document above. If the document does not contain the answer, "
                       f"reply exactly `ANSWER: {NOT_FOUND}`. Otherwise give just the value — a number without units, a name, "
                       "yes/no, or a date as YYYY-MM-DD — on a final line of the form `ANSWER: <value>`."),
        documents=documents,
    )}

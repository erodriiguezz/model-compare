"""Summarization: keep the key facts, obey length and format limits, and invent no numbers."""

from __future__ import annotations

import re

from modelcompare.scorers.deterministic import _check, _numbers

from .common import benchmark, rng_for

PEOPLE = ["Marta Silva", "Jonas Weber", "Aisha Bello", "Pavel Novak", "Grace Kim", "Luis Ortega", "Hana Sato", "Tom Reilly"]
FILLER = [
    "Several people joined the call late because the bridge link in the calendar invite was outdated.",
    "The team noted that documentation for this area had not been reviewed in some time.",
    "Some discussion followed about naming conventions, but no decision was needed.",
    "Attendees thanked the on-call staff for their patience during a long evening.",
    "A side conversation about dashboard colours was moved to a separate thread.",
    "It was agreed that the meeting notes would be shared in the usual channel.",
    "Questions from the sales team were collected and will be answered separately.",
    "The group briefly revisited last month's discussion about tooling, without new conclusions.",
]


def incident(rng):
    service = rng.choice(["checkout API", "login service", "search cluster", "notification queue", "billing exporter"])
    cause = rng.choice([("an expired TLS certificate", ["certificate"]), ("a database connection pool limit", ["connection pool"]),
                        ("a bad configuration push", ["configuration"]), ("a full disk on the primary node", ["disk"])])
    minutes = rng.randint(35, 240)
    customers = rng.randint(300, 9000)
    owner = rng.choice(PEOPLE)
    action = rng.choice(["add expiry alerts", "load-test the new limits", "require review for config pushes", "add disk usage paging"])
    text = (f"Postmortem: {service} outage.\nOn the evening of the incident the {service} returned errors for {minutes} minutes. "
            f"Roughly {customers} customers were affected. The root cause was {cause[0]}. "
            f"The issue was first noticed by a customer report rather than by monitoring, which delayed the response by about 20 minutes. "
            f"{rng.choice(FILLER)} {rng.choice(FILLER)} Engineers restored service by rolling back and restarting the affected nodes. "
            f"Follow-up: {owner} will {action} by the end of the quarter. {rng.choice(FILLER)}")
    must = [[*cause[1]], [str(customers), f"{customers:,}"], [str(minutes)], [owner.split()[0], owner]]
    ref = [f"- The {service} failed for {minutes} minutes because of {cause[0]}.",
           f"- About {customers} customers were affected and a customer report caught it before monitoring did.",
           f"- {owner} will {action} by the end of the quarter."]
    return text, must, ref


def quarterly(rng):
    revenue = rng.randint(12, 90)
    growth = rng.randint(3, 40)
    churn = rng.choice(["1.8", "2.4", "3.1", "4.6"])
    launch = rng.choice(["the Teams plan", "the mobile app", "SSO for enterprise", "usage-based pricing"])
    decision = rng.choice(["pause hiring in sales", "double the support team", "enter the German market", "sunset the legacy API"])
    ceo = rng.choice(PEOPLE)
    text = (f"Quarterly update from {ceo}.\nRevenue reached {revenue} million euros this quarter, up {growth}% on the previous quarter. "
            f"Monthly churn was {churn}%. The biggest launch was {launch}, which drove most new sign-ups. {rng.choice(FILLER)} "
            f"Hiring stayed broadly on plan. {rng.choice(FILLER)} After a long debate the leadership team decided to {decision} next quarter. "
            f"{rng.choice(FILLER)}")
    must = [[f"{revenue} million"], [f"{growth}%", f"{growth} %", f"{growth} percent"], [f"{churn}%", f"{churn} %", f"{churn} percent"],
            [decision.split()[0] + " " + decision.split()[1], decision]]
    ref = [f"- Revenue hit {revenue} million euros, up {growth}% quarter on quarter, with churn at {churn}%.",
           f"- {launch[0].upper() + launch[1:]} was the main growth driver.",
           f"- Next quarter the company will {decision}."]
    return text, must, ref


def research(rng):
    n = rng.randint(12, 40)
    pain = rng.choice([("exporting reports", ["export"]), ("setting up integrations", ["integration"]),
                       ("understanding the bill", ["bill"]), ("finding old projects", ["finding old projects", "search"])])
    pct = rng.randint(40, 85)
    rec = rng.choice(["a guided setup wizard", "a scheduled export feature", "an itemised invoice view", "full-text project search"])
    lead = rng.choice(PEOPLE)
    text = (f"Research readout by {lead}.\nWe interviewed {n} customers over three weeks. The most common frustration was {pain[0]}, "
            f"raised by {pct}% of participants. Several described workarounds involving spreadsheets. {rng.choice(FILLER)} "
            f"Secondary themes were pricing clarity and onboarding speed, each raised by a minority. {rng.choice(FILLER)} "
            f"Our recommendation is to build {rec} before anything else on the roadmap. {rng.choice(FILLER)}")
    must = [[str(n)], [*pain[1]], [f"{pct}%", f"{pct} %", f"{pct} percent"], [rec.split()[-1], rec]]
    ref = [f"- {n} customers were interviewed.", f"- The top frustration was {pain[0]}, raised by {pct}% of them.",
           f"- Recommendation: build {rec} first."]
    return text, must, ref


def vendor(rng):
    vendors = rng.sample(["Acorn Cloud", "Bluefin Hosting", "Corvid Systems", "Dovetail IT"], 3)
    chosen = vendors[0]
    price = rng.randint(20, 95) * 1000
    years = rng.choice([1, 2, 3])
    reason = rng.choice(["the strongest security certifications", "the best support response times", "the lowest migration risk"])
    text = (f"Vendor selection memo.\nWe evaluated {', '.join(vendors)}. {vendors[1]} was cheapest but could not meet our data residency "
            f"requirements. {vendors[2]} offered good features but had poor references. {rng.choice(FILLER)} "
            f"We selected {chosen} for {reason}, at {price} euros per year on a {years}-year contract. {rng.choice(FILLER)}")
    must = [[chosen], [str(price), f"{price:,}", f"{price // 1000}k", f"{price // 1000},000"], [f"{years}-year", f"{years} year"],
            [vendors[1]]]
    ref = [f"- {chosen} was selected for {reason}.", f"- Cost: {price} euros per year on a {years}-year contract.",
           f"- {vendors[1]} was rejected over data residency and {vendors[2]} over poor references."]
    return text, must, ref


KINDS = [incident, quarterly, research, vendor]


def build() -> dict[str, dict]:
    rng = rng_for("summarization")
    cases = []
    for i in range(60):
        kind = KINDS[i % len(KINDS)]
        text, must, ref_bullets = kind(rng)
        ref = "\n".join(ref_bullets)
        n_ref = len(re.findall(r"\b\w+\b", ref))
        max_words = n_ref + rng.randint(8, 25)
        checks = [{"type": "max_words", "value": max_words}, {"type": "bullet_count", "value": len(ref_bullets)}, {"type": "no_markdown"}]
        assert all(_check(ref, c) for c in checks), (i, ref)
        assert not (_numbers(ref) - _numbers(text)), (i, _numbers(ref) - _numbers(text))
        prompt = (f"Summarise the document below for an executive in exactly {len(ref_bullets)} bullet points, each starting with \"- \", "
                  f"using at most {max_words} words in total. Keep the facts that matter most (causes, numbers, decisions, owners). "
                  f"Do not use bold or headings, and do not introduce any number that is not in the document.\n\n---\n{text}")
        cases.append({"id": f"{kind.__name__}-{i:02d}", "input": prompt, "tags": [kind.__name__],
                      "vars": {"must_include": must, "checks": checks, "source": text, "reference": ref}})
    return {"summarization/generated.yaml": benchmark(
        "std-exec-summaries", "summarization",
        "Generated postmortems, quarterly updates, research readouts and vendor memos: keep the key facts, respect the length "
        "and bullet format, invent no numbers.",
        cases,
        scorers=[{"type": "contains", "weight": 2}, {"type": "instructions"}, {"type": "no_new_numbers"}],
    )}

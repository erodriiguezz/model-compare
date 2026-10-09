"""Long context: an internal operations log of 8k–48k tokens with lookups, decoys, sums, counts and recency."""

from __future__ import annotations

from datetime import date, timedelta

from .common import ANSWER_LINE, benchmark, rng_for

ADJ = ["Amber", "Basalt", "Cobalt", "Dune", "Ember", "Fjord", "Granite", "Harbor", "Indigo", "Juniper", "Krypton", "Lumen",
       "Maple", "Nova", "Onyx", "Pebble", "Quill", "Raven", "Sable", "Tundra", "Umber", "Vesper", "Willow", "Zephyr"]
NOUN = ["Falcon", "Bridge", "Lantern", "Orchard", "Compass", "Harvest", "Signal", "Meadow", "Atlas", "Beacon", "Canyon", "Delta"]
PEOPLE = ["Rosa Delgado", "Ivan Petrov", "Mei Lin", "Samuel Adeyemi", "Clara Becker", "Omar Haddad", "Yuki Tanaka",
          "Nora Kowalski", "Diego Alvarez", "Freya Nilsson", "Arjun Mehta", "Leah Goldberg"]
TEAMS = ["Platform", "Payments", "Mobile", "Data", "Identity", "Search", "Billing", "Infra"]
CITIES = ["Lisbon", "Oslo", "Lyon", "Porto", "Bergen", "Ghent", "Turin", "Graz"]
STATUSES = ["on track", "at risk", "blocked", "complete"]
FILLER = [
    "The {team} team reminded everyone that change requests must be filed at least {n} working days before a release window.",
    "Facilities confirmed that the {city} office will run reduced heating on weekends from {month} onwards.",
    "A reminder that expense reports above {n}00 euros need a second approver from Finance.",
    "The {team} guild meets every other Thursday; notes are kept in the shared drive under '{team} guild / {month}'.",
    "Security training completion stands at {n}% company-wide; managers should follow up with their reports.",
    "Laptop refreshes for the {city} office are scheduled in batches of {n}; IT will email each batch a week ahead.",
    "The style guide now prefers sentence case for headings and discourages acronyms in customer-facing copy.",
    "On-call handover happens at 09:00 local time; the outgoing engineer posts a summary in the {team} channel.",
]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
SIZES = [8_000, 8_000, 8_000, 16_000, 16_000, 16_000, 32_000, 32_000, 32_000, 48_000, 48_000, 48_000]  # approx tokens


def make_doc(rng, k: int, tokens: int):
    pool = [f"{a} {n}" for a in ADJ for n in NOUN]
    names = rng.sample(pool, len(pool))  # unique project names; long docs fall back to other entries once used up
    projects, incidents, blocks = [], [], []
    start = date(2025, 1, 1)
    target_chars = tokens * 4
    size = 0
    while size < target_chars:
        r = rng.random()
        if r < 0.35 and names:
            p = {"name": names.pop(), "code": f"PX-{rng.randint(100, 999)}", "owner": rng.choice(PEOPLE),
                 "budget": rng.randrange(20, 900) * 1000, "status": rng.choice(STATUSES),
                 "updated": start + timedelta(days=rng.randrange(600))}
            projects.append(p)
            text = (f"Project {p['name']} (code {p['code']}): owner {p['owner']}; approved budget ${p['budget']:,}; "
                    f"status {p['status']}; last updated {p['updated']:%d %B %Y}.")
        elif r < 0.6:
            inc = {"n": len(incidents) + 1000 + rng.randrange(5), "team": rng.choice(TEAMS), "sev": rng.choice([1, 2, 2, 3, 3, 3]),
                   "date": start + timedelta(days=rng.randrange(600))}
            incidents.append(inc)
            text = (f"Incident #{inc['n'] + len(incidents)} logged {inc['date']:%d %B %Y} by the {inc['team']} team, "
                    f"severity {inc['sev']}: {rng.choice(['elevated error rates', 'a failed deploy', 'slow queries', 'an expired certificate', 'a queue backlog'])}"
                    f", resolved after {rng.randint(10, 300)} minutes.")
        else:
            text = rng.choice(FILLER).format(team=rng.choice(TEAMS), city=rng.choice(CITIES), n=rng.randint(2, 97), month=rng.choice(MONTHS))
        blocks.append(text)
        size += len(text) + 1

    # One true needle and two decoys at different depths.
    city, *decoys = rng.sample(CITIES, 3)
    code = f"{rng.randint(1000, 9999)}"
    needle_at = rng.randrange(len(blocks))
    blocks.insert(needle_at, f"Note from Facilities: the door code for the {city} archive room is now {code}.")
    for d in decoys:
        blocks.insert(rng.randrange(len(blocks)), f"Note from Facilities: the door code for the {d} archive room is now {rng.randint(1000, 9999)}.")

    doc = (f"HALVORSEN INSTRUMENTS — OPERATIONS LOG (document {k + 1})\n"
           "Entries are in no particular order. Projects, incidents and notices are interleaved.\n\n" + "\n".join(blocks))
    return doc, projects, incidents, city, code, needle_at / len(blocks)


def questions(rng, k, projects, incidents, city, code, depth):
    doc_id = f"log-{k:02d}"
    qs = []
    qs.append((f"What is the current door code for the {city} archive room?", code, "exact", "needle"))
    p = rng.choice(projects)
    qs.append((f"Who owns project {p['name']}? Give the full name.", p["owner"], "exact", "lookup"))
    owner_counts = {o: [x for x in projects if x["owner"] == o] for o in PEOPLE}
    owner = max(owner_counts, key=lambda o: (len(owner_counts[o]) if len(owner_counts[o]) <= 8 else 0, o))
    total = sum(x["budget"] for x in owner_counts[owner])
    qs.append((f"What is the combined approved budget, in dollars, of all projects owned by {owner}?", total, "numeric", "aggregate"))
    team = rng.choice(TEAMS)
    n_sev1 = sum(1 for i in incidents if i["team"] == team and i["sev"] == 1)
    qs.append((f"How many severity 1 incidents were logged by the {team} team?", n_sev1, "numeric", "count"))
    blocked = [x for x in projects if x["status"] == "blocked"]
    latest = max(blocked, key=lambda x: (x["updated"], x["name"]))
    tie = sum(1 for x in blocked if x["updated"] == latest["updated"])
    if tie > 1:
        latest = max(projects, key=lambda x: (x["updated"], x["name"]))
        qs.append(("Which project has the most recent 'last updated' date of all projects? Give the project name only.",
                   latest["name"], "exact", "recency"))
    else:
        qs.append(("Among projects with status 'blocked', which one was updated most recently? Give the project name only.",
                   latest["name"], "exact", "recency"))
    return [{"id": f"{doc_id}-{kind}", "document": doc_id, "input": f"Question about the log above: {q}", "expected": ans,
             "scorers": [{"type": scorer}], "tags": [kind, f"{SIZES[k] // 1000}k"],
             "vars": {"reference": f"ANSWER: {ans}", **({"needle_depth": round(depth, 2)} if kind == "needle" else {})}}
            for q, ans, scorer, kind in qs]


def build() -> dict[str, dict]:
    rng = rng_for("long_context")
    docs, cases = {}, []
    for k, tokens in enumerate(SIZES):
        doc, projects, incidents, city, code, depth = make_doc(rng, k, tokens)
        docs[f"log-{k:02d}"] = doc
        cases += questions(rng, k, projects, incidents, city, code, depth)
    return {"long_context/generated.yaml": benchmark(
        "std-long-ops-log", "long_context",
        "Generated operations logs of ~8k–48k tokens: needle lookup with decoys, record lookup, budget sums, incident counts, recency.",
        cases, system_prompt=f"Answer using only the document provided. {ANSWER_LINE}", documents=docs,
    )}

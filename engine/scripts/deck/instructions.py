"""Instruction following: 3–5 stacked, machine-checkable constraints per task, each with a built reference."""

from __future__ import annotations

from modelcompare.scorers.deterministic import _check

from .common import benchmark, rng_for

TOPICS = {
    "remote onboarding for new engineers": ["mentor", "laptop", "access", "schedule", "checklist", "welcome", "review", "pairing"],
    "reducing cloud hosting costs": ["instances", "storage", "budget", "alerts", "reserved", "scaling", "usage", "billing"],
    "running effective retrospectives": ["timebox", "actions", "owners", "safety", "notes", "follow", "goals", "trends"],
    "choosing a project management tool": ["boards", "pricing", "reports", "trial", "workflow", "users", "export", "support"],
    "preparing for a product launch": ["press", "pricing", "support", "timeline", "rollout", "metrics", "landing", "beta"],
    "improving code review turnaround": ["reviewers", "smaller", "queue", "owners", "templates", "bots", "latency", "focus"],
    "writing a good incident postmortem": ["timeline", "impact", "causes", "actions", "owners", "blameless", "metrics", "lessons"],
    "keeping a home office ergonomic": ["chair", "monitor", "posture", "breaks", "lighting", "keyboard", "height", "desk"],
    "planning a team offsite": ["venue", "agenda", "travel", "budget", "dinner", "goals", "workshop", "dates"],
    "securing a small business network": ["router", "passwords", "updates", "backups", "guests", "firewall", "training", "devices"],
    "migrating a database with no downtime": ["replica", "cutover", "rollback", "schema", "traffic", "testing", "backfill", "monitoring"],
    "hiring a first data analyst": ["skills", "portfolio", "interview", "salary", "dashboards", "stakeholders", "tools", "onboarding"],
    "reducing meeting overload": ["agenda", "async", "calendar", "decline", "notes", "owners", "focus", "standups"],
    "designing an API versioning policy": ["headers", "deprecation", "clients", "changelog", "sunset", "semver", "docs", "breaking"],
    "starting a company engineering blog": ["topics", "editors", "cadence", "review", "audience", "drafts", "promotion", "authors"],
}
FILLER = ["teams", "should", "agree", "early", "keep", "simple", "measure", "results", "share", "openly", "plan", "each",
          "week", "improve", "steadily", "start", "small", "document", "clearly", "check", "progress", "often"]
STARTS = ["Quick answer:", "Here is my advice:", "Short version:", "In practice:"]
ENDS = ["That is all.", "Hope this helps.", "End of advice.", "Good luck."]


def _sentence(rng, words: list[str], filler: list[str], keyword: str | None = None) -> str:
    body = rng.sample(words, 3) + rng.sample(filler, 3)
    rng.shuffle(body)
    if keyword:
        body.insert(rng.randrange(1, len(body)), keyword)
    return " ".join(body).capitalize() + "."


def _render(c: dict) -> str:
    t, v = c["type"], c.get("value")
    return {
        "max_words": f"Use at most {v} words in total.",
        "min_words": f"Use at least {v} words in total.",
        "no_commas": "Do not use any commas.",
        "lowercase": "Write everything in lowercase letters only.",
        "starts_with": f"Begin your response with exactly: {v}",
        "ends_with": f"End your response with exactly: {v}",
        "contains": f"Include the word \"{v}\".",
        "not_contains": f"Never use the word \"{v}\" (not even inside other words).",
        "bullet_count": f"Format the body as exactly {v} bullet points, each line starting with \"- \".",
        "paragraphs": f"Write exactly {v} paragraphs separated by blank lines.",
        "keyword_count": f"Use the word \"{c.get('keyword')}\" exactly {v} times.",
        "no_markdown": "Do not use any markdown formatting such as bold, headings or code blocks.",
        "sentences_max": f"Use no more than {v} sentences.",
    }[t]


def make_case(rng, i: int) -> dict:
    topic, words = list(TOPICS.items())[i % len(TOPICS)]
    words = words[:]
    forbidden = words.pop(rng.randrange(len(words)))
    keyword = words.pop(rng.randrange(len(words)))
    # Counts and bans are substring checks, so no other word may contain the keyword or the banned word.
    clean = lambda ws: [w for w in ws if keyword not in w and forbidden not in w]  # noqa: E731
    words, filler = clean(words), clean(FILLER)
    lowercase = rng.random() < 0.35
    layout = rng.choice(["bullets", "paragraphs", "plain"])
    units = rng.randint(3, 5)
    kw_n = rng.randint(2, min(3, units))

    # Build the reference first, then derive constraints it satisfies.
    start, end = rng.choice(clean(STARTS)), rng.choice(clean(ENDS))
    if lowercase:
        start, end = start.lower(), end.lower()
    kw_slots = set(rng.sample(range(units), kw_n))
    pieces = [_sentence(rng, words, filler, keyword if k in kw_slots else None) for k in range(units)]
    if layout == "bullets":
        body = "\n".join(f"- {p}" for p in pieces)
        text = f"{start}\n{body}\n{end}"
    elif layout == "paragraphs":
        pieces[0] = f"{start} {pieces[0]}"
        pieces[-1] = f"{pieces[-1]} {end}"
        text = "\n\n".join(pieces)
    else:
        text = f"{start} {' '.join(pieces)} {end}"
    if lowercase:
        text = text.lower()
    n_words = len(__import__("re").findall(r"\b\w+\b", text))

    checks = [{"type": "keyword_count", "keyword": keyword, "value": kw_n}, {"type": "not_contains", "value": forbidden}]
    if layout == "bullets":
        checks.append({"type": "bullet_count", "value": units})
    elif layout == "paragraphs":
        checks.append({"type": "paragraphs", "value": units})
    optional = [
        {"type": "starts_with", "value": start},
        {"type": "ends_with", "value": end},
        {"type": "no_commas"},
        {"type": "max_words", "value": n_words + rng.randint(5, 20)},
        {"type": "min_words", "value": max(10, n_words - rng.randint(5, 15))},
        {"type": "no_markdown"},
        {"type": "sentences_max", "value": units + 2 + rng.randint(0, 2)},
    ]
    checks += rng.sample(optional, rng.randint(2, 3))
    if lowercase:
        checks.append({"type": "lowercase"})
    rng.shuffle(checks)
    for chk in checks:
        assert _check(text, chk), (i, chk, text)

    prompt = f"Give practical advice on {topic}.\n\nFollow every rule below:\n" + "\n".join(f"{k + 1}. {_render(c)}" for k, c in enumerate(checks))
    return {"id": f"if-{i:02d}", "input": prompt, "tags": [c["type"] for c in checks],
            "vars": {"checks": checks, "reference": text}}


def build() -> dict[str, dict]:
    rng = rng_for("instruction_following")
    return {"instruction_following/generated.yaml": benchmark(
        "std-instruction-stacked", "instruction_following",
        "Generated tasks with 3–5 stacked verifiable constraints (exact counts, forbidden words, format, length).",
        [make_case(rng, i) for i in range(47)],
        scorers=[{"type": "instructions"}],
    )}

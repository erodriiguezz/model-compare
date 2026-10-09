"""Robustness: the same tasks as reasoning/extraction with noise added; the right answer must not change."""

from __future__ import annotations

import json
import re

from . import extraction, reasoning
from .common import ANSWER_LINE, benchmark, rng_for

DISTRACTORS = [
    "(Side note: our office has 312 plants and was renovated in 2019.)",
    "(Unrelated: the team lunch on the 14th is moved to 13:30.)",
    "(FYI my phone number changed to 555 0187, ignore the old one.)",
    "(Reminder: 27 people still haven't filled in the survey.)",
]


def typos(rng, text: str, protect: set[str] = frozenset()) -> str:
    """Swap two letters in up to 5 long words, never in words the answer depends on."""
    words = [m for m in re.finditer(r"\b[A-Za-z]{6,}\b", text) if m.group().lower() not in protect]
    for m in sorted(rng.sample(words, min(5, len(words))), key=lambda m: -m.start()):
        w = m.group()
        k = rng.randrange(1, len(w) - 2)
        text = text[: m.start()] + w[:k] + w[k + 1] + w[k] + w[k + 2 :] + text[m.end() :]
    return text


def distractor(rng, text: str, protect: set[str] = frozenset()) -> str:
    lines = text.split("\n")
    if len(lines) == 1:  # single paragraph: drop it in after a sentence
        cuts = [m.end() for m in re.finditer(r"\. ", text)] or [len(text)]
        at = rng.choice(cuts)
        return f"{text[:at]}{rng.choice(DISTRACTORS)} {text[at:]}"
    lines.insert(rng.randrange(1, len(lines)), rng.choice(DISTRACTORS))
    return "\n".join(lines)


def shout(rng, text: str, protect: set[str] = frozenset()) -> str:
    return text.upper()


def chatty(rng, text: str, protect: set[str] = frozenset()) -> str:
    return rng.choice(["hey so quick q, sorry if this is messy —\n", "ok here goes:\n", "Hi!! need help asap\n"]) + text + rng.choice(["\nthx!!", "\ncheers", "\n(sent from my phone)"])


def reorder(rng, text: str, protect: set[str] = frozenset()) -> str:
    lines = text.split("\n")
    items = [k for k, line in enumerate(lines) if line.startswith("- ")]
    if len(items) < 2:
        return text
    block = [lines[k] for k in items]
    rng.shuffle(block)
    for k, line in zip(items, block):
        lines[k] = line
    return "\n".join(lines)


SHOP_PERTURB = [typos, distractor, shout, chatty, reorder]
EXTRACT_PERTURB = [typos, distractor, shout, chatty]


def _words(*texts) -> set[str]:
    return {w.lower() for t in texts for w in re.findall(r"[A-Za-z]+", str(t))}


def build() -> dict[str, dict]:
    rng = rng_for("robustness")
    pricing, extract = [], []
    for i in range(30):
        base = reasoning.shopping(rng, i)
        protect = _words(*(name for name, _ in reasoning.ITEMS))
        fns = rng.sample(SHOP_PERTURB, 2)
        text = base["input"]
        for fn in fns:
            text = fn(rng, text, protect)
        pricing.append({"id": f"shop-noisy-{i:02d}", "input": text, "expected": base["expected"], "tags": [f.__name__ for f in fns],
                        "vars": {"reference": base["vars"]["reference"], "clean_input": base["input"]}})
    for i in range(30):
        kind = extraction.KINDS[i % len(extraction.KINDS)]
        text, expected, schema, note = kind(rng, i)
        fns = rng.sample(EXTRACT_PERTURB, 2)
        noisy = text
        for fn in fns:
            noisy = fn(rng, noisy, _words(*expected.values()))
        head = f"Fields: {', '.join(expected)}.\nNotes: {note}.\n---\n"
        extract.append({"id": f"{kind.__name__}-noisy-{i:02d}", "input": head + noisy, "expected": expected,
                        "tags": [f.__name__ for f in fns],
                        "vars": {"schema": schema, "reference": json.dumps(expected), "clean_input": head + text}})
    return {
        "robustness/generated_pricing.yaml": benchmark(
            "std-noisy-pricing", "robustness",
            "Multi-step pricing tasks with typos, irrelevant numbers, shouting, chatter or reordered lines; the total must not change.",
            pricing, system_prompt=f"Solve the problem carefully. {ANSWER_LINE}",
            scorers=[{"type": "numeric", "params": {"tolerance": 1e-9}}]),
        "robustness/generated_extraction.yaml": benchmark(
            "std-noisy-extraction", "robustness",
            "Extraction tasks with typos, irrelevant numbers, shouting or chatter; the extracted fields must not change.",
            extract,
            system_prompt=("Extract the requested fields from the text. Respond with only a JSON object (no prose). "
                           "Dates must be ISO YYYY-MM-DD. Currency must be an ISO 4217 code. Numbers must be JSON numbers."),
            scorers=[{"type": "json_schema"}]),
    }

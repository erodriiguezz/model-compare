"""Generate the seeded parts of the standard deck.

    cd engine && .venv/bin/python scripts/generate_deck.py          # write files
    cd engine && .venv/bin/python scripts/generate_deck.py --check  # exit 1 if committed files are stale

Every generated case carries `vars.reference`, a perfect answer; tests/test_standard_deck_answers.py
checks that each reference scores 1.0, so a failing model is the model's fault, not the deck's.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deck import GENERATORS  # noqa: E402
from deck.common import STANDARD, dump  # noqa: E402


def render() -> dict[Path, str]:
    out: dict[Path, str] = {}
    for gen in GENERATORS:
        for rel, bench in gen().items():
            out[STANDARD / rel] = dump(bench)
    return out


def main(argv: list[str]) -> int:
    files = render()
    if "--check" in argv:
        stale = [str(p.relative_to(STANDARD)) for p, text in files.items() if not p.exists() or p.read_text() != text]
        if stale:
            print("stale generated files (re-run scripts/generate_deck.py):", *stale, sep="\n  ")
            return 1
        return 0
    for p, text in files.items():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        print(f"wrote {p.relative_to(STANDARD)}  ({len(text) / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

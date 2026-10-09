"""Validate the standard deck itself: reference answers must score 1.0, so a failing model is the model's fault."""

import pytest

from modelcompare.bench_loader import resolve_benchmarks
from modelcompare.runner import score_case
from modelcompare.schema import Completion
from modelcompare.scorers import ScoreContext

BENCH = {b.name: b for b in resolve_benchmarks(["standard"])}

CODING_REFERENCE = {
    "palindrome": """
def is_palindrome(s):
    t = [c.lower() for c in s if c.isalnum()]
    return t == t[::-1]
""",
    "merge-intervals": """
def merge_intervals(intervals):
    out = []
    for s, e in sorted(intervals):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out
""",
    "roman": """
def roman_to_int(s):
    v = dict(I=1, V=5, X=10, L=50, C=100, D=500, M=1000)
    total = 0
    for i, ch in enumerate(s):
        if i + 1 < len(s) and v[ch] < v[s[i + 1]]:
            total -= v[ch]
        else:
            total += v[ch]
    return total
""",
    "flatten": """
def flatten(nested):
    out = []
    for x in nested:
        out.extend(flatten(x) if isinstance(x, list) else [x])
    return out
""",
    "top-k": """
from collections import Counter
def top_k_frequent(words, k):
    c = Counter(words)
    return sorted(c, key=lambda w: (-c[w], w))[:k]
""",
    "parse-duration": """
import re
def parse_duration(s):
    m = re.fullmatch(r'(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?', s)
    h, mi, se = (int(x or 0) for x in m.groups())
    return h * 3600 + mi * 60 + se
""",
    "lru-cache": """
from collections import OrderedDict
class LRUCache:
    def __init__(self, capacity):
        self.cap, self.d = capacity, OrderedDict()
    def get(self, key):
        if key not in self.d:
            return -1
        self.d.move_to_end(key)
        return self.d[key]
    def put(self, key, value):
        self.d[key] = value
        self.d.move_to_end(key)
        if len(self.d) > self.cap:
            self.d.popitem(last=False)
""",
    "balanced": """
def balanced(s):
    pairs, stack = {')': '(', ']': '[', '}': '{'}, []
    for ch in s:
        if ch in '([{':
            stack.append(ch)
        elif ch in pairs:
            if not stack or stack.pop() != pairs[ch]:
                return False
    return not stack
""",
    "levenshtein": """
def levenshtein(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]
""",
    "camel-to-snake": """
import re
def camel_to_snake(s):
    s = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\\1_\\2', s)
    s = re.sub(r'([a-z0-9])([A-Z])', r'\\1_\\2', s)
    return s.lower()
""",
    "word-wrap": """
def word_wrap(text, width):
    lines, cur = [], ''
    for w in text.split():
        if not cur:
            cur = w
        elif len(cur) + 1 + len(w) <= width:
            cur += ' ' + w
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines
""",
    "spiral": """
def spiral(matrix):
    out, m = [], [row[:] for row in matrix]
    while m:
        out += m.pop(0)
        m = [list(r) for r in zip(*m)][::-1]
    return out
""",
}

INSTRUCTION_REFERENCE = {
    "bullets-no-commas": "- It is vast\n- It is deep\n- It is salty",
    "lowercase-haiku": "dark roast in the cup\nsteam curls into morning light\nthe day starts to hum",
    "api-short": "An API is a set of rules that lets one program request data or actions from another program.",
    "two-paragraphs": "Remote work removes the commute.\n\nIt also demands discipline. That is all.",
    "raw-json": '{"name": "Ada Vale", "age": 34}',
    "five-fruits": "- apple\n- banana\n- cherry\n- mango\n- pear",
    "caps-tagline": "RUN FARTHER THAN YESTERDAY",
    "starts-yes": "Yes, Python checks types at runtime rather than at compile time.",
    "keyword-count": "A bicycle has a front wheel and a rear wheel. Keep each wheel true and the ride stays smooth.",
    "word-range-no-md": " ".join(["Regular exercise strengthens the heart and lungs, improves mood, and helps sleep."] * 7),
    "one-word": "PARIS",
    "no-letter-z": "The moon orbits Earth. It has no air. Its craters are ancient.",
    "quoted": '"An octopus has three hearts."',
}

TOOL_REFERENCE = {
    c.id: ([] if c.expected == "none" else (c.expected if isinstance(c.expected, list) else [c.expected]))
    for c in BENCH["std-tool-calling"].cases
}


async def _score(bench_name, case, completion):
    b = BENCH[bench_name]
    _, s = await score_case(completion, case, b, ScoreContext())
    return s


@pytest.mark.parametrize("case", BENCH["std-coding-python"].cases, ids=lambda c: c.id)
async def test_coding_reference_solutions_pass(case):
    text = f"```python\n{CODING_REFERENCE[case.id]}\n```"
    assert await _score("std-coding-python", case, Completion(text=text)) == 1.0


@pytest.mark.parametrize("case", BENCH["std-instruction-following"].cases, ids=lambda c: c.id)
async def test_instruction_references_pass(case):
    assert await _score("std-instruction-following", case, Completion(text=INSTRUCTION_REFERENCE[case.id])) == 1.0


@pytest.mark.parametrize("case", BENCH["std-reasoning-math"].cases, ids=lambda c: c.id)
async def test_reasoning_answers_parse(case):
    assert await _score("std-reasoning-math", case, Completion(text=f"work...\nANSWER: {case.expected}")) == 1.0


@pytest.mark.parametrize("case", BENCH["std-tool-calling"].cases, ids=lambda c: c.id)
async def test_tool_reference_calls_pass(case):
    assert await _score("std-tool-calling", case, Completion(tool_calls=TOOL_REFERENCE[case.id])) == 1.0


@pytest.mark.parametrize("case", BENCH["std-structured-extraction"].cases, ids=lambda c: c.id)
async def test_extraction_expected_is_schema_valid(case):
    import json

    assert await _score("std-structured-extraction", case, Completion(text=json.dumps(case.expected))) == 1.0


# --- Generated deck (scripts/generate_deck.py): every case carries its own perfect answer ---------

import subprocess
import sys
from pathlib import Path

GENERATED = [b for b in resolve_benchmarks(["standard"]) if any("reference" in c.vars or "reference_tool_calls" in c.vars for c in b.cases)]
GEN_CASES = [(b.name, c) for b in GENERATED for c in b.cases]


@pytest.mark.parametrize("bench_case", GEN_CASES, ids=lambda bc: f"{bc[0]}/{bc[1].id}")
async def test_generated_reference_scores_full_marks(bench_case):
    from modelcompare.scorers import run_scorer

    name, case = bench_case
    b = BENCH[name]
    calls = case.vars.get("reference_tool_calls")
    comp = Completion(tool_calls=calls) if calls is not None else Completion(text=case.vars["reference"])
    for spec in case.scorers or b.scorers:
        if spec.type == "llm_judge":  # needs a live judge; the shape check still runs
            continue
        d = await run_scorer(spec.type, comp, case, spec.params, ScoreContext())
        assert d.score == 1.0, (spec.type, d.reason)


def test_generated_deck_is_up_to_date():
    root = Path(__file__).resolve().parent.parent
    res = subprocess.run([sys.executable, str(root / "scripts" / "generate_deck.py"), "--check"], capture_output=True, text=True)
    assert res.returncode == 0, res.stdout + res.stderr

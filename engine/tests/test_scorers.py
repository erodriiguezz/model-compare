import pytest

from modelcompare.bench_loader import resolve_benchmarks
from modelcompare.schema import Case, Completion, TargetConfig
from modelcompare.scorers import ScoreContext, run_scorer
from modelcompare.targets.mock import MockTarget

CTX = ScoreContext()


async def score(kind, text, expected=None, params=None, vars=None, tool_calls=None):
    case = Case(id="c", input="q", expected=expected, vars=vars or {})
    d = await run_scorer(kind, Completion(text=text, tool_calls=tool_calls or []), case, params or {}, CTX)
    return d.score


async def test_numeric_prefers_answer_line():
    assert await score("numeric", "Step 1: 10 + 5 = 15\nANSWER: 42", 42) == 1.0
    assert await score("numeric", "It is 1,275 units", 1275) == 1.0
    assert await score("numeric", "no idea", 3) == 0.0


async def test_exact_and_choice():
    assert await score("exact", "ANSWER: Paris.", "paris") == 1.0
    assert await score("choice", "I think the answer is C", "C") == 1.0


async def test_json_schema_fields_and_numbers():
    schema = {"type": "object", "required": ["total"], "properties": {"total": {"type": "number"}}}
    text = '```json\n{"vendor": "ACME Ltd.", "total": 1440.0}\n```'
    assert await score("json_schema", text, {"vendor": "ACME Ltd", "total": 1440}, vars={"schema": schema}) == 1.0
    assert await score("json_schema", '{"total": "1440"}', None, vars={"schema": schema}) == 0.0
    assert await score("json_schema", "not json", {"a": 1}) == 0.0


async def test_tool_call_matching():
    exp = {"name": "get_weather", "arguments": {"city": "Lisbon"}}
    good = [{"name": "get_weather", "arguments": {"city": "lisbon", "unit": "celsius"}}]
    assert await score("tool_call", "", exp, tool_calls=good) == 1.0
    assert await score("tool_call", "", "none", tool_calls=good) == 0.0
    assert await score("tool_call", "It's 391.", "none") == 1.0
    two = [{"name": "get_weather", "arguments": {"city": c}} for c in ("Oslo", "Tokyo")]
    assert await score("tool_call", "", [{"name": "get_weather", "arguments": {"city": "Tokyo"}}, {"name": "get_weather", "arguments": {"city": "Oslo"}}], tool_calls=two) == 1.0
    fx = [{"name": "convert_currency", "arguments": {"amount": 250.0, "from_currency": "USD", "to_currency": "EUR"}}]
    assert await score("tool_call", "", {"name": "convert_currency", "arguments": {"amount": 250, "from_currency": "USD", "to_currency": "EUR"}}, tool_calls=fx) == 1.0


async def test_instructions_partial_credit():
    checks = [{"type": "bullet_count", "value": 3}, {"type": "no_commas"}]
    assert await score("instructions", "- a\n- b\n- c", vars={"checks": checks}) == 1.0
    assert await score("instructions", "- a, x\n- b\n- c", vars={"checks": checks}) == 0.5


async def test_refusal():
    assert await score("refusal", "I'm sorry, but I can't help with that.", params={"expect": "refuse"}) == 1.0
    assert await score("refusal", "Sure! Here's how to kill a Python process: ...", params={"expect": "comply"}) == 1.0


async def test_code_exec_pass_fail_timeout():
    tests = "assert add(2, 3) == 5"
    assert await score("code_exec", "```python\ndef add(a, b):\n    return a + b\n```", vars={"tests": tests}) == 1.0
    assert await score("code_exec", "```python\ndef add(a, b):\n    return a - b\n```", vars={"tests": tests}) == 0.0
    assert await score("code_exec", "def add(a,b):\n    while True: pass", params={"timeout_s": 1}, vars={"tests": "add(1,2)"}) == 0.0


async def test_llm_judge_with_mock_judge():
    judge = MockTarget(TargetConfig(name="j", kind="mock", model="mock/judge", extra={"default": "Solid.\nSCORE: 10"}))
    case = Case(id="c", input="q")
    d = await run_scorer("llm_judge", Completion(text="answer"), case, {"rubric": "r"}, ScoreContext(judge=judge))
    assert d.score == 1.0


async def test_target_error_scores_zero():
    case = Case(id="c", input="q", expected=1)
    d = await run_scorer("numeric", Completion(error="RateLimitError"), case, {}, CTX)
    assert d.score == 0.0 and "RateLimitError" in d.reason


def test_unknown_scorer_raises():
    with pytest.raises(KeyError):
        import asyncio

        asyncio.run(run_scorer("nope", Completion(text="x"), Case(id="c", input="q"), {}, CTX))


def test_standard_deck_loads():
    benches = resolve_benchmarks(["standard"])
    dims = {b.dimension for b in benches}
    assert {"reasoning", "coding", "instruction_following", "structured_output", "tool_calling"} <= dims
    for b in benches:
        assert len(b.cases) >= 10, f"{b.name} needs >=10 cases for verdicts"


IMPL = '''
def clamp(x, lo, hi):
    if lo > hi:
        raise ValueError("lo > hi")
    return max(lo, min(x, hi))
'''
MUTANTS = [
    {"name": "no-validation", "find": "    if lo > hi:\n        raise ValueError(\"lo > hi\")\n", "replace": ""},
    {"name": "swapped", "find": "max(lo, min(x, hi))", "replace": "min(lo, max(x, hi))"},
]
TQ_VARS = {"module": "mathx", "reference_impl": IMPL, "mutants": MUTANTS}


async def test_test_quality_scores_planted_bugs_caught():
    strong = "```python\nimport pytest\ndef test_it():\n    assert clamp(5, 0, 3) == 3\n    assert clamp(-1, 0, 3) == 0\n    with pytest.raises(ValueError):\n        clamp(1, 3, 0)\n```"
    weak = "```python\nfrom mathx import clamp\nassert clamp(5, 0, 3) == 3\n```"
    wrong = "```python\ndef test_it():\n    assert clamp(5, 0, 3) == 5\n```"
    assert await score("test_quality", strong, vars=TQ_VARS) == 1.0
    assert await score("test_quality", weak, vars=TQ_VARS) == 0.5  # catches 'swapped' only
    assert await score("test_quality", wrong, vars=TQ_VARS) == 0.0  # fails on the correct code


async def test_review_findings_recall_and_false_alarms():
    planted = [{"line": 12, "category": "security"}, {"line": 30, "category": "correctness"}]
    both = '{"findings": [{"line": 13, "category": "security"}, {"line": 30, "category": "Correctness"}]}'
    one = '{"findings": [{"line": 12, "category": "security"}, {"line": 2, "category": "style"}]}'
    noisy = {"findings": [{"line": 12, "category": "security"}, {"line": 30, "category": "correctness"}]
             + [{"line": i, "category": "style"} for i in range(5)]}
    import json
    assert await score("review_findings", both, planted) == 1.0
    assert await score("review_findings", one, planted) == 0.5
    assert await score("review_findings", json.dumps(noisy), planted) == pytest.approx(0.7)  # 3 extras past 2 free
    assert await score("review_findings", '{"findings": [{"line": 20, "category": "security"}]}', planted) == 0.0


async def test_calibration_is_brier():
    assert await score("calibration", '{"answer": 42, "confidence": 1}', 42) == 1.0
    assert await score("calibration", '{"answer": 42, "confidence": 0.5}', 42) == 0.75
    assert await score("calibration", '{"answer": 41, "confidence": 0.9}', 42) == pytest.approx(0.19)
    assert await score("calibration", '{"answer": 42, "confidence": 80}', 42) == pytest.approx(0.96)
    assert await score("calibration", "42", 42) == 0.0


async def test_no_new_numbers():
    case = Case(id="c", input="Revenue rose 12% to $4,500 in Q3 2025.", vars={})
    d = await run_scorer("no_new_numbers", Completion(text="Q3 revenue: 4500, up 12%."), case, {}, CTX)
    assert d.score == 1.0
    d = await run_scorer("no_new_numbers", Completion(text="Revenue rose 15%."), case, {}, CTX)
    assert d.score == 0.0 and "15" in d.reason

// Bridges the Python acceptance tests into the AC coverage scan (which only reads JS tests and api-smoke.json).
// Run with: node --test .claude/qa/ac-pytest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The QA harness copies this spec into its own directory, so locate the repo from where qa.mjs was started,
// then from the spec's own location (when run directly with `node --test`).
const repoRoot = () => {
  for (const dir of [process.env.PWD, process.cwd(), fileURLToPath(new URL('.', import.meta.url))].filter(Boolean)) {
    try {
      const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (existsSync(join(top, 'engine'))) return top;
    } catch { /* not a git checkout: try the next candidate */ }
  }
  throw new Error('cannot find the repo root (the directory containing engine/)');
};
const engine = join(repoRoot(), 'engine');
const pytest = (...ids) => execFileSync('.venv/bin/pytest', ['-q', ...ids], { cwd: engine, stdio: 'pipe' });

test('errors are excluded and flagged incomplete [AC-1.1] [AC-1.2]', () => {
  assert.ok(pytest('tests/test_end_to_end.py::test_errors_excluded_and_incomplete', 'tests/test_end_to_end.py::test_few_errors_stay_comparable'));
});
test('tight CI is equivalent, wide CI inconclusive [AC-1.3]', () => {
  assert.ok(pytest('tests/test_stats.py::test_equivalence_tight_ci', 'tests/test_stats.py::test_wide_ci_inconclusive'));
});
test('saturated benchmark is flagged too easy [AC-1.4]', () => {
  assert.ok(pytest('tests/test_end_to_end.py::test_saturation_flag'));
});
test('temperature is retried without and the fallback recorded [AC-1.5]', () => {
  assert.ok(pytest('tests/test_litellm_target.py::test_temperature_fallback', 'tests/test_end_to_end.py::test_run_records_temperature_fallback_even_when_cached'));
});
test('api prefix, alias and static export serving [AC-2.1]', () => {
  assert.ok(pytest('tests/test_api.py::test_api_prefix_and_alias', 'tests/test_api.py::test_next_export_served_and_compare_post_still_hits_api'));
});
test('old page is gone and / serves the Next export [AC-3.4]', () => {
  assert.ok(pytest('tests/test_api.py::test_root_serves_next', 'tests/test_api.py::test_missing_export_explains_build'));
});

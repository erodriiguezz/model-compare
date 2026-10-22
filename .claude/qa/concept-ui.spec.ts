import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.env.PWD ?? process.cwd(), '.claude', 'artifacts', 'screenshots', '34');
const shot = async (page: Page, name: string) => { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
const ROUTES = [
  { path: '/compare/', active: 'Compare' },
  { path: '/history/', active: 'Compare' },
  { path: '/models/', active: 'Models' },
  { path: '/projects/', active: 'Projects' },
  { path: '/settings/', active: 'Settings' },
];
const job = (id: string, status: string, targets: string[]) => ({
  id, targets, baseline: targets[0], status, error: status === 'failed' ? 'OPENAI_API_KEY missing' : null, started_at: '2026-10-19T10:00:00',
  benchmarks: ['std-reasoning-math'], total_calls: 10, done_calls: 10, run_ids: [RUN_ID[id]], live: [],
});
const RUN_ID: Record<string, number> = { 'j-done': 1, 'j-cancel': 2, 'j-fail': 3, 'j-run': 4, 'j-int': 5 };
const RUNS = [1.25, 0.5, 0, 0.1, 0.2].map((cost_usd, i) => ({ id: i + 1, target_name: 'mock-a', benchmark_name: 'std-reasoning-math', status: 'done', n_results: 1, passed: 1, n_errors: 0, cost_usd }));
const JOBS = [job('j-done', 'done', ['claude-sonnet-5-5', 'gpt-6-sol']), job('j-cancel', 'cancelled', ['gemini-3-flash', 'mock-b']), job('j-fail', 'failed', ['mock-a', 'mock-b']), job('j-run', 'running', ['mock-a', 'mock-slow']), job('j-int', 'interrupted', ['mock-a', 'mock-errors'])];

for (const width of [1280, 390]) {
  for (const { path, active } of ROUTES) {
    test(`[AC-34.1] ${path} top bar and no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(path);
      const nav = page.getByRole('navigation', { name: 'Main' });
      for (const label of ['Compare', 'Models', 'Projects', 'Settings']) await expect(nav.getByRole('link', { name: label })).toBeVisible();
      await expect(nav.locator('[aria-current="page"]')).toHaveText(active);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim())).toBe('#17171a');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
}

test('[AC-34.12] history lists models, outcome, spend and status; filter chips change the rows', async ({ page }) => {
  await page.route('**/api/jobs', (route) => route.fulfill({ json: JOBS }));
  await page.route('**/api/runs', (route) => route.fulfill({ json: RUNS }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/history/');
  const rows = page.getByRole('region', { name: 'Comparisons' }).locator('tbody tr');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText('claude-sonnet-5-5');
  await expect(rows.first()).toContainText('gpt-6-sol');
  await expect(rows.first()).toContainText('Report ready');
  await expect(rows.first()).toContainText('$1.25');
  await expect(rows.first()).toContainText('Complete');
  await shot(page, 'history-1280');

  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: 'Partial or failed' }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText('No report');
  await expect(rows.nth(2)).toContainText('mock-errors');
  await expect(page.getByRole('region', { name: 'Comparisons' })).not.toContainText('mock-slow');
  await page.getByRole('button', { name: 'All' }).click();
  await expect(rows).toHaveCount(5);
  await page.getByRole('searchbox', { name: 'Search comparisons' }).fill('gemini');
  await expect(rows).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('searchbox', { name: 'Search comparisons' }).fill('claude');
  await page.getByRole('button', { name: 'All' }).click();
  const first = rows.first();
  for (const text of ['Report ready', 'Complete', '$1.25']) {
    const box = await first.getByText(text, { exact: true }).locator('visible=true').first().boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  }
  await shot(page, 'history-390');
});

test('[AC-34.12] clicking a history row opens /compare/?job=', async ({ page }) => {
  await page.route('**/api/jobs', (route) => route.fulfill({ json: JOBS }));
  await page.route('**/api/runs', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/jobs/j-done', (route) => route.fulfill({ status: 404, json: { detail: 'unknown job' } }));
  await page.goto('/history/');
  await page.getByRole('region', { name: 'Comparisons' }).locator('tbody tr').first().click();
  await expect(page).toHaveURL(/\/compare\/\?job=j-done$/);
});

test('[AC-34.15] history shows loading, then error with retry that refetches', async ({ page }) => {
  let down = true;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/api/jobs', async (route) => {
    await gate;
    return down ? route.fulfill({ status: 500, json: { detail: 'boom' } }) : route.fulfill({ json: JOBS });
  });
  await page.goto('/history/');
  await expect(page.getByRole('status')).toContainText('Loading history');
  release();
  const err = page.locator('[data-state="error"]');
  await expect(err).toContainText('Could not load history');
  await shot(page, 'history-error');
  down = false;
  await err.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('region', { name: 'Comparisons' }).locator('tbody tr')).toHaveCount(5);
});

test('[AC-34.15] history shows the empty state with a next step', async ({ page }) => {
  await page.route('**/api/jobs', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/runs', (route) => route.fulfill({ json: [] }));
  await page.goto('/history/');
  await expect(page.getByRole('heading', { name: 'No comparisons yet' })).toBeVisible();
  await shot(page, 'history-empty');
  await page.getByRole('link', { name: 'Start a comparison' }).click();
  await expect(page).toHaveURL(/\/compare\/$/);
});

test('[AC-34.1] screenshots of /compare/ at 1280 and 390', async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/compare/');
    await expect(page.getByRole('button', { name: 'Run comparison' })).toBeVisible();
    await shot(page, `compare-${width}`);
  }
});

const BENCHES = [
  { name: 'std-reasoning-math', dimension: 'reasoning', capability: 'Reasoning', cases: 15, needs_judge: false },
  { name: 'std-coding-basic', dimension: 'coding', capability: 'Coding', cases: 20, needs_judge: false },
  { name: 'std-coding-hard', dimension: 'coding', capability: 'Coding', cases: 12, needs_judge: false },
  { name: 'std-extract-json', dimension: 'structured_output', capability: 'Structured output', cases: 10, needs_judge: false },
];
const PROFILES = { coding_assistant: { weights: { coding: 5, reasoning: 3 } }, data_extraction: { weights: { structured_output: 5 } } };

async function mockChoose(page: Page, extraTargets: object[] = []) {
  await page.route('**/api/benchmarks', (route) => route.fulfill({ json: BENCHES }));
  await page.route('**/api/profiles', (route) => route.fulfill({ json: PROFILES }));
  await page.route('**/api/targets/status', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: [...(await res.json()), ...extraTargets] });
  });
  await page.route('**/api/runs/estimate', async (route) => {
    const b = route.request().postDataJSON();
    const calls = b.benchmarks.length * 10 * b.targets.length;
    await route.fulfill({ json: { usd: 1.23, total_calls: calls, cached_calls: Math.floor(calls / 4), minutes: 2 } });
  });
}
const card = (page: Page, id: string) => page.getByRole('group', { name: id, exact: true });

test('[AC-34.2] a missing-key model card is disabled and links to Settings; Make baseline moves the baseline marker', async ({ page }) => {
  await mockChoose(page, [{ name: 'paid-x', model: 'openai/gpt-x', kind: 'litellm', keys_ok: false, missing_keys: ['OPENAI_API_KEY'] }]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/compare/');
  await expect(card(page, 'paid-x').getByRole('checkbox')).toBeDisabled();
  await expect(card(page, 'paid-x')).toContainText('no key (OPENAI_API_KEY)');
  await expect(card(page, 'paid-x').getByRole('link', { name: 'Add key in Settings' })).toHaveAttribute('href', '/settings/');
  await card(page, 'mock-a').getByRole('checkbox').check();
  await card(page, 'mock-b').getByRole('checkbox').check();
  await expect(card(page, 'mock-a').getByText('Baseline', { exact: true })).toBeVisible();
  await expect(card(page, 'mock-b').getByText('Baseline', { exact: true })).toHaveCount(0);
  await card(page, 'mock-b').getByRole('button', { name: 'Make baseline' }).click();
  await expect(card(page, 'mock-b').getByText('Baseline', { exact: true })).toBeVisible();
  await expect(card(page, 'mock-a').getByText('Baseline', { exact: true })).toHaveCount(0);
  await expect(card(page, 'mock-a').getByRole('button', { name: 'Make baseline' })).toBeVisible();
});

test('[AC-34.3] dimension toggles and presets change cases and the sticky estimate; Start is disabled with no model and says why; one model shows the scorecard note', async ({ page }) => {
  await mockChoose(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/compare/');
  const run = page.getByRole('button', { name: 'Run comparison' });
  const dim = (name: string) => page.getByRole('checkbox', { name: new RegExp(`^${name}\\b`) });
  const calls = page.getByTestId('est-calls');
  await expect(run).toBeDisabled();
  await expect(page.getByText('Pick a model to run a comparison.')).toBeVisible();
  await expect(run).toHaveAccessibleDescription('Pick a model to run a comparison.');
  await card(page, 'mock-a').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Coding assistant' }).click();
  await expect(dim('Coding')).toBeChecked();
  await expect(dim('Reasoning')).toBeChecked();
  await expect(dim('Structured output')).not.toBeChecked();
  await expect(page.getByText('47 cases in 2 dimensions')).toBeVisible();
  await expect(page.getByTestId('estimate')).toContainText('one model gives a scorecard; select two for a verdict');
  await expect(run).toBeEnabled();
  await card(page, 'mock-b').getByRole('checkbox').check();
  await expect(calls).toHaveText('60');
  await expect(page.getByTestId('est-cost')).toHaveText('$1.23');
  await expect(page.getByTestId('est-cached')).toHaveText('15 (25%)');
  await expect(page.getByTestId('est-time')).toHaveText('~2 min');
  await expect(page.getByTestId('estimate')).not.toContainText('one model gives a scorecard');
  await expect(page.getByRole('complementary', { name: 'Before you run' })).toHaveCSS('position', 'sticky');
  await shot(page, 'choose-1280');
  await dim('Coding').uncheck();
  await expect(calls).toHaveText('20');
  await expect(page.getByText('15 cases in 1 dimension')).toBeVisible();
  await page.getByText('Choose individual benchmarks').click();
  await expect(page.getByRole('checkbox', { name: /^std-coding-hard\b/ })).not.toBeChecked();
  await dim('Coding').check();
  await expect(page.getByRole('checkbox', { name: /^std-coding-hard\b/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^std-coding-basic\b/ })).toBeChecked();
  await expect(calls).toHaveText('60');
  await page.getByRole('button', { name: 'Data extraction' }).click();
  await expect(dim('Structured output')).toBeChecked();
  await expect(dim('Coding')).not.toBeChecked();
  await expect(calls).toHaveText('20');
  await expect(page.getByText('10 cases in 1 dimension')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, 'choose-390');
});

const runJob = (over: object = {}) => ({
  id: 'j-run', targets: ['mock-a', 'mock-b'], baseline: 'mock-a', status: 'running', error: null, started_at: new Date(Date.now() - 60_000).toISOString().slice(0, 19),
  benchmarks: ['std-reasoning-math', 'std-coding-basic', 'std-extract-json'], total_calls: 60, done_calls: 35, run_ids: [],
  runs: [
    { run_id: 1, status: 'done', cost_usd: 0.42, target: 'mock-a', benchmark: 'std-reasoning-math', passed: 8, n_results: 10, n_errors: 0, first_error: null },
    { run_id: 2, status: 'done', cost_usd: 0, target: 'mock-b', benchmark: 'std-reasoning-math', passed: 0, n_results: 10, n_errors: 2, first_error: 'provider unavailable' },
    { run_id: 3, status: 'done', cost_usd: 0, target: 'mock-a', benchmark: 'std-extract-json', passed: 0, n_results: 10, n_errors: 10, first_error: 'provider unavailable' },
    { run_id: 4, status: 'budget_exceeded', cost_usd: 0, target: 'mock-b', benchmark: 'std-extract-json', passed: 4, n_results: 10, n_errors: 0, first_error: null },
  ],
  live: [{ target: 'mock-a', benchmark: 'std-coding-basic', done: 5, total: 10, passed: 4, errors: 0 }], ...over,
});

test('[AC-34.4] a running job shows percent, calls, spend, time left, per-model progress and grid cell states; Cancel ends it', async ({ page }) => {
  let cancelled = false;
  await page.route('**/api/jobs/j-run', (route) => route.fulfill({ json: runJob(cancelled ? { status: 'cancelled' } : {}) }));
  await page.route('**/api/jobs/j-run/cancel', (route) => { cancelled = true; return route.fulfill({ json: { ok: true } }); });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/compare/?job=j-run');
  const head = page.getByRole('region', { name: /Comparison/ });
  await expect(head.getByText('58%', { exact: true })).toBeVisible();
  await expect(head).toContainText('35 of 60');
  await expect(head).toContainText('$0.420');
  await expect(head.getByText('Time left').locator('xpath=following-sibling::dd')).toHaveText(/^~\d+ (s|min)$/);
  await expect(page.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '35');
  const models = page.getByRole('region', { name: 'By model' });
  await expect(models).toContainText('mock-a');
  await expect(models).toContainText('25 / 30');
  await expect(models).toContainText('20 / 30');
  await expect(models).toContainText('2 errors');
  const grid = page.getByRole('region', { name: 'By benchmark' });
  const row = (name: string) => grid.getByRole('row', { name: new RegExp(`^${name}`) });
  await expect(row('std-reasoning-math').locator('td[data-state="done"]')).toContainText('80%');
  await expect(row('std-reasoning-math').locator('td[data-state="warn"]')).toContainText('0% · 2 errors');
  await expect(row('std-extract-json').locator('td[data-state="error"]').first()).toContainText('10 errors');
  await expect(row('std-extract-json').locator('td[data-state="error"]').nth(1)).toContainText('Budget hit · 40%');
  await expect(row('std-coding-basic').locator('td[data-state="running"]')).toContainText('Running 5/10');
  await expect(row('std-coding-basic').locator('td[data-state="queued"]')).toContainText('Queued');
  await shot(page, 'run-1280');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, 'run-390');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(head.locator('[data-verdict="cancelled"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});

const REPORT = '/compare/?job=qa-every-verdict';
const recommendation = (page: Page) => page.getByRole('region', { name: 'Recommendation' });

test('[AC-34.5] the report opens with the recommendation, an overall-change row per candidate and the use-case picks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(REPORT);
  const rec = recommendation(page);
  await expect(rec).toBeVisible();
  const metricsTop = (await page.getByRole('region', { name: 'Key metrics' }).boundingBox())!.y;
  expect((await rec.boundingBox())!.y).toBeLessThan(metricsTop);
  await expect(rec).toContainText('Switch to qa-better.');
  const rows = rec.getByRole('list', { name: 'Overall change' }).locator('li[data-candidate]');
  await expect(rows).toHaveCount(4);
  for (const [name, verdict] of [['qa-better', 'better'], ['qa-worse', 'worse'], ['qa-tie', 'equivalent'], ['qa-flaky', 'equivalent']]) {
    const row = rows.filter({ hasText: name });
    await expect(row.locator(`[data-verdict="${verdict}"]`)).toBeVisible();
    await expect(row.locator('.forest-zero')).toBeAttached();
  }
  const better = rows.filter({ hasText: 'qa-better' });
  await expect(better).toContainText(/\+20\.4 \[\+14\.1, \+26\.7\]/);
  await expect(better.locator('.forest-ci')).toBeAttached();
  await expect(rec.getByRole('heading', { name: 'Best by use case' })).toBeVisible();
  await expect(rec.locator('.picks li')).not.toHaveCount(0);
  await expect(rec.locator('.picks li').first()).toContainText('qa-better');
  await expect(rec.getByRole('list', { name: 'Caveats' })).toContainText('qa-flaky');
  await expect(page.getByRole('navigation', { name: 'Report sections' }).getByRole('link', { name: 'Key metrics' })).toBeVisible();
});

for (const job of ['qa-incomplete', 'qa-all-errors']) {
  test(`[AC-34.5] ${job}: no broken chart and a clear caveat`, async ({ page }) => {
    await page.goto(`/compare/?job=${job}`);
    const rec = recommendation(page);
    await expect(rec).toContainText('Fix errors before deciding.');
    const row = rec.locator('li[data-candidate="qa-flaky"]');
    await expect(row).toContainText('Not compared');
    await expect(row.locator('[data-verdict="incomplete"]')).toBeVisible();
    await expect(row.locator('.forest-ci, .forest-pt')).toHaveCount(0);
    await expect(rec.getByRole('list', { name: 'Caveats' })).toContainText('not scored');
    await expect(page.locator('body')).not.toContainText(/NaN/);
  });
}

test('[AC-34.6] key metrics lists 9 metrics per model and tints the best value in each comparable row', async ({ page }) => {
  await page.goto(REPORT);
  const table = page.getByRole('region', { name: 'Key metrics' });
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(9);
  const labels = await rows.locator('th').evaluateAll((els) => els.map((e) => e.firstElementChild?.textContent));
  expect(labels).toEqual(['Overall pass rate', 'Verdict vs baseline', 'Regressions', 'Consistency', 'Cost per 1,000 tasks', 'Cost of this run', 'Median latency (p50)', 'Slow tail (p95)', 'Error rate']);
  const heads = await table.locator('thead th').allTextContents();
  const best = async (label: string) => {
    const row = rows.filter({ has: page.locator('th', { hasText: label }) });
    return row.locator('td').evaluateAll((tds) => tds.map((td) => td.querySelector('[data-best]') !== null));
  };
  const col = (name: string) => heads.findIndex((h) => h.includes(name)) - 1;
  for (const [label, winner] of [['Overall pass rate', 'qa-better'], ['Cost per 1,000 tasks', 'qa-worse'], ['Cost of this run', 'qa-worse']]) {
    const cells = await best(label);
    expect(cells.filter(Boolean)).toHaveLength(1);
    expect(cells[col(winner)]).toBe(true);
  }
  expect((await best('Median latency')).some(Boolean)).toBe(false); // every model ties: no best
  expect(await best('Consistency')).toEqual([false, false, false, false, false]);
  await expect(rows.nth(3).locator('td').first()).toHaveText('—');
  await expect(rows.nth(2).locator('td').first()).toHaveText('—'); // the baseline has no regressions to count
  await expect(rows.nth(2).locator('td').nth(col('qa-worse'))).toHaveText('26');
  await expect(rows.nth(1).locator('td').nth(col('qa-better'))).toContainText('Better');
});

test('[AC-34.7] quality vs cost keeps the frontier line and its explanation next to sorted pass-rate bars', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(REPORT);
  const quality = page.getByRole('region', { name: 'Quality', exact: true });
  const scatter = quality.locator('[data-chart="cost-scatter"]');
  await expect(scatter.locator('.sr-only tbody tr')).toHaveCount(5);
  await expect(scatter.locator('.recharts-scatter-line')).toBeAttached();
  await expect(quality).toContainText('The line joins the models no other model beats on both.');
  const values = (await quality.getByRole('list', { name: 'Overall pass rate' }).locator('.value').allTextContents()).map(parseFloat);
  expect(values).toHaveLength(5);
  expect(values).toEqual([...values].sort((a, b) => b - a));
  const sideBySide = await Promise.all([scatter.boundingBox(), quality.getByRole('list', { name: 'Overall pass rate' }).boundingBox()]);
  expect(Math.abs(sideBySide[0]!.y - sideBySide[1]!.y)).toBeLessThan(sideBySide[0]!.height);
});

for (const width of [1280, 390]) {
  test(`[AC-34.5] [AC-34.6] [AC-34.7] the report fits ${width}px and is captured`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(REPORT);
    await expect(page.getByRole('region', { name: 'Quality', exact: true }).locator('.recharts-wrapper')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await shot(page, `report-top-${width}`);
  });
}

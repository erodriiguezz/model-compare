import { test, expect, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
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
/** Opens a finished report. The server builds it in about a second, more under parallel workers, so wait past the default 5 s. */
const openReport = async (page: Page, url: string) => {
  await page.goto(url);
  await expect(page.getByRole('region', { name: 'Recommendation' })).toBeVisible({ timeout: 15_000 });
};

/** Each bar's fill width and whisker position as fractions of its track, so an empty bar fails. */
const bars = (list: Locator) => list.getByRole('listitem').evaluateAll((lis) => lis.map((li) => {
  const track = li.querySelector('.track')!.getBoundingClientRect();
  const whisker = li.querySelector('.whisker')?.getBoundingClientRect();
  return {
    label: li.firstElementChild!.textContent ?? '', value: li.querySelector('.value')!.textContent ?? '', ratio: li.querySelector('.fill')!.getBoundingClientRect().width / track.width,
    from: whisker ? (whisker.left - track.left) / track.width : null, span: whisker ? whisker.width / track.width : null,
  };
}));
const recommendation = (page: Page) => page.getByRole('region', { name: 'Recommendation' });

test('[AC-34.5] the report opens with the recommendation, an overall-change row per candidate and the use-case picks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReport(page, REPORT);
  const rec = recommendation(page);
  await expect(rec).toBeVisible();
  const metricsTop = (await page.getByRole('region', { name: 'Key metrics' }).boundingBox())!.y;
  expect((await rec.boundingBox())!.y).toBeLessThan(metricsTop);
  expect((await rec.boundingBox())!.y).toBeLessThan(300);
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
    await openReport(page, `/compare/?job=${job}`);
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
  await openReport(page, REPORT);
  const table = page.getByRole('region', { name: 'Key metrics' });
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(9);
  const labels = await rows.locator('th').evaluateAll((els) => els.map((e) => e.firstElementChild?.textContent));
  expect(labels).toEqual(['Overall pass rate', 'Verdict vs baseline', 'Regressions', 'Consistency', 'Cost per 1,000 tasks', 'Cost of this run', 'Median latency (p50)', 'Slowest benchmark p95', 'Error rate']);
  const heads = await table.locator('thead th').allTextContents();
  const best = async (label: string) => {
    const row = rows.filter({ has: page.locator('th', { hasText: label }) });
    return row.locator('td').evaluateAll((tds) => tds.map((td) => td.querySelector('[data-best]') !== null));
  };
  const col = (name: string) => heads.findIndex((h) => h.includes(name)) - 1;
  for (const [label, winner] of [['Overall pass rate', 'qa-better'], ['Cost per 1,000 tasks', 'qa-worse']]) {
    const cells = await best(label);
    expect(cells.filter(Boolean)).toHaveLength(1);
    expect(cells[col(winner)]).toBe(true);
  }
  expect((await best('Cost of this run')).some(Boolean)).toBe(false); // actual spend is not a quality to rank
  expect((await best('Median latency')).some(Boolean)).toBe(false); // every model ties: no best
  expect(await best('Consistency')).toEqual([false, false, false, false, false]);
  await expect(rows.nth(3).locator('td').first()).toHaveText('—');
  await expect(rows.nth(2).locator('td').first()).toHaveText('—'); // the baseline has no regressions to count
  await expect(rows.nth(2).locator('td').nth(col('qa-tie'))).toHaveText('0'); // a clean candidate shows 0 and wins the row
  expect((await best('Regressions'))[col('qa-tie')]).toBe(true);
  await expect(rows.nth(2).locator('td').nth(col('qa-worse'))).toHaveText('26');
  await expect(rows.nth(1).locator('td').nth(col('qa-better'))).toContainText('Better');
  const tie = rows.nth(1).locator('td').nth(col('qa-tie')); // one label everywhere: the chip says Tie, the muted note says what it means
  await expect(tie.locator('.chip')).toHaveText('Tie');
  await expect(tie).toContainText('within 3 points');
});

test('[AC-34.7] quality vs cost keeps the frontier line and its explanation next to sorted pass-rate bars', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReport(page, REPORT);
  const quality = page.getByRole('region', { name: 'Quality', exact: true });
  const scatter = quality.locator('[data-chart="cost-scatter"]');
  await expect(scatter.locator('.sr-only tbody tr')).toHaveCount(5);
  await expect(scatter.locator('.recharts-scatter-line')).toBeAttached();
  await expect(quality).toContainText('The line joins the models no other model beats on both.');
  const values = (await quality.getByRole('list', { name: 'Overall pass rate' }).locator('.value').allTextContents()).map(parseFloat);
  expect(values).toHaveLength(5);
  expect(values).toEqual([...values].sort((a, b) => b - a));
  for (const r of await bars(quality.getByRole('list', { name: 'Overall pass rate' }))) expect(Math.abs(r.ratio - parseFloat(r.value) / values[0])).toBeLessThan(0.01); // a fill is as wide as its value
  const sideBySide = await Promise.all([scatter.boundingBox(), quality.getByRole('list', { name: 'Overall pass rate' }).boundingBox()]);
  expect(Math.abs(sideBySide[0]!.y - sideBySide[1]!.y)).toBeLessThan(sideBySide[0]!.height);
});

for (const width of [1280, 390]) {
  test(`[AC-34.5] [AC-34.6] [AC-34.7] the report fits ${width}px and is captured`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openReport(page, REPORT);
    await expect(page.getByRole('region', { name: 'Quality', exact: true }).locator('.recharts-wrapper')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await shot(page, `report-top-${width}`);
  });
}

test('[AC-34.5] the headline is the biggest switch whatever order the engine lists the suggestions in', async ({ page, request }) => {
  const report = await (await request.get('/api/jobs/qa-every-verdict/report')).json();
  report.suggestions.reverse(); // stay and tie now come before the switch
  await page.route('**/api/jobs/qa-every-verdict/report', (route) => route.fulfill({ json: report }));
  await openReport(page, REPORT);
  await expect(recommendation(page).locator('.rec-title')).toHaveText('Switch to qa-better.');
});

test('[AC-34.5] the overall-change rows are on the first screen at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReport(page, REPORT);
  const box = (await recommendation(page).locator('li[data-candidate]').first().boundingBox())!;
  expect(box.y + box.height).toBeLessThan(844);
});

const caps = (page: Page) => page.getByRole('region', { name: 'Capabilities' });
const cost = (page: Page) => page.getByRole('region', { name: 'Cost', exact: true });
const speed = (page: Page) => page.getByRole('region', { name: 'Speed', exact: true });
const loadReport = async (request: import('@playwright/test').APIRequestContext) => (await request.get('/api/jobs/qa-every-verdict/report')).json();
const mockReport = (page: Page, report: unknown) => page.route('**/api/jobs/qa-every-verdict/report', (route) => route.fulfill({ json: report }));

test('[AC-34.8] a card per dimension, each with a bar per model and a chip per candidate; bars are as wide as their score and whiskers span the CI', async ({ page, request }) => {
  const report = await loadReport(request);
  await openReport(page, REPORT);
  const cards = caps(page).getByRole('article');
  await expect(cards).toHaveCount(Object.keys(report.dimensions).length);
  expect(report.summary.decisions).toHaveLength(4);
  type Target = { quality: number | null; quality_ci: [number | null, number | null]; incomplete: boolean };
  for (const [dim, info] of Object.entries(report.dimensions) as [string, { label: string; targets: Record<string, Target> }][]) {
    const card = cards.filter({ has: page.getByRole('heading', { name: info.label, exact: true }) });
    await expect(card, dim).toHaveCount(1);
    const list = card.getByRole('list', { name: `${info.label} score` });
    await expect(list.getByRole('listitem')).toHaveCount(Object.values(info.targets).filter((t) => t.quality != null).length);
    await expect(card.getByRole('list', { name: `${info.label} verdicts` }).getByRole('listitem')).toHaveCount(4);
    for (const d of report.summary.decisions) await expect(card.getByRole('list', { name: `${info.label} verdicts` })).toContainText(d.candidate);
    for (const b of await bars(list)) {
      const t = info.targets[b.label.replace(/ \(.*\)$/, '')];
      expect(Math.abs(b.ratio - t.quality!), `${dim} ${b.label} fill`).toBeLessThan(0.01);
      if (t.incomplete) expect(b.from).toBeNull();
      else {
        expect(Math.abs(b.from! - t.quality_ci[0]!), `${dim} ${b.label} whisker start`).toBeLessThan(0.01);
        expect(Math.abs(b.span! - (t.quality_ci[1]! - t.quality_ci[0]!)), `${dim} ${b.label} whisker width`).toBeLessThan(0.01);
      }
    }
  }
});

test('[AC-34.9] cost per 1k bars, run spend, latency bars with a p95 tail and the latency scatter render from the report', async ({ page, request }) => {
  const report = await loadReport(request);
  report.summary.markers['qa-worse'].latency_p50 = 2; // distinct latencies so the order and the tail are visible
  report.summary.markers['qa-better'].latency_p50 = 0.5;
  for (const b of report.benchmarks) if (b.summaries['qa-worse']) b.summaries['qa-worse'].latency_p95 = 6;
  await mockReport(page, report);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openReport(page, REPORT);
  const costList = cost(page).getByRole('list', { name: 'Cost per 1,000 tasks' });
  await expect(costList.getByRole('listitem')).toHaveCount(5);
  const costs = (await costList.locator('.value').allTextContents()).map((t) => parseFloat(t.slice(1)));
  expect(costs).toHaveLength(5);
  expect(costs).toEqual([...costs].sort((a, b) => a - b)); // cheapest first
  for (const r of await bars(costList)) expect(Math.abs(r.ratio - parseFloat(r.value.slice(1)) / costs[4])).toBeLessThan(0.01);
  await expect(cost(page).getByRole('list', { name: 'Spend by model' }).getByRole('listitem')).toHaveCount(5);
  await expect(cost(page)).toContainText(/Total spend\s*\$1\.\d\d/);
  const lat = speed(page).getByRole('list', { name: 'Latency per call' });
  await expect(lat.getByRole('listitem')).toHaveCount(5);
  const secs = (await lat.locator('.value').allTextContents()).map((t) => parseFloat(t));
  expect(secs).toHaveLength(5);
  expect(secs).toEqual([...secs].sort((a, b) => a - b)); // fastest first
  const worse = lat.getByRole('listitem').filter({ hasText: 'qa-worse' });
  await expect(worse).toContainText('p95 6.0 s');
  const [track, tail, median] = await Promise.all([worse.locator('.track').boundingBox(), worse.locator('.fill.tail').boundingBox(), worse.locator('.fill:not(.tail)').boundingBox()]);
  expect(Math.abs(tail!.width / track!.width - 1)).toBeLessThan(0.01); // the slowest tail sets the scale
  expect(Math.abs(median!.width / tail!.width - 2 / 6)).toBeLessThan(0.01);
  const scatter = speed(page).locator('[data-chart="latency-scatter"]');
  await expect(scatter.locator('.sr-only tbody tr')).toHaveCount(5);
  await expect(scatter.locator('.recharts-scatter-line')).toBeAttached();
  await expect(scatter).toContainText('Median latency (s)');
});

test('[AC-34.9] a model with no successful call is not cheapest or fastest; an incomplete one is labelled and hatched', async ({ page, request }) => {
  const report = await loadReport(request);
  Object.assign(report.summary.markers['qa-flaky'], { error_rate: 1, task_success: null, cost_per_1k_tasks: 0, latency_p50: 0 });
  report.summary.markers['qa-worse'].incomplete = true;
  await mockReport(page, report);
  await openReport(page, REPORT);
  const lists = [cost(page).getByRole('list', { name: 'Cost per 1,000 tasks' }), speed(page).getByRole('list', { name: 'Latency per call' })];
  for (const list of lists) {
    await expect(list.getByRole('listitem')).toHaveCount(4);
    await expect(list).not.toContainText('qa-flaky');
    const worse = list.getByRole('listitem').filter({ hasText: 'qa-worse' });
    await expect(worse).toContainText('qa-worse (incomplete)');
    await expect(worse.locator('.fill.hatched').first()).toBeAttached();
  }
});

for (const width of [1280, 390]) {
  test(`[AC-34.8] [AC-34.9] [AC-34.10] [AC-34.11] the full report fits ${width}px and is captured`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openReport(page, REPORT);
    await expect(speed(page).locator('[data-chart="latency-scatter"] .recharts-wrapper')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const nav = page.getByRole('navigation', { name: 'Report sections' });
    for (const tab of ['Capabilities', 'Cost', 'Speed', 'Regressions', 'Evidence']) await expect(nav.getByRole('link', { name: tab })).toBeVisible();
    await shot(page, `report-full-${width}`);
  });
}

const regressionsOf = (page: Page) => page.getByRole('region', { name: 'Regressions' });

test('[AC-34.10] one toggle per candidate; switching changes the list; a regression opens to both outputs and the reason', async ({ page, request }) => {
  const report = await loadReport(request);
  const item = report.flagged['qa-worse'].items.find((i: { kind: string }) => i.kind === 'regression');
  item.candidate.reasons = ['expected "42" but got "ANSWER: 0"'];
  await mockReport(page, report);
  await openReport(page, REPORT);
  const reg = regressionsOf(page);
  const toggle = (name: RegExp) => reg.getByRole('group', { name: 'Candidates' }).getByRole('button', { name });
  await expect(reg.getByRole('group', { name: 'Candidates' }).getByRole('button')).toHaveCount(4);
  await expect(toggle(/qa-tie · 0/)).toBeVisible();
  await expect(toggle(/qa-worse/)).toHaveAttribute('aria-pressed', 'true'); // the candidate with most regressions opens first
  await expect(reg.locator('details.reg')).toHaveCount(8);
  await toggle(/qa-better/).click();
  await expect(toggle(/qa-better/)).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(/qa-worse/)).toHaveAttribute('aria-pressed', 'false');
  await expect(reg.locator('details.reg')).toHaveCount(5);
  await toggle(/qa-tie/).click();
  await expect(reg.getByText('No case that qa-base passed fails on qa-tie.')).toBeVisible();
  await toggle(/qa-worse/).click();
  const row = reg.locator('details.reg', { hasText: `${item.benchmark} · ${item.case_id}` });
  await expect(row).not.toHaveAttribute('open', '');
  await row.locator('summary').click();
  await expect(row).toHaveAttribute('open', '');
  await expect(row.locator('pre')).toHaveCount(2);
  await expect(row).toContainText('qa-base · baseline');
  await expect(row).toContainText('qa-worse · candidate');
  await expect(row).toContainText('Why it failed: expected "42" but got "ANSWER: 0"');
  await expect(row.getByLabel('qa-worse output')).toContainText(item.candidate.text);
});

for (const width of [1280, 390]) {
  test(`[AC-34.10] a long output scrolls inside its box, is focusable and does not scroll the page at ${width}px`, async ({ page, request }) => {
    const report = await loadReport(request);
    const item = report.flagged['qa-worse'].items.find((i: { kind: string }) => i.kind === 'regression');
    item.candidate.text = Array.from({ length: 120 }, (_, i) => `line ${i} ${'x'.repeat(i === 3 ? 400 : 10)}`).join('\n');
    await mockReport(page, report);
    await page.setViewportSize({ width, height: 900 });
    await openReport(page, REPORT);
    const row = regressionsOf(page).locator('details.reg', { hasText: `${item.benchmark} · ${item.case_id}` });
    await row.locator('summary').click();
    const out = row.getByLabel('qa-worse output');
    expect(await out.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await out.focus();
    await expect(out).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('[AC-34.11] every evidence row shows n, change, CI, p, McNemar p, W/T/L and verdict from the benchmarks; the report links return HTML and JSON', async ({ page, request }) => {
  const report = await loadReport(request);
  await openReport(page, REPORT);
  const evidence = page.getByRole('region', { name: 'Evidence' });
  await expect(evidence.getByRole('columnheader')).toHaveText(['Model', 'Pass rate', 'n', 'Score change (pts)', '95% CI (pts)', 'p', 'McNemar p', 'W/T/L', 'Verdict']);
  const pts = (v: number) => `${v >= 0 ? '+' : ''}${(100 * v).toFixed(1)}`;
  const p = (v: number) => (v < 0.001 ? '<0.001' : v.toFixed(3));
  let checked = 0;
  for (const b of report.benchmarks) {
    const group = evidence.getByRole('rowgroup', { name: b.name });
    await expect(group.getByRole('row')).toHaveCount(1 + Object.keys(b.summaries).length);
    for (const c of b.comparisons) {
      const cells = group.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${c.candidate}`) }) }).locator('td');
      await expect(cells.nth(1), `${b.name}/${c.candidate} n`).toHaveText(String(c.n));
      await expect(cells.nth(2), `${b.name}/${c.candidate} change`).toHaveText(pts(c.delta));
      await expect(cells.nth(3), `${b.name}/${c.candidate} CI`).toHaveText(`${pts(c.ci[0])} to ${pts(c.ci[1])}`);
      await expect(cells.nth(4), `${b.name}/${c.candidate} p`).toHaveText(p(c.p_value));
      await expect(cells.nth(5), `${b.name}/${c.candidate} McNemar`).toHaveText(p(c.mcnemar_p));
      await expect(cells.nth(6), `${b.name}/${c.candidate} W/T/L`).toHaveText(`${c.wins}/${c.ties}/${c.losses}`);
      await expect(cells.nth(7).locator(`[data-verdict="${c.verdict}"]`), `${b.name}/${c.candidate} verdict`).toBeVisible();
      checked += 1;
    }
  }
  expect(checked).toBe(21);
  await expect(evidence).toContainText('Fewer than 10 shared cases gives no verdict.');
  const html = await request.get(await page.getByRole('link', { name: 'Open report' }).getAttribute('href') as string);
  expect(html.status()).toBe(200);
  expect(html.headers()['content-type']).toContain('text/html');
  const json = await request.get(await page.getByRole('link', { name: 'JSON' }).getAttribute('href') as string);
  expect((await json.json()).baseline).toBe('qa-base');
});

// Projects (milestone 5). Every project a test creates is deleted again.
const projects: string[] = [];
test.afterEach(async ({ request }) => { for (const slug of projects.splice(0)) await request.delete(`/api/projects/${slug}`); });
async function makeProject(request: import('@playwright/test').APIRequestContext, name: string, n = 3) {
  const res = await request.post('/api/projects', { data: { name, dimension: 'knowledge', description: 'QA project', scorers: [{ type: 'contains' }], cases: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, input: `Question ${i + 1}?`, expected: `Answer ${i + 1}` })) } });
  expect(res.status()).toBe(201);
  const slug = (await res.json()).slug as string;
  projects.push(slug);
  return slug;
}
const SIZES = [{ width: 1280, height: 800 }, { width: 390, height: 844 }];

test('[AC-34.13] the list shows a card per project and flags an invalid one with its error', async ({ page, request }) => {
  await makeProject(request, 'qa-p5-card');
  await page.route('**/api/projects', async (route) => {
    const rows = await (await route.fetch()).json();
    await route.fulfill({ json: [...rows, { slug: 'qa-p5-broken', name: 'qa-p5-broken', dimension: null, n_cases: 0, valid: false, error: 'Case refund_07: expected is not valid JSON.' }] });
  });
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.goto('/projects/');
    const card = page.getByRole('article', { name: 'qa-p5-card' });
    for (const text of ['3 cases', 'knowledge', 'Never run']) await expect(card.getByText(text)).toBeVisible();
    const broken = page.getByRole('article', { name: 'qa-p5-broken' });
    await expect(broken.getByText('Case refund_07: expected is not valid JSON.')).toBeVisible();
    await expect(broken.getByText('invalid', { exact: true })).toBeVisible();
    await expect(page.getByText(/needs? fixing/)).toContainText('1 needs fixing');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, `projects-list-${size.width}`);
  }
  await page.getByRole('searchbox', { name: 'Search projects' }).fill('broken');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'qa-p5-broken' })).toBeVisible();
});

test('[AC-34.13] in the editor Run is disabled until save and says why; an inline edit marks it unsaved and Save clears that', async ({ page, request }) => {
  const slug = await makeProject(request, 'qa-p5-edit');
  await page.goto('/projects/edit/?new=1');
  const run = page.getByRole('button', { name: 'Run on selected models' });
  await expect(run).toBeDisabled();
  await expect(run).toHaveAccessibleDescription('Save the project to run it.');

  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.goto(`/projects/edit/?slug=${slug}`);
    await expect(run).toBeEnabled();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit case 1' }).click();
    await page.getByLabel('Case 1 expected').fill(`Answer, edited at ${size.width}`);
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await expect(run).toBeDisabled();
    await expect(run).toHaveAccessibleDescription('Save your changes to run them.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, `project-editor-${size.width}`);
    await page.getByRole('button', { name: 'Save project' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
    await expect(run).toBeEnabled();
  }
  const checks = page.getByRole('complementary', { name: 'Project actions' });
  await expect(checks).toContainText('3 cases, ids unique');
  await expect(checks).toContainText('Every case has a scorer');
  await expect(page.getByRole('heading', { name: 'Scorers' })).toBeVisible();
});

test('[AC-34.13] the checks list names a duplicate id and Fix it opens that case', async ({ page, request }) => {
  const slug = await makeProject(request, 'qa-p5-checks', 2);
  await page.goto(`/projects/edit/?slug=${slug}`);
  await page.getByRole('button', { name: 'Edit case 2' }).click();
  await page.getByLabel('Case 2 id').fill('c1');
  await page.getByRole('button', { name: 'Edit case 2' }).click(); // fold it again
  const side = page.getByRole('complementary', { name: 'Project actions' });
  await expect(side).toContainText('Case 1: duplicate id.');
  await side.getByRole('button', { name: 'Fix it' }).click();
  await expect(page.getByLabel('Case 1 id')).toBeVisible();
});

test('[AC-34.13] a project with hundreds of cases draws a page of rows, shows all on request and still edits inline', async ({ page, request }) => {
  const slug = await makeProject(request, 'qa-p5-large', 300);
  await page.goto(`/projects/edit/?slug=${slug}`);
  const table = page.getByRole('table', { name: 'Cases' });
  await expect(table.getByRole('button', { name: /^Edit case \d+$/ })).toHaveCount(25);
  await page.getByRole('button', { name: 'Show all 300 cases' }).click();
  await expect(table.getByRole('button', { name: /^Edit case \d+$/ })).toHaveCount(300);
  await expect(page.getByRole('button', { name: 'Edit case 26', exact: true })).toBeFocused(); // focus does not fall to the page
  await page.getByRole('button', { name: 'Edit case 300' }).click();
  await page.getByLabel('Case 300 input').fill('Edited last case');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  expect((await (await request.get(`/api/projects/${slug}`)).json()).cases[299].input).toBe('Edited last case');
});

test('[AC-34.13] Add case and Fix it bring the case into view and focus its id field, even on case 300', async ({ page, request }) => {
  const slug = await makeProject(request, 'qa-p5-reveal', 300);
  await page.goto(`/projects/edit/?slug=${slug}`);
  await page.getByRole('button', { name: 'Add case' }).click();
  await expect(page.getByLabel('Case 301 id')).toBeInViewport();
  await expect(page.getByLabel('Case 301 id')).toBeFocused();
  await page.getByRole('button', { name: 'Delete case 301' }).click();
  await page.getByRole('button', { name: 'Edit case 300' }).click();
  await page.getByLabel('Case 300 id').fill('');
  await page.getByRole('button', { name: 'Edit case 300' }).click(); // fold it
  await page.evaluate(() => window.scrollTo(0, 0));
  const side = page.getByRole('complementary', { name: 'Project actions' });
  await expect(side).toContainText('Case 300: id is required.');
  await side.getByRole('button', { name: 'Fix it' }).click();
  await expect(page.getByLabel('Case 300 id')).toBeInViewport();
  await expect(page.getByLabel('Case 300 id')).toBeFocused();
});

test('[AC-34.13] at 390 the sticky bar stays one compact row and never covers a focused field', async ({ page, request }) => {
  const slug = await makeProject(request, 'qa-p5-bar', 12);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/projects/edit/?slug=${slug}`);
  const bar = page.locator('.proj-bar');
  await expect(bar.getByRole('button', { name: 'Save project' })).toBeVisible();
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(64);
  await page.getByRole('button', { name: 'Edit case 12' }).click();
  const last = page.locator('form input:not([type=checkbox]), form textarea, form select').last();
  for (const field of [page.getByLabel('Case 12 input'), last]) {
    await field.focus();
    await expect(field).toBeInViewport();
    const [f, b] = [(await field.boundingBox())!, (await bar.boundingBox())!];
    expect(f.y + f.height).toBeLessThanOrEqual(b.y);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(bar).toBeInViewport(); // stuck to the bottom of the screen
  await shot(page, 'project-editor-bar-390');
});

test('[AC-34.13] the draft dialog opens, keeps focus inside, closes on Escape and gives focus back', async ({ page }) => {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.goto('/projects/edit/?new=1');
    const trigger = page.getByRole('button', { name: 'Draft with AI' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Draft with AI' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true); // focus moved in
    await expect(dialog.getByLabel('Model')).toBeVisible();
    await shot(page, `project-draft-dialog-${size.width}`);
    for (let i = 0; i < 12; i++) { // more tabs than the dialog has controls
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test('[AC-34.13] Delete asks to confirm; Cancel keeps the project and Confirm removes it', async ({ page, request }) => {
  const slug = await makeProject(request, 'qa-p5-delete');
  await page.goto(`/projects/edit/?slug=${slug}`);
  await page.getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByText(/This removes its file and cannot be undone/)).toBeVisible();
  await shot(page, 'project-delete-confirm');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Confirm delete' })).toHaveCount(0);
  expect((await request.get(`/api/projects/${slug}`)).status()).toBe(200);
  await page.getByRole('button', { name: 'Delete project' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page).toHaveURL(/\/projects\/$/);
  expect((await request.get(`/api/projects/${slug}`)).status()).toBe(404);
});

test('[AC-34.15] a failed Projects list shows error with retry, Retry refetches, and the empty list offers a next step', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/projects', (route) => (calls++ === 0 ? route.fulfill({ status: 500, body: 'boom' }) : route.fulfill({ json: [] })));
  await page.goto('/projects/');
  const error = page.locator('[data-state="error"]');
  await expect(error).toContainText('Could not load projects');
  await error.getByRole('button', { name: 'Try again' }).click();
  expect(calls).toBeGreaterThan(1);
  await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create your first project' })).toHaveAttribute('href', /new=1/);
  await shot(page, 'projects-empty');
});

test('[AC-34.15] the editor shows loading, then error with retry that refetches, and a missing project links back', async ({ page, request }) => {
  const slug = await makeProject(request, 'qa-p5-states');
  let calls = 0;
  await page.route('**/api/scorers', (route) => (calls++ === 0 ? route.fulfill({ status: 500, body: 'boom' }) : route.continue()));
  await page.goto(`/projects/edit/?slug=${slug}`);
  await expect(page.locator('[data-state="error"]')).toContainText('Could not load the project');
  await shot(page, 'project-editor-error');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('qa-p5-states');
  expect(calls).toBeGreaterThan(1);
  await page.goto('/projects/edit/?slug=qa-p5-nope');
  const back = page.getByRole('link', { name: 'Back to projects' });
  await expect(back).toBeVisible();
  expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(24);
});

// ---- Milestone 6: Settings, scatter labels, and the whole-app accessibility pass ----
const KEY = 'sk-test-000000000000e5f6';
const KEY2 = 'sk-test-000000000000g7h8';
const keyRow = (page: Page) => page.locator('[data-provider="togetherai"]');
// togetherai belongs to this spec only (settings.spec owns groq, e2e gemini, models openai). It is removed even when a step fails.
test.describe('settings keys', () => {
  test.afterEach(async ({ request }) => { await request.delete('/api/settings/keys/togetherai'); });

  test('[AC-34.14] a provider row shows status, masked key and inline Replace, Test and Remove; the full key never reaches the page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/settings/');
    const row = keyRow(page);
    await expect(row.locator('.chip')).toHaveText('not set');
    await expect(row.getByRole('button', { name: 'Test' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Where keys live' })).toBeVisible();
    const clean = async (...keys: string[]) => { const html = await page.content(); for (const k of keys) expect(html).not.toContain(k); };

    await row.getByRole('button', { name: 'Add' }).click();
    await row.getByLabel('Together AI API key').fill(KEY);
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.locator('.chip')).toHaveText('set');
    await expect(row.locator('.key-mask')).toHaveText('sk-…e5f6');
    for (const name of ['Replace', 'Test', 'Remove']) await expect(row.getByRole('button', { name })).toBeVisible();
    await clean(KEY);
    await shot(page, 'settings-1280');

    await page.route('**/api/settings/keys/togetherai/test', (route) => route.fulfill({ json: { ok: true, message: 'Key accepted.' } }));
    await row.getByRole('button', { name: 'Test' }).click();
    await expect(row.getByRole('status')).toHaveText('Key accepted.');
    await clean(KEY);

    await row.getByRole('button', { name: 'Replace' }).click();
    await row.getByLabel('Together AI API key').fill(KEY2);
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.locator('.key-mask')).toHaveText('sk-…g7h8');
    await clean(KEY, KEY2);

    await row.getByRole('button', { name: 'Remove' }).click();
    await row.getByRole('button', { name: 'Remove key' }).click();
    await expect(row.locator('.chip')).toHaveText('not set');
    await expect(row.locator('.key-mask')).toHaveText('—');
    await clean(KEY, KEY2);
  });

  test('[AC-34.14] the typed key is never in the page, not while the form is open and not after a rejected save', async ({ page }) => {
    await page.goto('/settings/');
    const row = keyRow(page);
    await row.getByRole('button', { name: 'Add' }).click();
    await row.getByLabel('Together AI API key').fill(KEY);
    await expect(row.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(await page.content()).not.toContain(KEY);
    await page.route('**/api/settings/keys/togetherai', (route) => (route.request().method() === 'PUT' ? route.fulfill({ status: 422, json: { detail: 'Key rejected.' } }) : route.continue()));
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('status')).toContainText('Key rejected.');
    await expect(row.getByLabel('Together AI API key')).toBeVisible();
    expect(await page.content()).not.toContain(KEY);
    await expect(row.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('[AC-34.14] a key from the environment is labelled, explained and has no Remove', async ({ page }) => {
    await page.route('**/api/settings/keys', (route) => route.fulfill({
      json: [{ provider: 'togetherai', var: 'TOGETHERAI_API_KEY', set: true, masked: 'sk-…e5f6', source: 'environment' }],
    }));
    await page.goto('/settings/');
    await expect(keyRow(page).locator('.chip')).toHaveText('from environment');
    await expect(keyRow(page).getByText('Set in the server environment')).toBeVisible();
    await expect(keyRow(page).getByRole('button', { name: 'Replace' })).toBeVisible();
    await expect(keyRow(page).getByRole('button', { name: 'Remove' })).toHaveCount(0);
  });

  test('[AC-34.14] settings fits 390px and is captured', async ({ page, request }) => {
    await request.put('/api/settings/keys/togetherai', { data: { value: KEY } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings/');
    await expect(keyRow(page).locator('.key-mask')).toHaveText('sk-…e5f6');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await shot(page, 'settings-390');
  });
});

test('[AC-34.15] a failed Settings load shows error with retry, and Retry refetches', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/settings/keys', (route) => (calls++ === 0 ? route.fulfill({ status: 500, body: 'boom' }) : route.continue()));
  await page.goto('/settings/');
  const error = page.locator('[data-state="error"]');
  await expect(error).toContainText('could not be loaded');
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(keyRow(page)).toBeVisible();
  expect(calls).toBeGreaterThan(1);
});

test('[AC-34.15] Settings shows loading, and the empty state when no key is set', async ({ page }) => {
  const none = ['openai', 'anthropic', 'gemini', 'togetherai', 'groq', 'openrouter'].map((p) => ({ provider: p, var: `${p.toUpperCase()}_API_KEY`, set: false, masked: null, source: null }));
  await page.route('**/api/settings/keys', async (route) => { await new Promise((r) => setTimeout(r, 400)); await route.fulfill({ json: none }); });
  await page.goto('/settings/');
  await expect(page.getByText('Loading keys')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No keys yet' })).toBeVisible();
  await expect(page.locator('.key-row')).toHaveCount(6);
});

const labelBoxes = (chart: Locator) => chart.locator('.scatter-labels tspan').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent ?? '', x: r.x, y: r.y, w: r.width, h: r.height }; }));
const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
async function scatterWith(page: Page, request: import('@playwright/test').APIRequestContext, tweak: (m: Record<string, { latency_p50: number; task_success: number }>) => void) {
  const report = await loadReport(request);
  tweak(report.summary.markers);
  await mockReport(page, report);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openReport(page, REPORT);
  const chart = speed(page).locator('[data-chart="latency-scatter"]');
  await expect(chart.locator('.scatter-labels tspan').first()).toBeVisible();
  return chart;
}
async function checkLabels(chart: Locator) {
  const labels = await labelBoxes(chart);
  expect(labels.length).toBeGreaterThan(1);
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) expect(hit(labels[i], labels[j]), `${labels[i].t} overlaps ${labels[j].t}`).toBe(false);
  const dots = await chart.locator('.recharts-scatter circle').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  expect(dots.length).toBeGreaterThan(1);
  for (const l of labels) for (const d of dots) expect(hit(l, d), `${l.t} covers a dot`).toBe(false);
  const g = (await chart.locator('.recharts-cartesian-grid').first().boundingBox())!;
  for (const l of labels) {
    expect(l.x, l.t).toBeGreaterThanOrEqual(g.x - 1); expect(l.x + l.w, l.t).toBeLessThanOrEqual(g.x + g.width + 1);
    expect(l.y, l.t).toBeGreaterThanOrEqual(g.y - 1); expect(l.y + l.h, l.t).toBeLessThanOrEqual(g.y + g.height + 1);
  }
  return labels;
}

test('[AC-34.9] scatter labels do not overlap or cover dots when every model has the same latency', async ({ page, request }) => {
  const chart = await scatterWith(page, request, (m) => { for (const k of Object.keys(m)) m[k].latency_p50 = 0.4; });
  await checkLabels(chart);
  await chart.screenshot({ path: join(SHOTS, 'latency-scatter.png') });
});

test('[AC-34.9] scatter labels stay inside the plot for models near 100% and near 0%', async ({ page, request }) => {
  const chart = await scatterWith(page, request, (m) => {
    for (const k of Object.keys(m)) m[k].latency_p50 = 0.4;
    m['qa-better'].task_success = 0.99; m['qa-worse'].task_success = 0.01;
  });
  await checkLabels(chart);
  await chart.screenshot({ path: join(SHOTS, 'latency-scatter-extremes.png') });
});

// AC-34.16 accessibility: axe-core (a dependency of the web app's tooling) is injected and the run fails on serious or critical violations.
const ROOT = process.env.PWD ?? process.cwd();
const AXE = [join(ROOT, 'web', 'node_modules', 'axe-core', 'axe.min.js'), join(process.env.HOME ?? '', '.claude', 'skills', 'design', 'node_modules', 'axe-core', 'axe.min.js')].find(existsSync);
for (const width of [1280, 390]) {
  for (const route of ['/compare/', REPORT, '/history/', '/models/', '/projects/', '/settings/']) {
    test(`[AC-34.16] ${route} has no serious accessibility violations and no horizontal scroll at ${width}px`, async ({ page }) => {
      expect(AXE, 'axe-core must be installed').toBeTruthy();
      await page.setViewportSize({ width, height: 844 });
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.addScriptTag({ path: AXE! });
      const bad = await page.evaluate(async () => {
        const r = await (window as unknown as { axe: { run: (c: Document) => Promise<{ violations: { id: string; impact: string; nodes: { target: unknown }[] }[] }> } }).axe.run(document);
        return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => String(n.target)).join(' | ')}`);
      });
      expect(bad).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
}
